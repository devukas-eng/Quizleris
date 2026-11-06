// The admin's Approvals tab: whole sends from creators, decided with one click or task by task, and
// tasks the creators liked that are not in the bank yet. Creators have already sorted what they send,
// so most of the time this is a look and a yes.
import * as api from "./bank-api.js";
import {
    createTaskRows, ensureBankMeta, escapeHtml, readClassificationBar, taskEditButtonsHtml
} from "./admin-task-cards.js";
import { alertDialog, confirmDialog } from "./dialog.js";
import { skeletonHtml } from "./dom.js";
import { localDate, t } from "./lang.js";

const SHOWN_TOPICS = 2;

const whenSent = value => localDate(value, { year: "numeric", month: "short", day: "numeric" });

/** What a send's tasks were sorted into, at a glance. */
function summaryHtml(batch, meta) {
    const topicName = id => meta.topics.find(topic => topic.id === id)?.name;
    const topics = batch.topics.map(topicName).filter(Boolean);
    const levels = batch.levels.map(id => meta.difficulties.find(level => level.id === id)?.name).filter(Boolean);
    const grades = [...batch.grades].sort((a, b) => a - b);
    const parts = [
        topics.slice(0, SHOWN_TOPICS).join(", ") + (topics.length > SHOWN_TOPICS ? ` +${topics.length - SHOWN_TOPICS}` : ""),
        grades.length ? t("bank.gradeShort").replace("{n}", grades.length > 1 ? `${grades[0]}–${grades[grades.length - 1]}` : grades[0]) : "",
        levels.join(", "),
    ];
    return parts.filter(Boolean).map(part => `<span>${escapeHtml(part)}</span>`).join("");
}

