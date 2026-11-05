import { describe, it, expect } from 'vitest';

function parseScheduleDate(str) {
    if (!str) return null;
    const s = String(str).trim();
    if (!s) return null;
    if (/Z|[+-]\d{2}(:?\d{2})?$/i.test(s)) {
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    try {
        const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Vilnius', timeZoneName: 'shortOffset' });
        const parts = fmt.formatToParts(new Date());
        const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
        const match = tzPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
        const sign = match && match[1] === '-' ? '-' : '+';
        const offsetH = match ? String(match[2]).padStart(2, '0') : '02';
        const offsetM = match ? String(match[3] || 0).padStart(2, '0') : '00';
        const d = new Date(`${s}${sign}${offsetH}:${offsetM}`);
        if (!Number.isNaN(d.getTime())) return d;
    } catch {
        // fallback
    }
    const fallback = new Date(s);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function isWithinSchedule(startStr, endStr, now = new Date()) {
    if (startStr) {
        const s = parseScheduleDate(startStr);
        if (s && now < s) return false;
    }
    if (endStr) {
        const e = parseScheduleDate(endStr);
        if (e && now > e) return false;
    }
    return true;
}

describe('Showcase scheduling & timezone evaluation', () => {
    it('evaluates naive Lithuanian datetime inputs accurately against UTC current time', () => {
        // Current UTC time: 21:52:00 UTC (equivalent to 23:52 Vilnius UTC+2)
        const nowUtc = new Date('2026-11-05T21:52:00.000Z');
        // Admin entered 22:27 (10:27 PM local time in Lithuania)
        const naiveStart = '2026-11-05T22:27';
        const naiveEnd = '2026-11-07T23:30';

        // 22:27 Vilnius is 20:27 UTC. Since 21:52 UTC > 20:27 UTC, it should be active!
        expect(isWithinSchedule(naiveStart, naiveEnd, nowUtc)).toBe(true);
    });

    it('evaluates ISO UTC timestamps accurately across all environments', () => {
        const now = new Date('2026-11-05T21:52:00.000Z');
        const start = '2026-11-05T20:27:00.000Z';
        const end = '2026-11-07T21:30:00.000Z';
        expect(isWithinSchedule(start, end, now)).toBe(true);
    });

    it('rejects future scheduled quizzes', () => {
        const nowUtc = new Date('2026-11-05T19:00:00.000Z');
        const naiveStart = '2026-11-05T22:27'; // 20:27 UTC
        expect(isWithinSchedule(naiveStart, null, nowUtc)).toBe(false);
    });

    it('rejects ended quizzes', () => {
        const nowUtc = new Date('2026-11-08T00:00:00.000Z');
        const naiveEnd = '2026-11-07T23:30'; // 21:30 UTC
        expect(isWithinSchedule(null, naiveEnd, nowUtc)).toBe(false);
    });
});
