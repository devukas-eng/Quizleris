const pool = require('../src/backend/db.js');

// MySQL 8 does not support `ADD COLUMN IF NOT EXISTS` (that is MariaDB-only),
// so check information_schema before altering.
async function addColumnIfMissing(table, column, definition) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    if (rows.length > 0) {
        console.log(`• ${table}.${column} already exists`);
        return;
    }
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`✅ added ${table}.${column}`);
}

async function migrate() {
    console.log("Running migrations...");
    try {
        await addColumnIfMissing('quizzes', 'storage_bytes', 'INT DEFAULT 0');
        await addColumnIfMissing('quizzes', 'expires_at', 'TIMESTAMP NULL DEFAULT NULL');
        console.log("Migrations complete.");
    } catch (err) {
        console.error("❌ Migration error:", err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

migrate();
