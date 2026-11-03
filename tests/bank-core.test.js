import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// The server code is CommonJS: load it the way Node does
const require = createRequire(import.meta.url);
const core = require('../src/backend/bank-core.js');

const placeholders = clauses => clauses.join(' ').split('?').length - 1;
const ctx = {
    ownerId: 0,
    status: 'published',
    levelIds: [3, 1, 2],
    topicSubtree: id => [id, id * 10],
    groupValues: ids => (ids.length ? [ids] : [])
};

describe('foldText', () => {
    it('drops Lithuanian diacritics and case', () => {
        expect(core.foldText('Išspręskite lygtį')).toBe('isspreskite lygti');
        expect(core.foldText('Ąžuolas ČIŠŲŪŽĖĘĮ')).toBe('azuolas cisuuzeei');
    });

    it('drops LaTeX commands, tags and entities', () => {
        expect(core.foldText('Raskite \\(\\frac{1}{2}x = 5\\)')).toBe('raskite 1 2 x 5');
        expect(core.foldText('<b>Kiek</b>&nbsp;yra 2+2?')).toBe('kiek yra 2 2');
    });

    it('decodes numeric entities, and each entity only once', () => {
        expect(core.plainText('7 &#183; 8 &#x2212; 1')).toBe('7 · 8 − 1');
        expect(core.foldText('5 &#8722; 2')).toBe('5 2');
        expect(core.plainText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
    });
});

describe('previewText', () => {
    it('keeps a short prompt and falls back to the choices', () => {
        expect(core.previewText({ prompt: ' Kiek  yra 2+2? ' })).toBe('Kiek yra 2+2?');
        expect(core.previewText({ prompt: '', choices: [{ text: 'Taip' }, { text: 'Ne' }] })).toBe('Taip · Ne');
    });

    it('cuts long text at a word', () => {
        const preview = core.previewText({ prompt: 'Žodis '.repeat(80) });
        expect(preview.length).toBeLessThanOrEqual(300);
        expect(preview.endsWith('Žodis…')).toBe(true);
    });

    it('never ends inside a formula', () => {
        const preview = core.previewText({ prompt: 'a '.repeat(140) + '\\(x^2 + ' + 'y'.repeat(50) + '\\)' });
        expect(preview).not.toContain('\\(');
        expect(preview.endsWith('…')).toBe(true);
    });
});

describe('contentHash', () => {
    const question = { id: 'q_1', type: 'multiple-choice', prompt: 'Kiek yra 2+2?', choices: [{ id: 'a', text: '4', isCorrect: true }, { id: 'b', text: '5', isCorrect: false }] };

    it('ignores IDs and spacing', () => {
        const same = { ...question, id: 'q_2', prompt: 'Kiek  yra 2+2? ', choices: question.choices.map((c, i) => ({ ...c, id: 'xyz'[i] })) };
        expect(core.contentHash(same)).toBe(core.contentHash(question));
    });

    it('tells different answers apart', () => {
        const other = { ...question, choices: [{ ...question.choices[0], isCorrect: false }, { ...question.choices[1], isCorrect: true }] };
        expect(core.contentHash(other)).not.toBe(core.contentHash(question));
    });

    it('keeps any other field called id (a template variable, say)', () => {
        const template = vars => ({ type: 'numeric', prompt: '{id} + 1', template: { vars } });
        expect(core.contentHash(template({ id: '1..9' }))).not.toBe(core.contentHash(template({ id: '1..5' })));
    });
});

describe('searchText and pictures', () => {
    it('pads the folded text so short words match as word starts', () => {
        expect(core.searchText({ prompt: 'Kiek yra x?', choices: [{ text: 'Dešimt' }] })).toBe(' kiek yra x desimt ');
    });

    it('finds the question and choice pictures', () => {
        const content = { image: 'data:image/png;base64,AA', choices: [{ text: 'a', image: '/api/media/x' }, { text: 'b' }] };
        expect(core.imageSlots(content)).toHaveLength(2);
        expect(core.hasImage({ prompt: 'x' })).toBe(false);
    });
});

describe('ids and cursors', () => {
    it('accepts only positive whole IDs', () => {
        expect(core.toId('5')).toBe(5);
        expect(core.toId(7)).toBe(7);
        for (const bad of ['0', '-1', '1.5', '', ' ', 'x', null, true, {}]) expect(core.toId(bad)).toBeNull();
        expect(core.idList('3,3,x,4', 10)).toEqual([3, 4]);
        expect(core.idList([1, 2, 3, 4], 2)).toEqual([1, 2]);
    });

    it('round-trips a cursor and rejects anything else', () => {
        expect(core.decodeCursor(core.encodeCursor([12, 99]), 2)).toEqual([12, 99]);
        expect(core.decodeCursor(core.encodeCursor([12, 99]), 1)).toBeNull();
        expect(core.decodeCursor(core.encodeCursor(['a']), 1)).toBeNull();
        expect(core.decodeCursor('not a cursor', 1)).toBeNull();
        expect(core.decodeCursor(undefined, 1)).toBeNull();
    });

    it('splits a search into full-text prefixes and short words', () => {
        expect(core.searchTerms('Lygtis x 5')).toEqual({ fulltext: '+lygtis*', short: ['x', '5'] });
        expect(core.searchTerms('')).toEqual({ fulltext: '', short: [] });
    });
});

describe('buildFilter', () => {
    const params = { subject: '1', grade: '7', topic: '2', difficulty: '2,none', kind: 'template', qtype: 'numeric,bogus', values: '9', q: 'lygtis x' };

    it('turns every filter into a clause with matching arguments', () => {
        const { where, args } = core.buildFilter(params, ctx);
        expect(where).toEqual([
            'i.owner_id = ?', 'i.status = ?', 'i.subject_id = ?', 'i.grade_id = ?', 'i.topic_id IN (?)',
            '(i.difficulty_id IN (?) OR i.difficulty_id IS NULL)', 'i.kind = ?', 'i.qtype IN (?)',
            'i.id IN (SELECT item_id FROM bank_item_values WHERE value_id IN (?))',
            'MATCH(i.search_text) AGAINST(? IN BOOLEAN MODE)', 'i.search_text LIKE ?'
        ]);
        expect(args).toEqual([0, 'published', 1, 7, [2, 20], [2], 'template', ['numeric'], [9], '+lygtis*', '% x%']);
        expect(placeholders(where)).toBe(args.length);
    });

    it('lists a topic alone, unassigned tasks, or no topic filter for facets', () => {
        expect(core.buildFilter({ topic: '2', deep: '0' }, ctx).args).toContainEqual([2]);
        expect(core.buildFilter({ topic: 'none' }, ctx).where).toContain('i.topic_id IS NULL');
        expect(core.buildFilter(params, ctx, 'topic').where).not.toContain('i.topic_id IN (?)');
    });

    it('lists nothing for a topic hidden from the user, never an empty IN ()', () => {
        const hidden = { ...ctx, topicSubtree: () => [] };
        expect(core.buildFilter({ topic: '2' }, hidden).args).toContainEqual([0]);
    });
});

describe('buildListQuery', () => {
    it('lists newest first and asks for one extra row', () => {
        const page = core.buildListQuery({}, ctx);
        expect(page.sql).toMatch(/ORDER BY i\.id DESC LIMIT \?$/);
        expect(page.args.at(-1)).toBe(51);
        expect(core.decodeCursor(page.cursorOf({ id: 40 }), 1)).toEqual([40]);
    });

    it('continues the most used list after the cursor', () => {
        const page = core.buildListQuery({ sort: 'popular', cursor: core.encodeCursor([12, 99]) }, ctx);
        expect(page.sql).toContain('(i.uses < ? OR (i.uses = ? AND i.id < ?))');
        expect(page.sql).toContain('ORDER BY i.uses DESC, i.id DESC');
        expect(page.args.slice(-4)).toEqual([12, 12, 99, 51]);
        expect(placeholders([page.sql])).toBe(page.args.length);
    });

    it('sorts by the difficulty order with unspecified last', () => {
        const page = core.buildListQuery({ sort: 'level', limit: '500' }, ctx);
        expect(page.sql).toContain('FIELD(IFNULL(i.difficulty_id, 0), 3, 1, 2, 0) AS sort_key');
        expect(page.sql).toContain('ASC, i.id DESC');
        expect(page.args.at(-1)).toBe(101);
    });

    it('rejects a cursor that does not fit', () => {
        expect(core.buildListQuery({ cursor: 'junk' }, ctx)).toBeNull();
        expect(core.buildListQuery({ sort: 'popular', cursor: core.encodeCursor([5]) }, ctx)).toBeNull();
    });
});

describe('listIndex', () => {
    it('gives every listing shape an index that holds its filter', () => {
        expect(core.listIndex({ subject: '1', grade: '7' })).toBe('bank_items_browse');
        expect(core.listIndex({ subject: '1', grade: '7', sort: 'popular' })).toBe('bank_items_popular');
        expect(core.listIndex({ subject: '1', grade: '7', sort: 'level' })).toBe('bank_items_level');
        expect(core.listIndex({ subject: '1', grade: '7', topic: '5' })).toBe('bank_items_topic');
        expect(core.listIndex({ subject: '1', topic: '5' })).toBe('bank_items_unsorted');
        expect(core.listIndex({ topic: 'none' })).toBe('bank_items_unsorted');
        expect(core.listIndex({ subject: '1' })).toBe('bank_items_subject_new');
        expect(core.listIndex({ subject: '1', sort: 'popular' })).toBe('bank_items_browse');
        expect(core.listIndex({})).toBe('bank_items_all_new');
        expect(core.listIndex({ scope: 'mine', folder: '4' })).toBe('bank_items_folder');
        expect(core.buildFilter({ folder: '4' }, ctx).where).toContain('i.folder_id = ?');
        expect(core.buildFilter({ folder: 'none' }, ctx).where).toContain('i.folder_id IS NULL');
        expect(core.listIndex({ subject: '1', grade: '7', q: 'x' })).toBe('bank_items_browse');
    });

    it('lets the full-text index or the classifier links lead', () => {
        expect(core.listIndex({ subject: '1', grade: '7', q: 'lygtis' })).toBeNull();
        expect(core.listIndex({ subject: '1', values: '9' })).toBeNull();
        expect(core.buildListQuery({ subject: '1', grade: '7' }, ctx).sql).toContain('FROM bank_items i FORCE INDEX (bank_items_browse)');
        expect(core.buildListQuery({ q: 'lygtis' }, ctx).sql).toContain('IGNORE INDEX');
    });
});

describe('buildFacetQueries', () => {
    const names = params => core.buildFacetQueries(params, ctx).map(q => q.name);

    it('counts the total and each facet without its own filter', () => {
        const queries = core.buildFacetQueries({ subject: '1', topic: '2', difficulty: '3', facets: 'topic,difficulty,kind,qtype' }, ctx);
        expect(queries.map(q => q.name)).toEqual(['total', 'topic', 'difficulty', 'kind', 'qtype']);
        const byName = Object.fromEntries(queries.map(q => [q.name, q]));
        expect(byName.topic.sql).not.toContain('topic_id IN');
        expect(byName.topic.sql).toContain('GROUP BY i.topic_id');
        expect(byName.difficulty.sql).not.toContain('difficulty_id IN');
        for (const q of queries) expect(placeholders([q.sql])).toBe(q.args.length);
    });

    it('counts topics only once a subject is chosen, unless told which facets', () => {
        expect(names({ subject: '1' })).toEqual(['total', 'topic', 'difficulty']);
        expect(names({})).toEqual(['total', 'difficulty']);
        expect(names({ facets: 'qtype,bogus' })).toEqual(['total', 'qtype']);
        expect(names({ subject: '1', facets: 'none' })).toEqual(['total']);
    });
});
