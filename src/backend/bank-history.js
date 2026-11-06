const core = require('./bank-core.js');

// The shared bank's log: every task added, changed, sent, decided or taken out, with who did it and
// what each field was before and after. Teachers' own banks are private and are not logged. Rows
// have no foreign keys: the log outlives accounts, and it would outlive a task too.

const ACTIONS = [
    'created', 'edited', 'classified', 'archived', 'restored', 'published', 'submitted', 'approved', 'rejected',
    'reverted', 'merged', 'pool_added', 'pool_removed', 'pool_suggested', 'pool_dismissed'
];
// Entries that can be undone by putting the old values back. A task taken out comes back by restoring
// it, and a merge cannot be undone this way: the merged topic is gone.
const REVERTIBLE = ['edited', 'classified', 'reverted'];
const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;
const INSERT_CHUNK = 2000;
const MAX_NAME = 50;   // the columns of bank_item_history
const MAX_NOTE = 500;

// The columns of a task that are logged, under the names the rest of the code uses
const FIELDS = ['kind', 'status', 'subjectId', 'gradeId', 'topicId', 'difficultyId', 'source'];

// The order of an object's keys means nothing (a stored task can come back with them reordered), but
// spacing does: a new line in a question is a change, unlike for the duplicate check
const sortKeys = (key, value) => (value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : value);
const same = (a, b) => JSON.stringify(a ?? null, sortKeys) === JSON.stringify(b ?? null, sortKeys);
const sortedIds = list => [...(list || [])].map(Number).sort((a, b) => a - b);

/** A task's row in the fields taskChanges compares. */
function snapshotOf(row) {
    return {
        kind: row.kind,
        status: row.status,
        subjectId: row.subject_id ?? null,
        gradeId: row.grade_id ?? null,
        topicId: row.topic_id ?? null,
        difficultyId: row.difficulty_id ?? null,
        source: row.source ?? null
    };
}

/**
 * What differs between two states of a task, as { field: [before, after] }; the question's own parts
 * are under `content` the same way, one entry per key of the question. Keeping both sides means an
 * entry can be shown as a diff and undone without any other row. Empty when nothing changed.
 */
function taskChanges(before, after) {
    const changes = {};
    for (const field of FIELDS) {
        if (after[field] !== undefined && !same(before[field], after[field])) changes[field] = [before[field] ?? null, after[field] ?? null];
    }
    if (after.values !== undefined && !same(sortedIds(before.values), sortedIds(after.values))) {
        changes.values = [sortedIds(before.values), sortedIds(after.values)];
    }
    if (after.content !== undefined) {
        const was = before.content || {};
        const now = after.content || {};
        const content = {};
        for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
            if (!same(was[key], now[key])) content[key] = [was[key] ?? null, now[key] ?? null];
        }
        if (Object.keys(content).length) changes.content = content;
    }
    return changes;
}

/** The word for what a set of changes did to a task. */
function actionOf(changes) {
    const status = changes.status?.[1];
    if (status === 'archived') return 'archived';
    if (changes.status && changes.status[0] === 'archived') return 'restored';
    if (status === 'published') return 'published';
    if (changes.content) return 'edited';
    return 'classified';
}

/** The fields and question parts an entry changed, put back to what they were. */
function reverseOf(changes) {
    const body = {};
    for (const field of FIELDS) if (changes[field]) body[field] = changes[field][0];
    if (changes.values) body.values = changes.values[0];
    return { body, content: changes.content || null };
}

/**
 * Writes log entries, inside the caller's transaction where there is one, so a change and its entry
 * stand or fall together. Each entry is { itemId, action, changes?, note? }.
 */
async function recordHistory(db, user, entries, { batchId = null } = {}) {
    const rows = entries.map(entry => [
        entry.itemId, entry.action, user?.id ?? null, user?.username?.slice(0, MAX_NAME) ?? null,
        entry.changes && Object.keys(entry.changes).length ? JSON.stringify(entry.changes) : null,
        entry.note?.slice(0, MAX_NOTE) ?? null, batchId
    ]);
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await db.query('INSERT INTO bank_item_history (item_id, action, user_id, username, changes, note, batch_id) VALUES ?', [rows.slice(i, i + INSERT_CHUNK)]);
    }
}

const parse = value => (typeof value === 'string' ? JSON.parse(value) : value);

function entryOf(row) {
    return {
        id: Number(row.id),
        itemId: row.item_id,
        action: row.action,
        userId: row.user_id,
        username: row.username,
        changes: row.changes ? parse(row.changes) : null,
        revertible: !!row.changes && REVERTIBLE.includes(row.action),
        note: row.note,
        batchId: row.batch_id,
        createdAt: row.created_at,
        preview: row.preview ?? null,
        status: row.status ?? null
    };
}

/**
 * A page of the log, newest first: everything, or filtered by task, user or action, or by the words
 * of a task. `before` is the last entry's ID of the page before, so a deep page costs what the first does.
 */
async function listHistory(db, params = {}) {
    const limit = core.clampInt(params.limit, 1, PAGE_MAX, PAGE_DEFAULT);
    const where = [];
    const args = [];
    const add = (clause, ...values) => {
        where.push(clause);
        args.push(...values);
    };
    const item = core.toId(params.item);
    if (item) add('h.item_id = ?', item);
    const user = core.toId(params.user);
    if (user) add('h.user_id = ?', user);
    if (ACTIONS.includes(params.action)) add('h.action = ?', params.action);
    const before = core.toId(params.before);
    if (before) add('h.id < ?', before);
    const search = [];
    const words = [];
    core.addSearch((clause, ...values) => {
        search.push(clause);
        words.push(...values);
    }, params.q);
    if (search.length) add(`h.item_id IN (SELECT i.id FROM bank_items i WHERE ${search.join(' AND ')})`, ...words);
    const [rows] = await db.query(
        `SELECT h.id, h.item_id, h.action, h.user_id, h.username, h.changes, h.note, h.batch_id, h.created_at, i.preview, i.status
         FROM bank_item_history h LEFT JOIN bank_items i ON i.id = h.item_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY h.id DESC LIMIT ?`,
        [...args, limit + 1]);
    const more = rows.length > limit;
    if (more) rows.length = limit;
    return { entries: rows.map(entryOf), nextBefore: more ? Number(rows[rows.length - 1].id) : null };
}

module.exports = { ACTIONS, REVERTIBLE, snapshotOf, taskChanges, actionOf, reverseOf, recordHistory, listHistory };
