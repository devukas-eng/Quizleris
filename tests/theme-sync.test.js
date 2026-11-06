import { describe, it, expect, beforeEach, vi } from 'vitest';

let user = { id: 7, role: 'teacher' };
vi.mock('../src/auth-ui.js', () => ({ getCurrentUser: () => user }));
vi.mock('../src/theme-picker.js', () => ({ reloadSavedTheme: vi.fn() }));

const { initThemeSync, themeSyncStatus } = await import('../src/theme-sync.js');
const { loadCustomThemes, upsertCustomTheme, sanitizeTheme } = await import('../src/themes.js');

const theme = (id, name) => sanitizeTheme({
    id, name, base: 'light',
    colors: { bg: '#ffffff', surface: '#ffffff', text: '#111111', accent: '#1b9b7e', accent2: '#22c997', danger: '#dc2626', success: '#16a34a' },
});

// A fake /api/me/themes: `account` is what the server holds
let account;
let puts;
function mockServer(statusCode = 200) {
    global.fetch = vi.fn(async (url, options = {}) => {
        if (options.method === 'PUT') {
            puts.push(JSON.parse(options.body));
            account = { ...JSON.parse(options.body), updated_at: 'now' };
            return { ok: true, status: 200, json: async () => ({ saved: true }) };
        }
        if (statusCode !== 200) return { ok: false, status: statusCode, json: async () => ({ code: 'premium_required' }) };
        return { ok: true, status: 200, json: async () => account };
    });
}
const settle = () => new Promise(r => setTimeout(r, 1400));

