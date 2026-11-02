import { t } from "./lang.js";

// Word import: reads a .docx in the browser (no library) into lines for the shared question
// parser (quiz-import.js). Keeps paragraph text with Word equations turned into LaTeX,
// pictures, automatic numbering, and the formatting that can mark a correct option.
// Old Equation 3.0 / MathType objects can't be read in a browser: they become a visible
// "[formulė]" placeholder and are counted, so the teacher knows what to retype.

const NS = {
    w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    v: "urn:schemas-microsoft-com:vml",
    o: "urn:schemas-microsoft-com:office:office",
    rel: "http://schemas.openxmlformats.org/package/2006/relationships"
};

// Symbol-font characters (Insert → Symbol) teachers use as answer boxes
const SYMBOL_CHARS = {
    wingdings: { "6C": "●", "6E": "■", "6F": "□", "71": "□", "A1": "○", "A8": "☐", "FB": "✗", "FC": "✓", "FD": "☒", "FE": "☑" },
    "wingdings 2": { "50": "✓", "52": "☑", "54": "☒", "A3": "□", "A2": "□", "99": "○", "9A": "●" },
    symbol: { "B7": "•", "D6": "√", "B4": "×", "B1": "±", "A3": "≤", "B3": "≥", "B9": "≠", "BB": "≈", "70": "π" }
};

function symbolChar(sym) {
    const font = (attr(sym, "w", "font") || "").toLowerCase();
    const code = (attr(sym, "w", "char") || "").toUpperCase().replace(/^F0/, "");
    return SYMBOL_CHARS[font]?.[code] ?? "";
}

// --- ZIP (stored or deflated entries, read with the browser's DecompressionStream) ---

async function openZip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("not a .docx file");
    const entries = new Map();
    let ptr = view.getUint32(eocd + 16, true);
    const count = view.getUint16(eocd + 10, true);
    const decoder = new TextDecoder();
    for (let n = 0; n < count && view.getUint32(ptr, true) === 0x02014b50; n++) {
        const nameLen = view.getUint16(ptr + 28, true);
        entries.set(decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen)), {
            method: view.getUint16(ptr + 10, true),
            size: view.getUint32(ptr + 20, true),
            local: view.getUint32(ptr + 42, true)
        });
        ptr += 46 + nameLen + view.getUint16(ptr + 30, true) + view.getUint16(ptr + 32, true);
    }
    const read = async (name) => {
        const entry = entries.get(name);
        if (!entry) return null;
        const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
        const data = bytes.subarray(start, start + entry.size);
        if (entry.method === 0) return data;
        if (entry.method !== 8) throw new Error("unsupported compression in .docx");
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    };
    const readXml = async (name) => {
        const data = await read(name);
        return data ? new DOMParser().parseFromString(decoder.decode(data), "application/xml") : null;
    };
    return { read, readXml };
}

// --- XML helpers ---

const isEl = (node, ns, name) => node?.nodeType === 1 && node.namespaceURI === NS[ns] && node.localName === name;
const childEl = (node, ns, name) => [...(node?.children || [])].find(c => isEl(c, ns, name)) || null;
const childEls = (node, ns, name) => [...(node?.children || [])].filter(c => isEl(c, ns, name));
const attr = (node, ns, name) => node?.getAttributeNS(NS[ns], name) ?? node?.getAttribute(`${ns}:${name}`) ?? null;
const isOn = (node) => !!node && !["0", "false", "none", "off"].includes(attr(node, "w", "val") ?? "");

// --- Word equations (OMML) -> LaTeX ---

