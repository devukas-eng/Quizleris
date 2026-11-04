// The task bank beside the quiz editor. Left: "Mano užduotys", one's own tasks in folders. Right:
// the shared bank, narrowed by subject, grade, difficulty, search and a topic tree with counts.
// Tasks go into the quiz with "+" or by dragging them in (a whole topic asks how many); questions
// dragged out of the quiz by their grip, and bank tasks dragged onto a folder, are kept in one's
// own folders. Only users who may read the bank see it (admins until it opens to every teacher).
// Coming from the dashboard, the dashboard glides left and becomes the "Mano užduotys" column
// while the editor and the bank unfold.
//
// Widths: three columns from 1400px; below that one side panel with "Bank | Mine" tabs; below
// 1100px a drawer opened with a button; on phones the drawer fills the screen.
import * as api from "./bank-api.js";
import { armDrag, addDropZone, allowTouchDrag, justDragged } from "./bank-drag.js";
import { createTaskList } from "./bank-list.js";
import { classifyFields, topicFields, topicOptions } from "./bank-forms.js";
import { openImportDialog } from "./import-dialog.js";
import { insertQuestions, questionAt, isEditorOpen, bankIdsInQuiz, importHelpers, quizQuestions } from "./quiz-editor.js";
import { isAdminAccessAllowed, getStoredUser } from "./auth.js";
import { confirmDialog } from "./dialog.js";
import { escapeHtml } from "./dom.js";
import { t, getLanguage } from "./lang.js";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const PREFS_KEY = "quizleris_bank_prefs";
const META_TTL = 5 * 60 * 1000;
const PAGE = 50;
const MAX_SAMPLE = 50;      // the server's limit for one /sample
const DASH_FRESH_MS = 1500; // how long after leaving the dashboard its glide still plays
const SORTS = ["new", "popular", "level"];
const REPORT_REASONS = ["answer", "wording", "classification", "duplicate", "other"];

const wideQuery = window.matchMedia("(min-width: 1400px)");
const roomyQuery = window.matchMedia("(min-width: 1100px)");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const layoutMode = () => (wideQuery.matches ? "wide" : roomyQuery.matches ? "compact" : "drawer");

const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
    folderPlus: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M12 10.5v6M9 13.5h6"/>',
    inbox: '<path d="M4 13.5h4.2l1.6 2.3h4.4l1.6-2.3H20"/><path d="M6.2 5h11.6L20 13.5V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4.5z"/>',
    stack: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z"/><path d="m3.5 12.2 8.5 4.5 8.5-4.5"/><path d="m3.5 16.2 8.5 4.3 8.5-4.3"/>',
    edit: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z"/>',
    trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13"/>',
    book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/>',
    prev: '<path d="m15 6-6 6 6 6"/>',
    next: '<path d="m9 6 6 6-6 6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
    flag: '<path d="M5 21V4.5"/><path d="M5 4.5h11l-2 4 2 4H5"/>',
    upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
    tag: '<path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1L21 11.9 12.9 20z"/><circle cx="8" cy="8" r="1.5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>'
};
const icon = (name, size = 18) =>
    `<svg class="bank-ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const prefs = (() => {
    try {
        return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    } catch {
        return {};
    }
})();
function savePrefs() {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
        // a private window: choices are simply not remembered
    }
}

let initialized = false;
let meta = null;
let metaAt = 0;
let metaRequest = null;
let built = false;
let shown = false;
let dashOrigin = null;
let bankList = null;
let mineList = null;
let sheet = null;
let popover = null;
let treeOpen = true; // the topic tree folds into its header once a topic without subtopics is chosen
let builtLanguage = null;
let inQuiz = new Set(); // bank tasks the open quiz already holds (their source.bankId)
let favorites = new Set(); // the teacher's starred shared tasks
let flaggedCount = 0; // shared tasks with open reports of mistakes (admins)
const adding = new Set(); // tasks on their way into the quiz: a second click doesn't add them twice
const els = {};
const bank = { subjectId: null, gradeId: null, topicId: null, levels: new Set(), q: "", sort: "new", facets: {}, total: 0, flagged: false, editing: false, started: false };
const mine = { folders: [], folderId: "all", q: "", total: 0, unfiled: 0, listed: 0, started: false };

export function initBankWorkspace() {
    if (initialized) return;
    initialized = true;
    document.addEventListener("open-editor", e => {
        const from = e.detail?.from;
        dashOrigin = from ? { ...from, at: performance.now() } : null;
    });
    document.addEventListener("editor-mode", e => {
        if (e.detail?.open) onEditorOpen();
        else hide();
    });
    document.addEventListener("quizleris-auth-changed", () => {
        meta = null;
        metaRequest = null;
        limits = NO_ACCESS;
        bank.started = false;
        mine.started = false;
        hide();
        if (isAdminAccessAllowed()) requestMeta().then(() => { if (isEditorOpen()) onEditorOpen(); });
    });
    wideQuery.addEventListener("change", onLayoutChange);
    roomyQuery.addEventListener("change", onLayoutChange);
    // Rows mark the tasks the quiz already holds
    document.addEventListener("quiz-questions-changed", () => {
        inQuiz = bankIdsInQuiz();
        if (!shown) return;
        bankList.refresh();
        mineList.refresh();
        const item = sheet?.list?.items[sheet.index];
        if (item) sheet.el.querySelector(".bank-sheet-meta").innerHTML = rowMetaHtml(item, sheet.scope === "mine");
    });
    // "/" jumps to the bank's search from anywhere but a text field
    document.addEventListener("keydown", e => {
        if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || !shown) return;
        const target = e.target;
        if (target.isContentEditable || target.closest?.("input, textarea, select, rich-input, math-field, [contenteditable]")) return;
        e.preventDefault();
        if (layoutMode() !== "wide") setTab("bank");
        if (layoutMode() === "drawer") setDrawer(true);
        els.panel.querySelector('[data-search="bank"]').focus();
    });
    // Known ahead, so the editor opens straight into its three columns
    if (isAdminAccessAllowed()) requestMeta();
    // This code loads on demand: the editor may already be open by the time it arrives
    if (isEditorOpen()) onEditorOpen();
}

// --- Classifiers and access ---

function requestMeta() {
    metaRequest ??= loadMeta().then(result => {
        meta = result.meta;
        if (meta) metaAt = Date.now();
        else if (result.offline) metaRequest = null; // offline: ask again next time
        return meta;
    });
    return metaRequest;
}

// Asks first whether this user may read the bank, so a teacher's page logs no refused request
async function loadMeta() {
    const access = await api.fetchAccess();
    if (!access.ok || !access.data.read) return { meta: null, offline: access.status <= 0 };
    limits = { ...NO_ACCESS, ...access.data };
    const res = await api.fetchMeta();
    return { meta: res.ok ? prepareMeta(res.data) : null, offline: res.status <= 0 };
}

async function refreshMeta() {
    const res = await api.fetchMeta();
    if (!res.ok) return;
    metaAt = Date.now();
    if (res.data.version === meta?.version) return;
    meta = prepareMeta(res.data);
    // A topic deleted or merged away is no longer chosen
    if (typeof bank.topicId === "number" && !meta.topicsById.has(bank.topicId)) {
        bank.topicId = null;
        treeOpen = true;
    }
    if (shown) {
        renderFilters();
        reloadBank();
    }
}

function prepareMeta(data) {
    const children = new Map();
    for (const topic of data.topics) {
        const key = topic.parentId ?? `s${topic.subjectId}`;
        if (!children.has(key)) children.set(key, []);
        children.get(key).push(topic);
    }
    const courses = new Map();
    for (const dimension of data.dimensions) {
        if (dimension.name === "Kursas") dimension.values.forEach(value => courses.set(value.id, value.name));
    }
    return {
        ...data,
        levelsById: new Map(data.difficulties.map(level => [level.id, level])),
        gradesById: new Map(data.grades.map(grade => [grade.id, grade])),
        topicsById: new Map(data.topics.map(topic => [topic.id, topic])),
        childrenOf: key => children.get(key) || [],
        courses
    };
}

// What this user may do, as the server answered (/bank/access): teachers browse the shared bank;
// staff (admins and creators) fill it; a bank of one's own needs writeMine. Only admins change the
// classifier lists (the topic tree's edit mode).
const NO_ACCESS = { read: false, writeShared: false, writeMine: false, staff: false };
let limits = NO_ACCESS;
const isAdmin = () => getStoredUser()?.role === "admin";
const isStaff = () => !!limits.staff;

// Teachers see only subjects with tasks; staff see every subject so they can fill it
function visibleSubjects() {
    const staff = isStaff();
    return meta.subjects.filter(subject => staff || subject.items > 0);
}

// --- Showing and hiding beside the editor ---

async function onEditorOpen() {
    await null; // the dashboard's "open-editor" may still be on its way
    const origin = dashOrigin;
    dashOrigin = null;
    if (shown || !isAdminAccessAllowed()) return;
    if (!meta && !(await requestMeta())) return;
    if (shown || !isEditorOpen()) return;
    show(origin && performance.now() - origin.at < DASH_FRESH_MS ? origin : null);
    if (Date.now() - metaAt > META_TTL) refreshMeta();
}

function show(origin) {
    build();
    shown = true;
    if (builtLanguage !== getLanguage()) relabel();
    inQuiz = bankIdsInQuiz();
    // Filling and classifying the shared bank is for staff, its classifier lists for admins;
    // a teacher without a bank of their own browses, stars and reports
    els.panel.querySelectorAll(".bank-staff-only, .bank-selbar-edit").forEach(el => { el.hidden = !limits.writeShared; });
    els.panel.querySelectorAll(".bank-admin-only").forEach(el => { el.hidden = !isAdmin(); });
    els.mine.querySelectorAll('[data-act="import-mine"], [data-act="new-folder"]').forEach(el => { el.hidden = !limits.writeMine; });
    document.body.classList.toggle("bank-read-only", !limits.writeMine);
    const saveToBank = document.getElementById("admin-bank-save-btn");
    if (saveToBank) saveToBank.hidden = !limits.writeMine;
    document.body.classList.add("bank-workspace");
    setTab(prefs.tab === "mine" ? "mine" : "bank");
    if (!bank.started) startBank();
    if (!mine.started) startMine();
    else reloadFolders();
    loadFavorites();
    refreshFlagged();
    animateIn(origin);
}

function hide() {
    if (!shown) return;
    shown = false;
    closeSheet();
    closePopover();
    const saveToBank = document.getElementById("admin-bank-save-btn");
    if (saveToBank) saveToBank.hidden = true;
    const finish = () => {
        if (!shown) document.body.classList.remove("bank-workspace", "bank-drawer-open", "bank-drawer-peek");
    };
    if (reduceMotion.matches) {
        finish();
        return;
    }
    const fades = [els.mine, els.panel, els.drawerBtn].map(el =>
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease-in", fill: "forwards" }));
    Promise.all(fades.map(anim => anim.finished.catch(() => null))).then(() => {
        finish();
        fades.forEach(anim => anim.cancel());
    });
}

function onLayoutChange() {
    if (shown && layoutMode() !== "drawer") document.body.classList.remove("bank-drawer-open", "bank-drawer-peek");
}

function activeAside() {
    return document.body.classList.contains("bank-tab-mine") ? els.mine : els.panel;
}

function animateIn(origin) {
    if (reduceMotion.matches) return;
    const mode = layoutMode();
    const landing = mode === "wide" ? els.mine : mode === "compact" ? activeAside() : els.drawerBtn;
    if (origin) flyDashboard(origin, landing);
    else slideIn(landing, mode === "wide" ? -1 : 1, 40);
    if (mode === "wide") slideIn(els.panel, 1, origin ? 200 : 90);
    document.getElementById("app-root")?.animate(
        [{ opacity: 0, transform: "translateY(18px) scale(0.985)" }, { opacity: 1, transform: "none" }],
        { duration: 560, delay: origin ? 140 : 0, easing: EASE, fill: "backwards" });
}

// A column slides in from its side, its parts following one after another
function slideIn(el, dir, delay) {
    if (reduceMotion.matches) return;
    el.animate([{ opacity: 0, transform: `translateX(${dir * 28}px)` }, { opacity: 1, transform: "none" }],
        { duration: 520, delay, easing: EASE, fill: "backwards" });
    [...el.children].forEach((child, i) => child.animate(
        [{ opacity: 0, transform: `translateX(${dir * 14}px)` }, { opacity: 1, transform: "none" }],
        { duration: 460, delay: delay + 80 + i * 45, easing: EASE, fill: "backwards" }));
}

// The dashboard window travels into the column (scaled, its content fading first) while its dim
// backdrop lifts; the column's own content appears as it lands
function flyDashboard(origin, target) {
    const from = origin.rect;
    const to = target.getBoundingClientRect();
    if (!from.width || !to.width) return;
    const duration = 680;

    const veil = document.createElement("div");
    veil.className = "bank-dash-veil";
    document.body.appendChild(veil);
    veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: "ease-out", fill: "forwards" })
        .onfinish = () => veil.remove();

    const ghost = origin.node;
    ghost.removeAttribute("id");
    ghost.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
    ghost.classList.add("bank-dash-ghost");
    ghost.setAttribute("aria-hidden", "true");
    Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
    document.body.appendChild(ghost);
    ghost.animate([
        { transform: "none" },
        { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})` }
    ], { duration, easing: EASE, fill: "forwards" });
    [...ghost.children].forEach(child =>
        child.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.3, easing: "ease-out", fill: "forwards" }));
    ghost.animate([{ opacity: 1 }, { opacity: 1, offset: 0.62 }, { opacity: 0 }], { duration, fill: "forwards" })
        .onfinish = () => ghost.remove();
    setTimeout(() => { ghost.remove(); veil.remove(); }, duration + 800); // in case no frame ever ran

    target.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], { duration, fill: "backwards" });
    [...target.children].forEach((child, i) => child.animate(
        [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
        { duration: 420, delay: duration * 0.5 + i * 50, easing: EASE, fill: "backwards" }));
}

