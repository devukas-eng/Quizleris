import { describe, it, expect, vi } from 'vitest';
import { padCode, boardWidth, playOrder, createBoard, startTicker, TICKER_EFFECTS } from '../src/code-ticker.js';
import { itemState, livePlaylist, liveItems, moveItem } from '../src/showcase-rules.js';

const shown = (root) => [...root.querySelectorAll('.ct-cell')].map(cell => cell.querySelector('.ct-ch').textContent).join('');

describe('code board', () => {
    it('centres a short code on the tiles', () => {
        expect(padCode('AB', 6).join('')).toBe('  AB  ');
        expect(padCode('ABC', 6).join('')).toBe(' ABC  ');
    });

    it('never cuts a code that is longer than the board', () => {
        expect(padCode('ABCDEFGH', 6).join('')).toBe('ABCDEFGH');
    });

    it('makes room for the longest code in the list', () => {
        expect(boardWidth([{ id: 'R7MSFY' }, { id: 'cs-sql-beginner' }])).toBe(15);
        expect(boardWidth([{ id: 'ABC' }])).toBe(6);
    });

    it('plays a list as listed, or each code once when shuffled', () => {
        expect(playOrder(3, 'list')).toEqual([0, 1, 2]);
        expect(playOrder(5, 'shuffle').sort()).toEqual([0, 1, 2, 3, 4]);
    });

    it.each(TICKER_EFFECTS)('%s ends on the new code, with nothing left behind', (effect) => {
        vi.useFakeTimers();
        const root = document.createElement('span');
        const board = createBoard(root, { effect, width: 6 });
        board.show('AAAAAA', { animate: false });
        board.show('BBB');
        vi.advanceTimersByTime(3000);
        expect(shown(root)).toBe(' BBB  ');
        expect(root.querySelectorAll('.ct-temp, .has-caret, .is-noise')).toHaveLength(0);
        expect(root.querySelectorAll('.ct-cell.is-blank')).toHaveLength(3);
        vi.useRealTimers();
    });

    it('tells screen readers which code is showing', () => {
        const mount = document.createElement('button');
        const ticker = startTicker(mount, { items: [{ id: 'R7MSFY' }], effect: 'flip', order: 'list', intervalSeconds: 4, describe: code => `Use: ${code}` });
        expect(mount.getAttribute('aria-label')).toBe('Use: R7MSFY');
        ticker.stop();
    });

    it('a new code cuts a running effect short instead of mixing with it', () => {
        vi.useFakeTimers();
        const root = document.createElement('span');
        const board = createBoard(root, { effect: 'scramble', width: 6 });
        board.show('AAAAAA');
        vi.advanceTimersByTime(50);
        board.show('CCCCCC', { animate: false });
        vi.advanceTimersByTime(3000);
        expect(shown(root)).toBe('CCCCCC');
        vi.useRealTimers();
    });
});

describe('showcase rules', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    const list = (id, items, schedule = {}) => ({ id, items, scheduleStart: '', scheduleEnd: '', ...schedule });
    const item = (quizId, extra = {}) => ({ quizId, enabled: true, scheduleStart: '', scheduleEnd: '', ...extra });

    it('tells what state an item is in', () => {
        expect(itemState(item('A'), now)).toBe('active');
        expect(itemState(item('A', { enabled: false }), now)).toBe('paused');
        expect(itemState(item('A', { scheduleStart: '2026-11-07T00:00:00Z' }), now)).toBe('scheduled');
        expect(itemState(item('A', { scheduleEnd: '2026-11-05T00:00:00Z' }), now)).toBe('ended');
    });

    it('prefers a list inside its time window over the main one, like the server', () => {
        const timed = list('b', [item('B')], { scheduleStart: '2026-11-06T00:00:00Z', scheduleEnd: '2026-11-07T00:00:00Z' });
        const settings = { activePlaylistId: 'a', playlists: [list('a', [item('A')]), timed] };
        expect(livePlaylist(settings, now).id).toBe('b');
        expect(livePlaylist(settings, Date.parse('2026-11-08T00:00:00Z')).id).toBe('a');
    });

    it('shows nothing when the main list is outside its window', () => {
        const settings = { activePlaylistId: 'a', playlists: [list('a', [item('A')], { scheduleEnd: '2026-11-01T00:00:00Z' })] };
        expect(livePlaylist(settings, now)).toBeNull();
        expect(liveItems(null, now)).toEqual([]);
    });

    it('moves items and refuses moves off the list', () => {
        const items = ['a', 'b', 'c'];
        expect(moveItem(items, 0, 2)).toBe(true);
        expect(items).toEqual(['b', 'c', 'a']);
        expect(moveItem(items, 0, -1)).toBe(false);
        expect(moveItem(items, 1, 3)).toBe(false);
    });
});
