// The header's theme button: a short list (recent themes, then the classics) and a way into
// the full gallery (theme-store.js, loaded on first open). Phones get a row of bubbles instead.
import { getLanguage, t } from "./lang.js";
import { logEvent } from "./analytics.js";
import { escapeHtml } from "./dom.js";
import {
    THEMES, DEFAULT_THEME_ID, applyTheme, findTheme, savedThemeId, recentThemeIds, themeName, swatch,
} from "./themes.js";

const SHORT_LIST = 5;
// Same width as style.css's phone header
const phoneHeader = window.matchMedia("(max-width: 600px)");

let current = null;
let popupOpen = false;
let beforeOpen = () => {};

export function currentTheme() {
    return current;
}

/** Makes `theme` the saved choice and shows it */
export function setTheme(theme) {
    current = theme;
    applyTheme(theme, { persist: true });
    refreshThemePicker();
    logEvent("theme", "change", { theme: theme.custom ? "custom" : theme.id });
}

/** Shows a theme without saving it (hover, gallery preview) */
export function previewTheme(theme) {
    applyTheme(theme);
}

/** Back to the saved theme after a preview */
export function restoreTheme() {
    if (current) applyTheme(current);
}

/** The saved theme again, or the default when the saved one was deleted */
export function reloadSavedTheme() {
    const theme = findTheme(savedThemeId()) || findTheme(DEFAULT_THEME_ID);
    if (theme.id !== current?.id) setTheme(theme);
    else { current = theme; applyTheme(theme, { persist: true }); refreshThemePicker(); }
}

function shortList() {
    const ids = [current.id, ...recentThemeIds(), ...THEMES.slice(0, 4).map(th => th.id)];
    const list = [];
    for (const id of ids) {
        if (list.length >= SHORT_LIST) break;
        if (list.some(th => th.id === id)) continue;
        const theme = findTheme(id);
        if (theme) list.push(theme);
    }
    return list;
}

function subtitle(theme) {
    return theme.custom ? t("themes.customSubtitle") : theme.subtitle;
}

export function refreshThemePicker() {
    if (!current) return;
    const lang = getLanguage();
    const label = document.getElementById("theme-btn-label");
    if (label) label.textContent = themeName(current, lang);
    const btn = document.getElementById("theme-btn");
    if (btn) btn.title = t("themes.button");

    const list = shortList();
    const popup = document.getElementById("theme-picker-popup");
    if (popup) {
        popup.setAttribute("aria-label", t("themes.label"));
        popup.innerHTML = `<div class="theme-picker-label">${escapeHtml(t("themes.label"))}</div>` +
            list.map(theme => `
                <div class="theme-picker-item${theme.id === current.id ? " active" : ""}" data-theme="${escapeHtml(theme.id)}"
                     role="option" tabindex="0" aria-selected="${theme.id === current.id}">
                    <div><div class="tp-name">${escapeHtml(themeName(theme, lang))}</div><div class="tp-subtitle">${escapeHtml(subtitle(theme))}</div></div>
                    <span class="tp-bubble" style="background: ${swatch(theme)};"></span>
                </div>`).join("") +
            `<div class="theme-picker-sep" role="presentation"></div>
             <div class="theme-picker-item theme-picker-more" data-theme-more role="button" tabindex="0">
                <div><div class="tp-name">${escapeHtml(t("themes.all"))}</div><div class="tp-subtitle">${escapeHtml(t("themes.allSubtitle"))}</div></div>
                <span class="tp-bubble tp-bubble-more" aria-hidden="true">🎨</span>
             </div>`;
    }
    const row = document.getElementById("theme-row");
    if (row) {
        row.setAttribute("aria-label", t("themes.label"));
        row.innerHTML = list.map(theme => {
            const name = escapeHtml(themeName(theme, lang));
            return `<button type="button" class="theme-row-item${theme.id === current.id ? " active" : ""}" data-theme="${escapeHtml(theme.id)}"
                role="option" aria-selected="${theme.id === current.id}" title="${name}" aria-label="${name}"
                style="background: ${swatch(theme)};"></button>`;
        }).join("") +
            `<button type="button" class="theme-row-item theme-row-more" data-theme-more title="${escapeHtml(t("themes.all"))}"
                aria-label="${escapeHtml(t("themes.all"))}">🎨</button>`;
    }
}

function openPopup() {
    const btn = document.getElementById("theme-btn");
    const popup = document.getElementById("theme-picker-popup");
    const row = document.getElementById("theme-row");
    if (!btn || !popup) return;
    beforeOpen();
    if (phoneHeader.matches && row) {
        row.classList.add("open");
    } else {
        const rect = btn.getBoundingClientRect();
        popup.style.top = (rect.bottom + 8) + "px";
        popup.style.right = (window.innerWidth - rect.right) + "px";
        popup.style.left = "auto";
        popup.classList.add("open");
    }
    btn.setAttribute("aria-expanded", "true");
    popupOpen = true;
}

export function closeThemePicker() {
    document.getElementById("theme-picker-popup")?.classList.remove("open");
    document.getElementById("theme-row")?.classList.remove("open");
    document.getElementById("theme-btn")?.setAttribute("aria-expanded", "false");
    if (popupOpen) restoreTheme();
    popupOpen = false;
}

/** Opens the full gallery (its code loads on first use) */
export function openThemeStore() {
    closeThemePicker();
    import("./theme-store.js")
        .then(m => m.openThemeStore())
        .catch(error => console.error("The theme gallery could not be loaded", error));
}

function choose(item) {
    if (item.hasAttribute("data-theme-more")) {
        openThemeStore();
        return;
    }
    const theme = findTheme(item.dataset.theme);
    if (theme) setTheme(theme);
    closeThemePicker();
}

/**
 * Restores the saved theme and wires the header button.
 * `onOpen` runs before the list opens (the language menu closes itself there).
 */
export function initThemePicker({ onOpen } = {}) {
    if (onOpen) beforeOpen = onOpen;
    current = findTheme(savedThemeId()) || findTheme(DEFAULT_THEME_ID);
    // Also re-saves the theme's CSS, which the page's first script applies before painting
    applyTheme(current, { persist: true });
    refreshThemePicker();

    document.getElementById("theme-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (popupOpen) closeThemePicker();
        else openPopup();
    });

    for (const id of ["theme-picker-popup", "theme-row"]) {
        const box = document.getElementById(id);
        if (!box) continue;
        box.addEventListener("click", (e) => {
            const item = e.target.closest(".theme-picker-item, .theme-row-item");
            if (!item) return;
            e.stopPropagation();
            choose(item);
        });
        box.addEventListener("keydown", (e) => {
            const item = e.target.closest(".theme-picker-item");
            if (!item || (e.key !== "Enter" && e.key !== " ")) return;
            e.preventDefault();
            choose(item);
        });
    }
    // Pointing at a theme in the popup shows it until the pointer leaves
    const popup = document.getElementById("theme-picker-popup");
    popup?.addEventListener("mouseover", (e) => {
        const item = e.target.closest(".theme-picker-item[data-theme]");
        const theme = item && findTheme(item.dataset.theme);
        if (theme) previewTheme(theme);
    });
    popup?.addEventListener("mouseleave", restoreTheme);

    window.addEventListener("click", () => { if (popupOpen) closeThemePicker(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && popupOpen) closeThemePicker(); });
}
