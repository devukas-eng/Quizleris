import { describe, it, expect } from 'vitest';
import { raceQuestions } from '../src/race.js';

describe('race mode questions', () => {
    const quiz = {
        title: 'T',
        questions: [
            { id: '1', prompt: 'Pick', choices: [{ id: 'a', text: 'yes', isCorrect: true }, { id: 'b', text: 'no' }] },
            { id: '2', prompt: 'Write', choices: [{ id: 'a', text: 'x' }, { id: 'b', kind: 'write', accepted: ['y'], isCorrect: true }] },
            { id: '3', type: 'image-upload', prompt: 'Photo' },
            { id: '4', type: 'text', prompt: 'Essay' },
            { id: '5', type: 'true-false', prompt: 'Sky is blue', isTrue: true },
        ],
    };

    it('only plays questions answered with one tap, never write-in or photo ones', () => {
        expect(raceQuestions(quiz).map(q => q.id)).toEqual(['1', '5']);
    });

    it('turns true/false questions into two buttons with the right one marked', () => {
        const tf = raceQuestions(quiz).find(q => q.id === '5');
        expect(tf.answers.map(a => a.isCorrect)).toEqual([true, false]);
    });
});
