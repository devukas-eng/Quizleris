// Checks docs/brain (run: node scripts/check-brain.js). Used by /sync-brain: links and paths must resolve,
// nodes keep their structure, the canvas stays valid, and no configured secret reaches the docs.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const BRAIN = path.join(ROOT, 'docs', 'brain');
const NODES = path.join(BRAIN, 'nodes');
const MOC = '00_MOC_Architecture';
const STATE = '01_STATE';
const CANVAS = 'architecture.canvas';
const HEADINGS = ['Purpose & Boundaries', 'Canonical File Map', 'Connections & Data Flow', 'Gotchas & Constraints'];
// Exists only on a computer set up for local testing, so a fresh clone must still pass
const LOCAL_ONLY = ['.claude/launch.json'];
const HTTP_METHOD = /^(GET|POST|PUT|PATCH|DELETE) /;
const REPO_PATH = /^(src|tests|scripts|docs|\.claude)\/[\w./-]*(:\d+)?$/;

const failures = [];
const fail = (message) => failures.push(message);
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));
const readBrain = (relative) => fs.readFileSync(path.join(BRAIN, relative), 'utf8');
const withoutFences = (text) => text.replace(/```[\s\S]*?```/g, '');
const withoutCode = (text) => withoutFences(text).replace(/`[^`]*`/g, '');
const inlineCode = (text) => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
const sectionOf = (body, title) => body.split(`## ${title}`)[1]?.split(/^## /m)[0] ?? '';

const nodeNames = fs.readdirSync(NODES).filter((name) => name.endsWith('.md')).map((name) => path.basename(name, '.md'));
const notes = new Map([
    [MOC, readBrain(`${MOC}.md`)],
    [STATE, readBrain(`${STATE}.md`)],
    ...nodeNames.map((name) => [name, readBrain(`nodes/${name}.md`)]),
]);

function checkFrontmatter(name, body) {
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1];
    if (!front) {
        fail(`${name}: no frontmatter`);
        return;
    }
    if (!/^status: (active|wip|needs-refactor)\s*$/m.test(front)) fail(`${name}: status must be active, wip or needs-refactor`);
    if (!/^last_verified: \d{4}-\d{2}-\d{2}\s*$/m.test(front)) fail(`${name}: last_verified must be YYYY-MM-DD`);
    if (nodeNames.includes(name) && !/^tags: \[node, [a-z-]+\]\s*$/m.test(front)) fail(`${name}: tags must be [node, <domain>]`);
}

function checkLinks(sources) {
    const linkedFrom = new Map([...notes.keys(), CANVAS].map((name) => [name, new Set()]));
    for (const [name, text] of sources) {
        for (const [, target] of withoutCode(text).matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
            if (!linkedFrom.has(target)) fail(`${name}: broken link [[${target}]]`);
            else if (target !== name) linkedFrom.get(target).add(name);
        }
    }
    for (const [name, from] of linkedFrom) if (from.size === 0) fail(`${name}: nothing links to it`);
}

function checkPaths(name, body) {
    for (const token of inlineCode(withoutFences(body))) {
        if (!REPO_PATH.test(token)) continue;
        const file = token.replace(/:\d+$/, '');
        if (!LOCAL_ONLY.includes(file) && !exists(file)) fail(`${name}: ${file} does not exist`);
    }
}

