// Earlier versions of each quiz (docs/adr/0002-what-may-delete-data.md). Saving overwrote a quiz with
// no way back; now each save that changes something keeps a version. A version is a short list: the
// quiz's settings and, per question, its ID and the fingerprint of its content. The content itself is
// stored once per quiz however many versions show it, so a teacher changing one question adds one
// question, not a copy of the quiz. Any version opens in one read: nothing is replayed.
const crypto = require('crypto');
const core = require('./bank-core.js');

let ready = false;
const isReady = () => ready;

async function ensureQuizVersions(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS quiz_version_questions (
            quiz_id VARCHAR(50) NOT NULL,
            hash CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            content JSON NOT NULL,
            PRIMARY KEY (quiz_id, hash)
        ) ENGINE=InnoDB
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS quiz_versions (
            quiz_id VARCHAR(50) NOT NULL,
            version INT UNSIGNED NOT NULL,
            saved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            saved_by INT NULL,
            title VARCHAR(255) NOT NULL,
            settings JSON NOT NULL,
            questions JSON NOT NULL,
            PRIMARY KEY (quiz_id, version)
        ) ENGINE=InnoDB
    `);
    ready = true;
}

const parseJson = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

/** JSON with keys in order, so equal content always gives the same text. Nothing else is changed. */
function stableJson(value) {
    const sorted = (v) => {
        if (Array.isArray(v)) return v.map(sorted);
        if (v && typeof v === 'object') {
            return Object.fromEntries(Object.keys(v).sort().filter(key => v[key] !== undefined).map(key => [key, sorted(v[key])]));
        }
        return v;
    };
    return JSON.stringify(sorted(value));
}

/**
 * The fingerprint of a question exactly as saved, apart from its own ID. Unlike the bank's
 * contentHash, spacing and choice IDs count: a version must come back exactly, and students'
 * answers point at choice IDs.
 */
function exactHash(question) {
    const { id, ...content } = question; // eslint-disable-line no-unused-vars
    return crypto.createHash('sha1').update(stableJson(content)).digest('hex');
}

/** A quiz as a version: its settings, its questions as [id, hash], and the content of each hash. */
function splitQuiz(quiz) {
    const { id, questions, title, ...settings } = quiz; // eslint-disable-line no-unused-vars
    const contents = new Map();
    const entries = (Array.isArray(questions) ? questions : []).filter(q => q && typeof q === 'object').map(question => {
        const hash = exactHash(question);
        const { id: questionId, ...content } = question;
        contents.set(hash, content);
        return [questionId ?? null, hash];
    });
    return { title: String(title ?? ''), settings, entries, contents };
}

/** A version back as a quiz, under the quiz's current ID. */
function assembleQuiz(quizId, version, contentOf) {
    return {
        ...parseJson(version.settings),
        id: quizId,
        title: version.title,
        questions: parseJson(version.questions).map(([questionId, hash]) => ({ ...contentOf(hash), id: questionId }))
    };
}

const sameVersion = (a, b) => a.title === b.title && stableJson(parseJson(a.settings)) === stableJson(b.settings)
    && JSON.stringify(parseJson(a.questions)) === JSON.stringify(b.entries);

/**
 * Keeps this save as a version, unless nothing changed since the last one, and drops versions past
 * `keep` (with question content no remaining version shows). Gives the hashes of the stored pictures
 * that the kept versions show, so the picture cleanup counts them as used.
 */
async function recordVersion(conn, quiz, { userId = null, keep }) {
    const split = splitQuiz(quiz);
    const [[latest]] = await conn.query(
        'SELECT version, title, settings, questions FROM quiz_versions WHERE quiz_id = ? ORDER BY version DESC LIMIT 1 FOR UPDATE', [quiz.id]);
    if (!latest || !sameVersion(latest, split)) {
        if (split.contents.size) {
            await conn.query('INSERT IGNORE INTO quiz_version_questions (quiz_id, hash, content) VALUES ?',
                [[...split.contents].map(([hash, content]) => [quiz.id, hash, JSON.stringify(content)])]);
        }
        await conn.query('INSERT INTO quiz_versions (quiz_id, version, saved_by, title, settings, questions) VALUES (?, ?, ?, ?, ?, ?)',
            [quiz.id, (latest?.version ?? 0) + 1, userId, split.title.slice(0, 255), stableJson(split.settings), JSON.stringify(split.entries)]);
    }
    await pruneVersions(conn, quiz.id, keep);
    const [rows] = await conn.query('SELECT content FROM quiz_version_questions WHERE quiz_id = ?', [quiz.id]);
    const shas = rows.flatMap(row => core.imageSlots(parseJson(row.content)).map(([holder, key]) => /^\/api\/media\/([0-9a-f]{64})$/.exec(holder[key])?.[1]));
    return [...new Set(shas.filter(Boolean))];
}

/** Versions past `keep`, newest kept, and question content only they showed: all named, all this quiz's. */
async function pruneVersions(conn, quizId, keep) {
    const [versions] = await conn.query('SELECT version, questions FROM quiz_versions WHERE quiz_id = ? ORDER BY version DESC', [quizId]);
    if (versions.length <= keep) return;
    const dropped = versions.slice(keep).map(row => row.version);
    await conn.query('DELETE FROM quiz_versions WHERE quiz_id = ? AND version IN (?)', [quizId, dropped]);
    const shown = new Set(versions.slice(0, keep).flatMap(row => parseJson(row.questions).map(([, hash]) => hash)));
    const [stored] = await conn.query('SELECT hash FROM quiz_version_questions WHERE quiz_id = ?', [quizId]);
    const unshown = stored.map(row => row.hash).filter(hash => !shown.has(hash));
    if (unshown.length) await conn.query('DELETE FROM quiz_version_questions WHERE quiz_id = ? AND hash IN (?)', [quizId, unshown]);
}

async function hasVersions(conn, quizId) {
    const [[row]] = await conn.query('SELECT 1 AS n FROM quiz_versions WHERE quiz_id = ? LIMIT 1', [quizId]);
    return Boolean(row);
}

/** Newest first, without content: what the editor lists. */
async function listVersions(pool, quizId) {
    const [rows] = await pool.query(
        `SELECT v.version, v.saved_at, v.title, v.questions, u.username AS saved_by
         FROM quiz_versions v LEFT JOIN users u ON u.id = v.saved_by
         WHERE v.quiz_id = ? ORDER BY v.version DESC`, [quizId]);
    return rows.map(row => ({ version: row.version, savedAt: row.saved_at, title: row.title, savedBy: row.saved_by, questions: parseJson(row.questions).length }));
}

/** One version as a whole quiz, or null. */
async function loadVersion(pool, quizId, versionNumber) {
    const [[version]] = await pool.query('SELECT title, settings, questions FROM quiz_versions WHERE quiz_id = ? AND version = ?', [quizId, versionNumber]);
    if (!version) return null;
    const hashes = [...new Set(parseJson(version.questions).map(([, hash]) => hash))];
    const [rows] = hashes.length
        ? await pool.query('SELECT hash, content FROM quiz_version_questions WHERE quiz_id = ? AND hash IN (?)', [quizId, hashes])
        : [[]];
    const contents = new Map(rows.map(row => [row.hash, parseJson(row.content)]));
    return assembleQuiz(quizId, version, hash => contents.get(hash) || {});
}

/** A quiz deleted for good takes its versions with it. */
async function forgetQuizzes(conn, quizIds) {
    if (!ready || !quizIds.length) return;
    await conn.query('DELETE FROM quiz_versions WHERE quiz_id IN (?)', [quizIds]);
    await conn.query('DELETE FROM quiz_version_questions WHERE quiz_id IN (?)', [quizIds]);
}

module.exports = {
    ensureQuizVersions, isReady, recordVersion, hasVersions, listVersions, loadVersion, forgetQuizzes,
    stableJson, exactHash, splitQuiz, assembleQuiz
};
