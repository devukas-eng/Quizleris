import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { bankLimits } = require('../src/backend/bank.js');

describe('who may do what with the task bank', () => {
    it('lets every teacher browse the shared bank but not change it', () => {
        const limits = bankLimits({ id: 5, role: 'teacher' });
        expect(limits.read).toBe(true);
        expect(limits.writeShared).toBe(false);
        expect(limits.staff).toBe(false);
    });

    it('lets creators fill the shared bank like admins', () => {
        for (const role of ['creator', 'admin']) {
            const limits = bankLimits({ id: 6, role });
            expect(limits).toMatchObject({ read: true, writeShared: true, writeMine: true, staff: true });
        }
    });

    it('keeps students out', () => {
        expect(bankLimits({ id: 7, role: 'student' }).read).toBe(false);
    });
});
