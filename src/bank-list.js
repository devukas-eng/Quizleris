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

function previewHtml(item) {
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
 *   addLabel: the "+" button's label
 *   onOpen(item, index), onAdd(item, rowEl), onPointerDown(event, item, rowEl)
 *   emptyHtml(): what an empty listing shows
 *   onSelection(ids): selection changed (Ctrl/Cmd/Shift + click)
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
            <button type="button" class="bank-row-add" aria-label="${escapeHtml(options.addLabel)}" title="${escapeHtml(options.addLabel)}">
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
            row.querySelector(".bank-row-text").innerHTML = previewHtml(item);
            row.querySelector(".bank-row-meta").innerHTML = options.metaHtml(item);
        }
        row.classList.toggle("is-selected", selected.has(item.id));
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
        if (!item) return;
        if (e.target.closest(".bank-row-add")) {
            options.onAdd(item, row);
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
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            focusIndex(Number(row.dataset.index) + (e.key === "ArrowDown" ? 1 : -1));
        }
    });

    container.addEventListener("pointerdown", e => {
        const row = e.target.closest(".bank-row");
        const item = itemOf(row);
        if (!item || e.target.closest(".bank-row-add")) return;
        options.onPointerDown(e, item, row);
    });

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
        relabel(addLabel) {
            options.addLabel = addLabel;
            for (const row of [...rows.values(), ...spare]) {
                const button = row.querySelector(".bank-row-add");
                button.title = addLabel;
                button.setAttribute("aria-label", addLabel);
                row.removeAttribute("data-id"); // the second line is written again
            }
            for (const [index, row] of rows) fill(row, index);
        },
        /** Rows written again (their second line depends on what is in the quiz). */
        refresh() {
            for (const row of rows.values()) row.removeAttribute("data-id");
            for (const [index, row] of rows) fill(row, index);
        },
        focusIndex
    };
}
