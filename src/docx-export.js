import { t } from "./lang.js";
import { parseRichValue } from "./rich-input.js";
import { isTypedSlot } from "./state.js";
import { resolvePrintLayout, imageSizeFor, normalizeImageSrc, naturalSize, SPACE_HEIGHTS, INDENT, TWIPS_PER_PX } from "./print-layout.js";

// Word export: a printable sheet for students, optionally followed by an answer key.
// Order, image sizes, page breaks, writing space, margins and option columns come from the
// quiz's print layout; image sizes shown in the print preview (including ones it shrank to
// save paper) can be passed in so the file matches the preview exactly.
// The docx library (~1.3 MB) is loaded only when someone actually exports.
const DOCX_URL = "https://cdn.jsdelivr.net/npm/docx@9.11.0/dist/index.iife.js";
let docxLoading = null;

function loadDocx() {
    if (window.docx) return Promise.resolve(window.docx);
    if (!docxLoading) {
        docxLoading = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = DOCX_URL;
            script.onload = () => resolve(window.docx);
            script.onerror = () => {
                docxLoading = null;
                reject(new Error("Could not load the Word export library"));
            };
            document.head.appendChild(script);
        });
    }
    return docxLoading;
}

// --- LaTeX -> Word equation (common school math; anything unknown becomes plain text) ---

const SYMBOLS = {
    times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥",
    ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼", propto: "∝", infty: "∞", to: "→", rightarrow: "→",
    leftarrow: "←", Rightarrow: "⇒", Leftrightarrow: "⇔", in: "∈", notin: "∉", cup: "∪", cap: "∩",
    subset: "⊂", subseteq: "⊆", emptyset: "∅", varnothing: "∅", angle: "∠", perp: "⊥", parallel: "∥",
    triangle: "△", circ: "°", degree: "°", prod: "∏", partial: "∂", nabla: "∇",
    forall: "∀", exists: "∃", cdots: "⋯", ldots: "…", dots: "…", prime: "′", mid: "|",
    langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
    theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ",
    sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
    ",": " ", ";": " ", ":": " ", " ": " ", quad: "  ", qquad: "    ", "!": "",
    "%": "%", "{": "{", "}": "}", "$": "$", "&": "&", "#": "#", "_": "_", "|": "‖",
    "\\": ";  " // row break (systems, matrices) reads as a separator in one line
};
const FUNCTIONS = new Set(["sin", "cos", "tan", "tg", "ctg", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
    "log", "ln", "lg", "exp", "max", "min", "det", "gcd", "deg", "sgn"]);
const TEXT_COMMANDS = new Set(["text", "mathrm", "textrm", "textbf", "mathbf", "operatorname", "mbox", "textit", "mathit"]);
const IGNORED = new Set(["left", "right", "displaystyle", "textstyle", "limits", "nolimits", "big", "Big", "bigg", "Bigg", "middle"]);
// Accents become a combining character on each letter of their argument
const ACCENTS = { vec: "\u20D7", overrightarrow: "\u20D7", hat: "\u0302", widehat: "\u0302", bar: "\u0305",
    overline: "\u0305", dot: "\u0307", ddot: "\u0308", tilde: "\u0303", widetilde: "\u0303", underline: "\u0332" };
const ENV_BRACKETS = { pmatrix: ["(", ")"], bmatrix: ["[", "]"], vmatrix: ["|", "|"], Bmatrix: ["{", "}"], cases: ["{ ", ""] };

function tokenize(latex) {
    const tokens = [];
    for (let i = 0; i < latex.length; i++) {
        const ch = latex[i];
        if (ch === "\\") {
            const m = /^\\([A-Za-z]+|.)/.exec(latex.slice(i));
            if (m) {
                tokens.push({ cmd: m[1] });
                i += m[0].length - 1;
            }
        } else if (!/\s/.test(ch)) {
            tokens.push({ ch });
        }
    }
    return tokens;
}

