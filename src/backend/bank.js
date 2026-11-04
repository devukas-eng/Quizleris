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
// A safety cap on a teacher's own tasks and folders until the Premium limits are set (see bankLimits)
const MAX_PRIVATE_ITEMS = 10000;
const MAX_FOLDERS = 1000;
const MAX_FAVORITES = 2000;
const MAX_OPEN_REPORTS = 30; // a teacher's reports waiting for an admin: enough for real mistakes, not for spam
const REPORT_REASONS = ['answer', 'wording', 'classification', 'duplicate', 'other'];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_CONTENT_BYTES = 1024 * 1024; // the question JSON once its pictures are in bank_media
const MEDIA_GRACE_HOURS = 24; // unused pictures are kept this long, so an import in progress never loses one
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MEDIA_URL_RE = /^\/api\/media\/([0-9a-f]{64})$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const SCHEMA_LOCK = 'quizleris_bank_schema';

// --- SCHEMA ---
// Always the latest schema: a fresh database gets exactly this, an older one is brought up to it by
// MIGRATIONS. Parents come before the tables whose foreign keys point at them.
//
// Normal form: every table is in 3NF except three copies kept on purpose for fast filtering, each
// pinned by a composite foreign key so it can never disagree with its source: a task's subject_id
// (its topic's subject), a topic's subject_id (its parent's subject) and a value's dimension_id (its
// parent's classifier). The question itself is one JSON document, like quizzes.quiz_data; the
// columns derived from it (qtype, preview, search_text, has_image, content_hash) are only ever
// written together with it.
const ASCII = 'CHARACTER SET ascii COLLATE ascii_bin';
const TABLE_OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS bank_settings (
        name VARCHAR(40) PRIMARY KEY,
        value VARCHAR(255) NOT NULL
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS bank_subjects (
        id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        icon VARCHAR(16) NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        archived TINYINT(1) NOT NULL DEFAULT 0,
        UNIQUE KEY bank_subjects_name (name)
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS bank_grades (
        id TINYINT UNSIGNED PRIMARY KEY,
        label VARCHAR(40) NOT NULL
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS bank_difficulties (
        id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(40) NOT NULL,
        color CHAR(7) NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        UNIQUE KEY bank_difficulties_name (name)
    ) ${TABLE_OPTIONS}`,
    // parent_id NULL is a content area (turinio sritis); the depth is unlimited. parent_key exists only
    // so sibling names are unique at the top level too (a unique key treats every NULL as different).
    `CREATE TABLE IF NOT EXISTS bank_topics (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        subject_id SMALLINT UNSIGNED NOT NULL,
        parent_id INT UNSIGNED NULL,
        parent_key INT UNSIGNED AS (IFNULL(parent_id, 0)) STORED,
        name VARCHAR(160) NOT NULL,
        description TEXT NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        archived TINYINT(1) NOT NULL DEFAULT 0,
        UNIQUE KEY bank_topics_with_subject (id, subject_id),
        UNIQUE KEY bank_topics_sibling_name (subject_id, parent_key, name),
        INDEX bank_topics_parent (parent_id, subject_id),
        CONSTRAINT bank_topics_subject_fk FOREIGN KEY (subject_id) REFERENCES bank_subjects (id),
        CONSTRAINT bank_topics_parent_fk FOREIGN KEY (parent_id, subject_id) REFERENCES bank_topics (id, subject_id)
    ) ${TABLE_OPTIONS}`,
    // Further classifiers (context, achievement, competence, tags…) need no schema change;
    // subject_id NULL means the classifier is for every subject
    `CREATE TABLE IF NOT EXISTS bank_dimensions (
        id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        subject_id SMALLINT UNSIGNED NULL,
        subject_key SMALLINT UNSIGNED AS (IFNULL(subject_id, 0)) STORED,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        UNIQUE KEY bank_dimensions_name (subject_key, name),
        INDEX bank_dimensions_subject (subject_id),
        CONSTRAINT bank_dimensions_subject_fk FOREIGN KEY (subject_id) REFERENCES bank_subjects (id)
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS bank_values (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        dimension_id SMALLINT UNSIGNED NOT NULL,
        parent_id INT UNSIGNED NULL,
        parent_key INT UNSIGNED AS (IFNULL(parent_id, 0)) STORED,
        name VARCHAR(160) NOT NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        UNIQUE KEY bank_values_with_dimension (id, dimension_id),
        UNIQUE KEY bank_values_sibling_name (dimension_id, parent_key, name),
        INDEX bank_values_parent (parent_id, dimension_id),
        CONSTRAINT bank_values_dimension_fk FOREIGN KEY (dimension_id) REFERENCES bank_dimensions (id),
        CONSTRAINT bank_values_parent_fk FOREIGN KEY (parent_id, dimension_id) REFERENCES bank_values (id, dimension_id)
    ) ${TABLE_OPTIONS}`,
    // The curriculum: in which grades a topic is taught, with the yearly plan's hours and what is
    // learned that year. course_value_id names a course (a classifier value such as Išplėstinis) where
    // a grade has several; NULL is the grade's whole class.
    `CREATE TABLE IF NOT EXISTS bank_topic_grades (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        topic_id INT UNSIGNED NOT NULL,
        grade_id TINYINT UNSIGNED NOT NULL,
        course_value_id INT UNSIGNED NULL,
        course_key INT UNSIGNED AS (IFNULL(course_value_id, 0)) STORED,
        hours SMALLINT UNSIGNED NULL,
        description TEXT NULL,
        UNIQUE KEY bank_topic_grades_once (grade_id, topic_id, course_key),
        INDEX bank_topic_grades_topic (topic_id),
        INDEX bank_topic_grades_course (course_value_id),
        CONSTRAINT bank_topic_grades_grade_fk FOREIGN KEY (grade_id) REFERENCES bank_grades (id),
        CONSTRAINT bank_topic_grades_topic_fk FOREIGN KEY (topic_id) REFERENCES bank_topics (id) ON DELETE CASCADE,
        CONSTRAINT bank_topic_grades_course_fk FOREIGN KEY (course_value_id) REFERENCES bank_values (id)
    ) ${TABLE_OPTIONS}`,
    // A teacher's own folders for their own tasks (the shared bank is sorted by the topic tree).
    // A subfolder always has its parent's owner; deleting a folder deletes its subfolders, after the
    // route has moved their tasks up (a task's folder key would refuse otherwise).
    `CREATE TABLE IF NOT EXISTS bank_folders (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        owner_id INT NOT NULL,
        parent_id INT UNSIGNED NULL,
        name VARCHAR(120) NOT NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY bank_folders_with_owner (id, owner_id),
        INDEX bank_folders_owner (owner_id, parent_id, sort_order),
        INDEX bank_folders_parent (parent_id, owner_id),
        CONSTRAINT bank_folders_parent_fk FOREIGN KEY (parent_id, owner_id) REFERENCES bank_folders (id, owner_id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}`,
    // Narrow on purpose: listings read only these columns, the question itself is in bank_item_content.
    // owner_id 0 is the shared bank, any other value a teacher's own tasks (users.id; no foreign key
    // because of the 0, so a deleted account's tasks are removed by cleanupBank instead).
    `CREATE TABLE IF NOT EXISTS bank_items (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        owner_id INT NOT NULL DEFAULT 0,
        kind ENUM('problem', 'template') NOT NULL DEFAULT 'problem',
        qtype VARCHAR(20) NOT NULL,
        subject_id SMALLINT UNSIGNED NULL,
        grade_id TINYINT UNSIGNED NULL,
        topic_id INT UNSIGNED NULL,
        difficulty_id TINYINT UNSIGNED NULL,
        folder_id INT UNSIGNED NULL,
        status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'published',
        preview VARCHAR(300) NOT NULL,
        search_text TEXT NOT NULL,
        has_image TINYINT(1) NOT NULL DEFAULT 0,
        content_hash CHAR(40) ${ASCII} NOT NULL,
        uses INT UNSIGNED NOT NULL DEFAULT 0,
        source VARCHAR(160) NULL,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY bank_items_dedupe (owner_id, content_hash),
        INDEX bank_items_all_new (owner_id, status, id),
        INDEX bank_items_subject_new (owner_id, status, subject_id, id),
        INDEX bank_items_browse (owner_id, status, subject_id, grade_id, id),
        INDEX bank_items_topic (owner_id, status, subject_id, grade_id, topic_id, id),
        INDEX bank_items_level (owner_id, status, subject_id, grade_id, difficulty_id, id),
        INDEX bank_items_popular (owner_id, status, subject_id, grade_id, uses, id),
        INDEX bank_items_unsorted (owner_id, status, topic_id, subject_id, difficulty_id),
        INDEX bank_items_subject_ref (subject_id),
        INDEX bank_items_grade_ref (grade_id),
        INDEX bank_items_topic_ref (topic_id, subject_id),
        INDEX bank_items_difficulty_ref (difficulty_id),
        INDEX bank_items_folder (folder_id, owner_id, id),
        FULLTEXT INDEX bank_items_search (search_text),
        CONSTRAINT bank_items_subject_fk FOREIGN KEY (subject_id) REFERENCES bank_subjects (id),
        CONSTRAINT bank_items_grade_fk FOREIGN KEY (grade_id) REFERENCES bank_grades (id),
        CONSTRAINT bank_items_topic_fk FOREIGN KEY (topic_id, subject_id) REFERENCES bank_topics (id, subject_id),
        CONSTRAINT bank_items_difficulty_fk FOREIGN KEY (difficulty_id) REFERENCES bank_difficulties (id),
        CONSTRAINT bank_items_folder_fk FOREIGN KEY (folder_id, owner_id) REFERENCES bank_folders (id, owner_id),
        CONSTRAINT bank_items_topic_has_subject CHECK (topic_id IS NULL OR subject_id IS NOT NULL)
    ) ${TABLE_OPTIONS}`,
    // The question in the editor's own format (quiz_data.questions[i]); templates add "template"
    `CREATE TABLE IF NOT EXISTS bank_item_content (
        item_id INT UNSIGNED PRIMARY KEY,
        content JSON NOT NULL,
        CONSTRAINT bank_item_content_item_fk FOREIGN KEY (item_id) REFERENCES bank_items (id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}`,
    `CREATE TABLE IF NOT EXISTS bank_item_values (
        value_id INT UNSIGNED NOT NULL,
        item_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (value_id, item_id),
        INDEX bank_item_values_item (item_id),
        CONSTRAINT bank_item_values_value_fk FOREIGN KEY (value_id) REFERENCES bank_values (id) ON DELETE CASCADE,
        CONSTRAINT bank_item_values_item_fk FOREIGN KEY (item_id) REFERENCES bank_items (id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}`,
    // Pictures by content hash: stored once however many tasks use them, served at /api/media/<sha256>
    `CREATE TABLE IF NOT EXISTS bank_media (
        sha256 CHAR(64) ${ASCII} PRIMARY KEY,
        mime VARCHAR(40) NOT NULL,
        bytes INT UNSIGNED NOT NULL,
        data MEDIUMBLOB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ${TABLE_OPTIONS}`,
    // Which task shows which picture, so pictures no task uses any more can be found and deleted
    `CREATE TABLE IF NOT EXISTS bank_item_media (
        item_id INT UNSIGNED NOT NULL,
        sha256 CHAR(64) ${ASCII} NOT NULL,
        PRIMARY KEY (item_id, sha256),
        INDEX bank_item_media_sha (sha256),
        CONSTRAINT bank_item_media_item_fk FOREIGN KEY (item_id) REFERENCES bank_items (id) ON DELETE CASCADE,
        CONSTRAINT bank_item_media_media_fk FOREIGN KEY (sha256) REFERENCES bank_media (sha256)
    ) ${TABLE_OPTIONS}`,
    // A teacher's starred tasks of the shared bank: bookmarks, the task itself stays where it is.
    // user_id is users.id without a foreign key, like owner_id; cleanupBank removes a deleted account's
    `CREATE TABLE IF NOT EXISTS bank_favorites (
        user_id INT NOT NULL,
        item_id INT UNSIGNED NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, item_id),
        INDEX bank_favorites_item (item_id),
        CONSTRAINT bank_favorites_item_fk FOREIGN KEY (item_id) REFERENCES bank_items (id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}`,
    // Mistakes teachers found in shared tasks, for admins to fix or dismiss. open_key is 1 only while a
    // report is open, so a teacher has at most one open report per task, and any number of closed ones.
    // Reports outlive their author's account: they are about the task.
    `CREATE TABLE IF NOT EXISTS bank_item_reports (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        item_id INT UNSIGNED NOT NULL,
        user_id INT NOT NULL,
        reason ENUM('answer', 'wording', 'classification', 'duplicate', 'other') NOT NULL,
        note VARCHAR(500) NULL,
        status ENUM('open', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
        open_key TINYINT UNSIGNED AS (IF(status = 'open', 1, NULL)) STORED,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME NULL DEFAULT NULL,
        closed_by INT NULL,
        UNIQUE KEY bank_item_reports_once (item_id, user_id, open_key),
        INDEX bank_item_reports_open (status, item_id),
        INDEX bank_item_reports_user (user_id, status),
        CONSTRAINT bank_item_reports_item_fk FOREIGN KEY (item_id) REFERENCES bank_items (id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}`
];

// Schema changes after the first release, in order, each applied once (the version is kept in
// bank_settings). Never edit or reorder a released step: add a new function, and change SCHEMA to
// match, since a fresh database gets SCHEMA directly and skips the list.
const MIGRATIONS = [];

class BankError extends Error {
    constructor(message, status = 400, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}

// Database refusals that mean the request does not fit the data, rather than a server fault. Keyed by
// errno, which MariaDB and MySQL share except for a failed CHECK (4025 on MariaDB, 3819 on MySQL);
// mysql2 names MariaDB-only numbers after unrelated MySQL errors.
const DB_REFUSALS = {
    1062: [409, 'Something with this name already exists here'],
    1451: [409, 'Still in use'],
    1452: [400, 'Unknown classifier'],
    3819: [400, 'A topic needs its subject'],
    4025: [400, 'A topic needs its subject']
};

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

async function setSetting(pool, name, value) {
    await pool.query('INSERT INTO bank_settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [name, String(value)]);
}

async function migrate(pool, fresh) {
    const [[row]] = await pool.query("SELECT value FROM bank_settings WHERE name = 'schema_version'");
    // A fresh database already has the latest schema; one from before the list existed starts at 0
    let version = row ? Number(row.value) : fresh ? MIGRATIONS.length : 0;
    while (version < MIGRATIONS.length) {
        await MIGRATIONS[version](pool);
        version++;
        await setSetting(pool, 'schema_version', version);
        console.log(`[BANK] schema updated to version ${version}`);
    }
    await setSetting(pool, 'schema_version', version);
}

// --- SEED ---
// Grades, achievement levels, subjects, the maths curriculum for grades 1–12 (updated 2022 general
// programme and its implementation guides: topics, yearly-plan hours and what each grade and course
// learns) and the classifiers it names. Each table is seeded only while empty, so edits made by
// admins survive restarts.
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
    // Classifiers first: the curriculum's courses (Bendrasis, Išplėstinis) are values of one
    if (await isEmpty('bank_dimensions')) {
        await inTransaction(pool, async conn => {
            for (const [index, dimension] of seed.dimensions.entries()) {
                const [result] = await conn.query('INSERT INTO bank_dimensions (name, subject_id, sort_order) VALUES (?, ?, ?)',
                    [dimension.name, dimension.subject ? subjectId(dimension.subject) : null, index]);
                await insertValues(conn, result.insertId, null, dimension.values);
            }
        });
    }
    if (await isEmpty('bank_topics')) {
        const [courses] = await pool.query(
            `SELECT v.id, v.name, d.subject_id FROM bank_values v JOIN bank_dimensions d ON d.id = v.dimension_id
             WHERE d.name = 'Kursas'`);
        await inTransaction(pool, async conn => {
            for (const [subject, nodes] of Object.entries(seed.topics)) {
                const id = subjectId(subject);
                const courseOf = name => {
                    const course = courses.find(c => c.name === name && (c.subject_id === id || c.subject_id === null));
                    if (!course) throw new Error(`bank seed: no course "${name}" for ${subject}`);
                    return course.id;
                };
                if (id) await insertTopics(conn, id, null, nodes, courseOf);
            }
        });
    }
}

async function insertTopics(conn, subjectId, parentId, nodes, courseOf) {
    for (const [index, node] of nodes.entries()) {
        const [result] = await conn.query('INSERT INTO bank_topics (subject_id, parent_id, name, description, sort_order) VALUES (?, ?, ?, ?, ?)',
            [subjectId, parentId, node.name, node.description ?? null, index]);
        const rows = (node.curriculum || []).map(row =>
            [row.grade, result.insertId, row.course ? courseOf(row.course) : null, row.hours ?? null, row.description ?? null]);
        if (rows.length) {
            await conn.query('INSERT INTO bank_topic_grades (grade_id, topic_id, course_value_id, hours, description) VALUES ?', [rows]);
        }
        if (node.children) await insertTopics(conn, subjectId, result.insertId, node.children, courseOf);
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
    hiddenTopics: new Set(),
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
        pool.query('SELECT id, subject_id, parent_id, name, description, sort_order, archived FROM bank_topics ORDER BY sort_order, id'),
        pool.query('SELECT topic_id, grade_id, course_value_id, hours, description FROM bank_topic_grades ORDER BY grade_id, course_key'),
        pool.query('SELECT id, name, subject_id, sort_order FROM bank_dimensions ORDER BY sort_order, id'),
        pool.query('SELECT id, dimension_id, parent_id, name, sort_order FROM bank_values ORDER BY sort_order, id'),
        pool.query("SELECT subject_id, COUNT(*) AS n FROM bank_items WHERE owner_id = 0 AND status = 'published' GROUP BY subject_id")
    ])).map(([rows]) => rows);

    const gradesOf = new Map();
    for (const row of topicGrades) {
        if (!gradesOf.has(row.topic_id)) gradesOf.set(row.topic_id, []);
        gradesOf.get(row.topic_id).push({ grade: row.grade_id, course: row.course_value_id, hours: row.hours, description: row.description });
    }
    const itemCounts = new Map(counts.map(row => [row.subject_id, Number(row.n)]));
    const topicChildren = childrenMap(topics);

    // Teachers don't see archived subjects and topics, nor anything under an archived topic
    const archivedSubjects = new Set(subjects.filter(s => s.archived).map(s => s.id));
    const hiddenTopics = new Set();
    for (const topic of topics) {
        if (topic.archived || archivedSubjects.has(topic.subject_id)) subtree(topicChildren, topic.id).forEach(id => hiddenTopics.add(id));
    }

    const subjectRows = subjects.map(s => ({ id: s.id, name: s.name, icon: s.icon, sortOrder: s.sort_order, archived: !!s.archived, items: itemCounts.get(s.id) || 0 }));
    const topicRows = topics.map(t => ({
        id: t.id, subjectId: t.subject_id, parentId: t.parent_id, name: t.name, description: t.description,
        sortOrder: t.sort_order, archived: !!t.archived, grades: gradesOf.get(t.id) || []
    }));
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
        hiddenTopics,
        levelIds: difficulties.map(d => d.id),
        adminData: withVersion({ subjects: subjectRows, topics: topicRows, ...shared }),
        teacherData: withVersion({
            subjects: subjectRows.filter(s => !s.archived),
            topics: topicRows.filter(t => !hiddenTopics.has(t.id)),
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

/**
 * What core.buildFilter needs to list one owner's tasks (0 = the shared bank). For teachers a
 * topic's subtree leaves out archived topics, as their tree does.
 */
function contextFor(ownerId, status = 'published', { teacher = false } = {}) {
    const topicSubtree = id => subtree(meta.topicChildren, id).filter(topic => !teacher || !meta.hiddenTopics.has(topic));
    return { ownerId, status, levelIds: meta.levelIds, topicSubtree, groupValues };
}

// What a user may do with the bank. Premium limits (template variants, whole-topic picks, the size
// of a private bank) belong here once the bank has content.
function bankLimits(user) {
    const admin = user.role === 'admin';
    return { read: admin || BANK_OPEN, writeShared: admin, writeMine: admin || BANK_OPEN };
}

function listContext(user, params) {
    const teacher = user.role !== 'admin';
    // Starred tasks are shared ones the teacher bookmarked
    if (params.scope === 'favorites') return { ...contextFor(0, 'published', { teacher }), favoritesOf: user.id };
    const mine = params.scope === 'mine';
    // Drafts and the archive are listed for whoever may edit that bank
    const mayEdit = mine ? bankLimits(user).writeMine : bankLimits(user).writeShared;
    const status = mayEdit && STATUSES.includes(params.status) ? params.status : 'published';
    const ctx = contextFor(mine ? user.id : 0, status, { teacher });
    if (!mine && !teacher && params.flagged === '1') ctx.flagged = true;
    return ctx;
}

// The shared bank's published tasks counted by subject, grade, topic, difficulty, kind and type.
// Listings take their totals and tree counts from these instead of counting rows on every click.
// They are counted at start and again in the background after each change to the shared bank
// (sharedWrites), so a listing never waits for a count: just after a change it may show the
// previous counts for about a second. Only a listing in the first moments after a start waits.
const sharedGroups = { list: null, bySubject: null, version: -1, loading: null };
let sharedWrites = 0;

function recountShared(pool) {
    if (sharedGroups.loading || sharedGroups.version === sharedWrites) return;
    const version = sharedWrites;
    sharedGroups.loading = pool.query(
        `SELECT subject_id AS subject, grade_id AS grade, topic_id AS topic, difficulty_id AS difficulty, kind, qtype, COUNT(*) AS n
         FROM bank_items WHERE owner_id = 0 AND status = 'published'
         GROUP BY subject_id, grade_id, topic_id, difficulty_id, kind, qtype ORDER BY NULL`
    ).then(([rows]) => {
        const list = rows.map(row => ({ ...row, n: Number(row.n) }));
        const bySubject = new Map();
        for (const group of list) {
            if (!bySubject.has(group.subject)) bySubject.set(group.subject, []);
            bySubject.get(group.subject).push(group);
        }
        Object.assign(sharedGroups, { list, bySubject, version });
        return true;
    }).catch(error => {
        // Never thrown on: a background count has nobody waiting. The next listing tries again.
        console.error('[BANK] could not count the shared bank:', error.code || error.message);
        return false;
    }).then(counted => {
        sharedGroups.loading = null;
        if (counted) recountShared(pool); // changed again while counting
    });
}

async function sharedCounts(pool) {
    recountShared(pool);
    if (!sharedGroups.list) await sharedGroups.loading;
    if (!sharedGroups.list) throw new Error('The shared bank could not be counted');
    return sharedGroups;
}

/** One page of a listing; the first page also carries the total and the facet counts. */
async function listItems(pool, params, ctx) {
    const page = core.buildListQuery(params, ctx);
    if (!page) return null;
    const grouped = !params.cursor && ctx.ownerId === 0 && ctx.status === 'published' && core.groupCountable(params);
    const facetQueries = params.cursor || grouped ? [] : core.buildFacetQueries(params, ctx);
    const [[rows], groups, ...facetResults] = await Promise.all([
        pool.query(page.sql, page.args),
        grouped ? sharedCounts(pool) : null,
        ...facetQueries.map(q => pool.query(q.sql, q.args))
    ]);
    const more = rows.length > page.limit;
    if (more) rows.length = page.limit;
    const result = { items: rows.map(core.listItem), nextCursor: more ? page.cursorOf(rows[rows.length - 1]) : null };
    if (groups) {
        const subject = core.toId(params.subject);
        Object.assign(result, core.countFromGroups(subject ? groups.bySubject.get(subject) || [] : groups.list, params, ctx));
    } else if (facetQueries.length) {
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
 * topic drops a topic of the old subject. `folders` holds the owner's folder IDs (null for the
 * shared bank, which has none).
 */
function prepareItem(raw, fallback, folders) {
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
    const rawFolder = pick('folderId');
    const folderId = rawFolder == null || rawFolder === '' ? null : toId(rawFolder);
    if (rawFolder != null && rawFolder !== '' && (!folderId || !folders?.has(folderId))) throw new BankError('Unknown folder');

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
        folderId,
        values,
        source: typeof source === 'string' && source.trim() ? source.trim().slice(0, 160) : null,
        content: question
    };
}

/** The owner's folder IDs, or null for the shared bank (owner 0), which has no folders. */
async function folderIdsOf(db, ownerId) {
    if (!ownerId) return null;
    const [rows] = await db.query('SELECT id FROM bank_folders WHERE owner_id = ?', [ownerId]);
    return new Set(rows.map(row => row.id));
}

async function storeImage(conn, dataUrl) {
    const comma = dataUrl.indexOf(',');
    const header = /^data:(image\/[a-z+.-]+);base64$/.exec(comma > 0 ? dataUrl.slice(0, comma) : '');
    if (!header || !IMAGE_TYPES.has(header[1])) throw new BankError('Pictures must be PNG, JPEG, WebP or GIF');
    const data = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    if (!data.length || data.length > MAX_IMAGE_BYTES) throw new BankError('Picture too large');
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    await conn.query('INSERT IGNORE INTO bank_media (sha256, mime, bytes, data) VALUES (?, ?, ?, ?)', [sha, header[1], data.length, data]);
    return sha;
}

/**
 * Moves embedded pictures (data URLs) into bank_media and points the question at them. Returns the
 * pictures the question shows; ones it links to already must be in the bank.
 */
async function storeImages(conn, content) {
    const used = new Set();
    const linked = new Set();
    for (const [holder, key] of core.imageSlots(content)) {
        const value = holder[key];
        if (typeof value !== 'string') throw new BankError('Invalid picture');
        const link = MEDIA_URL_RE.exec(value);
        if (link) {
            linked.add(link[1]);
        } else {
            const sha = await storeImage(conn, value);
            holder[key] = `/api/media/${sha}`;
            used.add(sha);
        }
    }
    if (linked.size) {
        const [rows] = await conn.query('SELECT sha256 FROM bank_media WHERE sha256 IN (?)', [[...linked]]);
        if (rows.length < linked.size) throw new BankError('Unknown picture');
        linked.forEach(sha => used.add(sha));
    }
    return [...used];
}

/** Pictures stored, then the derived columns: list preview, search text, duplicate fingerprint. */
async function derivedColumns(conn, content) {
    const media = await storeImages(conn, content);
    const json = JSON.stringify(content);
    if (Buffer.byteLength(json, 'utf8') > MAX_CONTENT_BYTES) throw new BankError('Task too large');
    return {
        json,
        media,
        preview: core.previewText(content),
        search: core.searchText(content),
        hash: core.contentHash(content),
        hasImage: media.length ? 1 : 0
    };
}

async function linkMedia(conn, itemId, shas) {
    await conn.query('DELETE FROM bank_item_media WHERE item_id = ?', [itemId]);
    if (shas.length) await conn.query('INSERT INTO bank_item_media (item_id, sha256) VALUES ?', [shas.map(sha => [itemId, sha])]);
}

async function findDuplicate(conn, ownerId, hash) {
    const [[row]] = await conn.query('SELECT id, status FROM bank_items WHERE owner_id = ? AND content_hash = ?', [ownerId, hash]);
    return row || null;
}

/**
 * Inserts one prepared task. A task already in this bank is reported as a duplicate instead; one
 * that was archived comes back.
 */
async function insertItem(conn, ownerId, userId, item) {
    const d = await derivedColumns(conn, item.content);
    try {
        const [result] = await conn.query(
            `INSERT INTO bank_items (owner_id, kind, qtype, subject_id, grade_id, topic_id, difficulty_id, folder_id, status,
                                     preview, search_text, has_image, content_hash, source, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ownerId, item.kind, item.content.type, item.subjectId, item.gradeId, item.topicId, item.difficultyId, item.folderId, item.status,
                d.preview, d.search, d.hasImage, d.hash, item.source, userId]
        );
        await conn.query('INSERT INTO bank_item_content (item_id, content) VALUES (?, ?)', [result.insertId, d.json]);
        if (item.values.length) {
            await conn.query('INSERT INTO bank_item_values (value_id, item_id) VALUES ?', [item.values.map(v => [v, result.insertId])]);
        }
        await linkMedia(conn, result.insertId, d.media);
        return { id: result.insertId };
    } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        const existing = await findDuplicate(conn, ownerId, d.hash);
        if (existing?.status === 'archived' && item.status !== 'archived') {
            await conn.query('UPDATE bank_items SET status = ? WHERE id = ?', [item.status, existing.id]);
            return { id: existing.id, duplicate: true, restored: true };
        }
        return { id: existing?.id ?? null, duplicate: true };
    }
}

async function createItems(pool, user, body) {
    const ownerId = writeScope(user, body.scope);
    const list = Array.isArray(body.items) ? body.items : [];
    if (!list.length || list.length > MAX_BATCH) throw new BankError(`Send 1–${MAX_BATCH} tasks at a time`);
    if (ownerId !== 0 && user.role !== 'admin') {
        const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM bank_items WHERE owner_id = ? AND status <> 'archived'", [ownerId]);
        if (Number(n) + list.length > MAX_PRIVATE_ITEMS) throw new BankError(`Your own bank holds at most ${MAX_PRIVATE_ITEMS} tasks`, 403);
    }
    const defaults = body.defaults && typeof body.defaults === 'object' ? body.defaults : {};
    const folders = await folderIdsOf(pool, ownerId);
    const results = new Array(list.length);
    const failed = (index, error) => {
        if (!(error instanceof BankError)) throw error;
        results[index] = { index, error: error.message };
    };
    const prepared = list.map((raw, index) => {
        try {
            return prepareItem(raw, defaults, folders);
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
        ? await pool.query('SELECT id, owner_id, kind, subject_id, grade_id, topic_id, difficulty_id, folder_id, status, source FROM bank_items WHERE id = ?', [id])
        : [[]];
    if (!row || !mayEdit(user, row.owner_id)) throw new BankError('Task not found', 404);
    return row;
}

async function updateItem(pool, user, rawId, body) {
    const row = await loadEditable(pool, user, rawId);
    const [links] = await pool.query('SELECT value_id FROM bank_item_values WHERE item_id = ?', [row.id]);
    const item = prepareItem(body, {
        kind: row.kind, status: row.status, subjectId: row.subject_id, gradeId: row.grade_id, topicId: row.topic_id,
        difficultyId: row.difficulty_id, folderId: row.folder_id, source: row.source, values: links.map(link => link.value_id)
    }, await folderIdsOf(pool, row.owner_id));
    await inTransaction(pool, async conn => {
        const d = await derivedColumns(conn, item.content);
        try {
            await conn.query(
                `UPDATE bank_items SET kind = ?, qtype = ?, subject_id = ?, grade_id = ?, topic_id = ?, difficulty_id = ?, folder_id = ?, status = ?,
                                       preview = ?, search_text = ?, has_image = ?, content_hash = ?, source = ?
                 WHERE id = ?`,
                [item.kind, item.content.type, item.subjectId, item.gradeId, item.topicId, item.difficultyId, item.folderId, item.status,
                    d.preview, d.search, d.hasImage, d.hash, item.source, row.id]
            );
        } catch (error) {
            if (error.code !== 'ER_DUP_ENTRY') throw error;
            const existing = await findDuplicate(conn, row.owner_id, d.hash);
            throw new BankError('The same task is already in the bank', 409, { duplicateId: existing?.id ?? null });
        }
        await conn.query('UPDATE bank_item_content SET content = ? WHERE item_id = ?', [d.json, row.id]);
        await conn.query('DELETE FROM bank_item_values WHERE item_id = ?', [row.id]);
        if (item.values.length) {
            await conn.query('INSERT INTO bank_item_values (value_id, item_id) VALUES ?', [item.values.map(v => [v, row.id])]);
        }
        await linkMedia(conn, row.id, d.media);
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
        const [rows] = await pool.query(`SELECT i.id FROM ${core.FROM_ITEMS} WHERE ${where.join(' AND ')} LIMIT ?`, [...args, MAX_BULK + 1]);
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
    // Moving tasks between the owner's own folders (null takes them out of any folder)
    if (set.folderId !== undefined) {
        const folderId = set.folderId === null || set.folderId === '' ? null : toId(set.folderId);
        if (set.folderId !== null && set.folderId !== '' && !(await folderIdsOf(pool, ownerId))?.has(folderId)) throw new BankError('Unknown folder');
        assign('folder_id = ?', folderId);
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

/**
 * Archives tasks (they leave the listings); `purge` deletes ones already archived for good, with
 * their content, classifier values and picture links (their pictures go in the hourly cleanup).
 */
async function archiveItems(pool, user, body) {
    const ownerId = writeScope(user, body.scope);
    const ids = idList(body.ids ?? [], MAX_BULK);
    if (!ids.length) throw new BankError('Choose the tasks');
    const sql = body.purge
        ? "DELETE FROM bank_items WHERE owner_id = ? AND status = 'archived' AND id IN (?)"
        : "UPDATE bank_items SET status = 'archived' WHERE owner_id = ? AND id IN (?)";
    let affected = 0;
    await inTransaction(pool, async conn => {
        for (const chunk of chunks(ids, BULK_CHUNK)) {
            const [result] = await conn.query(sql, [ownerId, chunk]);
            affected += result.affectedRows;
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
        `SELECT i.id, i.owner_id, i.kind, i.qtype, i.subject_id, i.grade_id, i.topic_id, i.difficulty_id, i.folder_id, i.status, i.uses, i.source, c.content
         FROM bank_items i JOIN bank_item_content c ON c.item_id = i.id
         WHERE i.id IN (?)${admin ? '' : " AND ((i.owner_id = 0 AND i.status = 'published') OR i.owner_id = ?)"}`,
        admin ? [ids] : [ids, user.id]
    );
    if (!rows.length) return [];
    const found = rows.map(row => row.id);
    const [[links], [myReports], [openReports]] = await Promise.all([
        pool.query('SELECT item_id, value_id FROM bank_item_values WHERE item_id IN (?)', [found]),
        pool.query("SELECT item_id FROM bank_item_reports WHERE user_id = ? AND status = 'open' AND item_id IN (?)", [user.id, found]),
        // Admins see the open reports of mistakes, with who sent them
        admin
            ? pool.query(`SELECT r.id, r.item_id, r.reason, r.note, r.created_at, u.username FROM bank_item_reports r
                          LEFT JOIN users u ON u.id = r.user_id WHERE r.status = 'open' AND r.item_id IN (?) ORDER BY r.id`, [found])
            : [[]]
    ]);
    const valuesOf = new Map();
    for (const link of links) {
        if (!valuesOf.has(link.item_id)) valuesOf.set(link.item_id, []);
        valuesOf.get(link.item_id).push(link.value_id);
    }
    const reported = new Set(myReports.map(row => row.item_id));
    const reportsOf = new Map();
    for (const report of openReports) {
        if (!reportsOf.has(report.item_id)) reportsOf.set(report.item_id, []);
        reportsOf.get(report.item_id).push({ id: report.id, reason: report.reason, note: report.note, user: report.username, createdAt: report.created_at });
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
        folderId: row.owner_id === user.id ? row.folder_id : null,
        status: row.status,
        uses: row.uses,
        source: row.source,
        values: valuesOf.get(row.id) || [],
        reportedByMe: reported.has(row.id),
        ...(admin ? { reports: reportsOf.get(row.id) || [] } : {}),
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
        const [rows] = await pool.query(`SELECT i.id FROM ${core.FROM_ITEMS} WHERE ${where.join(' AND ')} ORDER BY RAND() LIMIT ?`, [...args, count]);
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

/**
 * A topic's curriculum rows: [{grade, course?, hours?, description?}] (or {grade: hours} for short),
 * validated into [grade, course, hours, description]; a grade and course may appear once.
 */
function parseTopicGrades(value) {
    const list = Array.isArray(value)
        ? value
        : Object.entries(value && typeof value === 'object' ? value : {}).map(([grade, hours]) => ({ grade, hours }));
    const seen = new Set();
    return list.map(entry => {
        const row = entry && typeof entry === 'object' ? entry : {};
        const grade = toId(row.grade);
        if (!grade || !meta.grades.has(grade)) throw new BankError('Unknown grade');
        const hasCourse = row.course != null && row.course !== '';
        const course = hasCourse ? toId(row.course) : null;
        if (hasCourse && (!course || !meta.values.has(course))) throw new BankError('Unknown course');
        const key = `${grade}:${course || 0}`;
        if (seen.has(key)) throw new BankError('A grade (with its course) is listed twice');
        seen.add(key);
        return [grade, course, core.clampInt(row.hours, 0, 999, null), optionalText(row.description, 2000)];
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
        await conn.query('INSERT INTO bank_topic_grades (grade_id, topic_id, course_value_id, hours, description) VALUES ?',
            [grades.map(([grade, course, hours, description]) => [grade, topicId, course, hours, description])]);
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
let serving = false; // the API is mounted (a server, not a script)

/**
 * The bank's API under /api: /bank/* for signed-in users the bank is open to, and the public
 * /media/<sha256> pictures (content-addressed, so they are cached for good).
 */
function createBankRouter({ pool, authenticateToken, requireAdmin }) {
    serving = true;
    const router = express.Router();
    const route = handler => async (req, res) => {
        try {
            const result = await handler(req, res);
            if (result !== undefined) res.json(result);
        } catch (error) {
            if (error instanceof BankError) return res.status(error.status).json({ error: error.message, ...error.extra });
            const refusal = DB_REFUSALS[error.errno];
            if (refusal) return res.status(refusal[0]).json({ error: refusal[1] });
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

    // What this user may do with the bank, answered for anyone signed in: the editor asks this
    // first instead of provoking a refused request on every teacher's page while the bank is closed
    router.get('/bank/access', ready, authenticateToken, (req, res) => res.set('Cache-Control', 'private, no-cache').json(bankLimits(req.user)));

    router.use('/bank', ready, authenticateToken, reader, async (req, res, next) => {
        try {
            await freshMeta(pool);
            next();
        } catch (error) {
            console.error('[BANK] classifiers:', error.code || error.message);
            res.status(503).json({ error: 'The task bank is not available' });
        }
    });

    // Answers depend on who asks: browsers keep them privately and check back (an unchanged answer
    // comes back as an empty 304), and a shared cache such as the CDN never stores them
    router.use('/bank', (req, res, next) => {
        res.set('Cache-Control', 'private, no-cache');
        // A finished write that may touch the shared bank's counts has them counted again (reading
        // tasks, counting uses, folders, stars and reports change no counts)
        const countsStay = /^\/(items\/fetch|sample|used|folders|favorites)(\/|$)|\/reports$/.test(req.path);
        if (req.method !== 'GET' && !countsStay && req.body?.scope !== 'mine') {
            res.on('finish', () => {
                sharedWrites++;
                recountShared(pool);
            });
        }
        next();
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

    // A teacher's own folders, with how many of their tasks each holds (archived ones not counted)
    const folderOwner = user => {
        if (!bankLimits(user).writeMine) throw new BankError('You may not change this bank', 403);
        return user.id;
    };
    const ownFolders = async (db, ownerId) => {
        const [rows] = await db.query('SELECT id, parent_id FROM bank_folders WHERE owner_id = ?', [ownerId]);
        return { ids: new Set(rows.map(row => row.id)), children: childrenMap(rows) };
    };
    const folderParent = (folders, rawParent, folderId = null) => {
        if (rawParent == null || rawParent === '') return null;
        const parentId = toId(rawParent);
        if (!parentId || !folders.ids.has(parentId)) throw new BankError('Unknown folder');
        if (folderId && subtree(folders.children, folderId).includes(parentId)) throw new BankError('A folder cannot move inside itself');
        return parentId;
    };
    // With the counts of all one's tasks and of those in no folder, so the panel needs one request
    router.get('/bank/folders', route(async req => {
        const ownerId = folderOwner(req.user);
        const [[rows], [[counts]]] = await Promise.all([
            pool.query(
                `SELECT f.id, f.parent_id, f.name, f.sort_order, COUNT(i.id) AS items
                 FROM bank_folders f LEFT JOIN bank_items i ON i.folder_id = f.id AND i.owner_id = f.owner_id AND i.status = 'published'
                 WHERE f.owner_id = ? GROUP BY f.id, f.parent_id, f.name, f.sort_order ORDER BY f.sort_order, f.id`, [ownerId]),
            pool.query(
                "SELECT COUNT(*) AS total, IFNULL(SUM(folder_id IS NULL), 0) AS unfiled FROM bank_items WHERE owner_id = ? AND status = 'published'",
                [ownerId])
        ]);
        return {
            folders: rows.map(row => ({ id: row.id, parentId: row.parent_id, name: row.name, sortOrder: row.sort_order, items: Number(row.items) })),
            total: Number(counts.total),
            unfiled: Number(counts.unfiled)
        };
    }));
    router.post('/bank/folders', route(async req => {
        const ownerId = folderOwner(req.user);
        const folders = await ownFolders(pool, ownerId);
        if (folders.ids.size >= MAX_FOLDERS) throw new BankError(`At most ${MAX_FOLDERS} folders`, 403);
        const parentId = folderParent(folders, req.body?.parentId);
        const [[{ next }]] = await pool.query(
            'SELECT IFNULL(MAX(sort_order), -1) + 1 AS next FROM bank_folders WHERE owner_id = ? AND parent_id <=> ?', [ownerId, parentId]);
        const [result] = await pool.query('INSERT INTO bank_folders (owner_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?)',
            [ownerId, parentId, requiredText(req.body?.name, 120), Number(next)]);
        return { id: result.insertId };
    }));
    router.patch('/bank/folders/:id', route(async req => {
        const ownerId = folderOwner(req.user);
        const folders = await ownFolders(pool, ownerId);
        const id = toId(req.params.id);
        if (!id || !folders.ids.has(id)) throw new BankError('Folder not found', 404);
        await updateRow(pool, 'bank_folders', id, columnsFrom(req.body, {
            name: ['name', v => requiredText(v, 120)],
            parentId: ['parent_id', v => folderParent(folders, v, id)],
            sortOrder: ['sort_order', sortOrder]
        }));
        return { id };
    }));
    // Deleting a folder keeps its tasks: they (and those of its subfolders) move to its parent
    router.delete('/bank/folders/:id', route(async req => {
        const ownerId = folderOwner(req.user);
        const folders = await ownFolders(pool, ownerId);
        const id = toId(req.params.id);
        if (!id || !folders.ids.has(id)) throw new BankError('Folder not found', 404);
        const [[{ parent_id: parentId }]] = await pool.query('SELECT parent_id FROM bank_folders WHERE id = ?', [id]);
        const gone = subtree(folders.children, id);
        const moved = await inTransaction(pool, async conn => {
            const [result] = await conn.query('UPDATE bank_items SET folder_id = ? WHERE owner_id = ? AND folder_id IN (?)', [parentId, ownerId, gone]);
            await conn.query('DELETE FROM bank_folders WHERE id = ?', [id]); // its subfolders go with it
            return result.affectedRows;
        });
        return { deleted: gone.length, moved };
    }));

    // Stars: a teacher's bookmarks into the shared bank (tasks taken out of it drop off the list)
    const sharedTask = async rawId => {
        const id = toId(rawId);
        const [[row]] = id ? await pool.query("SELECT id FROM bank_items WHERE id = ? AND owner_id = 0 AND status = 'published'", [id]) : [[]];
        if (!row) throw new BankError('Task not found', 404);
        return row.id;
    };
    router.get('/bank/favorites', route(async req => {
        const [rows] = await pool.query(
            `SELECT f.item_id FROM bank_favorites f JOIN bank_items i ON i.id = f.item_id
             WHERE f.user_id = ? AND i.owner_id = 0 AND i.status = 'published' ORDER BY f.created_at DESC LIMIT ?`, [req.user.id, MAX_FAVORITES]);
        return { ids: rows.map(row => row.item_id) };
    }));
    router.put('/bank/favorites/:id', route(async req => {
        const id = await sharedTask(req.params.id);
        const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM bank_favorites WHERE user_id = ?', [req.user.id]);
        if (Number(n) >= MAX_FAVORITES) throw new BankError(`At most ${MAX_FAVORITES} starred tasks`, 403);
        await pool.query('INSERT IGNORE INTO bank_favorites (user_id, item_id) VALUES (?, ?)', [req.user.id, id]);
        return { ok: true };
    }));
    router.delete('/bank/favorites/:id', route(async req => {
        const id = toId(req.params.id);
        if (id) await pool.query('DELETE FROM bank_favorites WHERE user_id = ? AND item_id = ?', [req.user.id, id]);
        return { ok: true };
    }));

    // Mistakes teachers found in shared tasks: one open report per teacher and task
    router.post('/bank/items/:id/reports', route(async req => {
        const id = await sharedTask(req.params.id);
        const reason = REPORT_REASONS.includes(req.body?.reason) ? req.body.reason : null;
        if (!reason) throw new BankError('Choose what is wrong');
        const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM bank_item_reports WHERE user_id = ? AND status = 'open'", [req.user.id]);
        if (Number(n) >= MAX_OPEN_REPORTS) throw new BankError('Too many reports waiting: an admin will look at them first', 429);
        try {
            const [result] = await pool.query('INSERT INTO bank_item_reports (item_id, user_id, reason, note) VALUES (?, ?, ?, ?)',
                [id, req.user.id, reason, optionalText(req.body?.note, 500)]);
            return { id: result.insertId };
        } catch (error) {
            if (error.errno === 1062) throw new BankError('You already reported this task', 409);
            throw error;
        }
    }));
    // An admin closes a task's open reports: fixed, or nothing wrong after all
    router.patch('/bank/items/:id/reports', requireAdmin, route(async req => {
        const id = toId(req.params.id);
        const status = ['resolved', 'dismissed'].includes(req.body?.status) ? req.body.status : null;
        if (!id || !status) throw new BankError('Say how the reports end');
        const [result] = await pool.query(
            "UPDATE bank_item_reports SET status = ?, closed_at = NOW(), closed_by = ? WHERE item_id = ? AND status = 'open'", [status, req.user.id, id]);
        return { closed: result.affectedRows };
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
        const used = await countOf(pool,
            `SELECT (SELECT COUNT(*) FROM bank_items WHERE subject_id = ?) + (SELECT COUNT(*) FROM bank_topics WHERE subject_id = ?)
                  + (SELECT COUNT(*) FROM bank_dimensions WHERE subject_id = ?) AS n`, [id, id, id]);
        if (used) throw new BankError('The subject still has tasks, topics or classifiers: archive it instead', 409);
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
            const [result] = await conn.query('INSERT INTO bank_topics (subject_id, parent_id, name, description, sort_order) VALUES (?, ?, ?, ?, ?)',
                [subjectId, parentId, requiredText(body.name, 160), optionalText(body.description, 2000),
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
            description: ['description', v => optionalText(v, 2000)],
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
        await pool.query('DELETE FROM bank_topics WHERE id = ?', [id]); // its grades go with it
        return changed({ id });
    }));
    // Merging moves the tasks, subtopics and grades into another topic of the same subject
    router.post('/bank/topics/:id/merge', requireAdmin, route(async req => {
        const id = known(meta.topics, req.params.id, 'topic');
        const intoId = known(meta.topics, req.body?.intoId, 'topic');
        const from = meta.topics.get(id);
        if (meta.topics.get(intoId).subject_id !== from.subject_id) throw new BankError('Both topics must belong to the same subject');
        if (subtree(meta.topicChildren, id).includes(intoId)) throw new BankError('A topic cannot merge into itself or one inside it');
        try {
            await inTransaction(pool, async conn => {
                await conn.query('UPDATE bank_topics SET parent_id = ? WHERE parent_id = ?', [intoId, id]);
                await conn.query('UPDATE bank_items SET topic_id = ? WHERE topic_id = ?', [intoId, id]);
                // Grades the target already has keep its own row
                await conn.query(
                    `INSERT IGNORE INTO bank_topic_grades (grade_id, topic_id, course_value_id, hours, description)
                     SELECT grade_id, ?, course_value_id, hours, description FROM bank_topic_grades WHERE topic_id = ?`, [intoId, id]);
                await conn.query('DELETE FROM bank_topics WHERE id = ?', [id]);
            });
        } catch (error) {
            if (error.code !== 'ER_DUP_ENTRY') throw error;
            throw new BankError('Both topics have a subtopic with the same name: merge those first', 409);
        }
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
        await pool.query('DELETE FROM bank_values WHERE id = ?', [id]); // tasks lose this value with it
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

/** Creates or updates the bank's tables, seeds the empty ones and loads the classifiers. */
async function ensureBankSchema(pool) {
    // One server process at a time (several may start together); the lock belongs to this connection
    const lock = await pool.getConnection();
    try {
        const [[{ locked }]] = await lock.query('SELECT GET_LOCK(?, 30) AS locked', [SCHEMA_LOCK]);
        if (Number(locked) !== 1) throw new Error('another server process is still setting up the task bank');
        const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_items'");
        const fresh = Number(n) === 0;
        for (const sql of SCHEMA) await pool.query(sql);
        await migrate(pool, fresh);
        await seedBank(pool);
        if (fresh) console.log('[BANK] created the task bank tables');
    } finally {
        await lock.query('SELECT RELEASE_LOCK(?)', [SCHEMA_LOCK]).catch(() => {});
        lock.release();
    }
    await loadMeta(pool);
    bankReady = true;
    if (serving) recountShared(pool); // counted before the first listing asks (the server only, not scripts)
}

/**
 * Hourly upkeep: a deleted account's own tasks and folders go with it, and pictures no task shows any
 * more are deleted once older than `graceHours` (an import in progress may not have linked its new ones yet).
 */
async function cleanupBank(pool, graceHours = MEDIA_GRACE_HOURS) {
    if (!bankReady) return;
    const [tasks] = await pool.query('DELETE i FROM bank_items i LEFT JOIN users u ON u.id = i.owner_id WHERE i.owner_id <> 0 AND u.id IS NULL');
    // Top-level folders only: their subfolders go with them
    await pool.query('DELETE f FROM bank_folders f LEFT JOIN users u ON u.id = f.owner_id WHERE f.parent_id IS NULL AND u.id IS NULL');
    await pool.query('DELETE f FROM bank_favorites f LEFT JOIN users u ON u.id = f.user_id WHERE u.id IS NULL');
    const [pictures] = await pool.query(
        `DELETE m FROM bank_media m LEFT JOIN bank_item_media l ON l.sha256 = m.sha256
         WHERE l.sha256 IS NULL AND m.created_at <= NOW() - INTERVAL ? HOUR`, [graceHours]);
    if (tasks.affectedRows || pictures.affectedRows) {
        console.log(`[CLEANUP] task bank: ${tasks.affectedRows} task(s) of deleted accounts, ${pictures.affectedRows} unused picture(s)`);
    }
}

module.exports = { ensureBankSchema, createBankRouter, cleanupBank, loadMeta, listItems, contextFor, bankLimits };
