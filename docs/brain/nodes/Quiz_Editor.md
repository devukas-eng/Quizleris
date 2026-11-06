---
tags: [node, frontend]
status: active
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns creating and editing a quiz: the blank start, draft recovery and saving to the account. The bank columns beside it belong to [[Task_Bank]].

## Canonical File Map

- `src/quiz-editor.js`: the editor (`openEditor`, `showBlankQuiz`, `setupAdmin`, `toggleAdminMode`, `refreshAdminUI`) and the draft under `quiz_editor_draft` (about 2,050 lines).
- `src/api.js`: `saveQuizToCloud`, `fetchQuizDetails` and `quizSaveError`.
- `src/storage.js`: quiz ids and browser storage (`generateQuizId`, `saveQuizToStorage`).
- `src/sync.js`: `syncCloudQuizzes`.
- `server.js`: `POST /api/quizzes`, including the `quiz_limit` and `quiz_id_taken` refusals.
- `tests/quiz-save-errors.test.js`: covers how refusals turn into messages.

## Connections & Data Flow

- Opened through the `open-editor` event from -> [[Dashboard]], forwarded by -> [[Page_Shell]]
- Takes tasks from, and saves questions to -> [[Task_Bank]]
- Saves quizzes through `POST /api/quizzes` on -> [[Backend_API]]
- The free quiz limit comes from -> [[Auth_Roles_Plans]]

## Gotchas & Constraints

- `fresh` means start blank. Without it, `openEditor` resumes the draft, and saving then overwrote the teacher's last quiz. This was the worst teacher bug found.
- Quizzes already lost that way can only come from a database backup, see [[01_STATE]].
- A draft records its `owner`, and a draft from another account is not restored, which protects shared computers. Older drafts with no owner still restore.
- Refusals carry a `code`. `quizSaveError` turns `quiz_limit` and `quiz_id_taken` into the teacher's language, so add new codes there too.
- A free teacher who reaches `FREE_QUIZ_LIMIT` gets 403. A taken id gets 409.
- Do not confuse `openEditor` here with the local one in `src/dashboard-ui.js`, see [[Dashboard]].
