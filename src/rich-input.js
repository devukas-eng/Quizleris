import { t } from "./lang.js";

// <rich-input>: plain text with inline formulas, for question prompts and answer options.
//
// The value uses the format the quiz player already renders with KaTeX auto-render:
// ordinary text, with math between \( … \) (inline) or \[ … \] (display).
// Formulas show as rendered chips. MathLive (and its virtual keyboard) only opens in a
// small popover when inserting or editing a chip, so normal typing, spaces included,
// stays plain text instead of being parsed as LaTeX.

const ZWSP = "\u200B";
const MATH_RE = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;

// MathLive beeps on every keystroke it rejects (e.g. space in math mode). Turn sounds off.
customElements.whenDefined("math-field").then(() => {
    const MathfieldElement = customElements.get("math-field");
    for (const prop of ["soundsDirectory", "plonkSound", "keypressSound"]) {
        try { MathfieldElement[prop] = null; } catch { /* property not supported in this version */ }
    }
});

/** Splits a stored value into text and math parts. */
export function parseRichValue(value) {
    const parts = [];
    const str = String(value ?? "");
    let last = 0;
    for (const match of str.matchAll(MATH_RE)) {
        if (match.index > last) parts.push({ type: "text", text: str.slice(last, match.index) });
        const display = match[2] !== undefined;
        parts.push({ type: "math", latex: (display ? match[2] : match[1]).trim(), display });
        last = match.index + match[0].length;
    }
    if (last < str.length) parts.push({ type: "text", text: str.slice(last) });
    return parts;
}

function renderChip(chip) {
    const latex = chip.dataset.latex || "";
    if (window.katex) {
        try {
            window.katex.render(latex || "\\square", chip, { throwOnError: false, displayMode: false });
            return;
        } catch { /* fall back to raw LaTeX below */ }
    }
    chip.textContent = latex;
}

function createChip(latex, display = false) {
    const chip = document.createElement("span");
    chip.className = "rich-math";
    chip.contentEditable = "false";
    chip.dataset.latex = latex;
    if (display) chip.dataset.display = "true";
    chip.title = t("rich.editFormula");
    renderChip(chip);
    return chip;
}

function isChip(node) {
    return node?.nodeType === Node.ELEMENT_NODE && node.classList.contains("rich-math");
}

function serialize(node, out) {
    node.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
            out.push(child.data);
        } else if (isChip(child)) {
            const latex = child.dataset.latex || "";
            out.push(child.dataset.display === "true" ? `\\[${latex}\\]` : `\\(${latex}\\)`);
        } else if (child.nodeName === "BR") {
            out.push("\n");
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            // Browsers wrap new lines in <div>/<p> in some cases
            const isBlock = child.nodeName === "DIV" || child.nodeName === "P";
            if (isBlock && out.length && !out[out.length - 1].endsWith("\n")) out.push("\n");
            serialize(child, out);
        }
    });
}

class RichInput extends HTMLElement {
    connectedCallback() {
        if (this._editor) return;
        const initial = this.getAttribute("value") ?? "";
        this.removeAttribute("value");
        this.classList.add("rich-input");

        this._editor = document.createElement("div");
        this._editor.className = "rich-input-editor";
        this._editor.contentEditable = "true";
        this._editor.spellcheck = true;
        this._editor.setAttribute("role", "textbox");
        this._editor.setAttribute("aria-multiline", this.multiline ? "true" : "false");
        const label = this.getAttribute("aria-label") || this.getAttribute("placeholder");
        if (label) this._editor.setAttribute("aria-label", label);
        if (this.getAttribute("placeholder")) this._editor.dataset.placeholder = this.getAttribute("placeholder");

        this._mathBtn = document.createElement("button");
        this._mathBtn.type = "button";
        this._mathBtn.className = "rich-input-math-btn";
        this._mathBtn.title = t("rich.insertFormula");
        this._mathBtn.setAttribute("aria-label", t("rich.insertFormula"));
        this._mathBtn.textContent = "∑";

        this.append(this._editor, this._mathBtn);
        this._setContent(initial);
        this._bindEvents();
    }

    get multiline() {
        return this.hasAttribute("multiline");
    }

    get value() {
        if (!this._editor) return this.getAttribute("value") ?? "";
        const out = [];
        serialize(this._editor, out);
        let value = out.join("").replace(/\u200B/g, "").replace(/\u00A0/g, " ");
        if (!this.multiline) value = value.replace(/\n+/g, " ");
        return value;
    }

    set value(v) {
        if (!this._editor) {
            this.setAttribute("value", v ?? "");
            return;
        }
        this._setContent(v);
    }

