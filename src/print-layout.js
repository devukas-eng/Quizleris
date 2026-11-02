import { isTypedSlot } from "./state.js";

// Shared by the print preview and the Word export, so both lay a quiz out the same way.
// The layout is stored on the quiz as `printLayout` and only affects the printout:
//   { order: [questionId], header: bool, answerKey: bool,
//     items: { [questionId]: { image: "s"|"m"|"l"|"full", pageBreak: bool, columns: 1|2 } } }

// A4 with the export's margins, at 96 px per inch (the unit docx uses for image sizes)
export const PAGE = { width: 794, height: 1123, marginX: 73, marginY: 67 };
export const CONTENT_WIDTH = PAGE.width - 2 * PAGE.marginX;     // 648
export const CONTENT_HEIGHT = PAGE.height - 2 * PAGE.marginY;   // 989
export const INDENT = 24;                                       // answers are indented by 360 twips

// Largest box an image may fill; images are scaled (up or down) to fit it
export const IMAGE_SIZES = {
    s: { w: 200, h: 180 },
    m: { w: 360, h: 300 },
    l: { w: 520, h: 520 },
    full: { w: CONTENT_WIDTH - INDENT, h: 800 }
};
export const IMAGE_SIZE_KEYS = ["s", "m", "l", "full"];
export const CHOICE_IMAGE = { 1: { w: 240, h: 170 }, 2: { w: 200, h: 140 } };

export function fitImage(natural, box) {
    if (!natural?.w || !natural?.h) return null;
    const scale = Math.min(box.w / natural.w, box.h / natural.h);
    return { width: Math.max(1, Math.round(natural.w * scale)), height: Math.max(1, Math.round(natural.h * scale)) };
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
    const items = order.map((id, index) => {
        const q = byId.get(id);
        const s = saved.items?.[id] || {};
        const isChoice = (q.type || "multiple-choice") === "multiple-choice";
        return {
            q,
            id,
            number: index + 1,
            image: IMAGE_SIZE_KEYS.includes(s.image) ? s.image : "m",
            pageBreak: !!s.pageBreak && index > 0,
            columns: isChoice ? (s.columns === 1 || s.columns === 2 ? s.columns : autoColumns(q)) : 1
        };
    });
    return { header: saved.header !== false, answerKey: !!saved.answerKey, items };
}

/** Returns a copy of the layout with one question's setting changed. */
export function withItemSetting(layout, id, key, value) {
    const next = { ...(layout || {}), items: { ...(layout?.items || {}) } };
    next.items[id] = { ...(next.items[id] || {}), [key]: value };
    return next;
}

// --- Images -----------------------------------------------------------------

const naturalSizeCache = new Map();

export function normalizeImageSrc(src) {
    if (!src || typeof src !== "string") return null;
    if (src.startsWith("data:image/")) return src;
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
