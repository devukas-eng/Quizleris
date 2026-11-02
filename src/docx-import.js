// Word import: reads a .docx in the browser (no library) and turns it into quiz questions.
//
// Understands files exported by this app (options, typed-answer slots, true/false, numeric,
// written answers and the answer key) and ordinary teacher documents:
//   1. Question text            (typed numbers or Word's automatic numbering)
//   A) option   B) option       (typed letters, lettered or bulleted lists, ○ ☐ markers)
// Correct options can be marked with *, ☑/✓/●, bold, underline or highlight, or come from an
// answer key section ("Atsakymai" / "Answers": "1. B; C"). Word equations become LaTeX and
// pictures are kept.

const NS = {
    w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    v: "urn:schemas-microsoft-com:vml",
    rel: "http://schemas.openxmlformats.org/package/2006/relationships"
};

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
async function readLines(zip) {
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
        if (!type) return null; // EMF/WMF and other Office-only formats can't be shown in a browser
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
                    const bold = isOn(childEl(rPr, "w", "b"));
                    const underline = isOn(childEl(rPr, "w", "u"));
                    const shd = attr(childEl(rPr, "w", "shd"), "w", "fill");
                    const highlight = isOn(childEl(rPr, "w", "highlight")) || (!!shd && !/^(auto|FFFFFF)$/i.test(shd));
                    for (const c of el.children) {
                        if (isEl(c, "w", "t")) {
                            line.text += c.textContent;
                            const visible = c.textContent.replace(/\s/g, "").length;
                            chars += visible;
                            if (bold) boldChars += visible;
                            if (underline) underlineChars += visible;
                            if (highlight) highlightChars += visible;
                        } else if (isEl(c, "w", "tab")) line.text += " ";
                        else if (isEl(c, "w", "br") || isEl(c, "w", "cr")) line.text += "\n";
                        else if (isEl(c, "w", "drawing") || isEl(c, "w", "pict") || isEl(c, "w", "object")) {
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
        line.text = line.text.replace(/[ \u00A0]+/g, " ").trim();
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

// --- Lines -> questions ---

const CORRECT_MARKERS = "☑☒✓✔●◉■◼✗✘";
const OPTION_MARKERS = `○◯☐□◻•▪–-${CORRECT_MARKERS}`;
const OPTION_RE = new RegExp(`^([${OPTION_MARKERS}*]\\s*)?([A-Ha-h])\\s?[.)]\\s*([\\s\\S]*)$`);
const QUESTION_RE = /^(?:(\d{1,3})\s*[.)]|(?:Q|Klausimas|Question)\s*\d*\s*[:.)])\s*([\s\S]*)$/i;
const BLANK_RE = /_{3,}/;
const KEY_HEADING_RE = /^(atsakymai|atsakym[uų] lapas|answers|answer key|teisingi atsakymai)\b/i;
const HEADER_RE = /(vardas|pavard|name|klas[eė]|class|data|date)[^_]*_{3,}/i;
const HINTS = ["(pažymėkite visus teisingus)", "(pasirinkite arba įrašykite)", "(tick every correct answer)", "(choose or write your own)"];
const TRUE_WORDS = ["taip", "tiesa", "teisinga", "true", "yes"];
const FALSE_WORDS = ["ne", "netiesa", "neteisinga", "false", "no"];

const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

function lineKind(line) {
    const text = line.text;
    if (line.list) {
        const letter = /letter|roman/i.test(line.list.fmt);
        const bullet = line.list.fmt === "bullet";
        if (line.list.level > 0 || letter || bullet) return { kind: "option", text, marker: "" };
        return { kind: "question", text };
    }
    const q = QUESTION_RE.exec(text);
    if (q) return { kind: "question", text: q[2].trim(), number: q[1] ? Number(q[1]) : null };
    const o = OPTION_RE.exec(text);
    if (o) return { kind: "option", text: o[3].trim(), marker: (o[1] || "").trim(), letter: o[2].toLowerCase() };
    return { kind: "text", text };
}

/** Builds questions from the lines; returns { title, questions, unmarked }. */
async function linesToQuiz(lines, resizeImage) {
    const toDataUrl = async (blob, key) => {
        try {
            return await resizeImage(blob, key);
        } catch {
            return null; // a picture the browser can't decode is skipped
        }
    };
    let title = "";
    const drafts = [];
    let current = null;
    let inKey = false;
    let listNumber = 0; // Word's automatic numbering of question list items
    const keyLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!title && !drafts.length && /^(Title|Antrašt|Pavadinimas)/i.test(line.styleId) && line.text) {
            title = line.text;
            continue;
        }
        const beforeColon = line.text.replace(/:[\s\S]*$/, "").trim();
        if (KEY_HEADING_RE.test(beforeColon) && beforeColon.length < 30) {
            inKey = true;
            continue;
        }
        if (inKey) {
            if (line.text) keyLines.push(line.text);
            continue;
        }
        if (HEADER_RE.test(line.text) && !current) continue;

        const info = lineKind(line);
        // "A. …" after options that already reached B, C… is not the next option but new text
        if (info.kind === "option" && info.letter && current?.options.length &&
            info.letter.charCodeAt(0) - 97 !== current.options.length) {
            info.kind = "question";
            info.text = line.text;
        }
        if (info.kind === "question") {
            // The question's own number, so "6. Vilnius" in the answer key finds question 6
            const number = info.number ?? (line.list ? ++listNumber : null);
            current = { prompt: info.text, number, images: [], options: [], extra: [], writingLines: 0, line };
            drafts.push(current);
            for (const img of line.images) current.images.push(img);
            continue;
        }
        if (!current) {
            // Text before the first question: the title if none was styled as one
            if (!title && line.text && !drafts.length && line.text.length < 120) title = line.text;
            continue;
        }
        if (info.kind === "option") {
            current.options.push({ text: info.text, marker: info.marker, line, images: [...line.images] });
            continue;
        }
        if (!line.text && line.images.length) {
            (current.options.length ? current.options[current.options.length - 1].images : current.images).push(...line.images);
            continue;
        }
        if (!line.text) {
            if (line.writingLine) current.writingLines++;
            continue;
        }
        if (current.options.length) {
            const last = current.options[current.options.length - 1];
            last.text += `\n${line.text}`;
        } else {
            current.extra.push(line.text);
        }
    }

    const key = parseAnswerKey(keyLines);
    const numbered = drafts.some(d => d.number != null);
    const questions = [];
    let unmarked = 0;
    for (let n = 0; n < drafts.length; n++) {
        const d = drafts[n];
        // Unnumbered questions ("Q: …") count by position; stray unnumbered text in a numbered test gets no key
        const answer = numbered ? (d.number != null ? key.get(d.number) : undefined) : key.get(n + 1);
        let prompt = [d.prompt, ...d.extra.filter(x => !isTypeLine(x))].join("\n");
        let multi = false;
        for (const hint of HINTS) {
            if (prompt.includes(hint)) {
                prompt = prompt.replace(hint, "").trim();
                if (hint.includes("visus") || hint.includes("every")) multi = true;
            }
        }
        const q = { id: newId("q"), prompt };
        const image = d.images[0] && await toDataUrl(d.images[0], "q");
        if (image) q.image = image;
        const tf = trueFalseLine(d.extra) ?? trueFalseOptions(d.options);

        if (tf) {
            q.type = "true-false";
            const marked = tf.marked;
            const fromKey = answer ? parseTrueFalse(answer) : null;
            q.isTrue = fromKey ?? marked ?? true;
            if (fromKey == null && marked == null) unmarked++;
        } else if (d.options.length >= 1) {
            q.type = "multiple-choice";
            const choices = [];
            for (let c = 0; c < d.options.length; c++) {
                const opt = d.options[c];
                const id = String.fromCharCode(97 + c);
                const typed = !opt.text.replace(/_{3,}/g, "").trim() && BLANK_RE.test(opt.text);
                const choice = typed ? { id, kind: "write", accepted: [], isCorrect: false } : { id, text: opt.text, isCorrect: false };
                if (!typed && opt.images[0]) {
                    const img = await toDataUrl(opt.images[0], "option");
                    if (img) choice.image = img;
                }
                choices.push(choice);
            }
            markCorrect(choices, d.options, answer);
            if (!choices.some(c => c.isCorrect)) unmarked++;
            const correct = choices.filter(c => c.isCorrect).length;
            q.allowMultipleAnswers = multi || correct > 1 || d.options.some(o => /[☐□◻]/.test(o.marker));
            q.choices = choices;
        } else if (d.extra.some(x => /^(sprendimas|solution)\s*:?$/i.test(x.trim()))) {
            q.type = "image-upload";
        } else if (/(atsakymas|answer)\s*:?\s*_{3,}/i.test(d.extra.join(" "))) {
            q.type = "numeric";
            const num = answer && parseNumberAnswer(answer);
            q.correctAnswerNumber = num ? num.value : NaN;
            q.toleranceValue = num ? num.tolerance : 0;
            q.toleranceType = "absolute";
            if (!num) unmarked++;
        } else if (BLANK_RE.test(prompt)) {
            q.type = "fill-blank";
            q.prompt = prompt.replace(/_{3,}/g, "___"); // the editor's blank marker
            q.blankAnswers = answer ? answer.split(/\s*;\s*/).filter(Boolean) : [];
            if (!answer) unmarked++;
        } else {
            q.type = "text";
            q.isLongAnswer = d.writingLines > 3;
            q.expectedKeywords = [];
        }
        questions.push(q);
    }
    return { title, questions, unmarked };
}

