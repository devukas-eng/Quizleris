import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { t, initLanguage, updatePageLanguage, setLanguage, getLanguage } from '../src/lang.js';

describe('lang.js', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
    });

    it('t should translate keys correctly', () => {
        setLanguage('en');
        expect(t('app.title')).toBe('UAB Judelta');
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
        expect(div.textContent).toBe('UAB Judelta');
        expect(input.placeholder).toBe('Enter name to track results');
    });

    it('updatePageLanguage should tell the browser which language the page is in', () => {
        setLanguage('lt');
        updatePageLanguage();
        expect(document.documentElement.lang).toBe('lt');
        setLanguage('en');
        updatePageLanguage();
        expect(document.documentElement.lang).toBe('en');
    });

    it('the page should start as Lithuanian and refuse browser translation', () => {
        const page = readFileSync('src/index.html', 'utf8');
        expect(page).toContain('<html lang="lt" translate="no"');
        expect(page).toContain('<meta name="google" content="notranslate" />');
    });

    it('should update legal footer elements when language changes', () => {
        document.body.innerHTML = `
            <footer id="legal-footer">
                <button id="lf-terms" data-i18n="legal.terms">Naudojimo sąlygos</button>
                <button id="lf-privacy" data-i18n="legal.privacy">Privatumo politika</button>
                <button id="lf-cookies" data-i18n="legal.cookies">Slapukai</button>
            </footer>
        `;

        setLanguage('en');
        updatePageLanguage();
        expect(document.getElementById('lf-terms').textContent).toBe('Terms of Service');
        expect(document.getElementById('lf-privacy').textContent).toBe('Privacy Policy');
        expect(document.getElementById('lf-cookies').textContent).toBe('Cookies');

        setLanguage('lt');
        updatePageLanguage();
        expect(document.getElementById('lf-terms').textContent).toBe('Naudojimo sąlygos');
        expect(document.getElementById('lf-privacy').textContent).toBe('Privatumo politika');
        expect(document.getElementById('lf-cookies').textContent).toBe('Slapukai');
    });
});
