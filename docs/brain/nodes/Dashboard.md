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
- Tab badges come from `/api/admin/overview` in `server.js`. Its bank counts must match what the Bank, Approvals and Reports tabs list. They once read a column that does not exist, and an empty `catch` turned that into a 0 on every badge, so a failure is now logged as `[OVERVIEW]`.
- Approvals must ask for `status: "draft"`. Without it the server lists published tasks, and waiting ones are drafts.
- Task cards in those three tabs share `taskEditButtonsHtml` and `wireInlineTaskEditors`. While editing, the form replaces the preview and Save and Cancel replace Edit. Saving updates only that card, so the list keeps its place.
- The Bank tab is built for tens of thousands of tasks: a slim row each, 50 at a time as the end comes near, and the full task fetched only when its row opens. Rows have different heights once open, so it does not use `createTaskList` from `src/bank-list.js`, whose rows are a fixed height. Each page of rows is one `.dash-bank-page` block with `content-visibility: auto`. Keep it on the page and not on each row: per row, opening a row took about 200 ms at 7,000 rows, and per page about 2 ms at 10,000.
- Clicking a row's head opens and shrinks it, and saving shrinks it too. Shrinking during an edit keeps the typed text inside the row.
- A bank list's `total` can lag about a second behind a write, see [[Task_Bank]]. The Bank tab uses the row count when everything fits on one page, and it must not copy `total` into the badge. Deleting removes the row and lowers the count without reloading.
- Approvals and Reports still show full cards, up to 100 at a time. They are work queues and meant to stay short.
