// The admin's "All quizzes" tab: folders inside folders. Only the open folder's quizzes are
// fetched, and search runs on the server, so the list stays quick however many quizzes exist.
// Folders already seen show at once from memory and refresh quietly behind.
import { browseAdminQuizzes, createQuizFolder, updateQuizFolder, deleteQuizFolder, moveQuizzesToFolder, updateAdminQuiz } from "./api.js";
import { t } from "./lang.js";
import { escapeHtml, skeletonHtml } from "./dom.js";
import { confirmDialog, alertDialog } from "./dialog.js";
import { shareStripHtml } from "./share-links.js";

const FILTERS = ["featured", "public", "private", "mine"];
const SEARCH_DELAY_MS = 220;
const AUTOMATIC_NAMES = {
    teachers: "quizFolders.teachers",
    system: "quizFolders.system",
    "system-math": "adminGui.sectorMath",
    "system-cs": "adminGui.sectorCs",
    "system-lang": "adminGui.sectorLang",
};

// Kept between tab switches, so coming back finds the same folder
const view = { folderId: null, q: "", filter: "" };
const cache = new Map();

export const folderName = (folder) => (AUTOMATIC_NAMES[folder.system] ? t(AUTOMATIC_NAMES[folder.system]) : folder.name);

/** The folders as an indented list, each under its parent */
export function flattenTree(tree) {
    const children = new Map();
    tree.forEach(folder => {
        const key = folder.parentId ?? null;
        if (!children.has(key)) children.set(key, []);
        children.get(key).push(folder);
    });
    const rows = [];
    const walk = (parentId, depth) => {
        (children.get(parentId) || [])
            .sort((a, b) => folderName(a).localeCompare(folderName(b), "lt"))
            .forEach(folder => {
                rows.push({ folder, depth });
                walk(folder.id, depth + 1);
            });
    };
    walk(null, 0);
    return rows;
}

const viewKey = () => JSON.stringify(view);
const isSearching = () => Boolean(view.q.trim() || view.filter);

function countLabel(n) {
    return t(n === 1 ? "quizFolders.quizOne" : "quizFolders.quizMany").replace("{n}", n);
}

function folderTileHtml(folder) {
    const sub = folder.subfolders
        ? `${countLabel(folder.count)}, ${t("quizFolders.subfolders").replace("{n}", folder.subfolders)}`
        : countLabel(folder.count);
    const name = escapeHtml(folderName(folder));
    return `
        <div class="qb-folder${folder.system ? "" : " is-own"}">
            <button type="button" class="qb-folder-open" data-open-folder="${folder.id}">
                <span class="qb-folder-icon" aria-hidden="true">${folder.system?.startsWith("teacher-") ? "👤" : "📁"}</span>
                <span class="qb-folder-text">
                    <span class="qb-folder-name">${name}</span>
                    <span class="qb-folder-count">${escapeHtml(sub)}</span>
                </span>
            </button>
            ${folder.system ? "" : `
                <div class="qb-folder-actions">
                    <button type="button" class="btn btn-secondary btn-icon btn-compact" data-rename-folder="${folder.id}" title="${escapeHtml(t("quizFolders.rename"))}" aria-label="${escapeHtml(t("quizFolders.rename"))}: ${name}">✎</button>
                    <button type="button" class="btn btn-secondary btn-icon btn-compact dash-delete" data-delete-folder="${folder.id}" title="${escapeHtml(t("quizFolders.delete"))}" aria-label="${escapeHtml(t("quizFolders.delete"))}: ${name}">🗑</button>
                </div>`}
        </div>`;
}