function checkNodeShape(name, body) {
    const headings = [...body.matchAll(/^## (.+?)\s*$/gm)].map((match) => match[1]);
    if (headings.join('|') !== HEADINGS.join('|')) fail(`${name}: sections must be ${HEADINGS.join(', ')}`);
    if (/^# /m.test(body)) fail(`${name}: has an extra title`);
    if (body.includes('```')) fail(`${name}: has a code block`);
    if (!sectionOf(body, 'Connections & Data Flow').includes('[[')) fail(`${name}: Connections has no links`);

    const purpose = sectionOf(body, 'Purpose & Boundaries').replace(/`[^`]*`/g, 'x').trim();
    const sentences = purpose.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    if (sentences < 2 || sentences > 3) fail(`${name}: Purpose must be 2 or 3 sentences, not ${sentences}`);
}

// A name in a file map line must still be in that file, so a rename in the code shows up here
function checkFileMap(name, body) {
    const lines = sectionOf(body, 'Canonical File Map').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
        const head = /^- `([^`]+)`:/.exec(line);
        if (!head) {
            fail(`${name}: file map line must start with a path: ${line.slice(0, 50)}`);
            continue;
        }
        const file = head[1];
        if (LOCAL_ONLY.includes(file)) continue;
        if (!exists(file)) {
            fail(`${name}: ${file} does not exist`);
            continue;
        }
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        for (const token of inlineCode(line.slice(head[0].length))) {
            if (/\s/.test(token) && !HTTP_METHOD.test(token)) continue;
            if (exists(token)) continue;
            const symbol = token.replace(HTTP_METHOD, '').replace(/^(html|body)?[.#]/, '').replace(/\?v=$/, '');
            if (!source.includes(symbol)) fail(`${name}: ${file} no longer contains ${token}`);
        }
    }
}

function checkMoc(moc) {
    const clickable = /class ([\w,]+) internal-link;/.exec(moc)?.[1].split(',') ?? [];
    for (const name of nodeNames) {
        const status = /^status: (\S+)/m.exec(notes.get(name))?.[1];
        const row = new RegExp(`\\| \\[\\[${name}\\]\\] \\| ([a-z-]+) \\|`).exec(moc)?.[1];
        if (!clickable.includes(name)) fail(`Diagram: ${name} is missing from the class line`);
        if (row !== status) fail(`Routing table: ${name} is ${row ?? 'missing'}, its node says ${status}`);
    }
    for (const name of clickable) if (!nodeNames.includes(name)) fail(`Diagram: ${name} has no node`);
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const isColor = (value) => value === undefined || /^([1-6]|#[0-9a-fA-F]{6})$/.test(value);
const noteOf = (card) => (card?.type === 'file' ? path.basename(card.file, '.md') : null);

function checkCanvasCards(canvas) {
    for (const card of canvas.nodes) {
        if (!['text', 'file', 'link', 'group'].includes(card.type)) fail(`Canvas: ${card.id} has type ${card.type}`);
        if (['x', 'y', 'width', 'height'].some((key) => typeof card[key] !== 'number')) fail(`Canvas: ${card.id} needs x, y, width and height`);
        if (card.type === 'file' && !fs.existsSync(path.join(BRAIN, card.file ?? ''))) fail(`Canvas: ${card.id} points at missing ${card.file}`);
        if (card.type === 'text' && typeof card.text !== 'string') fail(`Canvas: ${card.id} has no text`);
        if (!isColor(card.color)) fail(`Canvas: ${card.id} has colour ${card.color}`);
    }

    const firstCard = canvas.nodes.findIndex((card) => card.type !== 'group');
    if (canvas.nodes.slice(firstCard).some((card) => card.type === 'group')) fail('Canvas: groups must come first so they sit behind the cards');

    for (const file of [`${MOC}.md`, `${STATE}.md`, ...nodeNames.map((name) => `nodes/${name}.md`)]) {
        const count = canvas.nodes.filter((card) => card.file === file).length;
        if (count !== 1) fail(`Canvas: ${file} has ${count} cards, it needs 1`);
    }

    const cards = canvas.nodes.filter((card) => card.type !== 'group');
    const groups = canvas.nodes.filter((card) => card.type === 'group');
    cards.forEach((a, index) => cards.slice(index + 1).forEach((b) => {
        if (overlaps(a, b)) fail(`Canvas: ${a.id} overlaps ${b.id}`);
    }));
    for (const card of cards) {
        for (const group of groups) if (overlaps(group, card) && !contains(group, card)) fail(`Canvas: ${card.id} sticks out of ${group.id}`);
    }
}

function checkCanvasEdges(canvas, cardsById) {
    for (const edge of canvas.edges) {
        const from = cardsById.get(edge.fromNode);
        const to = cardsById.get(edge.toNode);
        if (!from || !to) {
            fail(`Canvas: ${edge.id} has an end that does not exist`);
            continue;
        }
        for (const side of [edge.fromSide, edge.toSide]) {
            if (side !== undefined && !['top', 'right', 'bottom', 'left'].includes(side)) fail(`Canvas: ${edge.id} has side ${side}`);
        }
        for (const end of [edge.fromEnd, edge.toEnd]) {
            if (end !== undefined && !['none', 'arrow'].includes(end)) fail(`Canvas: ${edge.id} has end ${end}`);
        }
        if (!isColor(edge.color)) fail(`Canvas: ${edge.id} has colour ${edge.color}`);

        const fromNote = noteOf(from);
        const toNote = noteOf(to);
        if (!nodeNames.includes(fromNote) || !nodeNames.includes(toNote)) continue;
        const linked = notes.get(fromNote).includes(`[[${toNote}]]`) || notes.get(toNote).includes(`[[${fromNote}]]`);
        if (!linked) fail(`Canvas: the arrow ${fromNote} to ${toNote} has no wikilink in either note`);
    }
}

function checkCanvas(raw) {
    let canvas;
    try {
        canvas = JSON.parse(raw);
    } catch (error) {
        fail(`Canvas: not valid JSON (${error.message})`);
        return null;
    }
    if (!Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) {
        fail('Canvas: needs nodes and edges arrays');
        return null;
    }
    const ids = [...canvas.nodes, ...canvas.edges].map((item) => item.id);
    for (const id of new Set(ids.filter((value, index) => ids.indexOf(value) !== index))) fail(`Canvas: duplicate id ${id}`);
    checkCanvasCards(canvas);
    checkCanvasEdges(canvas, new Map(canvas.nodes.map((card) => [card.id, card])));
    return canvas;
}

// Compares values only and never prints one
function checkSecrets(docs) {
    const secrets = [];
    for (const file of ['.env', '.claude/launch.json']) {
        if (!exists(file)) continue;
        const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
        for (const [, value] of raw.matchAll(/(?:SECRET|PASSWORD|PASS|TOKEN|KEY)[A-Z_]*"?\s*[:=]\s*"?([^"\r\n,]{8,})/gi)) secrets.push(value.trim());
    }
    if (secrets.some((value) => docs.includes(value))) fail('Secrets: a configured secret value appears in docs/brain');
    if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(docs)) fail('Secrets: an email address appears in docs/brain');
}

const canvasRaw = readBrain(CANVAS);
const canvas = checkCanvas(canvasRaw);
const canvasText = (canvas?.nodes ?? []).filter((card) => card.type === 'text').map((card) => [CANVAS, card.text]);

for (const [name, body] of notes) {
    checkFrontmatter(name, body);
    checkPaths(name, body);
    if (!nodeNames.includes(name)) continue;
    checkNodeShape(name, body);
    checkFileMap(name, body);
}
checkLinks([...notes, ...canvasText]);
checkMoc(notes.get(MOC));
checkSecrets([...notes.values(), canvasRaw].join('\n'));

if (failures.length) {
    console.log(`Brain check failed with ${failures.length} problem(s):`);
    failures.forEach((message) => console.log(`- ${message}`));
    process.exitCode = 1;
} else {
    console.log(`Brain check passed: ${nodeNames.length} nodes, ${canvas.nodes.length} canvas cards, ${canvas.edges.length} arrows.`);
}
