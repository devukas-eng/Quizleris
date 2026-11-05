// Task bank API (/api/bank). Calls never throw: each resolves to { ok, status, data }, where status
// is 0 for a network error and -1 for a request that was aborted because a newer one replaced it.
import { getToken } from "./api.js";

const BASE = "/api/bank";
const MAX_FETCH = 200;      // the server's limit for one /items/fetch
const CACHE_LIMIT = 600;    // full tasks kept for previews and drops

async function request(path, { method = "GET", body, signal } = {}) {
    const token = getToken();
    if (!token) return { ok: false, status: 401, data: {} };
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    try {
        const res = await fetch(`${BASE}${path}`, {
            method, headers, signal,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    } catch (error) {
        return { ok: false, status: error.name === "AbortError" ? -1 : 0, data: {} };
    }
}

function query(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") continue;
        search.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
    return search.toString();
}

export const fetchAccess = () => request("/access");
export const fetchMeta = () => request("/meta");
export const listItems = (params, signal) => request(`/items?${query(params)}`, { signal });
export const sampleItems = (filter, count) => request("/sample", { method: "POST", body: { filter, count } });
export const markUsed = ids => request("/used", { method: "POST", body: { ids } });

export const createItems = (items, defaults = {}, scope = "mine") =>
    request("/items", { method: "POST", body: { scope, items, defaults } });
export const updateItems = (ids, set, scope = "mine") =>
    request("/items", { method: "PATCH", body: { scope, ids, set } });
export const archiveItems = (ids, scope = "mine") =>
    request("/items", { method: "DELETE", body: { scope, ids } });

export const listFavorites = () => request("/favorites");
export const setFavorite = (id, on) => request(`/favorites/${id}`, { method: on ? "PUT" : "DELETE" });
export const reportItem = (id, reason, note) => request(`/items/${id}/reports`, { method: "POST", body: { reason, note } });
export const closeReports = (id, status) => request(`/items/${id}/reports`, { method: "PATCH", body: { status } });

// One's own nicknames and #tags (seen by nobody else)
export const listTags = () => request("/tags");
export const setLabels = (id, labels) => request(`/labels/${id}`, { method: "PUT", body: labels });
export const tagItems = (ids, { add = [], remove = [] }) => request("/labels/tags", { method: "POST", body: { ids, add, remove } });

// Staff's own tasks into the shared bank; admins approve or reject a creator's
export const submitItems = ids => request("/submissions", { method: "POST", body: { ids } });
export const decideSubmission = (id, action, note = "") => request(`/submissions/${id}`, { method: "PATCH", body: { action, note } });

// The topic tree (admins)
export const createTopic = body => request("/topics", { method: "POST", body });
export const updateTopic = (id, body) => request(`/topics/${id}`, { method: "PATCH", body });
export const deleteTopic = id => request(`/topics/${id}`, { method: "DELETE" });
export const mergeTopic = (id, intoId) => request(`/topics/${id}/merge`, { method: "POST", body: { intoId } });
export const reorderTopics = ids => request("/topics/reorder", { method: "POST", body: { ids } });

export const listFolders = () => request("/folders");
export const createFolder = (name, parentId = null) => request("/folders", { method: "POST", body: { name, parentId } });
export const updateFolder = (id, fields) => request(`/folders/${id}`, { method: "PATCH", body: fields });
export const deleteFolder = id => request(`/folders/${id}`, { method: "DELETE" });

// Full tasks (question content and classification), fetched once and shared by the preview, drops
// and copies. A task that could not be loaded is not remembered, so the next call tries again.
const cache = new Map(); // id → Promise<task | null>

export function loadItems(ids) {
    const missing = [...new Set(ids)].filter(id => !cache.has(id));
    for (let i = 0; i < missing.length; i += MAX_FETCH) {
        const chunk = missing.slice(i, i + MAX_FETCH);
        const batch = request("/items/fetch", { method: "POST", body: { ids: chunk } })
            .then(res => new Map((res.ok ? res.data.items || [] : []).map(item => [item.id, item])));
        for (const id of chunk) {
            cache.set(id, batch.then(found => {
                if (!found.has(id)) cache.delete(id);
                return found.get(id) || null;
            }));
        }
    }
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return Promise.all(ids.map(id => cache.get(id) || Promise.resolve(null)));
}

/** Forget tasks that changed (moved, edited, removed) so they are fetched fresh. */
export function forgetItems(ids) {
    ids.forEach(id => cache.delete(id));
}
