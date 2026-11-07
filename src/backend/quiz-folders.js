// The admin's quiz browser: folders inside folders, so finding a quiz means opening one folder or
// asking the server to search, never loading every quiz.
//
// Every folder is a row in quiz_folders. A few keep themselves up to date (system_key set): one
// per teacher, and one per premade subject. A quiz with no row in quiz_folder_items sits in its
// automatic folder, so nothing needs filing by hand; an admin can file it elsewhere, in folders
// of their own at any depth. Deleting a folder never deletes a quiz.
const express = require('express');

const MAX_DEPTH = 12;
const MAX_NAME = 80;
const PAGE_SIZE = 50;
const MAX_MOVE = 200;
const QUIZ_ID_RE = /^[A-Za-z0-9_-]{1,50}$/;
const NOT_EXPIRED = '(q.expires_at IS NULL OR q.expires_at > NOW())';

const SYSTEM_FOLDERS = [
    { key: 'teachers', name: 'Teachers', parent: null },
    { key: 'system', name: 'System quizzes', parent: null },
    { key: 'system-math', name: 'Math', parent: 'system' },
    { key: 'system-cs', name: 'Computer science', parent: 'system' },
    { key: 'system-lang', name: 'Languages and trivia', parent: 'system' },
];

const teacherKey = (ownerId) => `teacher-${ownerId}`;

/** Which subject a premade quiz belongs to: its category, or else a hint in its ID */
function premadeSubject(id, category) {
    const cat = String(category || '').toLowerCase();
    const key = String(id || '').toLowerCase();
    if (cat === 'cs' || /\b(cs|sql|python|javascript|js|html|git|algo)\b/.test(key)) return 'cs';
    if (cat === 'lang' || /\b(lang|trivia|geo|hist|eng|kalb|lit)\b/.test(key)) return 'lang';
    return 'math';
}

/** A folder name as it is stored, or null when nothing usable is left */
function cleanFolderName(value) {
    const name = [...String(value ?? '')].filter(ch => ch >= ' ' && ch !== '\u007f' && ch !== '<' && ch !== '>')
        .join('').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    return name || null;
}

const byId = (folders) => new Map(folders.map(folder => [folder.id, folder]));

/** The folders from the top down to `folderId`; broken links end the walk instead of looping */
function folderPath(folders, folderId) {
    const index = byId(folders);
    const path = [];
    const seen = new Set();
    for (let folder = index.get(folderId); folder && !seen.has(folder.id); folder = index.get(folder.parent_id)) {
        seen.add(folder.id);
        path.unshift(folder);
    }
    return path;
}

/** `direct` maps a folder to the quizzes filed right in it; this adds every folder below */
function totalCounts(folders, direct) {
    const totals = new Map(folders.map(folder => [folder.id, 0]));
    for (const folder of folders) {
        const count = direct.get(folder.id) || 0;
        if (count) folderPath(folders, folder.id).forEach(up => totals.set(up.id, totals.get(up.id) + count));
    }
    return totals;
}

function isInside(folders, folderId, ancestorId) {
    return folderPath(folders, folderId).some(folder => folder.id === ancestorId);
}

/** How many levels the folder and everything below it take up */
function heightOf(folders, folderId) {
    const below = folders.filter(folder => folder.parent_id === folderId);
    return 1 + Math.max(0, ...below.map(folder => heightOf(folders, folder.id)));
}

/** Why a folder can't go under `parentId`, or null if it can */
function moveProblem(folders, folderId, parentId) {
    if (parentId === null) return null;
    if (!byId(folders).has(parentId)) return 'parent_missing';
    if (isInside(folders, parentId, folderId)) return 'cycle';
    if (folderPath(folders, parentId).length + heightOf(folders, folderId) > MAX_DEPTH) return 'too_deep';
    return null;
}

/** What a folder shows inside its parent; automatic folders with nothing in or under them stay out of the way */
function visibleChildren(folders, parentId, totals) {
    const rank = (folder) => (folder.system_key === 'teachers' ? 0 : folder.system_key === 'system' ? 1 : 2);
    const hasFolders = (folder) => folders.some(child => child.parent_id === folder.id);
    return folders
        .filter(folder => (folder.parent_id ?? null) === parentId)
        .filter(folder => !folder.system_key || !folder.parent_id || (totals.get(folder.id) || 0) > 0 || hasFolders(folder))
        .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'lt'));
}

