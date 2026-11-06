// Task cards of the admin's and creators' screens: the classification bar, the question as it reads,
// the edit form, and slim rows that open in place. A list of tasks can run to tens of thousands, so
// a row shows one line and fetches the full task only when opened.
import { fetchMeta, loadItems, forgetItems, updateItems, updateItem } from "./bank-api.js";
import { previewHtml } from "./bank-list.js";
import { alertDialog } from "./dialog.js";
import { skeletonHtml } from "./dom.js";
import { t } from "./lang.js";

let cachedMeta = null;

export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export async function ensureBankMeta() {
    if (cachedMeta) return cachedMeta;
    const res = await fetchMeta();
    if (!res.ok) return { subjects: [], grades: [], difficulties: [], topics: [], dimensions: [] };
    cachedMeta = {
        subjects: res.data.subjects || [],
        grades: res.data.grades || [],
        difficulties: res.data.difficulties || [],
        topics: res.data.topics || [],
        dimensions: res.data.dimensions || [],
    };
    return cachedMeta;
}

export function buildTopicOptionsHtml(meta, subjectId, selectedTopicId) {
    const topics = (meta?.topics || []).filter(tp => !tp.archived && (!subjectId || Number(tp.subjectId) === Number(subjectId)));
    const byParent = new Map();
    for (const tp of topics) {
        const key = tp.parentId || 0;
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key).push(tp);
    }
    const out = [];
    const walk = (parentId, depth) => {
        for (const tp of byParent.get(parentId) || []) {
            const indent = "\u00A0\u00A0".repeat(depth);
            const sel = Number(selectedTopicId) === Number(tp.id) ? " selected" : "";
            out.push(`<option value="${tp.id}"${sel}>${indent}${escapeHtml(tp.name)}</option>`);
            walk(tp.id, depth + 1);
        }
    };
    walk(0, 0);
    return out.join("");
}

