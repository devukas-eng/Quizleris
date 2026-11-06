---
tags: [node, frontend]
status: needs-refactor
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns the dashboard window (teachers' My quizzes and the admin tabs) and the results screen of a quiz. The All quizzes and Showcase tabs live in their own modules, and this node only hosts them.

## Canonical File Map

- `src/dashboard-ui.js`: the dashboard window, tab switching, My quizzes, the remaining admin tabs, and the `open-editor` dispatch (about 1,600 lines).
- `src/dashboard.js`: the results screen (`setupDashboard`, `renderDashboard`, `closeResults`).

## Connections & Data Flow

- Hosts the All quizzes tab with `renderQuizBrowser` from -> [[Quiz_Folders]]
- Hosts the Showcase tab with `renderShowcase` from -> [[Showcase]]
- Dispatches `open-editor` to -> [[Quiz_Editor]]
- Dispatches `open-results` to -> [[URL_Routing]]
- Passes the window's position with `open-editor`, so the dashboard can glide into its column in -> [[Task_Bank]]
- Loads and saves through -> [[Backend_API]]
- Which tabs and buttons appear depends on the role from -> [[Auth_Roles_Plans]]

## Gotchas & Constraints

- `createQuiz` must open the editor with `fresh`. Without it, the draft resumes and saving overwrites the teacher's last quiz.
- Two functions are called `openEditor`. This file's local one takes `(quizId, bankQueue, fresh)` and dispatches `open-editor`. The real one in `src/quiz-editor.js` takes `(quizId, { fresh })`.
- Call `stopShowcase` on every way out of the Showcase tab, or its board keeps running.
- `.dash-window` has a fixed height on purpose, see [[Page_Shell]].
- The old showcase and quiz list code is gone (about 950 lines). The file is still large, so the next split should follow `src/admin-showcase.js`.
- The owner tests only as admin, so teacher bugs here surface only when a teacher reports them. See [[Local_Testing]].