// --- Building the panels ---

function tabsHtml() {
    return `<div class="bank-tabs" role="tablist">
        <button type="button" role="tab" data-tab="bank">${icon("book", 16)}<span data-i18n="bank.tabBank">${t("bank.tabBank")}</span></button>
        <button type="button" role="tab" data-tab="mine">${icon("folder", 16)}<span data-i18n="bank.tabMine">${t("bank.tabMine")}</span></button>
    </div>`;
}

function selbarHtml() {
    return `<div class="bank-selbar" hidden>
        <span class="bank-selbar-count"></span>
        <button type="button" class="btn btn-secondary bank-selbar-edit" data-label="bank.classify" title="${t("bank.classify")}" aria-label="${t("bank.classify")}">${icon("tag", 16)}</button>
        <button type="button" class="btn btn-primary bank-selbar-add">${icon("plus", 16)}<span data-i18n="bank.addSelected">${t("bank.addSelected")}</span></button>
        <button type="button" class="bank-icon-btn bank-selbar-clear" data-label="bank.clearSelection" title="${t("bank.clearSelection")}" aria-label="${t("bank.clearSelection")}">${icon("close", 16)}</button>
    </div>`;
}

function build() {
    if (built) return;
    built = true;
    document.body.insertAdjacentHTML("beforeend", `
        <aside id="bank-mine" class="bank-aside" aria-labelledby="bank-mine-title">
            ${tabsHtml()}
            <header class="bank-head">
                <h2 id="bank-mine-title" class="bank-title">${icon("folder")}<span data-i18n="bank.mine">${t("bank.mine")}</span></h2>
                <button type="button" class="bank-icon-btn" data-act="import-mine" data-label="bank.importMine" title="${t("bank.importMine")}" aria-label="${t("bank.importMine")}">${icon("upload")}</button>
                <button type="button" class="bank-icon-btn" data-act="new-folder" data-label="bank.newFolder" title="${t("bank.newFolder")}" aria-label="${t("bank.newFolder")}">${icon("folderPlus")}</button>
                <button type="button" class="bank-icon-btn bank-drawer-close" data-act="close-drawer" data-label="bank.close" aria-label="${t("bank.close")}">${icon("close")}</button>
            </header>
            <label class="bank-search">${icon("search", 16)}<input type="search" data-search="mine" autocomplete="off" placeholder="${t("bank.searchMine")}" data-i18n-placeholder="bank.searchMine"></label>
            <nav class="mine-folders" role="tree" data-label="bank.folders" aria-label="${t("bank.folders")}"></nav>
            <div class="bank-list-head"><span class="bank-total"></span></div>
            <div class="mine-list"></div>
            ${selbarHtml()}
        </aside>
        <aside id="bank-panel" class="bank-aside" aria-labelledby="bank-title">
            ${tabsHtml()}
            <header class="bank-head">
                <h2 id="bank-title" class="bank-title">${icon("book")}<span data-i18n="bank.title">${t("bank.title")}</span></h2>
                <button type="button" class="bank-icon-btn bank-staff-only" data-act="import" data-label="bank.importShared" title="${t("bank.importShared")}" aria-label="${t("bank.importShared")}" hidden>${icon("upload")}</button>
                <button type="button" class="bank-icon-btn bank-drawer-close" data-act="close-drawer" data-label="bank.close" aria-label="${t("bank.close")}">${icon("close")}</button>
            </header>
            <label class="bank-search">${icon("search", 16)}<input type="search" data-search="bank" autocomplete="off" placeholder="${t("bank.search")}" data-i18n-placeholder="bank.search" aria-keyshortcuts="/"><kbd class="bank-kbd" aria-hidden="true">/</kbd></label>
            <div class="bank-suggest" hidden></div>
            <div class="bank-filters">
                <div class="bank-filter-row">
                    <select class="bank-select bank-subject" data-label="bank.subject" aria-label="${t("bank.subject")}"></select>
                    <select class="bank-select bank-sort" data-label="bank.sort" aria-label="${t("bank.sort")}">
                        ${SORTS.map(sort => `<option value="${sort}">${t(`bank.sort.${sort}`)}</option>`).join("")}
                    </select>
                </div>
                <div class="bank-grades" role="radiogroup" data-label="bank.grade" aria-label="${t("bank.grade")}"></div>
                <div class="bank-levels" role="group" data-label="bank.level" aria-label="${t("bank.level")}"></div>
            </div>
            <section class="bank-topics">
                <div class="bank-topics-bar">
                    <button type="button" class="bank-topics-head" aria-expanded="true">
                        ${icon("chevron", 14)}<span data-i18n="bank.topics">${t("bank.topics")}</span><span class="bank-topic-path"></span>
                    </button>
                    <button type="button" class="bank-icon-btn bank-admin-only bank-tree-edit" aria-pressed="false" data-label="bank.editTree" title="${t("bank.editTree")}" aria-label="${t("bank.editTree")}" hidden>${icon("edit", 15)}</button>
                </div>
                <div class="bank-fold"><div class="bank-fold-inner"><div class="bank-tree" role="tree" data-label="bank.topics" aria-label="${t("bank.topics")}"></div></div></div>
            </section>
            <div class="bank-topic-info" hidden></div>
            <div class="bank-list-head">
                <span class="bank-total"></span>
                <button type="button" class="bank-flagged" hidden aria-pressed="false">${icon("flag", 14)}<span></span></button>
            </div>
            <div class="shared-list"></div>
            ${selbarHtml()}
        </aside>
        <button type="button" class="bank-drawer-btn" aria-expanded="false">${icon("book")}<span data-i18n="bank.title">${t("bank.title")}</span></button>
        <div class="bank-toasts" aria-live="polite"></div>`);

    els.mine = document.getElementById("bank-mine");
    els.panel = document.getElementById("bank-panel");
    els.drawerBtn = document.querySelector(".bank-drawer-btn");
    els.toasts = document.querySelector(".bank-toasts");
    const inPanel = selector => els.panel.querySelector(selector);
    Object.assign(els, {
        suggest: inPanel(".bank-suggest"),
        subject: inPanel(".bank-subject"),
        sort: inPanel(".bank-sort"),
        grades: inPanel(".bank-grades"),
        levels: inPanel(".bank-levels"),
        topics: inPanel(".bank-topics"),
        topicsHead: inPanel(".bank-topics-head"),
        topicPath: inPanel(".bank-topic-path"),
        tree: inPanel(".bank-tree"),
        topicInfo: inPanel(".bank-topic-info"),
        bankTotal: inPanel(".bank-total"),
        flagged: inPanel(".bank-flagged"),
        treeEdit: inPanel(".bank-tree-edit"),
        folders: els.mine.querySelector(".mine-folders"),
        mineTotal: els.mine.querySelector(".bank-total"),
        mineListEl: els.mine.querySelector(".mine-list")
    });

    bankList = createTaskList(inPanel(".shared-list"), {
        addLabel: t("bank.add"),
        starLabel: t("bank.star"),
        metaHtml: item => rowMetaHtml(item, false),
        emptyHtml: res => emptyHtml(res, "bank"),
        starOf: item => favorites.has(item.id),
        onOpen: (item, index) => openSheet(els.panel, bankList, index, "bank"),
        onAdd: (item, row) => addTasks([item.id], row),
        onStar: item => toggleFavorite(item.id),
        onPointerDown: (e, item, row) => dragRows(e, item, row, bankList, "bank"),
        onSelection: ids => updateSelbar(els.panel, ids)
    });
    // The left list shows one's own tasks, or the starred shared ones (which behave as bank tasks)
    const starredView = () => mine.folderId === "favorites";
    mineList = createTaskList(els.mineListEl, {
        addLabel: t("bank.add"),
        starLabel: t("bank.star"),
        metaHtml: item => rowMetaHtml(item, !starredView()),
        emptyHtml: res => emptyHtml(res, "mine"),
        starOf: item => (starredView() ? favorites.has(item.id) : null),
        onOpen: (item, index) => openSheet(els.mine, mineList, index, starredView() ? "bank" : "mine"),
        onAdd: (item, row) => addTasks([item.id], row),
        onStar: item => toggleFavorite(item.id),
        onPointerDown: (e, item, row) => dragRows(e, item, row, mineList, starredView() ? "bank" : "mine"),
        onSelection: ids => updateSelbar(els.mine, ids)
    });

    builtLanguage = getLanguage();
    allowTouchDrag(els.panel);
    allowTouchDrag(els.mine);
    wireCommon();
    wireBank();
    wireMine();
    addMineDropZone();
    addTreeDropZone();
}

// The language was switched while the editor was closed: texts the page's own translation pass
// does not reach (labels, tooltips, choices) are written again
function relabel() {
    builtLanguage = getLanguage();
    document.querySelectorAll(".bank-aside [data-label]").forEach(el => {
        const text = t(el.dataset.label);
        el.setAttribute("aria-label", text);
        if (el.hasAttribute("title")) el.title = text;
    });
    [...els.sort.options].forEach(option => { option.textContent = t(`bank.sort.${option.value}`); });
    bankList.relabel(t("bank.add"), t("bank.star"));
    mineList.relabel(t("bank.add"), t("bank.star"));
    if (bank.started) {
        renderFilters();
        renderTree();
        els.bankTotal.textContent = countLabel(bank.total);
    }
    if (mine.started) {
        renderFolders();
        els.mineTotal.textContent = countLabel(mine.listed);
    }
}

function wireCommon() {
    for (const aside of [els.mine, els.panel]) {
        aside.addEventListener("click", e => {
            const tab = e.target.closest(".bank-tabs [data-tab]");
            if (tab) {
                setTab(tab.dataset.tab);
                if (layoutMode() !== "wide") slideIn(activeAside(), tab.dataset.tab === "mine" ? -1 : 1, 0);
            }
            if (e.target.closest('[data-act="close-drawer"]')) setDrawer(false);
            if (e.target.closest('[data-act="import"]')) openBankImport({ scope: "shared" });
            if (e.target.closest('[data-act="import-mine"]')) openBankImport({ scope: "mine" });
        });
        // Typing in the panels is not an editor shortcut (Ctrl+Z, Alt+N…)
        aside.addEventListener("keydown", e => {
            if (e.target.matches("input, select, textarea")) e.stopPropagation();
        });
        const list = aside === els.mine ? mineList : bankList;
        aside.querySelector(".bank-selbar-add").addEventListener("click", () => {
            const ids = list.selected;
            list.clearSelection();
            addTasks(ids, null);
        });
        aside.querySelector(".bank-selbar-clear").addEventListener("click", () => list.clearSelection());
        aside.querySelector(".bank-selbar-edit").addEventListener("click", () => openBulkEdit(aside, list));
    }
    // The editor's File menu: the quiz's questions into the bank
    document.getElementById("admin-bank-save-btn")?.addEventListener("click", () => {
        const questions = quizQuestions();
        if (questions.length) openBankImport({ scope: "mine", preset: questions });
        else toast(t("bank.quizEmpty"));
    });
    els.drawerBtn.addEventListener("click", () => setDrawer(!document.body.classList.contains("bank-drawer-open")));
    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && document.body.classList.contains("bank-drawer-open") && !sheet && !popover
            && !document.querySelector(".app-dialog-overlay.open")) setDrawer(false);
    });
}

