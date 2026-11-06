import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { bankLimits, createOwner, labelStatuses } = require('../src/backend/bank.js');

describe('who may do what with the task bank', () => {
    it('lets every teacher browse the shared bank but not change it', () => {
        const limits = bankLimits({ id: 5, role: 'teacher' });
        expect(limits.read).toBe(true);
        expect(limits.writeShared).toBe(false);
        expect(limits.staff).toBe(false);
    });

    it('gives every teacher a bank of their own', () => {
        expect(bankLimits({ id: 5, role: 'teacher' }).writeMine).toBe(true);
    });

    it('lets creators fill the shared bank like admins', () => {
        for (const role of ['creator', 'admin']) {
            const limits = bankLimits({ id: 6, role });
            expect(limits).toMatchObject({ read: true, writeShared: true, writeMine: true, staff: true });
        }
    });

    it('keeps students out', () => {
        expect(bankLimits({ id: 7, role: 'student' })).toMatchObject({ read: false, writeShared: false, writeMine: false });
    });
});

describe('where new tasks may go', () => {
    const teacher = { id: 5, role: 'teacher' };
    const creator = { id: 6, role: 'creator' };
    const admin = { id: 7, role: 'admin' };

    it('lets everyone fill their own bank', () => {
        expect(createOwner(teacher, 'mine')).toBe(5);
        expect(createOwner(creator, 'mine')).toBe(6);
    });

    it('lets only an admin put tasks straight into the shared bank', () => {
        expect(createOwner(admin, 'shared')).toBe(0);
        expect(() => createOwner(creator, 'shared')).toThrow('approval');
        expect(() => createOwner(teacher, 'shared')).toThrow();
    });

    it('lets staff add unsorted tasks, and nobody else', () => {
        expect(createOwner(creator, 'pool')).toBe(0);
        expect(createOwner(admin, 'pool')).toBe(0);
        expect(() => createOwner(teacher, 'pool')).toThrow();
    });
});

describe('what a #tag can hold', () => {
    it('keeps teachers to the bank\'s published tasks', () => {
        expect(labelStatuses({ role: 'teacher' })).toEqual(['published']);
    });

    it('lets staff collect tasks not in the bank yet', () => {
        expect(labelStatuses({ role: 'creator' })).toEqual(['published', 'pool', 'draft']);
    });
});
