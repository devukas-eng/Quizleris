import { describe, it, expect, vi, afterEach } from 'vitest';
import { imageSrc, isStoredPicture, embeddedPictures, adoptStoredPictures, preloadPictures } from '../src/quiz-pictures.js';
import { normalizeImageSrc } from '../src/print-layout.js';

const stored = `/api/media/${'a'.repeat(64)}`;
const other = `/api/media/${'b'.repeat(64)}`;
const dataUrl = 'data:image/png;base64,AAAA';

describe('how a question holds a picture', () => {
    it('knows a stored picture only by its exact address', () => {
        expect(isStoredPicture(stored)).toBe(true);
        expect(isStoredPicture('/api/media/abc')).toBe(false);
        expect(isStoredPicture(`${stored}/../secret`)).toBe(false);
        expect(isStoredPicture(undefined)).toBe(false);
    });

    it('shows every form an <img> can take', () => {
        expect(imageSrc(stored)).toBe(stored);
        expect(imageSrc(dataUrl)).toBe(dataUrl);
        expect(imageSrc('local:img1')).toBe('local:img1');
        expect(imageSrc('https://example.lt/a.png')).toBe('https://example.lt/a.png');
        expect(imageSrc('/9j/4AAQ')).toBe('data:image/jpeg;base64,/9j/4AAQ');
        expect(imageSrc('')).toBe('');
    });

    // The address looks like base64 to the old check, which made it a broken data URL
    it('keeps a stored picture in the print preview and the Word export', () => {
        expect(normalizeImageSrc(stored)).toBe(stored);
        expect(normalizeImageSrc('/9j/4AAQ')).toBe('data:image/jpeg;base64,/9j/4AAQ');
    });
});

describe('after saving a quiz', () => {
    const quiz = () => ({
        questions: [
            { id: 'q1', image: dataUrl, choices: [{ id: 'a', image: 'data:image/png;base64,BBBB' }, { id: 'b', text: 'Ne' }] },
            { id: 'q2', image: stored }
        ]
    });

    it('remembers only the pictures still inside the quiz', () => {
        expect([...embeddedPictures(quiz()).keys()]).toEqual(['q1|', 'q1|a']);
    });

    it('swaps them for the addresses the server gave', () => {
        const editing = quiz();
        adoptStoredPictures(editing, { 'q1|': stored, 'q1|a': other }, embeddedPictures(editing));
        expect(editing.questions[0].image).toBe(stored);
        expect(editing.questions[0].choices[0].image).toBe(other);
    });

    it('leaves a picture the teacher changed while the save was on its way', () => {
        const editing = quiz();
        const sent = embeddedPictures(editing);
        editing.questions[0].image = 'data:image/png;base64,CCCC';
        adoptStoredPictures(editing, { 'q1|': stored }, sent);
        expect(editing.questions[0].image).toBe('data:image/png;base64,CCCC');
    });

    it('changes nothing when the server stored nothing', () => {
        const editing = quiz();
        adoptStoredPictures(editing, undefined, embeddedPictures(editing));
        expect(editing).toEqual(quiz());
    });
});

describe('starting a quiz', () => {
    afterEach(() => vi.unstubAllGlobals());

    const fakeImages = settle => {
        const loaded = [];
        vi.stubGlobal('Image', class {
            set src(url) {
                loaded.push(url);
                if (settle) queueMicrotask(() => this.onload());
            }
        });
        return loaded;
    };

    it('loads each stored picture once and leaves embedded ones alone', async () => {
        const loaded = fakeImages(true);
        await preloadPictures({ questions: [{ image: stored, choices: [{ image: stored }, { image: other }] }, { image: dataUrl }] });
        expect(loaded).toEqual([stored, other]);
    });

    it('does not wait for a quiz with nothing to load', async () => {
        const loaded = fakeImages(true);
        await preloadPictures({ questions: [{ image: dataUrl }] });
        expect(loaded).toEqual([]);
    });

    it('starts anyway when the network is slow', async () => {
        fakeImages(false);
        await expect(preloadPictures({ questions: [{ image: stored }] }, 1)).resolves.toBeUndefined();
    });
});