function setTab(tab) {
    prefs.tab = tab;
    savePrefs();
    document.body.classList.toggle("bank-tab-mine", tab === "mine");
    document.querySelectorAll(".bank-tabs [data-tab]").forEach(button => {
        const on = button.dataset.tab === tab;
        button.classList.toggle("is-on", on);
        button.setAttribute("aria-selected", String(on));
    });
}

function setDrawer(open) {
    document.body.classList.toggle("bank-drawer-open", open);
    els.drawerBtn.setAttribute("aria-expanded", String(open));
}

// --- The shared bank ---

function wireBank() {
    let timer = null;
    const search = els.panel.querySelector('[data-search="bank"]');
    search.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            bank.q = search.value;
            renderSuggestions();
            reloadBank();
        }, 250);
    });
    // A suggested topic: open it instead of searching the words
    els.suggest.addEventListener("click", e => {
        const chip = e.target.closest("[data-topic]");
        if (!chip) return;
        search.value = "";
        bank.q = "";
        renderSuggestions();
        selectTopic(Number(chip.dataset.topic));
    });
    els.subject.addEventListener("change", () => {
        bank.subjectId = Number(els.subject.value);
        restoreTopic();
        renderFold();
        renderSuggestions();
        prefs.subjectId = bank.subjectId;
        savePrefs();
        reloadBank();
    });
    els.sort.addEventListener("change", () => {
        bank.sort = els.sort.value;
        prefs.sort = bank.sort;
        savePrefs();
        reloadBank();
    });
    els.grades.addEventListener("click", e => {
        const chip = e.target.closest("[data-grade]");
        if (!chip) return;
        const grade = chip.dataset.grade ? Number(chip.dataset.grade) : null;
        if (grade === bank.gradeId) return;
        bank.gradeId = grade;
        prefs.gradeId = grade;
        savePrefs();
        // A topic that grade's curriculum doesn't have would leave the list empty and hidden
        const topic = meta.topicsById.get(bank.topicId);
        if (grade && topic && !taughtIn(topic, grade) && !topicPath(topic.id).some(step => step.grades.some(row => row.grade === grade))) {
            bank.topicId = null;
            rememberTopic();
            treeOpen = true;
            renderFold();
        }
        renderGrades();
        reloadBank();
    });
    els.levels.addEventListener("click", e => {
        const chip = e.target.closest("[data-level]");
        if (!chip) return;
        const id = Number(chip.dataset.level);
        if (bank.levels.has(id)) bank.levels.delete(id);
        else bank.levels.add(id);
        prefs.levels = [...bank.levels];
        savePrefs();
        renderLevels();
        reloadBank();
    });
    els.topicsHead.addEventListener("click", () => {
        treeOpen = !treeOpen;
        renderFold();
    });
    // Admins: every shared task with an open report, whatever the filters
    els.flagged.addEventListener("click", () => {
        bank.flagged = !bank.flagged;
        els.flagged.setAttribute("aria-pressed", String(bank.flagged));
        els.flagged.hidden = !flaggedCount && !bank.flagged;
        els.panel.classList.toggle("is-flagged", bank.flagged);
        reloadBank();
    });
    // Admins: the tree's own upkeep (new topics, names, descriptions, curriculum, place)
    els.treeEdit.addEventListener("click", () => {
        bank.editing = !bank.editing;
        els.treeEdit.setAttribute("aria-pressed", String(bank.editing));
        els.topics.classList.toggle("is-editing", bank.editing);
        if (bank.editing && !treeOpen) {
            treeOpen = true;
            renderFold();
        }
        renderTree();
    });
    els.tree.addEventListener("click", e => {
        if (justDragged()) return;
        const tool = e.target.closest("[data-tool]");
        if (tool) {
            const id = Number(tool.closest(".bank-node")?.dataset.topic);
            if (tool.dataset.tool === "edit") openTopicEditor({ topic: meta.topicsById.get(id) });
            else if (tool.dataset.tool === "add") openTopicEditor({ parentId: id });
            else if (tool.dataset.tool === "area") openTopicEditor({ parentId: null });
            return;
        }
        const node = e.target.closest(".bank-node");
        if (!node) return;
        const id = parseTopic(node.dataset.topic);
        const expandable = node.hasAttribute("aria-expanded");
        if (expandable && (id === bank.topicId || e.target.closest('[data-act="toggle"]'))) toggleTopic(id);
        else if (id !== bank.topicId) selectTopic(id);
    });
    els.tree.addEventListener("pointerdown", e => {
        const node = e.target.closest(".bank-node");
        if (node && !e.target.closest('[data-act="toggle"], [data-tool]')) dragTopic(e, node);
    });
    treeKeys(els.tree, ".bank-node", node => toggleTopic(parseTopic(node.dataset.topic)));
    els.topicInfo.addEventListener("click", e => {
        if (e.target.closest(".bank-topic-desc")) e.target.closest(".bank-topic-desc").classList.toggle("is-open");
        const add = e.target.closest('[data-act="add-topic"]');
        if (add) {
            pickFromTopic(bank.topicId, Number(add.dataset.count), add).then(questions => {
                if (questions.length) insertAndReveal(questions, null);
            });
        }
    });
}

const parseTopic = value => (value === "all" ? null : value === "none" ? "none" : Number(value));

function startBank() {
    bank.started = true;
    const subjects = visibleSubjects();
    bank.subjectId = subjects.find(subject => subject.id === prefs.subjectId)?.id
        ?? [...subjects].sort((a, b) => b.items - a.items)[0]?.id ?? null;
    bank.gradeId = meta.gradesById.has(prefs.gradeId) ? prefs.gradeId : null;
    bank.levels = new Set((prefs.levels || []).filter(id => meta.levelsById.has(id)));
    bank.sort = SORTS.includes(prefs.sort) ? prefs.sort : "new";
    restoreTopic();
    renderFilters();
    reloadBank();
}

// The topic last chosen in this subject, if it still exists; a leaf opens with the tree folded
function restoreTopic() {
    const saved = prefs.topics?.[bank.subjectId];
    const topic = meta.topicsById.get(saved);
    bank.topicId = saved === "none" || topic?.subjectId === bank.subjectId ? saved : null;
    treeOpen = bank.topicId === null || (typeof bank.topicId === "number" && meta.childrenOf(bank.topicId).length > 0);
}

function rememberTopic() {
    prefs.topics = { ...prefs.topics, [bank.subjectId]: bank.topicId };
    savePrefs();
}

function renderFilters() {
    els.subject.innerHTML = visibleSubjects()
        .map(subject => `<option value="${subject.id}">${escapeHtml(`${subject.icon || ""} ${subject.name}`.trim())}</option>`).join("");
    els.subject.value = String(bank.subjectId ?? "");
    els.subject.hidden = !els.subject.options.length;
    els.sort.value = bank.sort;
    renderGrades();
    renderLevels();
    renderFold();
}

function renderGrades() {
    const chip = (value, label, title) => {
        const on = (bank.gradeId ?? "") === value;
        return `<button type="button" class="bank-chip${on ? " is-on" : ""}" role="radio" aria-checked="${on}" data-grade="${value}"${title ? ` title="${escapeHtml(title)}"` : ""}>${escapeHtml(label)}</button>`;
    };
    els.grades.innerHTML = chip("", t("bank.allGrades")) + meta.grades.map(grade => chip(grade.id, String(grade.id), grade.label)).join("");
}

function renderLevels() {
    const counts = bank.facets.difficulty || {};
    els.levels.innerHTML = meta.difficulties.map(level => {
        const on = bank.levels.has(level.id);
        return `<button type="button" class="bank-chip bank-level${on ? " is-on" : ""}" aria-pressed="${on}" data-level="${level.id}" style="--lvl:${escapeHtml(level.color || "var(--accent)")}">
            <i aria-hidden="true"></i>${escapeHtml(level.name)}<span>${counts[level.id] || ""}</span></button>`;
    }).join("");
}

// Folded, the tree leaves its room to the task list and the chosen topic's description shows instead
function renderFold() {
    els.topics.classList.toggle("is-open", treeOpen);
    els.topicsHead.setAttribute("aria-expanded", String(treeOpen));
    if (!treeOpen && els.tree.contains(document.activeElement)) els.topicsHead.focus({ preventScroll: true });
    renderTopicInfo();
}

function listFilter() {
    return {
        subject: bank.subjectId,
        grade: bank.gradeId,
        topic: bank.topicId,
        difficulty: bank.levels.size ? [...bank.levels].join(",") : null,
        q: bank.q.trim(),
        kind: "problem"
    };
}

async function reloadBank() {
    if (bank.flagged) {
        const res = await bankList.reset((cursor, signal) =>
            api.listItems({ flagged: 1, sort: bank.sort, limit: PAGE, cursor, facets: "none" }, signal));
        if (res) els.bankTotal.textContent = res.ok ? t("bank.flaggedTotal").replace("{n}", res.data.total ?? 0) : "";
        return;
    }
    const filter = listFilter();
    renderTree();
    const res = await bankList.reset((cursor, signal) =>
        api.listItems({ ...filter, sort: bank.sort, limit: PAGE, cursor, facets: "topic,difficulty" }, signal));
    if (!res) return; // a newer listing took over
    if (res.ok) {
        bank.total = res.data.total ?? 0;
        bank.facets = res.data.facets || {};
    }
    els.bankTotal.textContent = res.ok ? countLabel(bank.total) : "";
    renderTree();
    renderLevels();
}

// Tasks under each topic, its subtopics included (the facet counts only direct ones)
function topicCounts() {
    const direct = bank.facets.topic || {};
    const totals = new Map();
    const sum = topic => {
        let n = direct[topic.id] || 0;
        for (const child of meta.childrenOf(topic.id)) n += sum(child);
        totals.set(topic.id, n);
        return n;
    };
    meta.childrenOf(`s${bank.subjectId}`).forEach(sum);
    return totals;
}

function topicPath(id) {
    const path = [];
    for (let topic = meta.topicsById.get(id); topic; topic = meta.topicsById.get(topic.parentId)) path.unshift(topic);
    return path;
}

// Search covers the tasks' own words; a teacher typing a topic's name ("trupmenos", "lygtys") is
// shown those topics as well, the chosen grade's first
const fold = text => String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function renderSuggestions() {
    const words = fold(bank.q).split(/\s+/).filter(word => word.length >= 3);
    const matches = !words.length ? [] : meta.topics
        .filter(topic => topic.subjectId === bank.subjectId && words.every(word => fold(topic.name).includes(word)))
        .sort((a, b) => Number(!!bank.gradeId && !taughtIn(a, bank.gradeId)) - Number(!!bank.gradeId && !taughtIn(b, bank.gradeId)))
        .slice(0, 4);
    els.suggest.hidden = !matches.length;
    els.suggest.innerHTML = matches.length
        ? `<span class="bank-suggest-label">${t("bank.topics")}:</span>${matches.map(topic =>
            `<button type="button" class="bank-chip" data-topic="${topic.id}" title="${escapeHtml(topicPath(topic.id).map(step => step.name).join(" › "))}">${escapeHtml(topic.name)}</button>`).join("")}`
        : "";
}

// How many shared tasks have open reports: admins see the number, and with it the way to them
async function refreshFlagged() {
    if (!isStaff() || !els.flagged) return;
    const res = await api.listItems({ flagged: 1, limit: 1, facets: "none" });
    if (!res.ok) return;
    flaggedCount = res.data.total ?? 0;
    els.flagged.hidden = !flaggedCount && !bank.flagged;
    els.flagged.querySelector("span").textContent = flaggedCount;
    els.flagged.title = t("bank.flaggedTitle");
    els.flagged.setAttribute("aria-label", `${t("bank.flaggedTitle")}: ${flaggedCount}`);
}

