import { t } from "./lang.js";
import { escapeHtml } from "./dom.js";
import { isTypedSlot } from "./state.js";
import {
    resolvePrintLayout, withItemSetting, withImageWidth, imageSizeFor, maxImageWidth, naturalSize,
    normalizeImageSrc, IMAGE_SIZE_KEYS, SPACE_STEPS, SPACE_HEIGHTS, MIN_IMAGE_WIDTH, PAGE
} from "./print-layout.js";

// Print preview: A4 pages laid out like the Word export.
// - Questions are reordered by dragging (onto another question or onto any page) or with ↑ ↓.
// - Images are resized by dragging a corner (aspect ratio kept); double-click resets.
// - "Save paper" shrinks a question's image a little when that keeps it on the current page.
// Changes go through onLayoutChange and only affect the printout. The export receives the exact
// image sizes shown here, so the Word file matches the preview.

const KATEX_DELIMITERS = [
    { left: "\\(", right: "\\)", display: false },
    { left: "\\[", right: "\\]", display: true }
];
const PX_PER_CM = 96 / 2.54;
const FIT_MIN_RATIO = 0.6; // "save paper" never shrinks an image below 60 % of its size

let overlay = null;

/**
 * @param {object} quiz
 * @param {{ onLayoutChange: (layout: object) => void,
 *           onExport: (quiz: object, options: { imageSizes: Map<string, {width:number,height:number}> }) => Promise<void> }} handlers
 */