function quizRowHtml(q, formatDate) {
    const isPublic = q.visibility === "public";
    const place = q.path?.length ? q.path.map(folderName).join(" / ") : "";
    const author = q.author ? t("adminGui.byAuthor").replace("{author}", q.author) : t("quizFolders.system");
    return `
        <div class="dash-quiz" data-glide>
            <div class="dash-quiz-main">
                <div class="dash-quiz-title-row">
                    <button type="button" class="dash-star-btn${q.featured ? " is-active" : ""}" data-feature-quiz="${escapeHtml(q.id)}" title="${escapeHtml(t("adminGui.featureToggle"))}" aria-label="${escapeHtml(t("adminGui.featureToggle"))}" aria-pressed="${Boolean(q.featured)}">★</button>
                    <div class="dash-quiz-title">${escapeHtml(q.title || "—")}</div>
                    ${q.featured ? `<span class="dash-chip featured">⭐ ${escapeHtml(t("adminGui.featuredBadge"))}</span>` : ""}
                </div>
                <div class="dash-quiz-meta">
                    <button type="button" class="dash-chip dash-chip-btn ${isPublic ? "public" : "private"}" data-toggle-vis="${escapeHtml(q.id)}" title="${escapeHtml(t("adminGui.toggleVisibility"))}">${isPublic ? t("profile.public") : t("profile.private")}</button>
                    <span class="dash-muted">${escapeHtml(t("adminGui.questionsCount").replace("{n}", q.question_count ?? 0))}</span>
                    <span class="dash-muted">· ${escapeHtml(author)}</span>
                    <span class="dash-muted">· ${t("profile.updated")} ${escapeHtml(formatDate(q.updated_at || q.created_at))}</span>
                    ${place ? `<button type="button" class="qb-place" data-open-folder="${q.path.at(-1).id}" title="${escapeHtml(t("quizFolders.openPlace"))}">📁 ${escapeHtml(place)}</button>` : ""}
                </div>
            </div>
            <div class="dash-quiz-actions">
                <a class="btn btn-secondary dash-results" href="/?dashboard=${encodeURIComponent(q.id)}">📊 ${t("results.open")}${q.attempts ? ` <span class="dash-count">${q.attempts}</span>` : ""}</a>
                <button class="btn btn-secondary" data-edit-quiz="${escapeHtml(q.id)}">${t("profile.edit")}</button>
                <button type="button" class="btn btn-secondary btn-icon" data-move-quiz="${escapeHtml(q.id)}" title="${escapeHtml(t("quizFolders.move"))}" aria-label="${escapeHtml(t("quizFolders.move"))}">📁</button>
                <button class="btn btn-secondary btn-icon dash-delete" data-delete-quiz="${escapeHtml(q.id)}" data-title="${escapeHtml(q.title || "")}" title="${t("profile.delete")}" aria-label="${t("profile.delete")}">🗑</button>
            </div>
            ${shareStripHtml(q)}
        </div>`;
}

/** Asks which folder to file a quiz in: the folder's id, null for its automatic place, undefined if cancelled */
function pickFolder(tree, quizTitle) {
    return new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.className = "app-dialog-overlay open qb-move-overlay";
        const rows = flattenTree(tree).map(({ folder, depth }) => `
            <button type="button" class="qb-move-row" data-pick="${folder.id}" style="--depth: ${depth}">
                <span aria-hidden="true">📁</span> ${escapeHtml(folderName(folder))}
            </button>`).join("");
        overlay.innerHTML = `
            <div class="app-dialog qb-move" role="dialog" aria-modal="true" aria-labelledby="qb-move-title">
                <h3 class="app-dialog-title" id="qb-move-title">${escapeHtml(t("quizFolders.moveTitle").replace("{title}", quizTitle))}</h3>
                <div class="qb-move-list">
                    <button type="button" class="qb-move-row is-auto" data-pick="auto">↩ ${escapeHtml(t("quizFolders.moveAuto"))}</button>
                    ${rows}
                </div>
                <div class="app-dialog-actions"><button type="button" class="btn" data-pick="cancel">${escapeHtml(t("dialog.cancel"))}</button></div>
            </div>`;
        const previous = document.activeElement;
        const finish = (value) => {
            overlay.remove();
            previous?.focus?.();
            resolve(value);
        };
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) return finish(undefined);
            const pick = e.target.closest("[data-pick]")?.dataset.pick;
            if (pick === "cancel") finish(undefined);
            else if (pick === "auto") finish(null);
            else if (pick) finish(Number(pick));
        });
        overlay.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            finish(undefined);
        });
        document.body.appendChild(overlay);
        overlay.querySelector(".qb-move-row").focus();
    });
}

