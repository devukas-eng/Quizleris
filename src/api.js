// 2026 Senior Concept: Local-First / Optimistic Syncing API Client

const API_BASE = '/api';

export function getToken() {
    return localStorage.getItem('quizleris_jwt');
}

export function setToken(token) {
    if (token) {
        localStorage.setItem('quizleris_jwt', token);
    } else {
        localStorage.removeItem('quizleris_jwt');
    }
}

export async function login(username, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    
    setToken(data.token);
    localStorage.setItem('quizleris_user', JSON.stringify(data.user));
    return data.user;
}

export async function register(username, email, password, inviteCode) {
    const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, inviteCode })
    });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error), { code: data.code });
    return data;
}

// --- Registration codes (admins) ---
async function adminRequest(path, options = {}) {
    try {
        const res = await fetch(`${API_BASE}/admin/${path}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` }
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    } catch {
        return { ok: false, status: 0, data: {} };
    }
}
/** { ok, data: { invites: [{ code, role, note, created_at, used_at, used_by }] } } */
export const fetchInvites = () => adminRequest('invites');
/** New single-use codes: { ok, data: { codes: [...], role } } */
export const createInvites = (role, count, note) =>
    adminRequest('invites', { method: 'POST', body: JSON.stringify({ role, count, note }) });
export const deleteInvite = (code) => adminRequest(`invites/${encodeURIComponent(code)}`, { method: 'DELETE' });

export function logout() {
    setToken(null);
    localStorage.removeItem('quizleris_user');
}

// Admin only: list registered users.
export async function fetchAllUsers() {
    const token = getToken();
    if (!token) throw new Error("Not logged in");
    const res = await fetch(`${API_BASE}/admin/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) {
        logout();
        throw new Error("Session expired. Please log in again.");
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load users");
    return data;
}

// Current user's profile, plan, limits and own quizzes (always fresh from the database).
export async function fetchProfile() {
    const token = getToken();
    if (!token) throw new Error("Not logged in");
    const res = await fetch(`${API_BASE}/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) {
        logout();
        throw new Error("Session expired. Please log in again.");
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load profile");
    // Keep the cached user in sync so role/plan changes show without logging in again
    localStorage.setItem('quizleris_user', JSON.stringify({
        id: data.user.id,
        username: data.user.username,
        role: data.user.role,
        subscription_tier: data.user.subscription_tier
    }));
    return data;
}

export async function deleteQuizFromCloud(quizId) {
    const token = getToken();
    if (!token) return { success: false, error: "Not logged in" };
    try {
        const res = await fetch(`${API_BASE}/quizzes/${encodeURIComponent(quizId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        return res.ok ? { success: true } : { success: false, error: data.error || "Failed to delete" };
    } catch (e) {
        console.error("Cloud delete failed", e);
        return { success: false, error: "Network error" };
    }
}

// --- Students' attempts ---

/** Sends a finished attempt to the quiz's teacher; failures are only logged (the local copy stays). */
export async function submitAttempt(quizId, attempt) {
    try {
        const res = await fetch(`${API_BASE}/quizzes/${encodeURIComponent(quizId)}/attempts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(attempt),
            keepalive: JSON.stringify(attempt).length < 60000 // still delivered if the tab closes right away
        });
        return res.ok;
    } catch (e) {
        console.warn("Could not send the result", e);
        return false;
    }
}

async function attemptsRequest(path, options = {}) {
    const token = getToken();
    if (!token) return { ok: false, status: 401 };
    try {
        const res = await fetch(`${API_BASE}/quizzes/${path}`, { ...options, headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    } catch {
        return { ok: false, status: 0 };
    }
}

/** A quiz's attempts for its owner: { ok, status, data: { quiz, attempts } }. */
export const fetchAttempts = (quizId, search = "") =>
    attemptsRequest(`${encodeURIComponent(quizId)}/attempts${search ? `?q=${encodeURIComponent(search)}` : ""}`);
export const fetchAttempt = (quizId, attemptId) =>
    attemptsRequest(`${encodeURIComponent(quizId)}/attempts/${encodeURIComponent(attemptId)}`);
export const deleteAttempt = (quizId, attemptId) =>
    attemptsRequest(`${encodeURIComponent(quizId)}/attempts/${encodeURIComponent(attemptId)}`, { method: 'DELETE' });

export async function fetchCloudQuizzes() {
    const token = getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Fetches public quizzes and premade quizzes (or ALL if admin)
    const res = await fetch(`${API_BASE}/quizzes`, { headers });
    if (!res.ok) return [];
    return await res.json();
}

export async function fetchQuizDetails(quizId) {
    const token = getToken();
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch(`${API_BASE}/quizzes/${encodeURIComponent(quizId)}`, { headers });
    if (!res.ok) return null;
    return await res.json();
}

export async function saveQuizToCloud(quizData) {
    const token = getToken();
    if (!token) return { success: false, error: "Not logged in" };
    
    try {
        const res = await fetch(`${API_BASE}/quizzes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(quizData)
        });
        const data = await res.json();
        if (res.ok) {
            return { success: true, ...data };
        } else {
            return { success: false, status: res.status, error: data.error || "Failed to save" };
        }
    } catch (e) {
        console.error("Cloud sync failed", e);
        return { success: false, error: "Network error" };
    }
}
