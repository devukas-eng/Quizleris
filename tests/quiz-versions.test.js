import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// The server code is CommonJS: load it the way Node does
const require = createRequire(import.meta.url);
const versions = require('../src/backend/quiz-versions.js');
const plans = require('../src/backend/plans.js');

const quiz = () => ({
    id: 'ABC234',
    title: 'Trupmenos',
    visibility: 'private',
    mode: 'exam',
    questions: [
        { id: 'q1', type: 'multiple-choice', prompt: 'Kiek bus ½ + ½?', choices: [{ id: 'a', text: '1', isCorrect: true }, { id: 'b', text: '2' }] },
        { id: 'q2', type: 'numeric', prompt: '2 + 2', correctAnswerNumber: 4 }
    ]
});

describe('a version of a quiz', () => {
    it('lists its questions by ID and fingerprint, and keeps the rest as settings', () => {
        const split = versions.splitQuiz(quiz());
        expect(split.title).toBe('Trupmenos');
        expect(split.settings).toEqual({ visibility: 'private', mode: 'exam' });
        expect(split.entries.map(([id]) => id)).toEqual(['q1', 'q2']);
        expect(split.contents.size).toBe(2);
    });

    it('comes back exactly as it was saved', () => {
        const original = quiz();
        const split = versions.splitQuiz(original);
        const stored = { title: split.title, settings: versions.stableJson(split.settings), questions: JSON.stringify(split.entries) };
        const back = versions.assembleQuiz('ABC234', stored, hash => JSON.parse(JSON.stringify(split.contents.get(hash))));
        expect(back).toEqual(original);
    });

    it('stores a question once however many copies the quiz has', () => {
        const twice = quiz();
        twice.questions.push({ ...twice.questions[1], id: 'q3' });
        const split = versions.splitQuiz(twice);
        expect(split.entries).toHaveLength(3);
        expect(split.contents.size).toBe(2);
    });
});

describe('the fingerprint of a question in a version', () => {
    const question = quiz().questions[0];

    it('ignores the order keys were written in and the question\'s own ID', () => {
        const reordered = { choices: question.choices, prompt: question.prompt, type: question.type, id: 'other' };
        expect(versions.exactHash(reordered)).toBe(versions.exactHash(question));
    });

    // Unlike the bank's fingerprint: a version must come back exactly, and answers point at choice IDs
    it('counts spacing and choice IDs', () => {
        expect(versions.exactHash({ ...question, prompt: 'Kiek bus  ½ + ½?' })).not.toBe(versions.exactHash(question));
        const renamed = { ...question, choices: question.choices.map(c => ({ ...c, id: c.id + '2' })) };
        expect(versions.exactHash(renamed)).not.toBe(versions.exactHash(question));
    });
});

describe('what each plan keeps', () => {
    it('gives premium longer to bring a deleted quiz back, and more versions', () => {
        const free = { role: 'teacher', subscription_tier: 'free' };
        const premium = { role: 'teacher', subscription_tier: 'premium' };
        expect(plans.recoveryDays(free)).toBe(14);
        expect(plans.recoveryDays(premium)).toBe(30);
        expect(plans.recoveryDays({ role: 'admin' })).toBe(30);
        expect(plans.versionsKept(free)).toBe(5);
        expect(plans.versionsKept(premium)).toBe(30);
    });

    it('lets only premium restore, and says so to the page', () => {
        expect(plans.planCapabilities({ role: 'teacher', subscription_tier: 'free' })).toMatchObject({ restore_quizzes: false, recovery_days: 14, versions_kept: 5 });
        expect(plans.planCapabilities({ role: 'creator' })).toMatchObject({ restore_quizzes: true, recovery_days: 30, versions_kept: 30 });
    });

    it('treats a deleted account as the free plan', () => {
        expect(plans.recoveryDays(undefined)).toBe(14);
    });
});