/**
 * Draws the tab in `panel`. `ctx`: wireCards(listEl, onDeleted), createQuiz(),
 * formatDate(value), onCountsChange().
 */
export function renderQuizBrowser(panel, ctx) {
    panel.innerHTML = `
        <section class="dash-section qb">
            <div class="dash-section-head">
                <h3>${escapeHtml(t("adminGui.allQuizzesTitle"))} <span class="dash-muted" id="qb-total"></span></h3>
                <div class="qb-head-actions">
                    <button type="button" class="btn btn-secondary" id="qb-new-folder">${escapeHtml(t("quizFolders.new"))}</button>
                    <button type="button" class="btn btn-primary" id="qb-new-quiz">+ ${t("profile.createQuiz")}</button>
                </div>
            </div>
            <div class="dash-filter-bar">
                <input type="search" id="qb-search" class="input-field dash-search-input" placeholder="${escapeHtml(t("adminGui.searchQuizzes"))}" aria-label="${escapeHtml(t("adminGui.searchQuizzes"))}" value="${escapeHtml(view.q)}">
                <div class="dash-filter-chips" role="group" id="qb-filters"></div>
            </div>
            <nav class="qb-crumbs" id="qb-crumbs" aria-label="${escapeHtml(t("quizFolders.where"))}"></nav>
            <form class="qb-folder-form" id="qb-folder-form" hidden>
                <input type="text" class="input-field" name="name" maxlength="80" required autocomplete="off" aria-label="${escapeHtml(t("quizFolders.namePlaceholder"))}" placeholder="${escapeHtml(t("quizFolders.namePlaceholder"))}">
                <button type="submit" class="btn btn-primary btn-compact"></button>
                <button type="button" class="btn btn-secondary btn-compact" data-form-cancel>${escapeHtml(t("dialog.cancel"))}</button>
                <p class="qb-form-error" role="alert" hidden></p>
            </form>
            <div id="qb-content" aria-live="polite">${skeletonHtml(5)}</div>
        </section>`;

    const content = panel.querySelector("#qb-content");
    const crumbs = panel.querySelector("#qb-crumbs");
    const filters = panel.querySelector("#qb-filters");
    const total = panel.querySelector("#qb-total");
    const search = panel.querySelector("#qb-search");
    const form = panel.querySelector("#qb-folder-form");
    const formError = form.querySelector(".qb-form-error");
    let current = null;
    let renaming = null;
    let request = 0;
    let searchTimer = null;

    function drawChrome(data) {
        total.textContent = `(${data.counts.all})`;
        const chip = (id, label, count) => `
            <button type="button" class="dash-filter-chip${view.filter === id ? " is-active" : ""}" data-filter="${id}" aria-pressed="${view.filter === id}">${escapeHtml(label)} <span>${count}</span></button>`;
        const labels = {
            featured: t("adminGui.filterFeatured"),
            public: t("adminGui.filterPublic"),
            private: t("adminGui.filterPrivate"),
            mine: t("adminGui.sectorMine"),
        };
        filters.innerHTML = FILTERS.map(id => chip(id, labels[id], data.counts[id])).join("");

        if (isSearching()) {
            crumbs.innerHTML = `<span class="qb-crumb-note">${escapeHtml(t("quizFolders.searchEverywhere"))}</span>`;
            return;
        }
        const trail = [{ id: "", label: t("quizFolders.top") }, ...data.path.map(folder => ({ id: folder.id, label: folderName(folder) }))];
        crumbs.innerHTML = trail.map((step, i) => (i === trail.length - 1
            ? `<span class="qb-crumb is-here" aria-current="page">${escapeHtml(step.label)}</span>`
            : `<button type="button" class="qb-crumb" data-open-folder="${step.id}">${escapeHtml(step.label)}</button><span class="qb-crumb-sep" aria-hidden="true">/</span>`)).join("");
    }

    function drawContent(data) {
        const empty = !data.folders.length && !data.quizzes.length;
        const more = data.quizzes.length < data.total;
        content.innerHTML = `
            ${data.folders.length ? `<div class="qb-folders">${data.folders.map(folderTileHtml).join("")}</div>` : ""}
            ${data.quizzes.length ? `<div class="dash-quiz-list" id="qb-quizzes">${data.quizzes.map(q => quizRowHtml(q, ctx.formatDate)).join("")}</div>` : ""}
            ${more ? `<button type="button" class="btn btn-secondary qb-more" data-load-more>${escapeHtml(t("quizFolders.more").replace("{n}", data.total - data.quizzes.length))}</button>` : ""}
            ${empty ? `<div class="dash-empty"><p class="dash-muted">${escapeHtml(t(isSearching() ? "adminGui.noQuizzesMatch" : "quizFolders.empty"))}</p></div>` : ""}`;
        const list = content.querySelector("#qb-quizzes");
        if (list) ctx.wireCards(list, () => {
            cache.clear();
            ctx.onCountsChange();
            load();
        });
    }

    function draw(data) {
        current = data;
        drawChrome(data);
        drawContent(data);
    }

    /** Shows the current view: from memory right away if it has been open before, then fresh */
    async function load({ quiet = false } = {}) {
        const key = viewKey();
        const id = ++request;
        const known = cache.get(key);
        if (known) draw(known);
        else if (!quiet && !current) content.innerHTML = skeletonHtml(5);
        else content.setAttribute("aria-busy", "true");
        try {
            const data = await browseAdminQuizzes({ folder: view.folderId, q: view.q.trim(), filter: view.filter });
            if (id !== request) return;
            cache.set(key, data);
            content.removeAttribute("aria-busy");
            draw(data);
        } catch (error) {
            if (id !== request) return;
            content.removeAttribute("aria-busy");
            if (!known) content.innerHTML = `<div class="dash-empty"><p class="dash-muted">${escapeHtml(error.message)}</p></div>`;
        }
    }

    async function loadMore(btn) {
        btn.disabled = true;
        try {
            const data = await browseAdminQuizzes({ folder: view.folderId, q: view.q.trim(), filter: view.filter, offset: current.quizzes.length });
            current = { ...current, quizzes: [...current.quizzes, ...data.quizzes] };
            cache.set(viewKey(), current);
            drawContent(current);
        } catch (error) {
            btn.disabled = false;
            await alertDialog(t("profile.loadError"), error.message);
        }
    }

    function openFolder(id) {
        view.folderId = id ? Number(id) : null;
        view.q = "";
        view.filter = "";
        search.value = "";
        hideForm();
        panel.closest(".dash-body")?.scrollTo({ top: 0 });
        load();
    }

    function showForm(folder) {
        renaming = folder;
        form.hidden = false;
        formError.hidden = true;
        form.elements.name.value = folder ? folder.name : "";
        form.querySelector("button[type=submit]").textContent = t(folder ? "quizFolders.rename" : "quizFolders.create");
        form.elements.name.focus();
        form.elements.name.select();
    }

    function hideForm() {
        form.hidden = true;
        renaming = null;
    }

    function showFormError(res) {
        const known = { name_taken: "quizFolders.nameTaken", too_deep: "quizFolders.tooDeep" }[res.data?.code];
        formError.textContent = known ? t(known) : (res.data?.error || t("profile.loadError"));
        formError.hidden = false;
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = form.elements.name.value.trim();
        if (!name) return;
        const submit = form.querySelector("button[type=submit]");
        submit.disabled = true;
        const res = renaming
            ? await updateQuizFolder(renaming.id, { name })
            : await createQuizFolder(view.folderId, name);
        submit.disabled = false;
        if (!res.ok) {
            showFormError(res);
            return;
        }
        hideForm();
        cache.clear();
        load({ quiet: true });
    });
    form.querySelector("[data-form-cancel]").addEventListener("click", hideForm);
    form.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        hideForm();
    });

    async function removeFolder(folder) {
        const ok = await confirmDialog({
            title: t("quizFolders.deleteTitle").replace("{name}", folder.name),
            message: t("quizFolders.deleteBody"),
            confirmText: t("quizFolders.delete"),
            danger: true,
        });
        if (!ok) return;
        const res = await deleteQuizFolder(folder.id);
        if (!res.ok) {
            await alertDialog(t("profile.loadError"), res.data?.error || "");
            return;
        }
        cache.clear();
        load({ quiet: true });
    }

    async function moveQuiz(quiz) {
        const target = await pickFolder(current.tree, quiz.title || quiz.id);
        if (target === undefined) return;
        const res = await moveQuizzesToFolder([quiz.id], target);
        if (!res.ok) {
            await alertDialog(t("profile.loadError"), res.data?.error || "");
            return;
        }
        cache.clear();
        load({ quiet: true });
    }

    async function toggleFeatured(btn, quiz) {
        btn.disabled = true;
        const next = !quiz.featured;
        const res = await updateAdminQuiz(quiz.id, { featured: next, featured_order: next ? Date.now() % 100000 : 0 });
        btn.disabled = false;
        if (!res.ok) {
            await alertDialog(t("profile.loadError"), res.data?.error || "");
            return;
        }
        cache.clear();
        ctx.onCountsChange();
        document.dispatchEvent(new window.CustomEvent("quizleris-showcase-changed"));
        load({ quiet: true });
    }

    async function toggleVisibility(btn, quiz) {
        btn.disabled = true;
        const res = await updateAdminQuiz(quiz.id, { visibility: quiz.visibility === "public" ? "private" : "public" });
        btn.disabled = false;
        if (!res.ok) {
            await alertDialog(t("profile.loadError"), res.data?.error || "");
            return;
        }
        cache.clear();
        load({ quiet: true });
    }

    const quizOf = (id) => current?.quizzes.find(q => q.id === id);
    const ownFolderOf = (id) => current?.folders.find(folder => folder.id === Number(id));

    panel.addEventListener("click", (e) => {
        const on = (selector) => e.target.closest(selector);
        let el;
        if ((el = on("[data-open-folder]"))) openFolder(el.dataset.openFolder);
        else if ((el = on("[data-filter]"))) {
            view.filter = view.filter === el.dataset.filter ? "" : el.dataset.filter;
            load();
        }
        else if ((el = on("[data-load-more]"))) loadMore(el);
        else if ((el = on("[data-rename-folder]"))) showForm(ownFolderOf(el.dataset.renameFolder));
        else if ((el = on("[data-delete-folder]"))) removeFolder(ownFolderOf(el.dataset.deleteFolder));
        else if ((el = on("[data-move-quiz]"))) moveQuiz(quizOf(el.dataset.moveQuiz));
        else if ((el = on("[data-feature-quiz]"))) toggleFeatured(el, quizOf(el.dataset.featureQuiz));
        else if ((el = on("[data-toggle-vis]"))) toggleVisibility(el, quizOf(el.dataset.toggleVis));
    });

    panel.querySelector("#qb-new-folder").addEventListener("click", () => showForm(null));
    panel.querySelector("#qb-new-quiz").addEventListener("click", ctx.createQuiz);
    search.addEventListener("input", () => {
        view.q = search.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(load, SEARCH_DELAY_MS);
    });

    load();
}
