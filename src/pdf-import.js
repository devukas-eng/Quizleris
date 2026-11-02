import { startsNewItem } from "./quiz-import.js";

// PDF import: reads a PDF in the browser with pdf.js (loaded on first use) into lines for the
// shared question parser (quiz-import.js).
// A PDF keeps only positioned glyphs, so the reading order is rebuilt here: glyphs on one baseline
// form a row (smaller raised/lowered glyphs become ² / ₂), wide gaps split a row into cells (two
// options side by side), wrapped paragraph lines are joined again, repeated headers, footers and
// page numbers are dropped, and pictures are cropped from the rendered page.
// Formulas are only glyphs in a PDF (no structure), so lines set in math fonts are flagged for checking.

const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
const MATH_FONT_RE = /math|cmmi|cmsy|cmex|symbol|stix|mtextra|euclid|katex_(math|size|ams)/i;
const BOLD_FONT_RE = /bold|black|heavy|semibold|demi/i;
const MIN_IMAGE_PT = 20;   // smaller pictures are icons, bullets or rules
const RENDER_SCALE = 2;    // pictures are cropped from the page rendered at 2× (≈144 dpi)
const SUPERSCRIPT = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻", "−": "⁻", n: "ⁿ" };
const SUBSCRIPT = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "+": "₊", "-": "₋", "−": "₋" };
const LIGATURES = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl" };

let pdfjsLoading = null;
function loadPdfJs() {
    if (!pdfjsLoading) {
        pdfjsLoading = import(PDFJS_URL).then(lib => {
            lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
            return lib;
        }).catch(err => {
            pdfjsLoading = null;
            throw err;
        });
    }
    return pdfjsLoading;
}

const scriptText = (str, map, mark) => ([...str].every(ch => map[ch]) ? [...str].map(ch => map[ch]).join("") : `${mark}(${str})`);
const multiply = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
];

// Positioned glyph runs of one page
function pageItems(page, content) {
    const items = [];
    for (const it of content.items) {
        if (!it.str || !it.str.trim() && !it.width) continue;
        const [a, b, c, d, x, y] = it.transform;
        if (Math.abs(b) > Math.abs(a) + 0.01) continue; // vertical text
        const font = page.commonObjs.has(it.fontName) ? page.commonObjs.get(it.fontName) : null;
        const name = font?.name || "";
        items.push({
            str: it.str.replace(/[ﬀﬁﬂﬃﬄ]/g, ch => LIGATURES[ch]),
            x, y,
            w: it.width,
            size: Math.hypot(c, d) || it.height || 10,
            bold: !!font?.bold || BOLD_FONT_RE.test(name),
            math: MATH_FONT_RE.test(name)
        });
    }
    return items;
}

// Items -> rows -> cells, top to bottom
function itemsToLines(items) {
    items.sort((p, q) => q.y - p.y || p.x - q.x);
    const rows = [];
    for (const it of items) {
        const top = it.y + it.size * 0.8;
        const bottom = it.y - it.size * 0.2;
        // Same row when the glyph boxes overlap by more than half the smaller one
        let row = null;
        for (let i = rows.length - 1; i >= Math.max(0, rows.length - 4); i--) {
            const r = rows[i];
            if (Math.min(r.top, top) - Math.max(r.bottom, bottom) > 0.5 * Math.min(it.size, r.size)) { row = r; break; }
        }
        if (!row) {
            row = { top, bottom, y: it.y, size: it.size, items: [] };
            rows.push(row);
        }
        row.items.push(it);
        if (it.size > row.size) { row.size = it.size; row.y = it.y; }
        row.top = Math.max(row.top, top);
        row.bottom = Math.min(row.bottom, bottom);
    }
    const lines = [];
    for (const row of rows) {
        row.items.sort((p, q) => p.x - q.x);
        let cell = null;
        let prevEnd = -Infinity;
        for (const it of row.items) {
            const gap = it.x - prevEnd;
            if (!cell || gap > row.size * 1.6) {
                cell = { text: "", images: [], x: it.x, y: row.y, size: row.size, chars: 0, boldChars: 0, mathy: false };
                lines.push(cell);
            } else if (gap > row.size * 0.18 && !/\s$/.test(cell.text) && !/^\s/.test(it.str)) {
                cell.text += " ";
            }
            let str = it.str;
            if (it.size < row.size * 0.85 && it.y > row.y + row.size * 0.2) str = scriptText(str.trim(), SUPERSCRIPT, "^");
            else if (it.size < row.size * 0.85 && it.y < row.y - row.size * 0.1) str = scriptText(str.trim(), SUBSCRIPT, "_");
            cell.text += str;
            const visible = it.str.replace(/\s/g, "").length;
            cell.chars += visible;
            if (it.bold) cell.boldChars += visible;
            if (it.math) cell.mathy = true;
            prevEnd = it.x + it.w;
        }
    }
    return lines.map(l => ({ ...l, text: l.text.replace(/\s+/g, " ").trim(), bold: l.chars > 0 && l.boldChars === l.chars }));
}