// Whether a grade's curriculum has this topic or one of its subtopics
function taughtIn(topic, grade) {
    return topic.grades.some(row => row.grade === grade) || meta.childrenOf(topic.id).some(child => taughtIn(child, grade));
}

function expandedTopics() {
    return new Set(prefs.expanded?.[bank.subjectId] || []);
}

function saveExpanded(set) {
    prefs.expanded = { ...prefs.expanded, [bank.subjectId]: [...set] };
    savePrefs();
}

// With a grade chosen, the tree keeps that grade's curriculum topics and any topic holding tasks
function renderTree() {
    if (!meta) return;
    const counts = topicCounts();
    const grade = bank.gradeId;
    const expanded = expandedTopics();
    const onPath = new Set(topicPath(bank.topicId).map(topic => topic.id));
    const kept = new Map();
    const visible = topic => {
        if (!kept.has(topic.id)) {
            kept.set(topic.id, !grade || (counts.get(topic.id) || 0) > 0
                || topic.grades.some(row => row.grade === grade) || meta.childrenOf(topic.id).some(visible));
        }
        return kept.get(topic.id);
    };
    const all = Object.values(bank.facets.topic || {}).reduce((sum, n) => sum + n, 0);
    const rows = [nodeHtml({ id: "all", name: t("bank.allTopics") }, 0, all, null, bank.topicId == null)];
    const walk = (topic, depth) => {
        if (!visible(topic)) return;
        const kids = meta.childrenOf(topic.id).filter(visible);
        const open = kids.length ? expanded.has(topic.id) || (onPath.has(topic.id) && topic.id !== bank.topicId) : null;
        rows.push(nodeHtml(topic, depth, counts.get(topic.id) || 0, open, topic.id === bank.topicId));
        if (open) kids.forEach(kid => walk(kid, depth + 1));
    };
    meta.childrenOf(`s${bank.subjectId}`).forEach(topic => walk(topic, 0));
    const unsorted = bank.facets.topic?.none || 0;
    if (unsorted) rows.push(nodeHtml({ id: "none", name: t("bank.noTopic") }, 0, unsorted, null, bank.topicId === "none"));
    if (bank.editing) rows.push(`<button type="button" class="bank-link bank-tree-new" data-tool="area">${icon("plus", 14)}${t("bank.newArea")}</button>`);

    const focused = els.tree.contains(document.activeElement) ? document.activeElement.dataset.topic : null;
    els.tree.innerHTML = rows.join("");
    if (focused) els.tree.querySelector(`[data-topic="${focused}"]`)?.focus({ preventScroll: true });
    renderTopicPath();
    renderTopicInfo();
}

function nodeHtml(topic, depth, count, open, selected) {
    const expandable = open !== null;
    const hint = topic.description ? topicHint(topic) : "";
    const tools = bank.editing && typeof topic.id === "number"
        ? `<span class="bank-node-tools">
            <button type="button" data-tool="add" tabindex="-1" title="${t("bank.newSubtopic")}" aria-label="${t("bank.newSubtopic")}">${icon("plus", 13)}</button>
            <button type="button" data-tool="edit" tabindex="-1" title="${t("bank.editTopic")}" aria-label="${t("bank.editTopic")}">${icon("edit", 13)}</button>
        </span>` : "";
    return `<div class="bank-node${selected ? " is-selected" : ""}${count ? "" : " is-empty"}${topic.archived ? " is-archived" : ""}" role="treeitem" tabindex="${selected ? 0 : -1}"
        aria-level="${depth + 1}" aria-selected="${selected}"${expandable ? ` aria-expanded="${open}"` : ""}
        data-topic="${topic.id}" data-count="${count}" style="--depth:${depth}"${hint ? ` title="${escapeHtml(hint)}"` : ""}>
        <span class="bank-node-chev" data-act="toggle">${expandable ? icon("chevron", 14) : ""}</span>
        <span class="bank-node-name">${escapeHtml(topic.name)}</span>
        <span class="bank-node-count">${count || ""}</span>
        ${tools}
    </div>`;
}

// The curriculum lines for the chosen grade (or every grade): "7 kl. · Bendrasis · 14 val."
function curriculumFacts(topic) {
    return topic.grades
        .filter(row => !bank.gradeId || row.grade === bank.gradeId)
        .map(row => [t("bank.gradeShort").replace("{n}", row.grade), meta.courses.get(row.course),
            row.hours ? t("bank.hours").replace("{n}", row.hours) : ""].filter(Boolean).join(" · "));
}

function topicHint(topic) {
    const facts = curriculumFacts(topic);
    return [topic.description, facts.slice(0, 3).join("; ")].filter(Boolean).join("\n");
}

function renderTopicPath() {
    const path = bank.topicId === "none" ? [{ name: t("bank.noTopic") }] : topicPath(bank.topicId);
    els.topicPath.textContent = path.length ? `› ${path.slice(-2).map(topic => topic.name).join(" › ")}` : "";
}

function renderTopicInfo() {
    const topic = meta.topicsById.get(bank.topicId);
    els.topicInfo.hidden = !topic || treeOpen;
    if (els.topicInfo.hidden) return;
    const row = topic.grades.find(r => r.grade === bank.gradeId && r.description);
    const count = Number(els.tree.querySelector(`[data-topic="${topic.id}"]`)?.dataset.count || 0);
    els.topicInfo.innerHTML = `
        <p class="bank-topic-desc">${escapeHtml(row?.description || topic.description || topic.name)}</p>
        <div class="bank-topic-facts">
            <span>${escapeHtml(curriculumFacts(topic).slice(0, 2).join("; "))}</span>
            ${count ? `<button type="button" class="bank-link" data-act="add-topic" data-count="${count}">${icon("plus", 14)}<span>${t("bank.addFromTopic")}</span></button>` : ""}
        </div>`;
}

function selectTopic(topicId) {
    bank.topicId = topicId;
    rememberTopic();
    const branch = typeof topicId === "number" && meta.childrenOf(topicId).length > 0;
    if (branch) {
        const expanded = expandedTopics();
        expanded.add(topicId);
        saveExpanded(expanded);
    }
    treeOpen = branch || topicId === null;
    renderFold();
    reloadBank();
}

function toggleTopic(id) {
    if (typeof id !== "number") return;
    const expanded = expandedTopics();
    const open = els.tree.querySelector(`[data-topic="${id}"]`)?.getAttribute("aria-expanded") === "true";
    if (open) {
        expanded.delete(id);
        // A branch holding the chosen topic stays open; folding it chooses the branch instead
        if (bank.topicId !== id && topicPath(bank.topicId).some(topic => topic.id === id)) {
            bank.topicId = id;
            rememberTopic();
            saveExpanded(expanded);
            reloadBank();
            return;
        }
    } else {
        expanded.add(id);
    }
    saveExpanded(expanded);
    renderTree();
    els.tree.querySelector(`[data-topic="${id}"]`)?.focus({ preventScroll: true });
}

// Arrow keys move through a tree's rows; Right/Left open and close a branch; Enter chooses
function treeKeys(container, selector, toggle) {
    container.addEventListener("keydown", e => {
        const node = e.target.closest?.(selector);
        if (!node || e.target !== node) return;
        const nodes = [...container.querySelectorAll(selector)];
        const move = to => {
            if (!to) return;
            nodes.forEach(n => { n.tabIndex = -1; });
            to.tabIndex = 0;
            to.focus();
        };
        const expanded = node.getAttribute("aria-expanded");
        if (e.key === "ArrowDown") move(nodes[nodes.indexOf(node) + 1]);
        else if (e.key === "ArrowUp") move(nodes[nodes.indexOf(node) - 1]);
        else if ((e.key === "ArrowRight" && expanded === "false") || (e.key === "ArrowLeft" && expanded === "true")) toggle(node);
        else if (e.key === "Enter" || e.key === " ") node.click();
        else return;
        e.preventDefault();
    });
}

// --- One's own tasks ---

function wireMine() {
    let timer = null;
    const search = els.mine.querySelector('[data-search="mine"]');
    search.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            mine.q = search.value;
            reloadMine();
        }, 250);
    });
    els.mine.querySelector('[data-act="new-folder"]').addEventListener("click", () => editFolder({ parentId: null }));
    els.folders.addEventListener("click", e => {
        if (justDragged()) return;
        const node = e.target.closest(".mine-folder");
        if (!node || node.dataset.folder === "new") return;
        const id = parseFolder(node.dataset.folder);
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "toggle" && node.hasAttribute("aria-expanded")) toggleFolder(id);
        else if (act === "sub") editFolder({ parentId: id });
        else if (act === "rename") editFolder({ folder: folderById(id) });
        else if (act === "delete") removeFolder(id);
        else selectFolder(id);
    });
    els.folders.addEventListener("dblclick", e => {
        const node = e.target.closest(".mine-folder");
        const folder = node && folderById(parseFolder(node.dataset.folder));
        if (folder && !e.target.closest("button, input")) editFolder({ folder });
    });
    els.folders.addEventListener("pointerdown", e => {
        const node = e.target.closest(".mine-folder");
        if (!node || e.target.closest("button, input")) return;
        const folder = folderById(parseFolder(node.dataset.folder));
        if (!folder) return;
        if (e.pointerType === "mouse") e.preventDefault();
        armDrag(e, {
            source: node,
            payload: { kind: "folder", id: folder.id },
            ghost: () => {
                const el = node.cloneNode(true);
                el.querySelector(".mine-folder-tools")?.remove();
                el.classList.remove("is-selected");
                return el;
            }
        });
    });
    treeKeys(els.folders, ".mine-folder", node => toggleFolder(parseFolder(node.dataset.folder)));
}

const SPECIAL_FOLDERS = ["all", "favorites", "none"];
const parseFolder = value => (SPECIAL_FOLDERS.includes(value) ? value : Number(value));
const folderById = id => mine.folders.find(folder => folder.id === id) || null;

function isInside(id, ancestorId) {
    for (let folder = folderById(id); folder; folder = folderById(folder.parentId)) {
        if (folder.id === ancestorId) return true;
    }
    return false;
}

function folderLabel(folderId) {
    return folderById(folderId)?.name || t("bank.folderNone");
}

function startMine() {
    mine.started = true;
    mine.folderId = typeof prefs.mineFolder === "number" || SPECIAL_FOLDERS.includes(prefs.mineFolder) ? prefs.mineFolder : "all";
    reloadFolders();
    reloadMine();
}

async function loadFavorites() {
    const res = await api.listFavorites();
    if (!res.ok) return;
    favorites = new Set(res.data.ids || []);
    if (mine.started) renderFolders();
    bankList.refresh();
    mineList.refresh();
}

// A star goes on (or off) at once; if the server refuses, it comes back off with a notice
async function toggleFavorite(id) {
    if (justDragged()) return;
    const on = !favorites.has(id);
    const apply = state => {
        if (state) favorites.add(id);
        else favorites.delete(id);
        bankList.refresh();
        mineList.refresh();
        renderFolders();
        sheetStar();
    };
    apply(on);
    const res = await api.setFavorite(id, on);
    if (!res.ok) {
        apply(!on);
        toast(errorText(res), "error");
    } else if (!on && mine.folderId === "favorites") {
        reloadMine(); // unstarred: it leaves the starred list
    }
}

async function reloadFolders() {
    const res = await api.listFolders();
    if (res.ok) {
        mine.folders = res.data.folders || [];
        mine.total = res.data.total ?? 0;
        mine.unfiled = res.data.unfiled ?? 0;
    }
    if (typeof mine.folderId === "number" && !folderById(mine.folderId)) {
        mine.folderId = "all";
        reloadMine();
    }
    renderFolders();
}

async function reloadMine() {
    const starred = mine.folderId === "favorites";
    const folder = mine.folderId === "all" || starred ? null : mine.folderId;
    const res = await mineList.reset((cursor, signal) =>
        api.listItems({ scope: starred ? "favorites" : "mine", folder, q: mine.q.trim(), limit: PAGE, cursor, facets: "none" }, signal));
    if (!res) return;
    mine.listed = res.data.total ?? 0;
    els.mineTotal.textContent = res.ok ? countLabel(mine.listed) : "";
}

