const crypto = require('crypto');
const core = require('./bank-core.js');
const { recordHistory, taskChanges, snapshotOf } = require('./bank-history.js');

// Unsorted tasks: the shared bank's table with status 'pool', which teachers never see. Staff scroll
// through them in random order and vote. Enough dislikes take a task out (archived, never deleted),
// and enough likes put it before an admin, who sorts it into the bank. How many is an admin's setting.

const DEFAULT_LIKES = 2;
const DEFAULT_DISLIKES = 2;
const MAX_THRESHOLD = 1000;
const FEED_PAGE = 20;
const FEED_MAX = 50;
const SHUFFLE_END = 2 ** 32; // bank_pool.shuffle is an unsigned 32-bit number
const SUGGESTIONS_MAX = 200;

/** Gives a task its random place in the feed. */
async function addToPool(conn, itemId) {
    await conn.query('INSERT IGNORE INTO bank_pool (item_id, shuffle) VALUES (?, ?)', [itemId, crypto.randomInt(SHUFFLE_END)]);
}

/** A task sorted into the bank (one ID or a list) is no longer an unsorted one. Its votes stay as a record. */
async function leavePool(conn, itemIds) {
    await conn.query('DELETE FROM bank_pool WHERE item_id IN (?)', [itemIds]);
}

/**
 * What a task's votes mean: 'remove', 'suggest', 'unsuggest' (likes taken back before an admin got to
 * it) or null. Dislikes win. An admin's "not now" stands, however many likes follow.
 */
function poolDecision({ likes, dislikes, suggested, dismissed }, limits) {
    if (dislikes >= limits.dislikes) return 'remove';
    if (likes >= limits.likes) return suggested || dismissed ? null : 'suggest';
    return suggested ? 'unsuggest' : null;
}

async function poolLimits(db) {
    const [rows] = await db.query("SELECT name, value FROM bank_settings WHERE name IN ('pool_likes', 'pool_dislikes')");
    const stored = Object.fromEntries(rows.map(row => [row.name, Number(row.value)]));
    return { likes: stored.pool_likes || DEFAULT_LIKES, dislikes: stored.pool_dislikes || DEFAULT_DISLIKES };
}

async function applyDecision(conn, user, row, decision) {
    const id = row.item_id;
    if (decision === 'remove') {
        await conn.query("UPDATE bank_items SET status = 'archived' WHERE id = ?", [id]);
        await recordHistory(conn, user, [{ itemId: id, action: 'pool_removed', changes: { status: ['pool', 'archived'] }, note: `-${row.dislikes}` }]);
    } else if (decision === 'suggest') {
        await conn.query('UPDATE bank_pool SET suggested_at = NOW() WHERE item_id = ?', [id]);
        await recordHistory(conn, user, [{ itemId: id, action: 'pool_suggested', note: `+${row.likes}` }]);
    } else if (decision === 'unsuggest') {
        await conn.query('UPDATE bank_pool SET suggested_at = NULL WHERE item_id = ?', [id]);
    }
}

/** A cursor through the feed: where this session started, where it has got to, whether it wrapped round. */
function feedPosition(raw) {
    const cursor = raw ? core.decodeCursor(raw, 3) : null;
    if (cursor) return { start: cursor[0], next: cursor[1], wrapped: cursor[2] === 1 };
    const start = crypto.randomInt(SHUFFLE_END);
    return { start, next: start, wrapped: false };
}

/**
 * The next tasks of one person's feed. Everyone walks the same shuffled ring from their own random
 * start, so a page is an index range however large the pool is, and a task they voted on or tagged
 * never comes back.
 */
async function feedIds(db, user, position, limit) {
    const read = (from, to, count) => db.query(
        `SELECT p.item_id, p.shuffle, p.likes, p.dislikes
         FROM bank_pool p JOIN bank_items i ON i.id = p.item_id AND i.status = 'pool'
         WHERE p.shuffle >= ? AND p.shuffle < ?
           AND NOT EXISTS (SELECT 1 FROM bank_pool_votes v WHERE v.user_id = ? AND v.item_id = p.item_id)
           AND NOT EXISTS (SELECT 1 FROM bank_tags t WHERE t.user_id = ? AND t.item_id = p.item_id)
         ORDER BY p.shuffle LIMIT ?`, [from, to, user.id, user.id, count]).then(([rows]) => rows);
    let { next, wrapped } = position;
    const { start } = position;
    const rows = await read(next, wrapped ? start : SHUFFLE_END, limit);
    if (rows.length) next = rows[rows.length - 1].shuffle + 1;
    if (rows.length < limit && !wrapped) {
        wrapped = true;
        next = 0;
        const more = await read(0, start, limit - rows.length);
        rows.push(...more);
        if (more.length) next = more[more.length - 1].shuffle + 1;
    }
    const done = rows.length < limit && wrapped;
    return { rows, nextCursor: done ? null : core.encodeCursor([start, next, wrapped ? 1 : 0]) };
}

