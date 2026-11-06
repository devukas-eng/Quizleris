// Virtualized task list for the bank panels: fixed-height rows, only the visible ones (and a margin)
// in the DOM, row nodes reused while scrolling, and the next page loaded as the end comes near, so
// tens of thousands of tasks scroll as lightly as ten. Row previews are typeset with KaTeX once
// per task and remembered.
import { escapeHtml } from "./dom.js";

const ROW = 80;          // row height + gap, px (matches .bank-row in style.css)
const OVERSCAN = 6;      // rows kept beyond each edge
const PRELOAD = 15;      // load the next page this many rows before the end
const SKELETONS = 6;
const RETRY_MS = [2000, 5000, 15000]; // after a page failed to load, scrolling tries again after these
const TYPESET_LIMIT = 1500;
const typeset = new Map(); // task id + preview → typeset HTML

const MATH_DELIMITERS = [{ left: "\\(", right: "\\)", display: false }];

// A nickname the user gave the task leads the row; the task's own text follows, smaller
function rowTextHtml(item) {
    if (!item.nickname) return previewHtml(item);
    return `<b class="bank-row-nick">${escapeHtml(item.nickname)}</b><span class="bank-row-sub">${previewHtml(item)}</span>`;
}

/** A task's one-line text with its formulas typeset. */
export function previewHtml(item) {
    const key = `${item.id}:${item.preview}`;
    if (typeset.has(key)) return typeset.get(key);
    const el = document.createElement("span");
    // One line of a list: display formulas are shown inline
    el.textContent = (item.preview || "").replace(/\\\[/g, "\\(").replace(/\\\]/g, "\\)");
    if (!window.renderMathInElement) return el.innerHTML; // KaTeX still loading: plain text for now
    try {
        window.renderMathInElement(el, { delimiters: MATH_DELIMITERS, throwOnError: false });
    } catch {
        // a broken formula stays as text
    }
    if (typeset.size > TYPESET_LIMIT) typeset.delete(typeset.keys().next().value);
    typeset.set(key, el.innerHTML);
    return el.innerHTML;
}

/**
 * options:
 *   metaHtml(item) → HTML of the row's second line
 *   addLabel, starLabel: the "+" and star buttons' labels
 *   renameLabel: with onRename, rows get a pencil that renames them in place
 *   starOf(item) → true / false, or null for no star
 *   onOpen(item, index), onAdd(item, rowEl), onStar(item, rowEl), onPointerDown(event, item, rowEl)
 *   onRename(item, text): a name typed in place ("" clears it); resolves once saved
 *   emptyHtml(): what an empty listing shows
 *   onSelection(ids): selection changed (Ctrl/Cmd/Shift + click; Esc clears)
 * Rows are one Tab stop: arrow keys move, Enter opens, "+" adds, "*" stars.
 */
