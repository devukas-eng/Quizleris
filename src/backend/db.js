const mysql = require('mysql2/promise');
require('dotenv').config();

// Create a connection pool for high concurrency (2026 senior concepts)
const poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10, // Hostinger shared hosting caps MySQL connections ~20-30
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
};

// Support Unix socket path (some Hostinger plans require this)
if (process.env.DB_SOCKET_PATH) {
    poolConfig.socketPath = process.env.DB_SOCKET_PATH;
    delete poolConfig.host;
}

const pool = mysql.createPool(poolConfig);

module.exports = pool;
