// What the landing page will show, worked out the same way as GET /api/showcase in server.js

function withinWindow(startValue, endValue, now) {
    const start = startValue ? Date.parse(startValue) : NaN;
    const end = endValue ? Date.parse(endValue) : NaN;
    if (!Number.isNaN(start) && now < start) return false;
    if (!Number.isNaN(end) && now > end) return false;
    return true;
}

/** "active", "paused", "scheduled" (starts later) or "ended" */
export function itemState(item, now = Date.now()) {
    if (item.enabled === false) return "paused";
    const start = item.scheduleStart ? Date.parse(item.scheduleStart) : NaN;
    const end = item.scheduleEnd ? Date.parse(item.scheduleEnd) : NaN;
    if (!Number.isNaN(start) && now < start) return "scheduled";
    if (!Number.isNaN(end) && now > end) return "ended";
    return "active";
}

/** The list on air now: one inside its own time window first, or else the one marked live */
export function livePlaylist(settings, now = Date.now()) {
    const lists = settings.playlists;
    const timed = lists.find(list =>
        (list.scheduleStart || list.scheduleEnd) && list.items.length > 0 &&
        withinWindow(list.scheduleStart, list.scheduleEnd, now));
    if (timed) return timed;
    const marked = lists.find(list => list.id === settings.activePlaylistId);
    return marked && withinWindow(marked.scheduleStart, marked.scheduleEnd, now) ? marked : null;
}

/** The items of a list that are showing now */
export function liveItems(list, now = Date.now()) {
    return (list?.items || []).filter(item => itemState(item, now) === "active");
}

/** Moves one entry of a list, in place */
export function moveItem(items, from, to) {
    if (from === to || !items[from] || to < 0 || to >= items.length) return false;
    items.splice(to, 0, items.splice(from, 1)[0]);
    return true;
}
