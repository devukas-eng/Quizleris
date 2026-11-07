// Getting quizzes back: the deleted quizzes, kept for the plan's recovery days, and the earlier
// versions of a quiz. Both open in a window whose list has a fixed height, so nothing on the page
// grows into place while it loads. The rules live on the server (src/backend/quiz-trash.js,
// src/backend/quiz-versions.js); this only shows them.
import { listDeletedQuizzes, restoreDeletedQuiz, listQuizVersions, fetchQuizVersion } from "./api.js";
import { alertDialog } from "./dialog.js";
import { escapeHtml } from "./dom.js";
import { t, localDate } from "./lang.js";

const DAY = { year: "numeric", month: "2-digit", day: "2-digit" };
const MOMENT = { ...DAY, hour: "2-digit", minute: "2-digit" };

/** What a teacher reads before deleting, with their plan's days when known. */
export function deleteMessage(capabilities) {
    const days = capabilities?.recovery_days;
    if (!days) return t("trash.deleteConfirmPlain");
    return t(capabilities.restore_quizzes ? "trash.deleteConfirm" : "trash.deleteConfirmFree").replace("{days}", days);
}

/** A window with a title, a note, a list of fixed height and a close button. Gives its parts. */
function openWindow({ title, note, label }) {
    const overlay = document.createElement("div");
    overlay.className = "app-dialog-overlay qd-overlay";
    overlay.innerHTML = `
        <div class="app-dialog qd" role="dialog" aria-modal="true" aria-labelledby="qd-title">
            <h3 class="app-dialog-title" id="qd-title">${escapeHtml(title)}</h3>
            <p class="qd-note">${escapeHtml(note)}</p>
            <div class="qd-list" aria-live="polite" aria-label="${escapeHtml(label)}">
                ${'<div class="qd-row qd-placeholder" aria-hidden="true"></div>'.repeat(4)}
            </div>
            <div class="app-dialog-actions"><button type="button" class="btn" data-close>${escapeHtml(t("trash.close"))}</button></div>
        </div>`;
    const previous = document.activeElement;
    let onClose = () => {};
    const close = () => {
        overlay.remove();
        previous?.focus?.();
        onClose();
    };
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay || e.target.closest("[data-close]")) close();
    });
    overlay.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        close();
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("open")); // fades in
    overlay.querySelector("[data-close]").focus();
    return { list: overlay.querySelector(".qd-list"), close, whenClosed: (fn) => { onClose = fn; } };
}

const emptyHtml = (text) => `<p class="qd-empty dash-muted">${escapeHtml(text)}</p>`;

/**
 * The deleted quizzes: the caller's, or every teacher's for an admin. Premium and admins restore;
 * the free plan sees when each goes for good. `onRestored` runs once on closing if any came back.
 */
export async function openDeletedQuizzes({ capabilities, admin = false, onRestored = () => {} }) {
    const canRestore = admin || Boolean(capabilities?.restore_quizzes);
    const days = capabilities?.recovery_days;
    const note = admin ? t("trash.noteAdmin")
        : canRestore ? t("trash.notePremium").replace("{days}", days ?? 30)
            : t("trash.noteFree").replace("{days}", days ?? 14);
    const view = openWindow({ title: t("trash.title"), note, label: t("trash.title") });
    let restored = 0;
    view.whenClosed(() => { if (restored) onRestored(); });

    const res = await listDeletedQuizzes(admin);
    if (!res.ok) {
        view.list.innerHTML = emptyHtml(res.data.error || t("profile.loadError"));
        return;
    }
    const quizzes = res.data.quizzes || [];
    if (!quizzes.length) {
        view.list.innerHTML = emptyHtml(t("trash.empty"));
        return;
    }
    view.list.innerHTML = quizzes.map(q => {
        const meta = [
            t(q.reason === "expired" ? "trash.expiredOn" : "trash.deletedOn").replace("{date}", localDate(q.deleted_at, DAY)),
            t("trash.goneOn").replace("{date}", localDate(q.purge_at, DAY)),
            t("trash.questions").replace("{n}", q.questions),
            q.attempts ? t("trash.results").replace("{n}", q.attempts) : "",
            admin && !q.mine ? q.owner || "—" : ""
        ].filter(Boolean).join(" · ");
        return `
            <div class="qd-row">
                <div class="qd-main">
                    <div class="qd-title">${escapeHtml(q.title || "—")}</div>
                    <div class="qd-meta dash-muted">${escapeHtml(meta)}</div>
                </div>
                <button type="button" class="btn btn-secondary btn-compact qd-action" data-restore="${escapeHtml(q.id)}"
                    ${canRestore ? "" : `disabled title="${escapeHtml(t("trash.needsPremium"))}"`}>${escapeHtml(t("trash.restore"))}</button>
            </div>`;
    }).join("");

    view.list.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-restore]");
        if (!btn || btn.disabled) return;
        btn.disabled = true;
        const result = await restoreDeletedQuiz(btn.dataset.restore);
        if (!result.ok) {
            btn.disabled = false;
            const message = result.data.code === "quiz_id_taken" ? t("trash.codeTaken")
                : result.data.code === "restore_premium" ? t("trash.needsPremium") : result.data.error;
            await alertDialog(t("trash.restoreFailed"), message || "");
            return;
        }
        restored++;
        // The button becomes a note of the same size: the row does not change height
        btn.outerHTML = `<span class="qd-action qd-done">✓ ${escapeHtml(t("trash.restored"))}</span>`;
    });
}

/**
 * The earlier versions of a saved quiz. `onOpen(quiz, version)` gets the version picked, to load into
 * the editor; saving it there makes it the newest version.
 */
export async function openQuizVersions(quizId, { saved, keep, onOpen }) {
    const note = keep ? t("versions.note").replace("{n}", keep) : t("versions.notePlain");
    const view = openWindow({ title: t("versions.title"), note, label: t("versions.title") });
    if (!saved) {
        view.list.innerHTML = emptyHtml(t("versions.notSaved"));
        return;
    }
    const res = await listQuizVersions(quizId);
    if (!res.ok) {
        view.list.innerHTML = emptyHtml(res.status === 404 ? t("versions.notSaved") : res.data.error || t("profile.loadError"));
        return;
    }
    const versions = res.data.versions || [];
    if (!versions.length) {
        view.list.innerHTML = emptyHtml(t("versions.none"));
        return;
    }
    view.list.innerHTML = versions.map((v, i) => `
        <div class="qd-row">
            <div class="qd-main">
                <div class="qd-title">${escapeHtml(t("versions.version").replace("{n}", v.version))}${i === 0 ? ` <span class="dash-chip public">${escapeHtml(t("versions.latest"))}</span>` : ""}</div>
                <div class="qd-meta dash-muted">${escapeHtml([localDate(v.savedAt, MOMENT), t("trash.questions").replace("{n}", v.questions), v.title, v.savedBy].filter(Boolean).join(" · "))}</div>
            </div>
            <button type="button" class="btn btn-secondary btn-compact qd-action" data-version="${v.version}">${escapeHtml(t("versions.open"))}</button>
        </div>`).join("");

    view.list.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-version]");
        if (!btn || btn.disabled) return;
        btn.disabled = true;
        const result = await fetchQuizVersion(quizId, btn.dataset.version);
        if (!result.ok) {
            btn.disabled = false;
            await alertDialog(t("versions.openFailed"), result.data.error || "");
            return;
        }
        view.close();
        onOpen(result.data, Number(btn.dataset.version));
    });
}
