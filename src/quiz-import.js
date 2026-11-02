import { t } from "./lang.js";
import { parseBulkImportText } from "./admin-import.js";

// Turns imported "lines" into quiz questions. Every source uses it: Word (docx-import.js),
// PDF (pdf-import.js) and pasted text. A line is
//   { text, images: [Blob], styleId?, list?: { fmt, level }, bold?, underline?, highlight?,
//     writingLine?, mathy? }
// Understands:
//   1. Question text           (typed numbers, "Klausimas:", "Q:" or Word's automatic numbering)
//   A) option  B) option       (own lines, lettered/bulleted lists, ○ ☐ markers, or several on one line)
//   correct answers            (*, ☑/✓/●, bold, underline, highlight, or an answer key:
//                               "Atsakymai" then "1. B", "1B 2C 3A", "4. Taip", "6. Vilnius")
//   answer lines from our own Word export (true/false, number, written answer, solution photo)

export const CORRECT_MARKERS = "☑☒✓✔●◉■◼✗✘";
// "-" is escaped: unescaped between two characters it would make a character range
const OPTION_MARKERS = `○◯☐□◻•▪\\-–${CORRECT_MARKERS}`;
const OPTION_RE = new RegExp(`^([${OPTION_MARKERS}*]\\s*)?([A-Ha-h])\\s?[.)]\\s*([\\s\\S]*)$`);
const QUESTION_RE = /^(?:(\d{1,3})\s*(?:[.)](?!\d)|(?:klausimas|užduotis|uždavinys)\s*[.:)]?)|(?:Q|Klausimas|Question)\s*\d*\s*[:.)])\s*([\s\S]*)$/i;
const NUMBERED_TEXT_RE = /^\s*\d{1,3}\s*[.)](?!\d)/m;
const BLANK_RE = /_{3,}/;
const ANSWER_BLANK_RE = /\s*(atsakymas|answer)\s*:?\s*_{3,}\s*\.?$/i;
const KEY_HEADING_RE = /^(atsakymai|atsakym[uų] (lapas|raktas)|teisingi atsakymai|answers|answer key)\b/i;
const HEADER_RE = /(vardas|pavard|name|klas[eė]|class|data|date)[^_]*_{3,}/i;
const HINTS = ["(pažymėkite visus teisingus)", "(pasirinkite arba įrašykite)", "(tick every correct answer)", "(choose or write your own)"];
const TRUE_WORDS = ["taip", "tiesa", "teisinga", "teisingas", "true", "yes"];
const FALSE_WORDS = ["ne", "netiesa", "neteisinga", "neteisingas", "false", "no"];

const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// "A) 4   B) 5   C) 6" on one line -> three option lines (only in A, B, C… order)
function splitInlineOptions(line) {
    const first = !line.list && OPTION_RE.exec(line.text);
    if (!first) return [line];
    const cuts = [];
    let code = first[2].toLowerCase().charCodeAt(0);
    for (;;) {
        const next = String.fromCharCode(code + 1);
        const re = new RegExp(`\\s(?=(?:[${OPTION_MARKERS}*]\\s*)?[${next}${next.toUpperCase()}]\\s?[.)]\\s)`, "g");
        re.lastIndex = (cuts[cuts.length - 1] ?? 0) + 2;
        const m = re.exec(line.text);
        if (!m) break;
        cuts.push(m.index);
        code++;
    }
    if (!cuts.length) return [line];
    const bounds = [0, ...cuts, line.text.length];
    return bounds.slice(0, -1).map((start, i) => ({
        ...line,
        text: line.text.slice(start, bounds[i + 1]).trim(),
        images: i === 0 ? line.images : []
    }));
}

/**
 * True when a line starts a question, an option, the answer key or an answer area
 * ("Taip / Ne", "Atsakymas: ____"), so it is never glued to the line before it.
 */
export function startsNewItem(text) {
    const s = String(text || "").trim();
    return QUESTION_RE.test(s) || OPTION_RE.test(s) || KEY_HEADING_RE.test(s.replace(/:[\s\S]*$/, "").trim()) ||
        /^_{3,}$/.test(s) || isTypeLine(s) || !!detectTrueFalse([s]);
}

function lineKind(line) {
    const text = line.text;
    if (line.list) {
        const letter = /letter|roman/i.test(line.list.fmt);
        const bullet = line.list.fmt === "bullet";
        if (line.list.level > 0 || letter || bullet) return { kind: "option", text, marker: "" };
        return { kind: "question", text: text.replace(/^\d{1,3}\s*[.)]\s*/, "") };
    }
    const q = QUESTION_RE.exec(text);
    if (q) return { kind: "question", text: q[2].trim(), number: q[1] ? Number(q[1]) : null };
    const o = OPTION_RE.exec(text);
    if (o) return { kind: "option", text: o[3].trim(), marker: (o[1] || "").trim(), letter: o[2].toLowerCase() };
    return { kind: "text", text };
}

/**
 * Builds questions from lines.
 * @returns {Promise<{ title: string, questions: object[], flags: { unmarked: boolean, uncertain: boolean }[] }>}
 *          flags[i] belongs to questions[i]: no correct answer found / text that needs checking
 */