function batchHtml(batch, meta) {
    return `
        <div class="dash-batch">
            <div class="dash-batch-head">
                <div class="dash-batch-main">
                    <div class="dash-batch-title">
                        ${batch.tag ? `<b>#${escapeHtml(batch.tag)}</b>` : `<b>${escapeHtml(t("studio.singleSend"))}</b>`}
                        <span class="dash-chip private">${escapeHtml(t("studio.tasks").replace("{n}", batch.count))}</span>
                    </div>
                    <div class="dash-muted">${escapeHtml(batch.username || "—")} · ${escapeHtml(whenSent(batch.createdAt))}</div>
                    <div class="dash-bank-row-labels dash-batch-summary">${summaryHtml(batch, meta)}</div>
                    ${batch.note ? `<div class="dash-batch-note">„${escapeHtml(batch.note)}“</div>` : ""}
                </div>
                <div class="dash-batch-actions">
                    <button type="button" class="btn btn-primary btn-compact" data-batch-act="approve">✓ ${escapeHtml(t("approvals.approveAll"))}</button>
                    <button type="button" class="btn btn-secondary btn-compact" data-batch-act="open" aria-expanded="false">${escapeHtml(t("approvals.look"))}</button>
                </div>
            </div>
            <div class="dash-batch-body" hidden>
                <div class="dash-bank-rows"></div>
                <div class="dash-bank-review-footer">
                    <input type="text" class="input-field dash-reject-note" maxlength="500" placeholder="${escapeHtml(t("bank.rejectNote"))}">
                    <div class="dash-bank-review-btns">
                        <button type="button" class="btn btn-secondary btn-compact" data-batch-act="reject">✕ ${escapeHtml(t("approvals.rejectAll"))}</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/** Fills the tab; onChange runs after every decision, as the badges follow. */
export async function renderApprovals(panel, { onChange = () => {} } = {}) {
    panel.innerHTML = skeletonHtml(5);
    const [meta, pendingRes, suggestedRes] = await Promise.all([ensureBankMeta(), api.pendingBatches(), api.poolSuggested()]);
    if (!panel.isConnected) return;
    if (!pendingRes.ok || !suggestedRes.ok) {
        panel.innerHTML = `<div class="dash-empty"><p class="dash-muted">${escapeHtml(t("bank.loadFailed"))}</p></div>`;
        return;
    }
    const batches = pendingRes.data.batches || [];
    const suggested = suggestedRes.data.items || [];
    const waiting = batches.reduce((sum, batch) => sum + batch.count, 0);

    panel.innerHTML = `
        <section class="dash-section">
            <div class="dash-section-head"><h3>⏳ ${escapeHtml(t("bank.reviewTitle"))} <span class="dash-muted">(${waiting})</span></h3></div>
            ${batches.length ? `<div class="dash-batches">${batches.map(batch => batchHtml(batch, meta)).join("")}</div>` : `
                <div class="dash-empty">
                    <div class="dash-empty-icon" aria-hidden="true">⏳</div>
                    <p class="dash-muted">${escapeHtml(t("adminGui.approvalsEmpty"))}</p>
                </div>`}
        </section>
        <section class="dash-section">
            <div class="dash-section-head"><h3>👍 ${escapeHtml(t("approvals.suggestedTitle"))} <span class="dash-muted">(${suggested.length})</span></h3></div>
            <p class="dash-muted">${escapeHtml(t("approvals.suggestedIntro"))}</p>
            <div class="dash-bank-rows" id="dash-suggested"></div>
        </section>
    `;

    const again = () => {
        onChange();
        renderApprovals(panel, { onChange });
    };

    const decideOne = async (id, action, note) => {
        const res = await api.decideSubmission(id, action, note);
        if (!res.ok) {
            await alertDialog(t("profile.loadError"), res.data?.error || "");
            return false;
        }
        api.forgetItems([id]);
        return true;
    };

    const nodes = panel.querySelectorAll(".dash-batch");
    for (const [index, batch] of batches.entries()) {
        const node = nodes[index];
        const body = node.querySelector(".dash-batch-body");
        const openBtn = node.querySelector('[data-batch-act="open"]');
        const decideAll = async (action) => {
            const note = node.querySelector(".dash-reject-note").value;
            const res = await api.decideBatch(batch.id, action, note, batch.userId);
            if (!res.ok) {
                await alertDialog(t("profile.loadError"), res.data?.error || "");
                return;
            }
            again();
        };
        let rows = null;
        const left = () => {
            if (rows && !rows.size) again();
        };
        const open = async () => {
            const opened = body.hidden;
            body.hidden = !opened;
            openBtn.setAttribute("aria-expanded", String(opened));
            if (!opened || rows) return;
            rows = createTaskRows(body.querySelector(".dash-bank-rows"), meta, {
                actionsHtml: (item, full) => `
                    ${taskEditButtonsHtml(full.id)}
                    <button type="button" class="btn btn-primary btn-compact" data-one="approve">✓ ${escapeHtml(t("bank.approve"))}</button>
                    <button type="button" class="btn btn-secondary btn-compact" data-one="reject">✕ ${escapeHtml(t("bank.reject"))}</button>`,
                wire(row, item) {
                    row.querySelectorAll("[data-one]").forEach(button => {
                        button.addEventListener("click", async () => {
                            button.disabled = true;
                            const note = button.dataset.one === "reject" ? node.querySelector(".dash-reject-note").value : "";
                            if (await decideOne(item.id, button.dataset.one, note)) {
                                rows.remove(item.id);
                                onChange();
                                left();
                            } else {
                                button.disabled = false;
                            }
                        });
                    });
                },
            });
            const res = await api.batchItems(batch.id, batch.userId);
            if (res.ok) rows.add(res.data.items || []);
        };
        openBtn.addEventListener("click", open);
        node.querySelector('[data-batch-act="approve"]').addEventListener("click", () => decideAll("approve"));
        node.querySelector('[data-batch-act="reject"]').addEventListener("click", async () => {
            const ok = await confirmDialog({
                title: t("approvals.rejectAllTitle").replace("{n}", batch.count),
                message: t("approvals.rejectAllBody"),
                confirmText: t("approvals.rejectAll"),
                danger: true,
            });
            if (ok) decideAll("reject");
        });
    }

    const suggestedEl = panel.querySelector("#dash-suggested");
    if (!suggested.length) {
        suggestedEl.innerHTML = `<p class="dash-muted">${escapeHtml(t("approvals.suggestedEmpty"))}</p>`;
        return;
    }
    const rows = createTaskRows(suggestedEl, meta, {
        autoSave: false, // nothing is saved until it goes into the bank
        edit: false,
        labelsHtml: item => `<span class="dash-suggest-votes" title="${escapeHtml((item.fans || []).join(", "))}">👍 ${item.likes}</span>`,
        actionsHtml: () => `
            <button type="button" class="btn btn-primary btn-compact" data-pool="publish">${escapeHtml(t("approvals.toBank"))}</button>
            <button type="button" class="btn btn-secondary btn-compact" data-pool="dismiss">${escapeHtml(t("approvals.notNow"))}</button>
            <button type="button" class="btn btn-secondary btn-icon btn-compact dash-delete" data-pool="remove" title="${escapeHtml(t("approvals.takeOut"))}" aria-label="${escapeHtml(t("approvals.takeOut"))}">🗑</button>`,
        wire(row, item) {
            const body = row.querySelector(".dash-bank-row-body");
            body.querySelectorAll("[data-pool]").forEach(button => {
                button.addEventListener("click", async () => {
                    const act = button.dataset.pool;
                    const set = readClassificationBar(body.querySelector(".dash-bank-classify"));
                    if (act === "publish" && (!set.topicId || !set.gradeId || !set.difficultyId)) {
                        await alertDialog(t("approvals.toBank"), t("approvals.needsAll"));
                        return;
                    }
                    button.disabled = true;
                    const res = act === "publish" ? await api.poolPublish(item.id, set)
                        : act === "dismiss" ? await api.poolDismiss(item.id) : await api.poolRemove(item.id);
                    if (!res.ok) {
                        button.disabled = false;
                        await alertDialog(t("profile.loadError"), res.data?.error || "");
                        return;
                    }
                    api.forgetItems([item.id]);
                    rows.remove(item.id);
                    onChange();
                    if (!rows.size) again();
                });
            });
        },
    });
    rows.add(suggested);
}
