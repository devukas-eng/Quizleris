// Typed DOM helper to avoid null checks later
export function getRequiredElement(id) {
    const el = document.getElementById(id);
    if (!el) {
        const msg = `CRITICAL ERROR: Root element #${id} not found in index.html`;
        alert(msg);
        throw new Error(msg);
    }
    return el;
}
// DOM refs (non-null, typed) - initialized immediately
export const questionContainer = getRequiredElement("question-container");
export const answersContainer = getRequiredElement("answers-container");
export const statusContainer = getRequiredElement("status-container");

/** Placeholder rows for a list that is on its way: they hold the space its content will take */
export function skeletonHtml(rows = 4) {
    return `<div class="dash-skeleton" aria-hidden="true">${"<span></span>".repeat(rows)}</div>`;
}

export function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}
