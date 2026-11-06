import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MAX_DEPTH, premadeSubject, cleanFolderName, folderPath, totalCounts, moveProblem, visibleChildren } = require('../src/backend/quiz-folders.js');

const folder = (id, parent_id = null, system_key = null) => ({ id, parent_id, name: `F${id}`, system_key });

describe('quiz folders', () => {
    it('sorts premade quizzes by subject', () => {
        expect(premadeSubject('cs-sql-beginner', 'cs')).toBe('cs');
        expect(premadeSubject('lang-geography-beginner', 'lang')).toBe('lang');
        expect(premadeSubject('algebra-linear-beginner', 'math')).toBe('math');
        expect(premadeSubject('cs-python-beginner', null)).toBe('cs');
        expect(premadeSubject('anything', null)).toBe('math');
    });

    it('cleans folder names', () => {
        expect(cleanFolderName('  9   klasė  ')).toBe('9 klasė');
        expect(cleanFolderName('<b>Testai</b>')).toBe('bTestai/b');
        expect(cleanFolderName('   ')).toBeNull();
        expect(cleanFolderName('x'.repeat(200))).toHaveLength(80);
    });

    it('walks from the top down to a folder', () => {
        const folders = [folder(1), folder(2, 1), folder(3, 2)];
        expect(folderPath(folders, 3).map(f => f.id)).toEqual([1, 2, 3]);
        expect(folderPath(folders, 99)).toEqual([]);
    });

    it('survives a loop in the stored folders', () => {
        const folders = [folder(1, 2), folder(2, 1)];
        expect(folderPath(folders, 1).map(f => f.id)).toEqual([2, 1]);
    });

    it('counts every quiz below a folder, at any depth', () => {
        const folders = [folder(1), folder(2, 1), folder(3, 2), folder(4)];
        const totals = totalCounts(folders, new Map([[1, 1], [2, 2], [3, 4], [4, 8]]));
        expect(totals.get(1)).toBe(7);
        expect(totals.get(2)).toBe(6);
        expect(totals.get(3)).toBe(4);
        expect(totals.get(4)).toBe(8);
    });

    it('refuses to move a folder inside itself', () => {
        const folders = [folder(1), folder(2, 1), folder(3, 2)];
        expect(moveProblem(folders, 1, 3)).toBe('cycle');
        expect(moveProblem(folders, 1, 1)).toBe('cycle');
        expect(moveProblem(folders, 3, 1)).toBeNull();
        expect(moveProblem(folders, 3, null)).toBeNull();
        expect(moveProblem(folders, 3, 42)).toBe('parent_missing');
    });

    it('refuses a move that would nest too deep', () => {
        const chain = Array.from({ length: MAX_DEPTH }, (_, i) => folder(i + 1, i === 0 ? null : i));
        const loose = [folder(100), folder(101, 100)];
        expect(moveProblem([...chain, ...loose], 100, MAX_DEPTH - 1)).toBe('too_deep');
    });

    it('hides automatic folders with nothing in them, never your own', () => {
        const folders = [
            folder(1, null, 'teachers'),
            folder(2, 1, 'teacher-7'),
            folder(3, 1, 'teacher-8'),
            folder(4, 1),
        ];
        const totals = new Map([[1, 2], [2, 2], [3, 0], [4, 0]]);
        expect(visibleChildren(folders, 1, totals).map(f => f.id)).toEqual([2, 4]);
    });

    it('keeps an empty automatic folder that holds your own folders', () => {
        const folders = [folder(1, null, 'teachers'), folder(2, 1, 'teacher-7'), folder(3, 2)];
        expect(visibleChildren(folders, 1, new Map()).map(f => f.id)).toEqual([2]);
    });

    it('puts Teachers and System first at the top', () => {
        const folders = [folder(5), folder(1, null, 'system'), folder(2, null, 'teachers')];
        expect(visibleChildren(folders, null, new Map()).map(f => f.id)).toEqual([2, 1, 5]);
    });
});
