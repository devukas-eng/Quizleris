import { t } from "./lang.js";
import { escapeHtml } from "./dom.js";
import { isTypedSlot } from "./state.js";
import {
    resolvePrintLayout, withItemSetting, fitImage, naturalSize, normalizeImageSrc,
    IMAGE_SIZES, IMAGE_SIZE_KEYS, CHOICE_IMAGE, CONTENT_WIDTH, CONTENT_HEIGHT
} from "./print-layout.js";

// Print preview: A4 pages laid out like the Word export. Questions can be reordered by dragging
// (or with ↑ ↓), and each question has its own image size, page break and option columns.
// Changes are reported through onLayoutChange and only affect the printout.

const KATEX_DELIMITERS = [
    { left: "\\(", right: "\\)", display: false },
    { left: "\\[", right: "\\]", display: true }
];

let overlay = null;

/**
 * @param {object} quiz
 * @param {{ onLayoutChange: (layout: object) => void, onExport: (quiz: object) => Promise<void> }} handlers
 */
export function openPrintPreview(quiz, { onLayoutChange, onExport }) {
    closePrintPreview();
    let layout = JSON.parse(JSON.stringify(quiz.printLayout || {}));
    const returnFocus = document.activeElement;

    overlay = document.createElement("div");
    overlay.className = "pp-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", t("pp.title"));
    overlay.innerHTML = `
        <div class="pp-toolbar">
            <div class="pp-heading">
                <strong>${t("pp.title")}</strong>
                <span class="pp-pagecount"></span>
            </div>
            <label class="pp-check"><input type="checkbox" data-opt="header"> ${t("pp.header")}</label>
            <label class="pp-check"><input type="checkbox" data-opt="answerKey"> ${t("pp.answerKey")}</label>
            <div class="pp-actions">
                <button type="button" class="btn btn-secondary btn-compact pp-reset">${t("pp.reset")}</button>
                <button type="button" class="btn btn-primary btn-compact pp-download">⬇ ${t("pp.download")}</button>
                <button type="button" class="btn btn-secondary btn-icon pp-close" aria-label="${t("pp.close")}">×</button>
            </div>
        </div>
        <div class="pp-hint">${t("pp.hint")}</div>
        <div class="pp-scroll"><div class="pp-pages"></div></div>
        <div class="pp-selbar" hidden></div>
        <div class="pp-measure" aria-hidden="true"></div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add("pp-open");

    const pagesEl = overlay.querySelector(".pp-pages");
    const scrollEl = overlay.querySelector(".pp-scroll");
    const measureEl = overlay.querySelector(".pp-measure");
    const currentQuiz = () => ({ ...quiz, printLayout: layout });
    let selectedId = null; // kept across re-renders so a tapped question keeps its tools open

    const commit = (next) => {
        layout = next;
        onLayoutChange(JSON.parse(JSON.stringify(layout)));
        render();
    };
    const setOrder = (order) => commit({ ...layout, order });

    // --- toolbar ---
    const headerBox = overlay.querySelector('[data-opt="header"]');
    const keyBox = overlay.querySelector('[data-opt="answerKey"]');
    headerBox.addEventListener("change", () => commit({ ...layout, header: headerBox.checked }));
    keyBox.addEventListener("change", () => commit({ ...layout, answerKey: keyBox.checked }));
    overlay.querySelector(".pp-reset").addEventListener("click", () => commit({}));
    overlay.querySelector(".pp-close").addEventListener("click", () => closePrintPreview(returnFocus));
    const downloadBtn = overlay.querySelector(".pp-download");
    downloadBtn.addEventListener("click", async () => {
        downloadBtn.disabled = true;
        try {
            await onExport(currentQuiz());
        } finally {
            downloadBtn.disabled = false;
        }
    });
    overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !document.querySelector(".app-dialog-overlay.open")) {
            e.preventDefault();
            closePrintPreview(returnFocus);
        }
    });

    // --- per-question tools (event delegation: hover toolbar on the sheet, or the bottom bar) ---
    const selbar = overlay.querySelector(".pp-selbar");
    const updateSelbar = () => {
        const item = selectedId && resolvePrintLayout(currentQuiz()).items.find(it => it.id === selectedId);
        selbar.hidden = !item;
        if (!item) return;
        selbar.dataset.id = item.id;
        selbar.innerHTML = `<span class="pp-selbar-label">${item.number}.</span>${toolsHtml(item, resolvePrintLayout(currentQuiz()).items.length)}`;
    };
    overlay.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn && e.target.closest(".pp-pages")) {
            // Tapping a question selects it (its tools then show in the bottom bar on touch screens)
            const block = e.target.closest(".pp-q");
            pagesEl.querySelectorAll(".pp-q.selected").forEach(b => { if (b !== block) b.classList.remove("selected"); });
            if (block) block.classList.toggle("selected");
            selectedId = block?.classList.contains("selected") ? block.dataset.id : null;
            updateSelbar();
            return;
        }
        if (!btn) return;
        const id = btn.closest("[data-id]")?.dataset.id;
        const resolved = resolvePrintLayout(currentQuiz());
        const order = resolved.items.map(item => item.id);
        const item = resolved.items.find(it => it.id === id);
        if (!item) return;
        const idx = order.indexOf(id);
        switch (btn.dataset.act) {
            case "up":
                if (idx > 0) { [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]]; setOrder(order); focusTool(id, "up"); }
                break;
            case "down":
                if (idx < order.length - 1) { [order[idx + 1], order[idx]] = [order[idx], order[idx + 1]]; setOrder(order); focusTool(id, "down"); }
                break;
            case "break":
                commit(withItemSetting(layout, id, "pageBreak", !item.pageBreak));
                break;
            case "cols":
                commit(withItemSetting(layout, id, "columns", item.columns === 2 ? 1 : 2));
                break;
            case "img":
                commit(withItemSetting(layout, id, "image", btn.dataset.size));
                break;
        }
    });
    const focusTool = (id, act) => requestAnimationFrame(() =>
        pagesEl.querySelector(`.pp-q[data-id="${window.CSS.escape(id)}"] [data-act="${act}"]`)?.focus());

    // --- drag and drop (started from the ⋮⋮ handle) ---
    let dragId = null;
    pagesEl.addEventListener("pointerdown", (e) => {
        const handle = e.target.closest(".pp-handle");
        if (handle) handle.closest(".pp-q").draggable = true;
    });
    pagesEl.addEventListener("dragstart", (e) => {
        const block = e.target.closest(".pp-q");
        if (!block) return;
        dragId = block.dataset.id;
        block.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragId);
    });
    const clearDropMarks = () => pagesEl.querySelectorAll(".drop-before, .drop-after").forEach(el => el.classList.remove("drop-before", "drop-after"));
    pagesEl.addEventListener("dragover", (e) => {
        const block = e.target.closest(".pp-q");
        if (!dragId || !block || block.dataset.id === dragId) return;
        e.preventDefault();
        const rect = block.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        clearDropMarks();
        block.classList.add(after ? "drop-after" : "drop-before");
    });
    pagesEl.addEventListener("drop", (e) => {
        const block = e.target.closest(".pp-q");
        if (!dragId || !block || block.dataset.id === dragId) return;
        e.preventDefault();
        const after = block.classList.contains("drop-after");
        const order = resolvePrintLayout(currentQuiz()).items.map(item => item.id).filter(id => id !== dragId);
        order.splice(order.indexOf(block.dataset.id) + (after ? 1 : 0), 0, dragId);
        setOrder(order);
    });
    pagesEl.addEventListener("dragend", () => {
        pagesEl.querySelectorAll(".pp-q").forEach(el => { el.draggable = false; el.classList.remove("dragging"); });
        clearDropMarks();
        dragId = null;
    });

    // --- rendering ---
    const fitZoom = () => {
        const zoom = Math.min(1, (scrollEl.clientWidth - 32) / 794);
        pagesEl.style.zoom = String(Math.max(0.35, zoom));
    };
    window.addEventListener("resize", fitZoom);
    overlay._cleanup = () => window.removeEventListener("resize", fitZoom);

    let renderToken = 0;
    async function render() {
        const token = ++renderToken;
        const resolved = resolvePrintLayout(currentQuiz());
        headerBox.checked = resolved.header;
        keyBox.checked = resolved.answerKey;

        // Image sizes are needed before measuring, so the page breaks land where Word puts them
        const sources = [];
        resolved.items.forEach(({ q }) => {
            sources.push(q.image);
            (q.choices || []).forEach(c => sources.push(c.image));
        });
        const sizes = new Map();
        await Promise.all(sources.filter(Boolean).map(async src => sizes.set(src, await naturalSize(src))));
        if (token !== renderToken || !overlay) return;

        const studentBlocks = [titleBlock(quiz.title, resolved.header)];
        resolved.items.forEach(item => studentBlocks.push(questionBlock(item, sizes, resolved.items.length)));
        const pages = paginate(studentBlocks, measureEl);
        if (resolved.answerKey) pages.push(...paginate(answerKeyBlocks(quiz.title, resolved.items), measureEl));

        const scrollTop = scrollEl.scrollTop;
        pagesEl.innerHTML = "";
        if (!resolved.items.length) {
            pagesEl.innerHTML = `<div class="pp-empty">${t("pp.empty")}</div>`;
        }
        pages.forEach((blocks, i) => {
            const page = document.createElement("div");
            page.className = "pp-page";
            const content = document.createElement("div");
            content.className = "pp-page-content";
            blocks.forEach(b => content.appendChild(b));
            page.appendChild(content);
            const num = document.createElement("div");
            num.className = "pp-page-number";
            num.textContent = `${i + 1} / ${pages.length}`;
            page.appendChild(num);
            pagesEl.appendChild(page);
        });
        if (selectedId) pagesEl.querySelector(`.pp-q[data-id="${window.CSS.escape(selectedId)}"]`)?.classList.add("selected");
        updateSelbar();
        overlay.querySelector(".pp-pagecount").textContent = t("pp.pages").replace("{n}", pages.length);
        fitZoom();
        scrollEl.scrollTop = scrollTop;
    }

    render().then(() => overlay?.querySelector(".pp-download")?.focus());
}

export function closePrintPreview(returnFocus) {
    if (!overlay) return;
    overlay._cleanup?.();
    overlay.remove();
    overlay = null;
    document.body.classList.remove("pp-open");
    if (returnFocus?.isConnected) returnFocus.focus();
}

// Flows blocks onto pages without splitting one (Word keeps each question together too)
function paginate(blocks, measureEl) {
    measureEl.innerHTML = "";
    measureEl.style.width = `${CONTENT_WIDTH}px`;
    blocks.forEach(b => measureEl.appendChild(b));
    if (window.renderMathInElement) window.renderMathInElement(measureEl, { delimiters: KATEX_DELIMITERS, throwOnError: false });
    const heights = blocks.map(b => b.getBoundingClientRect().height);
    const pages = [[]];
    let used = 0;
    blocks.forEach((block, i) => {
        const h = heights[i];
        const forceBreak = block.dataset.pageBreak === "true";
        if (pages[pages.length - 1].length && (forceBreak || used + h > CONTENT_HEIGHT)) {
            pages.push([]);
            used = 0;
        }
        if (block.classList.contains("overflow") || h > CONTENT_HEIGHT) block.classList.add("overflow");
        pages[pages.length - 1].push(block);
        used += h;
    });
    measureEl.innerHTML = "";
    return pages;
}

// --- blocks ---

function el(html) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
}

// Text with \( \) formulas (rendered by KaTeX afterwards); "___" become writing lines
function richHtml(value, { blanks = false } = {}) {
    let html = escapeHtml(String(value || "")).replace(/\n/g, "<br>");
    if (blanks) html = html.replace(/_{3,}/g, '<span class="pp-blank"></span>');
    return html;
}

function imgHtml(src, sizes, box, cls) {
    const url = normalizeImageSrc(src);
    const size = url && fitImage(sizes.get(src), box);
    if (!size) return "";
    return `<img class="${cls}" src="${url}" width="${size.width}" height="${size.height}" alt="">`;
}

function titleBlock(title, header) {
    return el(`
        <div class="pp-block pp-title-block">
            <div class="pp-doc-title">${escapeHtml(title || "")}</div>
            ${header ? `<div class="pp-doc-header">${t("docx.name")}: __________________________ &nbsp; ${t("docx.class")}: ______ &nbsp; ${t("docx.date")}: ____________</div>` : ""}
        </div>
    `);
}

// Buttons for one question: move, page break, columns, image size
function toolsHtml(item, total) {
    const { q, number, image, pageBreak, columns } = item;
    const isChoice = (q.type || "multiple-choice") === "multiple-choice";
    const sizeButtons = q.image ? `
        <span class="pp-seg" role="group" aria-label="${t("pp.imageSize")}">
            ${IMAGE_SIZE_KEYS.map(k => `<button type="button" data-act="img" data-size="${k}" aria-pressed="${k === image}" title="${t("pp.imageSize")}: ${t(`pp.size.${k}`)}">${t(`pp.size.${k}`)}</button>`).join("")}
        </span>` : "";
    return `
        <button type="button" data-act="up" title="${t("pp.moveUp")}" aria-label="${t("pp.moveUp")}" ${number === 1 ? "disabled" : ""}>↑</button>
        <button type="button" data-act="down" title="${t("pp.moveDown")}" aria-label="${t("pp.moveDown")}" ${number === total ? "disabled" : ""}>↓</button>
        <button type="button" data-act="break" aria-pressed="${pageBreak}" ${number === 1 ? "disabled" : ""}>⤓ ${t("pp.pageBreak")}</button>
        ${isChoice ? `<button type="button" data-act="cols" aria-pressed="${columns === 2}">▥ ${t("pp.columns")}</button>` : ""}
        ${sizeButtons}
    `;
}

function questionBlock(item, sizes, total) {
    const { q, id, number, image, pageBreak, columns } = item;
    const type = q.type || "multiple-choice";
    const isChoice = type === "multiple-choice";
    const choices = q.choices || [];
    const hasTyped = choices.some(isTypedSlot);
    const marker = q.allowMultipleAnswers ? "☐" : "○";

    let hint = "";
    if (isChoice && q.allowMultipleAnswers) hint = t("docx.selectAll");
    else if (isChoice && hasTyped) hint = t("docx.chooseOrWrite");

    let answers = "";
    if (isChoice) {
        answers = `<div class="pp-choices cols-${columns}">${choices.map((c, i) => `
            <div class="pp-choice">
                <span class="pp-marker">${marker}&nbsp; ${String.fromCharCode(65 + i)})&nbsp;</span>
                ${isTypedSlot(c) ? '<span class="pp-line-inline"></span>' : `<span>${richHtml(c.text)}</span>`}
                ${!isTypedSlot(c) && c.image ? `<div>${imgHtml(c.image, sizes, CHOICE_IMAGE[columns] || CHOICE_IMAGE[1], "pp-choice-img")}</div>` : ""}
            </div>`).join("")}</div>`;
    } else if (type === "true-false") {
        answers = `<div class="pp-indent">☐&nbsp; ${t("docx.true")} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ☐&nbsp; ${t("docx.false")}</div>`;
    } else if (type === "numeric") {
        answers = `<div class="pp-indent pp-gap">${t("docx.answer")}: ______________________</div>`;
    } else if (type === "text") {
        answers = '<div class="pp-writing-line"></div>'.repeat(q.isLongAnswer ? 6 : 2);
    } else if (type === "image-upload") {
        answers = `<div class="pp-indent pp-solution">${t("docx.solution")}:</div>` + '<div class="pp-writing-line"></div>'.repeat(6);
    }

    const block = el(`
        <div class="pp-block pp-q${pageBreak ? " has-break" : ""}" data-id="${escapeHtml(id)}">
            <span class="pp-handle" title="${t("pp.drag")}" aria-hidden="true">⋮⋮</span>
            <div class="pp-tools">${toolsHtml(item, total)}</div>
            ${pageBreak ? `<div class="pp-break-label">⤓ ${t("pp.pageBreak")}</div>` : ""}
            <div class="pp-prompt"><b>${number}.</b> <b>${richHtml(q.prompt, { blanks: type === "fill-blank" })}</b>${hint ? ` <span class="pp-hint-text">${hint}</span>` : ""}</div>
            ${q.image ? `<div class="pp-indent pp-qimg">${imgHtml(q.image, sizes, IMAGE_SIZES[image], "pp-q-img")}</div>` : ""}
            ${answers}
        </div>
    `);
    block.dataset.pageBreak = String(pageBreak);
    return block;
}

function answerKeyBlocks(title, items) {
    const blocks = [el(`<div class="pp-block"><div class="pp-key-title">${t("docx.answers")}: ${escapeHtml(title || "")}</div></div>`)];
    blocks[0].dataset.pageBreak = "true";
    items.forEach(({ q, number }) => {
        const type = q.type || "multiple-choice";
        let text;
        if (type === "multiple-choice") {
            text = (q.choices || []).map((c, i) => ({ c, i })).filter(({ c }) => c.isCorrect).map(({ c, i }) => {
                const letter = `${String.fromCharCode(65 + i)}) `;
                if (c.kind === "write") return letter + escapeHtml((c.accepted || []).join(" / "));
                if (c.kind === "number") return letter + escapeHtml(`${c.number}${c.tolerance ? ` ± ${c.tolerance}` : ""}`);
                return letter + richHtml(c.text);
            }).join(";&nbsp; ");
        } else if (type === "true-false") text = q.isTrue ? t("docx.true") : t("docx.false");
        else if (type === "numeric") text = escapeHtml(`${q.correctAnswerNumber ?? "—"}${q.toleranceValue ? ` ± ${q.toleranceValue}${q.toleranceType === "percentage" ? " %" : ""}` : ""}`);
        else if (type === "fill-blank") text = escapeHtml((q.blankAnswers || []).join(";  ") || "—");
        else text = `<i>${t("docx.teacherReview")}</i>`;
        blocks.push(el(`<div class="pp-block pp-key-row"><b>${number}.</b> ${text}</div>`));
    });
    return blocks;
}
