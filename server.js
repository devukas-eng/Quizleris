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
const { ensureBankSchema, createBankRouter, cleanupBank, removeBankOwner, inTransaction } = require('./src/backend/bank.js');
const quizLinks = require('./src/backend/quiz-links.js');
const quizVersions = require('./src/backend/quiz-versions.js');
const quizTrash = require('./src/backend/quiz-trash.js');
const { FREE_QUIZ_LIMIT, FIRST_DAYS, KEEP_DAYS, PAUSE_DAYS, VERSIONS_KEPT, keepUntil, hasActivePremium, isPremium, planCapabilities } = require('./src/backend/plans.js');
const { cleanThemePayload } = require('./src/backend/user-themes.js');
const { ensureQuizFolderSchema, createQuizFolderRouter } = require('./src/backend/quiz-folders.js');

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
    skip: req => req.path.startsWith('/media/'),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'School/Network limit reached. Please wait a few minutes.' }
});
app.use('/api/', apiLimiter);

// Pictures have their own limit: one class starting a quiz with 20 pictures is 600 requests from one IP
const mediaLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'School/Network limit reached. Please wait a few minutes.' }
});
app.use('/api/media/', mediaLimiter);

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

// --- REGISTRATION CODES ---
// Accounts are by invitation: an admin generates single-use codes, each for a role. A creator
// (kūrėjas) is in-house staff who fill the shared task bank; teachers browse it.
const INVITE_ROLES = new Set(['teacher', 'creator']);
const INVITE_LENGTH = 9; // 31^9 ≈ 2.6e13 codes, behind the auth rate limit (same alphabet as quiz codes)
const MAX_INVITES_AT_ONCE = 50;
// Typed codes may come with spaces, dashes or lower case ("k7m3-qxp2a")
const normalizeInvite = (raw) => String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');

const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', 12);

// --- PLAN LIMITS --- (src/backend/plans.js; compared in docs/planai.md)

// --- VALIDATION ---
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,50}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const QUIZ_ID_RE = /^[A-Za-z0-9_-]{1,50}$/;

// Quiz IDs are the codes students type: six characters without 0/O/1/I/L (src/storage.js makes
// them). Private quizzes stay unlisted but open for anyone with the code, just as with a share link.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{6}$`);
const INVITE_RE = new RegExp(`^[${CODE_ALPHABET}]{${INVITE_LENGTH}}$`);
// Older generated IDs (quiz_ + 32 random hex) are converted to codes on startup; until then (or if
// the database user may not create the alias table) they are unguessable and open the same way
const RANDOM_ID_RE = /^quiz_[0-9a-f]{32}$/;