export function openPrintPreview(quiz, { onLayoutChange, onExport }) {
    closePrintPreview();
    let layout = JSON.parse(JSON.stringify(quiz.printLayout || {}));
    const returnFocus = document.activeElement;
    let renderedSizes = new Map(); // "questionId|imageKey" -> size actually shown
    let selectedId = null;         // tapped question (keeps its tools open across re-renders)
    let selectedImage = null;      // "questionId|imageKey" of the image showing its corners

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
            <label class="pp-check"><input type="checkbox" data-opt="autoFit"> ${t("pp.autoFit")}</label>
            <label class="pp-check"><input type="checkbox" data-opt="narrow"> ${t("pp.narrow")}</label>
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
    const selbar = overlay.querySelector(".pp-selbar");
    const currentQuiz = () => ({ ...quiz, printLayout: layout });
    const zoom = () => parseFloat(pagesEl.style.zoom) || 1;

    const commit = (next) => {
        layout = next;
        onLayoutChange(JSON.parse(JSON.stringify(layout)));
        render();
    };
    const setOrder = (order) => commit({ ...layout, order });

    // --- toolbar ---
    const boxes = Object.fromEntries([...overlay.querySelectorAll("[data-opt]")].map(b => [b.dataset.opt, b]));
    boxes.autoFit.addEventListener("change", () => commit({ ...layout, autoFit: boxes.autoFit.checked }));
    boxes.narrow.addEventListener("change", () => commit({ ...layout, margins: boxes.narrow.checked ? "narrow" : "normal" }));
    boxes.header.addEventListener("change", () => commit({ ...layout, header: boxes.header.checked }));
    boxes.answerKey.addEventListener("change", () => commit({ ...layout, answerKey: boxes.answerKey.checked }));
    overlay.querySelector(".pp-reset").addEventListener("click", () => commit({}));
    overlay.querySelector(".pp-close").addEventListener("click", () => closePrintPreview(returnFocus));
    const downloadBtn = overlay.querySelector(".pp-download");
    downloadBtn.addEventListener("click", async () => {
        downloadBtn.disabled = true;
        try {
            await onExport(currentQuiz(), { imageSizes: new Map(renderedSizes) });
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

    // --- per-question tools (hover toolbar on the sheet, or the bottom bar) ---
    const updateSelbar = () => {
        const resolved = resolvePrintLayout(currentQuiz());
        const item = selectedId && resolved.items.find(it => it.id === selectedId);
        selbar.hidden = !item;
        if (!item) return;
        selbar.dataset.id = item.id;
        selbar.innerHTML = `<span class="pp-selbar-label">${item.number}.</span>${toolsHtml(item, resolved.items.length)}`;
    };
    const selectImage = (wrap) => {
        pagesEl.querySelectorAll(".pp-img.selected").forEach(w => { if (w !== wrap) w.classList.remove("selected"); });
        wrap?.classList.add("selected");
        selectedImage = wrap ? `${wrap.dataset.id}|${wrap.dataset.key}` : null;
    };
    let justResized = false; // the click that ends a corner drag must not change the selection
    overlay.addEventListener("click", (e) => {
        if (justResized) { justResized = false; return; }
        const btn = e.target.closest("[data-act]");
        if (!btn && e.target.closest(".pp-pages")) {
            selectImage(e.target.closest(".pp-img"));
            // Tapping a question selects it (its tools then show in the bottom bar on touch screens)
            const block = e.target.closest(".pp-q");
            pagesEl.querySelectorAll(".pp-q.selected").forEach(b => { if (b !== block) b.classList.remove("selected"); });
            if (block && !e.target.closest(".pp-img")) block.classList.toggle("selected");
            else if (block) block.classList.add("selected");
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
            case "space": {
                const next = SPACE_STEPS[(SPACE_STEPS.indexOf(item.space) + 1) % SPACE_STEPS.length];
                commit(withItemSetting(layout, id, "space", next));
                break;
            }
            case "img":
                // A preset replaces any dragged size
                commit(withImageWidth(withItemSetting(layout, id, "image", btn.dataset.size), id, "q", null));
                break;
        }
    });
    const focusTool = (id, act) => requestAnimationFrame(() =>
        pagesEl.querySelector(`.pp-q[data-id="${window.CSS.escape(id)}"] [data-act="${act}"]`)?.focus());

    // Double-click an image: back to its automatic size
    pagesEl.addEventListener("dblclick", (e) => {
        const wrap = e.target.closest(".pp-img");
        if (wrap && wrap.dataset.custom === "true") commit(withImageWidth(layout, wrap.dataset.id, wrap.dataset.key, null));
    });

    // --- resize images by dragging a corner (aspect ratio kept) ---
    pagesEl.addEventListener("pointerdown", (e) => {
        const corner = e.target.closest(".pp-corner");
        if (!corner) return;
        e.preventDefault();
        e.stopPropagation();
        const wrap = corner.closest(".pp-img");
        const img = wrap.querySelector("img");
        const badge = wrap.querySelector(".pp-size-badge");
        const resolved = resolvePrintLayout(currentQuiz());
        const item = resolved.items.find(it => it.id === wrap.dataset.id);
        const key = wrap.dataset.key;
        const ratio = img.naturalHeight && img.naturalWidth ? img.naturalHeight / img.naturalWidth : img.height / img.width;
        const maxW = maxImageWidth(resolved.geometry, key, item?.columns);
        const maxH = resolved.geometry.contentHeight - 120;
        const start = { x: e.clientX, y: e.clientY, w: img.width };
        const sx = corner.dataset.corner.includes("e") ? 1 : -1;
        const sy = corner.dataset.corner.includes("s") ? 1 : -1;
        let width = img.width;
        selectImage(wrap);
        wrap.classList.add("resizing");
        corner.setPointerCapture(e.pointerId);
        const onMove = (ev) => {
            const z = zoom();
            // Average the horizontal and vertical pull so diagonal drags feel natural
            const byX = start.w + sx * (ev.clientX - start.x) / z;
            const byY = start.w + sy * (ev.clientY - start.y) / z / ratio;
            width = Math.min(Math.max((byX + byY) / 2, MIN_IMAGE_WIDTH), maxW, maxH / ratio);
            img.width = Math.round(width);
            img.height = Math.round(width * ratio);
            badge.textContent = `${img.width} × ${img.height} px · ${(img.width / PX_PER_CM).toFixed(1).replace(".", ",")} cm`;
        };
        const onUp = () => {
            corner.removeEventListener("pointermove", onMove);
            corner.removeEventListener("pointerup", onUp);
            corner.removeEventListener("pointercancel", onUp);
            wrap.classList.remove("resizing");
            justResized = true;
            setTimeout(() => { justResized = false; }, 0);
            if (Math.abs(width - start.w) >= 2) commit(withImageWidth(layout, wrap.dataset.id, key, width));
        };
        corner.addEventListener("pointermove", onMove);
        corner.addEventListener("pointerup", onUp);
        corner.addEventListener("pointercancel", onUp);
    });

    // --- drag and drop: onto a question (before/after it) or onto a page (to its end) ---
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
    const clearDropMarks = () => pagesEl.querySelectorAll(".drop-before, .drop-after, .drop-end")
        .forEach(el => el.classList.remove("drop-before", "drop-after", "drop-end"));
    const dropTarget = (e) => {
        const block = e.target.closest(".pp-q");
        if (block && block.dataset.id !== dragId) {
            const rect = block.getBoundingClientRect();
            return { block, after: e.clientY > rect.top + rect.height / 2 };
        }
        const page = !block && e.target.closest(".pp-page");
        return page ? { page } : null;
    };
    pagesEl.addEventListener("dragover", (e) => {
        if (!dragId) return;
        const target = dropTarget(e);
        if (!target) return;
        e.preventDefault();
        clearDropMarks();
        if (target.block) target.block.classList.add(target.after ? "drop-after" : "drop-before");
        else target.page.classList.add("drop-end");
    });
    pagesEl.addEventListener("drop", (e) => {
        if (!dragId) return;
        const target = dropTarget(e);
        if (!target) return;
        e.preventDefault();
        const order = resolvePrintLayout(currentQuiz()).items.map(item => item.id).filter(id => id !== dragId);
        let index = order.length;
        if (target.block) {
            index = order.indexOf(target.block.dataset.id) + (target.after ? 1 : 0);
        } else {
            // Dropped on a page: after that page's last question (or before the next page's first)
            const pages = [...pagesEl.querySelectorAll(".pp-page")];
            const onPage = [...target.page.querySelectorAll(".pp-q")].map(b => b.dataset.id).filter(id => id !== dragId);
            if (onPage.length) {
                index = order.indexOf(onPage[onPage.length - 1]) + 1;
            } else {
                const later = pages.slice(pages.indexOf(target.page) + 1).flatMap(p => [...p.querySelectorAll(".pp-q")]).find(b => b.dataset.id !== dragId);
                if (later) index = order.indexOf(later.dataset.id);
            }
        }
        order.splice(index, 0, dragId);
        setOrder(order);
    });
    pagesEl.addEventListener("dragend", () => {
        pagesEl.querySelectorAll(".pp-q").forEach(el => { el.draggable = false; el.classList.remove("dragging"); });
        clearDropMarks();
        dragId = null;
    });

    // --- rendering ---
    const fitZoom = () => {
        const z = Math.max(0.35, Math.min(1, (scrollEl.clientWidth - 32) / PAGE.width));
        pagesEl.style.zoom = String(z);
        // Corner handles keep a usable on-screen size however small the sheet is drawn
        pagesEl.style.setProperty("--pp-inv", String(1 / z));
    };
    window.addEventListener("resize", fitZoom);
    overlay._cleanup = () => window.removeEventListener("resize", fitZoom);

    let renderToken = 0;
    async function render() {
        const token = ++renderToken;
        const resolved = resolvePrintLayout(currentQuiz());
        const geo = resolved.geometry;
        boxes.autoFit.checked = resolved.autoFit;
        boxes.narrow.checked = resolved.margins === "narrow";
        boxes.header.checked = resolved.header;
        boxes.answerKey.checked = resolved.answerKey;

        // Image sizes are needed before measuring, so the page breaks land where Word puts them
        const sources = [];
        resolved.items.forEach(({ q }) => {
            sources.push(q.image);
            (q.choices || []).forEach(c => sources.push(c.image));
        });
        const naturals = new Map();
        await Promise.all(sources.filter(Boolean).map(async src => naturals.set(src, await naturalSize(src))));
        if (token !== renderToken || !overlay) return;

        const studentBlocks = [titleBlock(quiz.title, resolved.header)];
        resolved.items.forEach(item => studentBlocks.push(questionBlock(item, naturals, geo, resolved.items.length)));
        const pages = paginate(studentBlocks, measureEl, geo, resolved.autoFit);
        if (resolved.answerKey) pages.push(...paginate(answerKeyBlocks(quiz.title, resolved.items), measureEl, geo, false));

        const scrollTop = scrollEl.scrollTop;
        pagesEl.innerHTML = "";
        pagesEl.style.setProperty("--pp-mx", `${geo.marginX}px`);
        pagesEl.style.setProperty("--pp-my", `${geo.marginY}px`);
        if (!resolved.items.length) pagesEl.innerHTML = `<div class="pp-empty">${t("pp.empty")}</div>`;
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

        // Remember the sizes shown, for the export
        renderedSizes = new Map();
        pagesEl.querySelectorAll(".pp-img").forEach(wrap => {
            const img = wrap.querySelector("img");
            renderedSizes.set(`${wrap.dataset.id}|${wrap.dataset.key}`, { width: img.width, height: img.height });
        });

        if (selectedId) pagesEl.querySelector(`.pp-q[data-id="${window.CSS.escape(selectedId)}"]`)?.classList.add("selected");
        if (selectedImage) {
            const [id, key] = selectedImage.split("|");
            pagesEl.querySelector(`.pp-img[data-id="${window.CSS.escape(id)}"][data-key="${window.CSS.escape(key)}"]`)?.classList.add("selected");
        }
        updateSelbar();
        const fitted = pagesEl.querySelectorAll('.pp-q[data-fitted="true"]').length;
        overlay.querySelector(".pp-pagecount").textContent = t("pp.pages").replace("{n}", pages.length) +
            (fitted ? ` · ${t("pp.fittedCount").replace("{n}", fitted)}` : "");
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

// Flows blocks onto pages without splitting one (Word keeps each question together too).
// With autoFit, a question that would leave a gap by moving to the next page gets its
// automatically sized image shrunk (to no less than 60 %) when that lets it fit.
function paginate(blocks, measureEl, geo, autoFit) {
    measureEl.innerHTML = "";
    measureEl.style.width = `${geo.contentWidth}px`;
    blocks.forEach(b => measureEl.appendChild(b));
    if (window.renderMathInElement) window.renderMathInElement(measureEl, { delimiters: KATEX_DELIMITERS, throwOnError: false });
    const height = (b) => b.getBoundingClientRect().height;

    const pages = [[]];
    let used = 0;
    blocks.forEach((block) => {
        let h = height(block);
        const pageHasContent = pages[pages.length - 1].length > 0;
        const forceBreak = block.dataset.pageBreak === "true";
        if (pageHasContent && !forceBreak && used + h > geo.contentHeight && autoFit) {
            const shrunk = shrinkToFit(block, used + h - geo.contentHeight);
            if (shrunk) h = height(block);
        }
        if (pageHasContent && (forceBreak || used + h > geo.contentHeight)) {
            pages.push([]);
            used = 0;
        }
        // "Space to the end of the page" takes whatever is left on this page
        const fill = block.querySelector(".pp-space-fill");
        if (fill) {
            const rest = Math.max(0, geo.contentHeight - used - h);
            fill.style.height = `${rest}px`;
            h += rest;
        }
        block.classList.toggle("overflow", h > geo.contentHeight);
        pages[pages.length - 1].push(block);
        used += h;
    });
    measureEl.innerHTML = "";
    return pages;
}

function shrinkToFit(block, needed) {
    const wrap = block.querySelector('.pp-img[data-key="q"]:not([data-custom="true"])');
    const img = wrap?.querySelector("img");
    if (!img) return false;
    const target = img.height - needed - 2;
    if (target < Math.max(80, img.height * FIT_MIN_RATIO)) return false;
    img.width = Math.max(1, Math.round(img.width * target / img.height));
    img.height = Math.round(target);
    block.dataset.fitted = "true";
    wrap.title = t("pp.fitted");
    wrap.dataset.fitLabel = t("pp.fittedShort");
    return true;
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

// An image with corner handles for resizing
function imgHtml(src, item, key, naturals, geo) {
    const url = normalizeImageSrc(src);
    const size = url && imageSizeFor(item, key, naturals.get(src), geo);
    if (!size) return "";
    const corners = ["nw", "ne", "sw", "se"].map(c => `<span class="pp-corner pp-corner-${c}" data-corner="${c}" aria-hidden="true"></span>`).join("");
    return `<span class="pp-img" data-id="${escapeHtml(item.id)}" data-key="${escapeHtml(key)}" data-custom="${!!size.custom}"
        title="${t("pp.resizeHint")}"><img src="${url}" width="${size.width}" height="${size.height}" alt="" draggable="false">${corners}<span class="pp-size-badge"></span></span>`;
}

function titleBlock(title, header) {
    return el(`
        <div class="pp-block pp-title-block">
            <div class="pp-doc-title">${escapeHtml(title || "")}</div>
            ${header ? `<div class="pp-doc-header">${t("docx.name")}: __________________________ &nbsp; ${t("docx.class")}: ______ &nbsp; ${t("docx.date")}: ____________</div>` : ""}
        </div>
    `);
}

const spaceLabel = (space) => space === "page" ? t("pp.spacePage") : space ? `${space * 3} cm` : t("pp.spaceNone");

// Buttons for one question: move, page break, columns, writing space, image size
function toolsHtml(item, total) {
    const { q, number, image, pageBreak, columns, space, imageWidths } = item;
    const isChoice = (q.type || "multiple-choice") === "multiple-choice";
    const customQ = !!imageWidths?.q;
    const sizeButtons = q.image ? `
        <span class="pp-seg" role="group" aria-label="${t("pp.imageSize")}">
            ${IMAGE_SIZE_KEYS.map(k => `<button type="button" data-act="img" data-size="${k}" aria-pressed="${!customQ && k === image}" title="${t("pp.imageSize")}: ${t(`pp.size.${k}`)}">${t(`pp.size.${k}`)}</button>`).join("")}
        </span>` : "";
    return `
        <button type="button" data-act="up" title="${t("pp.moveUp")}" aria-label="${t("pp.moveUp")}" ${number === 1 ? "disabled" : ""}>↑</button>
        <button type="button" data-act="down" title="${t("pp.moveDown")}" aria-label="${t("pp.moveDown")}" ${number === total ? "disabled" : ""}>↓</button>
        <button type="button" data-act="break" aria-pressed="${pageBreak}" ${number === 1 ? "disabled" : ""}>⤓ ${t("pp.pageBreak")}</button>
        <button type="button" data-act="space" aria-pressed="${!!space}" title="${t("pp.spaceTitle")}">✎ ${t("pp.space")}: ${spaceLabel(space)}</button>
        ${isChoice ? `<button type="button" data-act="cols" aria-pressed="${columns === 2}">▥ ${t("pp.columns")}</button>` : ""}
        ${sizeButtons}
    `;
}

function questionBlock(item, naturals, geo, total) {
    const { q, id, number, pageBreak, columns, space } = item;
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
                ${!isTypedSlot(c) && c.image ? `<div>${imgHtml(c.image, item, c.id, naturals, geo)}</div>` : ""}
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

    let spaceHtml = "";
    if (space === "page") spaceHtml = `<div class="pp-space pp-space-fill"><span>${t("pp.spaceLabel")}</span></div>`;
    else if (space) spaceHtml = `<div class="pp-space" style="height: ${SPACE_HEIGHTS[space]}px"><span>${t("pp.spaceLabel")}</span></div>`;

    const block = el(`
        <div class="pp-block pp-q${pageBreak ? " has-break" : ""}" data-id="${escapeHtml(id)}">
            <span class="pp-handle" title="${t("pp.drag")}" aria-hidden="true">⋮⋮</span>
            <div class="pp-tools">${toolsHtml(item, total)}</div>
            ${pageBreak ? `<div class="pp-break-label">⤓ ${t("pp.pageBreak")}</div>` : ""}
            <div class="pp-prompt"><b>${number}.</b> <b>${richHtml(q.prompt, { blanks: type === "fill-blank" })}</b>${hint ? ` <span class="pp-hint-text">${hint}</span>` : ""}</div>
            ${q.image ? `<div class="pp-indent pp-qimg">${imgHtml(q.image, item, "q", naturals, geo)}</div>` : ""}
            ${answers}
            ${spaceHtml}
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
