// 2026 Senior Concept: Local-First / Optimistic Syncing API Client
import { t } from "./lang.js";

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

/** Admin overview counts & settings */
export async function fetchAdminOverview() {
    const res = await adminRequest('overview');
    if (!res.ok) throw new Error(res.data?.error || 'Failed to load overview');
    return res.data;
}
/**
 * One folder of the admin's quiz browser, or a search across all of them. `params`: folder, q,
 * filter (featured, public, private, mine), offset. Gives { path, folders, quizzes, total, counts, tree }.
 */
export async function browseAdminQuizzes(params = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") search.set(key, value);
    });
    const res = await adminRequest(`quiz-browser?${search}`);
    if (!res.ok) throw new Error(res.data?.error || 'Failed to load quizzes');
    return res.data;
}
/** The quizzes with these codes, for lists that keep codes rather than quizzes */
export async function lookupAdminQuizzes(ids) {
    if (!ids.length) return [];
    const res = await adminRequest('quiz-lookup', { method: 'POST', body: JSON.stringify({ ids }) });
    if (!res.ok) throw new Error(res.data?.error || 'Failed to load quizzes');
    return res.data?.quizzes || [];
}
export const createQuizFolder = (parentId, name) =>
    adminRequest('quiz-folders', { method: 'POST', body: JSON.stringify({ parentId, name }) });
export const updateQuizFolder = (folderId, payload) =>
    adminRequest(`quiz-folders/${encodeURIComponent(folderId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
export const deleteQuizFolder = (folderId) =>
    adminRequest(`quiz-folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' });
/** Files quizzes in a folder; a null folder puts them back in their automatic place */
export const moveQuizzesToFolder = (quizIds, folderId) =>
    adminRequest('quiz-folders/items', { method: 'PUT', body: JSON.stringify({ quizIds, folderId }) });
/** Admin update quiz visibility / featured / featured_order */
export const updateAdminQuiz = (quizId, payload) =>
    adminRequest(`quizzes/${encodeURIComponent(quizId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
/** Admin update user role / subscription_tier / premium_days */
export const updateAdminUser = (userId, payload) =>
    adminRequest(`users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
/** Admin delete user account */
export const deleteAdminUser = (userId) =>
    adminRequest(`users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
/** Admin update landing-page showcase settings & order */
export const updateShowcaseSettings = (payload) =>
    adminRequest('showcase', { method: 'PUT', body: JSON.stringify(payload) });

/** Public landing-page showcase: { enabled, intervalSeconds, action, quizzes: [{ id, title, customLabel }] }, or null if it can't be reached */
export async function fetchShowcase() {
    try {
        const res = await fetch(`${API_BASE}/showcase`);
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

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

/** Sends an attempt immediately using sendBeacon or keepalive fetch, ideal when leaving or closing a quiz. */
export function submitAttemptBeacon(quizId, attempt) {
    if (!quizId) return false;
    const url = `${API_BASE}/quizzes/${encodeURIComponent(quizId)}/attempts`;
    const payload = JSON.stringify(attempt);
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        try {
            const blob = new Blob([payload], { type: 'application/json' });
            if (navigator.sendBeacon(url, blob)) return true;
        } catch {
            // fallback to fetch
        }
    }
    try {
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: payload.length < 60000
        }).catch(() => {});
        return true;
    } catch {
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

/** The refusal in the teacher's language; the server's own wording is English */
export function quizSaveError({ code, limit, error } = {}) {
    if (code === "quiz_limit") return t("admin.quizLimit").replace("{n}", limit);
    if (code === "quiz_id_taken") return t("admin.quizIdTaken");
    return error || "Failed to save";
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
            return { success: false, status: res.status, error: quizSaveError(data) };
        }
    } catch (e) {
        console.error("Cloud sync failed", e);
        return { success: false, error: "Network error" };
    }
}