// Lines our export adds under a question that describe its type rather than its text
function isTypeLine(text) {
    return /^(atsakymas|answer|sprendimas|solution)\s*:?\s*_*$/i.test(text.trim()) || trueFalseLine([text]) != null;
}

function trueFalseLine(texts) {
    for (const text of texts) {
        const words = text.toLowerCase().replace(/[○◯☐□◻☑☒✓✔●◉■◼*]/g, " ").split(/[\s/|,]+/).filter(Boolean);
        const hasTrue = words.some(w => TRUE_WORDS.includes(w));
        const hasFalse = words.some(w => FALSE_WORDS.includes(w));
        if (hasTrue && hasFalse && words.length <= 4) {
            // ☑ Taip ☐ Ne: the checked box tells the answer
            const m = new RegExp(`[${CORRECT_MARKERS}]\\s*(\\S+)`).exec(text);
            return { marked: m ? TRUE_WORDS.includes(m[1].toLowerCase()) : null };
        }
    }
    return null;
}

function trueFalseOptions(options) {
    if (options.length !== 2) return null;
    const words = options.map(o => o.text.toLowerCase().replace(/[.!]$/, ""));
    const t = words.findIndex(w => TRUE_WORDS.includes(w));
    const f = words.findIndex(w => FALSE_WORDS.includes(w));
    if (t < 0 || f < 0) return null;
    const marked = options.map(isMarked);
    return { marked: marked[t] && !marked[f] ? true : marked[f] && !marked[t] ? false : null };
}

