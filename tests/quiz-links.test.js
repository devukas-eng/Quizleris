import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The server code is CommonJS: load it the way Node does
const require = createRequire(import.meta.url);
const core = require('../src/backend/bank-core.js');
const { sweepAllowed, removeBankOwner } = require('../src/backend/bank.js');
const links = require('../src/backend/quiz-links.js');

const sha = 'a'.repeat(64);
const hash = 'c'.repeat(40);

describe('what a saved quiz points at', () => {
    it('takes only question objects from what the browser sent', () => {
        expect(links.questionsOf({ questions: [{ id: 'q' }, null, 'x'] })).toEqual([{ id: 'q' }]);
        expect(links.questionsOf({})).toEqual([]);
    });

    it('recognises pictures embedded in a quiz', () => {
        expect(links.embeddedPicture('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
        expect(links.embeddedPicture('/9j/4AAQ')).toBe('data:image/jpeg;base64,/9j/4AAQ');
    });

    it('leaves every other picture where it is', () => {
        expect(links.embeddedPicture(`/api/media/${sha}`)).toBeNull();
        expect(links.embeddedPicture('https://example.lt/a.png')).toBeNull();
        expect(links.embeddedPicture('local:img1')).toBeNull();
        expect(links.embeddedPicture(undefined)).toBeNull();
    });

    it('lists stored pictures once, with those of the choices', () => {
        const other = 'b'.repeat(64);
        const questions = [
            { image: `/api/media/${sha}`, choices: [{ image: `/api/media/${other}` }, { image: 'data:image/png;base64,AAAA' }] },
            { image: `/api/media/${sha}` }
        ];
        expect(links.storedPictures(questions).sort()).toEqual([sha, other]);
    });

    it('names a picture the way the editor does', () => {
        const choice = { id: 'a' };
        const question = { id: 'q1', choices: [choice] };
        expect(links.pictureKey(question, question)).toBe('q1|');
        expect(links.pictureKey(question, choice)).toBe('q1|a');
    });
});

describe('questions that came from the bank', () => {
    const task = { type: 'numeric', prompt: 'Kiek bus 2 + 2?', correctAnswerNumber: 4 };

    it('fingerprints a copy like the task it came from', () => {
        const copy = { ...task, id: 'q_1', source: { bankId: 7, hash } };
        expect(core.contentHash(copy)).toBe(core.contentHash(task));
    });

    it('notes the task, the version copied and the question now', () => {
        const [ref] = links.bankRefs([{ ...task, id: 'q_1', source: { bankId: 7, hash } }]);
        expect(ref).toEqual({ questionId: 'q_1', itemId: 7, originHash: hash, questionHash: core.contentHash(task) });
    });

    it('sees a teacher\'s change as a different question', () => {
        const [ref] = links.bankRefs([{ ...task, prompt: 'Kiek bus 3 + 3?', id: 'q_1', source: { bankId: 7, hash: core.contentHash(task) } }]);
        expect(ref.questionHash).not.toBe(ref.originHash);
    });

    it('skips questions with no usable reference', () => {
        expect(links.bankRefs([
            { ...task, id: 'typed by hand' },
            { ...task, id: 'q_2', source: { bankId: 'x' } },
            { ...task, source: { bankId: 7 } },
            { ...task, id: 'q'.repeat(65), source: { bankId: 7 } }
        ])).toEqual([]);
    });

    it('does not trust a made-up version', () => {
        const [ref] = links.bankRefs([{ ...task, id: 'q_1', source: { bankId: 7, hash: 'nonsense' } }]);
        expect(ref.originHash).toBeNull();
    });
});

describe('the rule of what may delete data', () => {
    it('lets the picture cleanup work normally', () => {
        expect(sweepAllowed(3, 3)).toBe(true);
        expect(sweepAllowed(100, 100)).toBe(true);
        expect(sweepAllowed(250, 1000)).toBe(true);
    });

    it('brakes when too many pictures look unused at once', () => {
        expect(sweepAllowed(101, 101)).toBe(false);
        expect(sweepAllowed(251, 1000)).toBe(false);
    });

    it('can never treat the shared bank as an account', async () => {
        await expect(removeBankOwner({}, 0)).rejects.toThrow();
        await expect(removeBankOwner({}, undefined)).rejects.toThrow();
    });

    // The rule of docs/adr/0002-what-may-delete-data.md, so a new sweep has to be argued for
    it('deletes nothing for not finding its parent', () => {
        const sources = ['server.js', 'src/backend/bank.js', 'src/backend/quiz-folders.js', 'src/backend/quiz-links.js', 'src/backend/bank-pool.js'];
        for (const file of sources) {
            const code = readFileSync(join(process.cwd(), file), 'utf8');
            expect(code, file).not.toMatch(/DELETE\s+\w+\s+FROM[^;`'"]*LEFT\s+JOIN/i);
        }
    });
});