const likeTerm = (text) => `%${String(text).replace(/[\\%_]/g, '\\$&')}%`;

async function ensureQuizFolderSchema(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS quiz_folders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            parent_id INT NULL,
            name VARCHAR(${MAX_NAME}) NOT NULL,
            system_key VARCHAR(40) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_quiz_folder_system (system_key),
            KEY idx_quiz_folder_parent (parent_id)
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS quiz_folder_items (
            quiz_id VARCHAR(50) PRIMARY KEY,
            folder_id INT NOT NULL,
            KEY idx_quiz_folder_item (folder_id)
        )
    `);
    for (const folder of SYSTEM_FOLDERS) {
        const [[parent]] = folder.parent
            ? await pool.query('SELECT id FROM quiz_folders WHERE system_key = ?', [folder.parent])
            : [[null]];
        await pool.query(
            'INSERT IGNORE INTO quiz_folders (parent_id, name, system_key) VALUES (?, ?, ?)',
            [parent?.id ?? null, folder.name, folder.key]
        );
    }
}

/** Deleted quizzes leave their folders. Only filing, so it never stops a quiz from being deleted. */
async function forgetQuizFolders(db, quizIds) {
    await db.query('DELETE FROM quiz_folder_items WHERE quiz_id IN (?)', [quizIds])
        .catch(error => console.error('[QUIZ FOLDERS] forget:', error.code || error.message));
}

/**
 * Everything the browser needs to know about the folders: the folders themselves (a teacher's
 * appears with their first quiz, and follows their name), where unfiled quizzes belong, and how
 * many quizzes each folder holds. Reads no quiz content apart from premade quizzes' category.
 */
async function loadFolders(pool) {
    const [teachers] = await pool.query(`
        SELECT q.owner_id, i.folder_id, COUNT(*) AS n, MAX(u.username) AS username
        FROM quizzes q
        LEFT JOIN users u ON u.id = q.owner_id
        LEFT JOIN quiz_folder_items i ON i.quiz_id = q.id
        WHERE q.owner_id IS NOT NULL AND ${NOT_EXPIRED}
        GROUP BY q.owner_id, i.folder_id
    `);
    const [premade] = await pool.query(`
        SELECT q.id, JSON_UNQUOTE(JSON_EXTRACT(q.quiz_data, '$.category')) AS category, i.folder_id
        FROM quizzes q
        LEFT JOIN quiz_folder_items i ON i.quiz_id = q.id
        WHERE q.owner_id IS NULL AND ${NOT_EXPIRED}
    `);
    let [folders] = await pool.query('SELECT id, parent_id, name, system_key FROM quiz_folders');
    const keyed = new Map(folders.filter(folder => folder.system_key).map(folder => [folder.system_key, folder]));

    let added = false;
    for (const row of teachers) {
        const key = teacherKey(row.owner_id);
        const name = cleanFolderName(row.username) || `#${row.owner_id}`;
        if (keyed.get(key)?.name === name) continue;
        await pool.query(
            'INSERT INTO quiz_folders (parent_id, name, system_key) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
            [keyed.get('teachers').id, name, key]
        );
        added = true;
    }
    if (added) {
        [folders] = await pool.query('SELECT id, parent_id, name, system_key FROM quiz_folders');
        keyed.clear();
        folders.filter(folder => folder.system_key).forEach(folder => keyed.set(folder.system_key, folder));
    }

    const known = new Set(folders.map(folder => folder.id));
    const direct = new Map();
    const count = (folderId, n) => direct.set(folderId, (direct.get(folderId) || 0) + n);
    const place = (filedIn, automatic) => (known.has(filedIn) ? filedIn : automatic);
    for (const row of teachers) count(place(row.folder_id, keyed.get(teacherKey(row.owner_id))?.id), Number(row.n));

    // The premade quizzes of each subject that haven't been filed elsewhere
    const unfiled = new Map();
    const homeOf = new Map();
    for (const row of premade) {
        const key = `system-${premadeSubject(row.id, row.category)}`;
        const home = keyed.get(key).id;
        homeOf.set(row.id, home);
        if (known.has(row.folder_id)) {
            count(row.folder_id, 1);
        } else {
            count(home, 1);
            if (!unfiled.has(home)) unfiled.set(home, []);
            unfiled.get(home).push(row.id);
        }
    }
    return { folders, keyed, known, unfiled, homeOf, totals: totalCounts(folders, direct) };
}

