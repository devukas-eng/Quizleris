// The theme gallery ("store") and the editor for themes of your own. Loaded on first open from
// theme-picker.js. Every card previews its theme through CSS variables set on the card alone;
// "try it on" shows a theme on the whole page with a bar to apply or go back.
import { t, getLanguage } from "./lang.js";
import { escapeHtml } from "./dom.js";
import { confirmDialog } from "./dialog.js";
import {
    FONTS, EFFECTS, RANGES, MAX_CUSTOM_THEMES, DEFAULT_THEME_ID, allThemes, findTheme, upsertCustomTheme,
    deleteCustomTheme, copyTheme, sanitizeTheme, encodeShareCode, decodeShareCode, readability,
    fixReadability, themeName, previewStyle, withBase, randomTheme,
} from "./themes.js";
import { currentTheme, setTheme, previewTheme, restoreTheme, reloadSavedTheme, refreshThemePicker } from "./theme-picker.js";

const FILTERS = ["all", "light", "dark", "mine"];
const MAIN_COLORS = ["bg", "surface", "text", "accent", "accent2"];
const MORE_COLORS = ["danger", "success"];
const HEX_INPUT_RE = /^#?([0-9a-f]{6})$/i;

const state = {
    view: "gallery",      // "gallery" | "editor"
    filter: "all",
    draft: null,          // the theme being edited
    share: null,          // { name, code } shown above the grid
    message: "",
    tryOn: null,          // { theme, fromEditor }
    lastFocus: null,
};
let overlay;
let tryOnBar;

function fill(key, values) {
    return Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, v), t(key));
}

// ── Open / close ────────────────────────────────────────────────────────────

export function openThemeStore() {
    if (!overlay) build();
    state.lastFocus = document.activeElement;
    state.view = "gallery";
    state.share = null;
    state.message = "";
    overlay.hidden = false;
    document.body.classList.add("ts-open");
    render();
    // Reading the layout commits the closed state, so adding the class runs the fade-in.
    // (requestAnimationFrame would never fire in a background tab, leaving the sheet invisible.)
    void overlay.offsetWidth;
    overlay.classList.add("open");
    overlay.querySelector(".ts-close").focus();
}

function closeStore() {
    endTryOn(false);
    overlay.classList.remove("open");
    overlay.hidden = true;
    document.body.classList.remove("ts-open");
    restoreTheme();
    refreshThemePicker();
    state.lastFocus?.focus?.();
}

