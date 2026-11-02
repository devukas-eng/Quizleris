import { t } from "./lang.js";
import { escapeHtml } from "./dom.js";

// How a saved quiz is shared: its game code (typed on the home page), a short link for
// students, the results link for the teacher and the full quiz ID.
// Used by the editor after saving and by the teacher dashboard.

/** Links for a saved quiz; the student link uses the game code when the quiz has one. */
export function quizLinks({ id, pin }) {
    const base = `${window.location.origin}/`;
    return {
        studentUrl: `${base}?quiz=${encodeURIComponent(pin || id)}`,
        resultsUrl: `${base}?dashboard=${encodeURIComponent(id)}`
    };
}

/** The game code as a big, copyable chip. */
export function codeChipHtml(pin) {
    if (!pin) return "";
    return `
        <span class="share-code" title="${escapeHtml(t("share.codeHint"))}">
            <span class="share-code-label">${t("share.code")}</span>
            <strong class="share-code-value">${escapeHtml(pin)}</strong>
            <button type="button" class="share-copy-icon" data-copy="${escapeHtml(pin)}" aria-label="${t("admin.copy")}: ${escapeHtml(pin)}" title="${t("admin.copy")}">⧉</button>
        </span>`;
}

/** Link rows (student link, results link, ID), each with a copy button. */
export function linkRowsHtml(quiz) {
    const { studentUrl, resultsUrl } = quizLinks(quiz);
    const row = (label, value) => `
        <label class="admin-share-row">
            <span>${label}</span>
            <span class="admin-share-field">
                <input type="text" readonly value="${escapeHtml(value)}" />
                <button type="button" class="btn btn-secondary" data-copy="${escapeHtml(value)}">${t("admin.copy")}</button>
            </span>
        </label>`;
    return row(t("share.studentLink"), studentUrl) + row(t("share.resultsLink"), resultsUrl) + row(t("share.quizId"), quiz.id);
}

/** One delegated handler for every [data-copy] button inside root. */
export function wireCopyButtons(root) {
    if (root.dataset.copyWired) return;
    root.dataset.copyWired = "true";
    root.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-copy]");
        if (!btn || !root.contains(btn)) return;
        e.preventDefault();
        btn.closest(".admin-share-field")?.querySelector("input")?.select();
        try {
            await navigator.clipboard.writeText(btn.dataset.copy);
        } catch {
            document.execCommand?.("copy"); // older browsers / no clipboard permission: copy the selected field
        }
        if (btn.dataset.copyLabel === undefined) btn.dataset.copyLabel = btn.textContent;
        btn.textContent = "✓";
        btn.classList.add("copied");
        clearTimeout(btn._copyTimer);
        btn._copyTimer = setTimeout(() => {
            btn.textContent = btn.dataset.copyLabel;
            btn.classList.remove("copied");
        }, 1200);
    });
}
