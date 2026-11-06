// The task bank's log: who added, changed, sent, decided or took out what, with the changes shown the
// way GitHub shows them. The admin's Log tab lists everything; a task's own story opens from its row.
import * as api from "./bank-api.js";
import { createPager, ensureBankMeta, escapeHtml } from "./admin-task-cards.js";
import { previewHtml } from "./bank-list.js";
import { alertDialog, confirmDialog } from "./dialog.js";
import { skeletonHtml } from "./dom.js";
import { localDate, t } from "./lang.js";
import { diffRows } from "./text-diff.js";

const CLASSIFIERS = ["subjectId", "gradeId", "topicId", "difficultyId"];
const SEARCH_DELAY_MS = 250;

const when = value => localDate(value, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

const fieldLabel = key => {
    const label = t(`log.field.${key}`);
    return label === `log.field.${key}` ? key : label;
};

/** What a classification value is called. */
function classifierName(field, id, meta) {
    if (id === null || id === undefined) return t("log.none");
    if (field === "gradeId") return t("bank.gradeShort").replace("{n}", id);
    const list = field === "topicId" ? meta.topics : field === "difficultyId" ? meta.difficulties : meta.subjects;
    return list.find(item => item.id === id)?.name || `#${id}`;
}

/** A part of the question as lines of text, so it can be compared. */
function linesOf(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) {
        return value.flatMap((entry, i) => {
            if (entry && typeof entry === "object") {
                const letter = String.fromCharCode(65 + (i % 26));
                return [`${letter}. ${entry.text ?? ""}${entry.image ? ` [${t("log.picture")}]` : ""}${entry.isCorrect ? " ✓" : ""}`];
            }
            return [String(entry)];
        });
    }
    if (typeof value === "boolean") return [t(value ? "bank.true" : "bank.false")];
    if (typeof value === "object") return [JSON.stringify(value)];
    return String(value).split("\n");
}

function diffHtml(before, after) {
    return diffRows(linesOf(before), linesOf(after)).map(row => {
        const sign = row.type === "del" ? "−" : row.type === "add" ? "+" : " ";
        const text = row.parts.map(part => (part.changed && row.parts.length > 1
            ? `<mark>${escapeHtml(part.text)}</mark>` : escapeHtml(part.text))).join("");
        return `<div class="log-line is-${row.type}"><span aria-hidden="true">${sign}</span><span>${text}</span></div>`;
    }).join("");
}

/** The names of classifier values (dimensions' labels), for a list of their IDs. */
function valueNames(ids, meta) {
    const all = meta.dimensions.flatMap(dimension => dimension.values);
    return ids.map(id => all.find(value => value.id === id)?.name || `#${id}`).join(", ") || t("log.none");
}

const swapHtml = (field, before, after) => `<div class="log-field"><div class="log-field-name">${escapeHtml(fieldLabel(field))}</div>
    <div class="log-swap"><del>${escapeHtml(before)}</del> → <ins>${escapeHtml(after)}</ins></div></div>`;

function changesHtml(entry, meta) {
    const changes = entry.changes;
    if (!changes) return "";
    const out = [];
    const content = changes.content || {};
    for (const [key, [before, after]] of Object.entries(content)) {
        out.push(`<div class="log-field"><div class="log-field-name">${escapeHtml(fieldLabel(key))}</div><div class="log-diff">${diffHtml(before, after)}</div></div>`);
    }
    for (const field of CLASSIFIERS) {
        if (!changes[field]) continue;
        const [before, after] = changes[field];
        out.push(swapHtml(field, classifierName(field, before, meta), classifierName(field, after, meta)));
    }
    if (changes.values) out.push(swapHtml("values", valueNames(changes.values[0], meta), valueNames(changes.values[1], meta)));
    if (changes.source) out.push(swapHtml("source", changes.source[0] || t("log.none"), changes.source[1] || t("log.none")));
    if (changes.kind) {
        const name = kind => (kind ? t(`log.kind.${kind}`) : t("log.none"));
        out.push(swapHtml("kind", name(changes.kind[0]), name(changes.kind[1])));
    }
    if (changes.status) {
        const name = status => (status ? t(`log.status.${status}`) : t("log.none"));
        out.push(swapHtml("status", name(changes.status[0]), name(changes.status[1])));
    }
    return out.join("");
}