function build() {
    overlay = document.createElement("div");
    overlay.className = "ts-overlay";
    overlay.id = "theme-store";
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="ts-sheet" role="dialog" aria-modal="true" aria-labelledby="ts-title">
            <header class="ts-head">
                <h2 id="ts-title"></h2>
                <button type="button" class="ts-close" data-act="close">✕</button>
            </header>
            <div class="ts-body"></div>
        </div>`;
    document.body.appendChild(overlay);

    tryOnBar = document.createElement("div");
    tryOnBar.className = "ts-tryon";
    tryOnBar.hidden = true;
    tryOnBar.setAttribute("role", "region");
    tryOnBar.innerHTML = `
        <span class="ts-tryon-label" aria-live="polite"></span>
        <button type="button" class="btn btn-secondary" data-act="tryon-back"></button>
        <button type="button" class="btn btn-primary" data-act="tryon-apply"></button>`;
    document.body.appendChild(tryOnBar);

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) { closeStore(); return; }
        const btn = e.target.closest("[data-act]");
        if (btn) act(btn.dataset.act, btn);
    });
    tryOnBar.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (btn) act(btn.dataset.act, btn);
    });
    overlay.addEventListener("input", onInput);
    overlay.addEventListener("submit", (e) => {
        e.preventDefault();
        if (e.target.matches("[data-form=import]")) importCode(e.target.elements.code.value);
    });
    document.addEventListener("keydown", onKey);
}

function onKey(e) {
    if (state.tryOn) {
        if (e.key === "Escape") { e.preventDefault(); endTryOn(true); }
        return;
    }
    if (!overlay || overlay.hidden) return;
    if (e.key === "Escape" && !document.querySelector(".app-dialog-overlay.open")) {
        e.preventDefault();
        if (state.view === "editor") showGallery();
        else closeStore();
        return;
    }
    // Keep Tab inside the sheet
    if (e.key === "Tab") {
        const items = [...overlay.querySelectorAll("button, input, select, textarea, summary, [tabindex]:not([tabindex='-1'])")]
            .filter(el => !el.disabled && el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
}

// ── Actions ─────────────────────────────────────────────────────────────────

function themeOf(btn) {
    return findTheme(btn.closest("[data-id]")?.dataset.id);
}

async function act(name, btn) {
    const d = state.draft;
    switch (name) {
        case "close": closeStore(); break;
        case "filter": state.filter = btn.dataset.value; state.share = null; render(); break;
        case "try": startTryOn(themeOf(btn), false); break;
        case "create": openEditor(copyTheme(currentTheme(), t("themes.namePlaceholder"))); break;
        case "copy": openEditor(copyTheme(themeOf(btn), themeName(themeOf(btn), getLanguage()))); break;
        case "edit": openEditor(sanitizeTheme(themeOf(btn))); break;
        case "share": {
            const theme = themeOf(btn);
            state.share = { name: themeName(theme), code: encodeShareCode(theme) };
            render();
            overlay.querySelector(".ts-share input")?.select();
            break;
        }
        case "share-close": state.share = null; render(); break;
        case "copy-code": copyCode(btn); break;
        case "delete": await removeTheme(themeOf(btn)); break;
        case "reset": setTheme(findTheme(DEFAULT_THEME_ID)); render(); break;
        // Editor
        case "back": showGallery(); break;
        case "base": state.draft = withBase(d, btn.dataset.value); renderKeepingFocus(btn); break;
        case "random": state.draft = { ...randomTheme(d.base), id: d.id, name: d.name }; renderKeepingFocus(btn); break;
        case "font": d.font = btn.dataset.value; renderKeepingFocus(btn); break;
        case "effect": d.effect.kind = btn.dataset.value; renderKeepingFocus(btn); break;
        case "fix": state.draft = fixReadability(d); renderKeepingFocus(overlay.querySelector("[data-act=save]")); break;
        case "tryon-draft": startTryOn(sanitizeTheme({ ...d }), true); break;
        case "save": saveDraft(); break;
        // Try-on bar
        case "tryon-back": endTryOn(true); break;
        case "tryon-apply": applyTryOn(); break;
    }
}

function showGallery() {
    state.view = "gallery";
    state.draft = null;
    render();
    overlay.querySelector(".ts-close").focus();
}

function openEditor(theme) {
    state.view = "editor";
    state.draft = theme;
    state.message = "";
    render();
    overlay.querySelector(".ts-body").scrollTop = 0;
    overlay.querySelector("input[name=name]")?.focus();
}

async function removeTheme(theme) {
    if (!theme?.custom) return;
    const ok = await confirmDialog({
        title: t("themes.deleteTitle"),
        message: fill("themes.deleteConfirm", { name: themeName(theme) }),
        confirmText: t("themes.delete"),
        danger: true,
    });
    if (!ok) return;
    deleteCustomTheme(theme.id);
    if (state.share) state.share = null;
    reloadSavedTheme();
    render();
}

function copyCode(btn) {
    const input = overlay.querySelector(".ts-share input");
    const done = () => { btn.textContent = t("themes.copied"); };
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(input.value).then(done, () => { input.select(); });
    } else {
        input.select();
    }
}

function importCode(code) {
    const theme = decodeShareCode(code);
    if (!theme) {
        state.message = t("themes.importBad");
    } else {
        const saved = upsertCustomTheme({ ...theme, id: undefined });
        if (!saved) state.message = fill("themes.full", { n: MAX_CUSTOM_THEMES });
        else { state.message = fill("themes.importDone", { name: saved.name }); state.filter = "mine"; }
    }
    render();
    overlay.querySelector(".ts-import input")?.focus();
}

function saveDraft() {
    const clean = sanitizeTheme({ ...state.draft, name: state.draft.name.trim() || t("themes.namePlaceholder") });
    if (!readability(clean).ok) return;
    const saved = upsertCustomTheme(clean);
    if (!saved) {
        state.message = fill("themes.full", { n: MAX_CUSTOM_THEMES });
        updateLive();
        return;
    }
    setTheme(saved);
    state.filter = "mine";
    showGallery();
}

// ── Try on ──────────────────────────────────────────────────────────────────

function startTryOn(theme, fromEditor) {
    if (!theme) return;
    state.tryOn = { theme, fromEditor };
    previewTheme(theme);
    overlay.classList.add("is-trying");
    tryOnBar.querySelector(".ts-tryon-label").textContent = fill("themes.previewing", { name: themeName(theme, getLanguage()) });
    tryOnBar.querySelector("[data-act=tryon-back]").textContent = fromEditor ? t("themes.back") : t("themes.cancel");
    tryOnBar.querySelector("[data-act=tryon-apply]").textContent = fromEditor ? t("themes.save") : t("themes.apply");
    tryOnBar.hidden = false;
    tryOnBar.querySelector("[data-act=tryon-apply]").focus();
}

function endTryOn(backToSheet) {
    if (!state.tryOn) return;
    state.tryOn = null;
    tryOnBar.hidden = true;
    overlay.classList.remove("is-trying");
    restoreTheme();
    if (backToSheet) overlay.querySelector(".ts-close")?.focus();
}

function applyTryOn() {
    const { theme, fromEditor } = state.tryOn;
    endTryOn(false);
    if (fromEditor) { saveDraft(); return; }
    setTheme(theme);
    closeStore();
}

// ── Editor inputs ───────────────────────────────────────────────────────────

function onInput(e) {
    const el = e.target;
    const d = state.draft;
    if (!d || !el.name) return;
    if (el.name === "name") {
        d.name = el.value;
    } else if (el.name.startsWith("c-")) {
        const key = el.name.slice(2);
        d.colors[key] = el.value.toLowerCase();
        const hexField = overlay.querySelector(`input[name="h-${key}"]`);
        if (hexField) hexField.value = d.colors[key];
    } else if (el.name.startsWith("h-")) {
        const m = HEX_INPUT_RE.exec(el.value.trim());
        if (!m) return;
        const key = el.name.slice(2);
        d.colors[key] = "#" + m[1].toLowerCase();
        const colorField = overlay.querySelector(`input[name="c-${key}"]`);
        if (colorField) colorField.value = d.colors[key];
    } else if (el.type === "range") {
        const value = Number(el.value);
        if (el.name === "strength") d.effect.strength = value;
        else d[el.name] = value;
        const out = el.parentElement.querySelector("output");
        if (out) out.textContent = `${value}${el.dataset.unit || ""}`;
    } else {
        return;
    }
    updateLive();
}

/** Refreshes the editor's preview, readability note and save button without a full render */
function updateLive() {
    const d = state.draft;
    if (!d || state.view !== "editor") return;
    const theme = sanitizeTheme({ ...d });
    const live = overlay.querySelector(".ts-live-card");
    if (!theme || !live) return;
    live.setAttribute("style", previewStyle(theme));
    const read = readability(theme);
    const note = overlay.querySelector(".ts-read");
    note.className = `ts-read ${read.ok ? "is-ok" : "is-bad"}`;
    note.innerHTML = read.ok ? escapeHtml(t("themes.readOk"))
        : `<span>${escapeHtml(t("themes.readBad"))}</span> <button type="button" class="btn btn-secondary ts-fix" data-act="fix">${escapeHtml(t("themes.fix"))}</button>`;
    overlay.querySelector("[data-act=save]").disabled = !read.ok;
    overlay.querySelector("[data-act=tryon-draft]").disabled = !read.ok;
    overlay.querySelector(".ts-msg").textContent = state.message;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function render() {
    overlay.querySelector("#ts-title").textContent = state.view === "editor"
        ? t(findTheme(state.draft.id) ? "themes.editorEdit" : "themes.editorNew") : t("themes.storeTitle");
    const close = overlay.querySelector(".ts-close");
    close.setAttribute("aria-label", t("themes.close"));
    close.title = t("themes.close");
    overlay.querySelector(".ts-body").innerHTML = state.view === "editor" ? editorHtml() : galleryHtml();
    if (state.view === "editor") updateLive();
}

function renderKeepingFocus(btn) {
    const selector = btn?.dataset?.act ? `[data-act="${btn.dataset.act}"]${btn.dataset.value ? `[data-value="${btn.dataset.value}"]` : ""}` : null;
    render();
    if (selector) overlay.querySelector(selector)?.focus();
}

function mock() {
    return `
        <div class="ts-mock" aria-hidden="true">
            <div class="ts-mock-app">
                <div class="ts-mock-q">${escapeHtml(t("themes.sampleQuestion"))}</div>
                <div class="ts-mock-ans is-picked"><span>A</span>4</div>
                <div class="ts-mock-ans"><span>B</span>5</div>
                <div class="ts-mock-btn">${escapeHtml(t("themes.sampleButton"))}</div>
            </div>
        </div>`;
}

function iconBtn(act, icon, label) {
    return `<button type="button" class="ts-icon-btn" data-act="${act}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${icon}</button>`;
}

