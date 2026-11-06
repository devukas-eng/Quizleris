// The admin's Showcase tab: which quiz codes rotate on the landing page, and how. The left side is
// the list, the right side is the landing page's own code board with its settings beside it, so a
// change can be seen as it is made. Everything saves by itself.
import { browseAdminQuizzes, lookupAdminQuizzes, updateShowcaseSettings } from "./api.js";
import { t } from "./lang.js";
import { escapeHtml, skeletonHtml } from "./dom.js";
import { TICKER_EFFECTS, createBoard, startTicker } from "./code-ticker.js";
import { itemState, livePlaylist, liveItems, moveItem } from "./showcase-rules.js";

const SAVE_DELAY_MS = 450;
const SEARCH_DELAY_MS = 200;
const SAMPLE_CODES = ["R7M", "Q2K"];
const DEFAULT_PLAYLIST = "default";

// Only one tab is open at a time; stopShowcase() ends what is running in it
let active = null;

const pad = (n) => String(n).padStart(2, "0");
const toLocalInput = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

function inputValue(stored) {
    if (!stored) return "";
    const date = new Date(stored);
    return Number.isNaN(date.getTime()) ? String(stored).slice(0, 16) : toLocalInput(date);
}

function storedValue(input) {
    if (!input) return "";
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function cleanSettings(raw) {
    const playlists = (raw.playlists?.length ? raw.playlists : [{ id: DEFAULT_PLAYLIST, name: t("adminGui.showcaseDefaultPlaylist"), items: [] }])
        .map(list => ({
            id: String(list.id),
            name: String(list.name || ""),
            scheduleStart: list.scheduleStart || "",
            scheduleEnd: list.scheduleEnd || "",
            items: (list.items || []).map(item => ({
                quizId: String(item.quizId || "").trim(),
                customLabel: String(item.customLabel || ""),
                scheduleStart: item.scheduleStart || "",
                scheduleEnd: item.scheduleEnd || "",
                enabled: item.enabled !== false,
            })).filter(item => item.quizId),
        }));
    return {
        enabled: raw.enabled !== false,
        intervalSeconds: Math.max(2, Math.min(30, Number(raw.intervalSeconds) || 4)),
        action: raw.action === "start" ? "start" : "fill",
        animStyle: TICKER_EFFECTS.includes(raw.animStyle) ? raw.animStyle : "flip",
        displayFormat: raw.displayFormat === "code" ? "code" : "both",
        order: raw.order === "shuffle" ? "shuffle" : "list",
        activePlaylistId: playlists.some(list => list.id === raw.activePlaylistId) ? raw.activePlaylistId : playlists[0].id,
        playlists,
    };
}

function segmented(name, value, options) {
    return `
        <div class="sc-seg" role="group" aria-label="${escapeHtml(options.label)}">
            ${options.items.map(([id, label]) => `<button type="button" data-set="${name}" data-value="${id}" aria-pressed="${value === id}">${escapeHtml(label)}</button>`).join("")}
        </div>`;
}

function chromeHtml(cfg) {
    return `
        <section class="dash-section sc">
            <header class="sc-head">
                <div class="sc-head-text">
                    <h3>${escapeHtml(t("adminGui.showcaseTitle"))}</h3>
                    <p class="sc-status" id="sc-status"></p>
                </div>
                <span class="sc-saved" id="sc-saved" role="status"></span>
                <label class="sc-switch">
                    <input type="checkbox" id="sc-enabled" ${cfg.enabled ? "checked" : ""}>
                    <span class="sc-switch-track" aria-hidden="true"></span>
                    <span class="sr-only">${escapeHtml(t("showcase.enabled"))}</span>
                </label>
            </header>
            <div class="sc-grid">
                <div class="sc-main">
                    <div class="sc-lists" id="sc-lists"></div>
                    <div class="sc-list-settings" id="sc-list-settings" hidden></div>
                    <div class="sc-add">
                        <input type="search" id="sc-add-input" class="input-field" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t("showcase.addPlaceholder"))}" aria-label="${escapeHtml(t("showcase.addPlaceholder"))}">
                        <div class="sc-results" id="sc-results" hidden></div>
                    </div>
                    <div class="sc-items" id="sc-items"></div>
                </div>
                <aside class="sc-side">
                    <div class="sc-stage">
                        <p class="hero-pin-hint" id="sc-stage-hint">
                            <span class="hero-hint-line">${escapeHtml(t("menu.pinHintPrefix"))}
                                <span class="ct-button" id="sc-stage-board"></span>
                            </span>
                        </p>
                    </div>
                    <div class="sc-setting">
                        <span class="sc-setting-label">${escapeHtml(t("showcase.effect"))}</span>
                        <div class="sc-effects">
                            ${TICKER_EFFECTS.map(effect => `
                                <button type="button" class="sc-effect" data-effect="${effect}" aria-pressed="${cfg.animStyle === effect}">
                                    <span class="sc-effect-board" data-effect-board="${effect}"></span>
                                    <span>${escapeHtml(t(`showcase.effect.${effect}`))}</span>
                                </button>`).join("")}
                        </div>
                    </div>
                    <label class="sc-setting">
                        <span class="sc-setting-label">${escapeHtml(t("showcase.speed"))} <output id="sc-speed-out"></output></span>
                        <input type="range" id="sc-speed" min="2" max="30" step="1" value="${cfg.intervalSeconds}">
                    </label>
                    <div class="sc-setting">
                        <span class="sc-setting-label">${escapeHtml(t("showcase.order"))}</span>
                        ${segmented("order", cfg.order, { label: t("showcase.order"), items: [["list", t("showcase.orderList")], ["shuffle", t("showcase.orderShuffle")]] })}
                    </div>
                    <div class="sc-setting">
                        <span class="sc-setting-label">${escapeHtml(t("showcase.click"))}</span>
                        ${segmented("action", cfg.action, { label: t("showcase.click"), items: [["fill", t("showcase.clickFill")], ["start", t("showcase.clickStart")]] })}
                    </div>
                </aside>
            </div>
        </section>`;
}

/** Stops the preview and sends any change still waiting to be saved */
export function stopShowcase() {
    active?.stop();
    active = null;
}

/** Draws the tab in `panel`. `ctx`: settings (as the overview gives them), onSaved(settings). */
export async function renderShowcase(panel, ctx) {
    stopShowcase();
    if (!ctx.settings) {
        panel.innerHTML = `<div class="dash-empty"><p class="dash-muted">${escapeHtml(t("profile.loadError"))}</p></div>`;
        return;
    }
    panel.innerHTML = skeletonHtml(6);

    const cfg = cleanSettings(ctx.settings);
    const session = { stopped: false };
    let saveTimer = null;
    let saving = false;
    let unsaved = false;
    let ticker = null;
    let selectedId = livePlaylist(cfg)?.id || cfg.activePlaylistId;
    let settingsOpen = false;
    let openItem = null;
    let dragFrom = null;
    let searchTimer = null;
    let searchRun = 0;
    const quizzes = new Map();
    const boards = [];
    active = {
        stop() {
            session.stopped = true;
            ticker?.stop();
            boards.forEach(board => board.settle());
            if (unsaved) flushSave();
        },
    };

    const remember = (quiz) => quizzes.set(String(quiz.id).toLowerCase(), quiz);
    const quizOf = (id) => quizzes.get(String(id).toLowerCase());
    const selected = () => cfg.playlists.find(list => list.id === selectedId) || cfg.playlists[0];

    try {
        (await lookupAdminQuizzes([...new Set(cfg.playlists.flatMap(list => list.items.map(item => item.quizId)))])).forEach(remember);
    } catch {
        // The list still works from its codes; titles appear once the server answers again
    }
    if (session.stopped) return;

    panel.innerHTML = chromeHtml(cfg);
    const $ = (selector) => panel.querySelector(selector);
    const savedNote = $("#sc-saved");
    const results = $("#sc-results");
    const addInput = $("#sc-add-input");

    // ── Saving ──────────────────────────────────────────────────────────────

    async function flushSave() {
        clearTimeout(saveTimer);
        if (saving) return;
        saving = true;
        unsaved = false;
        const res = await updateShowcaseSettings(cfg);
        saving = false;
        if (!res.ok) {
            unsaved = true;
            savedNote.textContent = t("showcase.notSaved");
            savedNote.classList.add("is-error");
            return;
        }
        ctx.onSaved(res.data);
        document.dispatchEvent(new window.CustomEvent("quizleris-showcase-changed"));
        if (unsaved) flushSave();
        else {
            savedNote.textContent = t("showcase.saved");
            savedNote.classList.remove("is-error");
        }
    }

    function save() {
        unsaved = true;
        savedNote.textContent = "";
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
        drawStatus();
    }

    // ── Drawing ─────────────────────────────────────────────────────────────

    function drawStatus() {
        const live = cfg.enabled ? livePlaylist(cfg) : null;
        const items = liveItems(live);
        const text = !cfg.enabled ? t("showcase.statusOff")
            : !items.length ? t("showcase.statusEmpty")
            : items.length === 1 ? t("showcase.statusOne").replace("{code}", items[0].quizId).replace("{list}", live.name)
            : t("showcase.statusMany").replace("{n}", items.length).replace("{list}", live.name).replace("{s}", cfg.intervalSeconds);
        $("#sc-status").textContent = text;
    }

    function drawLists() {
        const live = livePlaylist(cfg);
        $("#sc-lists").innerHTML = cfg.playlists.map(list => `
            <button type="button" class="sc-list${list.id === selected().id ? " is-selected" : ""}" data-list="${escapeHtml(list.id)}" aria-pressed="${list.id === selected().id}">
                ${list.id === live?.id ? `<span class="sc-live-dot" title="${escapeHtml(t("showcase.liveNow"))}"></span>` : ""}
                <span>${escapeHtml(list.name)}</span>
                <span class="sc-list-count">${list.items.length}</span>
            </button>`).join("") + `
            <button type="button" class="sc-list sc-list-add" data-add-list>${escapeHtml(t("showcase.newList"))}</button>
            <button type="button" class="sc-list-gear" data-list-settings aria-expanded="${settingsOpen}" title="${escapeHtml(t("showcase.listSettings"))}" aria-label="${escapeHtml(t("showcase.listSettings"))}">⚙</button>`;
    }

    function drawListSettings() {
        const box = $("#sc-list-settings");
        box.hidden = !settingsOpen;
        if (!settingsOpen) return;
        const list = selected();
        const isMarked = list.id === cfg.activePlaylistId;
        box.innerHTML = `
            <label class="sc-field sc-field-wide">
                <span>${escapeHtml(t("showcase.listName"))}</span>
                <input type="text" class="input-field" id="sc-list-name" maxlength="60" value="${escapeHtml(list.name)}">
            </label>
            <label class="sc-field">
                <span>${escapeHtml(t("adminGui.showcaseScheduleFrom"))}</span>
                <input type="datetime-local" class="input-field" data-list-time="scheduleStart" value="${escapeHtml(inputValue(list.scheduleStart))}">
            </label>
            <label class="sc-field">
                <span>${escapeHtml(t("adminGui.showcaseScheduleUntil"))}</span>
                <input type="datetime-local" class="input-field" data-list-time="scheduleEnd" value="${escapeHtml(inputValue(list.scheduleEnd))}">
            </label>
            <div class="sc-list-actions">
                ${isMarked ? `<span class="sc-note">${escapeHtml(t("showcase.isLiveList"))}</span>`
                    : `<button type="button" class="btn btn-primary btn-compact" data-make-live>${escapeHtml(t("showcase.makeLive"))}</button>`}
                ${list.id !== DEFAULT_PLAYLIST && cfg.playlists.length > 1
                    ? `<button type="button" class="btn btn-secondary btn-compact dash-delete" data-delete-list>${escapeHtml(t("showcase.deleteList"))}</button>` : ""}
            </div>`;
    }

    function itemBadge(item, quiz) {
        if (!quiz) return `<span class="sc-badge is-bad">${escapeHtml(t("showcase.missing"))}</span>`;
        const state = itemState(item);
        return state === "active" ? "" : `<span class="sc-badge">${escapeHtml(t(`showcase.state.${state}`))}</span>`;
    }

    function itemHtml(item, index, count) {
        const quiz = quizOf(item.quizId);
        const isOpen = openItem === index;
        return `
            <div class="sc-item${isOpen ? " is-open" : ""}" data-index="${index}">
                <div class="sc-item-row">
                    <span class="sc-grip" draggable="true" data-grip title="${escapeHtml(t("showcase.drag"))}" aria-hidden="true">⠿</span>
                    <label class="sc-switch sc-switch-small">
                        <input type="checkbox" data-item-on ${item.enabled ? "checked" : ""}>
                        <span class="sc-switch-track" aria-hidden="true"></span>
                        <span class="sr-only">${escapeHtml(t("showcase.itemOn").replace("{code}", item.quizId))}</span>
                    </label>
                    <code class="sc-code">${escapeHtml(item.quizId)}</code>
                    <span class="sc-item-name">${escapeHtml(quiz?.title || "")}</span>
                    <span data-badge>${itemBadge(item, quiz)}</span>
                    ${quiz?.attempts ? `<span class="sc-plays" title="${escapeHtml(t("showcase.attempts"))}">${quiz.attempts}×</span>` : ""}
                    <button type="button" class="sc-icon" data-item-open aria-expanded="${isOpen}" title="${escapeHtml(t("showcase.itemSettings"))}" aria-label="${escapeHtml(t("showcase.itemSettings"))}">${isOpen ? "▴" : "▾"}</button>
                    <button type="button" class="sc-icon" data-item-remove title="${escapeHtml(t("adminGui.showcaseRemove"))}" aria-label="${escapeHtml(t("adminGui.showcaseRemove"))}">✕</button>
                </div>
                ${isOpen ? `
                    <div class="sc-item-more">
                        <label class="sc-field">
                            <span>${escapeHtml(t("adminGui.showcaseScheduleFrom"))}</span>
                            <input type="datetime-local" class="input-field" data-item-time="scheduleStart" value="${escapeHtml(inputValue(item.scheduleStart))}">
                        </label>
                        <label class="sc-field">
                            <span>${escapeHtml(t("adminGui.showcaseScheduleUntil"))}</span>
                            <input type="datetime-local" class="input-field" data-item-time="scheduleEnd" value="${escapeHtml(inputValue(item.scheduleEnd))}">
                        </label>
                        <div class="sc-list-actions">
                            <button type="button" class="btn btn-secondary btn-compact" data-item-for="24">${escapeHtml(t("showcase.for24h"))}</button>
                            <button type="button" class="btn btn-secondary btn-compact" data-item-for="168">${escapeHtml(t("showcase.for7d"))}</button>
                            <button type="button" class="btn btn-secondary btn-compact" data-item-for="0">${escapeHtml(t("showcase.always"))}</button>
                            <span class="sc-spacer"></span>
                            <button type="button" class="btn btn-secondary btn-icon btn-compact" data-item-move="-1" ${index === 0 ? "disabled" : ""} aria-label="${escapeHtml(t("admin.moveUp"))}">↑</button>
                            <button type="button" class="btn btn-secondary btn-icon btn-compact" data-item-move="1" ${index === count - 1 ? "disabled" : ""} aria-label="${escapeHtml(t("admin.moveDown"))}">↓</button>
                        </div>
                    </div>` : ""}
            </div>`;
    }

    function drawItems() {
        const { items } = selected();
        $("#sc-items").innerHTML = items.length
            ? items.map((item, index) => itemHtml(item, index, items.length)).join("")
            : `<div class="dash-empty"><p class="dash-muted">${escapeHtml(t("showcase.empty"))}</p></div>`;
    }

    /** The board shows the list being edited, so its result is visible before it goes live */
    function previewItems() {
        return liveItems(selected()).filter(item => quizOf(item.quizId)).map(item => ({ id: item.quizId }));
    }

    function drawPreview(changes = {}) {
        const items = previewItems();
        $("#sc-stage-hint").classList.toggle("is-off", !cfg.enabled);
        if (!ticker) {
            ticker = startTicker($("#sc-stage-board"), {
                items: items.length ? items : [{ id: "K7M3QX" }],
                effect: cfg.animStyle,
                order: cfg.order,
                intervalSeconds: cfg.intervalSeconds,
            });
            return;
        }
        ticker.update({ ...changes, items: items.length ? items : [{ id: "K7M3QX" }] });
    }

    function drawAll() {
        drawLists();
        drawListSettings();
        drawItems();
        drawStatus();
    }

    function itemsChanged() {
        drawLists();
        drawItems();
        drawPreview();
        save();
    }

    // ── Adding quizzes ──────────────────────────────────────────────────────

    function addQuiz(quiz) {
        remember(quiz);
        const list = selected();
        if (!list.items.some(item => item.quizId.toLowerCase() === String(quiz.id).toLowerCase())) {
            list.items.push({ quizId: quiz.id, customLabel: "", scheduleStart: "", scheduleEnd: "", enabled: true });
            itemsChanged();
        }
        addInput.value = "";
        results.hidden = true;
        addInput.focus();
    }

    let found = [];
    let foundFor = "";
    async function runSearch() {
        const q = addInput.value.trim();
        const run = ++searchRun;
        if (!q) {
            results.hidden = true;
            return;
        }
        let data;
        try {
            data = await browseAdminQuizzes({ q });
        } catch {
            return;
        }
        if (run !== searchRun || session.stopped) return;
        found = data.quizzes.slice(0, 8);
        foundFor = q;
        const inList = new Set(selected().items.map(item => item.quizId.toLowerCase()));
        results.hidden = false;
        results.innerHTML = found.length ? found.map((quiz, i) => {
            const added = inList.has(String(quiz.id).toLowerCase());
            return `
                <button type="button" class="sc-result" data-found="${i}" ${added ? "disabled" : ""}>
                    <code class="sc-code">${escapeHtml(quiz.id)}</code>
                    <span class="sc-item-name">${escapeHtml(quiz.title || "—")}</span>
                    <span class="sc-result-by">${added ? escapeHtml(t("showcase.added")) : escapeHtml(quiz.author || "")}</span>
                </button>`;
        }).join("") : `<p class="sc-note">${escapeHtml(t("showcase.noResults"))}</p>`;
    }

    addInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(runSearch, SEARCH_DELAY_MS);
    });
    addInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !results.hidden) {
            e.stopPropagation();
            results.hidden = true;
        } else if (e.key === "Enter") {
            e.preventDefault();
            // Only what was found for the words now in the box, never the search before them
            if (foundFor !== addInput.value.trim()) return;
            const first = results.querySelector(".sc-result:not([disabled])");
            if (first) addQuiz(found[Number(first.dataset.found)]);
        }
    });

    // ── Actions ─────────────────────────────────────────────────────────────

    const itemAt = (el) => {
        const index = Number(el.closest("[data-index]")?.dataset.index);
        return { index, item: selected().items[index] };
    };

    /** Updates one row around the field being edited, which keeps its focus and half-typed date */
    function refreshRow(el) {
        const { item } = itemAt(el);
        const row = el.closest("[data-index]");
        row.querySelector("[data-badge]").innerHTML = itemBadge(item, quizOf(item.quizId));
        drawPreview();
        save();
    }

    function setSchedule(target, hours) {
        const now = new Date();
        target.scheduleStart = hours ? now.toISOString() : "";
        target.scheduleEnd = hours ? new Date(now.getTime() + hours * 3600 * 1000).toISOString() : "";
    }

    panel.addEventListener("click", (e) => {
        const on = (selector) => e.target.closest(selector);
        let el;
        if ((el = on("[data-set]"))) {
            cfg[el.dataset.set] = el.dataset.value;
            el.parentElement.querySelectorAll("button").forEach(btn => btn.setAttribute("aria-pressed", String(btn === el)));
            drawPreview({ order: cfg.order });
            save();
        } else if ((el = on("[data-effect]"))) {
            cfg.animStyle = el.dataset.effect;
            panel.querySelectorAll("[data-effect]").forEach(btn => btn.setAttribute("aria-pressed", String(btn === el)));
            drawPreview({ effect: cfg.animStyle });
            save();
        } else if ((el = on("[data-list]"))) {
            selectedId = el.dataset.list;
            openItem = null;
            drawAll();
            drawPreview();
        } else if (on("[data-add-list]")) {
            const id = `pl_${Date.now().toString(36)}`;
            cfg.playlists.push({ id, name: t("showcase.newListName").replace("{n}", cfg.playlists.length + 1), scheduleStart: "", scheduleEnd: "", items: [] });
            selectedId = id;
            settingsOpen = true;
            openItem = null;
            drawAll();
            drawPreview();
            save();
            $("#sc-list-name")?.select();
        } else if (on("[data-list-settings]")) {
            settingsOpen = !settingsOpen;
            drawLists();
            drawListSettings();
        } else if (on("[data-make-live]")) {
            cfg.activePlaylistId = selected().id;
            drawAll();
            save();
        } else if (on("[data-delete-list]")) {
            const gone = selected().id;
            cfg.playlists = cfg.playlists.filter(list => list.id !== gone);
            if (cfg.activePlaylistId === gone) cfg.activePlaylistId = cfg.playlists[0].id;
            selectedId = cfg.activePlaylistId;
            settingsOpen = false;
            drawAll();
            drawPreview();
            save();
        } else if ((el = on("[data-found]"))) {
            addQuiz(found[Number(el.dataset.found)]);
        } else if ((el = on("[data-item-open]"))) {
            const { index } = itemAt(el);
            openItem = openItem === index ? null : index;
            drawItems();
        } else if ((el = on("[data-item-remove]"))) {
            const { index } = itemAt(el);
            selected().items.splice(index, 1);
            openItem = null;
            itemsChanged();
        } else if ((el = on("[data-item-move]"))) {
            const { index } = itemAt(el);
            const to = index + Number(el.dataset.itemMove);
            if (moveItem(selected().items, index, to)) {
                openItem = to;
                itemsChanged();
            }
        } else if ((el = on("[data-item-for]"))) {
            setSchedule(itemAt(el).item, Number(el.dataset.itemFor));
            itemsChanged();
        } else if (!on(".sc-add")) {
            results.hidden = true;
        }
    });

    panel.addEventListener("change", (e) => {
        const el = e.target;
        if (el.id === "sc-enabled") {
            cfg.enabled = el.checked;
            drawPreview();
            save();
        } else if (el.matches("[data-item-on]")) {
            itemAt(el).item.enabled = el.checked;
            itemsChanged();
        } else if (el.matches("[data-item-time]")) {
            itemAt(el).item[el.dataset.itemTime] = storedValue(el.value);
            refreshRow(el);
        } else if (el.matches("[data-list-time]")) {
            selected()[el.dataset.listTime] = storedValue(el.value);
            drawLists();
            save();
        } else if (el.id === "sc-list-name") {
            selected().name = el.value.trim() || selected().name;
            drawLists();
            save();
        }
    });

    const speed = $("#sc-speed");
    const speedOut = $("#sc-speed-out");
    const showSpeed = () => { speedOut.textContent = t("showcase.seconds").replace("{n}", cfg.intervalSeconds); };
    speed.addEventListener("input", () => {
        cfg.intervalSeconds = Number(speed.value);
        showSpeed();
        drawStatus();
    });
    speed.addEventListener("change", () => {
        drawPreview({ intervalSeconds: cfg.intervalSeconds });
        save();
    });

    // Dragging a row by its handle reorders the list
    const itemsBox = $("#sc-items");
    const clearDropMarks = () => itemsBox.querySelectorAll(".drop-before, .drop-after").forEach(row => row.classList.remove("drop-before", "drop-after"));
    itemsBox.addEventListener("dragstart", (e) => {
        if (!e.target.matches?.("[data-grip]")) return;
        const row = e.target.closest("[data-index]");
        dragFrom = Number(row.dataset.index);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(dragFrom));
        e.dataTransfer.setDragImage(row, 16, 16);
        row.classList.add("is-dragging");
    });
    itemsBox.addEventListener("dragover", (e) => {
        if (dragFrom === null) return;
        const row = e.target.closest("[data-index]");
        if (!row) return;
        e.preventDefault();
        clearDropMarks();
        const box = row.getBoundingClientRect();
        row.classList.add(e.clientY < box.top + box.height / 2 ? "drop-before" : "drop-after");
    });
    itemsBox.addEventListener("drop", (e) => {
        const row = e.target.closest("[data-index]");
        if (dragFrom === null || !row) return;
        e.preventDefault();
        const after = row.classList.contains("drop-after");
        const over = Number(row.dataset.index);
        const to = dragFrom < over ? over - (after ? 0 : 1) : over + (after ? 1 : 0);
        const from = dragFrom;
        dragFrom = null; // redrawing removes the dragged row, and its dragend with it
        openItem = null;
        if (moveItem(selected().items, from, to)) itemsChanged();
        else drawItems();
    });
    itemsBox.addEventListener("dragend", () => {
        dragFrom = null;
        clearDropMarks();
        itemsBox.querySelector(".is-dragging")?.classList.remove("is-dragging");
    });

    // Each effect's little board plays when pointed at
    panel.querySelectorAll("[data-effect]").forEach(btn => {
        const board = createBoard(btn.querySelector("[data-effect-board]"), { effect: btn.dataset.effect, width: 3 });
        board.show(SAMPLE_CODES[0], { animate: false });
        boards.push(board);
        let turn = 0;
        const play = () => board.show(SAMPLE_CODES[++turn % SAMPLE_CODES.length]);
        btn.addEventListener("pointerenter", play);
        btn.addEventListener("focus", play);
    });

    showSpeed();
    drawAll();
    drawPreview();
}
