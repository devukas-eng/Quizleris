---
tags: [node, frontend]
status: active
last_verified: 2026-11-07
---

## Purpose & Boundaries

Owns creating and editing a quiz: the blank start, draft recovery and saving to the account. The bank columns beside it belong to [[Task_Bank]].

## Canonical File Map

- `src/quiz-editor.js`: the editor (`openEditor`, `showBlankQuiz`, `setupAdmin`, `toggleAdminMode`, `refreshAdminUI`) and the draft under `quiz_editor_draft` (about 2,050 lines).
- `src/api.js`: `saveQuizToCloud`, `fetchQuizDetails` and `quizSaveError`.
- `src/storage.js`: quiz ids and browser storage (`generateQuizId`, `saveQuizToStorage`).
- `src/sync.js`: `syncCloudQuizzes`.
- `src/quiz-pictures.js`: `imageSrc` for showing a picture, `embeddedPictures` and `adoptStoredPictures` around a save.
- `src/print-layout.js`: `normalizeImageSrc`, used by the print preview and the Word export.
- `server.js`: `POST /api/quizzes`, including the `quiz_limit` and `quiz_id_taken` refusals.
- `tests/quiz-save-errors.test.js`: covers how refusals turn into messages.

## Connections & Data Flow

- Opened through the `open-editor` event from -> [[Dashboard]], forwarded by -> [[Page_Shell]]
- Takes tasks from, and saves questions to -> [[Task_Bank]]
- Saves quizzes through `POST /api/quizzes` on -> [[Backend_API]]
- The free quiz limit comes from -> [[Auth_Roles_Plans]]
- A save stores pictures and task links through -> [[Data_Lifetime]]

## Gotchas & Constraints

- A picture in a question takes one of several forms: a stored address, a data URL until the first save, or bare base64 in the oldest quizzes. Show it with `imageSrc`, never by checking for `data:`. The stored address also looks like base64, which is why `normalizeImageSrc` tests for it first.
- After a save the server answers where each new picture went, and `adoptStoredPictures` swaps them in unless the teacher changed that picture meanwhile. This keeps the draft in browser storage small.
- `fresh` means start blank. Without it, `openEditor` resumes the draft, and saving then overwrote the teacher's last quiz. This was the worst teacher bug found.
- Quizzes already lost that way can only come from a database backup, see [[01_STATE]].
- A draft records its `owner`, and a draft from another account is not restored, which protects shared computers. Older drafts with no owner still restore.
- Refusals carry a `code`. `quizSaveError` turns `quiz_limit` and `quiz_id_taken` into the teacher's language, so add new codes there too.
- A free teacher who reaches `FREE_QUIZ_LIMIT` gets 403. A taken id gets 409.
- Do not confuse `openEditor` here with the local one in `src/dashboard-ui.js`, see [[Dashboard]].
- Admins and teachers share one header, `.admin-panel-head` in `src/index.html`: status badge, then the saved quiz picker and delete button in one oval (`.admin-load-group`), then undo, redo and close at the right end.
- The delete button is disabled, not hidden, when no quiz is picked. The picker list loads after the editor opens, so hiding it made the oval change shape on every open.
- Below 520px of editor width the header becomes two rows, with the oval alone on the second. The editor is narrow beside the bank columns, so check the header with them open.