    /** Focuses the text, restoring the last caret position (or placing it at the end). */
    focus(options) {
        if (!this._editor) return;
        this._editor.focus(options);
        const saved = this._savedRange && this._editor.contains(this._savedRange.commonAncestorContainer)
            ? this._savedRange.cloneRange()
            : null;
        const range = saved || document.createRange();
        if (!saved) {
            range.selectNodeContents(this._editor);
            range.collapse(false);
        }
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    /** Inserts plain text at the caret (or at the end if the field wasn't focused). */
    insertText(text) {
        this._insertNodes([document.createTextNode(text)], this._currentRange());
        this._changed();
    }

    // --- internals ---

    _setContent(value) {
        this._savedRange = null; // would point into the replaced content
        this._editor.textContent = "";
        parseRichValue(value).forEach(part => {
            if (part.type === "math") {
                this._editor.appendChild(createChip(part.latex, part.display));
                return;
            }
            const lines = this.multiline ? part.text.split("\n") : [part.text.replace(/\n+/g, " ")];
            lines.forEach((line, i) => {
                if (i > 0) this._editor.appendChild(document.createElement("br"));
                if (line) this._editor.appendChild(document.createTextNode(line));
            });
        });
        this._normalize();
    }

    // A chip at the very end needs a (zero-width) text node after it, otherwise the caret
    // cannot be placed behind it to keep typing.
    _normalize() {
        const last = this._editor.lastChild;
        if (isChip(last)) this._editor.appendChild(document.createTextNode(ZWSP));
        if (!this._editor.textContent.replace(/\u200B/g, "") && !this._editor.querySelector(".rich-math")) {
            this._editor.textContent = "";
        }
    }

    _changed() {
        this._normalize();
        this.dispatchEvent(new Event("input", { bubbles: true }));
    }

    _currentRange() {
        const sel = window.getSelection();
        if (sel.rangeCount && this._editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            return sel.getRangeAt(0);
        }
        return this._savedRange && this._editor.contains(this._savedRange.commonAncestorContainer)
            ? this._savedRange
            : null;
    }

    _insertNodes(nodes, range) {
        if (!range) {
            range = document.createRange();
            range.selectNodeContents(this._editor);
            range.collapse(false);
        }
        range.deleteContents();
        const frag = document.createDocumentFragment();
        nodes.forEach(n => frag.appendChild(n));
        const lastNode = nodes[nodes.length - 1];
        range.insertNode(frag);
        this._editor.focus();
        const after = document.createRange();
        after.setStartAfter(lastNode);
        after.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(after);
        // If a chip landed last, step the caret past the zero-width spacer added by _normalize
        if (isChip(lastNode) && !lastNode.nextSibling) {
            this._normalize();
            const spacer = lastNode.nextSibling;
            const r = document.createRange();
            r.setStart(spacer, spacer.length);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
        }
    }

    _nodesFromText(text) {
        const nodes = [];
        parseRichValue(text).forEach(part => {
            if (part.type === "math") {
                nodes.push(createChip(part.latex, part.display));
                return;
            }
            const lines = this.multiline ? part.text.split(/\r?\n/) : [part.text.replace(/\s*\r?\n\s*/g, " ")];
            lines.forEach((line, i) => {
                if (i > 0) nodes.push(document.createElement("br"));
                if (line) nodes.push(document.createTextNode(line));
            });
        });
        return nodes;
    }

    _bindEvents() {
        const editor = this._editor;

        // Re-emit from the host so listeners can read `event.target.value`
        editor.addEventListener("input", (e) => {
            e.stopPropagation();
            this._changed();
        });

        // No bold/italic/etc.: the value is plain text
        editor.addEventListener("beforeinput", (e) => {
            if (e.inputType.startsWith("format")) e.preventDefault();
        });

        editor.addEventListener("keydown", (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
                e.preventDefault();
                openFormulaEditor(this, null);
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault();
                if (this.multiline) {
                    if (!document.execCommand("insertLineBreak")) this.insertText("\n");
                }
                return;
            }
            if (e.key === "Backspace" || e.key === "Delete") this._deleteAroundSpacer(e);
        });

        editor.addEventListener("paste", (e) => {
            e.preventDefault();
            const text = e.clipboardData?.getData("text/plain") ?? "";
            if (!text) return;
            const nodes = this._nodesFromText(text);
            if (nodes.length) {
                this._insertNodes(nodes, this._currentRange());
                this._changed();
            }
        });

        editor.addEventListener("drop", (e) => e.preventDefault());

        editor.addEventListener("click", (e) => {
            const chip = e.target.closest?.(".rich-math");
            if (chip && editor.contains(chip)) openFormulaEditor(this, chip);
        });

        editor.addEventListener("blur", () => {
            const sel = window.getSelection();
            if (sel.rangeCount && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
                this._savedRange = sel.getRangeAt(0).cloneRange();
            }
        });

        // Keep the caret where it is when pressing the ∑ button
        this._mathBtn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const range = this._currentRange();
            if (range) this._savedRange = range.cloneRange();
        });
        this._mathBtn.addEventListener("click", () => openFormulaEditor(this, null));
    }

    // Backspace/Delete next to a chip removes the whole chip in one press, stepping over the
    // invisible spacer (otherwise the first press would only delete that spacer).
    _deleteAroundSpacer(e) {
        const sel = window.getSelection();
        if (!sel.isCollapsed || !sel.rangeCount) return;
        const back = e.key === "Backspace";
        const { startContainer: node, startOffset: offset } = sel.getRangeAt(0);
        const onlySpacer = (text) => text.replace(/\u200B/g, "") === "";
        let target;
        if (node.nodeType === Node.TEXT_NODE) {
            // Real text between the caret and the neighbour gets deleted normally first
            if (!onlySpacer(back ? node.data.slice(0, offset) : node.data.slice(offset))) return;
            target = back ? node.previousSibling : node.nextSibling;
        } else {
            target = back ? node.childNodes[offset - 1] : node.childNodes[offset];
            if (target?.nodeType === Node.TEXT_NODE && onlySpacer(target.data)) {
                target = back ? target.previousSibling : target.nextSibling;
            }
        }
        if (!isChip(target)) return;
        e.preventDefault();
        target.remove();
        this._changed();
    }
}