function latexToMathChildren(d, latex) {
    const tokens = tokenize(latex);
    let pos = 0;

    const parseGroup = () => {
        // Called after "{": read until the matching "}"
        const items = parseSequence(true);
        if (tokens[pos]?.ch === "}") pos++;
        return items;
    };
    const parseArg = () => {
        const tok = tokens[pos];
        if (!tok) return [];
        if (tok.ch === "{") { pos++; return parseGroup(); }
        return parseAtom();
    };
    const rawGroupText = () => {
        // Text commands and environment names: keep the raw characters of the argument
        if (tokens[pos]?.ch !== "{") return tokens[pos++]?.ch || "";
        pos++;
        let depth = 1, text = "";
        while (pos < tokens.length) {
            const tok = tokens[pos++];
            if (tok.ch === "{") depth++;
            if (tok.ch === "}" && --depth === 0) break;
            text += tok.ch ?? (SYMBOLS[tok.cmd] ?? tok.cmd);
        }
        return text;
    };
    // Optional ^ / _ after the current position (either order)
    const parseScripts = () => {
        let sup = null, sub = null;
        for (let k = 0; k < 2; k++) {
            const next = tokens[pos]?.ch;
            if (next === "^" && !sup) { pos++; sup = parseArg(); }
            else if (next === "_" && !sub) { pos++; sub = parseArg(); }
        }
        return { sup, sub };
    };
    const parseAtom = () => {
        const tok = tokens[pos++];
        if (!tok) return [];
        if (tok.ch === "{") return parseGroup();
        if (tok.ch === "&") return [{ text: "   " }];
        if (tok.ch !== undefined) return [{ text: tok.ch }];
        const cmd = tok.cmd;
        if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") {
            const numerator = parseArg();
            const denominator = parseArg();
            return [new d.MathFraction({ numerator: build(numerator), denominator: build(denominator) })];
        }
        if (cmd === "binom" || cmd === "dbinom") {
            const top = parseArg();
            const bottom = parseArg();
            return [{ text: "(" }, new d.MathFraction({ numerator: build(top), denominator: build(bottom), type: "noBar" }), { text: ")" }];
        }
        if (cmd === "sqrt") {
            let degree = null;
            if (tokens[pos]?.ch === "[") {
                pos++;
                degree = [];
                while (pos < tokens.length && tokens[pos].ch !== "]") degree.push(...parseAtom());
                pos++;
            }
            const body = parseArg();
            return [new d.MathRadical({ children: build(body), ...(degree ? { degree: build(degree) } : {}) })];
        }
        if (cmd === "sum" || cmd === "int" || cmd === "oint") {
            // Big operators take their limits and the term right after them
            const { sup, sub } = parseScripts();
            const body = pos < tokens.length && tokens[pos].ch !== "}" ? parseAtom() : [];
            const Op = cmd === "sum" ? d.MathSum : d.MathIntegral;
            return [new Op({ children: build(body), ...(sub ? { subScript: build(sub) } : {}), ...(sup ? { superScript: build(sup) } : {}) })];
        }
        if (cmd === "lim") {
            if (tokens[pos]?.ch === "_") {
                pos++;
                const limit = parseArg();
                return [new d.MathLimitLower({ children: [new d.MathRun("lim")], limit: build(limit) }), { text: " " }];
            }
            return [{ text: "lim " }];
        }
        if (cmd in ACCENTS) {
            const arg = parseArg();
            if (arg.every(item => typeof item.text === "string")) {
                const text = arg.map(item => item.text).join("");
                return [{ text: [...text].map(c => c + ACCENTS[cmd]).join("") }];
            }
            return arg;
        }
        if (cmd === "begin") {
            const env = rawGroupText().replace("*", "");
            return [{ text: ENV_BRACKETS[env]?.[0] ?? "" }];
        }
        if (cmd === "end") {
            const env = rawGroupText().replace("*", "");
            return [{ text: ENV_BRACKETS[env]?.[1] ?? "" }];
        }
        if (TEXT_COMMANDS.has(cmd)) return [{ text: rawGroupText() }];
        if (IGNORED.has(cmd)) return [];
        if (FUNCTIONS.has(cmd)) return [{ text: cmd, func: true }];
        if (cmd in SYMBOLS) return [{ text: SYMBOLS[cmd] }];
        // Unknown command: drop the backslash, keep any braced argument's content
        if (tokens[pos]?.ch === "{") return parseArg();
        return [{ text: cmd }];
    };
    function parseSequence(inGroup) {
        const items = [];
        while (pos < tokens.length) {
            const tok = tokens[pos];
            if (inGroup && tok.ch === "}") break;
            if (tok.ch === "^" || tok.ch === "_") {
                const base = items.length ? [items.pop()] : [{ text: "" }];
                const { sup, sub } = parseScripts();
                if (sup && sub) items.push(new d.MathSubSuperScript({ children: build(base), subScript: build(sub), superScript: build(sup) }));
                else if (sup) items.push(new d.MathSuperScript({ children: build(base), superScript: build(sup) }));
                else items.push(new d.MathSubScript({ children: build(base), subScript: build(sub) }));
                // Function names (log₂ x) get their space after the script
                if (base[0]?.func) items.push({ text: " " });
                continue;
            }
            const atom = parseAtom();
            items.push(...atom);
            // "sin x": space after a function name unless a script follows
            const last = atom[atom.length - 1];
            if (last?.func && tokens[pos]?.ch !== "_" && tokens[pos]?.ch !== "^") items.push({ text: " " });
        }
        return items;
    }
    // Merge neighbouring plain characters into single runs
    function build(items) {
        const out = [];
        let text = "";
        for (const item of items) {
            if (item && typeof item.text === "string" && !(item instanceof d.MathRun)) {
                text += item.text;
                continue;
            }
            if (text) { out.push(new d.MathRun(text)); text = ""; }
            out.push(item);
        }
        if (text) out.push(new d.MathRun(text));
        return out.length ? out : [new d.MathRun("")];
    }
    return build(parseSequence(false));
}