export async function linesToQuiz(rawLines, { resizeImage }) {
    const toDataUrl = async (blob, key) => {
        try {
            return await resizeImage(blob, key);
        } catch {
            return null; // a picture the browser can't decode is skipped
        }
    };
    const lines = rawLines.flatMap(splitInlineOptions).map(line => ({ ...line, text: (line.text || "").replace(/\t+/g, " ").trim() }));
    let title = "";
    const drafts = [];
    let current = null;
    let inKey = false;
    let listNumber = 0; // Word's automatic numbering of question list items
    let keyListNumber = 0;
    const keyLines = [];

    for (const line of lines) {
        if (!title && !drafts.length && /^(Title|Pavadinimas)/i.test(line.styleId || "") && line.text) {
            title = line.text;
            continue;
        }
        const beforeColon = line.text.replace(/:[\s\S]*$/, "").trim();
        if (KEY_HEADING_RE.test(beforeColon) && beforeColon.length < 30) {
            inKey = true;
            continue;
        }
        if (inKey) {
            // An automatically numbered key has no typed numbers
            if (line.text) keyLines.push(line.list && !/^\d/.test(line.text) ? `${++keyListNumber}. ${line.text}` : line.text);
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
            current = { prompt: info.text, number, images: [...(line.images || [])], options: [], extra: [], writingLines: 0, line, mathy: !!line.mathy };
            drafts.push(current);
            continue;
        }
        if (!current) {
            // Text before the first question: the title if none was styled as one
            if (!title && line.text && line.text.length < 120) title = line.text;
            continue;
        }
        if (line.mathy) current.mathy = true;
        if (info.kind === "option") {
            current.options.push({ text: info.text, marker: info.marker, line, images: [...(line.images || [])] });
            continue;
        }
        if (!line.text && line.images?.length) {
            (current.options.length ? current.options[current.options.length - 1].images : current.images).push(...line.images);
            continue;
        }
        if (!line.text) {
            if (line.writingLine) current.writingLines++;
            continue;
        }
        if (current.options.length) {
            current.options[current.options.length - 1].text += `\n${line.text}`;
        } else {
            current.extra.push(line.text);
        }
    }

    const key = parseAnswerKey(keyLines);
    const numbered = drafts.some(d => d.number != null);
    const questions = [];
    const flags = [];
    for (let n = 0; n < drafts.length; n++) {
        const d = drafts[n];
        // Unnumbered questions ("Q: …") count by position; stray unnumbered text in a numbered test gets no key
        const answer = numbered ? (d.number != null ? key.get(d.number) : undefined) : key.get(n + 1);
        const tf = detectTrueFalse(d.extra) ?? trueFalseOptions(d.options);
        let prompt = [d.prompt, ...d.extra.filter((x, i) => !tf?.used?.has(i) && !isTypeLine(x))].join("\n").trim();
        let multi = false;
        for (const hint of HINTS) {
            if (prompt.includes(hint)) {
                prompt = prompt.replace(hint, "").trim();
                if (hint.includes("visus") || hint.includes("every")) multi = true;
            }
        }
        const q = { id: newId("q"), prompt };
        const flag = { unmarked: false, uncertain: d.mathy || prompt.includes(t("import.formulaPlaceholder")) };
        const image = d.images[0] && await toDataUrl(d.images[0], "q");
        if (image) q.image = image;

        if (tf) {
            q.type = "true-false";
            const fromKey = answer ? parseTrueFalse(answer) : null;
            q.isTrue = fromKey ?? tf.marked ?? true;
            flag.unmarked = fromKey == null && tf.marked == null;
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
                if (opt.line.mathy) flag.uncertain = true;
                choices.push(choice);
            }
            markCorrect(choices, d.options, answer);
            flag.unmarked = !choices.some(c => c.isCorrect);
            const correct = choices.filter(c => c.isCorrect).length;
            q.allowMultipleAnswers = multi || correct > 1 || d.options.some(o => /[☐□◻]/.test(o.marker));
            q.choices = choices;
        } else if (d.extra.some(x => /^(sprendimas|solution)\s*:?$/i.test(x.trim()))) {
            q.type = "image-upload";
        } else if (/(atsakymas|answer)\s*:?\s*_{3,}/i.test(d.extra.join(" ")) ||
            (ANSWER_BLANK_RE.test(prompt) && (prompt.match(/_{3,}/g) || []).length === 1 && answer && parseNumberAnswer(answer))) {
            // "… Atsakymas: ____" with a number in the key is a numeric question, not a fill-in
            q.type = "numeric";
            q.prompt = prompt.replace(ANSWER_BLANK_RE, "").trim();
            const num = answer && parseNumberAnswer(answer);
            q.correctAnswerNumber = num ? num.value : NaN;
            q.toleranceValue = num ? num.tolerance : 0;
            q.toleranceType = "absolute";
            flag.unmarked = !num;
        } else if (BLANK_RE.test(prompt)) {
            q.type = "fill-blank";
            q.prompt = prompt.replace(/_{3,}/g, "___"); // the editor's blank marker
            const blanks = (q.prompt.match(/___/g) || []).length;
            let answers = answer ? answer.split(/\s*;\s*/).filter(Boolean) : [];
            if (answers.length < blanks && answer?.includes(",")) answers = answer.split(/\s*,\s*/).filter(Boolean);
            q.blankAnswers = answers;
            flag.unmarked = !answers.length;
        } else {
            q.type = "text";
            q.isLongAnswer = d.writingLines > 3;
            q.expectedKeywords = [];
        }
        questions.push(q);
        flags.push(flag);
    }
    return { title, questions, flags };
}

