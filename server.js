require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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
const { seedPremadeQuizzes } = require('./src/backend/premade.js');
const { ensureBankSchema, createBankRouter, cleanupBank } = require('./src/backend/bank.js');

// Always rebuild dist/ from src/ on boot so the served frontend can never be stale,
// regardless of whether the host runs `npm run build` before `npm start`.
// A failed rebuild must not stop the API: the previous dist/ is still servable.
try {
    require('./copy-files.js');
} catch (error) {
    console.error('[BUILD] could not rebuild dist/:', error.code || error.message);
}

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
        ? ['https://spresk.eu', 'https://www.spresk.eu', 'https://quizleris.lt', 'https://www.quizleris.lt', 'https://quizleris.hostingerapp.com']
        : '*',
    optionsSuccessStatus: 200
}));
app.use(express.json({ limit: '20mb' })); // Quizzes embed base64 images, kept sharp enough to print

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

// Wrong quiz codes/IDs are counted separately so game codes can't be guessed by brute force;
// successful lookups (a class joining) don't count
const quizLookupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many wrong quiz codes. Please wait a few minutes.' }
});

// Finished attempts sent by students (a whole class behind one school IP finishes at once)
const attemptLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many results sent. Please wait a few minutes.' }
});

// --- AUTH HELPERS ---
function readToken(req) {
    const header = req.headers['authorization'];
    return header && header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Role and plan are re-read from the database on every request, so changes made in the
// database (promoting an admin, granting/expiring premium) apply without logging in again.
async function loadFreshUser(claims) {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [claims.id]);
    const row = rows[0];
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        role: row.role,
        subscription_tier: row.subscription_tier,
        subscription_expires_at: row.subscription_expires_at || null
    };
}

function verifyToken(token) {
    return new Promise(resolve => {
        jwt.verify(token, JWT_SECRET, (err, claims) => resolve(err ? null : claims));
    });
}

const authenticateToken = async (req, res, next) => {
    const token = readToken(req);
    if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });
    const claims = await verifyToken(token);
    if (!claims) return res.status(401).json({ error: 'Session expired. Please log in again.' });
    try {
        const user = await loadFreshUser(claims);
        if (!user) return res.status(401).json({ error: 'Session expired. Please log in again.' });
        req.user = user;
        next();
    } catch (error) {
        next(error);
    }
};

const optionalAuth = async (req, res, next) => {
    const token = readToken(req);
    if (!token) return next();
    const claims = await verifyToken(token);
    if (!claims) return next();
    try {
        const user = await loadFreshUser(claims);
        if (user) req.user = user;
        next();
    } catch (error) {
        next(error);
    }
};

const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    next();
};

const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', 12);

// --- PLAN LIMITS ---
const FREE_QUIZ_LIMIT = 5;
const PRIVATE_EXPIRY_DAYS = 30;

// Premium with no expiry date never lapses; with a date, it lapses once that date passes.
const hasActivePremium = (user) =>
    user.subscription_tier === 'premium' &&
    (!user.subscription_expires_at || new Date(user.subscription_expires_at) > new Date());

const isPremium = (user) => user.role === 'admin' || hasActivePremium(user);

// --- VALIDATION ---
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,50}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const QUIZ_ID_RE = /^[A-Za-z0-9_-]{1,50}$/;

// Quiz IDs are the codes students type: six characters without 0/O/1/I/L (src/storage.js makes
// them). Private quizzes stay unlisted but open for anyone with the code, just as with a share link.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{6}$`);
// Older generated IDs (quiz_ + 32 random hex) are converted to codes on startup; until then (or if
// the database user may not create the alias table) they are unguessable and open the same way
const RANDOM_ID_RE = /^quiz_[0-9a-f]{32}$/;

