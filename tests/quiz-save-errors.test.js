import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { quizSaveError } from '../src/api.js';
import { setLanguage } from '../src/lang.js';

describe('quiz save refusals', () => {
    it('tells a teacher about the quiz limit in their language', () => {
        setLanguage('lt');
        expect(quizSaveError({ code: 'quiz_limit', limit: 5, error: 'Free tier is limited' })).toContain('iki 5 testų');
        setLanguage('en');
        expect(quizSaveError({ code: 'quiz_limit', limit: 5, error: 'Free tier is limited' })).toContain('up to 5 quizzes');
    });

    it('explains a taken quiz code', () => {
        setLanguage('lt');
        expect(quizSaveError({ code: 'quiz_id_taken' })).toContain('kodas jau užimtas');
    });

    it('falls back to what the server said', () => {
        expect(quizSaveError({ error: 'Invalid quiz ID' })).toBe('Invalid quiz ID');
        expect(quizSaveError({})).toBe('Failed to save');
    });
});

describe('hidden elements', () => {
    // Buttons for staff stayed on screen for teachers because their own display rule beat `hidden`
    it('stay hidden whatever a component sets its display to', () => {
        const css = readFileSync('src/style.css', 'utf8');
        expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
    });
});
