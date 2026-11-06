import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { taskChanges, actionOf, reverseOf, snapshotOf } = require('../src/backend/bank-history.js');
const { poolDecision, feedPosition } = require('../src/backend/bank-pool.js');
const core = require('../src/backend/bank-core.js');

describe('what the bank log records', () => {
    const before = {
        kind: 'problem', status: 'published', subjectId: 1, gradeId: 6, topicId: 10, difficultyId: 2, source: null,
        values: [3, 1],
        content: { type: 'numeric', prompt: 'Kiek yra 2+2?', correctAnswerNumber: 5 }
    };

    it('finds nothing when nothing changed', () => {
        expect(taskChanges(before, { ...before, values: [1, 3], content: { ...before.content } })).toEqual({});
    });

    it('keeps both sides of a classification change', () => {
        expect(taskChanges(before, { ...before, gradeId: 7, topicId: null })).toEqual({ gradeId: [6, 7], topicId: [10, null] });
    });

    it('keeps both sides of each changed part of the question', () => {
        const after = { ...before, content: { ...before.content, correctAnswerNumber: 4, hint: 'Sudėk' } };
        expect(taskChanges(before, after)).toEqual({ content: { correctAnswerNumber: [5, 4], hint: [null, 'Sudėk'] } });
    });

    it('leaves out fields the change did not mention', () => {
        expect(taskChanges(before, { status: 'archived' })).toEqual({ status: ['published', 'archived'] });
    });

    it('treats a new task as everything changing from nothing', () => {
        expect(taskChanges({}, { status: 'draft', topicId: 10 })).toEqual({ status: [null, 'draft'], topicId: [null, 10] });
    });

    it('names what happened', () => {
        expect(actionOf({ status: ['published', 'archived'] })).toBe('archived');
        expect(actionOf({ status: ['archived', 'published'] })).toBe('restored');
        expect(actionOf({ status: ['draft', 'published'] })).toBe('published');
        expect(actionOf({ content: { prompt: ['a', 'b'] }, gradeId: [1, 2] })).toBe('edited');
        expect(actionOf({ gradeId: [1, 2] })).toBe('classified');
    });

    it('can put back what an entry changed', () => {
        const changes = taskChanges(before, { ...before, gradeId: 7, values: [1], content: { ...before.content, prompt: 'Nauja' } });
        const { body, content } = reverseOf(changes);
        expect(body).toEqual({ gradeId: 6, values: [1, 3] });
        expect(content).toEqual({ prompt: ['Kiek yra 2+2?', 'Nauja'] });
    });

    it('reads a database row under the names the code uses', () => {
        expect(snapshotOf({ kind: 'problem', status: 'pool', subject_id: 1, grade_id: null, topic_id: 2, difficulty_id: null, source: 'x' }))
            .toEqual({ kind: 'problem', status: 'pool', subjectId: 1, gradeId: null, topicId: 2, difficultyId: null, source: 'x' });
    });
});

describe('what votes do to an unsorted task', () => {
    const limits = { likes: 3, dislikes: 2 };
    const state = fields => ({ likes: 0, dislikes: 0, suggested: false, dismissed: false, ...fields });

    it('does nothing below the limits', () => {
        expect(poolDecision(state({ likes: 2, dislikes: 1 }), limits)).toBeNull();
    });

    it('takes a task out at the dislike limit', () => {
        expect(poolDecision(state({ dislikes: 2 }), limits)).toBe('remove');
    });

    it('lets dislikes win over likes', () => {
        expect(poolDecision(state({ likes: 5, dislikes: 2, suggested: true }), limits)).toBe('remove');
    });

    it('suggests a task to admins at the like limit, once', () => {
        expect(poolDecision(state({ likes: 3 }), limits)).toBe('suggest');
        expect(poolDecision(state({ likes: 4, suggested: true }), limits)).toBeNull();
    });

    it('takes a suggestion back when the likes are taken back', () => {
        expect(poolDecision(state({ likes: 2, suggested: true }), limits)).toBe('unsuggest');
    });

    it('keeps to an admin\'s "not now"', () => {
        expect(poolDecision(state({ likes: 9, dismissed: true }), limits)).toBeNull();
    });
});

describe('the feed cursor', () => {
    it('starts somewhere random inside the ring', () => {
        const first = feedPosition(undefined);
        expect(first.next).toBe(first.start);
        expect(first.start).toBeGreaterThanOrEqual(0);
        expect(first.start).toBeLessThan(2 ** 32);
        expect(first.wrapped).toBe(false);
    });

    it('continues from where the last page ended', () => {
        expect(feedPosition(core.encodeCursor([100, 250, 1]))).toEqual({ start: 100, next: 250, wrapped: true });
    });

    it('starts anew from a cursor that is not one', () => {
        expect(feedPosition('not-a-cursor').wrapped).toBe(false);
    });
});

describe('who a tagged list shows', () => {
    it('can list several states at once', () => {
        const ctx = { ownerIds: [0, 5], statuses: ['published', 'pool'], status: 'published', topicSubtree: id => [id], groupValues: () => [], levelIds: [] };
        const { where, args } = core.buildFilter({}, ctx);
        expect(where[1]).toBe('i.status IN (?)');
        expect(args[1]).toEqual(['published', 'pool']);
    });

    it('lists one state by default', () => {
        const ctx = { ownerId: 0, status: 'published', topicSubtree: id => [id], groupValues: () => [], levelIds: [] };
        expect(core.buildFilter({}, ctx).where[1]).toBe('i.status = ?');
    });
});