function renderFolders() {
    const expanded = new Set(prefs.mineExpanded || []);
    const kids = parentId => mine.folders.filter(folder => (folder.parentId ?? null) === parentId);
    const rows = [
        folderHtml({ id: "all", name: t("bank.folderAll") }, 0, mine.total, null, "stack"),
        folderHtml({ id: "favorites", name: t("bank.favorites") }, 0, favorites.size, null, "star"),
        folderHtml({ id: "none", name: t("bank.folderNone") }, 0, mine.unfiled, null, "inbox")
    ];
    const walk = (folder, depth) => {
        const children = kids(folder.id);
        const open = children.length ? expanded.has(folder.id) : null;
        rows.push(folderHtml(folder, depth, folder.items, open, "folder"));
        if (open) children.forEach(child => walk(child, depth + 1));
    };
    kids(null).forEach(folder => walk(folder, 0));
    const focused = els.folders.contains(document.activeElement) ? document.activeElement.dataset.folder : null;
    els.folders.innerHTML = rows.join("");
    if (focused) els.folders.querySelector(`[data-folder="${focused}"]`)?.focus({ preventScroll: true });
}

function folderHtml(folder, depth, count, open, ico) {
    const selected = mine.folderId === folder.id;
    const own = typeof folder.id === "number";
    return `<div class="mine-folder${selected ? " is-selected" : ""}" role="treeitem" tabindex="${selected ? 0 : -1}"
        aria-level="${depth + 1}" aria-selected="${selected}"${open === null ? "" : ` aria-expanded="${open}"`}
        data-folder="${folder.id}" style="--depth:${depth}">
        <span class="bank-node-chev" data-act="toggle">${open === null ? "" : icon("chevron", 14)}</span>
        <span class="mine-folder-ico">${icon(ico, 16)}</span>
        <span class="bank-node-name">${escapeHtml(folder.name)}</span>
        <span class="bank-node-count">${count || ""}</span>
        ${own ? `<span class="mine-folder-tools">
            <button type="button" data-act="sub" title="${t("bank.newSubfolder")}" aria-label="${t("bank.newSubfolder")}">${icon("plus", 14)}</button>
            <button type="button" data-act="rename" title="${t("bank.rename")}" aria-label="${t("bank.rename")}">${icon("edit", 14)}</button>
            <button type="button" data-act="delete" title="${t("bank.deleteFolder")}" aria-label="${t("bank.deleteFolder")}">${icon("trash", 14)}</button>
        </span>` : ""}
    </div>`;
}

function selectFolder(id) {
    if (mine.folderId === id) return;
    mine.folderId = id;
    prefs.mineFolder = id;
    savePrefs();
    renderFolders();
    reloadMine();
}

function toggleFolder(id) {
    if (typeof id !== "number") return;
    const expanded = new Set(prefs.mineExpanded || []);
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    prefs.mineExpanded = [...expanded];
    savePrefs();
    renderFolders();
    els.folders.querySelector(`[data-folder="${id}"]`)?.focus({ preventScroll: true });
}

// Renaming in place, or a new (sub)folder typed into a row that appears where it will live
function editFolder({ folder = null, parentId = null }) {
    const editing = els.folders.querySelector(".mine-folder-input");
    if (editing) {
        editing.focus(); // one name at a time
        return;
    }
    let node;
    if (folder) {
        node = els.folders.querySelector(`[data-folder="${folder.id}"]`);
    } else {
        const parent = typeof parentId === "number" ? parentId : null;
        if (parent) {
            prefs.mineExpanded = [...new Set([...(prefs.mineExpanded || []), parent])];
            savePrefs();
            renderFolders();
        }
        const parentNode = parent ? els.folders.querySelector(`[data-folder="${parent}"]`) : null;
        const depth = parentNode ? Number(parentNode.style.getPropertyValue("--depth")) + 1 : 0;
        const html = folderHtml({ id: "new", name: "" }, depth, 0, null, "folderPlus");
        if (parentNode) parentNode.insertAdjacentHTML("afterend", html);
        else els.folders.insertAdjacentHTML("beforeend", html);
        node = els.folders.querySelector('[data-folder="new"]');
    }
    if (!node) return;
    const input = document.createElement("input");
    input.className = "mine-folder-input";
    input.maxLength = 120;
    input.value = folder?.name || "";
    input.placeholder = t("bank.folderName");
    input.setAttribute("aria-label", t("bank.folderName"));
    node.querySelector(".bank-node-name").replaceWith(input);
    node.querySelector(".mine-folder-tools")?.remove();
    input.focus();
    input.select();
    let finished = false;
    const finish = async save => {
        if (finished) return;
        finished = true;
        const name = input.value.trim();
        if (save && name && name !== folder?.name) {
            const res = folder
                ? await api.updateFolder(folder.id, { name })
                : await api.createFolder(name, typeof parentId === "number" ? parentId : null);
            if (!res.ok) toast(errorText(res), "error");
        }
        await reloadFolders();
    };
    input.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
        }
    });
    input.addEventListener("blur", () => finish(true));
}

async function removeFolder(id) {
    const folder = folderById(id);
    if (!folder) return;
    const ok = await confirmDialog({
        title: t("bank.deleteFolderTitle").replace("{name}", folder.name),
        message: t("bank.deleteFolderBody"),
        confirmText: t("bank.deleteFolder"),
        danger: true
    });
    if (!ok) return;
    const res = await api.deleteFolder(id);
    if (!res.ok) {
        toast(errorText(res), "error");
        return;
    }
    if (mine.folderId === id || isInside(mine.folderId, id)) {
        mine.folderId = folder.parentId ?? "all";
        prefs.mineFolder = mine.folderId;
        savePrefs();
    }
    await reloadFolders();
    reloadMine();
}

// Folders take questions from the quiz and tasks from the bank (copies), one's own tasks (moved)
// and other folders (moved inside)
function addMineDropZone() {
    let lit = null;
    const light = el => {
        if (lit === el) return;
        lit?.classList.remove("is-drop-target");
        el?.classList.add("is-drop-target");
        lit = el;
    };
    addDropZone({
        el: els.mine,
        accepts: payload => shown && limits.writeMine && (payload.kind === "question" || payload.kind === "folder"
            || (payload.kind === "tasks" && payload.source !== "topic")),
        over(payload, x, y, target) {
            const node = target.closest(".mine-folder");
            let folderId = null;
            let el = null;
            if (node && node.dataset.folder !== "new") {
                folderId = parseFolder(node.dataset.folder);
                el = node;
            } else if (payload.kind !== "folder" && target.closest(".mine-list")) {
                folderId = mine.folderId;
                el = els.mineListEl;
            }
            if (!el || !folderTakes(payload, folderId)) {
                light(null);
                return null;
            }
            light(el);
            return { folderId, el };
        },
        leave: () => light(null),
        drop: (payload, hint) => dropOnFolder(payload, hint.folderId).then(ok => (ok ? hint.el : null))
    });
}

function folderTakes(payload, folderId) {
    // Stars are for shared tasks: bank tasks dropped there are starred, nothing else is taken
    if (folderId === "favorites") return payload.kind === "tasks" && payload.source === "bank";
    if (payload.kind === "folder") {
        return folderId === "all" || (typeof folderId === "number" && folderId !== payload.id && !isInside(folderId, payload.id));
    }
    if (payload.kind === "tasks" && payload.source === "mine") return folderId !== "all" && folderId !== mine.folderId;
    return true;
}

async function dropOnFolder(payload, folderId) {
    if (folderId === "favorites") {
        const fresh = payload.ids.filter(id => !favorites.has(id));
        const results = await Promise.all(fresh.map(id => api.setFavorite(id, true)));
        const starred = fresh.filter((id, i) => results[i].ok);
        starred.forEach(id => favorites.add(id));
        if (results.some(res => !res.ok)) toast(errorText(results.find(res => !res.ok)), "error");
        toast(t("bank.starred").replace("{n}", payload.ids.length));
        renderFolders();
        bankList.refresh();
        if (mine.folderId === "favorites") reloadMine();
        return true;
    }
    const target = typeof folderId === "number" ? folderId : null;
    if (payload.kind === "folder") {
        const res = await api.updateFolder(payload.id, { parentId: target });
        if (!res.ok) {
            toast(errorText(res), "error");
            return false;
        }
        if (target) prefs.mineExpanded = [...new Set([...(prefs.mineExpanded || []), target])];
        savePrefs();
        await reloadFolders();
        return true;
    }
    if (payload.kind === "tasks" && payload.source === "mine") {
        const res = await api.updateItems(payload.ids, { folderId: target });
        if (!res.ok) {
            toast(errorText(res), "error");
            return false;
        }
        api.forgetItems(payload.ids);
        toast(t("bank.moved").replace("{folder}", folderLabel(target)));
    } else {
        const items = payload.kind === "question"
            ? [await toBankItem(questionAt(payload.index))].filter(Boolean)
            : (await api.loadItems(payload.ids)).filter(Boolean).map(copyOf);
        if (!items.length) {
            toast(t("bank.saveFailed"), "error");
            return false;
        }
        if (!reportSaved(await api.createItems(items, { folderId: target }), folderLabel(target))) return false;
    }
    await reloadFolders();
    reloadMine();
    return true;
}

// A bank task copied into one's own bank keeps its classification (its pictures are shared)
function copyOf(item) {
    return {
        content: item.content,
        subjectId: item.subjectId,
        gradeId: item.gradeId,
        topicId: item.topicId,
        difficultyId: item.difficultyId,
        values: item.values
    };
}

// A question from the quiz, as the bank stores it; one that came from the bank keeps that
// task's classification
async function toBankItem(question) {
    if (!question) return null;
    const content = JSON.parse(JSON.stringify(question));
    const bankId = content.source?.bankId;
    delete content.id;
    delete content.source;
    content.type ||= "multiple-choice";
    const asDataUrl = image => (/^(data:|\/api\/media\/|https?:)/.test(image) ? image : `data:image/jpeg;base64,${image}`);
    if (content.image) content.image = asDataUrl(content.image);
    for (const choice of content.choices || []) if (choice.image) choice.image = asDataUrl(choice.image);
    const [origin] = bankId ? await api.loadItems([bankId]) : [null];
    return origin ? { ...copyOf(origin), content } : { content };
}

async function saveToMine(ids) {
    const items = (await api.loadItems(ids)).filter(Boolean).map(copyOf);
    if (!items.length) {
        toast(t("bank.saveFailed"), "error");
        return;
    }
    const folderId = typeof mine.folderId === "number" ? mine.folderId : null;
    if (reportSaved(await api.createItems(items, { folderId }), folderLabel(folderId))) {
        await reloadFolders();
        reloadMine();
    }
}

// Removed at once, with a moment to take it back (the task is archived, so it can come back)
async function removeMine(item) {
    const res = await api.archiveItems([item.id]);
    if (!res.ok) {
        toast(errorText(res), "error");
        return;
    }
    api.forgetItems([item.id]);
    closeSheet();
    toast(t("bank.removed"), "ok", {
        label: t("bank.undo"),
        run: async () => {
            const back = await api.updateItems([item.id], { status: "published" });
            if (!back.ok) {
                toast(errorText(back), "error");
                return;
            }
            await reloadFolders();
            reloadMine();
        }
    });
    await reloadFolders();
    reloadMine();
}

function reportSaved(res, label) {
    if (!res.ok) {
        toast(errorText(res), "error");
        return false;
    }
    const { created = 0, duplicates = 0, failed = 0, results = [] } = res.data;
    if (created) toast(t("bank.saved").replace("{folder}", label));
    else if (duplicates) toast(t("bank.alreadySaved"));
    if (failed) toast(`${t("bank.saveFailed")}: ${results.find(r => r?.error)?.error || ""}`, "error");
    return created + duplicates > 0;
}

// --- Into the quiz ---

function dragRows(e, item, row, list, source) {
    if (e.pointerType === "mouse") e.preventDefault(); // no text selection while dragging
    const ids = list.selected.includes(item.id) ? list.selected : [item.id];
    armDrag(e, {
        source: row,
        payload: { kind: "tasks", source, ids, questions: () => questionsFor(ids) },
        ghost: () => rowGhost(row, ids.length),
        onStart: () => {
            api.loadItems(ids); // ready by the time it is dropped
            row.classList.add("is-drag-source");
            if (layoutMode() === "drawer") document.body.classList.add("bank-drawer-peek");
        },
        onEnd: () => {
            row.classList.remove("is-drag-source");
            document.body.classList.remove("bank-drawer-peek");
        }
    });
}

