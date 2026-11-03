const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const core = require('./bank-core.js');

const { QTYPES, KINDS, STATUSES, toId, idList } = core;

// Task bank (užduočių bankas): tasks and templates sorted by subject, grade, a topic tree that
// follows the curriculum, difficulty (achievement level) and any further classifiers. Teachers
// browse it in the editor and drop tasks into a quiz, where each becomes an ordinary copy of the
// question. The tables are created on startup like quiz_attempts; nothing existing is altered.

const SEED_FILE = path.join(__dirname, '..', '..', 'data', 'bank-seed.json');
// Until the bank has content only admins see it; BANK_OPEN=1 opens it to every teacher
const BANK_OPEN = process.env.BANK_OPEN === '1';
const META_TTL_MS = 5 * 60 * 1000; // another server process picks up classifier edits within this
const MAX_BATCH = 500;
const MAX_BULK = 100000;
const BULK_CHUNK = 5000;
const MAX_FETCH = 200;
const MAX_SAMPLE = 50;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_CONTENT_BYTES = 1024 * 1024; // the question JSON once its pictures are in bank_media
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MEDIA_URL_RE = /^\/api\/media\/[0-9a-f]{64}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

// --- SCHEMA ---
const TABLE_OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS bank_subjects (
        id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        icon VARCHAR(16) NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        archived TINYINT(1) NOT NULL DEFAULT 0
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS bank_grades (
        id TINYINT UNSIGNED PRIMARY KEY,
        label VARCHAR(40) NOT NULL
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS bank_difficulties (
        id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(40) NOT NULL,
        color CHAR(7) NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0
    ) ${TABLE_OPTIONS}`,
    // parent_id NULL is a content area (turinio sritis); the depth is unlimited
    `CREATE TABLE IF NOT EXISTS bank_topics (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        subject_id SMALLINT UNSIGNED NOT NULL,
        parent_id INT UNSIGNED NULL,
        name VARCHAR(160) NOT NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        archived TINYINT(1) NOT NULL DEFAULT 0,
        INDEX bank_topics_tree (subject_id, parent_id, sort_order)
    ) ${TABLE_OPTIONS}`,
    // The curriculum: in which grades a topic is taught, with the yearly plan's hours
    `CREATE TABLE IF NOT EXISTS bank_topic_grades (
        grade_id TINYINT UNSIGNED NOT NULL,
        topic_id INT UNSIGNED NOT NULL,
        hours SMALLINT NULL,
        PRIMARY KEY (grade_id, topic_id),
        INDEX bank_topic_grades_topic (topic_id)
    ) ${TABLE_OPTIONS}`,
    // Further classifiers (context, achievement, competence, tags…) need no schema change
    `CREATE TABLE IF NOT EXISTS bank_dimensions (
        id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        subject_id SMALLINT UNSIGNED NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS bank_values (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        dimension_id SMALLINT UNSIGNED NOT NULL,
        parent_id INT UNSIGNED NULL,
        name VARCHAR(160) NOT NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        INDEX bank_values_dimension (dimension_id, sort_order)
    ) ${TABLE_OPTIONS}`,
    // Narrow on purpose: listings read only these columns, the question itself is in bank_item_content.
    // owner_id 0 is the shared bank, any other value a teacher's own tasks.
    `CREATE TABLE IF NOT EXISTS bank_items (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        owner_id INT UNSIGNED NOT NULL DEFAULT 0,
        kind ENUM('problem', 'template') NOT NULL DEFAULT 'problem',
        qtype VARCHAR(20) NOT NULL,
        subject_id SMALLINT UNSIGNED NULL,
        grade_id TINYINT UNSIGNED NULL,
        topic_id INT UNSIGNED NULL,
        difficulty_id TINYINT UNSIGNED NULL,
        status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'published',
        preview VARCHAR(300) NOT NULL,
        search_text TEXT NOT NULL,
        has_image TINYINT(1) NOT NULL DEFAULT 0,
        content_hash CHAR(40) NOT NULL,
        uses INT UNSIGNED NOT NULL DEFAULT 0,
        source VARCHAR(160) NULL,
        created_by INT UNSIGNED NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY bank_items_dedupe (owner_id, content_hash),
        INDEX bank_items_topic (owner_id, status, subject_id, grade_id, topic_id, id),
        INDEX bank_items_level (owner_id, status, subject_id, grade_id, difficulty_id, id),
        INDEX bank_items_popular (owner_id, status, subject_id, grade_id, uses, id),
        INDEX bank_items_unsorted (owner_id, status, topic_id, subject_id, difficulty_id),
        FULLTEXT INDEX bank_items_search (search_text)
    ) ${TABLE_OPTIONS}`,
    // The question in the editor's own format (quiz_data.questions[i]); templates add "template"
    `CREATE TABLE IF NOT EXISTS bank_item_content (
        item_id INT UNSIGNED PRIMARY KEY,
        content JSON NOT NULL
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS bank_item_values (
        value_id INT UNSIGNED NOT NULL,
        item_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (value_id, item_id),
        INDEX bank_item_values_item (item_id)
    ) ${TABLE_OPTIONS}`,
    // Pictures by content hash: stored once however many tasks use them, served at /api/media/<sha256>
    `CREATE TABLE IF NOT EXISTS bank_media (
        sha256 CHAR(64) PRIMARY KEY,
        mime VARCHAR(40) NOT NULL,
        bytes INT UNSIGNED NOT NULL,
        data MEDIUMBLOB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ${TABLE_OPTIONS}`
];

class BankError extends Error {
    constructor(message, status = 400, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}

async function inTransaction(pool, work) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await work(conn);
        await conn.commit();
        return result;
    } catch (error) {
        await conn.rollback().catch(() => {});
        throw error;
    } finally {
        conn.release();
    }
}

// --- SEED ---
// Grades, achievement levels, subjects, the maths curriculum for grades 5–10 (updated 2022
// general programme) and the classifiers it names. Each table is seeded only while empty, so edits
// made by admins survive restarts.
async function seedBank(pool) {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    const isEmpty = async table => {
        const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM ${table}`);
        return Number(row.n) === 0;
    };
    if (await isEmpty('bank_grades')) {
        await pool.query('INSERT INTO bank_grades (id, label) VALUES ?', [seed.grades]);
    }
    if (await isEmpty('bank_difficulties')) {
        await pool.query('INSERT INTO bank_difficulties (name, color, sort_order) VALUES ?',
            [seed.difficulties.map((d, i) => [d.name, d.color, i])]);
    }
    if (await isEmpty('bank_subjects')) {
        await pool.query('INSERT INTO bank_subjects (name, icon, sort_order) VALUES ?',
            [seed.subjects.map((s, i) => [s.name, s.icon, i])]);
    }
    const [subjects] = await pool.query('SELECT id, name FROM bank_subjects');
    const subjectId = name => subjects.find(s => s.name === name)?.id ?? null;
    if (await isEmpty('bank_topics')) {
        await inTransaction(pool, async conn => {
            for (const [subject, nodes] of Object.entries(seed.topics)) {
                const id = subjectId(subject);
                if (id) await insertTopics(conn, id, null, nodes);
            }
        });
    }
    if (await isEmpty('bank_dimensions')) {
        await inTransaction(pool, async conn => {
            for (const [index, dimension] of seed.dimensions.entries()) {
                const [result] = await conn.query('INSERT INTO bank_dimensions (name, subject_id, sort_order) VALUES (?, ?, ?)',
                    [dimension.name, dimension.subject ? subjectId(dimension.subject) : null, index]);
                await insertValues(conn, result.insertId, null, dimension.values);
            }
        });
    }
}

async function insertTopics(conn, subjectId, parentId, nodes) {
    for (const [index, node] of nodes.entries()) {
        const [result] = await conn.query('INSERT INTO bank_topics (subject_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?)',
            [subjectId, parentId, node.name, index]);
        const grades = Object.entries(node.grades || {});
        if (grades.length) {
            await conn.query('INSERT INTO bank_topic_grades (grade_id, topic_id, hours) VALUES ?',
                [grades.map(([grade, hours]) => [Number(grade), result.insertId, hours])]);
        }
        if (node.children) await insertTopics(conn, subjectId, result.insertId, node.children);
    }
}

async function insertValues(conn, dimensionId, parentId, nodes) {
    for (const [index, node] of nodes.entries()) {
        const [result] = await conn.query('INSERT INTO bank_values (dimension_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?)',
            [dimensionId, parentId, node.name, index]);
        if (node.children) await insertValues(conn, dimensionId, result.insertId, node.children);
    }
}

// --- CLASSIFIERS IN MEMORY ---
// A few hundred topics and values: the whole tree is kept here, so a topic's subtree filter is a
// plain `topic_id IN (…)` and the editor gets everything in one request.
const meta = {
    loadedAt: 0,
    loading: null,
    subjects: new Map(),
    grades: new Map(),
    difficulties: new Map(),
    topics: new Map(),
    dimensions: new Map(),
    values: new Map(),
    topicChildren: new Map(),
    valueChildren: new Map(),
    levelIds: [],
    adminData: null,
    teacherData: null
};

function childrenMap(rows) {
    const map = new Map();
    for (const row of rows) {
        if (row.parent_id == null) continue;
        if (!map.has(row.parent_id)) map.set(row.parent_id, []);
        map.get(row.parent_id).push(row.id);
    }
    return map;
}

/** The ID and all its descendants (cycle-safe, in case a tree was edited by hand). */
function subtree(children, id) {
    const seen = new Set([id]);
    const out = [id];
    for (let i = 0; i < out.length; i++) {
        for (const child of children.get(out[i]) || []) {
            if (!seen.has(child)) {
                seen.add(child);
                out.push(child);
            }
        }
    }
    return out;
}

function withVersion(data) {
    return { version: crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex').slice(0, 12), ...data };
}

async function loadMeta(pool) {
    const [subjects, grades, difficulties, topics, topicGrades, dimensions, values, counts] = (await Promise.all([
        pool.query('SELECT id, name, icon, sort_order, archived FROM bank_subjects ORDER BY sort_order, id'),
        pool.query('SELECT id, label FROM bank_grades ORDER BY id'),
        pool.query('SELECT id, name, color, sort_order FROM bank_difficulties ORDER BY sort_order, id'),
        pool.query('SELECT id, subject_id, parent_id, name, sort_order, archived FROM bank_topics ORDER BY sort_order, id'),
        pool.query('SELECT topic_id, grade_id, hours FROM bank_topic_grades ORDER BY grade_id'),
        pool.query('SELECT id, name, subject_id, sort_order FROM bank_dimensions ORDER BY sort_order, id'),
        pool.query('SELECT id, dimension_id, parent_id, name, sort_order FROM bank_values ORDER BY sort_order, id'),
        pool.query("SELECT subject_id, COUNT(*) AS n FROM bank_items WHERE owner_id = 0 AND status = 'published' GROUP BY subject_id")
    ])).map(([rows]) => rows);

    const gradesOf = new Map();
    for (const row of topicGrades) {
        if (!gradesOf.has(row.topic_id)) gradesOf.set(row.topic_id, []);
        gradesOf.get(row.topic_id).push([row.grade_id, row.hours]);
    }
    const itemCounts = new Map(counts.map(row => [row.subject_id, Number(row.n)]));
    const topicChildren = childrenMap(topics);

    // Teachers don't see archived subjects and topics, nor anything under an archived topic
    const hidden = new Set();
    for (const topic of topics) {
        if (topic.archived) subtree(topicChildren, topic.id).forEach(id => hidden.add(id));
    }
    const archivedSubjects = new Set(subjects.filter(s => s.archived).map(s => s.id));

    const subjectRows = subjects.map(s => ({ id: s.id, name: s.name, icon: s.icon, sortOrder: s.sort_order, archived: !!s.archived, items: itemCounts.get(s.id) || 0 }));
    const topicRows = topics.map(t => ({ id: t.id, subjectId: t.subject_id, parentId: t.parent_id, name: t.name, sortOrder: t.sort_order, archived: !!t.archived, grades: gradesOf.get(t.id) || [] }));
    const shared = {
        grades: grades.map(g => ({ id: g.id, label: g.label })),
        difficulties: difficulties.map(d => ({ id: d.id, name: d.name, color: d.color, sortOrder: d.sort_order })),
        dimensions: dimensions.map(d => ({
            id: d.id, name: d.name, subjectId: d.subject_id, sortOrder: d.sort_order,
            values: values.filter(v => v.dimension_id === d.id).map(v => ({ id: v.id, parentId: v.parent_id, name: v.name, sortOrder: v.sort_order }))
        }))
    };

    Object.assign(meta, {
        subjects: new Map(subjects.map(row => [row.id, row])),
        grades: new Map(grades.map(row => [row.id, row])),
        difficulties: new Map(difficulties.map(row => [row.id, row])),
        topics: new Map(topics.map(row => [row.id, row])),
        dimensions: new Map(dimensions.map(row => [row.id, row])),
        values: new Map(values.map(row => [row.id, row])),
        topicChildren,
        valueChildren: childrenMap(values),
        levelIds: difficulties.map(d => d.id),
        adminData: withVersion({ subjects: subjectRows, topics: topicRows, ...shared }),
        teacherData: withVersion({
            subjects: subjectRows.filter(s => !s.archived),
            topics: topicRows.filter(t => !hidden.has(t.id) && !archivedSubjects.has(t.subjectId)),
            ...shared
        }),
        loadedAt: Date.now()
    });
    return meta;
}

/** The classifiers, reloaded when older than META_TTL_MS; a failed reload keeps the old ones. */
async function freshMeta(pool) {
    if (Date.now() - meta.loadedAt > META_TTL_MS) {
        meta.loading ??= loadMeta(pool).finally(() => { meta.loading = null; });
        try {
            await meta.loading;
        } catch (error) {
            if (!meta.adminData) throw error;
            meta.loadedAt = Date.now();
            console.error('[BANK] could not reload the classifiers:', error.code || error.message);
        }
    }
    return meta;
}

/** After a classifier edit: wait out a reload that started before it, then load again. */
async function reloadMeta(pool) {
    if (meta.loading) await meta.loading.catch(() => {});
    meta.loadedAt = 0;
    await freshMeta(pool);
}

/** Chosen classifier values grouped by classifier, each value with its sub-values. */
function groupValues(ids) {
    const groups = new Map();
    for (const id of ids) {
        const value = meta.values.get(id);
        if (!value) continue;
        const group = groups.get(value.dimension_id) || new Set();
        subtree(meta.valueChildren, id).forEach(v => group.add(v));
        groups.set(value.dimension_id, group);
    }
    return [...groups.values()].map(group => [...group]);
}

/** What core.buildFilter needs to list one owner's tasks (0 = the shared bank). */
function contextFor(ownerId, status = 'published') {
    return { ownerId, status, levelIds: meta.levelIds, topicSubtree: id => subtree(meta.topicChildren, id), groupValues };
}

// What a user may do with the bank. Premium limits (template variants, whole-topic picks, the size
// of a private bank) belong here once the bank has content.
function bankLimits(user) {
    const admin = user.role === 'admin';
    return { read: admin || BANK_OPEN, writeShared: admin, writeMine: admin || BANK_OPEN };
}

function listContext(user, params) {
    const mine = params.scope === 'mine';
    // Drafts and the archive are listed for whoever may edit that bank
    const mayEdit = mine ? bankLimits(user).writeMine : bankLimits(user).writeShared;
    return contextFor(mine ? user.id : 0, mayEdit && STATUSES.includes(params.status) ? params.status : 'published');
}

/** One page of a listing; the first page also carries the total and the facet counts. */
async function listItems(pool, params, ctx) {
    const page = core.buildListQuery(params, ctx);
    if (!page) return null;
    const facetQueries = params.cursor ? [] : core.buildFacetQueries(params, ctx);
    const [[rows], ...facetResults] = await Promise.all([
        pool.query(page.sql, page.args),
        ...facetQueries.map(q => pool.query(q.sql, q.args))
    ]);
    const more = rows.length > page.limit;
    if (more) rows.length = page.limit;
    const result = { items: rows.map(core.listItem), nextCursor: more ? page.cursorOf(rows[rows.length - 1]) : null };
    if (facetQueries.length) {
        result.facets = {};
        facetQueries.forEach((query, i) => {
            const [facetRows] = facetResults[i];
            if (query.name === 'total') result.total = Number(facetRows[0].n);
            else result.facets[query.name] = Object.fromEntries(facetRows.map(row => [row.k ?? 'none', Number(row.n)]));
        });
    }
    return result;
}

function parseJson(value) {
    return typeof value === 'string' ? JSON.parse(value) : value;
}

// --- WRITING TASKS ---
function writeScope(user, rawScope) {
    const mine = rawScope === 'mine';
    const limits = bankLimits(user);
    if (mine ? !limits.writeMine : !limits.writeShared) throw new BankError('You may not change this bank', 403);
    return mine ? user.id : 0;
}

function mayEdit(user, ownerId) {
    if (user.role === 'admin') return true;
    return ownerId !== 0 && ownerId === user.id && bankLimits(user).writeMine;
}

/**
 * Validated column values of one task. Fields missing from `raw` come from `fallback` (the batch
 * defaults, or the stored task on an edit). A topic decides the subject; a new subject without a
 * topic drops a topic of the old subject.
 */
function prepareItem(raw, fallback) {
    if (!raw || typeof raw !== 'object') throw new BankError('Invalid task');
    const content = raw.content;
    if (!content || typeof content !== 'object' || Array.isArray(content) || !QTYPES.includes(content.type)) {
        throw new BankError('Unknown question type');
    }
    if (content.prompt != null && typeof content.prompt !== 'string') throw new BankError('Invalid question text');
    if (content.choices != null && !Array.isArray(content.choices)) throw new BankError('Invalid answer choices');
    const given = key => raw[key] !== undefined;
    const pick = key => (given(key) ? raw[key] : fallback[key]);
    const ref = (key, map, label) => {
        const value = pick(key);
        if (value == null || value === '') return null;
        const id = toId(value);
        if (!id || !map.has(id)) throw new BankError(`Unknown ${label}`);
        return id;
    };

    const kind = pick('kind') ?? (content.template ? 'template' : 'problem');
    if (!KINDS.includes(kind)) throw new BankError('Invalid kind');
    if (kind === 'template' && (!content.template || typeof content.template !== 'object')) {
        throw new BankError('A template needs its variables');
    }
    const status = pick('status') ?? 'published';
    if (!STATUSES.includes(status)) throw new BankError('Invalid status');

    let subjectId = ref('subjectId', meta.subjects, 'subject');
    let topicId = ref('topicId', meta.topics, 'topic');
    if (topicId) {
        const topicSubject = meta.topics.get(topicId).subject_id;
        if (subjectId !== topicSubject) {
            if (given('topicId') && given('subjectId') && subjectId !== null) throw new BankError('The topic belongs to another subject');
            if (given('topicId') || !given('subjectId')) subjectId = topicSubject;
            else topicId = null;
        }
    }
    const values = idList(pick('values') ?? [], 50);
    if (values.some(id => !meta.values.has(id))) throw new BankError('Unknown classifier value');
    const source = pick('source');

    // The bank keeps the question without its quiz-specific ID or a bank reference
    const question = JSON.parse(JSON.stringify(content));
    delete question.id;
    delete question.source;
    return {
        kind,
        status,
        subjectId,
        topicId,
        gradeId: ref('gradeId', meta.grades, 'grade'),
        difficultyId: ref('difficultyId', meta.difficulties, 'difficulty'),
        values,
        source: typeof source === 'string' && source.trim() ? source.trim().slice(0, 160) : null,
        content: question
    };
}

async function storeImage(conn, dataUrl) {
    const comma = dataUrl.indexOf(',');
    const header = /^data:(image\/[a-z+.-]+);base64$/.exec(comma > 0 ? dataUrl.slice(0, comma) : '');
    if (!header || !IMAGE_TYPES.has(header[1])) throw new BankError('Pictures must be PNG, JPEG, WebP or GIF');
    const data = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    if (!data.length || data.length > MAX_IMAGE_BYTES) throw new BankError('Picture too large');
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    await conn.query('INSERT IGNORE INTO bank_media (sha256, mime, bytes, data) VALUES (?, ?, ?, ?)', [sha, header[1], data.length, data]);
    return `/api/media/${sha}`;
}

/** Moves embedded pictures (data URLs) into bank_media and points the question at them. */
async function storeImages(conn, content) {
    for (const [holder, key] of core.imageSlots(content)) {
        const value = holder[key];
        if (typeof value !== 'string') throw new BankError('Invalid picture');
        if (!MEDIA_URL_RE.test(value)) holder[key] = await storeImage(conn, value);
    }
}

/** Pictures stored, then the derived columns: list preview, search text, duplicate fingerprint. */
async function derivedColumns(conn, content) {
    await storeImages(conn, content);
    const json = JSON.stringify(content);
    if (Buffer.byteLength(json, 'utf8') > MAX_CONTENT_BYTES) throw new BankError('Task too large');
    return {
        json,
        preview: core.previewText(content),
        search: core.searchText(content),
        hash: core.contentHash(content),
        hasImage: core.hasImage(content) ? 1 : 0
    };
}

async function findDuplicate(conn, ownerId, hash) {
    const [[row]] = await conn.query('SELECT id FROM bank_items WHERE owner_id = ? AND content_hash = ?', [ownerId, hash]);
    return row?.id ?? null;
}

/** Inserts one prepared task; one already in this bank is reported as a duplicate instead. */
async function insertItem(conn, ownerId, userId, item) {
    const d = await derivedColumns(conn, item.content);
    try {
        const [result] = await conn.query(
            `INSERT INTO bank_items (owner_id, kind, qtype, subject_id, grade_id, topic_id, difficulty_id, status,
                                     preview, search_text, has_image, content_hash, source, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ownerId, item.kind, item.content.type, item.subjectId, item.gradeId, item.topicId, item.difficultyId, item.status,
                d.preview, d.search, d.hasImage, d.hash, item.source, userId]
        );
        await conn.query('INSERT INTO bank_item_content (item_id, content) VALUES (?, ?)', [result.insertId, d.json]);
        if (item.values.length) {
            await conn.query('INSERT INTO bank_item_values (value_id, item_id) VALUES ?', [item.values.map(v => [v, result.insertId])]);
        }
        return { id: result.insertId };
    } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        return { id: await findDuplicate(conn, ownerId, d.hash), duplicate: true };
    }
}

async function createItems(pool, user, body) {
    const ownerId = writeScope(user, body.scope);
    const list = Array.isArray(body.items) ? body.items : [];
    if (!list.length || list.length > MAX_BATCH) throw new BankError(`Send 1–${MAX_BATCH} tasks at a time`);
    const defaults = body.defaults && typeof body.defaults === 'object' ? body.defaults : {};
    const results = new Array(list.length);
    const failed = (index, error) => {
        if (!(error instanceof BankError)) throw error;
        results[index] = { index, error: error.message };
    };
    const prepared = list.map((raw, index) => {
        try {
            return prepareItem(raw, defaults);
        } catch (error) {
            failed(index, error);
            return null;
        }
    });
    await inTransaction(pool, async conn => {
        for (const [index, item] of prepared.entries()) {
            if (!item) continue;
            try {
                results[index] = { index, ...(await insertItem(conn, ownerId, user.id, item)) };
            } catch (error) {
                failed(index, error);
            }
        }
    });
    const count = test => results.filter(test).length;
    return { results, created: count(r => r.id && !r.duplicate), duplicates: count(r => r.duplicate), failed: count(r => r.error) };
}

async function loadEditable(pool, user, rawId) {
    const id = toId(rawId);
    const [[row]] = id
        ? await pool.query('SELECT id, owner_id, kind, subject_id, grade_id, topic_id, difficulty_id, status, source FROM bank_items WHERE id = ?', [id])
        : [[]];
    if (!row || !mayEdit(user, row.owner_id)) throw new BankError('Task not found', 404);
    return row;
}

async function updateItem(pool, user, rawId, body) {
    const row = await loadEditable(pool, user, rawId);
    const [links] = await pool.query('SELECT value_id FROM bank_item_values WHERE item_id = ?', [row.id]);
    const item = prepareItem(body, {
        kind: row.kind, status: row.status, subjectId: row.subject_id, gradeId: row.grade_id, topicId: row.topic_id,
        difficultyId: row.difficulty_id, source: row.source, values: links.map(link => link.value_id)
    });
    await inTransaction(pool, async conn => {
        const d = await derivedColumns(conn, item.content);
        try {
            await conn.query(
                `UPDATE bank_items SET kind = ?, qtype = ?, subject_id = ?, grade_id = ?, topic_id = ?, difficulty_id = ?, status = ?,
                                       preview = ?, search_text = ?, has_image = ?, content_hash = ?, source = ?
                 WHERE id = ?`,
                [item.kind, item.content.type, item.subjectId, item.gradeId, item.topicId, item.difficultyId, item.status,
                    d.preview, d.search, d.hasImage, d.hash, item.source, row.id]
            );
        } catch (error) {
            if (error.code !== 'ER_DUP_ENTRY') throw error;
            throw new BankError('The same task is already in the bank', 409, { duplicateId: await findDuplicate(conn, row.owner_id, d.hash) });
        }
        await conn.query('UPDATE bank_item_content SET content = ? WHERE item_id = ?', [d.json, row.id]);
        await conn.query('DELETE FROM bank_item_values WHERE item_id = ?', [row.id]);
        if (item.values.length) {
            await conn.query('INSERT INTO bank_item_values (value_id, item_id) VALUES ?', [item.values.map(v => [v, row.id])]);
        }
    });
    return { id: row.id };
}

function chunks(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

/** The tasks a bulk change applies to: listed IDs, or everything a listing filter matches. */
async function targetIds(pool, ownerId, body) {
    if (Array.isArray(body.ids)) {
        const ids = idList(body.ids, MAX_BULK);
        const found = [];
        for (const chunk of chunks(ids, BULK_CHUNK)) {
            const [rows] = await pool.query('SELECT id FROM bank_items WHERE owner_id = ? AND id IN (?)', [ownerId, chunk]);
            found.push(...rows.map(row => row.id));
        }
        return found;
    }
    if (body.filter && typeof body.filter === 'object') {
        const status = STATUSES.includes(body.filter.status) ? body.filter.status : 'published';
        const { where, args } = core.buildFilter(body.filter, contextFor(ownerId, status));
        const [rows] = await pool.query(`SELECT i.id FROM bank_items i WHERE ${where.join(' AND ')} LIMIT ?`, [...args, MAX_BULK + 1]);
        if (rows.length > MAX_BULK) throw new BankError(`Narrow the filter: at most ${MAX_BULK} tasks at once`);
        return rows.map(row => row.id);
    }
    throw new BankError('Choose the tasks to change');
}

function nullableRef(value, map, label) {
    if (value === null || value === '') return null;
    const id = toId(value);
    if (!id || !map.has(id)) throw new BankError(`Unknown ${label}`);
    return id;
}

/** Bulk classification: the same topic, grade, difficulty, status or classifier values for many tasks. */
async function bulkUpdate(pool, user, body) {
    const ownerId = writeScope(user, body.scope);
    const set = body.set && typeof body.set === 'object' ? body.set : {};
    const assignments = [];
    const args = [];
    const assign = (sql, ...values) => {
        assignments.push(sql);
        args.push(...values);
    };
    if (set.topicId !== undefined) {
        const topicId = nullableRef(set.topicId, meta.topics, 'topic');
        if (topicId) {
            assign('topic_id = ?', topicId);
            assign('subject_id = ?', meta.topics.get(topicId).subject_id);
        } else {
            assign('topic_id = NULL');
        }
    } else if (set.subjectId !== undefined) {
        const subjectId = nullableRef(set.subjectId, meta.subjects, 'subject');
        const keep = [...meta.topics.values()].filter(t => t.subject_id === subjectId).map(t => t.id);
        assign('subject_id = ?', subjectId);
        // Topics of another subject no longer fit
        if (keep.length) assign('topic_id = IF(topic_id IN (?), topic_id, NULL)', keep);
        else assign('topic_id = NULL');
    }
    if (set.gradeId !== undefined) assign('grade_id = ?', nullableRef(set.gradeId, meta.grades, 'grade'));
    if (set.difficultyId !== undefined) assign('difficulty_id = ?', nullableRef(set.difficultyId, meta.difficulties, 'difficulty'));
    if (set.status !== undefined) {
        if (!STATUSES.includes(set.status)) throw new BankError('Invalid status');
        assign('status = ?', set.status);
    }
    const addValues = idList(body.addValues ?? [], 20);
    const removeValues = idList(body.removeValues ?? [], 20);
    if ([...addValues, ...removeValues].some(id => !meta.values.has(id))) throw new BankError('Unknown classifier value');
    if (!assignments.length && !addValues.length && !removeValues.length) throw new BankError('Nothing to change');

    const ids = await targetIds(pool, ownerId, body);
    await inTransaction(pool, async conn => {
        for (const chunk of chunks(ids, BULK_CHUNK)) {
            if (assignments.length) await conn.query(`UPDATE bank_items SET ${assignments.join(', ')} WHERE id IN (?)`, [...args, chunk]);
            for (const valueId of addValues) {
                await conn.query('INSERT IGNORE INTO bank_item_values (value_id, item_id) SELECT ?, id FROM bank_items WHERE id IN (?)', [valueId, chunk]);
            }
            if (removeValues.length) await conn.query('DELETE FROM bank_item_values WHERE item_id IN (?) AND value_id IN (?)', [chunk, removeValues]);
        }
    });
    return { matched: ids.length };
}

/** Archives tasks (they stay out of listings); `purge` deletes ones already archived for good. */
async function archiveItems(pool, user, body) {
    const ownerId = writeScope(user, body.scope);
    const ids = idList(body.ids ?? [], MAX_BULK);
    if (!ids.length) throw new BankError('Choose the tasks');
    let affected = 0;
    await inTransaction(pool, async conn => {
        for (const chunk of chunks(ids, BULK_CHUNK)) {
            if (!body.purge) {
                const [result] = await conn.query("UPDATE bank_items SET status = 'archived' WHERE owner_id = ? AND id IN (?)", [ownerId, chunk]);
                affected += result.affectedRows;
                continue;
            }
            const [rows] = await conn.query("SELECT id FROM bank_items WHERE owner_id = ? AND status = 'archived' AND id IN (?)", [ownerId, chunk]);
            const gone = rows.map(row => row.id);
            if (!gone.length) continue;
            await conn.query('DELETE FROM bank_item_values WHERE item_id IN (?)', [gone]);
            await conn.query('DELETE FROM bank_item_content WHERE item_id IN (?)', [gone]);
            await conn.query('DELETE FROM bank_items WHERE id IN (?)', [gone]);
            affected += gone.length;
        }
    });
    return body.purge ? { deleted: affected } : { archived: affected };
}

// --- READING TASKS ---
/** Full questions for preview and for dropping into a quiz, in the order asked. */
async function fetchItems(pool, user, ids) {
    if (!ids.length) return [];
    const admin = user.role === 'admin';
    const [rows] = await pool.query(
        `SELECT i.id, i.owner_id, i.kind, i.qtype, i.subject_id, i.grade_id, i.topic_id, i.difficulty_id, i.status, i.uses, i.source, c.content
         FROM bank_items i JOIN bank_item_content c ON c.item_id = i.id
         WHERE i.id IN (?)${admin ? '' : " AND ((i.owner_id = 0 AND i.status = 'published') OR i.owner_id = ?)"}`,
        admin ? [ids] : [ids, user.id]
    );
    if (!rows.length) return [];
    const [links] = await pool.query('SELECT item_id, value_id FROM bank_item_values WHERE item_id IN (?)', [rows.map(row => row.id)]);
    const valuesOf = new Map();
    for (const link of links) {
        if (!valuesOf.has(link.item_id)) valuesOf.set(link.item_id, []);
        valuesOf.get(link.item_id).push(link.value_id);
    }
    const byId = new Map(rows.map(row => [row.id, {
        id: row.id,
        shared: row.owner_id === 0,
        mine: row.owner_id === user.id,
        kind: row.kind,
        qtype: row.qtype,
        subjectId: row.subject_id,
        gradeId: row.grade_id,
        topicId: row.topic_id,
        difficultyId: row.difficulty_id,
        status: row.status,
        uses: row.uses,
        source: row.source,
        values: valuesOf.get(row.id) || [],
        content: parseJson(row.content)
    }]));
    return ids.map(id => byId.get(id)).filter(Boolean);
}

/** Random tasks of a listing filter ("take N from this topic"), optionally so many per difficulty. */
async function sampleItems(pool, user, body) {
    const params = body.filter && typeof body.filter === 'object' ? body.filter : {};
    const ctx = listContext(user, params);
    const pick = async (extra, count) => {
        const { where, args } = core.buildFilter({ ...params, ...extra }, ctx);
        const [rows] = await pool.query(`SELECT i.id FROM bank_items i WHERE ${where.join(' AND ')} ORDER BY RAND() LIMIT ?`, [...args, count]);
        return rows.map(row => row.id);
    };
    if (body.perLevel && typeof body.perLevel === 'object') {
        const wanted = Object.entries(body.perLevel)
            .map(([id, n]) => [id === 'none' ? 'none' : toId(id), core.clampInt(n, 0, MAX_SAMPLE, 0)])
            .filter(([id, n]) => id && n);
        if (wanted.reduce((sum, [, n]) => sum + n, 0) > MAX_SAMPLE) throw new BankError(`At most ${MAX_SAMPLE} tasks at once`);
        const ids = [];
        for (const [id, n] of wanted) ids.push(...await pick({ difficulty: String(id) }, n));
        return ids;
    }
    return pick({}, core.clampInt(body.count, 1, MAX_SAMPLE, 10));
}

// --- CLASSIFIER EDITING (admins) ---
function optionalText(value, max) {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function requiredText(value, max) {
    const text = optionalText(value, max);
    if (!text) throw new BankError('A name is required');
    return text;
}

function sortOrder(value) {
    return core.clampInt(value, -32768, 32767, 0);
}

function colorValue(value) {
    if (value == null || value === '') return null;
    if (!COLOR_RE.test(value)) throw new BankError('A colour looks like #22c55e');
    return value;
}

function known(map, rawId, label) {
    const id = toId(rawId);
    if (!id || !map.has(id)) throw new BankError(`Unknown ${label}`, 404);
    return id;
}

function nextOrder(map, belongs = () => true) {
    return [...map.values()].filter(belongs).reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;
}

/** Column assignments for the fields present in a request body: {field: [column, parse]}. */
function columnsFrom(body, fields) {
    return Object.entries(fields)
        .filter(([field]) => body && body[field] !== undefined)
        .map(([field, [column, parse]]) => [column, parse(body[field])]);
}

async function updateRow(db, table, id, columns) {
    if (!columns.length) return;
    await db.query(`UPDATE ${table} SET ${columns.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`,
        [...columns.map(([, value]) => value), id]);
}

async function countOf(pool, sql, args) {
    const [[row]] = await pool.query(sql, args);
    return Number(row.n);
}

function parseTopicGrades(value) {
    const entries = Array.isArray(value) ? value : Object.entries(value && typeof value === 'object' ? value : {});
    return entries.map(([grade, hours]) => {
        const id = toId(grade);
        if (!id || !meta.grades.has(id)) throw new BankError('Unknown grade');
        return [id, core.clampInt(hours, 0, 999, null)];
    });
}

/** A valid parent for a topic of this subject; never the topic itself or one inside it. */
function topicParent(subjectId, rawParent, topicId = null) {
    if (rawParent == null || rawParent === '') return null;
    const parent = meta.topics.get(toId(rawParent));
    if (!parent) throw new BankError('Unknown parent topic');
    if (parent.subject_id !== subjectId) throw new BankError('The parent topic belongs to another subject');
    if (topicId && subtree(meta.topicChildren, topicId).includes(parent.id)) throw new BankError('A topic cannot move inside itself');
    return parent.id;
}

function valueParent(dimensionId, rawParent, valueId = null) {
    if (rawParent == null || rawParent === '') return null;
    const parent = meta.values.get(toId(rawParent));
    if (!parent) throw new BankError('Unknown parent value');
    if (parent.dimension_id !== dimensionId) throw new BankError('The parent value belongs to another classifier');
    if (valueId && subtree(meta.valueChildren, valueId).includes(parent.id)) throw new BankError('A value cannot move inside itself');
    return parent.id;
}

async function replaceTopicGrades(conn, topicId, grades) {
    await conn.query('DELETE FROM bank_topic_grades WHERE topic_id = ?', [topicId]);
    if (grades.length) {
        await conn.query('INSERT INTO bank_topic_grades (grade_id, topic_id, hours) VALUES ?', [grades.map(([grade, hours]) => [grade, topicId, hours])]);
    }
}

// Classifier lists whose order admins set (the key is also the meta map's name)
const REORDERABLE = {
    subjects: 'bank_subjects',
    difficulties: 'bank_difficulties',
    topics: 'bank_topics',
    dimensions: 'bank_dimensions',
    values: 'bank_values'
};

// --- ROUTES ---
let bankReady = false;

/**
 * The bank's API under /api: /bank/* for signed-in users the bank is open to, and the public
 * /media/<sha256> pictures (content-addressed, so they are cached for good).
 */
function createBankRouter({ pool, authenticateToken, requireAdmin }) {
    const router = express.Router();
    const route = handler => async (req, res) => {
        try {
            const result = await handler(req, res);
            if (result !== undefined) res.json(result);
        } catch (error) {
            if (error instanceof BankError) return res.status(error.status).json({ error: error.message, ...error.extra });
            console.error('[BANK]', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };
    const ready = (req, res, next) => (bankReady ? next() : res.status(503).json({ error: 'The task bank is not available' }));
    const reader = (req, res, next) => (bankLimits(req.user).read ? next() : res.status(403).json({ error: 'The task bank is not open yet' }));
    const changed = async result => {
        await reloadMeta(pool);
        return result;
    };

    router.get('/media/:sha', ready, route(async (req, res) => {
        const sha = String(req.params.sha);
        if (!SHA256_RE.test(sha)) throw new BankError('Not found', 404);
        const [[row]] = await pool.query('SELECT mime, data FROM bank_media WHERE sha256 = ?', [sha]);
        if (!row) throw new BankError('Not found', 404);
        res.set({ 'Cache-Control': 'public, max-age=31536000, immutable', ETag: `"${sha}"` });
        res.type(row.mime).send(row.data);
    }));

    router.use('/bank', ready, authenticateToken, reader, async (req, res, next) => {
        try {
            await freshMeta(pool);
            next();
        } catch (error) {
            console.error('[BANK] classifiers:', error.code || error.message);
            res.status(503).json({ error: 'The task bank is not available' });
        }
    });

    router.get('/bank/meta', route(req => (req.user.role === 'admin' ? meta.adminData : meta.teacherData)));

    router.get('/bank/items', route(async req => {
        const result = await listItems(pool, req.query, listContext(req.user, req.query));
        if (!result) throw new BankError('Invalid cursor');
        return result;
    }));

    router.post('/bank/items/fetch', route(async req => ({ items: await fetchItems(pool, req.user, idList(req.body?.ids ?? [], MAX_FETCH)) })));

    router.post('/bank/sample', route(async req => ({ ids: await sampleItems(pool, req.user, req.body || {}) })));

    // Each drop into a quiz counts towards "most used"; IDs counted once per request
    router.post('/bank/used', route(async req => {
        const ids = idList(req.body?.ids ?? [], MAX_FETCH);
        if (ids.length) {
            await pool.query('UPDATE bank_items SET uses = uses + 1, updated_at = updated_at WHERE id IN (?) AND (owner_id = 0 OR owner_id = ?)', [ids, req.user.id]);
        }
        return { ok: true };
    }));

    router.post('/bank/items', route(req => createItems(pool, req.user, req.body || {})));
    router.patch('/bank/items', route(req => bulkUpdate(pool, req.user, req.body || {})));
    router.delete('/bank/items', route(req => archiveItems(pool, req.user, req.body || {})));
    router.put('/bank/items/:id', route(req => updateItem(pool, req.user, req.params.id, req.body || {})));

    // Subjects
    router.post('/bank/subjects', requireAdmin, route(async req => {
        const [result] = await pool.query('INSERT INTO bank_subjects (name, icon, sort_order) VALUES (?, ?, ?)',
            [requiredText(req.body?.name, 80), optionalText(req.body?.icon, 16), nextOrder(meta.subjects)]);
        return changed({ id: result.insertId });
    }));
    router.patch('/bank/subjects/:id', requireAdmin, route(async req => {
        const id = known(meta.subjects, req.params.id, 'subject');
        await updateRow(pool, 'bank_subjects', id, columnsFrom(req.body, {
            name: ['name', v => requiredText(v, 80)], icon: ['icon', v => optionalText(v, 16)],
            sortOrder: ['sort_order', sortOrder], archived: ['archived', v => (v ? 1 : 0)]
        }));
        return changed({ id });
    }));
    router.delete('/bank/subjects/:id', requireAdmin, route(async req => {
        const id = known(meta.subjects, req.params.id, 'subject');
        const used = await countOf(pool, 'SELECT (SELECT COUNT(*) FROM bank_items WHERE subject_id = ?) + (SELECT COUNT(*) FROM bank_topics WHERE subject_id = ?) AS n', [id, id]);
        if (used) throw new BankError('The subject still has tasks or topics: archive it instead', 409);
        await pool.query('DELETE FROM bank_subjects WHERE id = ?', [id]);
        return changed({ id });
    }));

    // Grades: only the labels change (the IDs are the grade numbers)
    router.patch('/bank/grades/:id', requireAdmin, route(async req => {
        const id = known(meta.grades, req.params.id, 'grade');
        await pool.query('UPDATE bank_grades SET label = ? WHERE id = ?', [requiredText(req.body?.label, 40), id]);
        return changed({ id });
    }));

    // Difficulties (achievement levels)
    router.post('/bank/difficulties', requireAdmin, route(async req => {
        const [result] = await pool.query('INSERT INTO bank_difficulties (name, color, sort_order) VALUES (?, ?, ?)',
            [requiredText(req.body?.name, 40), colorValue(req.body?.color), nextOrder(meta.difficulties)]);
        return changed({ id: result.insertId });
    }));
    router.patch('/bank/difficulties/:id', requireAdmin, route(async req => {
        const id = known(meta.difficulties, req.params.id, 'difficulty');
        await updateRow(pool, 'bank_difficulties', id, columnsFrom(req.body, {
            name: ['name', v => requiredText(v, 40)], color: ['color', colorValue], sortOrder: ['sort_order', sortOrder]
        }));
        return changed({ id });
    }));
    router.delete('/bank/difficulties/:id', requireAdmin, route(async req => {
        const id = known(meta.difficulties, req.params.id, 'difficulty');
        const used = await countOf(pool, 'SELECT COUNT(*) AS n FROM bank_items WHERE difficulty_id = ?', [id]);
        if (used) throw new BankError(`${used} task(s) still have this difficulty`, 409, { used });
        await pool.query('DELETE FROM bank_difficulties WHERE id = ?', [id]);
        return changed({ id });
    }));

    // Topics
    router.post('/bank/topics', requireAdmin, route(async req => {
        const body = req.body || {};
        const subjectId = known(meta.subjects, body.subjectId, 'subject');
        const parentId = topicParent(subjectId, body.parentId);
        const grades = parseTopicGrades(body.grades);
        const id = await inTransaction(pool, async conn => {
            const [result] = await conn.query('INSERT INTO bank_topics (subject_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?)',
                [subjectId, parentId, requiredText(body.name, 160),
                    nextOrder(meta.topics, t => t.subject_id === subjectId && (t.parent_id ?? null) === parentId)]);
            await replaceTopicGrades(conn, result.insertId, grades);
            return result.insertId;
        });
        return changed({ id });
    }));
    router.patch('/bank/topics/:id', requireAdmin, route(async req => {
        const body = req.body || {};
        const id = known(meta.topics, req.params.id, 'topic');
        const topic = meta.topics.get(id);
        const columns = columnsFrom(body, {
            name: ['name', v => requiredText(v, 160)],
            parentId: ['parent_id', v => topicParent(topic.subject_id, v, id)],
            sortOrder: ['sort_order', sortOrder],
            archived: ['archived', v => (v ? 1 : 0)]
        });
        const grades = body.grades !== undefined ? parseTopicGrades(body.grades) : null;
        await inTransaction(pool, async conn => {
            await updateRow(conn, 'bank_topics', id, columns);
            if (grades) await replaceTopicGrades(conn, id, grades);
        });
        return changed({ id });
    }));
    router.delete('/bank/topics/:id', requireAdmin, route(async req => {
        const id = known(meta.topics, req.params.id, 'topic');
        if (meta.topicChildren.get(id)?.length) throw new BankError('Move or delete its subtopics first', 409);
        const used = await countOf(pool, 'SELECT COUNT(*) AS n FROM bank_items WHERE topic_id = ?', [id]);
        if (used) throw new BankError(`${used} task(s) are still in this topic`, 409, { used });
        await inTransaction(pool, async conn => {
            await conn.query('DELETE FROM bank_topic_grades WHERE topic_id = ?', [id]);
            await conn.query('DELETE FROM bank_topics WHERE id = ?', [id]);
        });
        return changed({ id });
    }));
    // Merging moves the tasks, subtopics and grades into another topic of the same subject
    router.post('/bank/topics/:id/merge', requireAdmin, route(async req => {
        const id = known(meta.topics, req.params.id, 'topic');
        const intoId = known(meta.topics, req.body?.intoId, 'topic');
        const from = meta.topics.get(id);
        if (meta.topics.get(intoId).subject_id !== from.subject_id) throw new BankError('Both topics must belong to the same subject');
        if (subtree(meta.topicChildren, id).includes(intoId)) throw new BankError('A topic cannot merge into one inside it');
        await inTransaction(pool, async conn => {
            await conn.query('UPDATE bank_topics SET parent_id = ? WHERE parent_id = ?', [intoId, id]);
            await conn.query('UPDATE bank_items SET topic_id = ? WHERE topic_id = ?', [intoId, id]);
            await conn.query('INSERT IGNORE INTO bank_topic_grades (grade_id, topic_id, hours) SELECT grade_id, ?, hours FROM bank_topic_grades WHERE topic_id = ?', [intoId, id]);
            await conn.query('DELETE FROM bank_topic_grades WHERE topic_id = ?', [id]);
            await conn.query('DELETE FROM bank_topics WHERE id = ?', [id]);
        });
        return changed({ id: intoId });
    }));

    // Classifiers and their values
    const subjectOrAll = value => (value == null || value === '' ? null : known(meta.subjects, value, 'subject'));
    router.post('/bank/dimensions', requireAdmin, route(async req => {
        const [result] = await pool.query('INSERT INTO bank_dimensions (name, subject_id, sort_order) VALUES (?, ?, ?)',
            [requiredText(req.body?.name, 60), subjectOrAll(req.body?.subjectId), nextOrder(meta.dimensions)]);
        return changed({ id: result.insertId });
    }));
    router.patch('/bank/dimensions/:id', requireAdmin, route(async req => {
        const id = known(meta.dimensions, req.params.id, 'classifier');
        await updateRow(pool, 'bank_dimensions', id, columnsFrom(req.body, {
            name: ['name', v => requiredText(v, 60)], subjectId: ['subject_id', subjectOrAll], sortOrder: ['sort_order', sortOrder]
        }));
        return changed({ id });
    }));
    router.delete('/bank/dimensions/:id', requireAdmin, route(async req => {
        const id = known(meta.dimensions, req.params.id, 'classifier');
        if ([...meta.values.values()].some(v => v.dimension_id === id)) throw new BankError('Delete its values first', 409);
        await pool.query('DELETE FROM bank_dimensions WHERE id = ?', [id]);
        return changed({ id });
    }));
    router.post('/bank/values', requireAdmin, route(async req => {
        const body = req.body || {};
        const dimensionId = known(meta.dimensions, body.dimensionId, 'classifier');
        const parentId = valueParent(dimensionId, body.parentId);
        const [result] = await pool.query('INSERT INTO bank_values (dimension_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?)',
            [dimensionId, parentId, requiredText(body.name, 160),
                nextOrder(meta.values, v => v.dimension_id === dimensionId && (v.parent_id ?? null) === parentId)]);
        return changed({ id: result.insertId });
    }));
    router.patch('/bank/values/:id', requireAdmin, route(async req => {
        const id = known(meta.values, req.params.id, 'value');
        const value = meta.values.get(id);
        await updateRow(pool, 'bank_values', id, columnsFrom(req.body, {
            name: ['name', v => requiredText(v, 160)],
            parentId: ['parent_id', v => valueParent(value.dimension_id, v, id)],
            sortOrder: ['sort_order', sortOrder]
        }));
        return changed({ id });
    }));
    router.delete('/bank/values/:id', requireAdmin, route(async req => {
        const id = known(meta.values, req.params.id, 'value');
        if (meta.valueChildren.get(id)?.length) throw new BankError('Delete its sub-values first', 409);
        await inTransaction(pool, async conn => {
            await conn.query('DELETE FROM bank_item_values WHERE value_id = ?', [id]);
            await conn.query('DELETE FROM bank_values WHERE id = ?', [id]);
        });
        return changed({ id });
    }));

    // New order of siblings: their IDs, first to last
    for (const [name, table] of Object.entries(REORDERABLE)) {
        router.post(`/bank/${name}/reorder`, requireAdmin, route(async req => {
            const ids = idList(req.body?.ids ?? [], 1000);
            if (ids.some(id => !meta[name].has(id))) throw new BankError('Unknown item in the new order');
            await inTransaction(pool, async conn => {
                for (const [index, id] of ids.entries()) await conn.query(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, [index, id]);
            });
            return changed({ ok: true });
        }));
    }

    return router;
}

/** Creates the bank's tables, seeds the empty ones and loads the classifiers. */
async function ensureBankSchema(pool) {
    for (const sql of SCHEMA) await pool.query(sql);
    await seedBank(pool);
    await loadMeta(pool);
    bankReady = true;
}

module.exports = { ensureBankSchema, createBankRouter, loadMeta, listItems, contextFor, bankLimits };