describe('theme sync', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('quizleris_jwt', 'token');
        user = { id: 7, role: 'teacher' };
        account = { selected: null, custom: [], updated_at: null };
        puts = [];
    });

    it('first sync in a browser adds its own themes to the account', async () => {
        upsertCustomTheme(theme('c-local01', 'Vietinė'));
        account = { selected: 'paper', custom: [theme('c-remote1', 'Iš paskyros')], updated_at: 'then' };
        mockServer();
        initThemeSync();
        await settle();
        expect(themeSyncStatus()).toBe('synced');
        expect(loadCustomThemes().map(t => t.id)).toEqual(['c-remote1', 'c-local01']);
        expect(localStorage.getItem('selected_theme')).toBe('paper');
        expect(puts.at(-1).custom.map(t => t.id)).toEqual(['c-remote1', 'c-local01']);
    });

    it('later syncs take the account as it is (a deleted theme stays deleted)', async () => {
        localStorage.setItem('quizleris_theme_sync_user', '7');
        upsertCustomTheme(theme('c-gone001', 'Ištrinta kitur'));
        // It reached the account earlier (nothing unsent), then another device deleted it
        localStorage.removeItem('quizleris_theme_sync_pending');
        account = { selected: 'emerald', custom: [theme('c-remote1', 'Iš paskyros')], updated_at: 'then' };
        mockServer();
        document.dispatchEvent(new window.CustomEvent('quizleris-auth-changed'));
        await settle();
        expect(loadCustomThemes().map(t => t.id)).toEqual(['c-remote1']);
    });

    it('a theme the account never received survives the next sync', async () => {
        localStorage.setItem('quizleris_theme_sync_user', '7');
        account = { selected: 'emerald', custom: [], updated_at: 'then' };
        mockServer();
        document.dispatchEvent(new window.CustomEvent('quizleris-auth-changed'));
        await settle();
        // The server goes down: the new theme's save fails
        global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
        upsertCustomTheme(theme('c-offline1', 'Be ryšio'));
        await settle();
        expect(themeSyncStatus()).toBe('error');
        // Back online, signing in again: the account still lacks it, yet it is kept and sent
        mockServer();
        document.dispatchEvent(new window.CustomEvent('quizleris-auth-changed'));
        await settle();
        expect(loadCustomThemes().map(t => t.id)).toEqual(['c-offline1']);
        expect(puts.at(-1).custom.map(t => t.id)).toEqual(['c-offline1']);
        expect(localStorage.getItem('quizleris_theme_sync_pending')).toBeNull();
    });

    it('a theme picked just before a reload is not overwritten by the older one on the account', async () => {
        localStorage.setItem('quizleris_theme_sync_user', '7');
        localStorage.setItem('selected_theme', 'paper');
        // Picked, then the page reloaded before the save went out
        localStorage.setItem('quizleris_theme_sync_pending', '7');
        account = { selected: 'emerald', custom: [], updated_at: 'then' };
        mockServer();
        document.dispatchEvent(new window.CustomEvent('quizleris-auth-changed'));
        await settle();
        expect(localStorage.getItem('selected_theme')).toBe('paper');
        expect(puts.at(-1).selected).toBe('paper');
    });

    it('a theme picked while the account is still loading stays picked', async () => {
        localStorage.setItem('quizleris_theme_sync_user', '7');
        localStorage.setItem('selected_theme', 'emerald');
        account = { selected: 'emerald', custom: [], updated_at: 'then' };
        mockServer();
        const answer = global.fetch;
        let release;
        global.fetch = vi.fn(async (...args) => {
            if (!args[1]?.method || args[1].method === 'GET') await new Promise(r => { release = r; });
            return answer(...args);
        });
        document.dispatchEvent(new window.CustomEvent('quizleris-auth-changed'));
        await new Promise(r => setTimeout(r, 10));
        localStorage.setItem('selected_theme', 'paper');
        document.dispatchEvent(new window.CustomEvent('quizleris-themes-changed'));
        release();
        await settle();
        expect(localStorage.getItem('selected_theme')).toBe('paper');
        expect(puts.at(-1).selected).toBe('paper');
    });

    it('a theme this browser does not have leaves the current one in place', async () => {
        localStorage.setItem('quizleris_theme_sync_user', '7');
        localStorage.setItem('selected_theme', 'paper');
        account = { selected: 'c-unknown1', custom: [], updated_at: 'then' };
        mockServer();
        document.dispatchEvent(new window.CustomEvent('quizleris-auth-changed'));
        await settle();
        expect(localStorage.getItem('selected_theme')).toBe('paper');
    });

    it('later syncs follow a theme chosen on another device', async () => {
        localStorage.setItem('quizleris_theme_sync_user', '7');
        localStorage.setItem('selected_theme', 'emerald');
        account = { selected: 'paper', custom: [], updated_at: 'then' };
        mockServer();
        document.dispatchEvent(new window.CustomEvent('quizleris-auth-changed'));
        await settle();
        expect(localStorage.getItem('selected_theme')).toBe('paper');
    });

    it('a theme changed and changed back leaves nothing waiting to be sent', async () => {
        localStorage.setItem('quizleris_theme_sync_user', '7');
        localStorage.setItem('selected_theme', 'paper');
        account = { selected: 'paper', custom: [], updated_at: 'then' };
        mockServer();
        document.dispatchEvent(new window.CustomEvent('quizleris-auth-changed'));
        await settle();
        document.dispatchEvent(new window.CustomEvent('quizleris-themes-changed'));
        expect(localStorage.getItem('quizleris_theme_sync_pending')).toBe('7');
        await settle();
        expect(localStorage.getItem('quizleris_theme_sync_pending')).toBeNull();
        expect(puts).toHaveLength(0);
    });

    it('free accounts keep themes in the browser only', async () => {
        upsertCustomTheme(theme('c-local01', 'Vietinė'));
        mockServer(403);
        document.dispatchEvent(new window.CustomEvent('quizleris-auth-changed'));
        await settle();
        expect(themeSyncStatus()).toBe('premium-required');
        expect(loadCustomThemes().map(t => t.id)).toEqual(['c-local01']);
        expect(puts).toHaveLength(0);
    });
});
