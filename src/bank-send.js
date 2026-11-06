// The window that sends tasks to the shared bank: a whole #tag or a single task. The person who knows
// the tasks sorts them here, once for all of them, with a quick correction for any that differ, so
// an admin only has to say yes. Nothing goes until every task has its topic, grade and difficulty.
import * as api from "./bank-api.js";
import { getStoredUser } from "./auth.js";
import { previewHtml } from "./bank-list.js";
import { escapeHtml } from "./admin-task-cards.js";
import { confirmDialog } from "./dialog.js";
import { t } from "./lang.js";
import {
    blockedReason, commonValue, gradesOf, missingOf, searchTopics, sendSummary, tagHints, taughtIn, topicIndex, topicPath
} from "./bank-send-rules.js";

const PAGE = 100;
const MAX_TASKS = 500;      // the server's limit for one send
const MAX_LISTED = 5000;    // how much of a tag is looked through
const MAX_SHOWN_DONE = 50;  // tasks already in the bank or waiting, shown under the rest
const LIST_HEIGHT = 260;    // the topic list, in pixels
const LIST_MIN_WIDTH = 260;
const LIST_GAP = 4;
const EDGE = 8;             // kept free at the edge of the screen

let overlay = null;

const rangeLabel = grades => {
    if (!grades.length) return "";
    const first = grades[0];
    const last = grades[grades.length - 1];
    return t("bank.gradeShort").replace("{n}", first === last ? first : `${first}–${last}`);
};

/**
 * A field to find a topic by typing: a word of its name or of the area above it. pick(topic) gets
 * the choice; grade() is the grade chosen so far, whose topics come first.
 */
export function topicPicker(index, { pick, grade = () => null, placeholder = t("send.topicSearch") }) {
    const el = document.createElement("div");
    el.className = "topic-picker";
    el.innerHTML = `
        <input type="search" class="input-field" role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off"
            placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(t("bank.topic"))}">
        <ul class="topic-picker-list" role="listbox" hidden></ul>`;
    const input = el.querySelector("input");
    const list = el.querySelector("ul");
    let results = [];
    let active = 0;

    // Under the field, or above it near the bottom of the screen; on a phone wider than a row's field
    const place = () => {
        const box = input.getBoundingClientRect();
        const below = window.innerHeight - box.bottom - EDGE;
        const up = below < LIST_HEIGHT && box.top > below;
        const width = Math.min(Math.max(box.width, LIST_MIN_WIDTH), window.innerWidth - 2 * EDGE);
        list.style.width = `${width}px`;
        list.style.left = `${Math.max(EDGE, Math.min(box.left, window.innerWidth - width - EDGE))}px`;
        list.style.top = up ? "auto" : `${box.bottom + LIST_GAP}px`;
        list.style.bottom = up ? `${window.innerHeight - box.top + LIST_GAP}px` : "auto";
        list.style.maxHeight = `${Math.min(LIST_HEIGHT, (up ? box.top - EDGE : below) - LIST_GAP)}px`;
    };
    const show = open => {
        list.hidden = !open;
        input.setAttribute("aria-expanded", String(open));
        // Follows the field while the rows behind it scroll
        window[open ? "addEventListener" : "removeEventListener"]("scroll", place, true);
        window[open ? "addEventListener" : "removeEventListener"]("resize", place);
        if (open) place();
    };
    const render = () => {
        results = searchTopics(index, input.value, grade());
        active = 0;
        list.innerHTML = results.map(({ topic, path }, i) => {
            const grades = rangeLabel(gradesOf(index, topic));
            return `<li role="option" data-index="${i}"${i === 0 ? ' class="is-active"' : ""}>
                <b>${escapeHtml(topic.name)}</b>
                <span>${escapeHtml(path.slice(0, -1).join(" › "))}${grades ? `${path.length > 1 ? " · " : ""}${escapeHtml(grades)}` : ""}</span>
            </li>`;
        }).join("") || `<li class="is-empty">${escapeHtml(t("send.noTopics"))}</li>`;
        show(true);
    };
    const mark = index_ => {
        active = (index_ + results.length) % results.length;
        list.querySelectorAll("[data-index]").forEach((item, i) => item.classList.toggle("is-active", i === active));
        list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
    };
    const choose = i => {
        const found = results[i];
        if (!found) return;
        input.value = found.topic.name;
        show(false);
        pick(found.topic);
    };

    input.addEventListener("input", render);
    input.addEventListener("focus", () => {
        input.select();
        render();
    });
    input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (list.hidden) render();
            else if (results.length) mark(active + (e.key === "ArrowDown" ? 1 : -1));
        } else if (e.key === "Enter") {
            e.preventDefault();
            choose(active);
        } else if (e.key === "Escape" && !list.hidden) {
            e.stopPropagation();
            show(false);
        }
    });
    // Before the field loses focus, or the list would be gone by the time the click lands
    list.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const item = e.target.closest("[data-index]");
        if (item) choose(Number(item.dataset.index));
    });
    input.addEventListener("blur", () => show(false));
    return {
        el,
        set(topic) {
            input.value = topic?.name || "";
        },
        focus() {
            input.focus();
        },
    };
}