// Lines our export adds under a question that describe its type rather than its text
function isTypeLine(text) {
    return /^(atsakymas|answer|sprendimas|solution)\s*:?\s*_*$/i.test(text.trim());
}

// "☐ Taip ☐ Ne" on one line, or split over two (PDF columns); a checked box gives the answer
function detectTrueFalse(texts) {
    const candidates = texts.map((text, i) => ({ text, used: new Set([i]) }));
    for (let i = 1; i < texts.length; i++) candidates.push({ text: `${texts[i - 1]} ${texts[i]}`, used: new Set([i - 1, i]) });
    for (const { text, used } of candidates) {
        const words = text.toLowerCase().replace(/[○◯☐□◻☑☒✓✔●◉■◼*]/g, " ").split(/[\s/|,]+/).filter(Boolean);
        const hasTrue = words.some(w => TRUE_WORDS.includes(w));
        const hasFalse = words.some(w => FALSE_WORDS.includes(w));
        if (hasTrue && hasFalse && words.length <= 4) {
            const m = new RegExp(`[${CORRECT_MARKERS}]\\s*(\\S+)`).exec(text);
            return { marked: m ? TRUE_WORDS.includes(m[1].toLowerCase()) : null, used };
        }
    }
    return null;
}

function trueFalseOptions(options) {
    if (options.length !== 2) return null;
    const words = options.map(o => o.text.toLowerCase().replace(/^\*\s*|\s*\*$/g, "").replace(/[.!]$/, ""));
    const ti = words.findIndex(w => TRUE_WORDS.includes(w));
    const fi = words.findIndex(w => FALSE_WORDS.includes(w));
    if (ti < 0 || fi < 0) return null;
    const marked = options.map(isMarked);
    return { marked: marked[ti] && !marked[fi] ? true : marked[fi] && !marked[ti] ? false : null };
}

const isMarked = (opt) => /^\*|\*$/.test(opt.text) || (!!opt.marker && (opt.marker === "*" || CORRECT_MARKERS.includes(opt.marker)));

function markCorrect(choices, options, answer) {
    options.forEach((opt, i) => {
        if (/^\*\s*|\s*\*$/.test(opt.text) && choices[i].text !== undefined) choices[i].text = choices[i].text.replace(/^\*\s*|\s*\*$/g, "");
    });
    if (answer) {
        // "B, D" / "B; D" / "B D", or "B) text; D) text", or "C) ats1 / ats2" for a typed slot
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

// "1. B" per line, "1 - B", "1: B", or compact "1B 2C 3A" / "1-B, 2-C" on one line
const KEY_ENTRY_RE = /(?:^|[\s,;])(\d{1,3})\s*[.):\-–]?\s*([A-Ha-h](?:\s*,\s*[A-Ha-h])*)(?=$|[\s,;.])/g;
function parseAnswerKey(lines) {
    const key = new Map();
    let last = 0;
    for (const text of lines.join("\n").split("\n")) {
        const entries = [...text.matchAll(KEY_ENTRY_RE)];
        if (entries.length >= 2) {
            entries.forEach(m => key.set(Number(m[1]), m[2]));
            last = 0;
            continue;
        }
        const m = /^\s*(\d{1,3})\s*[.):\-–]\s*(.*)$/.exec(text);
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
    const s = text.trim().toLowerCase();
    if (/^(t|\+|✓|✔)\.?$/.test(s)) return true;
    if (/^(n|-|–|✗|✘)\.?$/.test(s)) return false;
    const word = s.replace(/[^a-ząčęėįšųūž]/g, "");
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
 * Pasted text. Numbered tests ("1. …") use the same parser as files; the older block format
 * (question line, option lines, blank line between questions) keeps working too.
 */
export async function importFromText(text) {
    const source = String(text ?? "").replace(/\r\n?/g, "\n");
    if (NUMBERED_TEXT_RE.test(source)) {
        const lines = source.split("\n").map(s => ({ text: s, images: [] }));
        return linesToQuiz(lines, { resizeImage: async () => null });
    }
    const questions = parseBulkImportText(source);
    const flags = questions.map(q => ({
        unmarked: q.type === "multiple-choice" && !q.choices.some(c => c.isCorrect),
        uncertain: false
    }));
    return { title: "", questions, flags };
}

// Exposed for tests
export const _internal = { lineKind, splitInlineOptions, parseAnswerKey, detectTrueFalse };