const CHAR_TO_LATEX = {
    "×": "\\times ", "·": "\\cdot ", "⋅": "\\cdot ", "÷": "\\div ", "±": "\\pm ", "∓": "\\mp ", "≤": "\\le ", "≥": "\\ge ",
    "≠": "\\ne ", "≈": "\\approx ", "≡": "\\equiv ", "∼": "\\sim ", "∝": "\\propto ", "∞": "\\infty ", "→": "\\to ",
    "←": "\\leftarrow ", "⇒": "\\Rightarrow ", "⇔": "\\Leftrightarrow ", "∈": "\\in ", "∉": "\\notin ", "∪": "\\cup ",
    "∩": "\\cap ", "⊂": "\\subset ", "⊆": "\\subseteq ", "∅": "\\emptyset ", "∠": "\\angle ", "⊥": "\\perp ",
    "∥": "\\parallel ", "△": "\\triangle ", "°": "^\\circ ", "∂": "\\partial ", "∇": "\\nabla ", "∀": "\\forall ",
    "∃": "\\exists ", "⋯": "\\cdots ", "…": "\\ldots ", "′": "'", "−": "-",
    "α": "\\alpha ", "β": "\\beta ", "γ": "\\gamma ", "δ": "\\delta ", "ε": "\\varepsilon ", "ζ": "\\zeta ", "η": "\\eta ",
    "θ": "\\theta ", "ι": "\\iota ", "κ": "\\kappa ", "λ": "\\lambda ", "μ": "\\mu ", "ν": "\\nu ", "ξ": "\\xi ", "π": "\\pi ",
    "ρ": "\\rho ", "σ": "\\sigma ", "τ": "\\tau ", "υ": "\\upsilon ", "φ": "\\varphi ", "χ": "\\chi ", "ψ": "\\psi ",
    "ω": "\\omega ", "Γ": "\\Gamma ", "Δ": "\\Delta ", "Θ": "\\Theta ", "Λ": "\\Lambda ", "Ξ": "\\Xi ", "Π": "\\Pi ",
    "Σ": "\\Sigma ", "Φ": "\\Phi ", "Ψ": "\\Psi ", "Ω": "\\Omega "
};
const NARY = { "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∬": "\\iint", "∮": "\\oint", "⋃": "\\bigcup", "⋂": "\\bigcap" };
const ACCENT = { "⃗": "\\vec", "̂": "\\hat", "̅": "\\overline", "̄": "\\bar", "̇": "\\dot", "̈": "\\ddot", "̃": "\\tilde" };
const FUNCTION_NAMES = new Set(["sin", "cos", "tan", "tg", "ctg", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "log", "ln", "lg", "exp", "max", "min", "det", "gcd", "lim"]);

const group = (latex) => (latex.length === 1 ? latex : `{${latex}}`);

function mathText(text) {
    const chars = [...text];
    let out = "";
    for (let i = 0; i < chars.length; i++) {
        const accent = ACCENT[chars[i + 1]];
        if (accent) {
            // "A⃗B⃗" (how the Word export writes \vec{AB}) -> \vec{AB}
            let base = "";
            while (i < chars.length && ACCENT[chars[i + 1]] === accent) { base += chars[i]; i += 2; }
            i--;
            out += `${accent}{${base}}`;
            continue;
        }
        const ch = chars[i];
        out += CHAR_TO_LATEX[ch] ?? (ch === "{" || ch === "}" ? `\\${ch}` : ch);
    }
    return out;
}

const FENCES = { "{": "\\{", "}": "\\}", "⟨": "\\langle", "⟩": "\\rangle", "‖": "\\|", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil" };
const fence = (ch) => (!ch ? "." : FENCES[ch] || ch);

function ommlToLatex(node) {
    let out = "";
    for (const el of node.children) out += ommlElement(el);
    return out.replace(/\s+/g, " ").replace(/ ([}^_)])/g, "$1").trim();
}

function ommlElement(el) {
    if (el.namespaceURI !== NS.m) {
        // Word runs inside an equation (rare) still carry their text
        return el.namespaceURI === NS.w && el.localName === "r" ? mathText(el.textContent) : "";
    }
    const part = (name) => {
        const child = childEl(el, "m", name);
        return child ? ommlToLatex(child) : "";
    };
    const prop = (prName, name) => attr(childEl(childEl(el, "m", prName), "m", name), "m", "val");
    switch (el.localName) {
        case "r": {
            const text = childEls(el, "m", "t").map(t => t.textContent).join("");
            return FUNCTION_NAMES.has(text) ? `\\${text} ` : mathText(text);
        }
        case "f": {
            const type = prop("fPr", "type");
            if (type === "lin") return `${group(part("num"))}/${group(part("den"))}`;
            if (type === "noBar") return `\\binom{${part("num")}}{${part("den")}}`;
            return `\\frac{${part("num")}}{${part("den")}}`;
        }
        case "sSup": return `${group(part("e"))}^${group(part("sup"))}`;
        case "sSub": return `${group(part("e"))}_${group(part("sub"))}`;
        case "sSubSup": return `${group(part("e"))}_${group(part("sub"))}^${group(part("sup"))}`;
        case "sPre": return `{}_${group(part("sub"))}^${group(part("sup"))}${part("e")}`;
        case "rad": {
            const degree = part("deg");
            return degree ? `\\sqrt[${degree}]{${part("e")}}` : `\\sqrt{${part("e")}}`;
        }
        case "nary": {
            const chr = prop("naryPr", "chr") || "∫";
            const sub = part("sub");
            const sup = part("sup");
            return `${NARY[chr] || mathText(chr)}${sub ? `_${group(sub)}` : ""}${sup ? `^${group(sup)}` : ""} ${part("e")}`;
        }
        case "d": {
            const pr = childEl(el, "m", "dPr");
            const beg = attr(childEl(pr, "m", "begChr"), "m", "val") ?? "(";
            const end = attr(childEl(pr, "m", "endChr"), "m", "val") ?? ")";
            const sep = attr(childEl(pr, "m", "sepChr"), "m", "val") ?? "|";
            const items = childEls(el, "m", "e").map(ommlToLatex).join(` ${mathText(sep)} `);
            // Plain brackets unless the content is tall
            if (!/\\(frac|sum|int|prod|sqrt|begin|binom)/.test(items)) return `${fence(beg).replace(".", "")}${items}${fence(end).replace(".", "")}`;
            return `\\left${fence(beg)} ${items} \\right${fence(end)}`;
        }
        case "func": return `${part("fName")} ${part("e")}`;
        case "fName": return ommlToLatex(el);
        case "limLow": {
            const base = part("e");
            return `${base.startsWith("\\") ? base : `\\operatorname{${base}}`}_${group(part("lim"))} `;
        }
        case "limUpp": return `\\overset{${part("lim")}}{${part("e")}}`;
        case "acc": {
            const chr = prop("accPr", "chr") || "̂";
            return `${ACCENT[chr] || "\\hat"}{${part("e")}}`;
        }
        case "bar": return prop("barPr", "pos") === "bot" ? `\\underline{${part("e")}}` : `\\overline{${part("e")}}`;
        case "groupChr": return part("e");
        case "box":
        case "borderBox":
        case "phant": return part("e");
        case "eqArr": return childEls(el, "m", "e").map(ommlToLatex).join(" \\\\ ");
        case "m": {
            const rows = childEls(el, "m", "mr").map(mr => childEls(mr, "m", "e").map(ommlToLatex).join(" & "));
            return `\\begin{matrix} ${rows.join(" \\\\ ")} \\end{matrix}`;
        }
        case "e":
        case "num":
        case "den":
        case "sub":
        case "sup":
        case "deg":
        case "lim":
        case "oMath": return ommlToLatex(el);
        default: return el.localName.endsWith("Pr") ? "" : ommlToLatex(el);
    }
}