/** An entry's note in words: the server keeps vote counts, undone entries and bulk label changes short. */
function noteText(entry, meta) {
    const votes = /^[+-](\d+)$/.exec(entry.note || "");
    if (votes) return t("log.votes").replace("{n}", votes[1]);
    const undone = /^#(\d+)$/.exec(entry.note || "");
    if (undone) return t("log.revertOf").replace("{id}", undone[1]);
    const labels = /^\+([\d,]*) -([\d,]*)$/.exec(entry.note || "");
    if (labels) {
        const ids = text => text.split(",").filter(Boolean).map(Number);
        const [added, removed] = [ids(labels[1]), ids(labels[2])];
        return [
            added.length && t("log.valuesAdded").replace("{list}", valueNames(added, meta)),
            removed.length && t("log.valuesRemoved").replace("{list}", valueNames(removed, meta)),
        ].filter(Boolean).join(" · ");
    }
    return entry.note;
}

function entryHtml(entry, { showTask }) {
    const task = showTask
        ? `<span class="log-task"><span class="dash-chip private">#${entry.itemId}</span> ${previewHtml({ id: entry.itemId, preview: entry.preview })}</span>`
        : `<span class="log-task"></span>`;
    return `
        <div class="log-row" data-entry="${entry.id}">
            <button type="button" class="log-head" aria-expanded="false">
                <span class="log-action is-${escapeHtml(entry.action)}">${escapeHtml(t(`log.action.${entry.action}`))}</span>
                <span class="log-who">${escapeHtml(entry.username || t("log.system"))}</span>
                ${task}
                <time class="dash-muted">${escapeHtml(when(entry.createdAt))}</time>
            </button>
            <div class="log-body" hidden></div>
        </div>
    `;
}

/** Opens and fills entries in `container`; undoing a change calls onChanged. */
function wireEntries(container, entries, meta, { canUndo, onChanged }) {
    container.addEventListener("click", async (e) => {
        const head = e.target.closest(".log-head");
        if (head) {
            const row = head.closest(".log-row");
            const body = row.querySelector(".log-body");
            const opened = body.hidden;
            body.hidden = !opened;
            head.setAttribute("aria-expanded", String(opened));
            if (!opened || row.dataset.filled) return;
            row.dataset.filled = "true";
            const entry = entries.get(Number(row.dataset.entry));
            const undo = canUndo && entry.revertible;
            const restore = canUndo && entry.status === "archived" && ["archived", "pool_removed", "rejected"].includes(entry.action);
            body.innerHTML = `
                ${entry.note ? `<p class="log-note">${escapeHtml(noteText(entry, meta))}</p>` : ""}
                ${changesHtml(entry, meta) || (entry.note ? "" : `<p class="dash-muted">${escapeHtml(t("log.noDetails"))}</p>`)}
                ${undo ? `<button type="button" class="btn btn-secondary btn-compact" data-undo="${entry.id}">↩ ${escapeHtml(t("log.undo"))}</button>` : ""}
                ${restore ? `<button type="button" class="btn btn-secondary btn-compact" data-restore="${entry.itemId}">↩ ${escapeHtml(t("log.restore"))}</button>` : ""}
            `;
            return;
        }
        const undo = e.target.closest("[data-undo]");
        const restore = e.target.closest("[data-restore]");
        if (!undo && !restore) return;
        const ok = await confirmDialog({
            title: t(undo ? "log.undoTitle" : "log.restoreTitle"),
            message: t(undo ? "log.undoBody" : "log.restoreBody"),
            confirmText: t(undo ? "log.undo" : "log.restore"),
        });
        if (!ok) return;
        const res = undo ? await api.revertChange(undo.dataset.undo) : await api.restoreItem(restore.dataset.restore);
        if (!res.ok) {
            await alertDialog(t("profile.loadError"), res.data?.error || "");
            return;
        }
        onChanged();
    });
}

