// analytics.js — Consent-gated event tracking & error logging for Quizleris

const CONSENT_KEY = 'quizleris_analytics_consent'; // 'granted' | 'declined' | null
const QUEUE_KEY = 'quizleris_event_queue';
const SESSION_KEY = 'quizleris_session_id';
const MAX_QUEUE = 200;

let sessionId = null;

// ── Consent helpers ──────────────────────────────────────────────────────────

export function hasConsent() {
    return localStorage.getItem(CONSENT_KEY) === 'granted';
}

export function hasDeclined() {
    return localStorage.getItem(CONSENT_KEY) === 'declined';
}

export function hasDecidedConsent() {
    return localStorage.getItem(CONSENT_KEY) !== null;
}

export function grantConsent() {
    localStorage.setItem(CONSENT_KEY, 'granted');
    flushAnalytics();
}

export function revokeConsent() {
    localStorage.setItem(CONSENT_KEY, 'declined');
    // Clear stored queue on decline
    localStorage.removeItem(QUEUE_KEY);
}

// ── Session ──────────────────────────────────────────────────────────────────

function getSessionId() {
    if (sessionId) return sessionId;
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
        const uuid = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID().split('-')[0] : Math.random().toString(36).substring(2, 8);
        sid = `s_${Date.now()}_${uuid}`;
        sessionStorage.setItem(SESSION_KEY, sid);
    }
    sessionId = sid;
    return sid;
}

// ── Event Queue ──────────────────────────────────────────────────────────────

function getQueue() {
    try {
        return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    } catch {
        return [];
    }
}

function saveQueue(queue) {
    try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
    } catch {
        // localStorage quota — silently drop
    }
}

// ── Core log function ────────────────────────────────────────────────────────

/**
 * Log an event.
 * @param {string} category  e.g. 'quiz', 'theme', 'error'
 * @param {string} action    e.g. 'complete', 'change', 'unhandled'
 * @param {object} [meta]    extra key/value pairs
 */
export function logEvent(category, action, meta = {}) {
    const event = {
        ts: new Date().toISOString(),
        session: getSessionId(),
        lang: localStorage.getItem('quiz_language') || 'lt',
        theme: localStorage.getItem('selected_theme') || 'emerald',
        category,
        action,
        ...meta,
    };

    if (hasConsent()) {
        // Flush immediately
        _send(event);
    } else if (!hasDeclined()) {
        // Queue for later (pre-consent — anonymous, held locally)
        const q = getQueue();
        q.push(event);
        saveQueue(q);
    }
    // If declined → silently drop
}

// ── Flush ────────────────────────────────────────────────────────────────────

export function flushAnalytics() {
    if (!hasConsent()) return;
    const q = getQueue();
    if (q.length === 0) return;
    q.forEach(ev => _send(ev));
    localStorage.removeItem(QUEUE_KEY);
}

// Internal send — swap this for fetch() to a real endpoint later
function _send(event) {
    // Structured console group (easy to grep)
    if (typeof console !== 'undefined' && console.groupCollapsed) {
        console.groupCollapsed(`[Analytics] ${event.category}:${event.action}`);
        console.log(event);
        console.groupEnd();
    }
    // Future: fetch('/api/events', { method: 'POST', body: JSON.stringify(event) });
}

// ── Error Tracking ───────────────────────────────────────────────────────────

export function initErrorTracking() {
    window.onerror = (message, source, lineno, colno, error) => {
        logEvent('error', 'uncaught', {
            message: String(message).slice(0, 300),
            source: String(source).slice(0, 200),
            lineno,
            colno,
            stack: error?.stack?.slice(0, 500) || null,
        });
        return false; // let default browser handling continue
    };

    window.addEventListener('unhandledrejection', (ev) => {
        logEvent('error', 'unhandledrejection', {
            reason: String(ev.reason?.message || ev.reason).slice(0, 300),
            stack: ev.reason?.stack?.slice(0, 500) || null,
        });
    });
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initAnalytics() {
    initErrorTracking();
    getSessionId(); // ensure session exists
    if (hasConsent()) {
        flushAnalytics();
    }
}
