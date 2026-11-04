import { t } from "./lang.js";
import { escapeHtml } from "./dom.js";
import { kindOfQuestion, getKind } from "./type-wheel.js";
import { linesToQuiz, importFromText } from "./quiz-import.js";

// Importing questions: drop or pick Word (.docx) / PDF files, or paste text. Everything found is
// listed before it is added; the teacher can untick questions and click an option to fix the
// correct answer (anything bigger is easier in the editor afterwards). Several files at once
// is a Premium feature.

const KATEX_DELIMITERS = [
    { left: "\\(", right: "\\)", display: false },
    { left: "\\[", right: "\\]", display: true }
];
const TEXT_DEBOUNCE_MS = 300;
const FILE_TYPES = ".docx,.pdf,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

let overlay = null;

/**
 * @param {{ resizeImage: (blob: Blob, key: "q"|"option") => Promise<string>,
 *           onImport: (questions: object[], title: string) => void,
 *           canImportMany: () => Promise<boolean>,
 *           files?: File[], pickFile?: boolean,
 *           title?: string, confirmLabel?: (n: number) => string,
 *           extra?: HTMLElement, preset?: { name?: string, questions: object[] } }} options
 * `extra` is shown above the buttons (the task bank's classification); `preset` lists questions
 * that are already at hand (a quiz's own, to be saved to the bank) instead of reading any.
 */
