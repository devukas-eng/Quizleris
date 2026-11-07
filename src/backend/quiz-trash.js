// Deleted quizzes (docs/adr/0002-what-may-delete-data.md). A deleted quiz moves to its own table, so
// every query on `quizzes` keeps meaning "live quizzes" and nothing there needs a filter. Its results,
// pictures, task links and versions stay where they are, keyed by the quiz's ID, so a restore is
// moving one row back. After the plan's recovery days the hourly job deletes it for good, by name,
// with everything that belongs to it. A free quiz that was not renewed skips this: its pause was its
// time to come back (KEEP_DAYS and PAUSE_DAYS in plans.js).
const express = require('express');
const { inTransaction } = require('./bank.js');
const { isPremium, recoveryDays, keepUntil } = require('./plans.js');
const quizLinks = require('./quiz-links.js');
const quizVersions = require('./quiz-versions.js');
const { forgetQuizFolders } = require('./quiz-folders.js');

const PART = 500;
let ready = false;
const isReady = () => ready;

async function ensureQuizTrash(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS deleted_quizzes (
            id VARCHAR(50) PRIMARY KEY,
            owner_id INT NULL,
            title VARCHAR(255) NOT NULL,
            quiz_data JSON NOT NULL,
            facts JSON NOT NULL,
            reason VARCHAR(20) NOT NULL,
            deleted_at DATETIME NOT NULL,
            deleted_by INT NULL,
            purge_at DATETIME NOT NULL,
            INDEX deleted_quizzes_owner (owner_id, deleted_at),
            INDEX deleted_quizzes_purge (purge_at)
        ) ENGINE=InnoDB
    `);
    ready = true;
}

const parseJson = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

/** The columns of a quiz row other than its content, kept so a restore puts it back as it was. */
function factsOf(row) {
    return {
        visibility: row.visibility,
        featured: row.featured ? 1 : 0,
        featured_order: row.featured_order || 0,
        expires_at: row.expires_at,
        storage_bytes: row.storage_bytes || 0,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

/** Account rows by ID, for whose plan sets the days. */
async function ownersOf(db, ownerIds) {
    const ids = [...new Set(ownerIds.filter(id => id != null))];
    if (!ids.length) return new Map();
    const [rows] = await db.query('SELECT id, role, subscription_tier, subscription_expires_at FROM users WHERE id IN (?)', [ids]);
    return new Map(rows.map(row => [row.id, row]));
}

/** Whether a quiz's owner has premium's limits (premade quizzes, with no owner, count as premium). */
async function ownerIsPremium(db, ownerId) {
    if (ownerId == null) return true;
    const owner = (await ownersOf(db, [ownerId])).get(ownerId);
    return Boolean(owner && isPremium(owner));
}

/**
 * Moves live quizzes to the deleted ones. `reason` is 'deleted' ('expired' in rows from before free
 * quizzes paused instead); `by` the account that
 * deleted them, if any. Gives how many moved.
 */
async function trashQuizzes(pool, ids, { reason, by = null }) {
    let moved = 0;
    for (let start = 0; start < ids.length; start += PART) {
        const part = ids.slice(start, start + PART);
        const tasks = await inTransaction(pool, async conn => {
            const [rows] = await conn.query('SELECT * FROM quizzes WHERE id IN (?) FOR UPDATE', [part]);
            if (!rows.length) return [];
            const owners = await ownersOf(conn, rows.map(row => row.owner_id));
            for (const row of rows) {
                // The days follow the owner's plan; times come from the database, which the hourly job compares with
                const days = row.owner_id == null ? recoveryDays({ role: 'admin' }) : recoveryDays(owners.get(row.owner_id));
                await conn.query(
                    `INSERT INTO deleted_quizzes (id, owner_id, title, quiz_data, facts, reason, deleted_at, deleted_by, purge_at)
                     VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, NOW() + INTERVAL ? DAY)`,
                    [row.id, row.owner_id, row.title, JSON.stringify(parseJson(row.quiz_data)), JSON.stringify(factsOf(row)), reason, by, days]
                );
            }
            await conn.query('DELETE FROM quizzes WHERE id IN (?)', [rows.map(row => row.id)]);
            moved += rows.length;
            const [links] = await conn.query('SELECT DISTINCT item_id FROM quiz_bank_links WHERE quiz_id IN (?)', [rows.map(row => row.id)])
                .catch(() => [[]]);
            return links.map(row => row.item_id);
        });
        await quizLinks.refreshUses(pool, tasks); // a deleted quiz no longer counts as using a task
    }
    return moved;
}

/**
 * Deletes quizzes for good, live or deleted, with everything that is only there for them, by name and
 * all at once. Nothing in this app is deleted for not finding its parent.
 */
async function purgeQuizzes(pool, ids, { attemptsReady }) {
    for (let start = 0; start < ids.length; start += PART) {
        const part = ids.slice(start, start + PART);
        const tasks = await inTransaction(pool, async conn => {
            await forgetQuizFolders(conn, part);
            if (attemptsReady) await conn.query('DELETE FROM quiz_attempts WHERE quiz_id IN (?)', [part]);
            const used = await quizLinks.forgetQuizzes(conn, part);
            await quizVersions.forgetQuizzes(conn, part);
            await conn.query('DELETE FROM quizzes WHERE id IN (?)', [part]);
            if (ready) await conn.query('DELETE FROM deleted_quizzes WHERE id IN (?)', [part]);
            return used;
        });
        await quizLinks.refreshUses(pool, tasks);
    }
}

/**
 * Hourly: a free quiz paused for `pauseDays` without being renewed goes for good (its pause was its
 * time to come back), and deleted quizzes past their recovery days go too.
 */
async function hourly(pool, { attemptsReady, pauseDays }) {
    const [gone] = await pool.query('SELECT id FROM quizzes WHERE expires_at IS NOT NULL AND expires_at <= NOW() - INTERVAL ? DAY', [pauseDays]);
    await purgeQuizzes(pool, gone.map(row => row.id), { attemptsReady });
    const [due] = await pool.query('SELECT id FROM deleted_quizzes WHERE purge_at <= NOW()');
    await purgeQuizzes(pool, due.map(row => row.id), { attemptsReady });
    return { gone: gone.length, purged: due.length };
}

class TrashError extends Error {
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

/**
 * Brings a deleted quiz back with its results. Premium owners restore their own, admins any. A quiz on
 * the free plan comes back renewed, since its old date may be past.
 */
async function restoreQuiz(pool, user, rawId) {
    const id = String(rawId || '');
    return inTransaction(pool, async conn => {
        const [[row]] = await conn.query('SELECT * FROM deleted_quizzes WHERE id = ? FOR UPDATE', [id]);
        const admin = user.role === 'admin';
        if (!row || (!admin && row.owner_id !== user.id)) throw new TrashError('Quiz not found', 404, 'not_found');
        if (!admin && !isPremium(user)) throw new TrashError('Restoring a deleted quiz needs Premium', 403, 'restore_premium');
        const [[taken]] = await conn.query('SELECT id FROM quizzes WHERE id = ?', [row.id]);
        if (taken) throw new TrashError('Another quiz has this code now', 409, 'quiz_id_taken');
        const facts = parseJson(row.facts) || {};
        const premium = await ownerIsPremium(conn, row.owner_id);
        const expiresAt = premium || facts.featured ? null : keepUntil(facts.created_at || null);
        const quizData = parseJson(row.quiz_data);
        await conn.query(
            `INSERT INTO quizzes (id, owner_id, title, visibility, quiz_data, storage_bytes, expires_at, featured, featured_order, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.id, row.owner_id, row.title, facts.visibility || 'private', JSON.stringify(quizData), facts.storage_bytes || 0, expiresAt,
                facts.featured ? 1 : 0, facts.featured_order || 0, facts.created_at ? new Date(facts.created_at) : new Date()]
        );
        await conn.query('DELETE FROM deleted_quizzes WHERE id = ?', [row.id]);
        return { id: row.id, expires_at: expiresAt };
    }).then(async result => {
        const [links] = await pool.query('SELECT DISTINCT item_id FROM quiz_bank_links WHERE quiz_id = ?', [result.id]).catch(() => [[]]);
        await quizLinks.refreshUses(pool, links.map(link => link.item_id));
        return result;
    });
}