// --- Reading paragraphs ---

const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };

/**
 * Reads the document into a flat list of lines (paragraphs, table cells in reading order):
 * { text, images: [Blob], styleId, list: { fmt, level } | null, bold, underline, highlight, writingLine }
 */
async function readLines(zip, warnings) {
    const doc = await zip.readXml("word/document.xml");
    if (!doc) throw new Error("not a Word document");
    const rels = new Map();
    const relDoc = await zip.readXml("word/_rels/document.xml.rels");
    relDoc?.querySelectorAll("Relationship").forEach(r => rels.set(r.getAttribute("Id"), r.getAttribute("Target")));
    const numbering = await readNumbering(zip);

    const imageFor = async (relId) => {
        const target = rels.get(relId);
        if (!target || /^https?:/i.test(target)) return null;
        const path = target.startsWith("/") ? target.slice(1) : `word/${target.replace(/^\.\//, "")}`;
        const type = IMAGE_TYPES[path.split(".").pop().toLowerCase()];
        if (!type) {
            warnings.skippedImages++; // EMF/WMF/TIFF can't be shown in a browser
            return null;
        }
        const data = await zip.read(path);
        return data ? new Blob([data], { type }) : null;
    };

    const lines = [];
    const readParagraph = async (p) => {
        const line = { text: "", images: [], styleId: "", list: null, writingLine: false };
        const pPr = childEl(p, "w", "pPr");
        line.styleId = attr(childEl(pPr, "w", "pStyle"), "w", "val") || "";
        const numPr = childEl(pPr, "w", "numPr");
        if (numPr) {
            const numId = attr(childEl(numPr, "w", "numId"), "w", "val");
            const level = Number(attr(childEl(numPr, "w", "ilvl"), "w", "val") || 0);
            if (numId && numId !== "0") line.list = { fmt: numbering(numId, level), level };
        }
        line.writingLine = !!childEl(childEl(pPr, "w", "pBdr"), "w", "bottom");
        // Formatting of the visible characters, to spot options marked as correct by formatting
        let chars = 0, boldChars = 0, underlineChars = 0, highlightChars = 0;
        const walk = async (node) => {
            for (const el of node.children) {
                if (isEl(el, "w", "r")) {
                    const rPr = childEl(el, "w", "rPr");
                    const charStyle = attr(childEl(rPr, "w", "rStyle"), "w", "val") || "";
                    const bold = isOn(childEl(rPr, "w", "b")) || /strong|bold|paryškint/i.test(charStyle);
                    const underline = isOn(childEl(rPr, "w", "u"));
                    const shd = attr(childEl(rPr, "w", "shd"), "w", "fill");
                    const highlight = isOn(childEl(rPr, "w", "highlight")) || (!!shd && !/^(auto|FFFFFF)$/i.test(shd));
                    const addText = (text) => {
                        line.text += text;
                        const visible = text.replace(/\s/g, "").length;
                        chars += visible;
                        if (bold) boldChars += visible;
                        if (underline) underlineChars += visible;
                        if (highlight) highlightChars += visible;
                    };
                    for (const c of el.children) {
                        if (isEl(c, "w", "t")) addText(c.textContent);
                        else if (isEl(c, "w", "sym")) addText(symbolChar(c));
                        else if (isEl(c, "w", "tab")) line.text += "\t"; // kept so "A)⇥B)⇥C)" splits into options
                        else if (isEl(c, "w", "br") || isEl(c, "w", "cr")) line.text += "\n";
                        else if (isEl(c, "w", "object") && [...c.getElementsByTagNameNS(NS.o, "OLEObject")]
                            .some(ole => /equation|mathtype|dsmt/i.test(ole.getAttribute("ProgID") || ""))) {
                            // Old Equation 3.0 / MathType formula: only a WMF picture of it is stored
                            warnings.skippedEquations++;
                            line.text += ` ${t("import.formulaPlaceholder")} `;
                        } else if (isEl(c, "w", "drawing") || isEl(c, "w", "pict") || isEl(c, "w", "object")) {
                            for (const blip of c.getElementsByTagNameNS(NS.a, "blip")) {
                                const img = await imageFor(attr(blip, "r", "embed"));
                                if (img) line.images.push(img);
                            }
                            for (const vimg of c.getElementsByTagNameNS(NS.v, "imagedata")) {
                                const img = await imageFor(attr(vimg, "r", "id"));
                                if (img) line.images.push(img);
                            }
                        }
                    }
                } else if (isEl(el, "m", "oMathPara")) {
                    const math = childEls(el, "m", "oMath").map(ommlToLatex).filter(Boolean).join(" \\\\ ");
                    if (math) line.text += `\\[${math}\\]`;
                } else if (isEl(el, "m", "oMath")) {
                    const math = ommlToLatex(el);
                    if (math) line.text += `\\(${math}\\)`;
                } else if (isEl(el, "w", "del") || isEl(el, "w", "pPr")) {
                    // deleted text (tracked changes) and paragraph settings
                } else {
                    await walk(el); // hyperlinks, insertions, content controls, fields…
                }
            }
        };
        await walk(p);
        line.text = line.text.replace(/[ \u00A0]+/g, " ").replace(/^[ \t]+|[ \t]+$/g, "");
        line.bold = chars > 0 && boldChars === chars;
        line.underline = chars > 0 && underlineChars === chars;
        line.highlight = chars > 0 && highlightChars === chars;
        lines.push(line);
    };
    const readBlock = async (node) => {
        for (const el of node.children) {
            if (isEl(el, "w", "p")) await readParagraph(el);
            else if (isEl(el, "w", "tbl")) {
                for (const tr of childEls(el, "w", "tr")) {
                    for (const tc of childEls(tr, "w", "tc")) await readBlock(tc);
                }
            } else if (isEl(el, "w", "sdt")) await readBlock(childEl(el, "w", "sdtContent") || el);
        }
    };
    await readBlock(childEl(doc.documentElement, "w", "body"));
    return lines;
}

