---
tags: [node, backend]
status: needs-refactor
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns the Express app: routes, rate limits, table creation at start, cleanup jobs and serving `dist/`. Larger areas already live in routers under `src/backend/`, and their rules belong to their own nodes.

## Canonical File Map

- `server.js`: the app, token middleware, quiz, attempt, admin and showcase routes, `ensureSchema`, cleanup jobs and static files (about 1,600 lines).
- `src/api.js`: the browser client for everything except the bank.
- `src/backend/db.js`: the MySQL pool.
- `src/backend/premade.js`: `seedPremadeQuizzes`.
- `src/backend/quiz-folders.js`: folder router, see [[Quiz_Folders]].
- `src/backend/bank.js`: bank router, see [[Task_Bank]].
- `src/backend/user-themes.js`: theme payload checks, see [[Theme_System]].
- `src/backend/plans.js`: plan rules, see [[Auth_Roles_Plans]].
- `scripts/init_db.js`: creates the app tables.
- `scripts/smoke-test.js`: smoke test run with `npm.cmd run test:smoke`.

## Connections & Data Flow

- Serves folder data to -> [[Quiz_Folders]]
- Serves public codes and stores settings for -> [[Showcase]]
- Stores quizzes for -> [[Quiz_Editor]]
- Serves quizzes and stores attempts for -> [[Quiz_Runtime]]
- Serves the bank to -> [[Task_Bank]]
- Stores themes for -> [[Theme_System]]
- Every protected route uses the guards from -> [[Auth_Roles_Plans]]
- Runs on Hostinger from what is shipped by -> [[Build_Deploy]]

## Gotchas & Constraints

- Mount order matters. The `/api` catch-all 404 comes right after the bank router, so any API route added below it never runs.
- Outside `/api`, every unknown path answers 200 with `index.html`. Check content, not status, after a deploy.
- `PUBLIC_DIR` is `dist`, so nothing else in the repository is served, including `docs/`.
- New tables use `CREATE TABLE IF NOT EXISTS` at start. New columns use `addColumnIfMissing`.
- `express.json` allows 20 MB because quizzes embed base64 images.
- `authLimiter`, `apiLimiter`, `quizLookupLimiter` and `attemptLimiter` each guard their own routes.
- Local MariaDB returns JSON columns as strings, so route code must accept both forms.
- `server.js` mixes routes, schema and jobs. New areas should follow the router in `src/backend/quiz-folders.js`.
