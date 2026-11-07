// What a saved quiz points at (docs/adr/0001-quiz-storage-and-the-bank.md). The question text stays a
// copy in quiz_data, so a test never changes by itself and old results still fit it. Pictures are
// different: a picture's address is its hash, so sharing one is safe, and it is stored once in
// bank_media however many quizzes and tasks show it. quiz_media says which quiz needs which picture, and
// quiz_bank_links which bank task a question came from, so the server can answer what quiz_data hides.
const core = require('./bank-core.js');
const { BankError, MEDIA_URL_RE, bankIsReady, inTransaction, storeImage } = require('./bank.js');

const ASCII = 'CHARACTER SET ascii COLLATE ascii_bin';
const MAX_QUESTION_ID = 64;
const HASH_RE = /^[0-9a-f]{40}$/;
const FILL_PAGE = 10; // old quizzes can be many megabytes each, with their pictures inside
const FILLED_SETTING = 'quiz_links_filled';

let ready = false;

const isReady = () => ready;

/** The questions of a quiz as saved: the save route only checks that `questions` is a list. */
function questionsOf(quiz) {
    return (Array.isArray(quiz?.questions) ? quiz.questions : []).filter(question => question && typeof question === 'object');
}

/** How the editor finds a picture again in the answer: its question, and its choice if it has one. */
function pictureKey(question, holder) {
    return `${question.id}|${holder === question ? '' : holder.id}`;
}

/** A picture embedded in a quiz as a data URL, or null for anything else (a stored one, a web address). */
function embeddedPicture(value) {
    if (typeof value !== 'string') return null;
    if (value.startsWith('data:')) return value;
    return value.startsWith('/9j/') ? `data:image/jpeg;base64,${value}` : null; // older quizzes: bare base64 JPEG
}

/** The hashes of the stored pictures these questions show. */
function storedPictures(questions) {
    const shas = questions.flatMap(question => core.imageSlots(question).map(([holder, key]) => MEDIA_URL_RE.exec(holder[key])?.[1]));
    return [...new Set(shas.filter(Boolean))];
}

/** One row per question that came from the bank: which task, as it was then, and the question as it is now. */
function bankRefs(questions) {
    return questions.flatMap(question => {
        const itemId = core.toId(question.source?.bankId);
        const questionId = question.id;
        if (!itemId || typeof questionId !== 'string' || !questionId || questionId.length > MAX_QUESTION_ID) return [];
        const origin = question.source.hash;
        return [{ questionId, itemId, originHash: HASH_RE.test(origin) ? origin : null, questionHash: core.contentHash(question) }];
    });
}

/**
 * Moves a quiz's embedded pictures into bank_media and points the quiz at them. Gives the new
 * addresses by pictureKey, for the editor. A picture the store refuses (too large, an odd type) stays
 * in the quiz, so no save that worked before fails now.
 */
async function storePictures(conn, quiz) {
    const stored = {};
    for (const question of questionsOf(quiz)) {
        for (const [holder, key] of core.imageSlots(question)) {
            const picture = embeddedPicture(holder[key]);
            if (!picture) continue;
            try {
                holder[key] = `/api/media/${await storeImage(conn, picture)}`;
                stored[pictureKey(question, holder)] = holder[key];
            } catch (error) {
                if (!(error instanceof BankError)) throw error;
            }
        }
    }
    return stored;
}

/**
 * Records what the quiz points at, replacing what it pointed at before. Gives the bank tasks whose use
 * may have changed. Only pictures that exist and tasks its owner may read count: quiz_data comes from
 * the browser, and a question naming something else simply stays an unlinked copy.
 */
async function linkQuiz(conn, quiz, ownerId) {
    const questions = questionsOf(quiz);
    const shas = storedPictures(questions);
    const [pictures] = shas.length ? await conn.query('SELECT sha256 FROM bank_media WHERE sha256 IN (?)', [shas]) : [[]];
    await conn.query('DELETE FROM quiz_media WHERE quiz_id = ?', [quiz.id]);
    if (pictures.length) await conn.query('INSERT INTO quiz_media (quiz_id, sha256) VALUES ?', [pictures.map(row => [quiz.id, row.sha256])]);

    const refs = bankRefs(questions);
    const ids = [...new Set(refs.map(ref => ref.itemId))];
    const [items] = ids.length
        ? await conn.query('SELECT id, content_hash FROM bank_items WHERE id IN (?) AND (owner_id = 0 OR owner_id = ?)', [ids, ownerId ?? 0])
        : [[]];
    const current = new Map(items.map(item => [item.id, item.content_hash]));
    const [before] = await conn.query('SELECT DISTINCT item_id FROM quiz_bank_links WHERE quiz_id = ?', [quiz.id]);
    await conn.query('DELETE FROM quiz_bank_links WHERE quiz_id = ?', [quiz.id]);
    const rows = refs.filter(ref => current.has(ref.itemId)).map(ref => {
        // A quiz from before the note was kept: the question shows what it was only if it still matches
        const origin = ref.originHash ?? (ref.questionHash === current.get(ref.itemId) ? ref.questionHash : null);
        return [quiz.id, ref.questionId, ref.itemId, origin, ref.questionHash];
    });
    if (rows.length) {
        await conn.query('INSERT IGNORE INTO quiz_bank_links (quiz_id, question_id, item_id, origin_hash, question_hash) VALUES ?', [rows]);
    }
    return [...new Set([...before.map(row => row.item_id), ...current.keys()])];
}

