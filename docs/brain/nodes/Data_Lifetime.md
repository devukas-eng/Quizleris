---
tags: [node, data]
status: active
last_verified: 2026-11-07
---

## Purpose & Boundaries

Owns how quizzes keep and lose data: shared pictures, links to bank tasks, deleted quizzes waiting to be restored, earlier versions, and the rule that nothing is deleted because its parent cannot be found. The reasons are in `docs/adr/0001-quiz-storage-and-the-bank.md` and `docs/adr/0002-what-may-delete-data.md`. Task rules belong to [[Task_Bank]], and the editor's saving to [[Quiz_Editor]].

## Canonical File Map

- `src/backend/quiz-links.js`: `quiz_media`, `quiz_bank_links`, `ensureQuizLinks`, `storePictures`, `linkQuiz`, `forgetQuizzes`, `refreshUses` and `fillLinks`.
- `src/backend/quiz-trash.js`: `deleted_quizzes`, `trashQuizzes`, `purgeQuizzes`, `hourly`, `restoreQuiz`, `listTrash` and `createQuizTrashRouter` at `/api/quiz-trash`.
- `src/backend/quiz-versions.js`: `quiz_versions`, `quiz_version_questions`, `recordVersion`, `pruneVersions`, `listVersions`, `loadVersion` and `exactHash`.
- `src/backend/plans.js`: `FIRST_DAYS`, `KEEP_DAYS`, `keepUntil`, `PAUSE_DAYS`, `RECOVERY_DAYS` and `VERSIONS_KEPT`.
- `src/api.js`: `keepQuiz` and `quizMissingText`, which tells a student a quiz is paused rather than missing.
- `src/quiz-recovery.js`: the two windows (`openDeletedQuizzes`, `openQuizVersions`) and `deleteMessage`.
- `tests/quiz-versions.test.js`: versions and the plans' days.
- `src/backend/bank.js`: `storeImage`, `sweepPictures`, `sweepAllowed`, `removeBankOwner` and `cleanupBank`.
- `src/backend/quiz-folders.js`: `forgetQuizFolders`.
- `server.js`: `deleteQuizzes`, `purgeExpiredQuizzes` and `mediaLimiter`.
- `src/quiz-pictures.js`: the browser's side (`imageSrc`, `isStoredPicture`, `embeddedPictures`, `adoptStoredPictures`, `preloadPictures`).
- `tests/quiz-links.test.js`: the links, the brake, and a check that no delete by a join with a missing parent comes back.
- `tests/quiz-pictures.test.js`: the forms a picture takes in a quiz.
- `scripts/bank-flow-test.js`: all of this through the real API.

## Connections & Data Flow

- Each quiz saved by -> [[Quiz_Editor]] stores its pictures, links and a version here, and its File menu lists the versions
- The deleted quizzes open, and free quizzes are renewed, from My quizzes in -> [[Dashboard]]
- Students are told a quiz is paused when joining in -> [[Quiz_Runtime]]
- Pictures live in `bank_media`, and tasks in the tables of -> [[Task_Bank]]
- Students load the pictures in -> [[Quiz_Runtime]]
- Runs inside the routes and the hourly job of -> [[Backend_API]]
- How often free quizzes need renewing, how long deleted ones wait, who restores and how many versions are kept follow the plans in -> [[Auth_Roles_Plans]]
- The privacy text promises the recovery wait, see -> [[Branding_Legal]]

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
- **Renewing on the free plan:** every free quiz, public or private, has `expires_at` as its renew-by date. Its first 30 days from creation need nothing (`FIRST_DAYS`). From then on a save or `POST /api/quizzes/:id/keep` sets the date 7 days ahead (`KEEP_DAYS`). `keepUntil` in `src/backend/plans.js`, and `GREATEST` in the keep route's SQL, take the later of the two, so renewing early never shortens the first 30 days. Past it, the quiz is paused: students get 404 with code `quiz_paused` and are told to ask the teacher, while the teacher still opens, saves and renews it. After 3 more days (`PAUSE_DAYS`), `hourly` deletes it for good, by name, skipping the deleted quizzes: the pause was its time to come back.
- `purgeExpiredQuizzes` keeps the dates right every hour. It clears them for premium owners and showcase quizzes. A free quiz with no date (a lapsed premium's, one an admin saved, a public one from before renewing) gets the later of day 30 and 7 days from now. Dates already set are never shortened, so on deploy the old rule's 30-day dates stay, and only public quizzes older than 30 days start at 7 days.
- The renew route writes its date with the database's `NOW()`, which the hourly job compares with. The save route still writes a date from Node, so the two can differ by the gap between their time zones, which is small next to 3 days.
- A student halfway through a quiz when it pauses cannot send the result to the server; the copy on their device stays.
- **Deleted quizzes:** deleting moves the row to `deleted_quizzes`, so `quizzes` always means live quizzes and no query there needs a filter. Results, pictures, links and versions stay keyed by the quiz ID, which keeps the pictures safe and makes restoring one row moving back.
- A deleted quiz waits 14 days on the free plan and 30 on premium, by the owner's plan when deleted, then `hourly` deletes it for good by name. Only premium owners restore their own, and admins restore any. The free plan's wait is the time to upgrade.
- A deleted quiz keeps its code. Saving its old draft makes a new quiz with a new code, which the editor adopts, so the deleted one stays restorable. Deleting an account deletes its quizzes, deleted ones too, at once.
- A deleted quiz does not count toward the free limit or toward `uses`.
- `/api/quiz-trash` has its own path because `/api/quizzes/:id` would read "trash" as a quiz code.
- **Versions:** a save that changes something adds a version. A version lists the question IDs and fingerprints plus the settings, and each question's content is stored once per quiz in `quiz_version_questions`. Nothing is replayed, so any version opens in one read.
- `exactHash` differs from the bank's `contentHash` on purpose: spacing and choice IDs count, because a version must come back exactly and results point at choice IDs.
- The free plan keeps 5 versions and premium 30. Pruning deletes the dropped versions and only the questions no kept version shows, all within that quiz.
- The pictures of every kept version count in `quiz_media`, so an old version never opens with a missing picture.
- A quiz saved before versions existed gets what it was as version 1 on its next save.
- Opening a version only loads it into the editor as unsaved changes, so undo takes it back and saving makes it the newest.
- Unconfirmed defaults are listed in [[01_STATE]].
