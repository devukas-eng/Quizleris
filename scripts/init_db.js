const pool = require('../src/backend/db.js');
const { ensureBankSchema } = require('../src/backend/bank.js');

async function initDB() {
    console.log("Initializing database...");
    try {
        // Create users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) NOT NULL UNIQUE,
                email VARCHAR(100) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                role ENUM('teacher', 'admin', 'student') DEFAULT 'teacher',
                subscription_tier ENUM('free', 'premium') DEFAULT 'free',
                subscription_expires_at DATETIME NULL DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("✅ Users table created or already exists.");

        // Create quizzes table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS quizzes (
                id VARCHAR(50) PRIMARY KEY,
                owner_id INT,
                title VARCHAR(255) NOT NULL,
                visibility ENUM('public', 'private') DEFAULT 'private',
                quiz_data JSON NOT NULL,
                storage_bytes INT DEFAULT 0,
                expires_at TIMESTAMP NULL DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);
        console.log("✅ Quizzes table created or already exists.");

        // Students' finished attempts, one row each, found by quiz code (the server also creates this on start)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS quiz_attempts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                quiz_id VARCHAR(50) NOT NULL,
                student_name VARCHAR(80) NULL,
                score INT NOT NULL DEFAULT 0,
                max_score INT NOT NULL DEFAULT 0,
                duration_seconds INT NOT NULL DEFAULT 0,
                mode VARCHAR(20) NULL,
                details JSON NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX quiz_attempts_quiz_time (quiz_id, created_at)
            )
        `);
        console.log("✅ Quiz attempts table created or already exists.");

        // Task bank tables with their starting classifiers (the server also does this on start)
        await ensureBankSchema(pool);
        console.log("✅ Task bank tables created or already exist.");

        console.log("Database initialization complete!");
    } catch (err) {
        console.error("❌ Error initializing database:", err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

initDB();