function cardHtml(theme, current, lang) {
    const name = escapeHtml(themeName(theme, lang));
    const sub = escapeHtml(theme.custom ? t("themes.customSubtitle") : theme.subtitle);
    const actions = theme.custom
        ? iconBtn("edit", "✎", t("themes.edit")) + iconBtn("share", "⤴", t("themes.share")) + iconBtn("delete", "🗑", t("themes.delete"))
        : iconBtn("copy", "✎", t("themes.copy"));
    const isCurrent = theme.id === current.id;
    return `
        <article class="ts-card${isCurrent ? " is-current" : ""}" data-id="${escapeHtml(theme.id)}" style="${escapeHtml(previewStyle(theme))}">
            <button type="button" class="ts-card-preview" data-act="try" aria-label="${escapeHtml(t("themes.tryOn"))}: ${name}">${mock()}</button>
            <div class="ts-card-foot">
                <div class="ts-card-text">
                    <div class="ts-card-name">${name}${isCurrent ? ` <span class="ts-badge">${escapeHtml(t("themes.current"))}</span>` : ""}</div>
                    <div class="ts-card-sub">${sub}</div>
                </div>
                <div class="ts-card-actions">${actions}</div>
            </div>
        </article>`;
}

function galleryHtml() {
    const lang = getLanguage();
    const current = currentTheme();
    const themes = allThemes().filter(theme =>
        state.filter === "all" ? true : state.filter === "mine" ? theme.custom : theme.base === state.filter);
    const filterLabels = { all: "themes.filterAll", light: "themes.filterLight", dark: "themes.filterDark", mine: "themes.filterMine" };
    const share = state.share ? `
        <div class="ts-share">
            <div class="ts-share-head">
                <strong>${escapeHtml(fill("themes.shareTitle", { name: state.share.name }))}</strong>
                ${iconBtn("share-close", "✕", t("themes.close"))}
            </div>
            <p>${escapeHtml(t("themes.shareHint"))}</p>
            <div class="ts-share-row">
                <input type="text" readonly value="${escapeHtml(state.share.code)}" aria-label="${escapeHtml(t("themes.share"))}">
                <button type="button" class="btn btn-primary" data-act="copy-code">${escapeHtml(t("themes.copyCode"))}</button>
            </div>
        </div>` : "";
    const grid = themes.length
        ? `<div class="ts-grid">${themes.map(theme => cardHtml(theme, current, lang)).join("")}</div>`
        : `<p class="ts-empty">${escapeHtml(t("themes.mineEmpty"))}</p>`;
    return `
        <div class="ts-toolbar">
            <div class="ts-filters" role="group">
                ${FILTERS.map(f => `<button type="button" data-act="filter" data-value="${f}" aria-pressed="${state.filter === f}">${escapeHtml(t(filterLabels[f]))}</button>`).join("")}
            </div>
            <button type="button" class="btn btn-primary" data-act="create">${escapeHtml(t("themes.create"))}</button>
        </div>
        ${share}
        ${grid}
        <div class="ts-foot">
            <form class="ts-import" data-form="import">
                <input type="text" name="code" placeholder="${escapeHtml(t("themes.importPlaceholder"))}" aria-label="${escapeHtml(t("themes.importPlaceholder"))}" spellcheck="false" autocomplete="off">
                <button type="submit" class="btn btn-secondary">${escapeHtml(t("themes.importBtn"))}</button>
            </form>
            <button type="button" class="ts-link" data-act="reset">${escapeHtml(t("themes.reset"))}</button>
        </div>
        <p class="ts-msg" role="status">${escapeHtml(state.message)}</p>`;
}