const isMarked = (opt) => /^\*|\*$/.test(opt.text) || (!!opt.marker && (opt.marker === "*" || CORRECT_MARKERS.includes(opt.marker)));

function markCorrect(choices, options, answer) {
    options.forEach((opt, i) => {
        if (/^\*\s*|\s*\*$/.test(opt.text) && choices[i].text !== undefined) choices[i].text = choices[i].text.replace(/^\*\s*|\s*\*$/g, "");
    });
    if (answer) {
        // "B, D" / "B; D", or "B) text; D) text", or "C) ats1 / ats2" for a typed slot
        const lettersOnly = /^[A-Ha-h](?:\s*[,;]\s*[A-Ha-h]|\s+[A-Ha-h])*\.?$/.test(answer.trim());
        const parts = lettersOnly ? answer.match(/[A-Ha-h]/g) : answer.split(/\s*;\s*/);
        for (const part of parts) {
            const m = /^([A-Ha-h])(?:\)|$|\s*[.)]\s*)([\s\S]*)$/.exec(part.trim());
            if (!m) continue;
            const choice = choices[m[1].toLowerCase().charCodeAt(0) - 97];
            if (!choice) continue;
            choice.isCorrect = true;
            if (choice.kind === "write" && m[2].trim()) choice.accepted = m[2].trim().split(/\s*\/\s*/).filter(Boolean);
        }
        // A key that names the answer instead of its letter: "1. Vilnius"
        if (!choices.some(c => c.isCorrect)) {
            const wanted = answer.trim().toLowerCase();
            choices.forEach(c => { if (c.text && c.text.trim().toLowerCase() === wanted) c.isCorrect = true; });
        }
        if (choices.some(c => c.isCorrect)) return;
    }
    const byMarker = options.map(isMarked);
    if (byMarker.some(Boolean)) {
        byMarker.forEach((on, i) => { if (on) choices[i].isCorrect = true; });
        return;
    }
    // Formatting counts only when it singles some options out (not when every option is bold)
    for (const prop of ["highlight", "bold", "underline"]) {
        const flags = options.map(o => !!o.line[prop]);
        if (flags.some(Boolean) && !flags.every(Boolean)) {
            flags.forEach((on, i) => { if (on) choices[i].isCorrect = true; });
            return;
        }
    }
}

function parseAnswerKey(lines) {
    const key = new Map();
    let last = 0;
    for (const text of lines.join("\n").split("\n")) {
        const m = /^\s*(\d{1,3})\s*[.)]\s*(.*)$/.exec(text);
        if (m) {
            last = Number(m[1]);
            key.set(last, m[2].trim());
        } else if (last && text.trim()) {
            key.set(last, `${key.get(last)} ${text.trim()}`.trim());
        }
    }
    return key;
}

function parseTrueFalse(text) {
    const word = text.toLowerCase().replace(/[^a-ząčęėįšųūž]/g, "");
    if (TRUE_WORDS.includes(word)) return true;
    if (FALSE_WORDS.includes(word)) return false;
    return null;
}

function parseNumberAnswer(text) {
    const m = /(-?\d+(?:[.,]\d+)?)\s*(?:±\s*(\d+(?:[.,]\d+)?))?/.exec(text);
    if (!m) return null;
    const num = (s) => parseFloat(String(s).replace(",", "."));
    return { value: num(m[1]), tolerance: m[2] ? num(m[2]) : 0 };
}

/**
 * Reads a .docx file into questions.
 * @param {File|Blob} file
 * @param {{ resizeImage: (blob: Blob, key: "q"|"option") => Promise<string> }} options
 * @returns {Promise<{ title: string, questions: object[], unmarked: number }>}
 */
export async function importQuizFromDocx(file, { resizeImage }) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read .docx files");
    const zip = await openZip(await file.arrayBuffer());
    const lines = await readLines(zip);
    return linesToQuiz(lines, resizeImage);
}

// Exposed for tests
export const _internal = { ommlToLatex, lineKind, parseAnswerKey, linesToQuiz };