function dragTopic(e, node) {
    const count = Number(node.dataset.count || 0);
    if (!count) return;
    if (e.pointerType === "mouse") e.preventDefault();
    const topicId = parseTopic(node.dataset.topic);
    const name = node.querySelector(".bank-node-name").textContent;
    armDrag(e, {
        source: node,
        payload: { kind: "tasks", source: "topic", questions: point => pickFromTopic(topicId, count, point) },
        ghost: () => {
            const el = document.createElement("div");
            el.className = "drag-topic";
            el.innerHTML = `${icon("stack", 18)}<span></span><b>${escapeHtml(countLabel(count))}</b>`;
            el.querySelector("span").textContent = name;
            return el;
        },
        onStart: () => { if (layoutMode() === "drawer") document.body.classList.add("bank-drawer-peek"); },
        onEnd: () => document.body.classList.remove("bank-drawer-peek")
    });
}

function rowGhost(row, count) {
    const el = row.cloneNode(true);
    el.classList.remove("is-selected", "is-drag-source");
    el.removeAttribute("style");
    el.removeAttribute("tabindex");
    if (count > 1) el.insertAdjacentHTML("beforeend", `<span class="drag-count">${count}</span>`);
    return el;
}

// Random tasks from a topic (within the current filters), as many as the teacher picks
async function pickFromTopic(topicId, available, anchor) {
    const count = await askCount(anchor, available);
    if (!count) return [];
    const res = await api.sampleItems({ ...listFilter(), topic: topicId ?? undefined }, count);
    if (!res.ok || !res.data.ids?.length) {
        toast(t("bank.loadFailed"), "error");
        return [];
    }
    return questionsFor(res.data.ids);
}

// Quiz questions from bank tasks: new IDs, a note of where they came from, pictures embedded
// again (a quiz carries its own pictures)
async function questionsFor(ids) {
    const items = (await api.loadItems(ids)).filter(Boolean);
    const lost = { pictures: 0 };
    const questions = await Promise.all(items.map(item => toQuestion(item, lost)));
    if (items.length) api.markUsed(items.map(item => item.id));
    if (lost.pictures) toast(t("bank.pictureLost"), "error");
    return questions;
}

async function toQuestion(item, lost) {
    const question = JSON.parse(JSON.stringify(item.content));
    question.id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    question.source = { bankId: item.id };
    // A picture that can't be fetched is left out rather than shown broken; the teacher is told
    const embed = async (holder, key) => {
        try {
            holder[key] = await inlineImage(holder[key]);
        } catch (error) {
            console.warn("A bank picture could not be loaded", error);
            delete holder[key];
            lost.pictures++;
        }
    };
    if (question.image) await embed(question, "image");
    for (const choice of question.choices || []) if (choice.image) await embed(choice, "image");
    return question;
}

async function inlineImage(src) {
    if (typeof src !== "string" || !src.startsWith("/api/media/")) return src;
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Picture ${res.status}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function addTasks(ids, fromEl) {
    if (justDragged() || !ids.length || ids.some(id => adding.has(id))) return; // a double click adds once
    ids.forEach(id => adding.add(id));
    try {
        const questions = await questionsFor(ids);
        if (!questions.length) {
            toast(t("bank.loadFailed"), "error");
            return;
        }
        insertAndReveal(questions, fromEl);
    } finally {
        // Held a moment longer: a double click's second click comes after a quick insert is done
        setTimeout(() => ids.forEach(id => adding.delete(id)), 600);
    }
}

// The new questions go to the end of the quiz; a copy of the row flies to where they land
function insertAndReveal(questions, fromEl) {
    const cards = insertQuestions(questions, null, { scroll: false });
    if (layoutMode() === "drawer") {
        toast(t("bank.added").replace("{n}", questions.length));
        return;
    }
    const card = cards[0];
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const scroller = document.scrollingElement;
    let shift = 0;
    if (rect.top < 60 || rect.top > window.innerHeight - 140) {
        const top = Math.max(0, Math.min(scroller.scrollHeight - window.innerHeight, scroller.scrollTop + rect.top - window.innerHeight * 0.3));
        shift = top - scroller.scrollTop;
        window.scrollTo({ top, behavior: reduceMotion.matches ? "auto" : "smooth" });
    }
    if (!fromEl?.isConnected || reduceMotion.matches) return;
    const from = fromEl.getBoundingClientRect();
    const ghost = rowGhost(fromEl, questions.length);
    ghost.classList.add("bank-fly");
    Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px` });
    document.body.appendChild(ghost);
    const dx = rect.left - from.left;
    const dy = rect.top - shift - from.top;
    const scale = Math.min(1.8, rect.width / from.width);
    ghost.animate([
        { transform: "none", opacity: 1 },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 36}px) scale(${(1 + scale) / 2})`, opacity: 0.95, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0 }
    ], { duration: 640, easing: EASE }).onfinish = () => ghost.remove();
    setTimeout(() => ghost.remove(), 1500); // a hidden tab plays no animation: never left behind
}

// "How many tasks?" beside the drop point (or a button); resolves to a number or null
function askCount(anchor, available) {
    closePopover();
    const most = Math.min(available, MAX_SAMPLE);
    const choices = [3, 5, 10, 20, 30, 50].filter(n => n < most).slice(-4);
    if (!choices.length && most > 1) choices.push(1);
    return new Promise(resolve => {
        const el = document.createElement("div");
        el.className = "bank-popover";
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-label", t("bank.howMany"));
        el.innerHTML = `<p class="bank-popover-title">${t("bank.howMany")}</p>
            <div class="bank-popover-chips">
                ${choices.map(n => `<button type="button" class="bank-chip" data-count="${n}">${n}</button>`).join("")}
                <button type="button" class="bank-chip is-on" data-count="${most}">${available <= MAX_SAMPLE ? t("bank.allN").replace("{n}", most) : most}</button>
            </div>
            <button type="button" class="bank-link bank-popover-cancel">${t("bank.cancel")}</button>`;
        document.body.appendChild(el);
        const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 };
        const left = Math.max(12, Math.min(window.innerWidth - el.offsetWidth - 12, rect.left + rect.width / 2 - el.offsetWidth / 2));
        const below = rect.bottom + 12;
        el.style.left = `${left}px`;
        el.style.top = `${below + el.offsetHeight > window.innerHeight - 12 ? Math.max(12, rect.top - el.offsetHeight - 12) : below}px`;
        const done = value => {
            if (popover?.el !== el) return;
            popover = null;
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("keydown", onKey, true);
            el.classList.add("is-leaving");
            setTimeout(() => el.remove(), 180);
            resolve(value);
        };
        const outside = e => { if (!el.contains(e.target)) done(null); };
        const onKey = e => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            done(null);
        };
        el.addEventListener("click", e => {
            const chip = e.target.closest("[data-count]");
            if (chip) done(Number(chip.dataset.count));
            else if (e.target.closest(".bank-popover-cancel")) done(null);
        });
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", onKey, true);
        popover = { el, done };
        el.querySelector(".is-on").focus({ preventScroll: true });
    });
}

function closePopover() {
    popover?.done(null);
}

// --- Filling and sorting the bank ---

// A sheet in a panel holding a form: a title, the form and its buttons. An action that returns
// false keeps the sheet open (something to fix first); Esc or the scrim closes it.
function openFormSheet(aside, { title, body, actions }) {
    closeSheet();
    const el = document.createElement("div");
    el.className = "bank-sheet is-form";
    el.innerHTML = `
        <div class="bank-sheet-scrim" data-act="close"></div>
        <div class="bank-sheet-card" role="dialog" tabindex="-1">
            <div class="bank-sheet-head">
                <h3 class="bank-sheet-title"></h3>
                <button type="button" class="bank-icon-btn" data-act="close" aria-label="${t("bank.close")}" title="${t("bank.close")}">${icon("close")}</button>
            </div>
            <div class="bank-sheet-body"></div>
            <div class="bank-sheet-actions"></div>
        </div>`;
    el.querySelector(".bank-sheet-title").textContent = title;
    el.querySelector(".bank-sheet-card").setAttribute("aria-label", title);
    el.querySelector(".bank-sheet-body").appendChild(body);
    const bar = el.querySelector(".bank-sheet-actions");
    for (const action of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `btn ${action.primary ? "btn-primary" : action.danger ? "btn-danger" : "btn-secondary"}`;
        button.textContent = action.label;
        button.addEventListener("click", async () => {
            const buttons = [...bar.querySelectorAll("button")];
            buttons.forEach(b => { b.disabled = true; });
            let keepOpen;
            try {
                keepOpen = (await action.run()) === false;
            } finally {
                buttons.forEach(b => { b.disabled = false; });
            }
            if (!keepOpen && sheet?.el === el) closeSheet();
        });
        bar.appendChild(button);
    }
    aside.appendChild(el);
    sheet = { el, aside, list: null };
    el.addEventListener("click", e => { if (e.target.closest('[data-act="close"]')) closeSheet(); });
    el.addEventListener("keydown", e => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        closeSheet();
    });
    requestAnimationFrame(() => el.classList.add("is-open"));
    (body.querySelector("input, select, textarea") || el.querySelector(".bank-sheet-card")).focus({ preventScroll: true });
}

// After tasks were added or changed: one's own lists at once; the shared bank once its counts have
// been counted again (in the background, about a second)
function afterChange(mineScope) {
    if (mineScope) {
        reloadFolders();
        reloadMine();
    } else {
        setTimeout(reloadBank, 1200);
    }
}

// Tasks into the bank from Word, PDF or text through the import dialog, or the quiz's own
// questions (preset). Staff choose the shared bank or their own; everyone else fills their own.
// The classification starts where the bank is open (subject, grade, topic, folder).
function openBankImport({ scope, preset = null }) {
    const admin = limits.writeShared;
    const fields = classifyFields(meta, {
        subjects: meta.subjects.filter(subject => !subject.archived),
        subjectId: bank.subjectId,
        gradeId: bank.gradeId,
        topicId: typeof bank.topicId === "number" ? bank.topicId : null,
        scopes: admin ? ["shared", "mine"] : null,
        scope: admin ? scope : "mine",
        folders: mine.folders,
        folderId: typeof mine.folderId === "number" ? mine.folderId : null
    });
    openImportDialog({
        ...importHelpers(),
        title: t(preset ? "bank.saveQuizTitle" : "bank.importTitle"),
        confirmLabel: n => t("bank.importConfirm").replace("{n}", n),
        extra: fields.el,
        preset: preset ? { questions: preset } : undefined,
        onImport: questions => saveToBank(questions, fields.read())
    });
}

// Sent in parts the server takes (at most 500 tasks and about 8 MB of pictures each); one notice
// says what was added, what was there already and what failed
async function saveToBank(questions, { scope, defaults }) {
    const items = (await Promise.all(questions.map(toBankItem))).filter(Boolean);
    const parts = [];
    let part = [];
    let size = 0;
    for (const item of items) {
        const bytes = JSON.stringify(item).length;
        if (part.length && (part.length >= 500 || size + bytes > 8e6)) {
            parts.push(part);
            part = [];
            size = 0;
        }
        part.push(item);
        size += bytes;
    }
    if (part.length) parts.push(part);
    toast(t("bank.saving").replace("{n}", items.length));
    const sum = { created: 0, duplicates: 0, failed: 0, error: "" };
    for (const chunk of parts) {
        const res = await api.createItems(chunk, defaults, scope);
        if (!res.ok) {
            sum.failed += chunk.length;
            sum.error ||= errorText(res);
            continue;
        }
        sum.created += res.data.created || 0;
        sum.duplicates += res.data.duplicates || 0;
        sum.failed += res.data.failed || 0;
        sum.error ||= res.data.results?.find(result => result?.error)?.error || "";
    }
    const where = scope === "mine" ? folderLabel(defaults.folderId) : t("bank.sharedBank");
    const note = t("bank.savedMany").replace("{n}", sum.created).replace("{where}", where)
        + (sum.duplicates ? ` · ${t("bank.duplicates").replace("{n}", sum.duplicates)}` : "");
    toast(note, sum.created || sum.duplicates ? "ok" : "error");
    if (sum.failed) toast(`${t("bank.saveFailed")} (${sum.failed}): ${sum.error}`, "error");
    afterChange(scope === "mine");
}

