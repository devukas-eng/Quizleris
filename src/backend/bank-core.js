const crypto = require('crypto');

// Task bank (užduočių bankas) helpers without database access: the search form of texts, list
// previews, duplicate fingerprints, list cursors and the filter → SQL builder. The routes in
// bank.js, scripts/bench_bank.js and the tests share them, so the benchmark times the real SQL.

const QTYPES = ['multiple-choice', 'numeric', 'fill-blank', 'true-false', 'text', 'image-upload'];
const KINDS = ['problem', 'template'];
const STATUSES = ['draft', 'published', 'archived'];
const PREVIEW_LENGTH = 300;
const SEARCH_LENGTH = 4000;
const MIN_FULLTEXT_WORD = 3; // InnoDB's default innodb_ft_min_token_size: shorter words are not indexed
const MAX_SEARCH_WORDS = 8;
const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;
const MAX_ID = 4294967295;

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"' };

function decodeEntity(entity, name) {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()];
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : entity;
}

/** Text of a rich prompt: tags dropped, entities decoded (once), whitespace collapsed. */
function plainText(value) {
    return String(value ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&(nbsp|amp|lt|gt|quot|#\d{1,7}|#x[0-9a-f]{1,6});/gi, decodeEntity)
        .replace(/\s+/g, ' ')
        .trim();
}

/** Search form of a text: LaTeX commands and diacritics dropped, lower case, single spaces. */
function foldText(value) {
    return plainText(value)
        .replace(/\\[a-zA-Z]+/g, ' ')
        .normalize('NFD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function choiceTexts(content) {
    return (Array.isArray(content.choices) ? content.choices : []).map(c => plainText(c?.text)).filter(Boolean);
}

/** The list row of a question; a cut never ends inside a \( … \) or \[ … \] formula. */
function previewText(content) {
    const text = plainText(content.prompt) || choiceTexts(content).join(' · ');
    if (text.length <= PREVIEW_LENGTH) return text;
    let cut = text.slice(0, PREVIEW_LENGTH - 1);
    for (const [open, close] of [['\\(', '\\)'], ['\\[', '\\]']]) {
        const opened = cut.lastIndexOf(open);
        if (opened > cut.lastIndexOf(close)) cut = cut.slice(0, opened);
    }
    cut = cut.replace(/\s+\S*$/, '').trimEnd();
    return (cut || text.slice(0, PREVIEW_LENGTH - 1)) + '…';
}

/** Folded prompt and choices, padded with spaces so short words match as word starts (LIKE '% x%'). */
function searchText(content) {
    const choices = Array.isArray(content.choices) ? content.choices : [];
    let folded = foldText([content.prompt, ...choices.map(c => c?.text)].map(v => v ?? '').join(' '));
    if (folded.length > SEARCH_LENGTH) folded = folded.slice(0, SEARCH_LENGTH).replace(/\s+\S*$/, '');
    return ` ${folded} `;
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            if (value[key] !== undefined) out[key] = canonical(value[key]);
        }
        return out;
    }
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;
}

/** Same text, answers and pictures give the same fingerprint, whatever the IDs and spacing. */
function contentHash(content) {
    // Only the question's and its choices' IDs differ between copies of one task
    const question = { ...content, id: undefined };
    if (Array.isArray(content.choices)) {
        question.choices = content.choices.map(choice => (choice && typeof choice === 'object' ? { ...choice, id: undefined } : choice));
    }
    return crypto.createHash('sha1').update(JSON.stringify(canonical(question))).digest('hex');
}

/** Where a question keeps pictures: [holder, key] pairs for the question and each choice. */
function imageSlots(content) {
    const holders = [content, ...(Array.isArray(content.choices) ? content.choices : [])];
    return holders.filter(holder => holder && typeof holder === 'object' && holder.image).map(holder => [holder, 'image']);
}

function hasImage(content) {
    return imageSlots(content).length > 0;
}

function encodeCursor(values) {
    return Buffer.from(JSON.stringify(values)).toString('base64url');
}

/** The sort key and ID a page continues from, or null for anything that is not such a cursor. */
function decodeCursor(raw, length) {
    if (typeof raw !== 'string' || raw.length > 200) return null;
    try {
        const values = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        return Array.isArray(values) && values.length === length && values.every(Number.isSafeInteger) ? values : null;
    } catch {
        return null;
    }
}

function toId(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const n = typeof value === 'string' && !value.trim() ? NaN : Number(value);
    return Number.isInteger(n) && n > 0 && n <= MAX_ID ? n : null;
}

/** Distinct valid IDs from an array or a comma-separated string, at most `max` of them. */
function idList(value, max) {
    const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
    const ids = new Set();
    for (const item of raw) {
        if (ids.size >= max) break;
        const id = toId(item);
        if (id) ids.add(id);
    }
    return [...ids];
}

function clampInt(value, min, max, fallback) {
    if (value == null || value === '') return fallback;
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Words of a search box: those InnoDB indexes become required prefix terms of one boolean
 * full-text match; shorter ones (x, 5, km) are matched as word starts with LIKE.
 */
function searchTerms(raw) {
    const words = foldText(raw).split(' ').filter(Boolean).slice(0, MAX_SEARCH_WORDS);
    return {
        fulltext: words.filter(w => w.length >= MIN_FULLTEXT_WORD).map(w => `+${w}*`).join(' '),
        short: words.filter(w => w.length < MIN_FULLTEXT_WORD)
    };
}

/** A filter on IDs where "none" in the list stands for an empty (NULL) column. */
function addNullableIn(add, column, raw) {
    const parts = String(raw ?? '').split(',').filter(Boolean);
    const ids = idList(parts, 50);
    const none = parts.includes('none');
    if (ids.length && none) add(`(${column} IN (?) OR ${column} IS NULL)`, ids);
    else if (ids.length) add(`${column} IN (?)`, ids);
    else if (none) add(`${column} IS NULL`);
}

/**
 * WHERE clauses of a bank listing. `params` are query-string values; `ctx` gives the owner and
 * status listed (owner 0 is the shared bank), topic subtrees and classifier values grouped by
 * classifier. `omit` leaves one filter out, so facet counts show the choices for that filter.
 */
function buildFilter(params, ctx, omit = null) {
    const where = ['i.owner_id = ?', 'i.status = ?'];
    const args = [ctx.ownerId, ctx.status];
    const add = (clause, ...values) => {
        where.push(clause);
        args.push(...values);
    };
    const subject = toId(params.subject);
    if (subject) add('i.subject_id = ?', subject);
    const grade = toId(params.grade);
    if (grade) add('i.grade_id = ?', grade);
    if (omit !== 'topic') {
        const topic = toId(params.topic);
        if (params.topic === 'none') add('i.topic_id IS NULL');
        else if (topic) {
            const ids = String(params.deep) === '0' ? [topic] : ctx.topicSubtree(topic);
            add('i.topic_id IN (?)', ids.length ? ids : [0]); // a topic hidden from this user lists nothing
        }
    }
    // A teacher's own folder (only the owner's tasks are listed, so another's folder lists nothing)
    if (params.folder === 'none') add('i.folder_id IS NULL');
    else if (toId(params.folder)) add('i.folder_id = ?', toId(params.folder));
    if (omit !== 'difficulty') addNullableIn(add, 'i.difficulty_id', params.difficulty);
    if (omit !== 'kind' && KINDS.includes(params.kind)) add('i.kind = ?', params.kind);
    if (omit !== 'qtype') {
        const types = String(params.qtype ?? '').split(',').filter(t => QTYPES.includes(t));
        if (types.length) add('i.qtype IN (?)', types);
    }
    // Classifier values: any chosen value of one classifier, and every classifier chosen
    for (const ids of ctx.groupValues(idList(params.values, 50))) {
        add('i.id IN (SELECT item_id FROM bank_item_values WHERE value_id IN (?))', ids);
    }
    const search = searchTerms(params.q);
    if (search.fulltext) add('MATCH(i.search_text) AGAINST(? IN BOOLEAN MODE)', search.fulltext);
    for (const word of search.short) add('i.search_text LIKE ?', `% ${word}%`);
    return { where, args };
}

function sortKey(sort, levelIds = []) {
    if (sort === 'popular') return { expr: 'i.uses', desc: true };
    if (sort === 'level') {
        // Position in the difficulty order, easiest first; tasks without a difficulty (0) come last
        const ids = levelIds.filter(id => Number.isSafeInteger(id) && id > 0);
        return { expr: `FIELD(IFNULL(i.difficulty_id, 0), ${[...ids, 0].join(', ')})`, desc: false };
    }
    return null; // newest first: the ID alone
}

const LIST_COLUMNS = 'i.id, i.kind, i.qtype, i.preview, i.subject_id, i.grade_id, i.topic_id, i.difficulty_id, i.folder_id, i.status, i.has_image, i.uses';

// Counting and picking leave the index to the optimizer, except the single-column ones that exist
// for the foreign keys
const FROM_ITEMS = 'bank_items i IGNORE INDEX (bank_items_subject_ref, bank_items_grade_ref, bank_items_topic_ref, bank_items_difficulty_ref)';

/**
 * The index a page of this shape reads. Left alone, the optimizer likes to walk an index in ID
 * order and filter as it goes, which is fast only while matches are spread evenly. Tasks are
 * imported topic by topic, so an old topic's tasks sit together and such a walk would cross every
 * newer task first. Each shape gets an index that holds its filter (and, where it can, its order).
 * A full-text search or classifier filter is left to the optimizer: those indexes lead best.
 */
function listIndex(params) {
    if (searchTerms(params.q).fulltext || idList(params.values, 50).length) return null;
    const subject = toId(params.subject);
    const grade = toId(params.grade);
    const sort = params.sort === 'popular' || params.sort === 'level' ? params.sort : 'new';
    if (toId(params.folder)) return 'bank_items_folder';
    if (params.topic === 'none') return 'bank_items_unsorted';
    if (toId(params.topic)) return subject && grade ? 'bank_items_topic' : 'bank_items_unsorted';
    if (subject && grade) return { new: 'bank_items_browse', popular: 'bank_items_popular', level: 'bank_items_level' }[sort];
    if (subject) return sort === 'new' ? 'bank_items_subject_new' : 'bank_items_browse';
    return 'bank_items_all_new';
}

/**
 * The page query of a listing. A page continues from a cursor (the last row's sort key and ID)
 * instead of an OFFSET, so the thousandth page costs the same as the first. Returns null for a
 * cursor that does not fit the sort.
 */
function buildListQuery(params, ctx) {
    const limit = clampInt(params.limit, 1, PAGE_MAX, PAGE_DEFAULT);
    const { where, args } = buildFilter(params, ctx);
    const key = sortKey(params.sort, ctx.levelIds);
    if (params.cursor) {
        const cursor = decodeCursor(params.cursor, key ? 2 : 1);
        if (!cursor) return null;
        if (key) {
            where.push(`(${key.expr} ${key.desc ? '<' : '>'} ? OR (${key.expr} = ? AND i.id < ?))`);
            args.push(cursor[0], cursor[0], cursor[1]);
        } else {
            where.push('i.id < ?');
            args.push(cursor[0]);
        }
    }
    const order = key ? `${key.expr} ${key.desc ? 'DESC' : 'ASC'}, i.id DESC` : 'i.id DESC';
    const index = listIndex(params);
    const from = index ? `bank_items i FORCE INDEX (${index})` : FROM_ITEMS;
    return {
        sql: `SELECT ${LIST_COLUMNS}${key ? `, ${key.expr} AS sort_key` : ''} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`,
        args: [...args, limit + 1],
        limit,
        cursorOf: row => encodeCursor(key ? [Number(row.sort_key), row.id] : [row.id])
    };
}

const FACET_COLUMNS = { topic: 'i.topic_id', difficulty: 'i.difficulty_id', kind: 'i.kind', qtype: 'i.qtype' };

/**
 * Counts a listing needs: `facets=kind,qtype` (or `none`) chooses; by default difficulty, plus topics
 * once a subject is chosen (the tree is per subject). Counting a facet nobody shows across the
 * whole bank would cost far more than the page itself.
 */
function wantedFacets(params) {
    if (params.facets !== undefined) return String(params.facets).split(',').filter(name => FACET_COLUMNS[name]);
    return toId(params.subject) ? ['topic', 'difficulty'] : ['difficulty'];
}

/** The total of a listing and the counts per value of each wanted facet. */
function buildFacetQueries(params, ctx) {
    const base = buildFilter(params, ctx);
    return [
        { name: 'total', sql: `SELECT COUNT(*) AS n FROM ${FROM_ITEMS} WHERE ${base.where.join(' AND ')}`, args: base.args },
        ...wantedFacets(params).map(name => {
            const column = FACET_COLUMNS[name];
            const { where, args } = buildFilter(params, ctx, name);
            return { name, sql: `SELECT ${column} AS k, COUNT(*) AS n FROM ${FROM_ITEMS} WHERE ${where.join(' AND ')} GROUP BY ${column}`, args };
        })
    ];
}

function listItem(row) {
    return {
        id: row.id,
        kind: row.kind,
        qtype: row.qtype,
        preview: row.preview,
        subjectId: row.subject_id,
        gradeId: row.grade_id,
        topicId: row.topic_id,
        difficultyId: row.difficulty_id,
        folderId: row.folder_id,
        status: row.status,
        hasImage: !!row.has_image,
        uses: row.uses
    };
}

module.exports = {
    QTYPES, KINDS, STATUSES, FROM_ITEMS,
    plainText, foldText, previewText, searchText, contentHash, imageSlots, hasImage,
    encodeCursor, decodeCursor, toId, idList, clampInt, searchTerms,
    buildFilter, listIndex, buildListQuery, buildFacetQueries, listItem
};
