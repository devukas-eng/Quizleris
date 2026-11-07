import { describe, it, expect } from 'vitest';
import { planCapabilities, keepUntil } from '../src/backend/plans.js';

// Keep in step with docs/planai.md
describe('plans', () => {
    const day = 24 * 60 * 60 * 1000;
    const free = { role: 'teacher', subscription_tier: 'free' };
    const premium = { role: 'teacher', subscription_tier: 'premium' };
    const lapsed = { ...premium, subscription_expires_at: new Date(Date.now() - day).toISOString() };
    const limited = { max_quizzes: 5, first_days: 30, keep_days: 7, pause_days: 3, import_many: false, theme_sync: false, recovery_days: 14, restore_quizzes: false, versions_kept: 5 };
    const full = { max_quizzes: null, first_days: null, keep_days: null, pause_days: null, import_many: true, theme_sync: true, recovery_days: 30, restore_quizzes: true, versions_kept: 30 };

    it('gives free teachers the free limits', () => {
        expect(planCapabilities(free)).toEqual({ plan: 'free', ...limited });
        expect(planCapabilities(lapsed)).toEqual({ plan: 'free', ...limited });
    });

    it('gives premium, creators and admins everything', () => {
        expect(planCapabilities(premium)).toEqual({ plan: 'premium', ...full });
        expect(planCapabilities({ ...premium, subscription_expires_at: new Date(Date.now() + day).toISOString() })).toEqual({ plan: 'premium', ...full });
        expect(planCapabilities({ role: 'creator', subscription_tier: 'free' })).toEqual({ plan: 'creator', ...full });
        expect(planCapabilities({ role: 'admin', subscription_tier: 'free' })).toEqual({ plan: 'admin', ...full });
    });

    it('keeps a free quiz its first 30 days, then 7 days from each renewal', () => {
        const now = new Date('2026-11-07T12:00:00Z');
        const daysAhead = (created) => Math.round((keepUntil(created, now) - now) / day);
        expect(daysAhead(null)).toBe(30);
        expect(daysAhead(new Date(now - 10 * day))).toBe(20);
        expect(daysAhead(new Date(now - 25 * day))).toBe(7);
        expect(daysAhead(new Date(now - 90 * day))).toBe(7);
    });
});