// Word's automatic numbering: numId + level -> "decimal", "upperLetter", "bullet"…
async function readNumbering(zip) {
    const doc = await zip.readXml("word/numbering.xml");
    if (!doc) return () => "decimal";
    const abstract = new Map();
    for (const an of doc.getElementsByTagNameNS(NS.w, "abstractNum")) {
        const levels = new Map();
        for (const lvl of childEls(an, "w", "lvl")) {
            levels.set(Number(attr(lvl, "w", "ilvl") || 0), attr(childEl(lvl, "w", "numFmt"), "w", "val") || "decimal");
        }
        abstract.set(attr(an, "w", "abstractNumId"), levels);
    }
    const nums = new Map();
    for (const num of doc.getElementsByTagNameNS(NS.w, "num")) {
        nums.set(attr(num, "w", "numId"), attr(childEl(num, "w", "abstractNumId"), "w", "val"));
    }
    return (numId, level) => abstract.get(nums.get(numId))?.get(level) || "decimal";
}

// --- Entry point ---

/**
 * Reads a .docx file into lines for linesToQuiz (quiz-import.js).
 * @returns {Promise<{ lines: object[], warnings: { skippedEquations: number, skippedImages: number } }>}
 */
export async function readDocx(file) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read .docx files");
    const zip = await openZip(await file.arrayBuffer());
    const warnings = { skippedEquations: 0, skippedImages: 0 };
    const lines = await readLines(zip, warnings);
    return { lines, warnings };
}

// Exposed for tests
export const _internal = { ommlToLatex };