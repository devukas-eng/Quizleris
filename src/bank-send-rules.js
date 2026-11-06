// The thinking behind the send window (bank-send.js), kept apart from the page: finding a topic by
// typing, reading what a #tag's name suggests, and what a task still needs before it can go.

const MAX_RESULTS = 30;
const MAX_HINTS = 4;
const MIN_WORD = 3;

/** Lower case without diacritics, so "lygtys" finds "Lygtys" and "ls" nothing odd. */
export function fold(text) {
    return String(text ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** Topics by ID and their children, built once per window. */
export function topicIndex(meta) {
    const byId = new Map(meta.topics.map(topic => [topic.id, topic]));
    const children = new Map();
    for (const topic of meta.topics) {
        if (!topic.parentId) continue;
        if (!children.has(topic.parentId)) children.set(topic.parentId, []);
        children.get(topic.parentId).push(topic);
    }
    const subjects = new Map(meta.subjects.map(subject => [subject.id, subject]));
    return { byId, children, subjects };
}

/** A topic's names from its content area down to itself. */
export function topicPath(index, topic) {
    const path = [];
    const seen = new Set();
    for (let step = topic; step && !seen.has(step.id); step = index.byId.get(step.parentId)) {
        seen.add(step.id);
        path.unshift(step.name);
    }
    return path;
}

/** Whether a grade's curriculum has this topic or anything under it. */
export function taughtIn(index, topic, grade) {
    if (!topic || !grade) return false;
    if (topic.grades?.some(row => row.grade === grade)) return true;
    return (index.children.get(topic.id) || []).some(child => taughtIn(index, child, grade));
}

/** The grades whose curriculum has this topic, lowest first. */
export function gradesOf(index, topic) {
    const grades = new Set();
    const walk = node => {
        node.grades?.forEach(row => grades.add(row.grade));
        (index.children.get(node.id) || []).forEach(walk);
    };
    if (topic) walk(topic);
    return [...grades].sort((a, b) => a - b);
}

/**
 * Topics matching what was typed: every word must appear in the topic's path. Names that start with
 * the words come first, and with a grade chosen, what that grade learns comes before the rest.
 */
export function searchTopics(index, query, grade = null) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const found = [];
    for (const topic of index.byId.values()) {
        if (topic.archived) continue;
        const path = topicPath(index, topic);
        const haystack = fold(path.join(" "));
        if (!words.every(word => haystack.includes(word))) continue;
        const name = fold(topic.name);
        const score = (words.length && name.startsWith(words[0]) ? 0 : words.every(word => name.includes(word)) ? 1 : 2)
            + (grade && !taughtIn(index, topic, grade) ? 3 : 0);
        found.push({ topic, path, score });
    }
    found.sort((a, b) => a.score - b.score || a.path.length - b.path.length || a.topic.name.localeCompare(b.topic.name));
    return found.slice(0, MAX_RESULTS);
}

/**
 * What a #tag's name suggests: #algebra6 and #6kl-lygtys both say grade 6, and their words point to
 * topics. A hint only: the creator sees it and decides.
 */
export function tagHints(index, tag, gradeIds) {
    const text = fold(tag);
    const number = [...text.matchAll(/\d+/g)].map(match => Number(match[0])).find(n => gradeIds.includes(n)) ?? null;
    const words = text.replace(/\d+/g, " ").replace(/[^\p{L}]+/gu, " ").split(" ").filter(word => word.length >= MIN_WORD && word !== "kl");
    const topics = [];
    for (const word of words) {
        for (const { topic } of searchTopics(index, word, number)) {
            if (!topics.includes(topic)) topics.push(topic);
        }
    }
    return { gradeId: number, topics: topics.slice(0, MAX_HINTS) };
}

/** Why a task may not be sent as it stands, if anything: already in the bank, or waiting there. */
export function blockedReason(item) {
    if (item.own) {
        if (item.submission?.status === "pending") return "pending";
        if (item.submission?.status === "approved") return "inBank";
        return null;
    }
    if (item.status === "published") return "inBank";
    if (item.status === "draft") return "pending";
    return null;
}

const FIELDS = ["topicId", "gradeId", "difficultyId"];

/** The fields a task still lacks. */
export function missingOf(row) {
    return FIELDS.filter(field => !row[field]);
}

/** What the chosen tasks have in common in one field, or null while they differ or lack it. */
export function commonValue(rows, field) {
    const values = new Set(rows.map(row => row[field] ?? null));
    return values.size === 1 ? [...values][0] : null;
}

/** How many of the tasks going lack each field, and how many are ready. */
export function sendSummary(rows) {
    const going = rows.filter(row => row.include && !row.blocked);
    const lacking = { topicId: 0, gradeId: 0, difficultyId: 0 };
    let ready = 0;
    for (const row of going) {
        const missing = missingOf(row);
        if (!missing.length) ready++;
        missing.forEach(field => { lacking[field]++; });
    }
    return { going: going.length, ready, lacking };
}
