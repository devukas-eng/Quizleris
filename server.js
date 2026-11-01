require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// --- CONFIG VALIDATION (fail fast instead of running insecurely) ---
// These values were committed to git history and must never be accepted again.
const KNOWN_LEAKED_SECRETS = new Set(['fallback_secret', 'quizleris_super_secret_jwt_key_2026']);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32 || KNOWN_LEAKED_SECRETS.has(JWT_SECRET)) {
    console.error(
        'FATAL: JWT_SECRET is missing, too short (<32 chars) or a known-leaked value.\n' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
    );
    process.exit(1);
}
for (const key of ['DB_USER', 'DB_PASS', 'DB_NAME']) {
    if (!process.env[key]) {
        console.error(`FATAL: environment variable ${key} is not set.`);
        process.exit(1);
    }
}

const pool = require('./src/backend/db.js');

// Always rebuild dist/ from src/ on boot so the served frontend can never be stale,
// regardless of whether the host runs `npm run build` before `npm start`.
require('./copy-files.js');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Trust the first proxy (Hostinger nginx) so express-rate-limit reads X-Forwarded-For correctly.
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: false, // TODO: enable with an allowlist for jsdelivr/unpkg (KaTeX, MathLive, DOMPurify)
}));
app.use(cors({
    origin: IS_PROD
        ? ['https://quizleris.lt', 'https://www.quizleris.lt', 'https://quizleris.hostingerapp.com']
        : '*',
    optionsSuccessStatus: 200
}));
app.use(express.json({ limit: '10mb' })); // Quizzes can still embed base64 images

// --- RATE LIMITING ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes and try again.' })
});
app.use('/api/auth/', authLimiter);

// Loose limit for the rest of the API (school networks share one IP behind NAT)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'School/Network limit reached. Please wait a few minutes.' }
});
app.use('/api/', apiLimiter);

// --- AUTH HELPERS ---
function readToken(req) {
    const header = req.headers['authorization'];
    return header && header.startsWith('Bearer ') ? header.slice(7) : null;
}

const authenticateToken = (req, res, next) => {
    const token = readToken(req);
    if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(401).json({ error: 'Session expired. Please log in again.' });
        req.user = user;
        next();
    });
};

const optionalAuth = (req, res, next) => {
    const token = readToken(req);
    if (!token) return next();
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (!err) req.user = user;
        next();
    });
};

const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    next();
};

const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', 12);

const isPremium = (user) => user.role === 'admin' || user.subscription_tier === 'premium';

// --- VALIDATION ---
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,50}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const QUIZ_ID_RE = /^[A-Za-z0-9_-]{1,50}$/;
const VISIBILITIES = new Set(['public', 'private']);

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body || {};
        if (typeof username !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'All fields are required.' });
        }
        if (!USERNAME_RE.test(username)) {
            return res.status(400).json({ error: 'Username must be 3–50 characters: letters, numbers, . _ -' });
        }
        if (email.length > 100 || !EMAIL_RE.test(email)) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }
        if (password.length < 8 || password.length > 128) {
            return res.status(400).json({ error: 'Password must be 8–128 characters.' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const [result] = await pool.query(
            'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
            [username, email.toLowerCase(), hashedPassword]
        );
        res.status(201).json({ message: 'User registered successfully!', userId: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Username or email already exists.' });
        }
        console.error('[REGISTER]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
            return res.status(400).json({ error: 'Username and password are required.' });
        }

        const [rows] = await pool.query(
            'SELECT id, username, role, subscription_tier, password_hash FROM users WHERE username = ?',
            [username]
        );
        const user = rows[0];
        // Always run bcrypt so response timing doesn't reveal whether the username exists
        const hash = user ? user.password_hash : DUMMY_HASH;
        const validPassword = await bcrypt.compare(password, hash);
        if (!user || !validPassword) return res.status(401).json({ error: 'Invalid username or password.' });

        const claims = {
            id: user.id,
            username: user.username,
            role: user.role,
            subscription_tier: user.subscription_tier
        };
        const token = jwt.sign(claims, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: claims });
    } catch (error) {
        console.error('[LOGIN]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- HEALTH CHECK ---
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true, db: true });
    } catch (e) {
        console.error('[HEALTH] DB check failed:', e.code || e.message);
        res.status(503).json({ ok: false, db: false });
    }
});