// Pictures drawn on the page, as boxes in page units (from the drawing operators)
function imageBoxes(pdfjs, ops) {
    const { OPS } = pdfjs;
    const boxes = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) ctm = multiply(ctm, args);
        else if (fn === OPS.paintFormXObjectBegin) {
            stack.push(ctm);
            if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = multiply(ctm, args[0]);
        } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
            const xs = [], ys = [];
            for (const [ux, uy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                xs.push(ctm[0] * ux + ctm[2] * uy + ctm[4]);
                ys.push(ctm[1] * ux + ctm[3] * uy + ctm[5]);
            }
            const box = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
            if (box.x2 - box.x1 >= MIN_IMAGE_PT && box.y2 - box.y1 >= MIN_IMAGE_PT) boxes.push(box);
        }
    }
    return boxes;
}

async function cropImages(page, boxes) {
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const images = [];
    for (const box of boxes) {
        const [ax, ay, bx, by] = viewport.convertToViewportRectangle([box.x1, box.y1, box.x2, box.y2]);
        const left = Math.max(0, Math.floor(Math.min(ax, bx)));
        const top = Math.max(0, Math.floor(Math.min(ay, by)));
        const width = Math.min(canvas.width - left, Math.ceil(Math.abs(bx - ax)));
        const height = Math.min(canvas.height - top, Math.ceil(Math.abs(by - ay)));
        if (width < 8 || height < 8) continue;
        const crop = document.createElement("canvas");
        crop.width = width;
        crop.height = height;
        crop.getContext("2d").drawImage(canvas, left, top, width, height, 0, 0, width, height);
        const blob = await new Promise(resolve => crop.toBlob(resolve, "image/png"));
        if (blob) images.push({ blob, y: box.y2, x: box.x1 });
    }
    canvas.width = canvas.height = 0; // free the page bitmap
    return images;
}

// Wrapped lines of one paragraph -> one line (never across a new question, option or bigger gap)
function joinParagraphs(lines) {
    const out = [];
    for (const line of lines) {
        const prev = out[out.length - 1];
        const lineBelow = prev && line.text && prev.text && !prev.images.length && !line.images.length &&
            prev.y - line.y > prev.size * 0.5 && prev.y - line.y < prev.size * 1.75 &&
            Math.abs(line.size - prev.size) < prev.size * 0.15 && line.x >= prev.x - 4 && line.bold === prev.bold;
        // A question ending in "?" or ":" is complete: what follows is its answer area
        if (lineBelow && !startsNewItem(line.text) && !/[?:]$/.test(prev.text)) {
            prev.text = /[a-ząčęėįšųūž]-$/i.test(prev.text) && /^[a-ząčęėįšųūž]/.test(line.text)
                ? prev.text.slice(0, -1) + line.text // hyphenated word
                : `${prev.text} ${line.text}`;
            prev.y = line.y;
            prev.mathy = prev.mathy || line.mathy;
            continue;
        }
        out.push({ ...line });
    }
    return out;
}

const PAGE_NUMBER_RE = /^(-?\s*\d{1,3}\s*-?|\d{1,3}\s*(\/|iš|of)\s*\d{1,3}|(puslapis|psl\.?|page)\s*\d{1,3}(\s*(\/|iš|of)\s*\d{1,3})?)$/i;

/**
 * Reads a PDF into lines for linesToQuiz (quiz-import.js).
 * @returns {Promise<{ lines: object[], warnings: { skippedEquations: number, skippedImages: number } }>}
 */
export async function readPdf(file) {
    const pdfjs = await loadPdfJs();
    let doc;
    try {
        doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    } catch (err) {
        const error = new Error(err?.name === "PasswordException" ? "password" : "unreadable");
        error.code = error.message;
        throw error;
    }
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const height = page.getViewport({ scale: 1 }).height;
        const ops = await page.getOperatorList(); // also loads the fonts, needed for bold/math detection
        const lines = itemsToLines(pageItems(page, await page.getTextContent()));
        const boxes = imageBoxes(pdfjs, ops);
        const images = boxes.length ? await cropImages(page, boxes) : [];
        for (const img of images) lines.push({ text: "", images: [img.blob], x: img.x, y: img.y, size: 0, bold: false, mathy: false });
        lines.sort((p, q) => q.y - p.y || p.x - q.x);
        pages.push({ height, lines });
        page.cleanup();
    }
    await doc.destroy();

    // Repeated headers/footers (same text near the top or bottom of several pages) and page numbers
    const edge = (line, height) => line.y > height * 0.92 || line.y < height * 0.08;
    const repeats = new Map();
    pages.forEach(({ height, lines }) => lines.forEach(line => {
        if (line.text && edge(line, height)) {
            const k = line.text.replace(/\d+/g, "#");
            repeats.set(k, (repeats.get(k) || 0) + 1);
        }
    }));
    let all = [];
    for (const { height, lines } of pages) {
        const kept = lines.filter(line => !(line.text && edge(line, height) &&
            (PAGE_NUMBER_RE.test(line.text) || (pages.length > 1 && repeats.get(line.text.replace(/\d+/g, "#")) > 1))));
        all = all.concat(joinParagraphs(kept));
    }
    if (!all.some(line => line.text)) {
        const error = new Error("no-text"); // scanned pages: pictures of text only
        error.code = "no-text";
        throw error;
    }

    // The largest line on top of the first page is the title
    const sizes = all.filter(l => l.text).map(l => l.size).sort((p, q) => p - q);
    const median = sizes[Math.floor(sizes.length / 2)] || 0;
    const first = all.find(l => l.text);
    if (first && first.size >= median * 1.35) first.styleId = "Title";

    return { lines: all, warnings: { skippedEquations: 0, skippedImages: 0 } };
}
