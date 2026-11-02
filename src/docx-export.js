import { t } from "./lang.js";
import { parseRichValue } from "./rich-input.js";
import { isTypedSlot } from "./state.js";

// Word export: a printable sheet for students, optionally followed by an answer key.
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
    ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼", infty: "∞", to: "→", rightarrow: "→",
    leftarrow: "←", Rightarrow: "⇒", Leftrightarrow: "⇔", in: "∈", notin: "∉", cup: "∪", cap: "∩",
    subset: "⊂", subseteq: "⊆", emptyset: "∅", varnothing: "∅", angle: "∠", perp: "⊥", parallel: "∥",
    triangle: "△", circ: "°", degree: "°", sum: "∑", prod: "∏", int: "∫", partial: "∂", nabla: "∇",
    forall: "∀", exists: "∃", cdots: "⋯", ldots: "…", dots: "…", prime: "′",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
    theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ",
    sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
    ",": " ", ";": " ", ":": " ", " ": " ", quad: "  ", qquad: "    ", "!": "",
    "%": "%", "{": "{", "}": "}", "$": "$", "&": "&", "#": "#", "_": "_", "\\": " "
};
const FUNCTIONS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
    "log", "ln", "lg", "exp", "lim", "max", "min", "det", "gcd", "deg"]);
const TEXT_COMMANDS = new Set(["text", "mathrm", "textrm", "textbf", "mathbf", "operatorname", "mbox", "textit", "mathit"]);
const IGNORED = new Set(["left", "right", "displaystyle", "limits", "big", "Big", "bigg", "Bigg"]);

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
    const plainArg = () => {
        // Text commands: keep the raw characters of the argument
        if (tokens[pos]?.ch !== "{") return [{ text: tokens[pos++]?.ch || "" }];
        pos++;
        let depth = 1, text = "";
        while (pos < tokens.length) {
            const tok = tokens[pos++];
            if (tok.ch === "{") depth++;
            if (tok.ch === "}" && --depth === 0) break;
            text += tok.ch ?? (SYMBOLS[tok.cmd] ?? tok.cmd);
        }
        return [{ text }];
    };
    const parseAtom = () => {
        const tok = tokens[pos++];
        if (!tok) return [];
        if (tok.ch === "{") return parseGroup();
        if (tok.ch !== undefined) return [{ text: tok.ch }];
        const cmd = tok.cmd;
        if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") {
            const numerator = parseArg();
            const denominator = parseArg();
            return [new d.MathFraction({ numerator: build(numerator), denominator: build(denominator) })];
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
        if (TEXT_COMMANDS.has(cmd)) return plainArg();
        if (IGNORED.has(cmd)) return [];
        if (FUNCTIONS.has(cmd)) return [{ text: cmd + " " }];
        if (cmd in SYMBOLS) return [{ text: SYMBOLS[cmd] }];
        return [{ text: cmd }];
    };
    function parseSequence(inGroup) {
        const items = [];
        while (pos < tokens.length) {
            const tok = tokens[pos];
            if (inGroup && tok.ch === "}") break;
            if (tok.ch === "^" || tok.ch === "_") {
                pos++;
                const base = items.length ? [items.pop()] : [{ text: "" }];
                let sup = null, sub = null;
                if (tok.ch === "^") sup = parseArg(); else sub = parseArg();
                // x_1^2 / x^2_1
                const next = tokens[pos]?.ch;
                if ((next === "^" && !sup) || (next === "_" && !sub)) {
                    pos++;
                    if (next === "^") sup = parseArg(); else sub = parseArg();
                }
                if (sup && sub) items.push(new d.MathSubSuperScript({ children: build(base), subScript: build(sub), superScript: build(sup) }));
                else if (sup) items.push(new d.MathSuperScript({ children: build(base), superScript: build(sup) }));
                else items.push(new d.MathSubScript({ children: build(base), subScript: build(sub) }));
                continue;
            }
            items.push(...parseAtom());
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
            try {
                runs.push(new d.Math({ children: latexToMathChildren(d, part.latex) }));
            } catch {
                runs.push(new d.TextRun({ text: part.latex, bold }));
            }
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

// Embedded data-URL image, scaled to fit; null for anything that is not a data URL
async function imageRun(d, src, maxWidth, maxHeight) {
    if (!src) return null;
    const dataUrl = src.startsWith("data:") ? src : (src.includes(":") ? null : `data:image/jpeg;base64,${src}`);
    if (!dataUrl) return null;
    const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(dataUrl);
    if (!m) return null;
    const size = await new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
    if (!size || !size.w || !size.h) return null;
    const scale = Math.min(1, maxWidth / size.w, maxHeight / size.h);
    const type = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
    return new d.ImageRun({
        type,
        data: base64ToBytes(m[2]),
        transformation: { width: Math.round(size.w * scale), height: Math.round(size.h * scale) }
    });
}

const writingLine = (d) => new d.Paragraph({
    spacing: { before: 320 },
    indent: { left: 360 },
    border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
    children: []
});

const hint = (d, text) => new d.TextRun({ text: `  ${text}`, italics: true, color: "777777", size: 20 });

async function questionParagraphs(d, q, index) {
    const out = [];
    const type = q.type || "multiple-choice";
    const choices = q.choices || [];
    const typedSlots = choices.some(isTypedSlot);

    const promptRuns = [new d.TextRun({ text: `${index + 1}. `, bold: true }), ...richRuns(d, q.prompt || "", { bold: true, blanks: type === "fill-blank" })];
    if (type === "multiple-choice" && q.allowMultipleAnswers) promptRuns.push(hint(d, t("docx.selectAll")));
    else if (type === "multiple-choice" && typedSlots) promptRuns.push(hint(d, t("docx.chooseOrWrite")));
    out.push(new d.Paragraph({ spacing: { before: 360, after: 120 }, keepNext: true, children: promptRuns }));

    const qImage = await imageRun(d, q.image, 420, 260);
    if (qImage) out.push(new d.Paragraph({ indent: { left: 360 }, spacing: { after: 120 }, children: [qImage] }));

    switch (type) {
        case "multiple-choice": {
            const marker = q.allowMultipleAnswers ? "☐" : "○";
            for (let i = 0; i < choices.length; i++) {
                const c = choices[i];
                const runs = [new d.TextRun({ text: `${marker}  ${String.fromCharCode(65 + i)})  ` })];
                if (isTypedSlot(c)) {
                    runs.push(new d.TextRun({ text: "______________________________" }));
                } else {
                    runs.push(...richRuns(d, c.text || ""));
                    const cImage = await imageRun(d, c.image, 200, 120);
                    if (cImage) runs.push(new d.TextRun({ text: "  " }), cImage);
                }
                out.push(new d.Paragraph({ indent: { left: 360 }, spacing: { after: 80 }, children: runs }));
            }
            break;
        }
        case "true-false":
            out.push(new d.Paragraph({ indent: { left: 360 }, children: [new d.TextRun({ text: `☐  ${t("docx.true")}          ☐  ${t("docx.false")}` })] }));
            break;
        case "numeric":
            out.push(new d.Paragraph({ indent: { left: 360 }, spacing: { before: 200 }, children: [new d.TextRun({ text: `${t("docx.answer")}: ______________________` })] }));
            break;
        case "text":
            for (let i = 0; i < (q.isLongAnswer ? 6 : 2); i++) out.push(writingLine(d));
            break;
        case "image-upload":
            out.push(new d.Paragraph({ indent: { left: 360 }, spacing: { before: 120 }, children: [new d.TextRun({ text: `${t("docx.solution")}:`, italics: true })] }));
            for (let i = 0; i < 6; i++) out.push(writingLine(d));
            break;
        default:
            break;
    }
    return out;
}

function answerKeyParagraph(d, q, index) {
    const type = q.type || "multiple-choice";
    const runs = [new d.TextRun({ text: `${index + 1}. `, bold: true })];
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
 * Builds and downloads a .docx of the quiz.
 * @param {object} quiz
 * @param {{ withAnswers?: boolean }} [options] withAnswers appends an answer key on a new page
 */
export async function exportQuizToDocx(quiz, { withAnswers = false } = {}) {
    const d = await loadDocx();
    const children = [
        new d.Paragraph({ heading: d.HeadingLevel.TITLE, spacing: { after: 200 }, children: [new d.TextRun({ text: quiz.title || "" })] }),
        new d.Paragraph({
            spacing: { after: 240 },
            children: [new d.TextRun({ text: `${t("docx.name")}: ________________________________     ${t("docx.date")}: ______________`, color: "444444" })]
        })
    ];
    const questions = quiz.questions || [];
    for (let i = 0; i < questions.length; i++) {
        children.push(...await questionParagraphs(d, questions[i], i));
    }
    if (withAnswers) {
        children.push(new d.Paragraph({ children: [new d.PageBreak()] }));
        children.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, spacing: { after: 200 }, children: [new d.TextRun({ text: `${t("docx.answers")}: ${quiz.title || ""}` })] }));
        questions.forEach((q, i) => children.push(answerKeyParagraph(d, q, i)));
    }

    const doc = new d.Document({
        creator: "spresk.eu",
        title: quiz.title || "",
        styles: { default: { document: { run: { font: "Calibri", size: 24 } } } },
        sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }]
    });
    const blob = await d.Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFileName(quiz.title, withAnswers);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
