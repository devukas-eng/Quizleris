require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./src/backend/db.js');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

// Security Middlewares (2026 Senior Concepts)
// Helmet secures HTTP headers
app.use(helmet({
    contentSecurityPolicy: false, // Disabled for now to allow external scripts (KaTeX, MathLive)
}));
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allow large JSON payloads for quizzes with images

// Rate limiting to prevent brute-force and DDoS
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use('/api/', apiLimiter);

// --- AUTHENTICATION MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token.' });
        req.user = user;
        next();
    });
};

// --- AUTHENTICATION ROUTES ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).json({ error: 'All fields are required.' });

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const [result] = await pool.query(
            'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
            [username, email, hashedPassword]
        );
        
        res.status(201).json({ message: 'User registered successfully!', userId: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Username or email already exists.' });
        }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        const user = rows[0];
        
        if (!user) return res.status(400).json({ error: 'Invalid username or password.' });
        
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(400).json({ error: 'Invalid username or password.' });
        
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- QUIZ ROUTES ---
app.get('/api/quizzes', async (req, res) => {
    try {
        // Fetch public quizzes and premade system quizzes (owner_id IS NULL)
        const [rows] = await pool.query(`
            SELECT q.id, q.title, q.visibility, q.created_at, u.username as author 
            FROM quizzes q 
            LEFT JOIN users u ON q.owner_id = u.id 
            WHERE q.visibility = 'public' OR q.owner_id IS NULL
            ORDER BY q.created_at DESC LIMIT 50
        `);
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/quizzes/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT quiz_data FROM quizzes WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Quiz not found' });
        
        res.json(rows[0].quiz_data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/quizzes', authenticateToken, async (req, res) => {
    try {
        const quizData = req.body;
        if (!quizData || !quizData.id || !quizData.title) {
            return res.status(400).json({ error: 'Invalid quiz data payload' });
        }
        
        // Upsert logic (Insert or Update if exists)
        await pool.query(`
            INSERT INTO quizzes (id, owner_id, title, visibility, quiz_data) 
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            title = VALUES(title), visibility = VALUES(visibility), quiz_data = VALUES(quiz_data)
        `, [
            quizData.id, 
            req.user.id, 
            quizData.title, 
            quizData.visibility || 'private',
            JSON.stringify(quizData)
        ]);
        
        res.json({ message: 'Quiz saved successfully', id: quizData.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- STATIC FILES ---
const PUBLIC_DIR = path.join(__dirname, 'dist');
app.use(express.static(PUBLIC_DIR));

// Helper endpoint for Hostinger to create tables via browser
app.get('/api/admin/init-db', async (req, res) => {
    try {
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
        res.send('✅ Database tables initialized successfully!');
    } catch (err) {
        console.error(err);
        res.status(500).send('❌ Error: ' + err.message);
    }
});

// Fallback to index.html for SPA routing
app.use((req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Quizleris Backend API running on port ${PORT}`);
});