function generateCode(length = 6) {
    return Array.from(crypto.randomBytes(length), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
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
        const inviteCode = normalizeInvite(req.body.inviteCode);
        if (!inviteCode) return res.status(400).json({ error: 'A registration code is required.', code: 'invite_required' });
        if (!INVITE_RE.test(inviteCode)) return res.status(400).json({ error: 'This registration code is not valid.', code: 'invite_invalid' });
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
        // The code is claimed first, in one statement, so two people can't both use it; if the
        // account can't be made (name taken), the claim is undone and the code stays usable
        const [claim] = await pool.query(
            'UPDATE invite_codes SET used_at = NOW() WHERE code = ? AND used_at IS NULL', [inviteCode]);
        if (claim.affectedRows !== 1) {
            return res.status(400).json({ error: 'This registration code is not valid or was already used.', code: 'invite_invalid' });
        }
        let result;
        try {
            const [[invite]] = await pool.query('SELECT role FROM invite_codes WHERE code = ?', [inviteCode]);
            [result] = await pool.query(
                'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
                [username, email.toLowerCase(), hashedPassword, INVITE_ROLES.has(invite?.role) ? invite.role : 'teacher']
            );
        } catch (error) {
            await pool.query('UPDATE invite_codes SET used_at = NULL WHERE code = ? AND used_by IS NULL', [inviteCode]);
            throw error;
        }
        await pool.query('UPDATE invite_codes SET used_by = ? WHERE code = ?', [result.insertId, inviteCode]);
        res.status(201).json({ message: 'User registered successfully!', userId: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Username or email already exists.' });
        }
        if (error.code === 'ER_NO_SUCH_TABLE') {
            console.error('[REGISTER] the registration codes table is missing');
            return res.status(503).json({ error: 'Registration is not available right now.' });
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
            capabilities: planCapabilities(req.user),
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
                first_days: premium ? null : FIRST_DAYS,
                keep_days: premium ? null : KEEP_DAYS,
                pause_days: premium ? null : PAUSE_DAYS
            },
            quizzes: quizRows
        });
    } catch (error) {
        console.error('[ME]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- THEMES IN THE ACCOUNT (premium) ---
// The page keeps themes in the browser; for premium accounts it also saves them here, so the
// chosen theme and the user's own themes follow to other devices.
let userThemesReady = false;
const THEME_SYNC_DENIED = { error: 'Saving themes in the account is a premium feature.', code: 'premium_required' };

app.get('/api/me/themes', authenticateToken, async (req, res) => {
    if (!planCapabilities(req.user).theme_sync) return res.status(403).json(THEME_SYNC_DENIED);
    if (!userThemesReady) return res.status(503).json({ error: 'Themes cannot be saved right now' });
    try {
        const [rows] = await pool.query('SELECT data, updated_at FROM user_themes WHERE user_id = ?', [req.user.id]);
        if (!rows.length) return res.json({ selected: null, custom: [], updated_at: null });
        const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
        // Stored data passed the same check when it was saved; checking again costs nothing
        const clean = cleanThemePayload(data) || { selected: null, custom: [] };
        res.json({ ...clean, updated_at: rows[0].updated_at });
    } catch (error) {
        console.error('[THEMES GET]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/me/themes', authenticateToken, async (req, res) => {
    if (!planCapabilities(req.user).theme_sync) return res.status(403).json(THEME_SYNC_DENIED);
    if (!userThemesReady) return res.status(503).json({ error: 'Themes cannot be saved right now' });
    const clean = cleanThemePayload(req.body);
    if (!clean) return res.status(400).json({ error: 'Invalid themes' });
    try {
        await pool.query(
            `INSERT INTO user_themes (user_id, data) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE data = VALUES(data)`,
            [req.user.id, JSON.stringify(clean)]
        );
        res.json({ saved: true });
    } catch (error) {
        console.error('[THEMES PUT]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- ADMIN ROUTES ---
const USER_ROLES = new Set(['teacher', 'creator', 'admin']);
const USER_TIERS = new Set(['free', 'premium']);
let siteSettingsReady = false;

const ANIM_STYLES = new Set(['flip', 'slide', 'scramble', 'typewriter', 'fade']);
const DISPLAY_FORMATS = new Set(['both', 'code']);
const SHOW_ORDERS = new Set(['list', 'shuffle']);

function sanitizePlaylistItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const quizId = String(raw.quizId || raw.id || '').trim();
    if (!quizId || !QUIZ_ID_RE.test(quizId)) return null;
    return {
        quizId,
        customLabel: String(raw.customLabel || '').trim().slice(0, 80),
        scheduleStart: raw.scheduleStart ? String(raw.scheduleStart).slice(0, 32) : null,
        scheduleEnd: raw.scheduleEnd ? String(raw.scheduleEnd).slice(0, 32) : null,
        enabled: raw.enabled !== false
    };
}

function sanitizePlaylists(rawList) {
    if (!Array.isArray(rawList) || !rawList.length) {
        return [{ id: 'default', name: 'Pagrindinis', scheduleStart: null, scheduleEnd: null, items: [] }];
    }
    const out = [];
    for (const p of rawList.slice(0, 20)) {
        if (!p || typeof p !== 'object') continue;
        const id = String(p.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || `pl_${out.length + 1}`;
        const name = String(p.name || 'Skirsnis').trim().slice(0, 60) || 'Skirsnis';
        const items = Array.isArray(p.items) ? p.items.map(sanitizePlaylistItem).filter(Boolean).slice(0, 50) : [];
        out.push({
            id,
            name,
            scheduleStart: p.scheduleStart ? String(p.scheduleStart).slice(0, 32) : null,
            scheduleEnd: p.scheduleEnd ? String(p.scheduleEnd).slice(0, 32) : null,
            items
        });
    }
    if (!out.some(p => p.id === 'default')) {
        out.unshift({ id: 'default', name: 'Pagrindinis', scheduleStart: null, scheduleEnd: null, items: [] });
    }
    return out;
}

function parseScheduleDate(str) {
    if (!str) return null;
    const s = String(str).trim();
    if (!s) return null;
    // Explicit timezone offset (+02:00, -05:00) or UTC 'Z'
    if (/Z|[+-]\d{2}(:?\d{2})?$/i.test(s)) {
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    // If it's a naive ISO datetime string (YYYY-MM-DDTHH:mm...) without timezone info:
    // Interpret with Europe/Vilnius offset so times selected in the Lithuanian admin panel match
    // server time regardless of the host's native timezone (e.g. UTC on Linux/VPS).
    try {
        const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Vilnius', timeZoneName: 'shortOffset' });
        const parts = fmt.formatToParts(new Date());
        const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
        const match = tzPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
        const sign = match && match[1] === '-' ? '-' : '+';
        const offsetH = match ? String(match[2]).padStart(2, '0') : '02';
        const offsetM = match ? String(match[3] || 0).padStart(2, '0') : '00';
        const d = new Date(`${s}${sign}${offsetH}:${offsetM}`);
        if (!Number.isNaN(d.getTime())) return d;
    } catch {
        // fallback
    }
    const fallback = new Date(s);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function isWithinSchedule(startStr, endStr, now = new Date()) {
    if (startStr) {
        const s = parseScheduleDate(startStr);
        if (s && now < s) return false;
    }
    if (endStr) {
        const e = parseScheduleDate(endStr);
        if (e && now > e) return false;
    }
    return true;
}

async function readShowcaseSettings() {
    const defaults = {
        enabled: true,
        intervalSeconds: 4,
        action: 'fill',
        animStyle: 'flip',
        displayFormat: 'both',
        order: 'list',
        activePlaylistId: 'default',
        playlists: [{ id: 'default', name: 'Pagrindinis', scheduleStart: null, scheduleEnd: null, items: [] }]
    };
    if (!siteSettingsReady) return defaults;
    try {
        const [rows] = await pool.query('SELECT v FROM site_settings WHERE k = ?', ['showcase']);
        const raw = rows.length ? (typeof rows[0].v === 'string' ? JSON.parse(rows[0].v) : rows[0].v) : {};
        const playlists = sanitizePlaylists(raw?.playlists);

        // Also sync any quizzes marked featured=1 in DB into the default playlist if not in any playlist yet
        try {
            const [featRows] = await pool.query('SELECT id FROM quizzes WHERE featured = 1 ORDER BY featured_order ASC, updated_at DESC LIMIT 50');
            const knownIds = new Set(playlists.flatMap(p => p.items.map(it => it.quizId.toUpperCase())));
            const defPl = playlists.find(p => p.id === 'default') || playlists[0];
            for (const r of featRows) {
                if (!knownIds.has(String(r.id).toUpperCase())) {
                    defPl.items.push({ quizId: r.id, customLabel: '', scheduleStart: null, scheduleEnd: null, enabled: true });
                }
            }
        } catch {
            // featured column may not exist yet
        }

        const activePlaylistId = playlists.some(p => p.id === raw?.activePlaylistId) ? raw.activePlaylistId : playlists[0].id;
        return {
            enabled: raw?.enabled !== false,
            intervalSeconds: toInt(raw?.intervalSeconds, 2, 30, 4),
            action: raw?.action === 'start' ? 'start' : 'fill',
            animStyle: ANIM_STYLES.has(raw?.animStyle) ? raw.animStyle : 'flip',
            displayFormat: DISPLAY_FORMATS.has(raw?.displayFormat) ? raw.displayFormat : 'both',
            order: SHOW_ORDERS.has(raw?.order) ? raw.order : 'list',
            activePlaylistId,
            playlists
        };
    } catch {
        return defaults;
    }
}

// Everyone can read this, so it holds only what the landing page shows: never the playlists, which
// can name private quizzes that are scheduled for later
function publicShowcase(settings, quizzes = []) {
    const { enabled, intervalSeconds, action, animStyle, order } = settings;
    return { enabled, intervalSeconds, action, animStyle, order, quizzes };
}

app.get('/api/showcase', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const settings = await readShowcaseSettings();
        if (!settings.enabled) return res.json(publicShowcase(settings));

        const now = new Date();
        // Priority 1: a playlist with an explicit schedule window that is currently active
        let chosen = settings.playlists.find(p =>
            (p.scheduleStart || p.scheduleEnd) &&
            p.items.length > 0 &&
            isWithinSchedule(p.scheduleStart, p.scheduleEnd, now)
        );
        // Priority 2: the selected activePlaylistId (if within its schedule window)
        if (!chosen) {
            const active = settings.playlists.find(p => p.id === settings.activePlaylistId);
            if (active && isWithinSchedule(active.scheduleStart, active.scheduleEnd, now)) {
                chosen = active;
            }
        }
        if (!chosen) return res.json(publicShowcase(settings));

        const activeItems = chosen.items.filter(it => it.enabled !== false && isWithinSchedule(it.scheduleStart, it.scheduleEnd, now));
        if (!activeItems.length) return res.json(publicShowcase(settings));

        const ids = activeItems.map(it => it.quizId);
        const [rows] = await pool.query(`
            SELECT q.id
            FROM quizzes q
            WHERE q.id IN (?) AND (q.expires_at IS NULL OR q.expires_at > NOW())
        `, [ids]);
        const dbMap = new Map(rows.map(r => [String(r.id).toUpperCase(), r]));

        // A code whose quiz was deleted or has expired would lead students nowhere
        const quizzes = activeItems
            .filter(it => dbMap.has(String(it.quizId).toUpperCase()))
            .map(it => ({ id: dbMap.get(String(it.quizId).toUpperCase()).id }));

        res.json(publicShowcase(settings, quizzes));
    } catch (error) {
        console.error('[SHOWCASE]', error);
        res.json({ enabled: false, intervalSeconds: 4, action: 'fill', quizzes: [] });
    }
});

app.put('/api/admin/showcase', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const current = await readShowcaseSettings();
        const body = req.body || {};
        const playlists = body.playlists !== undefined ? sanitizePlaylists(body.playlists) : current.playlists;
        const activePlaylistId = playlists.some(p => p.id === body.activePlaylistId)
            ? body.activePlaylistId
            : playlists.some(p => p.id === current.activePlaylistId)
                ? current.activePlaylistId
                : playlists[0].id;
        const next = {
            enabled: body.enabled !== undefined ? Boolean(body.enabled) : current.enabled,
            intervalSeconds: body.intervalSeconds !== undefined ? toInt(body.intervalSeconds, 2, 30, 4) : current.intervalSeconds,
            action: body.action === 'start' ? 'start' : body.action === 'fill' ? 'fill' : current.action,
            animStyle: ANIM_STYLES.has(body.animStyle) ? body.animStyle : current.animStyle,
            displayFormat: DISPLAY_FORMATS.has(body.displayFormat) ? body.displayFormat : current.displayFormat,
            order: SHOW_ORDERS.has(body.order) ? body.order : current.order,
            activePlaylistId,
            playlists
        };
        if (siteSettingsReady) {
            await pool.query(
                'INSERT INTO site_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
                ['showcase', JSON.stringify(next)]
            );
        }
        // Sync quizzes.featured with all quiz IDs present across playlists
        const allFeaturedIds = [...new Set(playlists.flatMap(p => p.items.map(it => it.quizId)))];
        try {
            await pool.query('UPDATE quizzes SET featured = 0, updated_at = updated_at WHERE featured = 1');
            for (let i = 0; i < allFeaturedIds.length; i++) {
                await pool.query('UPDATE quizzes SET featured = 1, featured_order = ?, updated_at = updated_at WHERE id = ?', [i + 1, allFeaturedIds[i]]);
            }
        } catch {
            // featured column may not exist yet
        }
        res.json(next);
    } catch (error) {
        console.error('[ADMIN SHOWCASE]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/overview', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [[userCounts]] = await pool.query(`
            SELECT COUNT(*) AS total,
                   SUM(role = 'admin') AS admins,
                   SUM(role = 'creator') AS creators,
                   SUM(role = 'teacher') AS teachers,
                   SUM(subscription_tier = 'premium' AND (subscription_expires_at IS NULL OR subscription_expires_at > NOW())) AS premium,
                   COALESCE(SUM(created_at >= NOW() - INTERVAL 1 DAY), 0) AS new_today,
                   COALESCE(SUM(created_at >= NOW() - INTERVAL 7 DAY), 0) AS new_7d
            FROM users
        `);
        const [[quizCounts]] = await pool.query(`
            SELECT COUNT(*) AS total,
                   SUM(visibility = 'public') AS public_quizzes,
                   SUM(visibility = 'private') AS private_quizzes,
                   COALESCE(SUM(featured = 1), 0) AS featured_quizzes,
                   COALESCE(SUM(storage_bytes), 0) AS storage_bytes,
                   COALESCE(SUM(created_at >= NOW() - INTERVAL 1 DAY), 0) AS new_today,
                   COALESCE(SUM(created_at >= NOW() - INTERVAL 7 DAY), 0) AS new_7d
            FROM quizzes WHERE expires_at IS NULL OR expires_at > NOW()
        `).catch(async () => {
            const [[fallback]] = await pool.query(`
                SELECT COUNT(*) AS total,
                       SUM(visibility = 'public') AS public_quizzes,
                       SUM(visibility = 'private') AS private_quizzes,
                       0 AS featured_quizzes,
                       COALESCE(SUM(storage_bytes), 0) AS storage_bytes,
                       COALESCE(SUM(created_at >= NOW() - INTERVAL 1 DAY), 0) AS new_today,
                       COALESCE(SUM(created_at >= NOW() - INTERVAL 7 DAY), 0) AS new_7d
                FROM quizzes WHERE expires_at IS NULL OR expires_at > NOW()
            `);
            return [fallback];
        });
        let totalAttempts = 0;
        const analytics = {
            attemptsToday: 0,
            attempts7d: 0,
            newUsersToday: Number(userCounts?.new_today || 0),
            newUsers7d: Number(userCounts?.new_7d || 0),
            newQuizzesToday: Number(quizCounts?.new_today || 0),
            newQuizzes7d: Number(quizCounts?.new_7d || 0),
            avgScorePct: null,
            avgDurationSec: null,
            storageBytes: Number(quizCounts?.storage_bytes || 0),
            dailyAttempts: [],
            topQuizzes: [],
            recentAttempts: []
        };
        if (attemptsReady) {
            const [[att]] = await pool.query(`
                SELECT COUNT(*) AS cnt,
                       COALESCE(SUM(created_at >= NOW() - INTERVAL 1 DAY), 0) AS today,
                       COALESCE(SUM(created_at >= NOW() - INTERVAL 7 DAY), 0) AS week,
                       ROUND(AVG(CASE WHEN max_score > 0 THEN (score / max_score) * 100 ELSE NULL END)) AS avg_pct,
                       ROUND(AVG(NULLIF(duration_seconds, 0))) AS avg_dur
                FROM quiz_attempts
            `);
            totalAttempts = Number(att?.cnt || 0);
            analytics.attemptsToday = Number(att?.today || 0);
            analytics.attempts7d = Number(att?.week || 0);
            analytics.avgScorePct = att?.avg_pct != null ? Number(att.avg_pct) : null;
            analytics.avgDurationSec = att?.avg_dur != null ? Number(att.avg_dur) : null;

            const [dailyRows] = await pool.query(`
                SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS cnt
                FROM quiz_attempts
                WHERE created_at >= CURDATE() - INTERVAL 13 DAY
                GROUP BY d
                ORDER BY d ASC
            `).catch(() => [[]]);
            const byDay = new Map(dailyRows.map(r => [r.d, Number(r.cnt || 0)]));
            const today = new Date();
            for (let i = 13; i >= 0; i--) {
                const dt = new Date(today);
                dt.setDate(today.getDate() - i);
                const key = dt.toISOString().slice(0, 10);
                analytics.dailyAttempts.push({ date: key, count: byDay.get(key) || 0 });
            }

            const [topRows] = await pool.query(`
                SELECT q.id, q.title, u.username AS author,
                       COUNT(a.id) AS attempts,
                       ROUND(AVG(CASE WHEN a.max_score > 0 THEN (a.score / a.max_score) * 100 ELSE NULL END)) AS avg_pct
                FROM quiz_attempts a
                JOIN quizzes q ON q.id = a.quiz_id
                LEFT JOIN users u ON u.id = q.owner_id
                GROUP BY q.id
                ORDER BY attempts DESC
                LIMIT 5
            `).catch(() => [[]]);
            analytics.topQuizzes = topRows.map(r => ({
                id: r.id,
                title: r.title,
                author: r.author,
                attempts: Number(r.attempts || 0),
                avgPct: r.avg_pct != null ? Number(r.avg_pct) : null
            }));

            const [recRows] = await pool.query(`
                SELECT a.id, a.quiz_id, q.title AS quiz_title, a.student_name,
                       a.score, a.max_score, a.duration_seconds, a.status, a.created_at
                FROM quiz_attempts a
                LEFT JOIN quizzes q ON q.id = a.quiz_id
                ORDER BY a.created_at DESC
                LIMIT 6
            `).catch(() => pool.query(`
                SELECT a.id, a.quiz_id, q.title AS quiz_title, a.student_name,
                       a.score, a.max_score, a.duration_seconds, a.created_at
                FROM quiz_attempts a
                LEFT JOIN quizzes q ON q.id = a.quiz_id
                ORDER BY a.created_at DESC
                LIMIT 6
            `).catch(() => [[]]));
            analytics.recentAttempts = (recRows || []).map(r => ({
                id: r.id,
                quizId: r.quiz_id,
                quizTitle: r.quiz_title,
                studentName: r.student_name,
                score: Number(r.score || 0),
                maxScore: Number(r.max_score || 0),
                durationSeconds: Number(r.duration_seconds || 0),
                status: r.status || 'completed',
                createdAt: r.created_at
            }));
        }
        let bankStats = { published: 0, pendingReview: 0, openReports: 0, unsorted: 0, suggested: 0 };
        try {
            // These count what the Bank, Approvals and Reports tabs list, so a badge matches its tab
            const [[bItems]] = await pool.query(`
                SELECT SUM(status = 'published') AS published, SUM(status = 'pool') AS unsorted,
                       SUM(status = 'draft' AND id IN (SELECT item_id FROM bank_submissions WHERE status = 'pending')) AS pending_review
                FROM bank_items WHERE owner_id = 0
            `);
            const [[bPool]] = await pool.query(`
                SELECT COUNT(*) AS suggested FROM bank_pool p JOIN bank_items i ON i.id = p.item_id
                WHERE i.status = 'pool' AND p.suggested_at IS NOT NULL AND p.dismissed_at IS NULL
            `);
            const [[bRep]] = await pool.query(`
                SELECT COUNT(DISTINCT r.item_id) AS open_reports
                FROM bank_item_reports r JOIN bank_items i ON i.id = r.item_id
                WHERE r.status = 'open' AND i.owner_id = 0 AND i.status = 'published'
            `);
            bankStats = {
                published: Number(bItems?.published || 0),
                pendingReview: Number(bItems?.pending_review || 0),
                openReports: Number(bRep?.open_reports || 0),
                unsorted: Number(bItems?.unsorted || 0),
                suggested: Number(bPool?.suggested || 0)
            };
        } catch (error) {
            // The rest of the overview still loads; a wrong query must not pass for an empty bank
            console.error('[OVERVIEW] bank counts:', error.code || error.message);
        }
        const showcase = await readShowcaseSettings();
        res.json({
            users: {
                total: Number(userCounts?.total || 0),
                admins: Number(userCounts?.admins || 0),
                creators: Number(userCounts?.creators || 0),
                teachers: Number(userCounts?.teachers || 0),
                premium: Number(userCounts?.premium || 0)
            },
            quizzes: {
                total: Number(quizCounts?.total || 0),
                public: Number(quizCounts?.public_quizzes || 0),
                private: Number(quizCounts?.private_quizzes || 0),
                publicCount: Number(quizCounts?.public_quizzes || 0),
                privateCount: Number(quizCounts?.private_quizzes || 0),
                featured: Number(quizCounts?.featured_quizzes || 0),
                attempts: totalAttempts
            },
            bank: bankStats,
            showcase,
            analytics
        });
    } catch (error) {
        console.error('[ADMIN OVERVIEW]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT u.id, u.username, u.email, u.role, u.subscription_tier, u.subscription_expires_at, u.created_at,
                   COUNT(q.id) AS quiz_count
            FROM users u
            LEFT JOIN quizzes q ON q.owner_id = u.id
            GROUP BY u.id
            ORDER BY u.created_at DESC
            LIMIT 500
        `);
        res.json(rows.map(r => ({
            ...r,
            quiz_count: Number(r.quiz_count || 0),
            premium_active: hasActivePremium(r)
        })));
    } catch (error) {
        console.error('[ADMIN USERS]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.patch('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const targetId = toInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0);
        if (!targetId) return res.status(400).json({ error: 'Invalid user ID' });
        const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [targetId]);
        const target = rows[0];
        if (!target) return res.status(404).json({ error: 'User not found' });

        const body = req.body || {};
        const nextRole = USER_ROLES.has(body.role) ? body.role : target.role;
        if (targetId === req.user.id && nextRole !== 'admin') {
            return res.status(400).json({ error: 'You cannot remove your own admin role.' });
        }
        let nextTier = USER_TIERS.has(body.subscription_tier) ? body.subscription_tier : target.subscription_tier;
        let nextExpires = target.subscription_expires_at || null;
        const premDays = body.premium_days !== undefined ? body.premium_days : body.duration_days;
        if (premDays !== undefined) {
            if (premDays === null || premDays === 'forever') {
                nextTier = 'premium';
                nextExpires = null;
            } else if (Number(premDays) <= 0) {
                nextTier = 'free';
                nextExpires = null;
            } else {
                const days = toInt(premDays, 1, 3650, 30);
                const baseDate = target.subscription_expires_at && new Date(target.subscription_expires_at) > new Date()
                    ? new Date(target.subscription_expires_at)
                    : new Date();
                baseDate.setDate(baseDate.getDate() + days);
                nextTier = 'premium';
                nextExpires = baseDate;
            }
        } else if (body.subscription_tier === 'free') {
            nextExpires = null;
        }

        await pool.query(
            'UPDATE users SET role = ?, subscription_tier = ?, subscription_expires_at = ? WHERE id = ?',
            [nextRole, nextTier, nextExpires, targetId]
        );
        // If upgraded to premium/staff, lift expiry on their private quizzes immediately
        if (nextRole === 'admin' || nextRole === 'creator' || nextTier === 'premium') {
            await pool.query('UPDATE quizzes SET expires_at = NULL, updated_at = updated_at WHERE owner_id = ? AND expires_at IS NOT NULL', [targetId]);
        }
        res.json({
            id: targetId,
            role: nextRole,
            subscription_tier: nextTier,
            subscription_expires_at: nextExpires
        });
    } catch (error) {
        console.error('[ADMIN PATCH USER]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const targetId = toInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0);
        if (!targetId) return res.status(400).json({ error: 'Invalid user ID' });
        if (targetId === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
        // Deleting an account deletes its quizzes for good at once, deleted ones too: no recovery wait
        const [quizzes] = await pool.query('SELECT id FROM quizzes WHERE owner_id = ?', [targetId]);
        const [deleted] = quizTrash.isReady() ? await pool.query('SELECT id FROM deleted_quizzes WHERE owner_id = ?', [targetId]) : [[]];
        await deleteQuizzes([...quizzes, ...deleted].map(quiz => quiz.id));
        await pool.query('DELETE FROM user_themes WHERE user_id = ?', [targetId]).catch(() => {});
        await removeBankOwner(pool, targetId);
        const [result] = await pool.query('DELETE FROM users WHERE id = ?', [targetId]);
        if (!result.affectedRows) return res.status(404).json({ error: 'User not found' });
        res.json({ ok: true });
    } catch (error) {
        console.error('[ADMIN DELETE USER]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Folders of quizzes, the quiz browser and its search (src/backend/quiz-folders.js)
app.use('/api/admin', createQuizFolderRouter(pool, { attemptsReady: () => attemptsReady, guards: [authenticateToken, requireAdmin] }));

app.patch('/api/admin/quizzes/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const quiz = await findQuiz(req.params.id, 'id, visibility, featured, featured_order, quiz_data');
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
        const body = req.body || {};
        const nextVis = VISIBILITIES.has(body.visibility) ? body.visibility : quiz.visibility;
        const nextFeat = body.featured !== undefined ? (body.featured ? 1 : 0) : (quiz.featured ? 1 : 0);
        const nextOrder = body.featured_order !== undefined ? toInt(body.featured_order, 0, 1000000, 0) : (quiz.featured_order || 0);

        let quizDataStr = null;
        if (nextVis !== quiz.visibility && quiz.quiz_data) {
            const parsed = typeof quiz.quiz_data === 'string' ? JSON.parse(quiz.quiz_data) : quiz.quiz_data;
            parsed.visibility = nextVis;
            quizDataStr = JSON.stringify(parsed);
        }
        if (quizDataStr) {
            await pool.query(
                'UPDATE quizzes SET visibility = ?, featured = ?, featured_order = ?, quiz_data = ?, updated_at = updated_at WHERE id = ?',
                [nextVis, nextFeat, nextOrder, quizDataStr, quiz.id]
            );
        } else {
            await pool.query(
                'UPDATE quizzes SET visibility = ?, featured = ?, featured_order = ?, updated_at = updated_at WHERE id = ?',
                [nextVis, nextFeat, nextOrder, quiz.id]
            );
        }
        if (siteSettingsReady && body.featured !== undefined) {
            const current = await readShowcaseSettings();
            if (!nextFeat) {
                for (const pl of current.playlists) {
                    pl.items = pl.items.filter(it => String(it.quizId).toUpperCase() !== String(quiz.id).toUpperCase());
                }
            } else {
                const targetPl = current.playlists.find(p => p.id === current.activePlaylistId) || current.playlists[0];
                if (!targetPl.items.some(it => String(it.quizId).toUpperCase() === String(quiz.id).toUpperCase())) {
                    targetPl.items.push({ quizId: quiz.id, customLabel: '', scheduleStart: null, scheduleEnd: null, enabled: true });
                }
            }
            await pool.query(
                'INSERT INTO site_settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
                ['showcase', JSON.stringify(current)]
            );
        }
        res.json({ id: quiz.id, visibility: nextVis, featured: Boolean(nextFeat), featured_order: nextOrder });
    } catch (error) {
        console.error('[ADMIN PATCH QUIZ]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Registration codes: the newest first, with who used each
app.get('/api/admin/invites', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT i.code, i.role, i.note, i.created_at, i.used_at, u.username AS used_by
            FROM invite_codes i LEFT JOIN users u ON u.id = i.used_by
            ORDER BY i.created_at DESC, i.code LIMIT 300
        `);
        res.json({ invites: rows });
    } catch (error) {
        console.error('[ADMIN INVITES]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// New single-use codes for one role; `note` says whom they are for ("Jonaitė, 5 kl.")
app.post('/api/admin/invites', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const role = INVITE_ROLES.has(req.body?.role) ? req.body.role : 'teacher';
        const count = toInt(req.body?.count, 1, MAX_INVITES_AT_ONCE, 1);
        const note = String(req.body?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || null;
        const codes = [];
        while (codes.length < count) {
            const code = generateCode(INVITE_LENGTH);
            try {
                await pool.query('INSERT INTO invite_codes (code, role, note, created_by) VALUES (?, ?, ?, ?)', [code, role, note, req.user.id]);
                codes.push(code);
            } catch (error) {
                if (error.code !== 'ER_DUP_ENTRY') throw error; // taken: draw another
            }
        }
        res.status(201).json({ codes, role });
    } catch (error) {
        console.error('[ADMIN INVITES]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// An unused code can be withdrawn; a used one stays as the record of who joined with it
app.delete('/api/admin/invites/:code', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM invite_codes WHERE code = ? AND used_at IS NULL', [normalizeInvite(req.params.code)]);
        if (!result.affectedRows) return res.status(404).json({ error: 'No unused code like that' });
        res.json({ ok: true });
    } catch (error) {
        console.error('[ADMIN INVITES]', error);
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

        const select = 'SELECT owner_id, visibility, featured, expires_at, quiz_data FROM quizzes WHERE id = ?';
        let [rows] = await pool.query(select, [key]).catch(() => pool.query('SELECT owner_id, visibility, 0 AS featured, expires_at, quiz_data FROM quizzes WHERE id = ?', [key]));
        if (!rows[0] && key !== raw) [rows] = await pool.query(select, [raw]).catch(() => pool.query('SELECT owner_id, visibility, 0 AS featured, expires_at, quiz_data FROM quizzes WHERE id = ?', [raw])); // a custom ID in a case-sensitive database
        if (!rows[0]) {
            const target = await resolveAlias(raw);
            if (target) [rows] = await pool.query(select, [target]).catch(() => pool.query('SELECT owner_id, visibility, 0 AS featured, expires_at, quiz_data FROM quizzes WHERE id = ?', [target]));
        }
        const quiz = rows[0];
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

        const isOwner = req.user && quiz.owner_id === req.user.id;
        const isAdmin = req.user && req.user.role === 'admin';
        const isExpired = quiz.expires_at && new Date(quiz.expires_at) <= new Date();
        const isListed = quiz.visibility === 'public' || quiz.owner_id === null || Boolean(quiz.featured);
        const isCode = CODE_RE.test(key) || RANDOM_ID_RE.test(raw);

        // Private quizzes open with their code; custom IDs (guessable words) only for the owner and
        // admins. 404 (not 403) so private IDs can't be probed.
        if (!isOwner && !isAdmin && !isListed && !isCode) {
            return res.status(404).json({ error: 'Quiz not found' });
        }
        // A free quiz its teacher did not renew is paused: students are told so, its teacher still opens it
        if (!isOwner && !isAdmin && isExpired) {
            return res.status(404).json({ error: 'Quiz paused', code: 'quiz_paused' });
        }
        res.json(typeof quiz.quiz_data === 'string' ? JSON.parse(quiz.quiz_data) : quiz.quiz_data);
    } catch (error) {
        console.error('[GET QUIZ]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/quizzes/:id', authenticateToken, async (req, res) => {
    try {
        const quiz = await findQuiz(req.params.id, 'id, owner_id');
        if (!quiz || (req.user.role !== 'admin' && quiz.owner_id !== req.user.id)) {
            return res.status(404).json({ error: 'Quiz not found' });
        }
        // It waits among the deleted quizzes, with its results, for the owner plan's recovery days
        if (quizTrash.isReady()) await quizTrash.trashQuizzes(pool, [quiz.id], { reason: 'deleted', by: req.user.id });
        else await deleteQuizzes([quiz.id]);
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
        let [existing] = await pool.query('SELECT owner_id, created_at FROM quizzes WHERE id = ?', [quizData.id]);
        if (existing.length === 0) {
            // A draft still using an old long ID saves into the quiz that ID was converted to
            const target = await resolveAlias(quizData.id);
            if (target) {
                quizData.id = target;
                [existing] = await pool.query('SELECT owner_id, created_at FROM quizzes WHERE id = ?', [target]);
            }
        }
        if (existing.length > 0 && req.user.role !== 'admin' && existing[0].owner_id !== req.user.id) {
            return res.status(409).json({ error: 'Quiz ID is already taken or you do not have permission to edit it.', code: 'quiz_id_taken' });
        }
        // A deleted quiz keeps its code until it is gone for good. Its owner's draft saves as a new
        // quiz with a new code (the editor adopts it), so the deleted one can still be restored.
        if (existing.length === 0 && quizTrash.isReady()) {
            const [[trashed]] = await pool.query('SELECT owner_id FROM deleted_quizzes WHERE id = ?', [quizData.id]);
            if (trashed && req.user.role !== 'admin' && trashed.owner_id !== req.user.id) {
                return res.status(409).json({ error: 'Quiz ID is already taken or you do not have permission to edit it.', code: 'quiz_id_taken' });
            }
            if (trashed) {
                quizData.id = await unusedCode();
                if (!quizData.id) return res.status(409).json({ error: 'Could not find a free quiz code', code: 'quiz_id_taken' });
            }
        }

        // Free tier: limited number of quizzes; private quizzes expire
        if (!isPremium(req.user) && existing.length === 0) {
            const [countRows] = await pool.query('SELECT COUNT(*) AS cnt FROM quizzes WHERE owner_id = ?', [req.user.id]);
            if (countRows[0].cnt >= FREE_QUIZ_LIMIT) {
                return res.status(403).json({ error: `Free tier is limited to ${FREE_QUIZ_LIMIT} quizzes. Please upgrade to create more.`, code: 'quiz_limit', limit: FREE_QUIZ_LIMIT });
            }
        }
        // On the free plan a save renews the quiz, public or private: its first 30 days, then 7 more
        // from each save (keepUntil in plans.js)
        const expiresAt = isPremium(req.user) ? null : keepUntil(existing[0]?.created_at ?? null);

        // On update, keep the original owner (an admin editing must not take ownership)
        const ownerId = existing.length > 0 ? existing[0].owner_id : req.user.id;

        const writeQuiz = async (db) => {
            const quizJsonStr = JSON.stringify(quizData);
            const storageBytes = Buffer.byteLength(quizJsonStr, 'utf8');
            await db.query(`
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
                storageBytes,
                expiresAt
            ]);
            return storageBytes;
        };

        // All or nothing: a quiz or a version of it must never show a picture that no row says it
        // needs, or the cleanup would take it. Without the tables pictures simply stay inside the quiz,
        // and no versions are kept, as before.
        const linksReady = quizLinks.isReady();
        const versionsReady = quizVersions.isReady();
        let saved = { storageBytes: 0, pictures: {}, tasks: [] };
        if (linksReady || versionsReady) {
            const ownerPremium = ownerId === req.user.id ? isPremium(req.user) : await quizTrash.ownerIsPremium(pool, ownerId);
            const keep = ownerPremium ? VERSIONS_KEPT.premium : VERSIONS_KEPT.free;
            saved = await inTransaction(pool, async (conn) => {
                const pictures = linksReady ? await quizLinks.storePictures(conn, quizData) : {};
                // A quiz saved before versions existed: what it was becomes its first version
                if (versionsReady && existing.length > 0 && !(await quizVersions.hasVersions(conn, quizData.id))) {
                    const [[before]] = await conn.query('SELECT quiz_data FROM quizzes WHERE id = ? FOR UPDATE', [quizData.id]);
                    const previous = before && (typeof before.quiz_data === 'string' ? JSON.parse(before.quiz_data) : before.quiz_data);
                    if (previous) {
                        if (linksReady) await quizLinks.storePictures(conn, previous);
                        await quizVersions.recordVersion(conn, { ...previous, id: quizData.id }, { keep });
                    }
                }
                const storageBytes = await writeQuiz(conn);
                const versionPictures = versionsReady ? await quizVersions.recordVersion(conn, quizData, { userId: req.user.id, keep }) : [];
                const tasks = linksReady ? await quizLinks.linkQuiz(conn, quizData, ownerId, versionPictures) : [];
                return { storageBytes, pictures, tasks };
            });
            await quizLinks.refreshUses(pool, saved.tasks);
        } else {
            saved.storageBytes = await writeQuiz(pool);
        }

        res.json({
            message: 'Quiz saved successfully',
            id: quizData.id, // differs from the sent ID for an old ID or a deleted quiz's code: the editor adopts it
            expires_at: expiresAt,
            ...(expiresAt ? { first_days: FIRST_DAYS, keep_days: KEEP_DAYS, pause_days: PAUSE_DAYS } : {}),
            storage_bytes: saved.storageBytes,
            pictures: saved.pictures // where embedded pictures went: the editor stops carrying them
        });
    } catch (error) {
        console.error('[SAVE QUIZ]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Renew: the free plan's quiz stays for KEEP_DAYS more, and a paused one opens for students again.
// The date comes from the database, which the hourly job compares with.
app.post('/api/quizzes/:id/keep', authenticateToken, async (req, res) => {
    try {
        const quiz = await findQuiz(req.params.id, 'id, owner_id, featured');
        if (!quiz || (req.user.role !== 'admin' && quiz.owner_id !== req.user.id)) {
            return res.status(404).json({ error: 'Quiz not found' });
        }
        const forever = quiz.featured || await quizTrash.ownerIsPremium(pool, quiz.owner_id);
        if (forever) await pool.query('UPDATE quizzes SET expires_at = NULL, updated_at = updated_at WHERE id = ?', [quiz.id]);
        // Within its first 30 days renewing changes nothing; after, 7 days from now
        else await pool.query('UPDATE quizzes SET expires_at = GREATEST(created_at + INTERVAL ? DAY, NOW() + INTERVAL ? DAY), updated_at = updated_at WHERE id = ?', [FIRST_DAYS, KEEP_DAYS, quiz.id]);
        const [[row]] = await pool.query('SELECT expires_at FROM quizzes WHERE id = ?', [quiz.id]);
        res.json({ id: quiz.id, expires_at: row?.expires_at ?? null });
    } catch (error) {
        console.error('[KEEP QUIZ]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// A new code that no live or deleted quiz has, or null
async function unusedCode() {
    for (let attempt = 0; attempt < 8; attempt++) {
        const code = generateCode();
        const [[live]] = await pool.query('SELECT id FROM quizzes WHERE id = ?', [code]);
        const [[deleted]] = await pool.query('SELECT id FROM deleted_quizzes WHERE id = ?', [code]);
        if (!live && !deleted) return code;
    }
    return null;
}

// --- VERSIONS (src/backend/quiz-versions.js) ---
// Earlier versions of a live quiz, for its owner and admins. Opening one only loads it into the
// editor: saving it there makes it the newest version, so going back can itself be undone.
async function quizForVersions(req, res) {
    if (!quizVersions.isReady()) {
        res.status(503).json({ error: 'Versions are not available' });
        return null;
    }
    const quiz = await findQuiz(req.params.id, 'id, owner_id');
    if (!quiz || (req.user.role !== 'admin' && quiz.owner_id !== req.user.id)) {
        res.status(404).json({ error: 'Quiz not found' });
        return null;
    }
    return quiz;
}

app.get('/api/quizzes/:id/versions', authenticateToken, async (req, res) => {
    try {
        const quiz = await quizForVersions(req, res);
        if (quiz) res.json({ versions: await quizVersions.listVersions(pool, quiz.id) });
    } catch (error) {
        console.error('[QUIZ VERSIONS]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/quizzes/:id/versions/:version', authenticateToken, async (req, res) => {
    try {
        const quiz = await quizForVersions(req, res);
        if (!quiz) return;
        const version = await quizVersions.loadVersion(pool, quiz.id, toInt(req.params.version, 1, 1e9, 0));
        if (!version) return res.status(404).json({ error: 'Version not found' });
        res.json(version);
    } catch (error) {
        console.error('[QUIZ VERSION]', error);
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
        const status = body.status === 'quit' ? 'quit' : 'completed';
        let result;
        try {
            [result] = await pool.query(`
                INSERT INTO quiz_attempts (quiz_id, student_name, score, max_score, duration_seconds, mode, status, details)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                quiz.id,
                name,
                toInt(body.score, 0, maxScore),
                maxScore,
                toInt(body.durationSeconds, 0, 7 * 24 * 3600),
                String(body.mode || '').slice(0, 20) || null,
                status,
                detailsJson
            ]);
        } catch (insertErr) {
            if (insertErr.code === 'ER_BAD_FIELD_ERROR' || insertErr.errno === 1054) {
                [result] = await pool.query(`
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
            } else {
                throw insertErr;
            }
        }
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
        let rows;
        try {
            [rows] = await pool.query(`
                SELECT id, student_name, score, max_score, duration_seconds, mode, status, created_at
                FROM quiz_attempts WHERE ${where}
                ORDER BY created_at DESC, id DESC LIMIT 2000
            `, params);
        } catch (selectErr) {
            if (selectErr.code === 'ER_BAD_FIELD_ERROR' || selectErr.errno === 1054) {
                const [oldRows] = await pool.query(`
                    SELECT id, student_name, score, max_score, duration_seconds, mode, created_at
                    FROM quiz_attempts WHERE ${where}
                    ORDER BY created_at DESC, id DESC LIMIT 2000
                `, params);
                rows = oldRows.map(r => ({ ...r, status: 'completed' }));
            } else {
                throw selectErr;
            }
        }
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
        let rows;
        try {
            [rows] = await pool.query(
                'SELECT id, student_name, score, max_score, duration_seconds, mode, status, details, created_at FROM quiz_attempts WHERE id = ? AND quiz_id = ?',
                [toInt(req.params.attemptId, 0, Number.MAX_SAFE_INTEGER), quiz.id]
            );
        } catch (selectErr) {
            if (selectErr.code === 'ER_BAD_FIELD_ERROR' || selectErr.errno === 1054) {
                [rows] = await pool.query(
                    'SELECT id, student_name, score, max_score, duration_seconds, mode, details, created_at FROM quiz_attempts WHERE id = ? AND quiz_id = ?',
                    [toInt(req.params.attemptId, 0, Number.MAX_SAFE_INTEGER), quiz.id]
                );
                if (rows[0]) rows[0].status = 'completed';
            } else {
                throw selectErr;
            }
        }
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
app.use('/api', quizTrash.createQuizTrashRouter(pool, { authenticateToken, attemptsReady: () => attemptsReady }));
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

// users.role is an ENUM made before creators existed: add 'creator' to it (a VARCHAR column needs nothing)
async function allowCreatorRole() {
    const [[column]] = await pool.query(
        `SELECT COLUMN_TYPE AS type, COLUMN_DEFAULT AS def, IS_NULLABLE AS nullable FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
    );
    const type = String(column?.type || '');
    if (!type.toLowerCase().startsWith('enum(') || type.includes("'creator'")) return;
    const values = [...type.matchAll(/'([^']*)'/g)].map(m => m[1]);
    const list = [...values, 'creator'].map(v => pool.escape(v)).join(', ');
    // The column keeps its NULL / NOT NULL and its default (MariaDB reports the default quoted)
    const def = String(column.def ?? 'teacher').replace(/^'|'$/g, '');
    const nullability = column.nullable === 'NO' ? 'NOT NULL' : 'NULL';
    await pool.query(`ALTER TABLE users MODIFY role ENUM(${list}) ${nullability} DEFAULT ${pool.escape(def)}`);
    console.log('[SCHEMA] users.role allows creator');
}

async function ensureSchema() {
    try {
        await addColumnIfMissing('users', 'subscription_expires_at', 'DATETIME NULL DEFAULT NULL');
    } catch (error) {
        // Non-fatal: everything treats a missing column as "premium never expires"
        console.error('[SCHEMA] could not update schema:', error.code || error.message);
    }
    try {
        await allowCreatorRole();
    } catch (error) {
        // Non-fatal: creator codes then fail to register, everything else works
        console.error('[SCHEMA] could not add the creator role:', error.code || error.message);
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS invite_codes (
                code VARCHAR(16) PRIMARY KEY,
                role VARCHAR(20) NOT NULL DEFAULT 'teacher',
                note VARCHAR(120) NULL,
                created_by INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                used_at DATETIME NULL,
                used_by INT NULL,
                INDEX invite_codes_created (created_at)
            )
        `);
    } catch (error) {
        // Without the table nobody can register (codes are required); signing in still works
        console.error('[SCHEMA] could not create the registration codes table:', error.code || error.message);
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
                status VARCHAR(20) NOT NULL DEFAULT 'completed',
                details JSON NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX quiz_attempts_quiz_time (quiz_id, created_at)
            )
        `);
        try {
            await pool.query("ALTER TABLE quiz_attempts ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'completed'");
        } catch {
            // Column may already exist
        }
        attemptsReady = true;
    } catch (error) {
        // Non-fatal: quizzes work, results just stay on the students' devices
        console.error('[SCHEMA] could not create the results table:', error.code || error.message);
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_themes (
                user_id INT PRIMARY KEY,
                data JSON NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        userThemesReady = true;
    } catch (error) {
        // Non-fatal: themes then stay in each browser only
        console.error('[SCHEMA] could not create the themes table:', error.code || error.message);
    }
    try {
        await convertLongIds();
    } catch (error) {
        // Non-fatal: old long IDs keep working as they are
        console.error('[SCHEMA] could not convert old quiz IDs:', error.code || error.message);
    }
    try {
        await addColumnIfMissing('quizzes', 'featured', 'TINYINT(1) NOT NULL DEFAULT 0');
        await addColumnIfMissing('quizzes', 'featured_order', 'INT NOT NULL DEFAULT 0');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS site_settings (
                k VARCHAR(64) PRIMARY KEY,
                v JSON NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        siteSettingsReady = true;
    } catch (error) {
        console.error('[SCHEMA] could not set up featured showcase schema:', error.code || error.message);
    }
    try {
        await ensureQuizFolderSchema(pool);
    } catch (error) {
        console.error('[SCHEMA] could not set up quiz folders:', error.code || error.message);
    }
    try {
        await ensureBankSchema(pool);
    } catch (error) {
        // Non-fatal: quizzes and the editor work without the task bank
        console.error('[SCHEMA] could not set up the task bank:', error.code || error.message);
    }
    try {
        await quizTrash.ensureQuizTrash(pool);
    } catch (error) {
        // Non-fatal: deleting a quiz then deletes it for good at once, as it used to
        console.error('[SCHEMA] could not set up deleted quizzes:', error.code || error.message);
    }
    try {
        await quizVersions.ensureQuizVersions(pool);
    } catch (error) {
        // Non-fatal: saving then keeps no versions
        console.error('[SCHEMA] could not set up quiz versions:', error.code || error.message);
    }
    try {
        await quizLinks.ensureQuizLinks(pool);
    } catch (error) {
        // Non-fatal: quizzes then keep their pictures inside, and the cleanup deletes no picture
        console.error('[SCHEMA] could not set up the quiz links:', error.code || error.message);
    }
}

// A quiz for good, live or deleted, with everything that is only there for it, by name and all at
// once. Nothing in this app is deleted for not finding its parent: that would turn a failed
// conversion or a bad restore into lost results (docs/adr/0002-what-may-delete-data.md).
const deleteQuizzes = (ids) => quizTrash.purgeQuizzes(pool, ids, { attemptsReady });

// The free plan's quizzes stay while their teacher renews them (KEEP_DAYS and PAUSE_DAYS in plans.js).
// An owner with premium's limits is mirrored from isPremium in plans.js.
const PREMIUM_OWNER = `(u.role IN ('admin', 'creator')
    OR (u.subscription_tier = 'premium' AND (u.subscription_expires_at IS NULL OR u.subscription_expires_at > NOW())))`;

async function purgeExpiredQuizzes() {
    try {
        // Owners who now have premium's limits (staff, or premium granted since) keep their quizzes
        const [kept] = await pool.query(`
            UPDATE quizzes q JOIN users u ON u.id = q.owner_id
            SET q.expires_at = NULL, q.updated_at = q.updated_at
            WHERE q.expires_at IS NOT NULL AND ${PREMIUM_OWNER}
        `);
        if (kept.affectedRows > 0) console.log(`[CLEANUP] ${kept.affectedRows} quiz(zes) no longer need renewing (owner has premium)`);
        // A quiz an admin put in the showcase stays
        const [shown] = await pool.query('UPDATE quizzes SET expires_at = NULL, updated_at = updated_at WHERE expires_at IS NOT NULL AND featured = 1');
        if (shown.affectedRows > 0) console.log(`[CLEANUP] ${shown.affectedRows} showcase quiz(zes) no longer need renewing`);
        // Every other free quiz gets a renew-by date if it has none (one an admin saved, a lapsed
        // premium's, a public one from before renewing): its first 30 days, or 7 from now. Dates
        // already set, such as the old rule's 30 days, are left as they are.
        const [timed] = await pool.query(`
            UPDATE quizzes q JOIN users u ON u.id = q.owner_id
            SET q.expires_at = GREATEST(q.created_at + INTERVAL ? DAY, NOW() + INTERVAL ? DAY), q.updated_at = q.updated_at
            WHERE q.featured = 0 AND q.expires_at IS NULL AND NOT ${PREMIUM_OWNER}
        `, [FIRST_DAYS, KEEP_DAYS]);
        if (timed.affectedRows > 0) console.log(`[CLEANUP] ${timed.affectedRows} free quiz(zes) now have a renew-by date`);
    } catch (error) {
        // Without these steps a quiz that should stay could be deleted: delete nothing this round
        console.error('[CLEANUP] quizzes to keep, skipping this round:', error.code || error.message);
        return;
    }
    try {
        if (quizTrash.isReady()) {
            // Paused past PAUSE_DAYS goes for good; deleted ones past their recovery days too
            const { gone, purged } = await quizTrash.hourly(pool, { attemptsReady, pauseDays: PAUSE_DAYS });
            if (gone > 0) console.log(`[CLEANUP] deleted ${gone} quiz(zes) for good: not renewed`);
            if (purged > 0) console.log(`[CLEANUP] deleted ${purged} quiz(zes) for good after their recovery days`);
        } else {
            const [gone] = await pool.query('SELECT id FROM quizzes WHERE expires_at IS NOT NULL AND expires_at <= NOW() - INTERVAL ? DAY', [PAUSE_DAYS]);
            await deleteQuizzes(gone.map(quiz => quiz.id));
            if (gone.length > 0) console.log(`[CLEANUP] deleted ${gone.length} quiz(zes) for good: not renewed`);
        }
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
    // Cleanup waits for the schema work: it needs the tables and columns set up there
    ensureSchema().finally(() => {
        purgeExpiredQuizzes();
        setInterval(purgeExpiredQuizzes, 60 * 60 * 1000).unref();
    });
    app.listen(PORT, () => {
        console.log(`🚀 Quizleris Backend API running on port ${PORT}`);
    });
}

module.exports = app;