/** A task's own story, in `el`, opened from its row. */
export async function renderTaskHistory(el, id, { canUndo = false, onChanged = () => {} } = {}) {
    el.innerHTML = skeletonHtml(2);
    const [meta, res] = await Promise.all([ensureBankMeta(), api.taskHistory(id)]);
    if (!el.isConnected) return;
    if (!res.ok) {
        el.innerHTML = `<p class="dash-muted">${escapeHtml(t("bank.loadFailed"))}</p>`;
        return;
    }
    const list = res.data.entries || [];
    if (!list.length) {
        el.innerHTML = `<p class="dash-muted">${escapeHtml(t("log.taskEmpty"))}</p>`;
        return;
    }
    el.innerHTML = `<div class="log-list">${list.map(entry => entryHtml(entry, { showTask: false })).join("")}</div>`;
    wireEntries(el.querySelector(".log-list"), new Map(list.map(entry => [entry.id, entry])), meta, {
        canUndo,
        onChanged() {
            onChanged();
            renderTaskHistory(el, id, { canUndo, onChanged });
        },
    });
}

/** The admin's Log tab. */
export async function renderBankLog(panel) {
    panel.innerHTML = skeletonHtml(5);
    const [meta, usersRes] = await Promise.all([ensureBankMeta(), api.historyUsers()]);
    if (!panel.isConnected) return;
    const users = usersRes.ok ? usersRes.data.users || [] : [];
    const actions = usersRes.ok ? usersRes.data.actions || [] : [];
    panel.innerHTML = `
        <section class="dash-section">
            <div class="dash-section-head"><h3>🕘 ${escapeHtml(t("log.title"))}</h3></div>
            <p class="dash-muted">${escapeHtml(t("log.intro"))}</p>
            <div class="dash-filter-bar">
                <input type="search" class="input-field dash-search-input" id="log-q" placeholder="${escapeHtml(t("log.search"))}">
                <select class="admin-select-compact" id="log-user">
                    <option value="">${escapeHtml(t("log.everyone"))}</option>
                    ${users.map(user => `<option value="${user.id}">${escapeHtml(user.username)}</option>`).join("")}
                </select>
                <select class="admin-select-compact" id="log-action">
                    <option value="">${escapeHtml(t("log.allActions"))}</option>
                    ${actions.map(action => `<option value="${action}">${escapeHtml(t(`log.action.${action}`))}</option>`).join("")}
                </select>
            </div>
            <div class="log-list" id="log-list">${skeletonHtml(5)}</div>
            <div id="log-more" class="dash-bank-more"></div>
        </section>
    `;
    const listEl = panel.querySelector("#log-list");
    const search = panel.querySelector("#log-q");
    const user = panel.querySelector("#log-user");
    const action = panel.querySelector("#log-action");
    const entries = new Map();

    const filters = () => {
        const raw = search.value.trim();
        const id = /^#?(\d+)$/.exec(raw);
        return { item: id ? id[1] : undefined, q: id ? undefined : raw || undefined, user: user.value || undefined, action: action.value || undefined };
    };

    const pager = createPager(panel.querySelector("#log-more"), {
        fetchPage: (cursor, signal) => api.listHistory({ ...filters(), before: cursor || undefined }, signal),
        onPage(res, first) {
            const list = res.data.entries || [];
            if (first) {
                entries.clear();
                listEl.innerHTML = list.length ? "" : `<div class="dash-empty"><p class="dash-muted">${escapeHtml(t("log.empty"))}</p></div>`;
            }
            list.forEach(entry => entries.set(entry.id, entry));
            listEl.insertAdjacentHTML("beforeend", list.map(entry => entryHtml(entry, { showTask: true })).join(""));
            return res.data.nextBefore;
        },
        onError() {
            listEl.innerHTML = `<div class="dash-empty"><p class="dash-muted">${escapeHtml(t("bank.loadFailed"))}</p></div>`;
        },
    });

    const reload = () => {
        listEl.innerHTML = skeletonHtml(5);
        pager.reset();
    };
    wireEntries(listEl, entries, meta, { canUndo: true, onChanged: reload });
    let timer = 0;
    search.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(reload, SEARCH_DELAY_MS);
    });
    user.addEventListener("change", reload);
    action.addEventListener("change", reload);
    pager.reset();
}
