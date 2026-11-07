---
tags: [node, frontend]
status: needs-refactor
last_verified: 2026-11-07
---

## Purpose & Boundaries

Owns the dashboard window (teachers' My quizzes and the admin tabs) and the results screen of a quiz. The All quizzes and Showcase tabs live in their own modules, and this node only hosts them.

## Canonical File Map

- `src/dashboard-ui.js`: the dashboard window, tab switching, My quizzes, the remaining admin tabs, and the `open-editor` dispatch (about 1,250 lines).
- `src/admin-task-cards.js`: the task cards and slim rows its bank tabs share.
- `src/dashboard.js`: the results screen (`setupDashboard`, `renderDashboard`, `closeResults`).

## Connections & Data Flow

- Hosts the All quizzes tab with `renderQuizBrowser` from -> [[Quiz_Folders]]
- Hosts the Showcase tab with `renderShowcase` from -> [[Showcase]]
- Hosts the Approvals, Creation and Log tabs, and a creator's desk, from -> [[Creator_Workflow]]
- Dispatches `open-editor` to -> [[Quiz_Editor]]
- Dispatches `open-results` to -> [[URL_Routing]]
- Passes the window's position with `open-editor`, so the dashboard can glide into its column in -> [[Task_Bank]]
- Loads and saves through -> [[Backend_API]]
- Opens the deleted quizzes, and words the delete warning by plan, with -> [[Data_Lifetime]]
- Which tabs and buttons appear depends on the role from -> [[Auth_Roles_Plans]]

## Gotchas & Constraints

- On the free plan each quiz card has Renew (`data-keep-quiz`) and shows "active until" or a red Paused chip with the day it goes. Renewing swaps only the text in `.dash-keep-state`, whose fixed height keeps the card the same size. A hint above the list states the rule.
- My quizzes has a "Deleted quizzes" button beside "Create new quiz". It opens a window from `src/quiz-recovery.js`, everyone's for an admin. The delete warning comes from `deleteMessage`, using the `capabilities` kept from `/api/me`.
- `createQuiz` must open the editor with `fresh`. Without it, the draft resumes and saving overwrites the teacher's last quiz.
- Two functions are called `openEditor`. This file's local one takes `(quizId, bankQueue, fresh)` and dispatches `open-editor`. The real one in `src/quiz-editor.js` takes `(quizId, { fresh })`.
- Call `stopShowcase` on every way out of the Showcase tab, or its board keeps running.
- `.dash-window` has a fixed height on purpose, see [[Page_Shell]].
- The old showcase and quiz list code is gone (about 950 lines). The file is still large, so the next split should follow `src/admin-showcase.js`.
- The owner tests only as admin, so teacher bugs here surface only when a teacher reports them. See [[Local_Testing]].
- Tab badges come from `/api/admin/overview` in `server.js`. Its bank counts must match what the Bank, Approvals and Reports tabs list. They once read a column that does not exist, and an empty `catch` turned that into a 0 on every badge, so a failure is now logged as `[OVERVIEW]`.
- Listing waiting tasks needs `status=draft`. Without it the server lists published ones.
- Task cards share `taskEditButtonsHtml` and `wireInlineTaskEditors` in `src/admin-task-cards.js`. While editing, the form replaces the preview and Save and Cancel replace Edit. Saving updates only that card, so the list keeps its place.
- The Bank tab is built for tens of thousands of tasks: a slim row each, 50 at a time as the end comes near, and the full task fetched only when its row opens. Rows have different heights once open, so it uses `createTaskRows` and not `createTaskList` from `src/bank-list.js`, whose rows are a fixed height. Each page of rows is one `.dash-bank-page` block with `content-visibility: auto`. Keep it on the page and not on each row: per row, opening a row took about 200 ms at 7,000 rows, and per page about 2 ms at 10,000.
- Clicking a row's head opens and shrinks it, and saving shrinks it too. Shrinking during an edit keeps the typed text inside the row.
- A bank list's `total` can lag about a second behind a write, see [[Task_Bank]]. The Bank tab uses the row count when everything fits on one page, and it must not copy `total` into the badge. Deleting removes the row and lowers the count without reloading.
- Reports still shows full cards, up to 100 at a time. It is a work queue and meant to stay short.
- The Bank tab's state filter also lists unsorted, waiting and taken-out tasks. Taken-out ones get Restore instead of Edit, and every open row can show its history.
