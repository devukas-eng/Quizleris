import { describe, it, expect, beforeEach } from 'vitest';
import { cleanThemePayload } from '../src/backend/user-themes.js';
import {
    THEMES, deriveTokens, themeCss, contrastRatio, textOn, readability, fixReadability,
    sanitizeTheme, encodeShareCode, decodeShareCode, upsertCustomTheme, loadCustomThemes,
    deleteCustomTheme, findTheme, applyTheme, copyTheme, withBase, randomTheme, MAX_CUSTOM_THEMES,
    CUSTOM_THEMES_KEY,
} from '../src/themes.js';

// Every token the stylesheet reads from a theme
const TOKENS = [
    '--bg', '--panel', '--text', '--muted', '--accent', '--accent-strong', '--accent-2', '--on-accent',
    '--danger', '--danger-strong', '--success', '--warning', '--radius', '--control-radius', '--font',
    '--shadow', '--bg-grad', '--app-bg', '--border-color', '--input-bg', '--btn-bg', '--btn-hover-bg',
    '--summary-bg', '--card-bg', '--surface-solid', '--glow-color', '--bubble-a', '--bubble-b',
    '--theme-picker-bg', '--theme-picker-text', '--theme-picker-border',
];

const custom = {
    name: 'Mano', base: 'dark',
    colors: { bg: '#101010', surface: '#202020', text: '#f0f0f0', accent: '#ff8800', accent2: '#ffcc00', danger: '#ff4444', success: '#44ff88' },
    radius: 20, font: 'rounded', effect: { kind: 'grid', strength: 40 }, glass: 70, shadow: 30,
};