// --- Document pieces ---

// Text with \( \) formulas -> TextRuns and Word equations. Fill-blank "___" become writing lines.
function richRuns(d, value, { bold = false, blanks = false } = {}) {
    const runs = [];
    parseRichValue(value).forEach(part => {
        if (part.type === "math") {
            let math;
            try {
                math = new d.Math({ children: latexToMathChildren(d, part.latex) });
            } catch {
                math = new d.TextRun({ text: part.latex, bold });
            }
            // \[ … \] formulas get a line of their own
            if (part.display) runs.push(new d.TextRun({ text: "", break: 1 }));
            runs.push(math);
            if (part.display) runs.push(new d.TextRun({ text: "", break: 1 }));
            return;
        }
        let text = part.text;
        if (blanks) text = text.replace(/_{3,}/g, "____________");
        text.split("\n").forEach((line, i) => {
            runs.push(new d.TextRun({ text: line, bold, break: i > 0 ? 1 : undefined }));
        });
    });
    return runs;
}

function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

// Word takes PNG/JPEG/GIF/BMP; anything else (WebP, SVG, AVIF…) and very large images are
// redrawn on a canvas first: PNG when the image has transparency, JPEG otherwise.
async function wordImageData(url, natural) {
    const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(url);
    const longest = Math.max(natural.w, natural.h);
    if (m && longest <= 2400) return { type: m[1].toLowerCase().replace("jpeg", "jpg"), data: base64ToBytes(m[2]) };

    const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
    });
    const scale = Math.min(1, 2400 / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(natural.w * scale));
    canvas.height = Math.max(1, Math.round(natural.h * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = false;
    for (let i = 3; i < pixels.length; i += 4 * 7) { if (pixels[i] < 250) { transparent = true; break; } }
    const out = canvas.toDataURL(transparent ? "image/png" : "image/jpeg", 0.9);
    return { type: transparent ? "png" : "jpg", data: base64ToBytes(out.split(",")[1]) };
}

// One image at the size the preview showed it, or else the size the layout gives it
async function imageRun(d, ctx, item, key, src) {
    const url = normalizeImageSrc(src);
    if (!url) return null;
    const natural = await naturalSize(url);
    if (!natural) return null;
    const shown = ctx.imageSizes?.get(`${item.id}|${key}`);
    const size = shown || imageSizeFor(item, key, natural, ctx.geometry);
    if (!size) return null;
    try {
        const { type, data } = await wordImageData(url, natural);
        return new d.ImageRun({ type, data, transformation: { width: size.width, height: size.height } });
    } catch {
        return null;
    }
}

// A question is first described as paragraph options ({ para }) and finished blocks ({ block }),
// so keep-with-next can be set on every paragraph but the last when they are built.
const writingLine = (d) => ({ para: {
    spacing: { before: 320 },
    indent: { left: 360 },
    border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
    children: []
} });

const hint = (d, text) => new d.TextRun({ text: `  ${text}`, italics: true, color: "777777", size: 20 });

// Options of a choice question: one per line, or a borderless two-column table
async function choiceBlocks(d, ctx, item) {
    const { q, columns } = item;
    const marker = q.allowMultipleAnswers ? "☐" : "○";
    const cells = [];
    const choices = q.choices || [];
    for (let i = 0; i < choices.length; i++) {
        const c = choices[i];
        const runs = [new d.TextRun({ text: `${marker}  ${String.fromCharCode(65 + i)})  ` })];
        if (isTypedSlot(c)) {
            runs.push(new d.TextRun({ text: columns === 2 ? "____________________" : "______________________________" }));
        } else {
            runs.push(...richRuns(d, c.text || ""));
            const img = await imageRun(d, ctx, item, c.id, c.image);
            if (img) runs.push(new d.TextRun({ text: "", break: c.text ? 1 : undefined }), img);
        }
        cells.push(runs);
    }
    if (columns !== 2) {
        return cells.map(runs => ({ para: { indent: { left: 360 }, spacing: { after: 80 }, children: runs } }));
    }
    const half = Math.round((ctx.geometry.contentWidth - INDENT) * TWIPS_PER_PX / 2); // per column
    const none = { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const rows = [];
    for (let i = 0; i < cells.length; i += 2) {
        rows.push(new d.TableRow({
            cantSplit: true,
            children: [cells[i], cells[i + 1]].map(runs => new d.TableCell({
                width: { size: half, type: d.WidthType.DXA },
                borders: { top: none, bottom: none, left: none, right: none },
                children: [new d.Paragraph({ spacing: { after: 80 }, keepNext: i + 2 < cells.length, children: runs || [] })]
            }))
        }));
    }
    return [{ block: new d.Table({
        rows,
        width: { size: half * 2, type: d.WidthType.DXA },
        columnWidths: [half, half],
        indent: { size: 360, type: d.WidthType.DXA },
        borders: d.TableBorders.NONE
    }) }];
}

async function questionBlocks(d, ctx, item) {
    const { q, number, pageBreak, space } = item;
    const out = []; // { para: options } | { block: Table }
    const type = q.type || "multiple-choice";
    const typedSlots = (q.choices || []).some(isTypedSlot);

    const promptRuns = [new d.TextRun({ text: `${number}. `, bold: true }), ...richRuns(d, q.prompt || "", { bold: true, blanks: type === "fill-blank" })];
    if (type === "multiple-choice" && q.allowMultipleAnswers) promptRuns.push(hint(d, t("docx.selectAll")));
    else if (type === "multiple-choice" && typedSlots) promptRuns.push(hint(d, t("docx.chooseOrWrite")));
    out.push({ para: { spacing: { before: pageBreak ? 0 : 360, after: 120 }, pageBreakBefore: pageBreak, children: promptRuns } });

    const qImage = await imageRun(d, ctx, item, "q", q.image);
    if (qImage) out.push({ para: { indent: { left: 360 }, spacing: { after: 120 }, children: [qImage] } });

    switch (type) {
        case "multiple-choice":
            out.push(...await choiceBlocks(d, ctx, item));
            break;
        case "true-false":
            out.push({ para: { indent: { left: 360 }, children: [new d.TextRun({ text: `☐  ${t("docx.true")}          ☐  ${t("docx.false")}` })] } });
            break;
        case "numeric":
            out.push({ para: { indent: { left: 360 }, spacing: { before: 200 }, children: [new d.TextRun({ text: `${t("docx.answer")}: ______________________` })] } });
            break;
        case "text":
            for (let i = 0; i < (q.isLongAnswer ? 6 : 2); i++) out.push(writingLine(d));
            break;
        case "image-upload":
            out.push({ para: { indent: { left: 360 }, spacing: { before: 120 }, children: [new d.TextRun({ text: `${t("docx.solution")}:`, italics: true })] } });
            for (let i = 0; i < 6; i++) out.push(writingLine(d));
            break;
        default:
            break;
    }
    // Blank writing space of an exact height ("to the end of the page" is a page break before the next question)
    if (SPACE_HEIGHTS[space]) {
        out.push({ para: { spacing: { before: 0, after: 0, line: SPACE_HEIGHTS[space] * TWIPS_PER_PX, lineRule: d.LineRuleType.EXACT }, children: [] } });
    }
    // Keep each question together: Word then moves it to the next page instead of splitting it
    return out.map((spec, i) => spec.block || new d.Paragraph({ ...spec.para, keepNext: i < out.length - 1 }));
}

function answerKeyParagraph(d, item) {
    const { q, number } = item;
    const type = q.type || "multiple-choice";
    const runs = [new d.TextRun({ text: `${number}. `, bold: true })];
    const sep = () => runs.push(new d.TextRun({ text: ";  " }));
    switch (type) {
        case "multiple-choice": {
            const correct = (q.choices || []).map((c, i) => ({ c, i })).filter(({ c }) => c.isCorrect);
            correct.forEach(({ c, i }, n) => {
                if (n) sep();
                runs.push(new d.TextRun({ text: `${String.fromCharCode(65 + i)}) ` }));
                if (c.kind === "write") runs.push(new d.TextRun({ text: (c.accepted || []).join(" / ") }));
                else if (c.kind === "number") runs.push(new d.TextRun({ text: `${c.number}${c.tolerance ? ` ± ${c.tolerance}` : ""}` }));
                else runs.push(...richRuns(d, c.text || ""));
            });
            break;
        }
        case "true-false":
            runs.push(new d.TextRun({ text: q.isTrue ? t("docx.true") : t("docx.false") }));
            break;
        case "numeric": {
            const tol = q.toleranceValue ? ` ± ${q.toleranceValue}${q.toleranceType === "percentage" ? " %" : ""}` : "";
            runs.push(new d.TextRun({ text: `${q.correctAnswerNumber ?? "—"}${tol}` }));
            break;
        }
        case "fill-blank":
            runs.push(new d.TextRun({ text: (q.blankAnswers || []).join(";  ") || "—" }));
            break;
        case "text":
            runs.push(new d.TextRun({ text: t("docx.teacherReview"), italics: true }));
            if ((q.expectedKeywords || []).length) runs.push(new d.TextRun({ text: ` (${t("docx.keywords")}: ${q.expectedKeywords.join(", ")})` }));
            break;
        default:
            runs.push(new d.TextRun({ text: t("docx.teacherReview"), italics: true }));
    }
    return new d.Paragraph({ spacing: { after: 100 }, children: runs });
}

function safeFileName(title, withAnswers) {
    const base = (title || "Testas").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "Testas";
    return `${base}${withAnswers ? ` (${t("docx.answers").toLowerCase()})` : ""}.docx`;
}

/**
 * Builds and downloads a .docx of the quiz using its print layout (order, image sizes,
 * page breaks, writing space, margins, option columns, header line and answer key).
 * @param {{ imageSizes?: Map<string, {width:number,height:number}> }} [options]
 *        sizes the print preview showed, keyed "questionId|imageKey"
 */
export async function exportQuizToDocx(quiz, { imageSizes } = {}) {
    const d = await loadDocx();
    const layout = resolvePrintLayout(quiz);
    const ctx = { geometry: layout.geometry, imageSizes };
    const margin = { x: layout.geometry.marginX * TWIPS_PER_PX, y: layout.geometry.marginY * TWIPS_PER_PX };
    const children = [
        new d.Paragraph({ heading: d.HeadingLevel.TITLE, spacing: { after: 200 }, children: [new d.TextRun({ text: quiz.title || "" })] })
    ];
    if (layout.header) {
        children.push(new d.Paragraph({
            spacing: { after: 240 },
            children: [new d.TextRun({ text: `${t("docx.name")}: __________________________   ${t("docx.class")}: ______   ${t("docx.date")}: ____________`, color: "444444" })]
        }));
    }
    for (const item of layout.items) {
        children.push(...await questionBlocks(d, ctx, item));
    }
    if (layout.answerKey) {
        children.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, pageBreakBefore: true, spacing: { after: 200 }, children: [new d.TextRun({ text: `${t("docx.answers")}: ${quiz.title || ""}` })] }));
        layout.items.forEach(item => children.push(answerKeyParagraph(d, item)));
    }

    const doc = new d.Document({
        creator: "spresk.eu",
        title: quiz.title || "",
        styles: { default: { document: { run: { font: "Calibri", size: 24 } } } },
        sections: [{ properties: { page: { margin: { top: margin.y, bottom: margin.y, left: margin.x, right: margin.x } } }, children }]
    });
    const blob = await d.Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFileName(quiz.title, layout.answerKey);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