export function createTaskList(container, options) {
    container.classList.add("bank-list");
    container.setAttribute("role", "list");
    container.tabIndex = -1;
    container.innerHTML = `<div class="bank-list-space"></div><div class="bank-list-empty" hidden></div>`;
    const space = container.querySelector(".bank-list-space");
    const empty = container.querySelector(".bank-list-empty");

    let items = [];
    let nextCursor = null;
    let loader = null;       // (cursor, signal) → Promise<{ ok, data }>
    let loading = false;
    let generation = 0;
    let controller = null;
    let raf = 0;
    let lastAnchor = null;   // for Shift + click ranges
    let active = 0;          // the one row reached with Tab (the others with the arrow keys)
    let failures = 0;
    let retryAt = 0;
    const rows = new Map();  // index → row element
    const spare = [];
    const selected = new Set();
    let editing = null;      // { id, input } while a row is renamed in place

    function rowFor(index) {
        let row = rows.get(index);
        if (row) return row;
        row = spare.pop() || makeRow();
        rows.set(index, row);
        fill(row, index);
        if (!row.isConnected) space.appendChild(row);
        return row;
    }

    function makeRow() {
        const row = document.createElement("div");
        row.className = "bank-row";
        row.setAttribute("role", "listitem");
        row.innerHTML = `
            <div class="bank-row-main">
                <div class="bank-row-text"></div>
                <div class="bank-row-meta"></div>
            </div>
            ${options.onRename ? `<button type="button" class="bank-row-rename" tabindex="-1" aria-label="${escapeHtml(options.renameLabel)}" title="${escapeHtml(options.renameLabel)}">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z"/></svg>
            </button>` : ""}
            <button type="button" class="bank-row-star" tabindex="-1" aria-pressed="false" aria-label="${escapeHtml(options.starLabel)}" title="${escapeHtml(options.starLabel)}">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>
            </button>
            <button type="button" class="bank-row-add" tabindex="-1" aria-label="${escapeHtml(options.addLabel)}" title="${escapeHtml(options.addLabel)}">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            </button>`;
        return row;
    }

    function fill(row, index) {
        const item = items[index];
        row.style.transform = `translateY(${index * ROW}px)`;
        row.dataset.index = index;
        if (!item) {
            row.classList.add("is-skeleton");
            row.removeAttribute("data-id");
            row.querySelector(".bank-row-text").innerHTML = "<span></span><span></span>";
            row.querySelector(".bank-row-meta").innerHTML = "";
            return;
        }
        row.classList.remove("is-skeleton");
        if (row.dataset.id !== String(item.id)) {
            row.dataset.id = item.id;
            const text = row.querySelector(".bank-row-text");
            // The row being renamed keeps its field (and the caret) through a refresh
            if (editing?.id === item.id) {
                if (!text.contains(editing.input)) text.replaceChildren(editing.input);
            } else {
                text.innerHTML = rowTextHtml(item);
            }
            row.classList.toggle("is-renaming", editing?.id === item.id);
            row.querySelector(".bank-row-meta").innerHTML = options.metaHtml(item);
        }
        row.classList.toggle("is-selected", selected.has(item.id));
        // The star: shown for shared tasks only (null hides it)
        const starred = options.starOf?.(item) ?? null;
        row.dataset.star = starred === null ? "" : starred ? "on" : "off";
        row.querySelector(".bank-row-star").setAttribute("aria-pressed", String(!!starred));
    }

    function render() {
        raf = 0;
        const count = items.length + (nextCursor || loading ? (items.length ? 1 : SKELETONS) : 0);
        space.style.height = `${count * ROW}px`;
        const top = container.scrollTop;
        const height = container.clientHeight || 600;
        const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
        const last = Math.min(count - 1, Math.ceil((top + height) / ROW) + OVERSCAN);
        for (const [index, row] of rows) {
            if (index < first || index > last) {
                // Scrolled away while renamed: the name typed so far is kept
                if (editing && items[index]?.id === editing.id) queueMicrotask(() => finishRename(true));
                rows.delete(index);
                spare.push(row);
            }
        }
        for (let i = first; i <= last; i++) rowFor(i);
        for (const row of spare) if (row.isConnected) row.remove();
        // One Tab stop: the active row, or the first one shown while it is scrolled away
        const tabStop = rows.has(active) ? active : first;
        for (const [index, row] of rows) row.tabIndex = index === tabStop ? 0 : -1;
        if (nextCursor && !loading && last >= items.length - PRELOAD && performance.now() >= retryAt) loadMore();
    }

    const schedule = () => {
        if (!raf) raf = requestAnimationFrame(render);
    };

    async function loadPage(cursor) {
        const run = generation;
        loading = true;
        schedule();
        controller = new AbortController();
        const res = await loader(cursor, controller.signal);
        if (run !== generation) return null;
        loading = false;
        if (!res.ok) {
            // The first page failing shows the error; a later one is tried again as scrolling goes on
            if (!cursor) nextCursor = null;
            const delay = RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)];
            retryAt = performance.now() + delay;
            setTimeout(schedule, delay + 50);
            schedule();
            return res;
        }
        failures = 0;
        retryAt = 0;
        items = items.concat(res.data.items || []);
        nextCursor = res.data.nextCursor || null;
        // Rows holding a skeleton get their task now
        for (const [index, row] of rows) if (items[index] && row.classList.contains("is-skeleton")) fill(row, index);
        schedule();
        return res;
    }

    function loadMore() {
        if (nextCursor && !loading) loadPage(nextCursor);
    }

    function showEmpty(res) {
        const none = !items.length && !nextCursor;
        empty.hidden = !none;
        if (none) empty.innerHTML = options.emptyHtml(res);
    }

    container.addEventListener("scroll", schedule, { passive: true });
    new ResizeObserver(schedule).observe(container);

    const itemOf = row => (row?.dataset.id ? items[Number(row.dataset.index)] : null);

    container.addEventListener("click", e => {
        const row = e.target.closest(".bank-row");
        const item = itemOf(row);
        if (!item || e.target.closest(".bank-row-input")) return;
        if (e.target.closest(".bank-row-add")) {
            options.onAdd(item, row);
            return;
        }
        if (e.target.closest(".bank-row-rename")) {
            startRename(item, row);
            return;
        }
        if (e.target.closest(".bank-row-star")) {
            options.onStar?.(item, row);
            return;
        }
        const index = Number(row.dataset.index);
        if (e.shiftKey && lastAnchor != null) {
            const [a, b] = lastAnchor < index ? [lastAnchor, index] : [index, lastAnchor];
            for (let i = a; i <= b; i++) if (items[i]) selected.add(items[i].id);
            changed();
        } else if (e.ctrlKey || e.metaKey) {
            if (selected.has(item.id)) selected.delete(item.id);
            else selected.add(item.id);
            lastAnchor = index;
            changed();
        } else {
            lastAnchor = index;
            options.onOpen(item, index);
        }
    });

    container.addEventListener("keydown", e => {
        const row = e.target.closest?.(".bank-row");
        const item = itemOf(row);
        if (!item || e.target !== row) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            options.onOpen(item, Number(row.dataset.index));
        } else if (e.key === "+" || e.key === "Insert") {
            e.preventDefault();
            options.onAdd(item, row);
        } else if (e.key === "*" && row.dataset.star) {
            e.preventDefault();
            options.onStar?.(item, row);
        } else if (e.key === "F2" && options.onRename) {
            e.preventDefault();
            startRename(item, row);
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
            e.preventDefault(); // every task listed so far
            items.forEach(listed => selected.add(listed.id));
            changed();
        } else if (e.key === "Escape" && selected.size) {
            e.preventDefault();
            e.stopPropagation();
            selected.clear();
            changed();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            focusIndex(Number(row.dataset.index) + (e.key === "ArrowDown" ? 1 : -1));
        }
    });

    container.addEventListener("pointerdown", e => {
        const row = e.target.closest(".bank-row");
        const item = itemOf(row);
        if (!item || e.target.closest(".bank-row-add, .bank-row-star, .bank-row-rename, .bank-row-input")) return;
        options.onPointerDown(e, item, row);
    });

    // Renaming in place: Enter or leaving the field saves, Esc keeps the old name
    function startRename(item, row) {
        if (!options.onRename) return;
        if (editing) {
            editing.input.focus();
            return;
        }
        const input = document.createElement("input");
        input.className = "bank-row-input";
        input.maxLength = 120;
        input.value = item.nickname || "";
        input.placeholder = options.renamePlaceholder || "";
        input.setAttribute("aria-label", options.renameLabel);
        editing = { id: item.id, input, row };
        row.querySelector(".bank-row-text").replaceChildren(input);
        row.classList.add("is-renaming");
        input.addEventListener("keydown", e => {
            e.stopPropagation(); // not the list's keys, nor the editor's shortcuts
            if (e.key === "Enter") {
                e.preventDefault();
                finishRename(true);
            } else if (e.key === "Escape") {
                e.preventDefault();
                finishRename(false);
            }
        });
        input.addEventListener("blur", () => finishRename(true));
        input.focus();
        input.select();
    }

    async function finishRename(save) {
        if (!editing) return;
        const { id, input, row } = editing;
        editing = null;
        const item = items.find(listed => listed.id === id);
        const text = input.value.trim();
        const refill = () => {
            for (const [index, shown] of rows) {
                if (items[index]?.id !== id) continue;
                shown.removeAttribute("data-id");
                fill(shown, index);
            }
        };
        input.remove();
        row.classList.remove("is-renaming");
        refill();
        if (save && item && text !== (item.nickname || "")) {
            const before = item.nickname;
            item.nickname = text || null; // shown at once; put back if the server refuses
            refill();
            if (!(await options.onRename(item, text))) {
                item.nickname = before;
                refill();
            }
        }
        if (row.dataset.id === String(id)) row.focus({ preventScroll: true });
    }

    container.addEventListener("focusin", e => {
        const row = e.target.closest?.(".bank-row");
        if (row?.dataset.id) active = Number(row.dataset.index);
    });

    function changed() {
        for (const [index, row] of rows) if (items[index]) row.classList.toggle("is-selected", selected.has(items[index].id));
        options.onSelection?.([...selected]);
    }

    function focusIndex(index) {
        if (index < 0 || index >= items.length) return;
        active = index;
        const top = index * ROW;
        if (top < container.scrollTop) container.scrollTop = top;
        else if (top + ROW > container.scrollTop + container.clientHeight) container.scrollTop = top + ROW - container.clientHeight;
        render();
        rows.get(index)?.focus({ preventScroll: true });
    }

    return {
        /** Lists from the start with a new loader; resolves to the first page's response. */
        async reset(newLoader, { keepScroll = false } = {}) {
            if (editing) finishRename(true); // saved before the rows go
            generation++;
            controller?.abort();
            loader = newLoader;
            items = [];
            nextCursor = null;
            selected.clear();
            lastAnchor = null;
            active = 0;
            failures = 0;
            retryAt = 0;
            for (const row of rows.values()) {
                row.removeAttribute("data-id");
                spare.push(row);
            }
            rows.clear();
            if (!keepScroll) container.scrollTop = 0;
            empty.hidden = true;
            const res = await loadPage(null);
            if (res) {
                showEmpty(res);
                options.onSelection?.([]);
            }
            return res;
        },
        get items() {
            return items;
        },
        get selected() {
            return [...selected];
        },
        clearSelection() {
            selected.clear();
            changed();
        },
        rowOf(id) {
            for (const [index, row] of rows) if (items[index]?.id === id) return row;
            return null;
        },
        /** After a language switch: new texts on the rows already made. */
        relabel(addLabel, starLabel, renameLabel = options.renameLabel, renamePlaceholder = options.renamePlaceholder) {
            Object.assign(options, { addLabel, starLabel, renameLabel, renamePlaceholder });
            for (const row of [...rows.values(), ...spare]) {
                for (const [selector, label] of [[".bank-row-add", addLabel], [".bank-row-star", starLabel], [".bank-row-rename", renameLabel]]) {
                    const button = row.querySelector(selector);
                    if (!button) continue;
                    button.title = label;
                    button.setAttribute("aria-label", label);
                }
                row.removeAttribute("data-id"); // the second line is written again
            }
            for (const [index, row] of rows) fill(row, index);
        },
        /** Rows written again (their second line depends on what is in the quiz). */
        refresh() {
            for (const row of rows.values()) row.removeAttribute("data-id");
            for (const [index, row] of rows) fill(row, index);
        },
        /** Changes a listed task's fields (a nickname, tags) and writes its row again. */
        patch(id, fields) {
            const item = items.find(listed => listed.id === id);
            if (!item) return;
            Object.assign(item, fields);
            for (const [index, row] of rows) {
                if (items[index] !== item) continue;
                row.removeAttribute("data-id");
                fill(row, index);
            }
        },
        focusIndex
    };
}
