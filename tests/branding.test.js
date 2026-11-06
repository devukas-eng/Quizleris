import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(`src/${file}`, 'utf8');

describe('business name', () => {
    it.each(['index.html', 'app.js', 'lang.js'])('%s shows visitors UAB Judelta, not the old name', (file) => {
        expect(read(file)).not.toContain('Quizleris');
        expect(read(file)).toContain('UAB Judelta');
    });

    it('the cookie policy still names the real storage keys', () => {
        expect(read('app.js')).toContain('quizleris_analytics_consent');
        expect(read('app.js')).toContain('quizleris_event_queue');
    });

    it('the copyright starts in the year the company was founded', () => {
        expect(read('index.html')).toContain('&copy; 2024&ndash;');
    });
});
