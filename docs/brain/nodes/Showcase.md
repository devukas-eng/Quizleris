---
tags: [node, admin]
status: active
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns the quiz code board on the landing page and the admin screen that decides which codes it shows and when. The landing page and the admin preview share one board engine. Quiz search comes from [[Quiz_Folders]].

## Canonical File Map

- `src/code-ticker.js`: the board engine (`TICKER_EFFECTS`, `padCode`, `boardWidth`, `playOrder`, `createBoard`, `startTicker`).
- `src/showcase-rules.js`: what is on air now in the admin screen (`itemState`, `livePlaylist`, `liveItems`, `moveItem`).
- `src/admin-showcase.js`: the admin screen (`renderShowcase`, `stopShowcase`) with autosave, search to add and drag to order.
- `src/menu.js`: `renderStartMenu` fetches the settings and starts the board on the landing page.
- `src/api.js`: `fetchShowcase` and `updateShowcaseSettings`.
- `server.js`: `readShowcaseSettings`, `sanitizePlaylists`, `publicShowcase`, `GET /api/showcase` and `PUT /api/admin/showcase`.
- `tests/code-ticker.test.js`: covers the board engine and `src/showcase-rules.js`.
- `tests/showcase.test.js`: covers scheduling and timezone handling.

## Connections & Data Flow

- Rendered as a tab by -> [[Dashboard]]
- Saves settings through `PUT /api/admin/showcase` on -> [[Backend_API]]
- The landing page reads `GET /api/showcase` from -> [[Backend_API]] and renders inside -> [[Page_Shell]]
- Finds quizzes with `browseAdminQuizzes` and `lookupAdminQuizzes` from -> [[Quiz_Folders]]

## Gotchas & Constraints

- `publicShowcase` returns only `enabled`, `intervalSeconds`, `action`, `animStyle`, `order` and `quizzes` with ids. Never add playlists back: they exposed private codes scheduled for later.
- The schedule logic exists twice: `isWithinSchedule` in `server.js` and `src/showcase-rules.js`. A change to one must go into the other, or the preview will disagree with the landing page.
- The five effects are flip, slide, scramble, typewriter and fade. They must keep the board's size, because of the no-grow rule in [[Page_Shell]].
- The tiles are hidden from screen readers, so `startTicker` sets an `aria-label` from `describe`.
- Quiz titles were removed at the owner's request. `customLabel` and `displayFormat` stay stored but no interface uses them, see [[01_STATE]].
- Call `stopShowcase` when leaving the tab. [[Dashboard]] does this on each exit.
