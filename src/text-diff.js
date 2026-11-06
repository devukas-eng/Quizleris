// A small diff for the task bank's log: which lines of a task changed, and inside a changed line
// which words, so a change reads like one on GitHub.

const MAX_CELLS = 2000000; // past this a text is shown as replaced outright instead of compared

/** For each pair of positions, how long a common run can still be: the classic longest-common-subsequence table. */
function commonTable(a, b) {
    const width = b.length + 1;
    const table = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            table[i * width + j] = a[i] === b[j]
                ? table[(i + 1) * width + j + 1] + 1
                : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
        }
    }
    return { table, width };
}

/** The two lists as one walk: { type: "same" | "del" | "add", value }, removals before additions. */
export function diffLists(before, after) {
    if (before.length * after.length > MAX_CELLS) {
        return [...before.map(value => ({ type: "del", value })), ...after.map(value => ({ type: "add", value }))];
    }
    const { table, width } = commonTable(before, after);
    const out = [];
    let i = 0;
    let j = 0;
    while (i < before.length && j < after.length) {
        if (before[i] === after[j]) {
            out.push({ type: "same", value: before[i] });
            i++;
            j++;
        } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
            out.push({ type: "del", value: before[i++] });
        } else {
            out.push({ type: "add", value: after[j++] });
        }
    }
    while (i < before.length) out.push({ type: "del", value: before[i++] });
    while (j < after.length) out.push({ type: "add", value: after[j++] });
    return out;
}

const tokens = text => String(text ?? "").match(/\s+|[^\s]+/g) || [];

/** The words of a changed line, each marked whether it changed: { before: [...], after: [...] } of { text, changed }. */
export function diffWords(before, after) {
    const out = { before: [], after: [] };
    const push = (list, text, changed) => {
        const last = list[list.length - 1];
        if (last && last.changed === changed) last.text += text;
        else list.push({ text, changed });
    };
    for (const { type, value } of diffLists(tokens(before), tokens(after))) {
        if (type !== "add") push(out.before, value, type === "del");
        if (type !== "del") push(out.after, value, type === "add");
    }
    return out;
}

/**
 * Two texts' lines as rows of a diff: unchanged ones as they are, and a changed line paired with what
 * replaced it, so its changed words can be marked. Rows are { type, parts }.
 */
export function diffRows(beforeLines, afterLines) {
    const walk = diffLists(beforeLines, afterLines);
    const rows = [];
    for (let i = 0; i < walk.length; i++) {
        const step = walk[i];
        if (step.type === "same") {
            rows.push({ type: "same", parts: [{ text: step.value, changed: false }] });
            continue;
        }
        // A run of removals followed by additions: pair them up, line by line
        const removed = [];
        const added = [];
        while (walk[i]?.type === "del") removed.push(walk[i++].value);
        while (walk[i]?.type === "add") added.push(walk[i++].value);
        i--;
        const pairs = Math.min(removed.length, added.length);
        const words = removed.slice(0, pairs).map((line, index) => diffWords(line, added[index]));
        words.forEach(pair => rows.push({ type: "del", parts: pair.before }));
        removed.slice(pairs).forEach(line => rows.push({ type: "del", parts: [{ text: line, changed: true }] }));
        words.forEach(pair => rows.push({ type: "add", parts: pair.after }));
        added.slice(pairs).forEach(line => rows.push({ type: "add", parts: [{ text: line, changed: true }] }));
    }
    return rows;
}
