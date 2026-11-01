import { t } from "./lang.js";

// Styled replacements for window.confirm / window.alert. Both return Promises so callers can `await` them.

let overlay = null;
let activeResolve = null;

function ensureDialog() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "app-dialog-overlay";
    overlay.innerHTML = `
        <div class="app-dialog" role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-message">
            <div class="app-dialog-icon" aria-hidden="true"></div>
            <h3 class="app-dialog-title" id="app-dialog-title"></h3>
            <p class="app-dialog-message" id="app-dialog-message"></p>
            <div class="app-dialog-actions">
                <button type="button" class="btn app-dialog-cancel"></button>
                <button type="button" class="btn app-dialog-confirm"></button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector(".app-dialog-cancel").addEventListener("click", () => close(false));
    overlay.querySelector(".app-dialog-confirm").addEventListener("click", () => close(true));
    overlay.addEventListener("mousedown", (e) => {
        if (e.target === overlay) close(false);
    });
    overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            close(false);
        } else if (e.key === "Tab") {
            // Keep focus inside the dialog
            const buttons = [...overlay.querySelectorAll("button:not([hidden])")];
            const idx = buttons.indexOf(document.activeElement);
            const next = e.shiftKey ? (idx <= 0 ? buttons.length - 1 : idx - 1) : (idx + 1) % buttons.length;
            e.preventDefault();
            buttons[next].focus();
        }
    });
    return overlay;
}

let returnFocusTo = null;

function close(result) {
    if (!overlay || !activeResolve) return;
    overlay.classList.remove("open");
    const resolve = activeResolve;
    activeResolve = null;
    if (returnFocusTo && typeof returnFocusTo.focus === "function") returnFocusTo.focus();
    resolve(result);
}

function open({ title, message, confirmText, cancelText, tone, showCancel }) {
    const el = ensureDialog();
    if (activeResolve) close(false);

    el.querySelector(".app-dialog").dataset.tone = tone;
    el.querySelector(".app-dialog-icon").textContent = tone === "danger" ? "!" : tone === "info" ? "i" : "?";
    el.querySelector(".app-dialog-title").textContent = title || "";
    el.querySelector(".app-dialog-message").textContent = message || "";
    el.querySelector(".app-dialog-message").hidden = !message;

    const cancelBtn = el.querySelector(".app-dialog-cancel");
    cancelBtn.textContent = cancelText || t("dialog.cancel");
    cancelBtn.hidden = !showCancel;

    const confirmBtn = el.querySelector(".app-dialog-confirm");
    confirmBtn.textContent = confirmText || t("dialog.ok");
    confirmBtn.className = `btn app-dialog-confirm ${tone === "danger" ? "btn-danger" : "btn-primary"}`;

    returnFocusTo = document.activeElement;
    el.classList.add("open");
    // Destructive dialogs focus Cancel so a stray Enter doesn't delete anything
    (tone === "danger" && showCancel ? cancelBtn : confirmBtn).focus();

    return new Promise(resolve => { activeResolve = resolve; });
}

/**
 * @param {{ title: string, message?: string, confirmText?: string, cancelText?: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmText, cancelText, danger = false }) {
    return open({
        title,
        message,
        confirmText: confirmText || t("dialog.confirm"),
        cancelText,
        tone: danger ? "danger" : "question",
        showCancel: true
    });
}

/**
 * @param {string} title
 * @param {string} [message]
 * @returns {Promise<boolean>}
 */
export function alertDialog(title, message) {
    return open({ title, message, tone: "info", showCancel: false });
}