const treeRow = (folder) => ({ id: folder.id, parentId: folder.parent_id ?? null, name: folder.name, system: folder.system_key || null });

const QUIZ_COLUMNS = `
    q.id, q.title, q.visibility, q.featured, q.featured_order, q.expires_at, q.created_at, q.updated_at, q.owner_id,
    u.username AS author, i.folder_id,
    JSON_LENGTH(JSON_EXTRACT(q.quiz_data, '$.questions')) AS question_count
`;
const QUIZ_FROM = `
    FROM quizzes q
    LEFT JOIN users u ON u.id = q.owner_id
    LEFT JOIN quiz_folder_items i ON i.quiz_id = q.id
`;

async function withAttempts(pool, rows, attemptsReady) {
    if (attemptsReady() && rows.length) {
        const [counts] = await pool.query(
            'SELECT quiz_id, COUNT(*) AS attempts FROM quiz_attempts WHERE quiz_id IN (?) GROUP BY quiz_id',
            [rows.map(quiz => quiz.id)]
        );
        const byQuiz = new Map(counts.map(row => [row.quiz_id, Number(row.attempts)]));
        rows.forEach(quiz => { quiz.attempts = byQuiz.get(quiz.id) || 0; });
    }
    return rows.map(quiz => ({ ...quiz, featured: Boolean(quiz.featured), question_count: Number(quiz.question_count || 0) }));
}

/** The SQL that picks one folder's quizzes: those filed there, and unfiled ones that belong there */
function folderCondition(folder, state) {
    const parts = ['i.folder_id = ?'];
    const values = [folder.id];
    const teacher = /^teacher-(\d+)$/.exec(folder.system_key || '');
    const missing = 'i.folder_id IS NULL OR i.folder_id NOT IN (?)';
    const allFolders = [...state.known];
    if (teacher) {
        parts.push(`(q.owner_id = ? AND (${missing}))`);
        values.push(Number(teacher[1]), allFolders);
    } else if (state.unfiled.get(folder.id)?.length) {
        parts.push('q.id IN (?)');
        values.push(state.unfiled.get(folder.id));
    }
    return { sql: `(${parts.join(' OR ')})`, values };
}

function filterCondition(filter, userId) {
    if (filter === 'featured') return { sql: 'q.featured = 1', values: [] };
    if (filter === 'public') return { sql: "q.visibility = 'public'", values: [] };
    if (filter === 'private') return { sql: "q.visibility <> 'public'", values: [] };
    if (filter === 'mine') return { sql: 'q.owner_id = ?', values: [userId] };
    return null;
}

