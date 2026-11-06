import { describe, it, expect } from 'vitest';
import { fold, topicIndex, topicPath, taughtIn, gradesOf, searchTopics, tagHints, blockedReason, missingOf, commonValue, sendSummary } from '../src/bank-send-rules.js';
import { diffLists, diffWords, diffRows } from '../src/text-diff.js';

const meta = {
    subjects: [{ id: 1, name: 'Matematika' }],
    topics: [
        { id: 1, subjectId: 1, parentId: null, name: 'Algebra', grades: [] },
        { id: 2, subjectId: 1, parentId: 1, name: 'Tiesinės lygtys', grades: [{ grade: 6 }, { grade: 7 }] },
        { id: 3, subjectId: 1, parentId: 1, name: 'Kvadratinės lygtys', grades: [{ grade: 9 }] },
        { id: 4, subjectId: 1, parentId: null, name: 'Geometrija', grades: [{ grade: 6 }] },
        { id: 5, subjectId: 1, parentId: 4, name: 'Senas skyrius', grades: [], archived: true }
    ]
};
const index = topicIndex(meta);

describe('finding a topic by typing', () => {
    it('ignores case and diacritics', () => {
        expect(fold('Tiesinės LYGTYS')).toBe('tiesines lygtys');
        expect(searchTopics(index, 'tiesines').map(r => r.topic.id)).toEqual([2]);
    });

    it('finds a topic by a word of its path', () => {
        expect(searchTopics(index, 'algebra lygtys').map(r => r.topic.id).sort()).toEqual([2, 3]);
    });

    it('puts what the chosen grade learns first', () => {
        expect(searchTopics(index, 'lygtys', 9)[0].topic.id).toBe(3);
        expect(searchTopics(index, 'lygtys', 7)[0].topic.id).toBe(2);
    });

    it('leaves out archived topics', () => {
        expect(searchTopics(index, 'senas')).toEqual([]);
    });

    it('builds the path from the area down', () => {
        expect(topicPath(index, index.byId.get(2))).toEqual(['Algebra', 'Tiesinės lygtys']);
    });
});

describe('the curriculum', () => {
    it('counts what is taught under a topic', () => {
        expect(taughtIn(index, index.byId.get(1), 9)).toBe(true);
        expect(taughtIn(index, index.byId.get(2), 9)).toBe(false);
    });

    it('lists a topic\'s grades', () => {
        expect(gradesOf(index, index.byId.get(1))).toEqual([6, 7, 9]);
    });
});

describe('what a tag suggests', () => {
    const grades = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    it('reads the grade from the name', () => {
        expect(tagHints(index, 'algebra6', grades).gradeId).toBe(6);
        expect(tagHints(index, '9kl-lygtys', grades).gradeId).toBe(9);
    });

    it('reads no grade from a number that is not one', () => {
        expect(tagHints(index, 'testas2024', grades).gradeId).toBeNull();
    });

    it('points to topics by the words of the name', () => {
        expect(tagHints(index, 'algebra6', grades).topics.map(topic => topic.id)).toContain(1);
        expect(tagHints(index, '9kl-lygtys', grades).topics[0].id).toBe(3);
    });

    it('stays quiet when nothing fits', () => {
        expect(tagHints(index, 'xyz', grades)).toEqual({ gradeId: null, topics: [] });
    });
});

describe('what may be sent', () => {
    it('holds back tasks that are in the bank or waiting', () => {
        expect(blockedReason({ own: true, submission: { status: 'pending' } })).toBe('pending');
        expect(blockedReason({ own: true, submission: { status: 'approved' } })).toBe('inBank');
        expect(blockedReason({ own: false, status: 'published' })).toBe('inBank');
        expect(blockedReason({ own: false, status: 'draft' })).toBe('pending');
    });

    it('lets own, rejected and unsorted tasks go', () => {
        expect(blockedReason({ own: true, submission: null })).toBeNull();
        expect(blockedReason({ own: true, submission: { status: 'rejected' } })).toBeNull();
        expect(blockedReason({ own: false, status: 'pool' })).toBeNull();
    });

    it('names what a task lacks', () => {
        expect(missingOf({ topicId: 1, gradeId: null })).toEqual(['gradeId', 'difficultyId']);
    });

    it('finds what tasks share', () => {
        expect(commonValue([{ gradeId: 6 }, { gradeId: 6 }], 'gradeId')).toBe(6);
        expect(commonValue([{ gradeId: 6 }, { gradeId: 7 }], 'gradeId')).toBeNull();
    });

    it('counts only the tasks that are going', () => {
        const summary = sendSummary([
            { include: true, topicId: 1, gradeId: 6, difficultyId: 2 },
            { include: true, topicId: 1, gradeId: null, difficultyId: null },
            { include: false, topicId: null },
            { include: true, blocked: 'inBank' }
        ]);
        expect(summary).toEqual({ going: 2, ready: 1, lacking: { topicId: 0, gradeId: 1, difficultyId: 1 } });
    });
});

describe('the log\'s diff', () => {
    it('keeps what two lists share', () => {
        expect(diffLists(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([
            { type: 'same', value: 'a' }, { type: 'del', value: 'b' }, { type: 'add', value: 'x' }, { type: 'same', value: 'c' }
        ]);
    });

    it('marks only the changed words', () => {
        const { before, after } = diffWords('Kiek yra 2 + 2?', 'Kiek bus 2 + 2?');
        expect(before).toEqual([{ text: 'Kiek ', changed: false }, { text: 'yra', changed: true }, { text: ' 2 + 2?', changed: false }]);
        expect(after[1]).toEqual({ text: 'bus', changed: true });
    });

    it('pairs a changed line with its replacement', () => {
        const rows = diffRows(['A. 7x', 'B. 8x'], ['A. 7x', 'B. 9x']);
        expect(rows.map(row => row.type)).toEqual(['same', 'del', 'add']);
        expect(rows[1].parts.find(part => part.changed).text).toBe('8x');
    });

    it('shows added and removed lines whole', () => {
        expect(diffRows([], ['nauja'])).toEqual([{ type: 'add', parts: [{ text: 'nauja', changed: true }] }]);
        expect(diffRows(['sena'], [])).toEqual([{ type: 'del', parts: [{ text: 'sena', changed: true }] }]);
    });

    it('gives up gracefully on huge texts', () => {
        const long = Array.from({ length: 2000 }, (_, i) => `a${i}`);
        const other = Array.from({ length: 2000 }, (_, i) => `b${i}`);
        expect(diffLists(long, other)).toHaveLength(4000);
    });
});