// --- ADMIN ROUTES ---
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, username, email, role, subscription_tier, created_at FROM users ORDER BY created_at DESC LIMIT 500'
        );
        res.json(rows);
    } catch (error) {
        console.error('[ADMIN USERS]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- QUIZ ROUTES ---
app.get('/api/quizzes', optionalAuth, async (req, res) => {
    try {
        if (req.user && req.user.role === 'admin') {
            const [rows] = await pool.query(`
                SELECT q.id, q.title, q.visibility, q.created_at, u.username AS author
                FROM quizzes q
                LEFT JOIN users u ON q.owner_id = u.id
                ORDER BY q.created_at DESC
            `);
            return res.json(rows);
        }

        // Public quizzes, system quizzes (owner_id IS NULL), and the caller's own quizzes
        const ownerId = req.user ? req.user.id : -1;
        const [rows] = await pool.query(`
            SELECT q.id, q.title, q.visibility, q.created_at, u.username AS author
            FROM quizzes q
            LEFT JOIN users u ON q.owner_id = u.id
            WHERE (q.visibility = 'public' OR q.owner_id IS NULL OR q.owner_id = ?)
              AND (q.expires_at IS NULL OR q.expires_at > NOW())
            ORDER BY q.created_at DESC LIMIT 100
        `, [ownerId]);
        res.json(rows);
    } catch (error) {
        console.error('[LIST QUIZZES]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/quizzes/:id', optionalAuth, async (req, res) => {
    try {
        if (!QUIZ_ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Quiz not found' });

        const [rows] = await pool.query(
            'SELECT owner_id, visibility, expires_at, quiz_data FROM quizzes WHERE id = ?',
            [req.params.id]
        );
        const quiz = rows[0];
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

        const isOwner = req.user && quiz.owner_id === req.user.id;
        const isAdmin = req.user && req.user.role === 'admin';
        const isExpired = quiz.expires_at && new Date(quiz.expires_at) <= new Date();
        const isListed = quiz.visibility === 'public' || quiz.owner_id === null;

        // Private or expired quizzes are only visible to their owner and admins.
        // 404 (not 403) so private IDs can't be probed.
        if (!isOwner && !isAdmin && (!isListed || isExpired)) {
            return res.status(404).json({ error: 'Quiz not found' });
        }
        res.json(quiz.quiz_data);
    } catch (error) {
        console.error('[GET QUIZ]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/quizzes/:id', authenticateToken, async (req, res) => {
    try {
        const [result] = req.user.role === 'admin'
            ? await pool.query('DELETE FROM quizzes WHERE id = ?', [req.params.id])
            : await pool.query('DELETE FROM quizzes WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Quiz not found' });
        }
        res.json({ message: 'Quiz deleted successfully' });
    } catch (error) {
        console.error('[DELETE QUIZ]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/quizzes', authenticateToken, async (req, res) => {
    try {
        const quizData = req.body;
        if (!quizData || typeof quizData !== 'object' || Array.isArray(quizData)) {
            return res.status(400).json({ error: 'Invalid quiz data payload' });
        }
        if (typeof quizData.id !== 'string' || !QUIZ_ID_RE.test(quizData.id)) {
            return res.status(400).json({ error: 'Invalid quiz ID' });
        }
        if (typeof quizData.title !== 'string' || !quizData.title.trim() || quizData.title.length > 255) {
            return res.status(400).json({ error: 'Quiz title is required (max 255 characters)' });
        }
        if (!Array.isArray(quizData.questions)) {
            return res.status(400).json({ error: 'Quiz must contain a questions list' });
        }
        const visibility = quizData.visibility || 'private';
        if (!VISIBILITIES.has(visibility)) {
            return res.status(400).json({ error: 'Invalid visibility' });
        }

        // Ownership check (IDOR prevention): only the owner or an admin may overwrite
        const [existing] = await pool.query('SELECT owner_id FROM quizzes WHERE id = ?', [quizData.id]);
        if (existing.length > 0 && req.user.role !== 'admin' && existing[0].owner_id !== req.user.id) {
            return res.status(409).json({ error: 'Quiz ID is already taken or you do not have permission to edit it.' });
        }

        // Free tier: max 5 quizzes; private quizzes expire after 30 days
        if (!isPremium(req.user) && existing.length === 0) {
            const [countRows] = await pool.query('SELECT COUNT(*) AS cnt FROM quizzes WHERE owner_id = ?', [req.user.id]);
            if (countRows[0].cnt >= 5) {
                return res.status(403).json({ error: 'Free tier is limited to 5 quizzes. Please upgrade to create more.' });
            }
        }
        let expiresAt = null;
        if (visibility === 'private' && !isPremium(req.user)) {
            expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 30);
        }

        const quizJsonStr = JSON.stringify(quizData);
        // On update, keep the original owner (an admin editing must not take ownership)
        const ownerId = existing.length > 0 ? existing[0].owner_id : req.user.id;

        await pool.query(`
            INSERT INTO quizzes (id, owner_id, title, visibility, quiz_data, storage_bytes, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                title = VALUES(title), visibility = VALUES(visibility), quiz_data = VALUES(quiz_data),
                storage_bytes = VALUES(storage_bytes), expires_at = VALUES(expires_at)
        `, [
            quizData.id,
            ownerId,
            quizData.title.trim(),
            visibility,
            quizJsonStr,
            Buffer.byteLength(quizJsonStr, 'utf8'),
            expiresAt
        ]);

        res.json({ message: 'Quiz saved successfully', id: quizData.id });
    } catch (error) {
        console.error('[SAVE QUIZ]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Unknown API routes return JSON 404 instead of the SPA HTML
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// --- STATIC FILES + SPA FALLBACK ---
const PUBLIC_DIR = path.join(__dirname, 'dist');
app.use(express.static(PUBLIC_DIR));
app.use((req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// JSON error handler (e.g. malformed JSON bodies, payload too large)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[UNHANDLED]', err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : (err.type === 'entity.too.large' ? 'Payload too large' : 'Bad request') });
});

if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`🚀 Quizleris Backend API running on port ${PORT}`);
    });
}

module.exports = app;
