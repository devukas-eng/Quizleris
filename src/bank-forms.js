// Forms for keeping the task bank: where imported or saved tasks go (their classification), what a
// change to many tasks sets, and a topic's own fields. Each builds its markup from the classifiers
// and gives back what was chosen; the workspace sends it to the server.
import { escapeHtml } from "./dom.js";
import { t } from "./lang.js";

const KEEP = "keep"; // a bulk change leaves this field as it is

const option = (value, label, selected = false) =>
    `<option value="${escapeHtml(String(value))}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
const numberOrNull = value => (value === "" || value == null ? null : Number(value));

/**
 * A subject's topics in tree order as <option>s, indented by depth. `exclude` leaves out a topic and
 * everything under it (a topic can't move inside itself).
 */
export function topicOptions(meta, subjectId, { selected = null, exclude = null } = {}) {
    const out = [];
    const walk = (topic, depth) => {
        if (topic.id === exclude) return;
        const name = `${" ".repeat(depth)}${topic.name}${topic.archived ? ` (${t("bank.archivedTopic")})` : ""}`;
        out.push(option(topic.id, name, topic.id === selected));
        meta.childrenOf(topic.id).forEach(child => walk(child, depth + 1));
    };
    meta.childrenOf(`s${subjectId}`).forEach(topic => walk(topic, 0));
    return out.join("");
}

function folderOptions(folders, selected) {
    const out = [];
    const walk = (parentId, depth) => folders.filter(folder => (folder.parentId ?? null) === parentId).forEach(folder => {
        out.push(option(folder.id, `${" ".repeat(depth)}${folder.name}`, folder.id === selected));
        walk(folder.id, depth + 1);
    });
    walk(null, 0);
    return out.join("");
}

/**
 * Where tasks go: subject, grade, topic, difficulty, and for one's own tasks a folder; admins also
 * choose between the shared bank and their own (`scopes`). With `keep` every field starts at
 * "no change" and read() returns only what was set, as the `set` of a bulk change; otherwise read()
 * returns the `defaults` of an import.
 */
export function classifyFields(meta, {
    subjects, subjectId = null, gradeId = null, topicId = null, difficultyId = null,
    keep = false, scopes = null, scope = "mine", folders = [], folderId = null
}) {
    let chosenScope = scope;
    const el = document.createElement("div");
    el.className = `bank-classify${keep ? " is-bulk" : ""}`;
    const keepOption = keep ? option(KEEP, t("bank.keep"), true) : "";
    const emptyOption = (selected, label = "—") => option("", keep ? t("bank.clear") : label, !keep && selected);
    el.innerHTML = `
        ${scopes ? `<div class="bank-classify-scope" role="radiogroup" aria-label="${t("bank.whereTo")}">
            ${scopes.map(s => `<button type="button" class="bank-chip${s === scope ? " is-on" : ""}" role="radio" aria-checked="${s === scope}" data-scope="${s}">${t(s === "shared" ? "bank.sharedBank" : "bank.mine")}</button>`).join("")}
        </div>` : ""}
        <label class="bank-field">${t("bank.subject")}
            <select data-field="subject">${keepOption}${subjects.map(s => option(s.id, `${s.icon || ""} ${s.name}`.trim(), !keep && s.id === subjectId)).join("")}</select></label>
        <label class="bank-field">${t("bank.grade")}
            <select data-field="grade">${keepOption}${emptyOption(gradeId == null)}${meta.grades.map(g => option(g.id, g.label, !keep && g.id === gradeId)).join("")}</select></label>
        <label class="bank-field bank-field-wide">${t("bank.topic")}
            <select data-field="topic"></select></label>
        <label class="bank-field">${t("bank.level")}
            <select data-field="difficulty">${keepOption}${emptyOption(difficultyId == null)}${meta.difficulties.map(d => option(d.id, d.name, !keep && d.id === difficultyId)).join("")}</select></label>
        <label class="bank-field bank-field-folder">${t("bank.folder")}
            <select data-field="folder">${keepOption}${emptyOption(folderId == null, t("bank.folderNone"))}${folderOptions(folders, keep ? null : folderId)}</select></label>`;
    const field = name => el.querySelector(`[data-field="${name}"]`);

    // Topics follow the chosen subject (or, in a bulk change left at "no change", the bank's own)
    const fillTopics = selected => {
        const subject = field("subject").value === KEEP ? subjectId : numberOrNull(field("subject").value);
        field("topic").innerHTML = keepOption + emptyOption(selected == null, t("bank.noTopic")) + topicOptions(meta, subject, { selected: keep ? null : selected });
    };
    fillTopics(topicId);
    field("subject").addEventListener("change", () => fillTopics(null));
    const showFolder = () => { el.querySelector(".bank-field-folder").hidden = chosenScope !== "mine"; };
    showFolder();
    el.addEventListener("click", e => {
        const chip = e.target.closest("[data-scope]");
        if (!chip) return;
        chosenScope = chip.dataset.scope;
        el.querySelectorAll("[data-scope]").forEach(other => {
            other.classList.toggle("is-on", other === chip);
            other.setAttribute("aria-checked", String(other === chip));
        });
        showFolder();
    });

    const NAMES = [["subject", "subjectId"], ["grade", "gradeId"], ["topic", "topicId"], ["difficulty", "difficultyId"], ["folder", "folderId"]];
    return {
        el,
        read() {
            if (keep) {
                const set = {};
                for (const [name, key] of NAMES) {
                    if (name === "folder" && chosenScope !== "mine") continue;
                    const value = field(name).value;
                    if (value !== KEEP) set[key] = numberOrNull(value);
                }
                return { scope: chosenScope, set };
            }
            const defaults = Object.fromEntries(NAMES.map(([name, key]) => [key, numberOrNull(field(name).value)]));
            if (chosenScope !== "mine") delete defaults.folderId;
            return { scope: chosenScope, defaults };
        }
    };
}

/**
 * A topic's own fields: name, description, where it sits in the tree, and the curriculum rows
 * (grade, course, yearly hours, what that grade learns). read() gives the body of
 * POST /api/bank/topics (new) or PATCH /api/bank/topics/:id.
 */
export function topicFields(meta, { topic = null, subjectId, parentId = null }) {
    const courses = meta.dimensions.find(d => d.name === "Kursas")?.values || [];
    const el = document.createElement("form");
    el.className = "bank-topic-form";
    el.noValidate = true;
    const parent = topic ? topic.parentId : parentId;
    el.innerHTML = `
        <label class="bank-field bank-field-wide">${t("bank.topicName")}
            <input name="name" maxlength="160" required value="${escapeHtml(topic?.name || "")}"></label>
        <label class="bank-field bank-field-wide">${t("bank.topicDescription")}
            <textarea name="description" rows="3" maxlength="2000">${escapeHtml(topic?.description || "")}</textarea></label>
        <label class="bank-field bank-field-wide">${t("bank.topicParent")}
            <select name="parent">${option("", t("bank.topLevel"), parent == null)}${topicOptions(meta, subjectId, { selected: parent, exclude: topic?.id })}</select></label>
        <fieldset class="bank-topic-grades">
            <legend>${t("bank.curriculum")}</legend>
            <div class="bank-topic-rows"></div>
            <button type="button" class="bank-link" data-act="add-grade">+ ${t("bank.addGrade")}</button>
        </fieldset>
        ${topic ? `<label class="bank-check"><input type="checkbox" name="archived"${topic.archived ? " checked" : ""}> ${t("bank.topicArchived")}</label>` : ""}`;
    const rows = el.querySelector(".bank-topic-rows");
    const addRow = (row = {}) => {
        const div = document.createElement("div");
        div.className = "bank-topic-row";
        div.innerHTML = `
            <select data-row="grade" aria-label="${t("bank.grade")}">${meta.grades.map(g => option(g.id, g.label, g.id === row.grade)).join("")}</select>
            ${courses.length ? `<select data-row="course" aria-label="${t("bank.course")}">${option("", t("bank.wholeClass"), row.course == null)}${courses.map(c => option(c.id, c.name, c.id === row.course)).join("")}</select>` : ""}
            <input data-row="hours" type="number" min="0" max="999" placeholder="${t("bank.hoursShort")}" aria-label="${t("bank.hoursShort")}" value="${row.hours ?? ""}">
            <button type="button" class="bank-icon-btn" data-act="remove-grade" aria-label="${t("bank.remove")}" title="${t("bank.remove")}">×</button>
            <textarea data-row="description" rows="2" maxlength="2000" placeholder="${t("bank.gradeLearns")}" aria-label="${t("bank.gradeLearns")}">${escapeHtml(row.description || "")}</textarea>`;
        rows.appendChild(div);
    };
    (topic?.grades || []).forEach(addRow);
    el.addEventListener("click", e => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "add-grade") addRow();
        else if (act === "remove-grade") e.target.closest(".bank-topic-row").remove();
    });
    const value = name => el.elements[name]?.value ?? "";
    return {
        el,
        read() {
            const body = {
                name: value("name").trim(),
                description: value("description").trim() || null,
                parentId: numberOrNull(value("parent")),
                grades: [...rows.children].map(row => ({
                    grade: Number(row.querySelector('[data-row="grade"]').value),
                    course: numberOrNull(row.querySelector('[data-row="course"]')?.value ?? ""),
                    hours: numberOrNull(row.querySelector('[data-row="hours"]').value),
                    description: row.querySelector('[data-row="description"]').value.trim() || null
                }))
            };
            if (topic) body.archived = !!el.elements.archived?.checked;
            else body.subjectId = subjectId;
            return body;
        }
    };
}