function createQuizFolderRouter(pool, { attemptsReady, guards }) {
    const router = express.Router();
    const fail = (res, label, error) => {
        console.error(`[QUIZ FOLDERS] ${label}`, error);
        res.status(500).json({ error: 'Internal server error' });
    };

    router.get('/quiz-browser', guards, async (req, res) => {
        try {
            const state = await loadFolders(pool);
            const { folders, totals } = state;
            const q = String(req.query.q || '').trim().slice(0, 100);
            const filter = filterCondition(String(req.query.filter || ''), req.user.id);
            const searching = Boolean(q || filter);
            const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
            const folderId = Number.parseInt(req.query.folder, 10) || null;
            const folder = folders.find(row => row.id === folderId) || null;

            const where = [NOT_EXPIRED];
            const values = [];
            if (searching) {
                if (filter) { where.push(filter.sql); values.push(...filter.values); }
                if (q) {
                    where.push('(q.title LIKE ? OR q.id LIKE ? OR u.username LIKE ? OR u.email LIKE ?)');
                    values.push(...Array(4).fill(likeTerm(q)));
                }
            } else if (folder) {
                const condition = folderCondition(folder, state);
                where.push(condition.sql);
                values.push(...condition.values);
            } else {
                where.push('1 = 0'); // the top level holds folders only
            }

            const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${QUIZ_FROM} WHERE ${where.join(' AND ')}`, values);
            const [rows] = await pool.query(`
                SELECT ${QUIZ_COLUMNS} ${QUIZ_FROM}
                WHERE ${where.join(' AND ')}
                ORDER BY q.featured DESC, q.updated_at DESC
                LIMIT ? OFFSET ?
            `, [...values, PAGE_SIZE, offset]);

            const [[counts]] = await pool.query(`
                SELECT COUNT(*) AS \`all\`,
                       COALESCE(SUM(q.featured = 1), 0) AS featured,
                       COALESCE(SUM(q.visibility = 'public'), 0) AS public_count,
                       COALESCE(SUM(q.visibility <> 'public'), 0) AS private_count,
                       COALESCE(SUM(q.owner_id = ?), 0) AS mine
                FROM quizzes q WHERE ${NOT_EXPIRED}
            `, [req.user.id]);

            // Search results come from all over, so each says which folder it is in
            const whereIs = (quiz) => {
                if (!searching) return undefined;
                const filed = state.known.has(quiz.folder_id) ? quiz.folder_id : null;
                const place = filed ?? (quiz.owner_id ? state.keyed.get(teacherKey(quiz.owner_id))?.id : state.homeOf.get(quiz.id));
                return folderPath(folders, place).map(treeRow);
            };
            const quizzes = (await withAttempts(pool, rows, attemptsReady)).map(quiz => ({ ...quiz, path: whereIs(quiz) }));

            res.json({
                folder: folder ? treeRow(folder) : null,
                path: folder ? folderPath(folders, folder.id).map(treeRow) : [],
                folders: searching ? [] : visibleChildren(folders, folder?.id ?? null, totals).map(row => ({
                    ...treeRow(row),
                    count: totals.get(row.id) || 0,
                    subfolders: visibleChildren(folders, row.id, totals).length,
                })),
                quizzes,
                total: Number(total),
                pageSize: PAGE_SIZE,
                counts: {
                    all: Number(counts.all),
                    featured: Number(counts.featured),
                    public: Number(counts.public_count),
                    private: Number(counts.private_count),
                    mine: Number(counts.mine),
                },
                tree: folders.map(treeRow),
            });
        } catch (error) {
            fail(res, 'browse', error);
        }
    });

    router.post('/quiz-lookup', guards, async (req, res) => {
        try {
            const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
                .map(id => String(id).trim()).filter(id => QUIZ_ID_RE.test(id)).slice(0, 200);
            if (!ids.length) return res.json({ quizzes: [] });
            const [rows] = await pool.query(`SELECT ${QUIZ_COLUMNS} ${QUIZ_FROM} WHERE q.id IN (?) AND ${NOT_EXPIRED}`, [ids]);
            res.json({ quizzes: await withAttempts(pool, rows, attemptsReady) });
        } catch (error) {
            fail(res, 'lookup', error);
        }
    });

    router.post('/quiz-folders', guards, async (req, res) => {
        try {
            const name = cleanFolderName(req.body?.name);
            if (!name) return res.status(400).json({ error: 'Folder name is required', code: 'name_required' });
            const parentId = req.body?.parentId == null ? null : Number(req.body.parentId);
            const [folders] = await pool.query('SELECT id, parent_id, name, system_key FROM quiz_folders');
            if (parentId !== null && !folders.some(folder => folder.id === parentId)) {
                return res.status(400).json({ error: 'Parent folder not found', code: 'parent_missing' });
            }
            if (parentId !== null && folderPath(folders, parentId).length >= MAX_DEPTH) {
                return res.status(400).json({ error: 'Folders are nested too deep', code: 'too_deep' });
            }
            if (folders.some(folder => (folder.parent_id ?? null) === parentId && folder.name.toLowerCase() === name.toLowerCase())) {
                return res.status(409).json({ error: 'A folder with this name already exists here', code: 'name_taken' });
            }
            const [result] = await pool.query('INSERT INTO quiz_folders (parent_id, name) VALUES (?, ?)', [parentId, name]);
            res.status(201).json({ id: result.insertId, parentId, name, system: null });
        } catch (error) {
            fail(res, 'create', error);
        }
    });

    router.patch('/quiz-folders/:id', guards, async (req, res) => {
        try {
            const id = Number(req.params.id);
            const [folders] = await pool.query('SELECT id, parent_id, name, system_key FROM quiz_folders');
            const folder = folders.find(row => row.id === id);
            if (!folder) return res.status(404).json({ error: 'Folder not found' });
            if (folder.system_key) return res.status(400).json({ error: 'This folder is kept up to date automatically', code: 'automatic' });

            const name = req.body?.name === undefined ? folder.name : cleanFolderName(req.body.name);
            if (!name) return res.status(400).json({ error: 'Folder name is required', code: 'name_required' });
            const parentId = req.body?.parentId === undefined ? folder.parent_id ?? null
                : req.body.parentId === null ? null : Number(req.body.parentId);
            const problem = parentId === (folder.parent_id ?? null) ? null : moveProblem(folders, id, parentId);
            if (problem) return res.status(400).json({ error: 'The folder cannot be moved there', code: problem });
            const taken = folders.some(row => row.id !== id && (row.parent_id ?? null) === parentId && row.name.toLowerCase() === name.toLowerCase());
            if (taken) return res.status(409).json({ error: 'A folder with this name already exists here', code: 'name_taken' });

            await pool.query('UPDATE quiz_folders SET name = ?, parent_id = ? WHERE id = ?', [name, parentId, id]);
            res.json({ id, parentId, name, system: null });
        } catch (error) {
            fail(res, 'update', error);
        }
    });

    // What was inside moves up a level; at the top, quizzes go back to their automatic folders
    router.delete('/quiz-folders/:id', guards, async (req, res) => {
        try {
            const id = Number(req.params.id);
            const [[folder]] = await pool.query('SELECT id, parent_id, system_key FROM quiz_folders WHERE id = ?', [id]);
            if (!folder) return res.status(404).json({ error: 'Folder not found' });
            if (folder.system_key) return res.status(400).json({ error: 'This folder is kept up to date automatically', code: 'automatic' });
            await pool.query('UPDATE quiz_folders SET parent_id = ? WHERE parent_id = ?', [folder.parent_id, id]);
            if (folder.parent_id === null) await pool.query('DELETE FROM quiz_folder_items WHERE folder_id = ?', [id]);
            else await pool.query('UPDATE quiz_folder_items SET folder_id = ? WHERE folder_id = ?', [folder.parent_id, id]);
            await pool.query('DELETE FROM quiz_folders WHERE id = ?', [id]);
            res.json({ ok: true });
        } catch (error) {
            fail(res, 'delete', error);
        }
    });

    router.put('/quiz-folders/items', guards, async (req, res) => {
        try {
            const quizIds = (Array.isArray(req.body?.quizIds) ? req.body.quizIds : []).map(String).filter(id => QUIZ_ID_RE.test(id));
            if (!quizIds.length || quizIds.length > MAX_MOVE) return res.status(400).json({ error: 'Invalid quiz list' });
            const folderId = req.body?.folderId == null ? null : Number(req.body.folderId);
            if (folderId === null) {
                await pool.query('DELETE FROM quiz_folder_items WHERE quiz_id IN (?)', [quizIds]);
                return res.json({ ok: true });
            }
            const [[folder]] = await pool.query('SELECT id FROM quiz_folders WHERE id = ?', [folderId]);
            if (!folder) return res.status(404).json({ error: 'Folder not found' });
            await pool.query(
                'INSERT INTO quiz_folder_items (quiz_id, folder_id) VALUES ? ON DUPLICATE KEY UPDATE folder_id = VALUES(folder_id)',
                [quizIds.map(id => [id, folderId])]
            );
            res.json({ ok: true });
        } catch (error) {
            fail(res, 'move', error);
        }
    });

    return router;
}

module.exports = {
    MAX_DEPTH,
    premadeSubject,
    cleanFolderName,
    folderPath,
    totalCounts,
    moveProblem,
    visibleChildren,
    ensureQuizFolderSchema,
    forgetQuizFolders,
    createQuizFolderRouter,
};
