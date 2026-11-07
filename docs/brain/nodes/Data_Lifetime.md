---
tags: [node, data]
status: active
last_verified: 2026-11-07
---

## Purpose & Boundaries

Owns how quizzes and the bank share data, and the rule for what may delete it: nothing is deleted because its parent cannot be found. The reasons are in `docs/adr/0001-quiz-storage-and-the-bank.md` and `docs/adr/0002-what-may-delete-data.md`. Task rules belong to [[Task_Bank]], and the editor's saving to [[Quiz_Editor]].

## Canonical File Map

- `src/backend/quiz-links.js`: `quiz_media`, `quiz_bank_links`, `ensureQuizLinks`, `storePictures`, `linkQuiz`, `forgetQuizzes`, `refreshUses` and `fillLinks`.
- `src/backend/bank.js`: `storeImage`, `sweepPictures`, `sweepAllowed`, `removeBankOwner` and `cleanupBank`.
- `src/backend/quiz-folders.js`: `forgetQuizFolders`.
- `server.js`: `deleteQuizzes`, `purgeExpiredQuizzes` and `mediaLimiter`.
- `src/quiz-pictures.js`: the browser's side (`imageSrc`, `isStoredPicture`, `embeddedPictures`, `adoptStoredPictures`, `preloadPictures`).
- `tests/quiz-links.test.js`: the links, the brake, and a check that no delete by a join with a missing parent comes back.
- `tests/quiz-pictures.test.js`: the forms a picture takes in a quiz.
- `scripts/bank-flow-test.js`: all of this through the real API.

## Connections & Data Flow

- Each quiz saved by -> [[Quiz_Editor]] stores its pictures and links here
- Pictures live in `bank_media`, and tasks in the tables of -> [[Task_Bank]]
- Students load the pictures in -> [[Quiz_Runtime]]
- Runs inside the routes and the hourly job of -> [[Backend_API]]
- Which quizzes expire follows the plans in -> [[Auth_Roles_Plans]]

## Gotchas & Constraints

- **The rule:** data is deleted by name, by the action that owns it, in one transaction. Never add a cleanup that deletes what has no parent. Leftovers cost bytes, a wrong delete costs a teacher's work. `tests/quiz-links.test.js` fails on a `DELETE … LEFT JOIN`.
- **The one exception is pictures:** many things share them and no action owns them. A picture goes only when no task and no quiz uses it, and `unused_since` is over 7 days old.
- **The brake:** `sweepAllowed` stops all picture deletes when more than 100 pictures and over a quarter of them look unused at once. It only writes to the log, so a stuck cleanup keeps pictures, which is the safe side.
- A missing `quiz_media` table makes the cleanup's query fail, so nothing is deleted. Keep it that way.
- `quiz_media` and `bank_item_media` have foreign keys to `bank_media` with no `ON DELETE`, so the database refuses to delete a picture in use.
- A quiz holding a stored picture must have a `quiz_media` row, or the cleanup takes the picture. That is why the save route writes the picture, the quiz and the links in one transaction. Anything else that writes `quiz_data` with a new picture must call `linkQuiz`.
- A shared task keeps its old pictures linked (`linkMedia` with `keepOld`), so undoing an edit in its log still works.
- Question text stays a copy in `quiz_data` on purpose: a creator's edit must never change a running test, and old results need the question as it was.
- `source.hash` on a question is the task's fingerprint when copied. `quiz_bank_links` keeps that as `origin_hash` and the question's own as `question_hash`, so equal means the teacher changed nothing.
- `uses` counts quizzes holding a task, recounted after each save and delete, outside the transaction so a count can never fail a save.
- A picture the store refuses (over 4 MB, an odd type) stays inside the quiz, and a stored picture that no longer exists does not stop a save. No save that worked before may fail now.
- Old quizzes keep embedded pictures until they are next saved. Nothing rewrites teachers' quizzes on its own, and `fillLinks` only reads them.
- `/api/media/` has its own limiter, because a class starting a quiz is hundreds of requests from one school address.
- Pictures are served without a login. Their address is a 64-character hash, so it cannot be guessed, but a private quiz's picture is reachable by anyone who has that address.
- Only private quizzes expire: `purgeExpiredQuizzes` first clears `expires_at` on public and showcase quizzes. An expired quiz takes its student results with it.
- Unconfirmed defaults are listed in [[01_STATE]].
