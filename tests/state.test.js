import { describe, it, expect } from 'vitest';
import { QuizState } from '../src/state.js';

const grade = (question, answer) =>
    new QuizState({ questions: [question] }).gradeQuestion(question, answer).isCorrect;

describe('write-in answers', () => {
    // The question from the bug report: one option, three write-in slots, only the second one correct
    const single = {
        id: 'q1',
        choices: [
            { id: 'a', text: 'tu', isCorrect: false },
            { id: 'b', kind: 'write', accepted: [], isCorrect: false },
            { id: 'c', kind: 'write', accepted: ['zmogus'], isCorrect: true },
            { id: 'd', kind: 'write', accepted: [], isCorrect: false },
        ],
    };

    it('accepts the right word whichever box it was typed in', () => {
        expect(grade(single, { selected: ['b'], typed: { b: 'Zmogus ' } })).toBe(true);
        expect(grade(single, { selected: ['d'], typed: { d: 'zmogus' } })).toBe(true);
    });

    it('still rejects a wrong word or a wrong option', () => {
        expect(grade(single, { selected: ['b'], typed: { b: 'katinas' } })).toBe(false);
        expect(grade(single, { selected: ['a'], typed: {} })).toBe(false);
    });

    const multiple = {
        id: 'q2',
        allowMultipleAnswers: true,
        choices: [
            { id: 'a', text: 'opt', isCorrect: true },
            { id: 'b', text: 'wrong', isCorrect: false },
            { id: 'c', kind: 'write', accepted: ['katė', 'katinas'], isCorrect: true },
            { id: 'd', kind: 'write', accepted: ['šuo'], isCorrect: true },
            { id: 'e', kind: 'number', number: 2, tolerance: 0.1, isCorrect: true },
        ],
    };

    it('matches several typed answers in any order', () => {
        expect(grade(multiple, { selected: ['a', 'c', 'd', 'e'], typed: { c: 'šuo', d: 'katinas', e: '2,05' } })).toBe(true);
    });

    it('needs every correct answer, once each', () => {
        expect(grade(multiple, { selected: ['a', 'c', 'e'], typed: { c: 'šuo', e: '2' } })).toBe(false);
        expect(grade(multiple, { selected: ['a', 'c', 'd', 'e'], typed: { c: 'šuo', d: 'šuo', e: '2' } })).toBe(false);
        expect(grade(multiple, { selected: ['a', 'b', 'c', 'd', 'e'], typed: { c: 'šuo', d: 'katė', e: '2' } })).toBe(false);
    });
});

describe('photo answers', () => {
    it('wait for the teacher instead of counting as wrong', () => {
        const q = { id: 'q3', type: 'image-upload' };
        const result = new QuizState({ questions: [q] }).gradeQuestion(q, 'data:image/jpeg;base64,AAAA');
        expect(result).toEqual({ isCorrect: false, pendingReview: true });
    });
});