export function renderClassificationBarHtml(meta, item) {
    const subjId = item.subjectId || meta.subjects[0]?.id || "";
    return `
        <div class="dash-bank-classify" data-classify-id="${item.id}">
            <label title="${escapeHtml(t("bank.subject"))}">
                <span>${escapeHtml(t("bank.subject"))}</span>
                <select class="admin-select-compact" name="subjectId">
                    <option value="">—</option>
                    ${meta.subjects.map(s => `<option value="${s.id}" ${Number(item.subjectId) === Number(s.id) ? "selected" : ""}>${escapeHtml(`${s.icon || ""} ${s.name}`.trim())}</option>`).join("")}
                </select>
            </label>
            <label title="${escapeHtml(t("bank.grade"))}">
                <span>${escapeHtml(t("bank.grade"))}</span>
                <select class="admin-select-compact" name="gradeId">
                    <option value="">—</option>
                    ${meta.grades.map(g => `<option value="${g.id}" ${Number(item.gradeId) === Number(g.id) ? "selected" : ""}>${escapeHtml(t("bank.gradeShort").replace("{n}", g.id))}</option>`).join("")}
                </select>
            </label>
            <label class="dash-bank-classify-topic" title="${escapeHtml(t("bank.topic"))}">
                <span>${escapeHtml(t("bank.topic"))}</span>
                <select class="admin-select-compact" name="topicId">
                    <option value="">${escapeHtml(t("bank.noTopic"))}</option>
                    ${buildTopicOptionsHtml(meta, subjId, item.topicId)}
                </select>
            </label>
            <label title="${escapeHtml(t("bank.level"))}">
                <span>${escapeHtml(t("bank.level"))}</span>
                <select class="admin-select-compact" name="difficultyId">
                    <option value="">—</option>
                    ${meta.difficulties.map(d => `<option value="${d.id}" ${Number(item.difficultyId) === Number(d.id) ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("")}
                </select>
            </label>
        </div>
    `;
}

export function readClassificationBar(barEl) {
    if (!barEl) return {};
    const val = (name) => {
        const v = barEl.querySelector(`[name="${name}"]`)?.value;
        return v ? Number(v) : null;
    };
    return {
        subjectId: val("subjectId"),
        gradeId: val("gradeId"),
        topicId: val("topicId"),
        difficultyId: val("difficultyId"),
    };
}

export function wireClassificationBars(container, meta, { autoSave = false } = {}) {
    container.querySelectorAll(".dash-bank-classify").forEach(bar => {
        const id = Number(bar.dataset.classifyId);
        const subjSel = bar.querySelector('[name="subjectId"]');
        const topicSel = bar.querySelector('[name="topicId"]');
        subjSel?.addEventListener("change", () => {
            const sId = subjSel.value ? Number(subjSel.value) : null;
            topicSel.innerHTML = `<option value="">${escapeHtml(t("bank.noTopic"))}</option>${buildTopicOptionsHtml(meta, sId, null)}`;
            if (autoSave) saveBarClassification(bar, id);
        });
        if (autoSave) {
            bar.querySelectorAll('select:not([name="subjectId"])').forEach(sel => {
                sel.addEventListener("change", () => saveBarClassification(bar, id));
            });
        }
    });
}

async function saveBarClassification(barEl, id) {
    const set = readClassificationBar(barEl);
    const res = await updateItems([id], set, "shared");
    if (!res.ok) await alertDialog(t("profile.loadError"), res.data?.error || "");
    forgetItems([id]);
}

export function renderBankTaskPreviewHtml(q) {
    if (!q) return "";
    const picture = src => (src ? `<img class="bank-q-img" src="${escapeHtml(src)}" alt="">` : "");
    const type = q.type || "multiple-choice";
    let answer;
    if (type === "multiple-choice") {
        answer = `<ol class="bank-q-choices">${(q.choices || []).map(choice => `
            <li class="${choice.isCorrect ? "is-correct" : ""}">${picture(choice.image)}<span class="bank-math">${escapeHtml(choice.text || "")}</span>${choice.isCorrect ? " ✓" : ""}</li>`).join("")}</ol>`;
    } else if (type === "numeric") {
        const tolerance = Number(q.toleranceValue) ? ` ± ${escapeHtml(String(q.toleranceValue))}` : "";
        answer = `<p class="bank-q-answer"><span>${escapeHtml(t("bank.answer"))}:</span> <b class="bank-math">${escapeHtml(String(q.correctAnswerNumber ?? "—"))}${tolerance}</b></p>`;
    } else if (type === "true-false") {
        answer = `<p class="bank-q-answer"><span>${escapeHtml(t("bank.answer"))}:</span> <b class="bank-math">${escapeHtml(q.isTrue ? t("bank.true") : t("bank.false"))}</b></p>`;
    } else if (type === "fill-blank") {
        answer = `<p class="bank-q-answer"><span>${escapeHtml(t("bank.answers"))}:</span> <b class="bank-math">${escapeHtml((q.blankAnswers || []).join("; ") || "—")}</b></p>`;
    } else {
        answer = `<p class="bank-q-note">${escapeHtml(t(type === "image-upload" ? "bank.upload" : "bank.freeText"))}</p>`;
    }
    return `
        <div class="dash-bank-task-preview">
            ${picture(q.image)}
            <div class="bank-q-prompt bank-math">${escapeHtml(q.prompt || "")}</div>
            ${answer}
        </div>
    `;
}

export function renderInlineTaskEditFormHtml(full) {
    const q = full?.content || {};
    const type = q.type || "multiple-choice";
    let answerFields = "";
    if (type === "multiple-choice") {
        answerFields = `
            <div class="dash-task-edit-choices">
                ${(q.choices || []).map((c, idx) => `
                    <label class="dash-task-edit-choice">
                        <input type="checkbox" data-choice-correct="${idx}" ${c.isCorrect ? "checked" : ""} title="${escapeHtml(t("admin.markCorrect"))}">
                        <input type="text" class="input-field" data-choice-text="${idx}" value="${escapeHtml(c.text || "")}">
                    </label>
                `).join("")}
            </div>
        `;
    } else if (type === "numeric") {
        answerFields = `
            <div class="dash-task-edit-row">
                <label>${escapeHtml(t("admin.numAnswer"))}
                    <input type="number" step="any" class="input-field" name="correctAnswerNumber" value="${escapeHtml(q.correctAnswerNumber ?? "")}">
                </label>
                <label>${escapeHtml(t("admin.numTolerance"))}
                    <input type="number" step="any" class="input-field" name="toleranceValue" value="${escapeHtml(q.toleranceValue ?? 0)}">
                </label>
            </div>
        `;
    } else if (type === "true-false") {
        answerFields = `
            <label class="dash-showcase-check">
                <input type="checkbox" name="isTrue" ${q.isTrue ? "checked" : ""}>
                <span>${escapeHtml(t("admin.isTrue"))}</span>
            </label>
        `;
    } else if (type === "fill-blank") {
        answerFields = `
            <label>${escapeHtml(t("admin.blankAnswers"))}
                <input type="text" class="input-field" name="blankAnswers" value="${escapeHtml((q.blankAnswers || []).join("; "))}">
            </label>
        `;
    }
    return `
        <form class="dash-task-edit-form" id="dash-task-form-${full.id}" data-edit-form="${full.id}" hidden>
            <label>${escapeHtml(t("admin.promptLabel"))}
                <textarea class="input-field" name="prompt" rows="2">${escapeHtml(q.prompt || "")}</textarea>
            </label>
            ${answerFields}
        </form>
    `;
}

// One spot on the card: Edit, and while editing Save and Cancel in its place, so they are in reach
// however long the form is. Both of those shrink the card back.
export function taskEditButtonsHtml(id) {
    return `
        <button type="button" class="btn btn-secondary btn-compact" data-toggle-edit="${id}">✎ ${escapeHtml(t("profile.edit"))}</button>
        <button type="submit" form="dash-task-form-${id}" class="btn btn-primary btn-compact" data-save-edit="${id}" hidden>${escapeHtml(t("adminGui.saveTaskChanges"))}</button>
        <button type="button" class="btn btn-secondary btn-compact" data-cancel-edit="${id}" hidden>${escapeHtml(t("dialog.cancel"))}</button>
    `;
}

export function wireInlineTaskEditors(container, fullItemsMap, { onSaved } = {}) {
    // The form takes the preview's place, so an open card is not both of them stacked
    const setEditing = (id, editing) => {
        const card = container.querySelector(`[data-bank-card="${id}"]`);
        if (!card) return;
        card.classList.toggle("is-editing", editing);
        card.querySelector(`[data-edit-form="${id}"]`).hidden = !editing;
        card.querySelector(`[data-toggle-edit="${id}"]`).hidden = editing;
        card.querySelector(`[data-save-edit="${id}"]`).hidden = !editing;
        card.querySelector(`[data-cancel-edit="${id}"]`).hidden = !editing;
        const preview = card.querySelector(".dash-bank-task-preview");
        if (preview) preview.hidden = editing;
    };
    container.querySelectorAll("[data-toggle-edit]").forEach(btn => {
        btn.addEventListener("click", () => setEditing(Number(btn.dataset.toggleEdit), true));
    });
    container.querySelectorAll("[data-cancel-edit]").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = Number(btn.dataset.cancelEdit);
            container.querySelector(`[data-edit-form="${id}"]`)?.reset();
            setEditing(id, false);
        });
    });
    container.querySelectorAll("[data-edit-form]").forEach(form => {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const id = Number(form.dataset.editForm);
            const full = fullItemsMap.get(id);
            if (!full) return;
            const content = JSON.parse(JSON.stringify(full.content || {}));
            content.prompt = form.prompt.value.trim();
            const type = content.type || "multiple-choice";
            if (type === "multiple-choice" && Array.isArray(content.choices)) {
                content.choices.forEach((c, idx) => {
                    const txt = form.querySelector(`[data-choice-text="${idx}"]`);
                    const chk = form.querySelector(`[data-choice-correct="${idx}"]`);
                    if (txt) c.text = txt.value;
                    if (chk) c.isCorrect = chk.checked;
                });
            } else if (type === "numeric") {
                content.correctAnswerNumber = Number(form.correctAnswerNumber?.value || 0);
                content.toleranceValue = Number(form.toleranceValue?.value || 0);
            } else if (type === "true-false") {
                content.isTrue = Boolean(form.isTrue?.checked);
            } else if (type === "fill-blank") {
                content.blankAnswers = String(form.blankAnswers?.value || "").split(";").map(s => s.trim()).filter(Boolean);
            }
            const card = form.closest(".dash-bank-card");
            // What the bar shows is what gets saved, an emptied field included
            const classified = readClassificationBar(card.querySelector(".dash-bank-classify"));
            const saveBtn = card.querySelector(`[data-save-edit="${id}"]`);
            saveBtn.disabled = true;
            const res = await updateItem(id, { content, ...classified });
            saveBtn.disabled = false;
            if (!res.ok) {
                await alertDialog(t("profile.loadError"), res.data?.error || "");
                return;
            }
            forgetItems([id]);
            // Only this card changes: the list keeps its place instead of reloading around it
            Object.assign(full, classified, { content });
            for (const field of form.elements) {
                field.defaultValue = field.value;
                field.defaultChecked = field.checked;
            }
            card.querySelector(".dash-bank-task-preview")?.remove();
            form.insertAdjacentHTML("beforebegin", renderBankTaskPreviewHtml(content));
            typesetMath(card.querySelector(".dash-bank-task-preview"));
            setEditing(id, false);
            onSaved?.(full);
        });
    });
}

export function typesetMath(el) {
    try {
        window.renderMathInElement?.(el, {
            delimiters: [{ left: "\\(", right: "\\)", display: false }, { left: "\\[", right: "\\]", display: true }],
            throwOnError: false,
        });
    } catch {
        // leave plain text if KaTeX is unavailable
    }
}

const ROW_HEIGHT = 52; // a slim row and the gap under it
const plainPreview = text => String(text ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/**
 * Slim task rows in `container`: one line each, opened and shrunk with a click on the row. Each add()
 * is one block the browser skips while it is off screen, and a row fetches its full task only when
 * opened, so opening a row costs the same at row 50 and row 10,000. Options:
 *   actionsHtml(item, full): the buttons of an open row, next to its type
 *   wire(row, item, full): connects them, once the row is filled
 *   labelsHtml(item): more labels for the row's line
 *   autoSave: a change in the classification bar is saved at once (otherwise the buttons read the bar)
 *   edit: the row has the edit form, whose Save shrinks the row back
 */
export function createTaskRows(container, meta, { actionsHtml = () => "", wire = () => {}, labelsHtml = () => "", autoSave = true, edit = true } = {}) {
    const topicNames = new Map(meta.topics.map(topic => [Number(topic.id), topic.name]));
    const levelNames = new Map(meta.difficulties.map(level => [Number(level.id), level.name]));
    const listed = new Map(); // id → the task as listed

    const rowLabels = (item) => [
        item.gradeId ? t("bank.gradeShort").replace("{n}", item.gradeId) : "",
        topicNames.get(Number(item.topicId)) || t("bank.noTopic"),
        levelNames.get(Number(item.difficultyId)) || "",
    ].filter(Boolean).map(label => `<span>${escapeHtml(label)}</span>`).join("") + labelsHtml(item);

    const rowHtml = (item) => `
        <div class="dash-bank-row" data-row="${item.id}">
            <button type="button" class="dash-bank-row-head" aria-expanded="false" title="${escapeHtml(t("adminGui.toggleTask"))}">
                <span class="dash-chip private">#${item.id}</span>
                <span class="dash-bank-row-text">${previewHtml(item)}</span>
                <span class="dash-bank-row-labels">${rowLabels(item)}</span>
                <svg class="dash-bank-row-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <div class="dash-bank-card dash-bank-row-body" data-bank-card="${item.id}" hidden></div>
        </div>
    `;

    const setOpen = (row, open) => {
        row.classList.toggle("is-open", open);
        row.querySelector(".dash-bank-row-head").setAttribute("aria-expanded", String(open));
        row.querySelector(".dash-bank-row-body").hidden = !open;
    };

    const refresh = (row, item) => {
        row.querySelector(".dash-bank-row-text").innerHTML = previewHtml(item);
        row.querySelector(".dash-bank-row-labels").innerHTML = rowLabels(item);
    };

    const fill = async (row, item) => {
        const body = row.querySelector(".dash-bank-row-body");
        row.dataset.filled = "true";
        body.innerHTML = skeletonHtml(1);
        forgetItems([item.id]);
        const [full] = await loadItems([item.id]);
        if (!full) {
            delete row.dataset.filled; // opening it again tries again
            body.innerHTML = `<p class="dash-muted">${escapeHtml(t("bank.loadFailed"))}</p>`;
            return;
        }
        // The list's copy can be behind what was just changed
        Object.assign(item, { preview: full.preview, gradeId: full.gradeId, topicId: full.topicId, difficultyId: full.difficultyId });
        refresh(row, item);
        const qtype = full.content?.type || "multiple-choice";
        body.innerHTML = `
            <div class="dash-bank-card-head">
                <span class="dash-muted">${escapeHtml(t(`bank.qtype.${qtype}`))}</span>
                <div class="dash-bank-head-actions">${actionsHtml(item, full)}</div>
            </div>
            ${renderClassificationBarHtml(meta, full)}
            ${renderBankTaskPreviewHtml(full.content)}
            ${edit ? renderInlineTaskEditFormHtml(full) : ""}
        `;
        typesetMath(body);
        wireClassificationBars(body, meta, { autoSave });
        if (edit) {
            wireInlineTaskEditors(row, new Map([[full.id, full]]), {
                // Saving is the end of the job: the row shrinks back, showing what was saved
                onSaved(saved) {
                    item.preview = plainPreview(saved.content.prompt);
                    refresh(row, item);
                    setOpen(row, false);
                },
            });
        }
        const bar = body.querySelector(".dash-bank-classify");
        bar.addEventListener("change", () => {
            Object.assign(item, readClassificationBar(bar));
            refresh(row, item);
        });
        wire(row, item, full);
    };

    // A row shrinks back with one click on its head; an edit in progress waits inside it
    container.addEventListener("click", (e) => {
        const head = e.target.closest(".dash-bank-row-head");
        if (!head || !container.contains(head)) return;
        const row = head.closest(".dash-bank-row");
        const open = !row.classList.contains("is-open");
        setOpen(row, open);
        if (open && !row.dataset.filled) fill(row, listed.get(Number(row.dataset.row)));
    });

    return {
        add(items) {
            if (!items.length) return;
            items.forEach(item => listed.set(item.id, item));
            // The browser's guess at the block's height until it is first shown: a short list stays short
            container.insertAdjacentHTML("beforeend", `<div class="dash-bank-page" style="contain-intrinsic-size:auto ${items.length * ROW_HEIGHT}px">${items.map(rowHtml).join("")}</div>`);
        },
        remove(id) {
            listed.delete(id);
            container.querySelector(`[data-row="${id}"]`)?.remove();
        },
        /** Shows an open row's task as it is now. */
        async reload(id) {
            const row = container.querySelector(`[data-row="${id}"]`);
            if (row && listed.has(id)) await fill(row, listed.get(id));
        },
        clear() {
            listed.clear();
            container.innerHTML = "";
        },
        get size() {
            return listed.size;
        },
    };
}

/**
 * Loads a long list a page at a time as its end comes near. fetchPage(cursor, signal) asks the server;
 * onPage(res, first) shows the page and gives the next cursor; onError(res) answers a first page that
 * failed. A later page that fails offers to try again, in `moreEl`, which also holds the row that
 * says more is coming. `root` is the element that scrolls.
 */
export function createPager(moreEl, { fetchPage, onPage, onError, root = document.getElementById("dashboard-body") }) {
    let cursor = null;
    let request = null;

    const load = async (from) => {
        request?.abort();
        const current = request = new window.AbortController();
        const res = await fetchPage(from, current.signal);
        if (current !== request || !moreEl.isConnected) return; // a newer list, or another tab
        request = null;
        if (!res.ok) {
            if (!from) {
                onError(res);
                return;
            }
            moreEl.innerHTML = `<button type="button" class="btn btn-secondary btn-compact">${escapeHtml(t("adminGui.retryLoad"))}</button>`;
            moreEl.querySelector("button").addEventListener("click", () => {
                moreEl.innerHTML = skeletonHtml(1);
                load(from);
            });
            return;
        }
        cursor = onPage(res, !from) || null;
        moreEl.innerHTML = cursor ? skeletonHtml(1) : "";
        // Still near the end after a short page: observing anew asks for the next one
        observer.unobserve(moreEl);
        observer.observe(moreEl);
    };

    const observer = new window.IntersectionObserver((entries) => {
        if (!moreEl.isConnected) {
            observer.disconnect();
            return;
        }
        if (entries.some(entry => entry.isIntersecting) && cursor && !request && !moreEl.querySelector("button")) load(cursor);
    }, { root, rootMargin: "800px 0px" });

    return {
        /** Lists from the start. */
        reset() {
            cursor = null;
            moreEl.innerHTML = "";
            load(null);
        },
    };
}
