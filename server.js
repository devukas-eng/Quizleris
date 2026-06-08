require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
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
// Configure Strict CORS
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://quizleris.lt', 'https://www.quizleris.lt', 'https://quizleris.hostingerapp.com'] 
        : '*',
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // Allow large JSON payloads for quizzes with images

// 1. Strict rate limiting for authentication (prevents brute-force)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 auth attempts per IP per 15 minutes
    message: { error: 'Too many login attempts from this IP, please try again after 15 minutes' }
});
app.use('/api/auth/', authLimiter);

// 2. Loose rate limiting for general API (accommodates school networks/NAT)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3000, // 3000 requests per IP per 15 mins (plenty for 100s of students)
    message: { error: 'School/Network limit reached. Please wait a few minutes.' }
});
app.use('/api/quizzes', apiLimiter);

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

        const hashedPassword = await bcrypt.hash(password, 12);
        
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
// Optional auth middleware for GET /api/quizzes
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (!err) req.user = user;
        next();
    });
};

app.get('/api/quizzes', optionalAuth, async (req, res) => {
    try {
        if (req.user && req.user.role === 'admin') {
            // Admins see EVERYTHING, including expired ones
            const [rows] = await pool.query(`
                SELECT q.id, q.title, q.visibility, q.created_at, u.username as author 
                FROM quizzes q 
                LEFT JOIN users u ON q.owner_id = u.id 
                ORDER BY q.created_at DESC
            `);
            return res.json(rows);
        }

        // Fetch public quizzes and premade system quizzes (owner_id IS NULL)
        // Filter out expired quizzes
        const [rows] = await pool.query(`
            SELECT q.id, q.title, q.visibility, q.created_at, u.username as author 
            FROM quizzes q 
            LEFT JOIN users u ON q.owner_id = u.id 
            WHERE (q.visibility = 'public' OR q.owner_id IS NULL)
            AND (q.expires_at IS NULL OR q.expires_at > NOW())
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

app.delete('/api/quizzes/:id', authenticateToken, async (req, res) => {
    try {
        // Admins can delete anything, others can only delete their own
        if (req.user.role === 'admin') {
            await pool.query('DELETE FROM quizzes WHERE id = ?', [req.params.id]);
        } else {
            const [result] = await pool.query('DELETE FROM quizzes WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);
            if (result.affectedRows === 0) {
                return res.status(403).json({ error: 'Unauthorized or quiz not found' });
            }
        }
        res.json({ message: 'Quiz deleted successfully' });
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
        
        // Check for existence, collision, and ownership (IDOR Prevention)
        const [existing] = await pool.query('SELECT owner_id FROM quizzes WHERE id = ?', [quizData.id]);
        if (existing.length > 0) {
            const currentOwnerId = existing[0].owner_id;
            // Admins can overwrite any quiz. Regular users can only overwrite their own.
            // If the owner_id doesn't match, it's a collision or malicious IDOR attempt.
            if (req.user.role !== 'admin' && currentOwnerId !== req.user.id) {
                return res.status(409).json({ error: 'Quiz ID is already taken or you do not have permission to edit it.' });
            }
        }
        
        // Enforce 5-quiz limit for Free tier
        if (req.user.role !== 'admin' && req.user.subscription_tier !== 'premium') {
            const [countRows] = await pool.query('SELECT COUNT(*) as cnt FROM quizzes WHERE owner_id = ?', [req.user.id]);
            // Only block if they are at the limit AND creating a NEW quiz
            if (countRows[0].cnt >= 5 && existing.length === 0) {
                 return res.status(403).json({ error: 'Free tier is limited to 5 quizzes. Please upgrade to create more.' });
            }
        }
        
        const visibility = quizData.visibility || 'private';
        const quizJsonStr = JSON.stringify(quizData);
        const storageBytes = Buffer.byteLength(quizJsonStr, 'utf8');
        
        // Calculate expiration: 30 days for Free Tier Private quizzes
        let expiresAt = null;
        if (visibility === 'private' && req.user.role !== 'admin' && req.user.subscription_tier !== 'premium') {
            expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 30);
        }
        
        // Upsert logic (Insert or Update if exists)
        await pool.query(`
            INSERT INTO quizzes (id, owner_id, title, visibility, quiz_data, storage_bytes, expires_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            title = VALUES(title), visibility = VALUES(visibility), quiz_data = VALUES(quiz_data), storage_bytes = VALUES(storage_bytes), expires_at = VALUES(expires_at)
        `, [
            quizData.id, 
            req.user.id, 
            quizData.title, 
            visibility,
            quizJsonStr,
            storageBytes,
            expiresAt
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

// (The /api/admin/init-db endpoint was removed for security reasons after initial migration)

// Fallback to index.html for SPA routing
app.use((req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Quizleris Backend API running on port ${PORT}`);
});
