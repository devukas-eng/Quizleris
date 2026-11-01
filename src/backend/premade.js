const fs = require('fs');
const path = require('path');

// Premade quizzes live in the database as system quizzes (owner_id NULL, public), playable by
// entering their ID. The source data is kept server-side so answers never ship in the frontend.
const SEED_FILE = path.join(__dirname, '..', '..', 'data', 'premade-quizzes.json');

/**
 * Inserts any premade quiz that is not in the database yet. Existing rows are left alone,
 * so edits made through the editor survive restarts.
 * @returns {Promise<number>} how many quizzes were added
 */
async function seedPremadeQuizzes(pool) {
    const quizzes = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    let added = 0;
    for (const quiz of quizzes) {
        const json = JSON.stringify({ ...quiz, visibility: 'public' });
        const [result] = await pool.query(
            `INSERT IGNORE INTO quizzes (id, owner_id, title, visibility, quiz_data, storage_bytes, expires_at)
             VALUES (?, NULL, ?, 'public', ?, ?, NULL)`,
            [quiz.id, quiz.title, json, Buffer.byteLength(json, 'utf8')]
        );
        added += result.affectedRows;
    }
    return added;
}

module.exports = { seedPremadeQuizzes };
