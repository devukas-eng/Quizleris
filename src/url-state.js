// The address bar says which page is open (?dashboard=<id> results, ?quiz=<id> a shared quiz).
// A reload and a language switch both read it, so a stale value drags the old page back: every
// way out of those pages has to clear it. The home screen does that itself (renderStartMenu).

const ROUTE_PARAMS = ["dashboard", "quiz", "preview", "view"];

/** The address without the page parameters; anything else in it stays */
export function homeUrl(href) {
    const url = new URL(href);
    ROUTE_PARAMS.forEach(param => url.searchParams.delete(param));
    if (url.pathname === "/topics") url.pathname = "/";
    return `${url.pathname}${url.search}${url.hash}`;
}

/** Takes the current page out of the address bar, without adding a history step */
export function clearRoute() {
    const next = homeUrl(window.location.href);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState({}, "", next);
}

/** Puts a quiz's results page in the address bar as a new history step */
export function pushResultsRoute(quizId) {
    window.history.pushState({}, "", `/?dashboard=${encodeURIComponent(quizId)}`);
}