/**
 * What a #tag holds, as much as one send takes. Tasks that can still go come first: however many of
 * a large tag are in the bank already, the rest stay within reach, one send after another.
 */
async function taggedTasks(tag) {
    const items = [];
    let cursor;
    do {
        const res = await api.listItems({ scope: "tagged", tag, limit: PAGE, cursor, facets: "none" });
        if (!res.ok) return null;
        items.push(...(res.data.items || []));
        cursor = res.data.nextCursor;
    } while (cursor && items.length < MAX_LISTED);
    const open = items.filter(item => !blockedReason(item)).slice(0, MAX_TASKS);
    return [...open, ...items.filter(blockedReason).slice(0, MAX_SHOWN_DONE)];
}

async function chosenTasks(ids) {
    const items = (await api.loadItems(ids)).filter(Boolean);
    return items.map(item => ({ ...item, own: item.mine }));
}

export function closeSendDialog() {
    overlay?.remove();
    overlay = null;
}

/**
 * Opens the window for a #tag, or for chosen tasks (`ids`). onDone(result) runs after a send, with the
 * server's answer.
 */
export async function openSendDialog({ tag = null, ids = null, onDone = () => {} }) {
    closeSendDialog();
    const admin = getStoredUser()?.role === "admin";
    const returnFocus = document.activeElement;
    const el = document.createElement("div");
    overlay = el;
    el.className = "send-overlay";
    el.innerHTML = `
        <div class="send-window" role="dialog" aria-modal="true" aria-labelledby="send-title" tabindex="-1">
            <header class="send-head">
                <h2 id="send-title">${escapeHtml(tag ? t("send.titleTag").replace("{tag}", `#${tag}`) : t(admin ? "bank.publish" : "bank.submit"))}</h2>
                <button type="button" class="btn btn-secondary btn-icon" data-act="close" aria-label="${escapeHtml(t("bank.close"))}">×</button>
            </header>
            <div class="send-body"><div class="dash-skeleton" aria-hidden="true"><span></span><span></span><span></span></div></div>
        </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("open"));
    const win = el.querySelector(".send-window");
    win.focus({ preventScroll: true });
    let changed = false;  // something was sorted here that closing would lose
    let sending = false;
    let asking = false;
    const close = async () => {
        if (sending || asking) return;
        if (changed) {
            asking = true;
            const leave = await confirmDialog({
                title: t("send.leaveTitle"),
                message: t("send.leaveBody"),
                confirmText: t("send.leave"),
                cancelText: t("send.stay"),
                danger: true,
            });
            asking = false;
            if (!leave) return;
        }
        closeSendDialog();
        returnFocus?.focus?.({ preventScroll: true });
    };
    el.addEventListener("mousedown", (e) => { if (e.target === el) close(); });
    el.addEventListener("click", (e) => { if (e.target.closest('[data-act="close"]')) close(); });
    el.addEventListener("keydown", (e) => {
        e.stopPropagation(); // not the editor's shortcuts
        if (e.key === "Escape") close();
    });

    const [metaRes, items] = await Promise.all([api.fetchMeta(), tag ? taggedTasks(tag) : chosenTasks(ids)]);
    if (overlay !== el) return;
    const body = el.querySelector(".send-body");
    if (!metaRes.ok || !items) {
        body.innerHTML = `<p class="dash-muted">${escapeHtml(t("bank.loadFailed"))}</p>`;
        return;
    }
    const meta = metaRes.data;
    const index = topicIndex(meta);
    const gradeIds = meta.grades.map(grade => grade.id);
    const hints = tag ? tagHints(index, tag, gradeIds) : { gradeId: null, topics: [] };
    const rows = items.map(item => ({
        id: item.id,
        preview: item.preview,
        topicId: item.topicId ?? null,
        // A tag's number says the grade of tasks that have none yet
        gradeId: item.gradeId ?? hints.gradeId,
        difficultyId: item.difficultyId ?? null,
        blocked: blockedReason(item),
        include: true,
    }));
    const going = () => rows.filter(row => row.include && !row.blocked);

    body.innerHTML = `
        <section class="send-all">
            <p class="send-all-title">${escapeHtml(t(rows.length > 1 ? "send.forAll" : "send.forOne"))}</p>
            <div class="send-field send-field-topic">
                <span class="send-label">${escapeHtml(t("bank.topic"))}</span>
                <div class="send-topic-slot"></div>
                <div class="send-suggest" hidden></div>
            </div>
            <div class="send-field">
                <span class="send-label">${escapeHtml(t("bank.grade"))}</span>
                <div class="send-chips send-grades" role="group" aria-label="${escapeHtml(t("bank.grade"))}">
                    ${meta.grades.map(grade => `<button type="button" class="send-chip" data-grade="${grade.id}" title="${escapeHtml(grade.label)}">${grade.id}</button>`).join("")}
                </div>
            </div>
            <div class="send-field">
                <span class="send-label">${escapeHtml(t("bank.level"))}</span>
                <div class="send-chips send-levels" role="group" aria-label="${escapeHtml(t("bank.level"))}">
                    ${meta.difficulties.map(item => `<button type="button" class="send-chip send-level" data-level="${item.id}" style="--lvl:${escapeHtml(item.color || "var(--muted)")}"><i aria-hidden="true"></i>${escapeHtml(item.name)}</button>`).join("")}
                </div>
            </div>
        </section>
        <div class="send-list" role="list"></div>
        <footer class="send-foot">
            <input type="text" class="input-field send-note" maxlength="500" placeholder="${escapeHtml(t("send.notePlaceholder"))}" aria-label="${escapeHtml(t("send.notePlaceholder"))}"${admin ? " hidden" : ""}>
            <div class="send-foot-row">
                <span class="send-status" aria-live="polite"></span>
                <button type="button" class="btn btn-secondary" data-act="close">${escapeHtml(t("bank.cancel"))}</button>
                <button type="button" class="btn btn-primary send-go" disabled></button>
            </div>
        </footer>`;

    const list = body.querySelector(".send-list");
    const status = body.querySelector(".send-status");
    const goBtn = body.querySelector(".send-go");
    const suggest = body.querySelector(".send-suggest");

    const rowHtml = row => {
        if (row.blocked) {
            return `<div class="send-row is-blocked" role="listitem" data-id="${row.id}">
                <div class="send-row-main"><div class="send-row-text">${previewHtml(row)}</div></div>
                <span class="dash-chip private">${escapeHtml(t(row.blocked === "inBank" ? "bank.inBank" : "bank.pending"))}</span>
            </div>`;
        }
        return `<div class="send-row" role="listitem" data-id="${row.id}">
            <input type="checkbox" class="send-include" checked aria-label="${escapeHtml(t("send.include"))}">
            <div class="send-row-main">
                <div class="send-row-text">${previewHtml(row)}</div>
                <button type="button" class="send-row-topic" data-act="row-topic"></button>
            </div>
            <select class="send-row-grade" aria-label="${escapeHtml(t("bank.grade"))}">
                <option value="">${escapeHtml(t("send.gradeShortEmpty"))}</option>
                ${meta.grades.map(grade => `<option value="${grade.id}">${escapeHtml(t("bank.gradeShort").replace("{n}", grade.id))}</option>`).join("")}
            </select>
            <div class="send-row-levels" role="group" aria-label="${escapeHtml(t("bank.level"))}">
                ${meta.difficulties.map(item => `<button type="button" class="send-dot" data-level="${item.id}" style="--lvl:${escapeHtml(item.color || "var(--muted)")}" title="${escapeHtml(item.name)}" aria-label="${escapeHtml(item.name)}" aria-pressed="false"></button>`).join("")}
            </div>
        </div>`;
    };

    const paintRow = row => {
        const node = list.querySelector(`[data-id="${row.id}"]`);
        if (!node || row.blocked) return;
        node.classList.toggle("is-off", !row.include);
        node.classList.toggle("is-missing", row.include && missingOf(row).length > 0);
        const topic = index.byId.get(row.topicId);
        const button = node.querySelector(".send-row-topic");
        if (button) {
            button.textContent = topic ? topicPath(index, topic).join(" › ") : t("send.chooseTopic");
            button.classList.toggle("is-empty", !topic);
            // Worth a look, not an error: the curriculum is a guide
            const offProgramme = topic && row.gradeId && gradesOf(index, topic).length && !taughtIn(index, topic, row.gradeId);
            button.classList.toggle("is-warned", !!offProgramme);
            button.title = offProgramme ? t("send.offProgramme").replace("{n}", row.gradeId) : "";
        }
        node.querySelector(".send-row-grade").value = row.gradeId ?? "";
        node.querySelectorAll(".send-dot").forEach(dot => {
            const on = Number(dot.dataset.level) === row.difficultyId;
            dot.classList.toggle("is-on", on);
            dot.setAttribute("aria-pressed", String(on));
        });
    };

    const paintAll = () => {
        const chosen = going();
        const grade = commonValue(chosen, "gradeId");
        const difficulty = commonValue(chosen, "difficultyId");
        body.querySelectorAll("[data-grade]").forEach(chip => chip.classList.toggle("is-on", Number(chip.dataset.grade) === grade));
        body.querySelectorAll(".send-levels [data-level]").forEach(chip => chip.classList.toggle("is-on", Number(chip.dataset.level) === difficulty));
        const topicId = commonValue(chosen, "topicId");
        body.querySelectorAll("[data-suggest]").forEach(chip => chip.classList.toggle("is-on", Number(chip.dataset.suggest) === topicId));
        const { going: count, ready, lacking } = sendSummary(rows);
        const parts = [];
        if (lacking.topicId) parts.push(t("send.lackTopic").replace("{n}", lacking.topicId));
        if (lacking.gradeId) parts.push(t("send.lackGrade").replace("{n}", lacking.gradeId));
        if (lacking.difficultyId) parts.push(t("send.lackLevel").replace("{n}", lacking.difficultyId));
        status.textContent = parts.length ? `${t("send.lacking")} ${parts.join(", ")}` : count ? t("send.allReady") : t("send.nothing");
        status.classList.toggle("is-warned", parts.length > 0);
        goBtn.textContent = t(admin ? "send.goAdmin" : "send.go").replace("{n}", count);
        goBtn.disabled = !count || ready !== count;
    };

    const setAll = (field, value) => {
        changed = true;
        for (const row of going()) {
            row[field] = value;
            paintRow(row);
        }
        paintAll();
    };

    const allTopic = topicPicker(index, {
        grade: () => commonValue(going(), "gradeId"),
        pick(topic) {
            setAll("topicId", topic.id);
            // A topic taught in one grade only settles the grade too
            const grades = gradesOf(index, topic);
            if (grades.length === 1) {
                for (const row of going()) {
                    if (row.gradeId) continue;
                    row.gradeId = grades[0];
                    paintRow(row);
                }
                paintAll();
            }
        },
    });
    body.querySelector(".send-topic-slot").appendChild(allTopic.el);
    allTopic.set(index.byId.get(commonValue(going(), "topicId")));

    // The suggestions stay where they are after a choice, so nothing below them moves
    if (hints.topics.length) {
        suggest.hidden = false;
        suggest.innerHTML = `<span>${escapeHtml(t("send.fromTag"))}</span>${hints.topics.map(topic =>
            `<button type="button" class="send-chip" data-suggest="${topic.id}" title="${escapeHtml(topicPath(index, topic).join(" › "))}">${escapeHtml(topic.name)}</button>`).join("")}`;
    }

    list.innerHTML = rows.map(rowHtml).join("");
    rows.forEach(paintRow);
    paintAll();

    body.addEventListener("click", (e) => {
        const grade = e.target.closest("[data-grade]");
        if (grade) setAll("gradeId", Number(grade.dataset.grade));
        const chip = e.target.closest(".send-levels [data-level]");
        if (chip) setAll("difficultyId", Number(chip.dataset.level));
        const hint = e.target.closest("[data-suggest]");
        if (hint) {
            const topic = index.byId.get(Number(hint.dataset.suggest));
            allTopic.set(topic);
            setAll("topicId", topic.id);
        }
        const node = e.target.closest(".send-row");
        const row = node && rows.find(item => item.id === Number(node.dataset.id));
        if (!row || row.blocked) return;
        const dot = e.target.closest(".send-dot");
        if (dot) {
            changed = true;
            row.difficultyId = Number(dot.dataset.level);
            paintRow(row);
            paintAll();
        }
        if (e.target.closest('[data-act="row-topic"]')) {
            const button = node.querySelector(".send-row-topic");
            const picker = topicPicker(index, {
                grade: () => row.gradeId,
                pick(topic) {
                    changed = true;
                    row.topicId = topic.id;
                    picker.el.replaceWith(button);
                    paintRow(row);
                    paintAll();
                    button.focus(); // the field is gone: the keyboard stays in the window
                },
            });
            picker.el.addEventListener("focusout", () => {
                // Left without choosing: the row shows what it had
                setTimeout(() => {
                    if (picker.el.isConnected) picker.el.replaceWith(button);
                }, 0);
            });
            button.replaceWith(picker.el);
            picker.focus();
        }
    });

    list.addEventListener("change", (e) => {
        const node = e.target.closest(".send-row");
        const row = node && rows.find(item => item.id === Number(node.dataset.id));
        if (!row) return;
        changed = true;
        if (e.target.matches(".send-include")) row.include = e.target.checked;
        if (e.target.matches(".send-row-grade")) row.gradeId = e.target.value ? Number(e.target.value) : null;
        paintRow(row);
        paintAll();
    });

    body.querySelector(".send-note").addEventListener("input", () => { changed = true; });

    goBtn.addEventListener("click", async () => {
        goBtn.disabled = true;
        sending = true;
        status.textContent = t("send.sending");
        status.classList.remove("is-warned");
        const note = body.querySelector(".send-note").value;
        const res = await api.submitItems(
            going().map(({ id, topicId, gradeId, difficultyId }) => ({ id, topicId, gradeId, difficultyId })), { tag, note });
        sending = false;
        if (overlay !== el) return;
        if (!res.ok) {
            status.textContent = res.data?.error || t("bank.saveFailed");
            status.classList.add("is-warned");
            goBtn.disabled = false;
            return;
        }
        changed = false;
        const { submitted = 0, published = 0, pending = 0, exists = 0 } = res.data;
        const hint = submitted ? "send.doneHint" : published ? "send.doneAdmin" : "send.doneNothing";
        api.forgetItems(going().map(row => row.id));
        const lines = [
            submitted && t("bank.submitted").replace("{n}", submitted),
            published && t("bank.published").replace("{n}", published),
            pending && t("bank.alreadyPending").replace("{n}", pending),
            exists && t("bank.alreadyShared").replace("{n}", exists),
        ].filter(Boolean);
        body.innerHTML = `
            <div class="send-done">
                <div class="send-done-icon" aria-hidden="true">${submitted || published ? "✓" : "i"}</div>
                ${lines.map(line => `<p>${escapeHtml(line)}</p>`).join("")}
                <p class="dash-muted">${escapeHtml(t(hint))}</p>
                <button type="button" class="btn btn-primary" data-act="close">${escapeHtml(t("bank.close"))}</button>
            </div>`;
        onDone(res.data);
    });
}
