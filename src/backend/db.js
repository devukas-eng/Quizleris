const mysql = require('mysql2/promise');
require('dotenv').config();

const poolConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
};

// On Hostinger, MySQL users are granted for 'localhost' (Unix socket only).
// TCP connections (127.0.0.1 or ::1) are rejected even with correct password.
// Use socket path unless explicitly overridden to TCP via DB_USE_TCP=true.
if (process.env.DB_USE_TCP === 'true') {
    poolConfig.host = process.env.DB_HOST || '127.0.0.1';
    poolConfig.port = parseInt(process.env.DB_PORT || '3306');
} else {
    // Default Hostinger socket path — override with DB_SOCKET_PATH if needed
    poolConfig.socketPath = process.env.DB_SOCKET_PATH || '/var/run/mysqld/mysqld.sock';
}

const pool = mysql.createPool(poolConfig);

module.exports = pool;
