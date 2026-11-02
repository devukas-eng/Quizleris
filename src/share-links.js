import { t } from "./lang.js";
import { escapeHtml } from "./dom.js";

// How a saved quiz is shared. Its ID is the code students type on the home page; the student
// link opens it directly and the results link shows saved results. Used by the editor after
// saving and by the teacher dashboard.

/** Links for a saved quiz. */
export function quizLinks(id) {
    const base = `${window.location.origin}/`;
    return {
        studentUrl: `${base}?quiz=${encodeURIComponent(id)}`,
        resultsUrl: `${base}?dashboard=${encodeURIComponent(id)}`
    };
}

/** The code as a big, copyable chip. */
export function codeChipHtml(id) {
    if (!id) return "";
    return `
        <span class="share-code" title="${escapeHtml(t("share.codeHint"))}">
            <span class="share-code-label">${t("share.code")}</span>
            <strong class="share-code-value">${escapeHtml(id)}</strong>
            <button type="button" class="share-copy-icon" data-copy="${escapeHtml(id)}" aria-label="${t("admin.copy")}: ${escapeHtml(id)}" title="${t("admin.copy")}"><span class="copy-label">⧉</span></button>
        </span>`;
}

/**
 * One row of one-click copy buttons (code, student link, results link) ending with a toggle that
 * slides the full links open underneath.
 */
export function shareStripHtml(quiz) {
    const { studentUrl, resultsUrl } = quizLinks(quiz.id);
    const panelId = `links-${String(quiz.id).replace(/[^A-Za-z0-9_-]/g, "")}`;
    const pill = (icon, label, value) => `
        <button type="button" class="share-pill" data-copy="${escapeHtml(value)}" data-copied-text="${escapeHtml(t("share.copied"))}" title="${escapeHtml(value)}">
            <span aria-hidden="true">${icon}</span><span class="copy-label">${label}</span>
        </button>`;
    return `
        <div class="share-strip" data-glide>
            ${codeChipHtml(quiz.id)}
            ${pill("🔗", t("share.copyStudentLink"), studentUrl)}
            ${pill("📊", t("share.copyResultsLink"), resultsUrl)}
            <button type="button" class="share-more" data-links-toggle aria-expanded="false" aria-controls="${panelId}">
                ${t("share.links")} <span class="share-more-chevron" aria-hidden="true">▾</span>
            </button>
        </div>
        <div class="share-links-panel" id="${panelId}" aria-hidden="true">
            <div class="share-links-inner">${linkRowsHtml(quiz)}</div>
        </div>`;
}

/** Full student and results links, each with a copy button. */
export function linkRowsHtml(quiz) {
    const { studentUrl, resultsUrl } = quizLinks(quiz.id);
    const row = (label, value) => `
        <label class="admin-share-row">
            <span>${label}</span>
            <span class="admin-share-field">
                <input type="text" readonly value="${escapeHtml(value)}" />
                <button type="button" class="btn btn-secondary" data-copy="${escapeHtml(value)}">${t("admin.copy")}</button>
            </span>
        </label>`;
    return row(t("share.studentLink"), studentUrl) + row(t("share.resultsLink"), resultsUrl) +
        `<p class="admin-share-note">${t("share.resultsNote")}</p>`;
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // No clipboard permission (or an old browser): copy through a temporary text field
        const field = document.createElement("textarea");
        field.value = text;
        field.setAttribute("readonly", "");
        field.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
        document.body.appendChild(field);
        field.select();
        let ok;
        try { ok = document.execCommand("copy"); } catch { ok = false; }
        field.remove();
        return ok;
    }
}

/**
 * One delegated handler inside root: [data-copy] buttons copy and confirm with ✓,
 * [data-links-toggle] buttons slide their links panel open or closed.
 */
export function wireCopyButtons(root) {
    if (root.dataset.copyWired) return;
    root.dataset.copyWired = "true";
    root.addEventListener("click", async (e) => {
        const toggle = e.target.closest("[data-links-toggle]");
        if (toggle && root.contains(toggle)) {
            const panel = document.getElementById(toggle.getAttribute("aria-controls"));
            const open = toggle.getAttribute("aria-expanded") !== "true";
            toggle.setAttribute("aria-expanded", String(open));
            panel?.classList.toggle("open", open);
            panel?.setAttribute("aria-hidden", String(!open));
            return;
        }
        const btn = e.target.closest("[data-copy]");
        if (!btn || !root.contains(btn)) return;
        e.preventDefault();
        btn.closest(".admin-share-field")?.querySelector("input")?.select();
        const ok = await copyText(btn.dataset.copy);
        const label = btn.querySelector(".copy-label") || btn;
        if (label.dataset.copyLabel === undefined) label.dataset.copyLabel = label.textContent;
        label.textContent = ok ? (btn.dataset.copiedText || "✓") : "✗";
        btn.classList.toggle("copied", ok);
        clearTimeout(btn._copyTimer);
        btn._copyTimer = setTimeout(() => {
            label.textContent = label.dataset.copyLabel;
            btn.classList.remove("copied");
        }, 1400);
    });
}
