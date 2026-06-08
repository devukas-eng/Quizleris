const pool = require('../src/backend/db.js');

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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);
        console.log("✅ Quizzes table created or already exists.");

        console.log("Database initialization complete!");
    } catch (err) {
        console.error("❌ Error initializing database:", err);
    } finally {
        process.exit();
    }
}

initDB();