if (!customElements.get("rich-input")) customElements.define("rich-input", RichInput);

// --- Formula popover (one shared instance) ---

let popover = null;
let mathField = null;
let activeHost = null;
let activeChip = null;

function ensurePopover() {
    if (popover) return;
    popover = document.createElement("div");
    popover.className = "rich-formula-popover";
    popover.setAttribute("role", "dialog");
    popover.innerHTML = `
        <div class="rich-formula-head">
            <span class="rich-formula-title"></span>
            <span class="rich-formula-hint"></span>
        </div>
        <math-field class="rich-formula-field" math-virtual-keyboard-policy="auto"></math-field>
        <div class="rich-formula-actions">
            <button type="button" class="btn btn-secondary btn-compact rich-formula-remove"></button>
            <button type="button" class="btn btn-secondary btn-compact rich-formula-cancel"></button>
            <button type="button" class="btn btn-primary btn-compact rich-formula-insert"></button>
        </div>
    `;
    document.body.appendChild(popover);
    mathField = popover.querySelector(".rich-formula-field");

    popover.querySelector(".rich-formula-cancel").addEventListener("click", () => closeFormulaEditor(false));
    popover.querySelector(".rich-formula-insert").addEventListener("click", () => closeFormulaEditor(true));
    popover.querySelector(".rich-formula-remove").addEventListener("click", () => {
        if (activeChip) mathField.value = "";
        closeFormulaEditor(true);
    });

    // Capture phase on the host runs before MathLive's own key handling inside its shadow DOM
    mathField.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            closeFormulaEditor(true);
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeFormulaEditor(false);
        }
    }, { capture: true });

    document.addEventListener("mousedown", (e) => {
        if (!popover.classList.contains("open")) return;
        // Clicks on the popover itself or on MathLive's virtual keyboard keep it open
        const path = e.composedPath();
        const inside = path.some(el => el === popover || (el.classList && [...el.classList].some(c => c.startsWith("ML__"))) ||
            el.tagName === "MATH-VIRTUAL-KEYBOARD");
        if (!inside) closeFormulaEditor(false);
    }, true);

    window.addEventListener("resize", () => {
        if (popover.classList.contains("open")) positionPopover();
    });
}

function positionPopover() {
    const rect = activeHost.getBoundingClientRect();
    const width = Math.min(460, window.innerWidth - 16);
    popover.style.width = `${width}px`;
    const left = Math.min(Math.max(rect.left + window.scrollX, window.scrollX + 8), window.scrollX + window.innerWidth - width - 8);
    popover.style.left = `${left}px`;
    popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
}

function openFormulaEditor(host, chip) {
    ensurePopover();
    const range = host._currentRange();
    if (range) host._savedRange = range.cloneRange();
    activeHost = host;
    activeChip = chip;
    popover.querySelector(".rich-formula-title").textContent = t("rich.formulaTitle");
    popover.querySelector(".rich-formula-hint").textContent = t("rich.formulaHint");
    popover.querySelector(".rich-formula-cancel").textContent = t("dialog.cancel");
    popover.querySelector(".rich-formula-insert").textContent = chip ? t("rich.update") : t("rich.insert");
    const removeBtn = popover.querySelector(".rich-formula-remove");
    removeBtn.textContent = t("rich.remove");
    removeBtn.hidden = !chip;

    host.classList.add("formula-open");
    positionPopover();
    popover.classList.add("open");
    mathField.value = chip ? chip.dataset.latex || "" : "";
    requestAnimationFrame(() => {
        mathField.focus();
        popover.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
}

function closeFormulaEditor(commit) {
    if (!popover || !popover.classList.contains("open")) return;
    const host = activeHost;
    const chip = activeChip;
    popover.classList.remove("open");
    host.classList.remove("formula-open");
    window.mathVirtualKeyboard?.hide?.();
    activeHost = null;
    activeChip = null;

    if (commit) {
        const latex = (mathField.value || "").trim();
        if (chip) {
            if (latex) {
                chip.dataset.latex = latex;
                renderChip(chip);
            } else {
                chip.remove();
            }
            host._changed();
            host.focus();
        } else if (latex) {
            host._insertNodes([createChip(latex)], host._currentRange());
            host._changed();
        } else {
            host.focus();
        }
    } else {
        host.focus();
    }
}
