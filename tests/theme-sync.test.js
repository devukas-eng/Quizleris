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
        account = { selected: 'emerald', custom: [theme('c-remote1', 'Iš paskyros')], updated_at: 'then' };
        mockServer();
        document.dispatchEvent(new window.CustomEvent('quizleris-auth-changed'));
        await settle();
        expect(loadCustomThemes().map(t => t.id)).toEqual(['c-remote1']);
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