/**
 * The routes of the unsorted tasks, on the bank's router. `deps` are bank.js's own helpers: route,
 * requireStaff, requireAdmin, BankError, inTransaction, fetchItems and fullClassification.
 */
function poolRoutes(router, { pool, route, requireStaff, requireAdmin, BankError, inTransaction, fetchItems, fullClassification }) {
    const unsorted = async (conn, rawId) => {
        const id = core.toId(rawId);
        const [[row]] = id
            ? await conn.query(
                `SELECT p.item_id, p.likes, p.dislikes, p.suggested_at, p.dismissed_at, i.kind, i.status, i.subject_id, i.grade_id, i.topic_id, i.difficulty_id, i.source
                 FROM bank_pool p JOIN bank_items i ON i.id = p.item_id WHERE p.item_id = ? AND i.status = 'pool' FOR UPDATE`, [id])
            : [[]];
        if (!row) throw new BankError('This task is no longer among the unsorted ones', 404);
        return row;
    };

    router.get('/bank/pool/stats', requireStaff, route(async req => {
        const [[[{ total }]], [[{ rated }]], [[{ waiting }]], limits] = await Promise.all([
            pool.query("SELECT COUNT(*) AS total FROM bank_items WHERE owner_id = 0 AND status = 'pool'"),
            pool.query(`SELECT COUNT(*) AS rated FROM bank_pool_votes v JOIN bank_items i ON i.id = v.item_id
                        WHERE v.user_id = ? AND i.status = 'pool'`, [req.user.id]),
            pool.query(`SELECT COUNT(*) AS waiting FROM bank_pool p JOIN bank_items i ON i.id = p.item_id
                        WHERE i.status = 'pool' AND p.suggested_at IS NOT NULL AND p.dismissed_at IS NULL`),
            poolLimits(pool)
        ]);
        return { total: Number(total), rated: Number(rated), suggested: Number(waiting), limits };
    }));

    router.get('/bank/pool/feed', requireStaff, route(async req => {
        const limit = core.clampInt(req.query.limit, 1, FEED_MAX, FEED_PAGE);
        const { rows, nextCursor } = await feedIds(pool, req.user, feedPosition(req.query.cursor), limit);
        const votes = new Map(rows.map(row => [row.item_id, row]));
        const items = rows.length ? await fetchItems(pool, req.user, rows.map(row => row.item_id)) : [];
        return {
            items: items.map(item => ({ ...item, likes: votes.get(item.id).likes, dislikes: votes.get(item.id).dislikes })),
            nextCursor,
            limits: await poolLimits(pool)
        };
    }));

    // 1 likes the task, -1 does not, 0 takes one's vote back
    router.post('/bank/pool/:id/vote', requireStaff, route(req => {
        const vote = [1, -1, 0].includes(req.body?.vote) ? req.body.vote : null;
        if (vote === null) throw new BankError('Like it or not');
        return inTransaction(pool, async conn => {
            const row = await unsorted(conn, req.params.id);
            const id = row.item_id;
            if (vote) {
                await conn.query('INSERT INTO bank_pool_votes (user_id, item_id, vote) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE vote = VALUES(vote)', [req.user.id, id, vote]);
            } else {
                await conn.query('DELETE FROM bank_pool_votes WHERE user_id = ? AND item_id = ?', [req.user.id, id]);
            }
            const [[counts]] = await conn.query('SELECT IFNULL(SUM(vote = 1), 0) AS likes, IFNULL(SUM(vote = -1), 0) AS dislikes FROM bank_pool_votes WHERE item_id = ?', [id]);
            const likes = Number(counts.likes);
            const dislikes = Number(counts.dislikes);
            await conn.query('UPDATE bank_pool SET likes = ?, dislikes = ? WHERE item_id = ?', [likes, dislikes, id]);
            const limits = await poolLimits(conn);
            const decision = poolDecision({ likes, dislikes, suggested: !!row.suggested_at, dismissed: !!row.dismissed_at }, limits);
            await applyDecision(conn, req.user, { item_id: id, likes, dislikes }, decision);
            return { likes, dislikes, decision, limits };
        });
    }));

    // Admins set how many votes count. A lower number applies to the votes already cast.
    router.put('/bank/pool/settings', requireAdmin, route(req => {
        const limits = {
            likes: core.clampInt(req.body?.likes, 1, MAX_THRESHOLD, null),
            dislikes: core.clampInt(req.body?.dislikes, 1, MAX_THRESHOLD, null)
        };
        if (!limits.likes || !limits.dislikes) throw new BankError('Both numbers are needed');
        return inTransaction(pool, async conn => {
            await conn.query("INSERT INTO bank_settings (name, value) VALUES ('pool_likes', ?), ('pool_dislikes', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
                [String(limits.likes), String(limits.dislikes)]);
            const [due] = await conn.query(
                `SELECT p.item_id, p.likes, p.dislikes, p.suggested_at, p.dismissed_at FROM bank_pool p JOIN bank_items i ON i.id = p.item_id
                 WHERE i.status = 'pool' AND (p.dislikes >= ? OR p.likes >= ? OR p.suggested_at IS NOT NULL) FOR UPDATE`, [limits.dislikes, limits.likes]);
            for (const row of due) {
                const decision = poolDecision({ likes: row.likes, dislikes: row.dislikes, suggested: !!row.suggested_at, dismissed: !!row.dismissed_at }, limits);
                await applyDecision(conn, req.user, row, decision);
            }
            return { limits };
        });
    }));

    // Tasks that are not in the bank but enough people liked: an admin's to sort
    router.get('/bank/pool/suggested', requireAdmin, route(async () => {
        const [rows] = await pool.query(
            `SELECT ${core.LIST_COLUMNS}, p.likes, p.dislikes, p.suggested_at
             FROM bank_pool p JOIN bank_items i ON i.id = p.item_id
             WHERE i.status = 'pool' AND p.suggested_at IS NOT NULL AND p.dismissed_at IS NULL
             ORDER BY p.suggested_at, p.item_id LIMIT ?`, [SUGGESTIONS_MAX]);
        if (!rows.length) return { items: [] };
        const [fans] = await pool.query(
            `SELECT v.item_id, u.username FROM bank_pool_votes v LEFT JOIN users u ON u.id = v.user_id
             WHERE v.vote = 1 AND v.item_id IN (?) ORDER BY v.created_at`, [rows.map(row => row.id)]);
        const fansOf = new Map();
        for (const fan of fans) {
            if (!fansOf.has(fan.item_id)) fansOf.set(fan.item_id, []);
            fansOf.get(fan.item_id).push(fan.username);
        }
        return {
            items: rows.map(row => ({
                ...core.listItem(row), likes: row.likes, dislikes: row.dislikes, suggestedAt: row.suggested_at, fans: fansOf.get(row.id) || []
            }))
        };
    }));

    // An admin sorts a task into the bank: it needs a full classification, like anything sent there
    router.post('/bank/pool/:id/publish', requireAdmin, route(req => {
        const classified = fullClassification(req.body);
        if (!classified) throw new BankError('Choose the topic, grade and difficulty');
        return inTransaction(pool, async conn => {
            const row = await unsorted(conn, req.params.id);
            await conn.query("UPDATE bank_items SET subject_id = ?, grade_id = ?, topic_id = ?, difficulty_id = ?, status = 'published' WHERE id = ?",
                [classified.subjectId, classified.gradeId, classified.topicId, classified.difficultyId, row.item_id]);
            await leavePool(conn, row.item_id);
            await recordHistory(conn, req.user, [{
                itemId: row.item_id, action: 'published', changes: taskChanges(snapshotOf(row), { status: 'published', ...classified })
            }]);
            return { id: row.item_id };
        });
    }));

    // Not now: it stays among the unsorted tasks and is not suggested again
    router.post('/bank/pool/:id/dismiss', requireAdmin, route(req => inTransaction(pool, async conn => {
        const row = await unsorted(conn, req.params.id);
        await conn.query('UPDATE bank_pool SET dismissed_at = NOW() WHERE item_id = ?', [row.item_id]);
        await recordHistory(conn, req.user, [{ itemId: row.item_id, action: 'pool_dismissed' }]);
        return { id: row.item_id };
    })));

    router.delete('/bank/pool/:id', requireAdmin, route(req => inTransaction(pool, async conn => {
        const row = await unsorted(conn, req.params.id);
        await conn.query("UPDATE bank_items SET status = 'archived' WHERE id = ?", [row.item_id]);
        await recordHistory(conn, req.user, [{ itemId: row.item_id, action: 'pool_removed', changes: { status: ['pool', 'archived'] } }]);
        return { id: row.item_id };
    })));
}

module.exports = { addToPool, leavePool, poolDecision, poolRoutes, feedPosition };
