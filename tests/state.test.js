import { describe, it, expect } from 'vitest';
import { QuizState, studentChoices, choiceAnswerKey } from '../src/state.js';

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

describe('what the student is shown', () => {
    const write = (id, accepted, isCorrect) => ({ id, kind: 'write', accepted, isCorrect });

    it('shows one box for several write-in slots of a single-answer question', () => {
        const q = { choices: [{ id: 'a', text: 'tu' }, write('b', [], false), write('c', ['zmogus'], true), write('d', [], false)] };
        expect(studentChoices(q).map(c => c.id)).toEqual(['a', 'b']);
    });

    it('shows one box per correct answer with "select all"', () => {
        const q = { allowMultipleAnswers: true, choices: [write('a', ['x'], true), write('b', [], false), write('c', ['y'], true)] };
        expect(studentChoices(q).map(c => c.id)).toEqual(['a', 'b']);
    });

    it('gives the printed answer key the letters the student sees', () => {
        const q = { choices: [{ id: 'a', text: 'tu' }, write('b', [], false), write('c', ['zmogus', 'žmogus'], true), write('d', [], false)] };
        expect(choiceAnswerKey(q)).toEqual([{ letter: 'B', text: 'zmogus / žmogus', typed: true }]);
    });
});

describe('fill-in-the-blank answers', () => {
    const q = { id: 'f', type: 'fill-blank', prompt: 'x = ___, y = ___', blankAnswers: ['0.5', 'Vilnius'] };

    it('ignores decimal comma, case and extra spaces like write-in answers do', () => {
        expect(grade(q, ['0,5', '  vilnius '])).toBe(true);
        expect(grade(q, ['.5', 'VILNIUS'])).toBe(true);
    });

    it('still rejects a wrong blank', () => {
        expect(grade(q, ['0.6', 'Vilnius'])).toBe(false);
    });
});

describe('time running out', () => {
    it('submits what the student already wrote or picked, not nothing', () => {
        const q = { id: 't', type: 'text', prompt: 'Explain' };
        const state = new QuizState({ questions: [q] });
        state.userAnswers.set('t', 'my explanation');
        expect(state.timeoutAnswer()).toBe('my explanation');
        expect(new QuizState({ questions: [q] }).timeoutAnswer()).toBeNull();
    });
});

describe('photo answers', () => {
    it('wait for the teacher instead of counting as wrong', () => {
        const q = { id: 'q3', type: 'image-upload' };
        const result = new QuizState({ questions: [q] }).gradeQuestion(q, 'data:image/jpeg;base64,AAAA');
        expect(result).toEqual({ isCorrect: false, pendingReview: true });
    });
});
