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
    if (!res.ok) throw new Error(data.error);
    
    setToken(data.token);
    localStorage.setItem('quizleris_user', JSON.stringify(data.user));
    return data.user;
}

export async function register(username, email, password) {
    const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
}

export async function fetchCloudQuizzes() {
    // Fetches public quizzes and premade quizzes
    const res = await fetch(`${API_BASE}/quizzes`);
    if (!res.ok) return [];
    return await res.json();
}

export async function fetchQuizDetails(quizId) {
    const res = await fetch(`${API_BASE}/quizzes/${quizId}`);
    if (!res.ok) return null;
    return await res.json();
}

export async function saveQuizToCloud(quizData) {
    const token = getToken();
    if (!token) return false; // Guest users just save locally
    
    try {
        const res = await fetch(`${API_BASE}/quizzes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(quizData)
        });
        return res.ok;
    } catch (e) {
        console.error("Cloud sync failed, saved locally only.", e);
        return false;
    }
}
