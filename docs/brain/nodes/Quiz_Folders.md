---
tags: [node, admin]
status: active
last_verified: 2026-11-07
---

## Purpose & Boundaries

Owns the admin All quizzes tab: a server-side folder tree loaded one folder at a time, with server search, so the page never loads every quiz. It mixes automatic folders (Teachers > each teacher, System > subject) with the admin's own folders. Teachers' My quizzes does not use it.

## Canonical File Map

- `src/backend/quiz-folders.js`: tables, folder rules, the router, `ensureQuizFolderSchema` and `forgetQuizFolders`.
- `src/admin-quiz-browser.js`: the tab's interface (`renderQuizBrowser`, `flattenTree`, `folderName`).
- `src/api.js`: `browseAdminQuizzes`, `lookupAdminQuizzes`, `createQuizFolder`, `updateQuizFolder`, `deleteQuizFolder` and `moveQuizzesToFolder`.
- `server.js`: mounts the router at `/api/admin` with `guards` and `attemptsReady`.
- `tests/quiz-folders.test.js`: covers the folder rules.

## Connections & Data Flow

- Rendered as a tab by -> [[Dashboard]], which passes `wireCards`, `createQuiz`, `formatDate` and `onCountsChange`
- Calls `/quiz-browser`, `/quiz-lookup`, `/quiz-folders`, `/quiz-folders/:id` and `/quiz-folders/items` under `/api/admin` on -> [[Backend_API]]
- Quiz search and lookup are reused by -> [[Showcase]]
- Admin access is enforced by the guards from -> [[Auth_Roles_Plans]]

## Gotchas & Constraints

- The tables `quiz_folders` and `quiz_folder_items` are created at server start. Live confirmation is still open, see [[01_STATE]].
- `GET /api/admin/quizzes` is gone. `PATCH /api/admin/quizzes/:id` remains.
- Automatic folders carry a `system_key` (`teachers`, `teacher-<id>`, `system`, `system-math`, `system-cs`, `system-lang`). The admin's own folders have none.
- `visibleChildren` hides an empty automatic folder unless it holds own folders. It never hides own folders, and an earlier version left them unreachable.
- Moves are refused with `cycle`, `too_deep` or `parent_missing` from `moveProblem`. `MAX_DEPTH` is 12.
- `folderPath` survives a loop in stored data instead of hanging.
- `premadeSubject` sorts premade quizzes into System subjects by id or stored subject, and falls back to `math`.
- `cleanFolderName` strips angle brackets, collapses spaces and cuts the name to 80 characters.
- A deleted quiz leaves its folder through `forgetQuizFolders`, by name, see [[Data_Lifetime]]. A failure there is only logged: filing never stops a delete.
- Admin-only folders are an unconfirmed default, see [[01_STATE]].
