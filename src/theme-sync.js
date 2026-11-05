// Premium accounts keep the chosen theme and their own themes on the server too (/api/me/themes),
// so both follow the teacher to other devices. Everyone else keeps them in the browser only.
//
// The first time an account syncs in a browser, the browser's own themes join the account's.
// After that the account is the record: a theme deleted on one device goes on the others too.
import { getToken } from "./api.js";
import { getCurrentUser } from "./auth-ui.js";
import { THEME_KEY, MAX_CUSTOM_THEMES, loadCustomThemes, saveCustomThemes, sanitizeTheme, savedThemeId } from "./themes.js";
import { reloadSavedTheme } from "./theme-picker.js";

// Which account this browser last synced with (so a first sync merges and later ones don't)
const SYNCED_USER_KEY = "quizleris_theme_sync_user";
const PUSH_DELAY_MS = 1200;

// "off" (signed out), "checking", "synced", "premium-required" or "error"
let status = "off";
let applying = false;
let pushTimer = null;
let lastSent = null;

export function themeSyncStatus() {
    return status;
}

function setStatus(next) {
    status = next;
    document.dispatchEvent(new window.CustomEvent("quizleris-theme-sync", { detail: { status } }));
}

async function request(method, body) {
    try {
        const res = await fetch("/api/me/themes", {
            method,
            headers: { "Authorization": `Bearer ${getToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
            body,
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    } catch {
        return { ok: false, status: 0, data: {} };
    }
}

function snapshot() {
    return JSON.stringify({ selected: savedThemeId(), custom: loadCustomThemes() });
}

async function push() {
    pushTimer = null;
    if (status !== "synced") return;
    const body = snapshot();
    if (body === lastSent) return;
    const res = await request("PUT", body);
    if (res.ok) lastSent = body;
    else if (res.status === 403) setStatus("premium-required");
    else if (res.status === 401) setStatus("off");
    else setStatus("error");
}

function schedulePush() {
    if (applying || status !== "synced") return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DELAY_MS);
}

/** Loads the account's themes into this browser (and the browser's into the account, the first time) */
async function pull() {
    clearTimeout(pushTimer);
    lastSent = null;
    const user = getCurrentUser();
    if (!user || !getToken()) { setStatus("off"); return; }
    setStatus("checking");
    const res = await request("GET");
    if (res.status === 403) { setStatus("premium-required"); return; }
    if (res.status === 401) { setStatus("off"); return; }
    if (!res.ok) { setStatus("error"); return; }

    const remote = (res.data.custom || []).map(sanitizeTheme).filter(Boolean);
    const firstHere = localStorage.getItem(SYNCED_USER_KEY) !== String(user.id);
    let custom = remote;
    if (firstHere) {
        custom = [...remote, ...loadCustomThemes().filter(local => !remote.some(r => r.id === local.id))].slice(0, MAX_CUSTOM_THEMES);
    }
    applying = true;
    try {
        saveCustomThemes(custom);
        if (res.data.selected) localStorage.setItem(THEME_KEY, res.data.selected);
        reloadSavedTheme();
    } finally {
        applying = false;
    }
    localStorage.setItem(SYNCED_USER_KEY, String(user.id));
    lastSent = JSON.stringify({ selected: res.data.selected, custom: remote });
    setStatus("synced");
    schedulePush(); // sends only if this browser added something
}

export function initThemeSync() {
    document.addEventListener("quizleris-themes-changed", schedulePush);
    document.addEventListener("quizleris-auth-changed", pull);
    pull();
}
