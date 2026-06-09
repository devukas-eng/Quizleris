const pool = require('../src/backend/db.js');

async function migrate() {
    console.log("Running migrations...");
    try {
        // Safely add storage_bytes if missing
        await pool.query(`
            ALTER TABLE quizzes 
            ADD COLUMN IF NOT EXISTS storage_bytes INT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL DEFAULT NULL
        `);
        console.log("✅ quizzes table migrated (storage_bytes, expires_at added if missing).");
    } catch (err) {
        console.error("❌ Migration error:", err.message);
    } finally {
        process.exit();
    }
}

migrate();