function colorField(key) {
    const value = state.draft.colors[key];
    const label = escapeHtml(t(`themes.color.${key}`));
    return `
        <div class="ts-color">
            <input type="color" id="ts-c-${key}" name="c-${key}" value="${value}">
            <label for="ts-c-${key}">${label}</label>
            <input type="text" class="ts-hex" name="h-${key}" value="${value}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="${label} (hex)">
        </div>`;
}

function rangeField(name, value, unit) {
    const [min, max] = RANGES[name];
    return `
        <label class="ts-range">
            <span>${escapeHtml(t(`themes.${name}`))}</span>
            <input type="range" name="${name}" min="${min}" max="${max}" step="1" value="${value}" data-unit="${unit}">
            <output>${value}${unit}</output>
        </label>`;
}

function chip(act, value, pressed, label, style = "") {
    return `<button type="button" class="ts-chip" data-act="${act}" data-value="${value}" aria-pressed="${pressed}"${style ? ` style="${escapeHtml(style)}"` : ""}>${label}</button>`;
}

function editorHtml() {
    const d = state.draft;
    return `
        <div class="ts-editor">
            <form class="ts-controls" novalidate>
                <div class="ts-row">
                    <label class="ts-field ts-name">
                        <span>${escapeHtml(t("themes.name"))}</span>
                        <input type="text" name="name" maxlength="30" value="${escapeHtml(d.name)}" placeholder="${escapeHtml(t("themes.namePlaceholder"))}">
                    </label>
                    <button type="button" class="btn btn-secondary ts-random" data-act="random">${escapeHtml(t("themes.random"))}</button>
                </div>
                <fieldset class="ts-group">
                    <legend>${escapeHtml(t("themes.base"))}</legend>
                    <div class="ts-chips">
                        ${chip("base", "light", d.base === "light", `☀️ ${escapeHtml(t("themes.baseLight"))}`)}
                        ${chip("base", "dark", d.base === "dark", `🌙 ${escapeHtml(t("themes.baseDark"))}`)}
                    </div>
                </fieldset>
                <fieldset class="ts-group">
                    <legend>${escapeHtml(t("themes.colors"))}</legend>
                    <div class="ts-colors">${MAIN_COLORS.map(colorField).join("")}</div>
                    <details class="ts-more">
                        <summary>${escapeHtml(t("themes.moreColors"))}</summary>
                        <div class="ts-colors">${MORE_COLORS.map(colorField).join("")}</div>
                    </details>
                </fieldset>
                <fieldset class="ts-group">
                    <legend>${escapeHtml(t("themes.shape"))}</legend>
                    ${rangeField("radius", d.radius, "px")}
                    ${rangeField("glass", d.glass, "%")}
                    ${rangeField("shadow", d.shadow, "%")}
                </fieldset>
                <fieldset class="ts-group">
                    <legend>${escapeHtml(t("themes.font"))}</legend>
                    <div class="ts-chips">
                        ${Object.keys(FONTS).map(f => chip("font", f, d.font === f, `<b>Aa</b> ${escapeHtml(t(`themes.font.${f}`))}`, `font-family: ${FONTS[f]}`)).join("")}
                    </div>
                </fieldset>
                <fieldset class="ts-group">
                    <legend>${escapeHtml(t("themes.effect"))}</legend>
                    <div class="ts-chips">
                        ${EFFECTS.map(k => chip("effect", k, d.effect.kind === k, escapeHtml(t(`themes.effect.${k}`)))).join("")}
                    </div>
                    ${rangeField("strength", d.effect.strength, "%")}
                </fieldset>
            </form>
            <aside class="ts-live">
                <div class="ts-live-card">${mock()}</div>
                <div class="ts-read" aria-live="polite"></div>
                <div class="ts-editor-actions">
                    <button type="button" class="btn btn-secondary" data-act="back">${escapeHtml(t("themes.back"))}</button>
                    <button type="button" class="btn btn-secondary" data-act="tryon-draft">${escapeHtml(t("themes.tryOn"))}</button>
                    <button type="button" class="btn btn-primary" data-act="save">${escapeHtml(t("themes.save"))}</button>
                </div>
                <p class="ts-msg" role="status"></p>
            </aside>
        </div>`;
}
