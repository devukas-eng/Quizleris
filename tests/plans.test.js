import { describe, it, expect } from 'vitest';
import { planCapabilities } from '../src/backend/plans.js';

// Keep in step with docs/planai.md
describe('plans', () => {
    const day = 24 * 60 * 60 * 1000;
    const free = { role: 'teacher', subscription_tier: 'free' };
    const premium = { role: 'teacher', subscription_tier: 'premium' };
    const lapsed = { ...premium, subscription_expires_at: new Date(Date.now() - day).toISOString() };
    const limited = { max_quizzes: 5, private_expiry_days: 30, import_many: false, theme_sync: false };
    const full = { max_quizzes: null, private_expiry_days: null, import_many: true, theme_sync: true };

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
});