describe('themes', () => {
    beforeEach(() => localStorage.clear());

    it('gives every theme every token', () => {
        for (const theme of THEMES) {
            const tokens = deriveTokens(theme);
            for (const k of TOKENS) expect(tokens[k], `${theme.id} ${k}`).toBeTruthy();
        }
    });

    it('keeps the four original themes exactly as they were', () => {
        expect(deriveTokens(findTheme('emerald'))['--accent']).toBe('#1B9B7E');
        expect(deriveTokens(findTheme('emerald'))['--accent-2']).toBe('#22C997');
        expect(deriveTokens(findTheme('slate-dark'))['--panel']).toBe('rgba(30, 41, 59, 0.55)');
        expect(deriveTokens(findTheme('solar'))['--theme-picker-bg']).toBe('#1a1008');
        expect(deriveTokens(findTheme('cyberpunk'))['--bubble-b']).toBe('#00f0ff');
        // Emerald never had a picker hover colour of its own
        expect(deriveTokens(findTheme('emerald'))['--theme-picker-item-hover']).toBeUndefined();
    });

    it('has unique ids and readable text in every theme', () => {
        expect(new Set(THEMES.map(t => t.id)).size).toBe(THEMES.length);
        for (const theme of THEMES.filter(t => !t.tokens)) {
            expect(readability(theme).ok, theme.id).toBe(true);
        }
    });

    it('measures contrast like WCAG', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
        expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
        expect(textOn('#ffff00')).toBe('#111111');
        expect(textOn('#1b1b6b')).toBe('#ffffff');
    });

    it('fixes text that is too close to the background', () => {
        const dim = sanitizeTheme({ ...custom, colors: { ...custom.colors, text: '#333333' } });
        expect(readability(dim).ok).toBe(false);
        expect(readability(fixReadability(dim)).text).toBeGreaterThanOrEqual(4.5);
    });

    it('round-trips a theme through a share code', () => {
        const theme = sanitizeTheme({ ...custom, name: 'Žalia šviesa' });
        const back = decodeShareCode(encodeShareCode(theme));
        expect(back).toMatchObject({ name: 'Žalia šviesa', base: 'dark', colors: theme.colors, radius: 20, font: 'rounded', effect: { kind: 'grid', strength: 40 }, glass: 70, shadow: 30 });
    });

    it('rejects codes and themes that could inject CSS', () => {
        expect(decodeShareCode('nonsense')).toBeNull();
        expect(decodeShareCode('QZT1.' + btoa('{"c":"#fff;}body{display:none"}'))).toBeNull();
        expect(sanitizeTheme({ ...custom, colors: { ...custom.colors, bg: '#fff;}body{display:none' } })).toBeNull();
        const odd = sanitizeTheme({ ...custom, font: 'x;}', radius: 999, effect: { kind: 'url(evil)', strength: -5 }, name: '<img src=x>' });
        expect(odd.font).toBe('system');
        expect(odd.radius).toBe(24);
        expect(odd.effect).toEqual({ kind: 'blobs', strength: 0 });
        expect(odd.name).not.toMatch(/[<>]/);
        expect(themeCss(odd)).not.toMatch(/url\(|<|}\s*body/);
    });

    it('saves, edits and deletes custom themes, up to the limit', () => {
        const saved = upsertCustomTheme(custom);
        expect(loadCustomThemes()).toHaveLength(1);
        upsertCustomTheme({ ...saved, name: 'Kitas' });
        expect(loadCustomThemes()[0].name).toBe('Kitas');
        expect(findTheme(saved.id).custom).toBe(true);
        deleteCustomTheme(saved.id);
        expect(loadCustomThemes()).toHaveLength(0);

        for (let i = 0; i < MAX_CUSTOM_THEMES; i++) expect(upsertCustomTheme({ ...custom, id: undefined })).toBeTruthy();
        expect(upsertCustomTheme({ ...custom, id: undefined })).toBe(false);
    });

    it('skips broken entries in storage', () => {
        localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify([{ base: 'dark' }, custom, 'x']));
        expect(loadCustomThemes()).toHaveLength(1);
        localStorage.setItem(CUSTOM_THEMES_KEY, '{not json');
        expect(loadCustomThemes()).toEqual([]);
    });

    it('keeps random palettes and base switches readable', () => {
        let seed = 7;
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 200; i++) {
            const base = i % 2 ? 'dark' : 'light';
            const theme = sanitizeTheme({ ...randomTheme(base, rand), name: 'x' });
            expect(theme, `random ${i}`).not.toBeNull();
            expect(readability(theme).ok, `random ${i}`).toBe(true);
            const flipped = sanitizeTheme(withBase(theme, base === 'dark' ? 'light' : 'dark'));
            expect(readability(flipped).text, `flipped ${i}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('the server keeps exactly what the page saves, and nothing worse', () => {
        const page = [sanitizeTheme({ ...custom, id: 'c-abcd1234' }), copyTheme(findTheme('paper'), 'Popierius 2')];
        const stored = cleanThemePayload({ selected: 'paper', custom: page });
        expect(stored).toEqual({ selected: 'paper', custom: page });
        expect(cleanThemePayload({ selected: 'x', custom: [{ ...page[0], colors: { ...page[0].colors, bg: '#000;}body{' } }] })).toBeNull();
        expect(cleanThemePayload({ custom: [page[0], page[0]] })).toBeNull();
        expect(cleanThemePayload({ custom: Array(21).fill(0).map((_, i) => ({ ...page[0], id: `c-aaaa${i}x` })) })).toBeNull();
        expect(cleanThemePayload({ selected: 'emerald;drop', custom: [] }).selected).toBeNull();
    });

    it('copies a built-in theme into an editable one', () => {
        const copy = copyTheme(findTheme('ocean'), 'Mano vandenynas');
        expect(copy.custom).toBe(true);
        expect(copy.id).toMatch(/^c-/);
        expect(copy.colors).toEqual(findTheme('ocean').colors);
    });

    it('applies a theme to the page and remembers it', () => {
        applyTheme(findTheme('forest'), { persist: true });
        expect(document.getElementById('theme-vars').textContent).toContain('--accent: #4ade80');
        expect(document.documentElement.dataset.themeBase).toBe('dark');
        expect(localStorage.getItem('selected_theme')).toBe('forest');
        expect(localStorage.getItem('selected_theme_css')).toContain('color-scheme: dark');
    });
});