// The same topic, grade, difficulty or folder for every selected task, or all of them out
function openBulkEdit(aside, list) {
    const ids = list.selected;
    if (!ids.length) return;
    const mineScope = aside === els.mine;
    const scope = mineScope ? "mine" : "shared";
    const fields = classifyFields(meta, { subjects: meta.subjects.filter(subject => !subject.archived), subjectId: bank.subjectId, keep: true, scope, folders: mine.folders });
    const done = () => {
        api.forgetItems(ids);
        list.clearSelection();
        afterChange(mineScope);
    };
    openFormSheet(aside, {
        title: t("bank.bulkTitle").replace("{n}", ids.length),
        body: fields.el,
        actions: [
            {
                label: t("bank.apply"),
                primary: true,
                run: async () => {
                    const { set } = fields.read();
                    if (!Object.keys(set).length) {
                        toast(t("bank.nothingChosen"));
                        return false;
                    }
                    const res = await api.updateItems(ids, set, scope);
                    if (!res.ok) {
                        toast(errorText(res), "error");
                        return false;
                    }
                    toast(t("bank.bulkDone").replace("{n}", res.data.matched ?? ids.length));
                    done();
                }
            },
            {
                label: t(mineScope ? "bank.remove" : "bank.archiveTask"),
                danger: true,
                run: async () => {
                    if (!mineScope && !(await confirmDialog({
                        title: t("bank.archiveManyTitle").replace("{n}", ids.length),
                        message: t("bank.archiveBody"),
                        confirmText: t("bank.archiveTask"),
                        danger: true
                    }))) return false;
                    const res = await api.archiveItems(ids, scope);
                    if (!res.ok) {
                        toast(errorText(res), "error");
                        return false;
                    }
                    done();
                    if (!mineScope) {
                        toast(t("bank.archivedMany").replace("{n}", ids.length));
                        return;
                    }
                    toast(t("bank.removedMany").replace("{n}", ids.length), "ok", {
                        label: t("bank.undo"),
                        run: async () => {
                            const back = await api.updateItems(ids, { status: "published" });
                            if (back.ok) afterChange(true);
                            else toast(errorText(back), "error");
                        }
                    });
                }
            }
        ]
    });
}

// Sorting by dropping: admins drop shared tasks on a topic, anyone drops their own
function addTreeDropZone() {
    let lit = null;
    const light = el => {
        if (lit === el) return;
        lit?.classList.remove("is-drop-target");
        el?.classList.add("is-drop-target");
        lit = el;
    };
    addDropZone({
        el: els.tree,
        accepts: payload => shown && !bank.flagged && payload.kind === "tasks"
            && ((payload.source === "mine" && limits.writeMine) || (payload.source === "bank" && limits.writeShared)),
        over(payload, x, y, target) {
            const node = target.closest(".bank-node");
            if (!node || node.dataset.topic === "all") {
                light(null);
                return null;
            }
            light(node);
            return { topic: parseTopic(node.dataset.topic), el: node };
        },
        leave: () => light(null),
        async drop(payload, hint) {
            const mineScope = payload.source === "mine";
            const res = await api.updateItems(payload.ids, { topicId: hint.topic === "none" ? null : hint.topic }, mineScope ? "mine" : "shared");
            if (!res.ok) {
                toast(errorText(res), "error");
                return null;
            }
            api.forgetItems(payload.ids);
            const name = hint.topic === "none" ? t("bank.noTopic") : meta.topicsById.get(hint.topic)?.name || "";
            toast(t("bank.sortedInto").replace("{n}", payload.ids.length).replace("{topic}", name));
            afterChange(mineScope);
            return hint.el;
        }
    });
}

// A topic's own fields, with (for an existing one) its place among its siblings and a merge
function openTopicEditor({ topic = null, parentId = null }) {
    const subjectId = topic?.subjectId ?? bank.subjectId;
    const fields = topicFields(meta, { topic, subjectId, parentId });
    const body = document.createElement("div");
    body.appendChild(fields.el);
    if (topic) {
        const tools = document.createElement("div");
        tools.className = "bank-topic-tools";
        tools.innerHTML = `
            <div class="bank-topic-order"><span>${t("bank.topicOrder")}</span>
                <button type="button" class="bank-icon-btn" data-move="-1" aria-label="${t("bank.moveUp")}" title="${t("bank.moveUp")}">↑</button>
                <button type="button" class="bank-icon-btn" data-move="1" aria-label="${t("bank.moveDown")}" title="${t("bank.moveDown")}">↓</button>
            </div>
            <label class="bank-field bank-field-wide">${t("bank.mergeInto")}
                <span class="bank-merge"><select><option value="">—</option>${topicOptions(meta, subjectId, { exclude: topic.id })}</select>
                <button type="button" class="btn btn-secondary" data-merge>${t("bank.merge")}</button></span>
            </label>`;
        tools.addEventListener("click", async e => {
            const move = e.target.closest("[data-move]");
            if (move) {
                moveTopic(topic, Number(move.dataset.move));
                return;
            }
            if (!e.target.closest("[data-merge]")) return;
            const into = meta.topicsById.get(Number(tools.querySelector("select").value));
            if (!into) return;
            const ok = await confirmDialog({
                title: t("bank.mergeTitle").replace("{from}", topic.name).replace("{into}", into.name),
                message: t("bank.mergeBody"),
                confirmText: t("bank.merge"),
                danger: true
            });
            if (!ok) return;
            const res = await api.mergeTopic(topic.id, into.id);
            if (!res.ok) {
                toast(errorText(res), "error");
                return;
            }
            if (bank.topicId === topic.id) {
                bank.topicId = into.id;
                rememberTopic();
            }
            closeSheet();
            toast(t("bank.merged"));
            await refreshMeta();
        });
        body.appendChild(tools);
    }
    const actions = [{
        label: t("bank.save"),
        primary: true,
        run: async () => {
            const values = fields.read();
            if (!values.name) {
                toast(t("bank.topicNameNeeded"), "error");
                return false;
            }
            const res = topic ? await api.updateTopic(topic.id, values) : await api.createTopic(values);
            if (!res.ok) {
                toast(errorText(res), "error");
                return false;
            }
            if (values.parentId) saveExpanded(new Set([...expandedTopics(), values.parentId]));
            toast(t("bank.topicSaved"));
            await refreshMeta();
        }
    }];
    if (topic) {
        actions.push({
            label: t("bank.delete"),
            danger: true,
            run: async () => {
                const ok = await confirmDialog({ title: t("bank.deleteTopicTitle").replace("{name}", topic.name), message: t("bank.deleteTopicBody"), confirmText: t("bank.delete"), danger: true });
                if (!ok) return false;
                const res = await api.deleteTopic(topic.id);
                if (!res.ok) {
                    toast(res.status === 409 ? t("bank.topicNotEmpty") : errorText(res), "error");
                    return false;
                }
                toast(t("bank.topicDeleted"));
                await refreshMeta();
            }
        });
    }
    openFormSheet(els.panel, { title: t(topic ? "bank.editTopic" : parentId ? "bank.newSubtopic" : "bank.newArea"), body, actions });
}

// One step up or down among its siblings
async function moveTopic(topic, step) {
    const siblings = meta.childrenOf(topic.parentId ?? `s${topic.subjectId}`).map(sibling => sibling.id);
    const from = siblings.indexOf(topic.id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= siblings.length) return;
    [siblings[from], siblings[to]] = [siblings[to], siblings[from]];
    const res = await api.reorderTopics(siblings);
    if (!res.ok) {
        toast(errorText(res), "error");
        return;
    }
    await refreshMeta();
    if (sheet?.el.querySelector(".bank-topic-tools")) toast(t("bank.topicMoved"));
}

// --- Preview ---

function openSheet(aside, list, index, scope) {
    if (justDragged() || !list.items[index]) return;
    if (sheet?.aside === aside && sheet.list) {
        sheet.index = index;
        showSheetItem();
        return;
    }
    closeSheet();
    const el = document.createElement("div");
    el.className = "bank-sheet";
    el.innerHTML = `
        <div class="bank-sheet-scrim" data-act="close"></div>
        <div class="bank-sheet-card" role="dialog" aria-label="${t("bank.preview")}" tabindex="-1">
            <div class="bank-sheet-head">
                <div class="bank-sheet-meta"></div>
                ${scope === "bank" ? `
                <button type="button" class="bank-icon-btn bank-sheet-star" data-act="star" aria-pressed="false" aria-label="${t("bank.star")}" title="${t("bank.star")}">${icon("star")}</button>
                <button type="button" class="bank-icon-btn" data-act="report" aria-label="${t("bank.report")}" title="${t("bank.report")}">${icon("flag")}</button>` : ""}
                <button type="button" class="bank-icon-btn" data-act="prev" aria-label="${t("bank.prev")}" title="${t("bank.prev")}">${icon("prev")}</button>
                <button type="button" class="bank-icon-btn" data-act="next" aria-label="${t("bank.next")}" title="${t("bank.next")}">${icon("next")}</button>
                <button type="button" class="bank-icon-btn" data-act="close" aria-label="${t("bank.close")}" title="${t("bank.close")}">${icon("close")}</button>
            </div>
            <div class="bank-sheet-body"></div>
            <form class="bank-report" hidden>
                <p class="bank-report-title">${t("bank.reportTitle")}</p>
                <div class="bank-report-reasons" role="radiogroup" aria-label="${t("bank.reportTitle")}">
                    ${REPORT_REASONS.map(reason => `<button type="button" class="bank-chip" role="radio" aria-checked="false" data-reason="${reason}">${t(`bank.reason.${reason}`)}</button>`).join("")}
                </div>
                <textarea class="bank-report-note" rows="2" maxlength="500" placeholder="${t("bank.reportNote")}" aria-label="${t("bank.reportNote")}"></textarea>
                <div class="bank-report-actions">
                    <button type="submit" class="btn btn-primary" disabled>${t("bank.reportSend")}</button>
                    <button type="button" class="btn btn-secondary" data-act="report-cancel">${t("bank.cancel")}</button>
                </div>
            </form>
            <div class="bank-sheet-actions">
                <button type="button" class="btn btn-primary" data-act="add">${icon("plus", 16)}<span>${t("bank.add")}</span></button>
                ${scope === "bank"
                    ? (limits.writeMine ? `<button type="button" class="btn btn-secondary" data-act="save">${icon("folder", 16)}<span>${t("bank.saveMine")}</span></button>` : "")
                    : `<button type="button" class="btn btn-secondary" data-act="remove">${icon("trash", 16)}<span>${t("bank.remove")}</span></button>`}
            </div>
        </div>`;
    aside.appendChild(el);
    sheet = { el, aside, list, index, scope, full: null };
    el.addEventListener("click", onSheetClick);
    el.addEventListener("keydown", onSheetKey);
    el.querySelector(".bank-report").addEventListener("submit", sendReport);
    requestAnimationFrame(() => el.classList.add("is-open"));
    el.querySelector(".bank-sheet-card").focus({ preventScroll: true });
    showSheetItem();
}

async function showSheetItem() {
    const current = sheet;
    const item = current.list.items[current.index];
    if (!item) return;
    current.full = null;
    current.el.querySelector(".bank-sheet-meta").innerHTML = rowMetaHtml(item, current.scope === "mine");
    current.el.querySelector('[data-act="prev"]').disabled = current.index <= 0;
    current.el.querySelector('[data-act="next"]').disabled = current.index >= current.list.items.length - 1;
    closeReportForm();
    sheetStar();
    const body = current.el.querySelector(".bank-sheet-body");
    body.classList.add("is-loading");
    if (bank.flagged && current.scope === "bank") api.forgetItems([item.id]); // reviewing reports: always fresh
    const [full] = await api.loadItems([item.id]);
    if (sheet !== current || current.list.items[current.index] !== item) return;
    current.full = full;
    body.classList.remove("is-loading");
    body.innerHTML = full ? reportsHtml(full) + questionHtml(full.content) : `<p class="bank-muted">${t("bank.loadFailed")}</p>`;
    typeset(body);
    body.scrollTop = 0;
    sheetReportButton();
}