export function openImportDialog({ resizeImage, onImport, canImportMany, files, pickFile, title, confirmLabel, extra, preset }) {
    closeImportDialog();
    const returnFocus = document.activeElement;
    // Everything found so far: one entry per file (or the pasted text)
    let sources = [];         // { name, kind: "docx"|"pdf"|"text", title, questions, flags, include, warnings }
    let lockNote = "";        // shown when a free account picks several files
    let parseToken = 0;
    let addMode = false;      // the file picker adds to the list instead of replacing it
    // Asked once up front: a file picker may only open straight from a click, not after a wait
    let manyAllowed = null;
    const manyAllowedReady = canImportMany().catch(() => false).then(allowed => {
        manyAllowed = allowed;
        overlay?.classList.toggle("premium", allowed);
        return allowed;
    });

    overlay = document.createElement("div");
    overlay.className = "imp-overlay";
    overlay.innerHTML = `
        <div class="imp-window" role="dialog" aria-modal="true" aria-labelledby="imp-title">
            <header class="imp-head">
                <h2 id="imp-title">${escapeHtml(title || t("import.title"))}</h2>
                <button type="button" class="btn btn-secondary btn-icon imp-close" aria-label="${t("pp.close")}">×</button>
            </header>
            <div class="imp-body">
                <section class="imp-source">
                    <label class="imp-drop" tabindex="0">
                        <input type="file" class="imp-file-input" accept="${FILE_TYPES}" multiple hidden>
                        <span class="imp-drop-icon" aria-hidden="true">⬆</span>
                        <span class="imp-drop-title">${t("import.dropTitle")}</span>
                        <span class="imp-drop-sub">${t("import.dropSub")}</span>
                        <span class="imp-drop-premium">🔒 ${t("import.manyPremium")}</span>
                    </label>
                    <button type="button" class="imp-text-toggle" aria-expanded="false">${t("import.orPaste")}</button>
                    <div class="imp-text-wrap">
                        <textarea class="imp-text" rows="8" spellcheck="false" placeholder="${escapeHtml(t("import.textPlaceholder"))}"></textarea>
                    </div>
                    <details class="imp-help">
                        <summary>${t("import.helpTitle")}</summary>
                        <ul>${t("import.helpItems").split("|").map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                    </details>
                </section>
                <section class="imp-preview" aria-live="polite">
                    <div class="imp-files"></div>
                    <div class="imp-summary"></div>
                    <div class="imp-warnings"></div>
                    <ol class="imp-list"></ol>
                </section>
            </div>
            <div class="imp-extra"></div>
            <footer class="imp-foot">
                <span class="imp-status"></span>
                <button type="button" class="btn btn-secondary imp-cancel">${t("dialog.cancel")}</button>
                <button type="button" class="btn btn-primary imp-confirm" disabled>${t("import.confirmNone")}</button>
            </footer>
        </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay?.classList.add("open"));

    const $ = (sel) => overlay.querySelector(sel);
    const win = $(".imp-window");
    const fileInput = $(".imp-file-input");
    const textArea = $(".imp-text");
    const textToggle = $(".imp-text-toggle");
    const list = $(".imp-list");
    const confirmBtn = $(".imp-confirm");
    if (extra) $(".imp-extra").appendChild(extra);
    win.classList.toggle("preset", !!preset);

    const close = () => closeImportDialog(returnFocus);
    $(".imp-close").addEventListener("click", close);
    $(".imp-cancel").addEventListener("click", close);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
    overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); close(); }
    });

    const setStatus = (text, busy = false) => {
        $(".imp-status").textContent = text;
        overlay.classList.toggle("busy", busy);
    };

    // --- text ---
    textToggle.addEventListener("click", () => {
        const open = textToggle.getAttribute("aria-expanded") !== "true";
        textToggle.setAttribute("aria-expanded", String(open));
        win.classList.toggle("text-open", open);
        if (open) requestAnimationFrame(() => textArea.focus());
    });
    let textTimer = null;
    textArea.addEventListener("input", () => {
        clearTimeout(textTimer);
        textTimer = setTimeout(parseText, TEXT_DEBOUNCE_MS);
    });
    async function parseText() {
        const token = ++parseToken;
        const text = textArea.value;
        if (!text.trim()) {
            sources = [];
            render();
            return;
        }
        const parsed = await importFromText(text);
        if (token !== parseToken || !overlay) return;
        sources = [{ name: "", kind: "text", ...parsed, include: parsed.questions.map(() => true), warnings: {} }];
        render(true);
    }

    // --- files ---
    async function readFiles(picked, { add = false } = {}) {
        let chosen = [...picked];
        lockNote = "";
        // Several files at once (or adding to what is already loaded) is a Premium feature
        if (chosen.length > 1 || (add && sources.some(s => s.kind !== "text"))) {
            const allowed = await manyAllowedReady;
            if (!allowed) {
                if (add) {
                    lockNote = t("import.addLocked");
                    render();
                    return;
                }
                lockNote = t("import.manyLocked").replace("{name}", chosen[0].name);
                chosen = chosen.slice(0, 1);
            }
        }
        const token = ++parseToken;
        const found = add ? sources.filter(s => s.kind !== "text") : [];
        const errors = [];
        for (let i = 0; i < chosen.length; i++) {
            const file = chosen[i];
            setStatus(chosen.length > 1 ? t("import.readingMany").replace("{i}", i + 1).replace("{n}", chosen.length) : t("import.reading"), true);
            try {
                const source = await readOne(file);
                if (token !== parseToken || !overlay) return;
                if (source) found.push(source);
            } catch (err) {
                console.error("Import failed", file.name, err);
                errors.push(`${file.name}: ${errorMessage(err, file)}`);
            }
        }
        if (token !== parseToken || !overlay) return;
        setStatus("");
        sources = found;
        render(true, errors);
    }

    async function readOne(file) {
        const ext = (file.name || "").split(".").pop().toLowerCase();
        if (ext === "doc") throw Object.assign(new Error("old-doc"), { code: "old-doc" });
        if (ext === "txt" || file.type === "text/plain") {
            const parsed = await importFromText(await file.text());
            return { name: file.name, kind: "text-file", ...parsed, include: parsed.questions.map(() => true), warnings: {} };
        }
        if (ext !== "docx" && ext !== "pdf") throw Object.assign(new Error("unsupported"), { code: "unsupported" });
        const { lines, warnings } = ext === "pdf"
            ? await (await import("./pdf-import.js")).readPdf(file)
            : await (await import("./docx-import.js")).readDocx(file);
        const parsed = await linesToQuiz(lines, { resizeImage });
        return { name: file.name, kind: ext, ...parsed, include: parsed.questions.map(() => true), warnings };
    }

    function errorMessage(err, file) {
        const code = err?.code || "";
        if (code === "old-doc") return t("import.oldDoc");
        if (code === "unsupported") return t("import.unsupported");
        if (code === "no-text") return t("import.pdfNoText");
        if (code === "password") return t("import.pdfPassword");
        return /\.pdf$/i.test(file.name) ? t("import.pdfFailed") : t("docxImport.failed");
    }

    const pickFiles = (add) => {
        addMode = add;
        fileInput.click();
    };
    fileInput.addEventListener("change", () => {
        const picked = [...(fileInput.files || [])];
        fileInput.value = "";
        if (picked.length) readFiles(picked, { add: addMode });
        addMode = false;
    });
    $(".imp-drop").addEventListener("click", () => { addMode = false; });
    $(".imp-drop").addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickFiles(false); }
    });
    // Files can be dropped anywhere on the dialog
    let dragDepth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    overlay.addEventListener("dragenter", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth++;
        overlay.classList.add("dragging");
    });
    overlay.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    overlay.addEventListener("dragleave", () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) overlay.classList.remove("dragging");
    });
    overlay.addEventListener("drop", (e) => {
        const dropped = [...(e.dataTransfer?.files || [])];
        dragDepth = 0;
        overlay.classList.remove("dragging");
        if (!dropped.length || preset) return;
        e.preventDefault();
        // Dropping onto the list adds to it; onto the start screen it replaces
        readFiles(dropped, { add: win.classList.contains("files-mode") });
    });

    // --- preview ---
    const allQuestions = () => sources.flatMap((s, si) => s.questions.map((q, qi) => ({ q, flag: s.flags[qi], si, qi })));

    function render(animate = false, errors = []) {
        const fileSources = sources.filter(s => s.kind !== "text");
        win.classList.toggle("files-mode", fileSources.length > 0 || errors.length > 0);
        // File bar: what was read, replace or add more
        $(".imp-files").innerHTML = fileSources.length || errors.length ? `
            <div class="imp-file-bar">
                ${fileSources.map(s => `<span class="imp-file-chip">📄 ${escapeHtml(s.name)} <em>${t("import.fileCount").replace("{n}", s.questions.length)}</em></span>`).join("")}
                <span class="imp-file-actions">
                    <button type="button" class="btn btn-secondary btn-compact" data-files="replace">${t("import.changeFile")}</button>
                    <button type="button" class="btn btn-secondary btn-compact" data-files="add">${t("import.addFile")}</button>
                </span>
            </div>` : "";
        const notes = [...errors.map(e => `<li class="warn">${escapeHtml(e)}</li>`)];
        if (lockNote) notes.push(`<li class="lock">🔒 ${escapeHtml(lockNote)}</li>`);

        const items = allQuestions();
        const summary = $(".imp-summary");
        if (!sources.length) {
            summary.innerHTML = errors.length ? "" : `<div class="imp-empty">${t("import.empty")}</div>`;
        } else if (!items.length) {
            summary.innerHTML = `<div class="imp-error">${t("docxImport.none")}</div>`;
        } else {
            const title = sources.find(s => s.title)?.title;
            summary.innerHTML = `
                <div class="imp-summary-line">
                    <strong>${t("import.found").replace("{n}", items.length)}</strong>
                    ${title ? `<span class="imp-title-found">„${escapeHtml(title)}“</span>` : ""}
                </div>
                <p class="imp-edit-hint">${t("import.editHint")}</p>`;
        }
        renderNotes(notes);
        const multipleFiles = fileSources.length > 1;
        list.innerHTML = items.map((item, i) => questionHtml(item, i, multipleFiles)).join("");
        if (animate) list.querySelectorAll(".imp-q").forEach((el, i) => el.style.setProperty("--i", Math.min(i, 12)));
        list.classList.toggle("animate", animate);
        if (window.renderMathInElement) window.renderMathInElement(list, { delimiters: KATEX_DELIMITERS, throwOnError: false });
        updateConfirm();
    }

    // What needs the teacher's attention, recounted whenever an answer is fixed
    let extraNotes = [];
    function renderNotes(notes = extraNotes) {
        extraNotes = notes;
        const items = allQuestions();
        const unmarked = items.filter(x => x.flag.unmarked).length;
        const uncertain = items.filter(x => x.flag.uncertain).length;
        const fromPdf = sources.some(s => s.kind === "pdf");
        const equations = sources.reduce((n, s) => n + (s.warnings.skippedEquations || 0), 0);
        const images = sources.reduce((n, s) => n + (s.warnings.skippedImages || 0), 0);
        const all = [...notes];
        if (unmarked) all.push(`<li class="warn">${t("import.unmarkedNote").replace("{n}", unmarked)}</li>`);
        if (uncertain) all.push(`<li class="info">${t(fromPdf ? "import.pdfMathNote" : "import.uncertainNote").replace("{n}", uncertain)}</li>`);
        if (equations) all.push(`<li class="warn">${t("import.oldEquations").replace("{n}", equations)}</li>`);
        if (images) all.push(`<li class="info">${t("import.skippedImages").replace("{n}", images)}</li>`);
        $(".imp-warnings").innerHTML = all.length ? `<ul class="imp-notes">${all.join("")}</ul>` : "";
    }

    function questionHtml({ q, flag, si, qi }, i, showFile) {
        const included = sources[si].include[qi];
        const kind = getKind(kindOfQuestion(q));
        const rich = (value) => escapeHtml(String(value || "")).replace(/\n/g, "<br>");
        const ref = `data-s="${si}" data-q="${qi}"`;
        let answers = "";
        if (q.type === "multiple-choice") {
            answers = `<ul class="imp-choices">${q.choices.map((c, ci) => `
                <li><button type="button" class="imp-choice${c.isCorrect ? " correct" : ""}" ${ref} data-c="${ci}" aria-pressed="${!!c.isCorrect}">
                    <span class="imp-check" aria-hidden="true">${c.isCorrect ? "✓" : String.fromCharCode(65 + ci)}</span>
                    <span class="imp-choice-text">${c.kind === "write"
                        ? `<em>${t("akind.write")}</em>${c.accepted?.length ? `: ${escapeHtml(c.accepted.join(" / "))}` : ""}`
                        : rich(c.text)}</span>
                    ${c.image ? `<img src="${c.image}" alt="" class="imp-choice-img">` : ""}
                </button></li>`).join("")}</ul>`;
        } else if (q.type === "true-false") {
            answers = `<div class="imp-choices imp-tf">${[true, false].map(v => {
                const on = !flag.unmarked && q.isTrue === v;
                return `<button type="button" class="imp-choice${on ? " correct" : ""}" ${ref} data-tf="${v}" aria-pressed="${on}">
                    <span class="imp-check" aria-hidden="true">${on ? "✓" : ""}</span>${v ? t("docx.true") : t("docx.false")}
                </button>`;
            }).join("")}</div>`;
        } else if (q.type === "numeric") {
            answers = `<div class="imp-answer">${t("docx.answer")}: ${Number.isNaN(q.correctAnswerNumber) ? "—" : `${q.correctAnswerNumber}${q.toleranceValue ? ` ± ${q.toleranceValue}` : ""}`}</div>`;
        } else if (q.type === "fill-blank") {
            answers = `<div class="imp-answer">${t("docx.answers")}: ${q.blankAnswers.length ? escapeHtml(q.blankAnswers.join("; ")) : "—"}</div>`;
        } else if (q.type === "text") {
            answers = `<div class="imp-answer">${t("qtype.textDesc")}${q.isLongAnswer ? ` · ${t("admin.longAnswer").toLowerCase()}` : ""}</div>`;
        } else if (q.type === "image-upload") {
            answers = `<div class="imp-answer">${t("qtype.imageDesc")}</div>`;
        }
        return `
            <li class="imp-q${included ? "" : " excluded"}${flag.unmarked ? " unmarked" : ""}">
                <label class="imp-include" title="${t("import.include")}">
                    <input type="checkbox" ${ref} data-include ${included ? "checked" : ""} aria-label="${t("import.include")} ${i + 1}">
                </label>
                <div class="imp-q-main">
                    <div class="imp-q-meta">
                        <span class="imp-q-num">${i + 1}.</span>
                        <span class="imp-q-type">${kind ? t(kind.label) : ""}</span>
                        ${showFile ? `<span class="imp-q-file">${escapeHtml(sources[si].name)}</span>` : ""}
                        ${flag.unmarked ? `<span class="imp-badge warn">${t("import.markAnswer")}</span>` : ""}
                        ${flag.uncertain ? `<span class="imp-badge info">${t("import.checkText")}</span>` : ""}
                    </div>
                    <div class="imp-q-prompt">${rich(q.prompt) || `<em>${t("import.noPrompt")}</em>`}</div>
                    ${q.image ? `<img src="${q.image}" alt="" class="imp-q-img">` : ""}
                    ${answers}
                </div>
            </li>`;
    }

    // Clicking an option fixes the correct answer; checkboxes include/skip questions
    $(".imp-preview").addEventListener("click", (e) => {
        const filesBtn = e.target.closest("[data-files]");
        if (filesBtn) {
            if (filesBtn.dataset.files === "add") readFilesViaPickerAdd();
            else pickFiles(false);
            return;
        }
        const btn = e.target.closest(".imp-choice");
        if (!btn) return;
        const source = sources[Number(btn.dataset.s)];
        const qi = Number(btn.dataset.q);
        const q = source.questions[qi];
        if (btn.dataset.tf !== undefined) {
            q.isTrue = btn.dataset.tf === "true";
        } else {
            const c = q.choices[Number(btn.dataset.c)];
            if (q.allowMultipleAnswers) c.isCorrect = !c.isCorrect;
            else q.choices.forEach(other => { other.isCorrect = other === c; });
        }
        source.flags[qi].unmarked = q.type === "multiple-choice" ? !q.choices.some(c => c.isCorrect) : false;
        rerenderItem(btn.closest(".imp-q"), Number(btn.dataset.s), qi);
    });
    list.addEventListener("change", (e) => {
        if (e.target.dataset.include === undefined) return;
        const source = sources[Number(e.target.dataset.s)];
        source.include[Number(e.target.dataset.q)] = e.target.checked;
        e.target.closest(".imp-q").classList.toggle("excluded", !e.target.checked);
        updateConfirm();
    });

    // "+ Add file": Premium accounts pick more files; others see the lock note
    async function readFilesViaPickerAdd() {
        const allowed = manyAllowed ?? await manyAllowedReady;
        if (!allowed) {
            lockNote = t("import.addLocked");
            renderNotes([`<li class="lock">🔒 ${escapeHtml(lockNote)}</li>`]);
            return;
        }
        pickFiles(true);
    }

    function rerenderItem(el, si, qi) {
        const index = [...list.children].indexOf(el);
        const tmp = document.createElement("div");
        tmp.innerHTML = questionHtml({ q: sources[si].questions[qi], flag: sources[si].flags[qi], si, qi }, index, sources.filter(s => s.kind !== "text").length > 1).trim();
        const fresh = tmp.firstElementChild;
        el.replaceWith(fresh);
        if (window.renderMathInElement) window.renderMathInElement(fresh, { delimiters: KATEX_DELIMITERS, throwOnError: false });
        renderNotes();
        updateConfirm();
    }

    function updateConfirm() {
        const count = sources.reduce((n, s) => n + s.include.filter(Boolean).length, 0);
        confirmBtn.disabled = count === 0;
        confirmBtn.textContent = !count ? t("import.confirmNone") : confirmLabel ? confirmLabel(count) : t("import.confirm").replace("{n}", count);
    }

    confirmBtn.addEventListener("click", () => {
        const chosen = sources.flatMap(s => s.questions.filter((_, i) => s.include[i]))
            .map(q => JSON.parse(JSON.stringify(q)));
        if (!chosen.length) return;
        const title = sources.find(s => s.title)?.title || "";
        closeImportDialog(returnFocus);
        onImport(chosen, title);
    });

    if (preset) {
        const questions = preset.questions.map(q => JSON.parse(JSON.stringify(q)));
        sources = [{ name: preset.name || "", kind: "preset", title: "", questions, flags: questions.map(() => ({})), include: questions.map(() => true), warnings: {} }];
        render(true);
        return;
    }
    render();
    if (files?.length) readFiles(files);
    else if (pickFile) pickFiles(false);
}

export function closeImportDialog(returnFocus) {
    if (!overlay) return;
    const el = overlay;
    overlay = null;
    el.classList.remove("open");
    setTimeout(() => el.remove(), 220);
    if (returnFocus?.isConnected) returnFocus.focus();
}