/** The caller's deleted quizzes, or everyone's for an admin who asks, newest first. */
async function listTrash(pool, user, all, attemptsReady) {
    const everyone = all && user.role === 'admin';
    const [rows] = await pool.query(
        `SELECT d.id, d.title, d.reason, d.deleted_at, d.purge_at, d.owner_id, u.username AS owner,
                JSON_LENGTH(JSON_EXTRACT(d.quiz_data, '$.questions')) AS questions
         FROM deleted_quizzes d LEFT JOIN users u ON u.id = d.owner_id
         ${everyone ? '' : 'WHERE d.owner_id = ?'}
         ORDER BY d.deleted_at DESC LIMIT 200`,
        everyone ? [] : [user.id]
    );
    if (attemptsReady && rows.length) {
        const [counts] = await pool.query('SELECT quiz_id, COUNT(*) AS n FROM quiz_attempts WHERE quiz_id IN (?) GROUP BY quiz_id', [rows.map(row => row.id)]);
        const byQuiz = new Map(counts.map(row => [row.quiz_id, Number(row.n)]));
        rows.forEach(row => { row.attempts = byQuiz.get(row.id) || 0; });
    }
    return rows.map(row => ({ ...row, questions: Number(row.questions) || 0, mine: row.owner_id === user.id }));
}

/** /api/quiz-trash: the list and restoring. Its own path: /api/quizzes/:id would take "trash" for a code. */
function createQuizTrashRouter(pool, { authenticateToken, attemptsReady }) {
    const router = express.Router();
    const route = handler => async (req, res) => {
        if (!ready) return res.status(503).json({ error: 'Deleted quizzes are not available' });
        try {
            res.json(await handler(req));
        } catch (error) {
            if (error instanceof TrashError) return res.status(error.status).json({ error: error.message, code: error.code });
            console.error('[QUIZ TRASH]', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
    router.get('/quiz-trash', authenticateToken, route(async req => ({
        quizzes: await listTrash(pool, req.user, req.query.all === '1', attemptsReady())
    })));
    router.post('/quiz-trash/:id/restore', authenticateToken, route(req => restoreQuiz(pool, req.user, req.params.id)));
    return router;
}

module.exports = {
    ensureQuizTrash, isReady, trashQuizzes, purgeQuizzes, hourly, restoreQuiz, listTrash, ownerIsPremium, createQuizTrashRouter, factsOf
};
