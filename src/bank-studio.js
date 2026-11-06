// A creator's desk in the dashboard (and the admin's Creation tab): the feed of unsorted tasks, one's
// #tags ready to be sent to the bank, and what became of earlier sends.
import * as api from "./bank-api.js";
import { escapeHtml } from "./admin-task-cards.js";
import { openFeed } from "./bank-feed.js";
import { openSendDialog } from "./bank-send.js";
import { alertDialog } from "./dialog.js";
import { openImportDialog } from "./import-dialog.js";
import { skeletonHtml } from "./dom.js";
import { localDate, t } from "./lang.js";

const SAVE_DELAY_MS = 500;

const shortDate = value => localDate(value, { month: "long", day: "numeric" });

function batchHtml(batch) {
    const states = [
        batch.pending && `<span class="dash-chip private">⏳ ${escapeHtml(t("studio.waiting").replace("{n}", batch.pending))}</span>`,
        batch.approved && `<span class="dash-chip public">✓ ${escapeHtml(t("studio.accepted").replace("{n}", batch.approved))}</span>`,
        batch.rejected && `<span class="dash-chip studio-rejected">✕ ${escapeHtml(t("studio.rejected").replace("{n}", batch.rejected))}</span>`,
    ].filter(Boolean).join("");
    return `
        <div class="studio-row">
            <div class="studio-row-main">
                <div class="studio-row-title">${batch.tag ? `#${escapeHtml(batch.tag)}` : escapeHtml(t("studio.singleSend"))} <span class="dash-muted">· ${escapeHtml(t("studio.tasks").replace("{n}", batch.count))} · ${escapeHtml(shortDate(batch.createdAt))}</span></div>
                ${batch.reason ? `<div class="studio-reason">${escapeHtml(batch.reason)}</div>` : ""}
            </div>
            <div class="studio-row-states">${states}</div>
        </div>
    `;
}

/** Fills `el` with the desk. `admin` adds the numbers that decide what votes do. */
export async function renderStudio(el, { admin = false, onChange = () => {} } = {}) {
    el.innerHTML = skeletonHtml(4);
    const [stats, tags, batches] = await Promise.all([api.poolStats(), api.listTags(), api.listBatches()]);
    if (!el.isConnected) return;
    if (!stats.ok) {
        el.innerHTML = `<div class="dash-empty"><p class="dash-muted">${escapeHtml(t("bank.loadFailed"))}</p></div>`;
        return;
    }
    const { total, rated, limits } = stats.data;
    const tagRows = tags.ok ? tags.data.tags || [] : [];
    const sends = batches.ok ? batches.data.batches || [] : [];

    el.innerHTML = `
        <section class="dash-section studio-feed">
            <div class="studio-feed-text">
                <h3>🎲 ${escapeHtml(t("feed.title"))}</h3>
                <p class="dash-muted">${escapeHtml(t("studio.feedIntro"))}</p>
                <p class="studio-feed-count">${escapeHtml(t("studio.feedCount").replace("{n}", total).replace("{m}", Math.max(0, total - rated)))}</p>
            </div>
            <div class="studio-feed-actions">
                <button type="button" class="btn btn-primary" data-act="feed"${total ? "" : " disabled"}>${escapeHtml(t("studio.startFeed"))}</button>
                <button type="button" class="btn btn-secondary" data-act="import">⬆ ${escapeHtml(t("studio.import"))}</button>
            </div>
            ${admin ? `<form class="studio-limits">
                <label>${escapeHtml(t("studio.limitDislikes"))}<input type="number" class="input-field" name="dislikes" min="1" max="1000" value="${limits.dislikes}"></label>
                <label>${escapeHtml(t("studio.limitLikes"))}<input type="number" class="input-field" name="likes" min="1" max="1000" value="${limits.likes}"></label>
                <span class="dash-muted studio-limits-status" aria-live="polite"></span>
            </form>` : ""}
        </section>
        <section class="dash-section">
            <div class="dash-section-head"><h3># ${escapeHtml(t("studio.tags"))}</h3></div>
            ${tagRows.length ? `<div class="studio-list">${tagRows.map(row => `
                <div class="studio-row">
                    <div class="studio-row-main"><div class="studio-row-title">#${escapeHtml(row.tag)} <span class="dash-muted">· ${escapeHtml(t("studio.tasks").replace("{n}", row.n))}</span></div></div>
                    <button type="button" class="btn btn-secondary btn-compact" data-send-tag="${escapeHtml(row.tag)}">${escapeHtml(t(admin ? "bank.publish" : "bank.submit"))}</button>
                </div>`).join("")}</div>`
                : `<p class="dash-muted">${escapeHtml(t("studio.tagsEmpty"))}</p>`}
        </section>
        <section class="dash-section">
            <div class="dash-section-head"><h3>📤 ${escapeHtml(t("studio.sends"))}</h3></div>
            ${sends.length ? `<div class="studio-list">${sends.map(batchHtml).join("")}</div>`
                : `<p class="dash-muted">${escapeHtml(t("studio.sendsEmpty"))}</p>`}
        </section>
    `;

    const refresh = () => {
        onChange();
        renderStudio(el, { admin, onChange });
    };

    el.querySelector('[data-act="feed"]').addEventListener("click", () => openFeed({ onClose: refresh }));
    el.querySelector('[data-act="import"]').addEventListener("click", async () => {
        const { importHelpers } = await import("./quiz-editor.js");
        openImportDialog({
            ...importHelpers(),
            title: t("studio.importTitle"),
            confirmLabel: n => t("studio.importConfirm").replace("{n}", n),
            onImport: async (questions) => {
                const items = questions.map(question => ({ content: api.questionContent(question) }));
                const sum = await api.createItemsInParts(items, {}, "pool");
                const lines = [t("studio.imported").replace("{n}", sum.created)];
                if (sum.duplicates) lines.push(t("bank.duplicates").replace("{n}", sum.duplicates));
                if (sum.failed) lines.push(`${t("bank.saveFailed")} (${sum.failed}): ${sum.refusal?.data?.error || sum.message}`);
                await alertDialog(t("studio.importTitle"), lines.join(" · "));
                refresh();
            },
        });
    });
    el.querySelectorAll("[data-send-tag]").forEach(button => {
        button.addEventListener("click", () => openSendDialog({ tag: button.dataset.sendTag, onDone: refresh }));
    });

    const form = el.querySelector(".studio-limits");
    if (!form) return;
    let timer = 0;
    form.addEventListener("submit", e => e.preventDefault());
    form.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const statusEl = form.querySelector(".studio-limits-status");
            const likes = Number(form.elements.likes.value);
            const dislikes = Number(form.elements.dislikes.value);
            if (!likes || !dislikes) return;
            const res = await api.savePoolLimits({ likes, dislikes });
            statusEl.textContent = res.ok ? t("studio.saved") : res.data?.error || t("bank.saveFailed");
            if (res.ok) onChange();
        }, SAVE_DELAY_MS);
    });
}
