import { describe, it, expect, beforeEach } from 'vitest';
import { homeUrl, clearRoute, pushResultsRoute } from '../src/url-state.js';

describe('address bar', () => {
    beforeEach(() => window.history.replaceState({}, '', '/'));

    it('takes the page parameters out and keeps everything else', () => {
        expect(homeUrl('https://spresk.lt/?dashboard=R7MSFY')).toBe('/');
        expect(homeUrl('https://spresk.lt/?quiz=R7MSFY&preview=true')).toBe('/');
        expect(homeUrl('https://spresk.lt/?dashboard=A&utm_source=mail#top')).toBe('/?utm_source=mail#top');
        expect(homeUrl('https://spresk.lt/topics')).toBe('/');
    });

    it('leaves no trace of a results page', () => {
        pushResultsRoute('R7MSFY');
        expect(window.location.search).toBe('?dashboard=R7MSFY');
        clearRoute();
        expect(window.location.search).toBe('');
    });

    it('adds no history step when closing', () => {
        pushResultsRoute('R7MSFY');
        const steps = window.history.length;
        clearRoute();
        expect(window.history.length).toBe(steps);
    });
});