function sheetStar() {
    const button = sheet?.el.querySelector('[data-act="star"]');
    const item = sheet?.list?.items[sheet.index];
    if (!button || !item) return;
    const on = favorites.has(item.id);
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
}

// Already reported by this teacher: the flag says so instead of offering the form again
function sheetReportButton() {
    const button = sheet?.el.querySelector('[data-act="report"]');
    if (!button || !sheet.full) return;
    const done = !!sheet.full.reportedByMe;
    button.disabled = done;
    button.classList.toggle("is-on", done);
    const label = t(done ? "bank.reported" : "bank.report");
    button.title = label;
    button.setAttribute("aria-label", label);
}

// Admins see a task's open reports above it, with what to do about them
function reportsHtml(full) {
    if (!full.reports?.length) return "";
    const date = value => new Date(value).toLocaleDateString(getLanguage() === "lt" ? "lt-LT" : "en-GB");
    return `<section class="bank-reports">
        <p class="bank-reports-title">${icon("flag", 15)}${escapeHtml(t("bank.reportsOpen").replace("{n}", full.reports.length))}</p>
        <ul>${full.reports.map(report => `<li><b>${escapeHtml(t(`bank.reason.${report.reason}`))}</b>${report.note ? ` „${escapeHtml(report.note)}“` : ""}
            <span>· ${escapeHtml(report.user || "—")} · ${escapeHtml(date(report.createdAt))}</span></li>`).join("")}</ul>
        <div class="bank-reports-actions">
            <button type="button" class="btn btn-primary" data-act="resolve">${t("bank.resolve")}</button>
            <button type="button" class="btn btn-secondary" data-act="dismiss">${t("bank.dismiss")}</button>
            <button type="button" class="btn btn-secondary" data-act="archive">${t("bank.archiveTask")}</button>
        </div>
    </section>`;
}

function openReportForm() {
    const form = sheet?.el.querySelector(".bank-report");
    if (!form || !sheet.full || sheet.full.reportedByMe) return;
    form.hidden = false;
    form.querySelector("[data-reason]").focus();
}

function closeReportForm() {
    const form = sheet?.el.querySelector(".bank-report");
    if (!form) return;
    form.hidden = true;
    form.reset();
    form.querySelectorAll("[data-reason]").forEach(chip => {
        chip.classList.remove("is-on");
        chip.setAttribute("aria-checked", "false");
    });
    form.querySelector('[type="submit"]').disabled = true;
}

async function sendReport(e) {
    e.preventDefault();
    const current = sheet;
    const form = e.target;
    const reason = form.querySelector('[data-reason][aria-checked="true"]')?.dataset.reason;
    if (!current?.full || !reason) return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const res = await api.reportItem(current.full.id, reason, form.querySelector(".bank-report-note").value);
    if (res.ok || res.status === 409) {
        current.full.reportedByMe = true;
        api.forgetItems([current.full.id]); // fetched again next time, with the report
        toast(t(res.ok ? "bank.reportThanks" : "bank.reportedAlready"));
        if (sheet === current) {
            closeReportForm();
            sheetReportButton();
        }
        refreshFlagged();
    } else {
        submit.disabled = false;
        toast(errorText(res), "error");
    }
}

// An admin's answer to a task's reports: fixed, nothing wrong, or the task taken out of the bank
async function closeTaskReports(action) {
    const current = sheet;
    const id = current?.full?.id;
    if (!id) return;
    if (action === "archive") {
        const ok = await confirmDialog({ title: t("bank.archiveTitle"), message: t("bank.archiveBody"), confirmText: t("bank.archiveTask"), danger: true });
        if (!ok) return;
        const res = await api.archiveItems([id], "shared");
        if (!res.ok) {
            toast(errorText(res), "error");
            return;
        }
    }
    const res = await api.closeReports(id, action === "dismiss" ? "dismissed" : "resolved");
    if (!res.ok) {
        toast(errorText(res), "error");
        return;
    }
    api.forgetItems([id]);
    toast(t(action === "archive" ? "bank.archived" : "bank.reportsClosed"));
    refreshFlagged();
    if (action === "archive" || bank.flagged) {
        closeSheet();
        reloadBank();
    } else if (sheet === current) {
        showSheetItem();
    }
}

function onSheetClick(e) {
    const reason = e.target.closest("[data-reason]");
    if (reason && sheet) {
        reason.parentElement.querySelectorAll("[data-reason]").forEach(chip => {
            chip.classList.toggle("is-on", chip === reason);
            chip.setAttribute("aria-checked", String(chip === reason));
        });
        sheet.el.querySelector('.bank-report [type="submit"]').disabled = false;
        return;
    }
    const button = e.target.closest("[data-act]");
    if (!button || !sheet) return;
    const item = sheet.list.items[sheet.index];
    const act = button.dataset.act;
    if (!item && act !== "close") {
        closeSheet(); // the list was listed anew under it
        return;
    }
    if (act === "close") closeSheet();
    else if (act === "prev" || act === "next") {
        sheet.index += act === "next" ? 1 : -1;
        showSheetItem();
    } else if (act === "add") addTasks([item.id], sheet.list.rowOf(item.id));
    else if (act === "save") saveToMine([item.id]);
    else if (act === "remove") removeMine(item);
    else if (act === "star") toggleFavorite(item.id);
    else if (act === "report") openReportForm();
    else if (act === "report-cancel") closeReportForm();
    else if (act === "resolve" || act === "dismiss" || act === "archive") closeTaskReports(act);
}

function onSheetKey(e) {
    if (!sheet) return;
    const typing = e.target.matches?.("textarea, input");
    if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!sheet.el.querySelector(".bank-report").hidden) closeReportForm();
        else closeSheet();
    } else if (typing) {
        // arrows move the caret in the note, not to another task
    } else if ((e.key === "ArrowDown" || e.key === "ArrowRight") && sheet.index < sheet.list.items.length - 1) {
        e.preventDefault();
        sheet.index++;
        showSheetItem();
    } else if ((e.key === "ArrowUp" || e.key === "ArrowLeft") && sheet.index > 0) {
        e.preventDefault();
        sheet.index--;
        showSheetItem();
    }
}

function closeSheet() {
    if (!sheet) return;
    const { el } = sheet;
    sheet = null;
    el.classList.remove("is-open");
    el.classList.add("is-closing");
    setTimeout(() => el.remove(), 260);
}

function questionHtml(q) {
    const picture = src => (src ? `<img class="bank-q-img" src="${escapeHtml(src)}" alt="">` : "");
    const line = (label, html) => `<p class="bank-q-answer"><span>${label}</span><b class="bank-math">${html}</b></p>`;
    const type = q.type || "multiple-choice";
    let answer;
    if (type === "multiple-choice") {
        answer = `<ol class="bank-q-choices">${(q.choices || []).map(choice => `
            <li class="${choice.isCorrect ? "is-correct" : ""}">${picture(choice.image)}<span class="bank-math">${escapeHtml(choice.text || "")}</span>${choice.isCorrect ? icon("check", 16) : ""}</li>`).join("")}</ol>`;
    } else if (type === "numeric") {
        const tolerance = Number(q.toleranceValue) ? ` ± ${escapeHtml(String(q.toleranceValue))}` : "";
        answer = line(t("bank.answer"), `${escapeHtml(String(q.correctAnswerNumber ?? "—"))}${tolerance}`);
    } else if (type === "true-false") {
        answer = line(t("bank.answer"), q.isTrue ? t("bank.true") : t("bank.false"));
    } else if (type === "fill-blank") {
        answer = line(t("bank.answers"), escapeHtml((q.blankAnswers || []).join("; ") || "—"));
    } else {
        answer = `<p class="bank-q-note">${t(type === "image-upload" ? "bank.upload" : "bank.freeText")}</p>`;
    }
    return `${picture(q.image)}<div class="bank-q-prompt bank-math">${escapeHtml(q.prompt || "")}</div>${answer}`;
}

function typeset(el) {
    try {
        window.renderMathInElement?.(el, {
            delimiters: [{ left: "\\(", right: "\\)", display: false }, { left: "\\[", right: "\\]", display: true }],
            throwOnError: false
        });
    } catch {
        // formulas stay as text
    }
}

// --- Small shared pieces ---

// A row's second line; in the bank the chosen topic is not repeated on every row
function rowMetaHtml(item, mineScope) {
    const parts = [];
    if (bank.flagged && !mineScope) parts.push(`<span class="bank-flag" title="${t("bank.flaggedTitle")}">${icon("flag", 12)}</span>`);
    if (inQuiz.has(item.id)) parts.push(`<span class="bank-in-quiz">${icon("check", 12)}${escapeHtml(t("bank.inQuiz"))}</span>`);
    const level = meta?.levelsById.get(item.difficultyId);
    if (level) parts.push(`<span class="bank-pill" style="--lvl:${escapeHtml(level.color || "var(--muted)")}"><i aria-hidden="true"></i>${escapeHtml(level.name)}</span>`);
    if (item.gradeId) parts.push(`<span>${escapeHtml(t("bank.gradeShort").replace("{n}", item.gradeId))}</span>`);
    const topic = meta?.topicsById.get(item.topicId);
    if (topic && (mineScope || topic.id !== bank.topicId)) parts.push(`<span class="bank-row-topic">${escapeHtml(topic.name)}</span>`);
    const showFolder = mineScope && mine.folderId === "all";
    const folder = showFolder && item.folderId ? folderById(item.folderId) : null;
    if (folder) parts.push(`<span class="bank-row-topic">${icon("folder", 12)}${escapeHtml(folder.name)}</span>`);
    if (item.hasImage) parts.push(`<span class="bank-row-ico" title="${t("bank.hasImage")}">${icon("image", 14)}</span>`);
    parts.push(`<span class="bank-row-type">${escapeHtml(t(`bank.qtype.${item.qtype}`))}</span>`);
    return parts.join("");
}

const emptyState = (name, title, hint) =>
    `<div class="bank-empty-ico">${icon(name, 30)}</div><p><b>${t(title)}</b></p>${hint ? `<p>${t(hint)}</p>` : ""}`;

function emptyHtml(res, scope) {
    if (!res?.ok) return emptyState("alert", "bank.loadFailed");
    if (scope !== "mine") return emptyState("search", "bank.empty", "bank.emptyHint");
    if (mine.q.trim()) return emptyState("search", "bank.empty", "bank.mineSearchHint");
    if (mine.folderId === "favorites") return emptyState("star", "bank.favoritesEmpty", "bank.favoritesHint");
    if (mine.folderId === "all") return emptyState("folder", "bank.mineEmpty", "bank.mineHint");
    if (mine.folderId === "none") return emptyState("inbox", "bank.unfiledEmpty", "bank.unfiledHint");
    return emptyState("folder", "bank.folderEmpty", "bank.folderHint");
}

function updateSelbar(aside, ids) {
    const bar = aside.querySelector(".bank-selbar");
    bar.hidden = !ids.length;
    bar.querySelector(".bank-selbar-count").textContent = t("bank.selected").replace("{n}", ids.length);
}

function countLabel(n) {
    let form = n === 1 ? "one" : "many";
    if (getLanguage() === "lt") {
        const last = n % 10;
        const tens = n % 100;
        form = last === 1 && tens !== 11 ? "one" : last >= 2 && (tens < 10 || tens >= 20) ? "few" : "many";
    }
    return `${n} ${t(`bank.tasks.${form}`)}`;
}

function errorText(res) {
    if (res.status === 0) return t("bank.offline");
    return res.data?.error ? `${t("bank.saveFailed")}: ${res.data.error}` : t("bank.saveFailed");
}

// A short notice at the bottom; with an action (Undo) it stays longer and its button takes it away
function toast(message, tone = "ok", action = null) {
    if (!els.toasts) return;
    const el = document.createElement("div");
    el.className = `bank-toast is-${tone}`;
    el.setAttribute("role", tone === "error" ? "alert" : "status");
    el.textContent = message;
    const leave = () => {
        if (el.classList.contains("is-leaving")) return;
        el.classList.add("is-leaving");
        setTimeout(() => el.remove(), 300);
    };
    if (action) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "bank-toast-action";
        button.textContent = action.label;
        button.addEventListener("click", () => {
            leave();
            action.run();
        }, { once: true });
        el.appendChild(button);
    }
    els.toasts.appendChild(el);
    setTimeout(leave, action ? 6500 : tone === "error" ? 4200 : 2400);
}