function generateCode() {
    return Array.from(crypto.randomBytes(6), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

// Converted quizzes keep their old ID as an alias, so old links and drafts still find them
let aliasesReady = false;
async function resolveAlias(id) {
    if (!aliasesReady) return null;
    const [rows] = await pool.query('SELECT new_id FROM quiz_id_aliases WHERE old_id = ?', [id]);
    return rows[0]?.new_id || null;
}

/** The stored quiz for a code (any letter case), ID or old alias, or null. */
async function findQuiz(rawId, columns = 'id, owner_id, title, visibility, expires_at') {
    const raw = String(rawId || '').trim();
    if (!QUIZ_ID_RE.test(raw)) return null;
    const key = CODE_RE.test(raw.toUpperCase()) ? raw.toUpperCase() : raw;
    const select = `SELECT ${columns} FROM quizzes WHERE id = ?`;
    let [rows] = await pool.query(select, [key]);
    if (!rows[0] && key !== raw) [rows] = await pool.query(select, [raw]);
    if (!rows[0]) {
        const target = await resolveAlias(raw);
        if (target) [rows] = await pool.query(select, [target]);
    }
    return rows[0] || null;
}

// Students' finished attempts: one row per attempt, found by quiz code (indexed with the time).
// Students have no accounts, so the name they typed is kept on the attempt; the per-question
// answers stay together in one JSON field so listing a class stays light.
let attemptsReady = false;
const MAX_ATTEMPT_BYTES = 3 * 1024 * 1024; // answers may include a photo of a solution
const toInt = (value, min, max, fallback = 0) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
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

// --- PROFILE ---
// Everything the dashboard needs: fresh account info, plan status, limits and the caller's own quizzes.
app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
        const row = userRows[0];
        const [quizRows] = await pool.query(`
            SELECT id, title, visibility, storage_bytes, expires_at, created_at, updated_at
            FROM quizzes WHERE owner_id = ?
            ORDER BY updated_at DESC
        `, [req.user.id]);
        // How many finished attempts each quiz has
        if (attemptsReady && quizRows.length) {
            const [counts] = await pool.query(
                'SELECT quiz_id, COUNT(*) AS attempts FROM quiz_attempts WHERE quiz_id IN (?) GROUP BY quiz_id',
                [quizRows.map(q => q.id)]
            );
            const byQuiz = new Map(counts.map(c => [c.quiz_id, Number(c.attempts)]));
            quizRows.forEach(q => { q.attempts = byQuiz.get(q.id) || 0; });
        }

        const premium = isPremium(req.user);
        res.json({
            user: {
                id: row.id,
                username: row.username,
                email: row.email,
                role: row.role,
                subscription_tier: row.subscription_tier,
                subscription_expires_at: row.subscription_expires_at || null,
                premium_active: hasActivePremium(req.user),
                created_at: row.created_at
            },
            limits: {
                max_quizzes: premium ? null : FREE_QUIZ_LIMIT,
                private_expiry_days: premium ? null : PRIVATE_EXPIRY_DAYS
            },
            quizzes: quizRows
        });
    } catch (error) {
        console.error('[ME]', error);
        res.status(500).json({ error: 'Internal server error' });
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

// Opens a quiz by its code (any letter case) or ID; converted old IDs are found through their alias
app.get('/api/quizzes/:id', quizLookupLimiter, optionalAuth, async (req, res) => {
    try {
        const raw = String(req.params.id || '').trim();
        if (!QUIZ_ID_RE.test(raw)) return res.status(404).json({ error: 'Quiz not found' });
        const key = CODE_RE.test(raw.toUpperCase()) ? raw.toUpperCase() : raw;

        const select = 'SELECT owner_id, visibility, expires_at, quiz_data FROM quizzes WHERE id = ?';
        let [rows] = await pool.query(select, [key]);
        if (!rows[0] && key !== raw) [rows] = await pool.query(select, [raw]); // a custom ID in a case-sensitive database
        if (!rows[0]) {
            const target = await resolveAlias(raw);
            if (target) [rows] = await pool.query(select, [target]);
        }
        const quiz = rows[0];
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

        const isOwner = req.user && quiz.owner_id === req.user.id;
        const isAdmin = req.user && req.user.role === 'admin';
        const isExpired = quiz.expires_at && new Date(quiz.expires_at) <= new Date();
        const isListed = quiz.visibility === 'public' || quiz.owner_id === null;
        const isCode = CODE_RE.test(key) || RANDOM_ID_RE.test(raw);

        // Private quizzes open with their code; custom IDs (guessable words) only for the owner and
        // admins, expired quizzes too. 404 (not 403) so private IDs can't be probed.
        if (!isOwner && !isAdmin && (isExpired || (!isListed && !isCode))) {
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
        const remove = (id) => (req.user.role === 'admin'
            ? pool.query('DELETE FROM quizzes WHERE id = ?', [id])
            : pool.query('DELETE FROM quizzes WHERE id = ? AND owner_id = ?', [id, req.user.id]));
        let [result] = await remove(req.params.id);
        if (result.affectedRows === 0) {
            const target = await resolveAlias(req.params.id);
            if (target) [result] = await remove(target);
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Quiz not found' });
        }
        await deleteOrphanAttempts(); // its students' attempts go with it
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
        let [existing] = await pool.query('SELECT owner_id FROM quizzes WHERE id = ?', [quizData.id]);
        if (existing.length === 0) {
            // A draft still using an old long ID saves into the quiz that ID was converted to
            const target = await resolveAlias(quizData.id);
            if (target) {
                quizData.id = target;
                [existing] = await pool.query('SELECT owner_id FROM quizzes WHERE id = ?', [target]);
            }
        }
        if (existing.length > 0 && req.user.role !== 'admin' && existing[0].owner_id !== req.user.id) {
            return res.status(409).json({ error: 'Quiz ID is already taken or you do not have permission to edit it.' });
        }

        // Free tier: limited number of quizzes; private quizzes expire
        if (!isPremium(req.user) && existing.length === 0) {
            const [countRows] = await pool.query('SELECT COUNT(*) AS cnt FROM quizzes WHERE owner_id = ?', [req.user.id]);
            if (countRows[0].cnt >= FREE_QUIZ_LIMIT) {
                return res.status(403).json({ error: `Free tier is limited to ${FREE_QUIZ_LIMIT} quizzes. Please upgrade to create more.` });
            }
        }
        let expiresAt = null;
        if (visibility === 'private' && !isPremium(req.user)) {
            expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + PRIVATE_EXPIRY_DAYS);
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

        res.json({
            message: 'Quiz saved successfully',
            id: quizData.id, // differs from the sent ID when an old ID was converted: the editor adopts it
            expires_at: expiresAt,
            storage_bytes: Buffer.byteLength(quizJsonStr, 'utf8')
        });
    } catch (error) {
        console.error('[SAVE QUIZ]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- ATTEMPTS (students' results) ---

// A student finished a quiz: store the attempt for the quiz's owner. No login needed.
app.post('/api/quizzes/:id/attempts', attemptLimiter, async (req, res) => {
    try {
        if (!attemptsReady) return res.status(503).json({ error: 'Results storage is not available' });
        const quiz = await findQuiz(req.params.id);
        if (!quiz || (quiz.expires_at && new Date(quiz.expires_at) <= new Date())) {
            return res.status(404).json({ error: 'Quiz not found' });
        }
        if (quiz.owner_id === null) return res.status(204).end(); // premade quizzes have no teacher to see results

        const body = req.body || {};
        const details = Array.isArray(body.details) ? body.details.slice(0, 500) : [];
        const detailsJson = JSON.stringify(details);
        if (Buffer.byteLength(detailsJson, 'utf8') > MAX_ATTEMPT_BYTES) {
            return res.status(413).json({ error: 'Result is too large' });
        }
        const maxScore = toInt(body.maxScore, 0, 1000);
        const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || null;
        const [result] = await pool.query(`
            INSERT INTO quiz_attempts (quiz_id, student_name, score, max_score, duration_seconds, mode, details)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            quiz.id,
            name,
            toInt(body.score, 0, maxScore),
            maxScore,
            toInt(body.durationSeconds, 0, 7 * 24 * 3600),
            String(body.mode || '').slice(0, 20) || null,
            detailsJson
        ]);
        res.status(201).json({ id: result.insertId });
    } catch (error) {
        console.error('[SAVE ATTEMPT]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Only the quiz's owner (or an admin) may see or remove its attempts
async function ownQuizForAttempts(req, res) {
    if (!attemptsReady) {
        res.status(503).json({ error: 'Results storage is not available' });
        return null;
    }
    const quiz = await findQuiz(req.params.id);
    if (!quiz || (req.user.role !== 'admin' && quiz.owner_id !== req.user.id)) {
        res.status(404).json({ error: 'Quiz not found' });
        return null;
    }
    return quiz;
}

// All attempts of a quiz, newest first; ?q= filters by student name
app.get('/api/quizzes/:id/attempts', authenticateToken, async (req, res) => {
    try {
        const quiz = await ownQuizForAttempts(req, res);
        if (!quiz) return;
        const search = String(req.query.q || '').trim().slice(0, 80);
        const params = [quiz.id];
        let where = 'quiz_id = ?';
        if (search) {
            where += ' AND student_name LIKE ?';
            params.push(`%${search.replace(/[\\%_]/g, ch => `\\${ch}`)}%`);
        }
        const [rows] = await pool.query(`
            SELECT id, student_name, score, max_score, duration_seconds, mode, created_at
            FROM quiz_attempts WHERE ${where}
            ORDER BY created_at DESC, id DESC LIMIT 2000
        `, params);
        res.json({ quiz: { id: quiz.id, title: quiz.title }, attempts: rows });
    } catch (error) {
        console.error('[LIST ATTEMPTS]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// One attempt with its per-question answers
app.get('/api/quizzes/:id/attempts/:attemptId', authenticateToken, async (req, res) => {
    try {
        const quiz = await ownQuizForAttempts(req, res);
        if (!quiz) return;
        const [rows] = await pool.query(
            'SELECT id, student_name, score, max_score, duration_seconds, mode, details, created_at FROM quiz_attempts WHERE id = ? AND quiz_id = ?',
            [toInt(req.params.attemptId, 0, Number.MAX_SAFE_INTEGER), quiz.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Attempt not found' });
        const attempt = rows[0];
        if (typeof attempt.details === 'string') attempt.details = JSON.parse(attempt.details);
        res.json({ quiz: { id: quiz.id, title: quiz.title }, attempt });
    } catch (error) {
        console.error('[GET ATTEMPT]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/quizzes/:id/attempts/:attemptId', authenticateToken, async (req, res) => {
    try {
        const quiz = await ownQuizForAttempts(req, res);
        if (!quiz) return;
        const [result] = await pool.query(
            'DELETE FROM quiz_attempts WHERE id = ? AND quiz_id = ?',
            [toInt(req.params.attemptId, 0, Number.MAX_SAFE_INTEGER), quiz.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Attempt not found' });
        res.json({ message: 'Attempt deleted' });
    } catch (error) {
        console.error('[DELETE ATTEMPT]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- TASK BANK (užduočių bankas): /api/bank/* and the pictures at /api/media/* ---
app.use('/api', createBankRouter({ pool, authenticateToken, requireAdmin }));

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

// --- SCHEMA UPKEEP ---
// MySQL 8 lacks `ADD COLUMN IF NOT EXISTS` (MariaDB-only), so check information_schema first.
async function addColumnIfMissing(table, column, definition) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    if (rows.length > 0) return;
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`[SCHEMA] added ${table}.${column}`);
}

// Quizzes made before short codes have IDs like quiz_3f2a…; give each a code and remember the old ID
// as an alias. The alias is written first: if converting fails halfway, the old ID still works.
async function convertLongIds() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS quiz_id_aliases (
            old_id VARCHAR(50) PRIMARY KEY,
            new_id VARCHAR(50) NOT NULL
        )
    `);
    aliasesReady = true;
    const [rows] = await pool.query("SELECT id, quiz_data FROM quizzes WHERE id LIKE 'quiz\\_%'");
    let converted = 0;
    for (const row of rows) {
        if (!RANDOM_ID_RE.test(row.id)) continue;
        const data = typeof row.quiz_data === 'string' ? JSON.parse(row.quiz_data) : row.quiz_data;
        for (let attempt = 0; attempt < 8; attempt++) {
            const code = generateCode();
            await pool.query(
                'INSERT INTO quiz_id_aliases (old_id, new_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE new_id = VALUES(new_id)',
                [row.id, code]
            );
            try {
                // updated_at = updated_at: a new ID is not an edit
                await pool.query(
                    'UPDATE quizzes SET id = ?, quiz_data = ?, updated_at = updated_at WHERE id = ?',
                    [code, JSON.stringify({ ...data, id: code }), row.id]
                );
                if (attemptsReady) await pool.query('UPDATE quiz_attempts SET quiz_id = ? WHERE quiz_id = ?', [code, row.id]);
                converted++;
                break;
            } catch (error) {
                if (error.code !== 'ER_DUP_ENTRY') throw error; // code taken: try another
            }
        }
    }
    if (converted > 0) console.log(`[SCHEMA] gave ${converted} quiz(zes) a short code`);
}

async function ensureSchema() {
    try {
        await addColumnIfMissing('users', 'subscription_expires_at', 'DATETIME NULL DEFAULT NULL');
    } catch (error) {
        // Non-fatal: everything treats a missing column as "premium never expires"
        console.error('[SCHEMA] could not update schema:', error.code || error.message);
    }
    try {
        const added = await seedPremadeQuizzes(pool);
        if (added > 0) console.log(`[SEED] added ${added} premade quiz(zes)`);
    } catch (error) {
        console.error('[SEED] could not seed premade quizzes:', error.code || error.message);
    }
    try {
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
        attemptsReady = true;
    } catch (error) {
        // Non-fatal: quizzes work, results just stay on the students' devices
        console.error('[SCHEMA] could not create the results table:', error.code || error.message);
    }
    try {
        await convertLongIds();
    } catch (error) {
        // Non-fatal: old long IDs keep working as they are
        console.error('[SCHEMA] could not convert old quiz IDs:', error.code || error.message);
    }
    try {
        await ensureBankSchema(pool);
    } catch (error) {
        // Non-fatal: quizzes and the editor work without the task bank
        console.error('[SCHEMA] could not set up the task bank:', error.code || error.message);
    }
}

// Attempts whose quiz is gone (deleted or expired) are deleted with it
async function deleteOrphanAttempts() {
    if (!attemptsReady) return;
    try {
        await pool.query('DELETE a FROM quiz_attempts a LEFT JOIN quizzes q ON q.id = a.quiz_id WHERE q.id IS NULL');
    } catch (error) {
        console.error('[CLEANUP] attempts:', error.code || error.message);
    }
}

// Expired private quizzes are promised to be deleted, not just hidden.
async function purgeExpiredQuizzes() {
    try {
        const [result] = await pool.query('DELETE FROM quizzes WHERE expires_at IS NOT NULL AND expires_at <= NOW()');
        if (result.affectedRows > 0) console.log(`[CLEANUP] deleted ${result.affectedRows} expired quiz(zes)`);
        await deleteOrphanAttempts();
    } catch (error) {
        console.error('[CLEANUP] failed:', error.code || error.message);
    }
    try {
        await cleanupBank(pool);
    } catch (error) {
        console.error('[CLEANUP] task bank:', error.code || error.message);
    }
}

if (process.env.NODE_ENV !== 'test') {
    ensureSchema();
    purgeExpiredQuizzes();
    setInterval(purgeExpiredQuizzes, 60 * 60 * 1000).unref();
    app.listen(PORT, () => {
        console.log(`🚀 Quizleris Backend API running on port ${PORT}`);
    });
}

module.exports = app;
