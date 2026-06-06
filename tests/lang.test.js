import { describe, it, expect, beforeEach } from 'vitest';
import { t, initLanguage, updatePageLanguage, setLanguage, getLanguage } from '../src/lang.js';

describe('lang.js', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
    });

    it('t should translate keys correctly', () => {
        setLanguage('en');
        expect(t('app.title')).toBe('Quizleris');
        expect(t('nonexistent.key')).toBe('nonexistent.key');
    });

    it('initLanguage should initialize language', () => {
        initLanguage();
        expect(['en', 'lt']).toContain(getLanguage());
    });

    it('updatePageLanguage should update elements with data-i18n', () => {
        document.body.innerHTML = `
            <div data-i18n="app.title">Old</div>
            <input data-i18n-placeholder="student.namePlaceholder" placeholder="Old" />
        `;
        setLanguage('en');
        updatePageLanguage();
        const div = document.querySelector('div');
        const input = document.querySelector('input');
        expect(div.textContent).toBe('Quizleris');
        expect(input.placeholder).toBe('Enter name to track results');
    });
});
