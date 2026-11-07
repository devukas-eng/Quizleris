import { isTypedSlot } from "./state.js";
import { isStoredPicture } from "./quiz-pictures.js";

// Shared by the print preview and the Word export, so both lay a quiz out the same way.
// The layout is stored on the quiz as `printLayout` and only affects the printout:
//   { order: [questionId], header: bool, answerKey: bool, margins: "normal"|"narrow", autoFit: bool,
//     items: { [questionId]: { image: "s"|"m"|"l"|"full", imageWidths: { q|choiceId: px },
//                              pageBreak: bool, columns: 1|2, space: 0|1|2|3|"page" } } }

// A4 at 96 px per inch (the unit docx uses for image sizes); 1 px = 15 twips
export const PAGE = { width: 794, height: 1123 };
export const TWIPS_PER_PX = 15;
export const INDENT = 24; // answers and images are indented by 360 twips

const MARGINS = {
    normal: { x: 73, y: 67 },  // ≈ 1.94 cm / 1.76 cm
    narrow: { x: 48, y: 48 }   // 1.27 cm, Word's "Narrow"
};

/** Page margins and the writable area for a layout. */
export function pageGeometry(layout) {
    const m = MARGINS[layout?.margins] || MARGINS.normal;
    return { marginX: m.x, marginY: m.y, contentWidth: PAGE.width - 2 * m.x, contentHeight: PAGE.height - 2 * m.y };
}

export const IMAGE_SIZE_KEYS = ["s", "m", "l", "full"];
export const MIN_IMAGE_WIDTH = 48;

// Largest box a preset lets an image fill; the image is scaled (up or down) to fit it
export function imageBox(preset, geometry) {
    switch (preset) {
        case "s": return { w: 200, h: 180 };
        case "l": return { w: 520, h: 520 };
        case "full": return { w: geometry.contentWidth - INDENT, h: geometry.contentHeight - 160 };
        default: return { w: 360, h: 300 };
    }
}
export const CHOICE_IMAGE = { 1: { w: 240, h: 170 }, 2: { w: 200, h: 140 } };

// Extra writing space after a question, in px (3, 6 and 9 cm); "page" fills the rest of the page
export const SPACE_STEPS = [0, 1, 2, 3, "page"];
export const SPACE_HEIGHTS = { 1: 113, 2: 227, 3: 340 };

export function fitImage(natural, box) {
    if (!natural?.w || !natural?.h) return null;
    const scale = Math.min(box.w / natural.w, box.h / natural.h);
    return { width: Math.max(1, Math.round(natural.w * scale)), height: Math.max(1, Math.round(natural.h * scale)) };
}

/** Largest width an image can be dragged to: the writable width (or its option column). */
export function maxImageWidth(geometry, key, columns) {
    if (key === "q") return geometry.contentWidth - INDENT;
    return columns === 2 ? Math.floor((geometry.contentWidth - INDENT) / 2) - 40 : geometry.contentWidth - INDENT - 60;
}

/**
 * Size of one image in the printout: a width the teacher dragged to wins; otherwise the
 * preset box (question image) or the option-image box. The aspect ratio is always kept.
 */
export function imageSizeFor(item, key, natural, geometry) {
    if (!natural?.w || !natural?.h) return null;
    const custom = item.imageWidths?.[key];
    if (custom) {
        const maxW = maxImageWidth(geometry, key, item.columns);
        const maxH = geometry.contentHeight - 120;
        let width = Math.min(Math.max(custom, MIN_IMAGE_WIDTH), maxW);
        let height = Math.round(width * natural.h / natural.w);
        if (height > maxH) { height = maxH; width = Math.round(height * natural.w / natural.h); }
        return { width, height, custom: true };
    }
    const box = key === "q" ? imageBox(item.image, geometry) : (CHOICE_IMAGE[item.columns] || CHOICE_IMAGE[1]);
    return fitImage(natural, box);
}

// Two columns suit four or more short, plain options
export function autoColumns(q) {
    const choices = q.choices || [];
    if ((q.type || "multiple-choice") !== "multiple-choice" || choices.length < 4) return 1;
    const short = choices.every(c => !isTypedSlot(c) && !c.image &&
        String(c.text || "").replace(/\\\(|\\\)|\\\[|\\\]/g, "").length <= 24);
    return short ? 2 : 1;
}

/** The quiz's questions in print order with their resolved settings. */
export function resolvePrintLayout(quiz) {
    const saved = quiz.printLayout || {};
    const questions = quiz.questions || [];
    const byId = new Map(questions.map(q => [q.id, q]));
    const order = (saved.order || []).filter(id => byId.has(id));
    // Questions added after the layout was made go to the end, in quiz order
    questions.forEach(q => { if (!order.includes(q.id)) order.push(q.id); });
    let prevSpace = 0;
    const items = order.map((id, index) => {
        const q = byId.get(id);
        const s = saved.items?.[id] || {};
        const isChoice = (q.type || "multiple-choice") === "multiple-choice";
        const item = {
            q,
            id,
            number: index + 1,
            image: IMAGE_SIZE_KEYS.includes(s.image) ? s.image : "m",
            imageWidths: s.imageWidths || {},
            // "Space to the end of the page" on the previous question also starts a new page
            pageBreak: index > 0 && (!!s.pageBreak || prevSpace === "page"),
            columns: isChoice ? (s.columns === 1 || s.columns === 2 ? s.columns : autoColumns(q)) : 1,
            space: SPACE_STEPS.includes(s.space) ? s.space : 0
        };
        prevSpace = item.space;
        return item;
    });
    return {
        header: saved.header !== false,
        answerKey: !!saved.answerKey,
        margins: saved.margins === "narrow" ? "narrow" : "normal",
        autoFit: saved.autoFit !== false,
        geometry: pageGeometry(saved),
        items
    };
}

/** Returns a copy of the layout with one question's setting changed. */
export function withItemSetting(layout, id, key, value) {
    const next = { ...(layout || {}), items: { ...(layout?.items || {}) } };
    next.items[id] = { ...(next.items[id] || {}), [key]: value };
    return next;
}

/** Returns a copy of the layout with one image's dragged width set (null clears it). */
export function withImageWidth(layout, id, key, width) {
    const current = layout?.items?.[id]?.imageWidths || {};
    const imageWidths = { ...current };
    if (width) imageWidths[key] = Math.round(width);
    else delete imageWidths[key];
    return withItemSetting(layout, id, "imageWidths", imageWidths);
}

// --- Images -----------------------------------------------------------------

const naturalSizeCache = new Map();

export function normalizeImageSrc(src) {
    if (!src || typeof src !== "string") return null;
    if (src.startsWith("data:image/") || isStoredPicture(src)) return src;
    // Older quizzes stored bare base64 JPEG
    return /^[A-Za-z0-9+/=\s]+$/.test(src.slice(0, 200)) ? `data:image/jpeg;base64,${src}` : null;
}

/** Natural pixel size of an image (cached); null if it cannot be decoded. */
export function naturalSize(src) {
    const url = normalizeImageSrc(src);
    if (!url) return Promise.resolve(null);
    if (!naturalSizeCache.has(url)) {
        naturalSizeCache.set(url, new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img.naturalWidth && img.naturalHeight
                ? { w: img.naturalWidth, h: img.naturalHeight }
                : { w: 800, h: 600 }); // e.g. SVG without an intrinsic size
            img.onerror = () => resolve(null);
            img.src = url;
        }));
    }
    return naturalSizeCache.get(url);
}
