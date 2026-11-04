// Editor access is derived from the server-issued session (JWT + user from /api/auth/login).
// The server enforces every write; these checks only decide what UI to show.
import { getToken } from "./api.js";

export const EDITOR_ROLES = new Set(["teacher", "creator", "admin"]);

export function getStoredUser() {
    try {
        return JSON.parse(localStorage.getItem("quizleris_user"));
    } catch {
        return null;
    }
}

// True when a signed-in teacher or admin is present.
export function isAdminAccessAllowed() {
    if (!getToken()) return false;
    const user = getStoredUser();
    return !!user && EDITOR_ROLES.has(user.role);
}

// Not signed in as an editor: ask the user to log in. Returns false so callers stop.
export function promptAdminPassword() {
    document.dispatchEvent(new window.CustomEvent("open-auth"));
    return false;
}