/** Deleted quizzes stop counting. Gives the bank tasks they used. */
async function forgetQuizzes(conn, quizIds) {
    if (!ready || !quizIds.length) return [];
    const [items] = await conn.query('SELECT DISTINCT item_id FROM quiz_bank_links WHERE quiz_id IN (?)', [quizIds]);
    await conn.query('DELETE FROM quiz_media WHERE quiz_id IN (?)', [quizIds]);
    await conn.query('DELETE FROM quiz_bank_links WHERE quiz_id IN (?)', [quizIds]);
    return items.map(row => row.item_id);
}

/**
 * "Most used" is how many quizzes hold a task. Done after the save, not in it: only a count, so it must
 * never fail a save, and locking popular tasks inside saves could make two teachers wait on each other.
 */
async function refreshUses(pool, itemIds) {
    if (!itemIds.length) return;
    await pool.query(
        `UPDATE bank_items i
         SET i.uses = (SELECT COUNT(DISTINCT l.quiz_id) FROM quiz_bank_links l WHERE l.item_id = i.id), i.updated_at = i.updated_at
         WHERE i.id IN (?)`, [itemIds]
    ).catch(error => console.error('[QUIZ LINKS] uses:', error.code || error.message));
}

/** Once: links for the quizzes saved before these tables existed. Reads quizzes, and never changes them. */
async function fillLinks(pool) {
    const [[filled]] = await pool.query('SELECT value FROM bank_settings WHERE name = ?', [FILLED_SETTING]);
    if (filled) return;
    let last = '';
    for (;;) {
        const [rows] = await pool.query('SELECT id, owner_id, quiz_data FROM quizzes WHERE id > ? ORDER BY id LIMIT ?', [last, FILL_PAGE]);
        if (!rows.length) break;
        for (const row of rows) {
            const quiz = typeof row.quiz_data === 'string' ? JSON.parse(row.quiz_data) : row.quiz_data;
            await inTransaction(pool, conn => linkQuiz(conn, { ...quiz, id: row.id }, row.owner_id));
        }
        last = rows[rows.length - 1].id;
    }
    await pool.query(
        `UPDATE bank_items i LEFT JOIN (SELECT item_id, COUNT(DISTINCT quiz_id) AS n FROM quiz_bank_links GROUP BY item_id) l ON l.item_id = i.id
         SET i.uses = COALESCE(l.n, 0), i.updated_at = i.updated_at
         WHERE i.uses <> COALESCE(l.n, 0)`);
    await pool.query('INSERT INTO bank_settings (name, value) VALUES (?, 1) ON DUPLICATE KEY UPDATE value = 1', [FILLED_SETTING]);
    console.log('[QUIZ LINKS] linked the existing quizzes');
}

/**
 * Creates the tables, after the bank's: both point at it. No key to quizzes, whose IDs can change and
 * whose character set varies between databases; the quiz columns take the database's default, like
 * quiz_attempts. The picture's key has no ON DELETE on purpose: the database refuses to delete a
 * picture a quiz still shows, whatever the cleanup thinks.
 */
async function ensureQuizLinks(pool) {
    if (!bankIsReady()) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS quiz_media (
            quiz_id VARCHAR(50) NOT NULL,
            sha256 CHAR(64) ${ASCII} NOT NULL,
            PRIMARY KEY (quiz_id, sha256),
            INDEX quiz_media_sha (sha256),
            CONSTRAINT quiz_media_media_fk FOREIGN KEY (sha256) REFERENCES bank_media (sha256)
        ) ENGINE=InnoDB
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS quiz_bank_links (
            quiz_id VARCHAR(50) NOT NULL,
            question_id VARCHAR(${MAX_QUESTION_ID}) NOT NULL,
            item_id INT UNSIGNED NOT NULL,
            origin_hash CHAR(40) ${ASCII} NULL,
            question_hash CHAR(40) ${ASCII} NOT NULL,
            PRIMARY KEY (quiz_id, question_id),
            INDEX quiz_bank_links_item (item_id, quiz_id),
            CONSTRAINT quiz_bank_links_item_fk FOREIGN KEY (item_id) REFERENCES bank_items (id) ON DELETE CASCADE
        ) ENGINE=InnoDB
    `);
    ready = true;
    await fillLinks(pool);
}

module.exports = {
    ensureQuizLinks, isReady, storePictures, linkQuiz, forgetQuizzes, refreshUses,
    questionsOf, pictureKey, embeddedPicture, storedPictures, bankRefs
};
