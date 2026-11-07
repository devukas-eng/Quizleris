---
tags: [state, architecture]
status: active
last_verified: 2026-11-07
---

# Project state

Start at [[00_MOC_Architecture]]. Check what is really live before trusting this page: see [[Build_Deploy]].

| Check | State on 2026-11-07 |
|---|---|
| Live | Pushed to `main` on 2026-11-07 with everything below (`976703d` and the commit carrying this note). Confirm it with the hash check in [[Build_Deploy]] |
| Tests | 211 passing with `npm.cmd test`, 152 API checks with `npm.cmd run test:bank-flow`, smoke test passing |
| Lint | 0 errors, 35 warnings with `npm.cmd run lint` |

## Completed in this session

All of it was pushed to `main` on 2026-11-07 in two commits. The decisions are in `docs/adr/0001-quiz-storage-and-the-bank.md` and `docs/adr/0002-what-may-delete-data.md`.

| Second commit | Nodes |
|---|---|
| Deleted quizzes: a deleted or expired quiz waits with its results, 14 days on the free plan and 30 on premium, then goes for good. Premium and admins restore from a "Deleted quizzes" window in My quizzes | [[Data_Lifetime]], [[Dashboard]], [[Auth_Roles_Plans]] |
| Quiz versions: every save that changes something keeps a version, 5 on the free plan and 30 on premium, with each question stored once. File > Earlier versions opens one in the editor | [[Data_Lifetime]], [[Quiz_Editor]] |
| Renewing on the free plan: each quiz, public or private, is kept 30 days from creation, then must be renewed (Renew button or a save) every 7 days. Otherwise it pauses, students are told so, and 3 days later it goes for good with its results | [[Data_Lifetime]], [[Dashboard]], [[Quiz_Runtime]], [[Auth_Roles_Plans]] |
| The privacy text says how long results stay, and `docs/planai.md` lists the new plan rules | [[Branding_Legal]], [[Auth_Roles_Plans]] |

Checked on a local database for these:
- The API flow, including the hourly job.
- The hourly job's date rules, with planted quizzes and a restart.
- As a free teacher in the browser: the delete warning, the deleted quizzes window with Restore greyed out, opening version 1 and undoing it, an active and a paused card, and Renew keeping the card's size.
- As a student: the paused message.

Not tried: restoring from the window as a premium teacher in the browser, which the API flow covers as an admin.

| Committed as `976703d` | Nodes |
|---|---|

| What changed | Nodes |
|---|---|
| Deleting: nothing is deleted for not finding its parent any more. Results, own tasks and labels go by name, with the quiz or account that owns them | [[Data_Lifetime]], [[Backend_API]], [[Quiz_Folders]], [[Task_Bank]] |
| Picture cleanup: it counts quizzes too, waits a real 7 days from the last use, has a brake, and the database refuses to delete a picture in use | [[Data_Lifetime]] |
| Undo in the bank's log: a shared task keeps its old pictures, so undoing a picture change works after the cleanup too | [[Data_Lifetime]], [[Task_Bank]] |
| Expiry: a public or showcase quiz with an old date is no longer deleted | [[Data_Lifetime]] |
| Quiz pictures are stored once and quizzes point at them, in the editor, the student screen, print preview and Word export | [[Data_Lifetime]], [[Quiz_Editor]], [[Quiz_Runtime]] |
| The server records which quiz uses which task, and "most used" is now a true count | [[Data_Lifetime]], [[Task_Bank]] |
| Students: a quiz waits briefly for its pictures, and pictures have their own request limit for school networks | [[Quiz_Runtime]], [[Backend_API]] |
| Smoke test: it had been failing unnoticed since the `featured` column, and passes again | [[Local_Testing]] |

Checked on a local database for those: the API flow, the hourly job with planted cases, and as a free teacher in the browser (add a bank task with a picture, save, play as a student with no login, print preview, Word export). Not tried: the database migration on live MySQL, a real network drop during a test, and dragging a picture question onto Starred.

## Current Architecture State / Active Context

**How it is wired now**

- **Boot:** `src/app.js` starts themes, the dashboard and the bank workspace, then picks a screen from the address: results, a linked quiz, or the home page. Removing `booting` reveals the page. See [[Page_Shell]] and [[URL_Routing]].
- **Between screens:** modules talk through document events: `open-editor`, `open-results`, `quizleris-auth-changed` and `quizleris-themes-changed`.
- **Data:** the browser calls the server through `src/api.js`, and through `src/bank-api.js` for the bank. See [[Backend_API]] and [[Task_Bank]].
- **Quizzes and the bank:** a quiz keeps its question text as a copy, points at shared pictures, and the server records which tasks it came from. See [[Data_Lifetime]].
- **Server:** `server.js` holds the quiz, attempt, admin and showcase routes. The folder router sits at `/api/admin` and the bank router at `/api`. Tables are created at server start.
- **Hosting:** `main` deploys through Hostinger to spresk.eu in under a minute. spresk.lt is a separate Website Builder site, not this app.

**What works now**

- Theme picker, clean addresses, fixed-size loading, All quizzes folders, the Showcase and teacher quiz creation were all checked in the browser against a local database.
- On live, `/api/admin/quiz-browser` answers 401 so the route exists, and `/api/showcase` returns only codes and display settings.
- Every teacher gets the bank columns beside the quiz editor. A new free teacher was tested locally with an empty shared bank: folders and own tasks save, and writes to the shared bank are refused.

**Not confirmed yet**

- The tables `quiz_folders` and `quiz_folder_items` on live. This needs an admin login.
- What the reporting teacher actually saw failing. The fixes came from reproducing the panel as a teacher, not from their report.
- How many tasks the live shared bank holds. While it is empty, teachers see "no tasks found" on the right until staff fill it.

## Next Tasks / TODOs

### Needs the owner

1. **Open All quizzes once on live.** Teachers and System folders should appear. If they do not, look at `ensureQuizFolderSchema` at server start. [[Quiz_Folders]]: `src/backend/quiz-folders.js`, `server.js`
2. **Ask the teacher what exactly failed.** Compare the answer with the table above, then reproduce it as a teacher. [[Dashboard]], [[Local_Testing]]: `src/dashboard-ui.js`, `src/quiz-editor.js`
3. **Give the company code and address** for the legal pages, if they should appear. [[Branding_Legal]]: `getLegalContent` in `src/app.js`
4. **Say which address teachers should use.** spresk.lt and spresk.eu are different sites. [[Build_Deploy]]: `AGENTS.md`
5. **Decide whether to restore lost quizzes.** Quizzes overwritten by the old "Create new quiz" bug can only come from a database backup. [[Quiz_Editor]]
6. **Decide whether the dashboard needs a bank button.** Teachers reach the bank only by opening the quiz editor. [[Task_Bank]], [[Dashboard]]: `src/dashboard-ui.js`, `src/bank-workspace.js`
7. **Fill the unsorted tasks with real ones.** There are none on live, so the feed starts empty. The 162,000 tasks seen in testing are made up on a local computer. Add tasks from Word, PDF or text through the Creation tab, or say where a large collection should come from. [[Creator_Workflow]]: `src/bank-studio.js`
8. **Set the vote limits** in the Creation tab once it is clear how many creators there are. The default is 2, and one creator alone needs 1. [[Creator_Workflow]]: `src/backend/bank-pool.js`
9. **Ask the old teacher what they see after the deploy.** Their exact cause is not confirmed. Ask for a reload, whether an orange "Užduočių bankas" button shows at the bottom right, and check their `role` in the database is exactly `teacher`. [[Task_Bank]]: `src/bank-workspace.js`

10. **Decide whether creators' edits need approval.** Today a creator can edit or archive a published shared task without an admin, and the log records it. [[Creator_Workflow]]: `updateItem` and `archiveItems` in `src/backend/bank.js`
11. **Check the first start on live.** The deploy adds a third step to `MIGRATIONS` and six tables. Hostinger's log should show `[QUIZ LINKS] linked the existing quizzes` and no `[SCHEMA] could not` line. Then save one quiz with a picture and open it as a student. [[Data_Lifetime]], [[Build_Deploy]]
12. **Decide whether public free quizzes older than 30 days need a warning.** After the deploy they get 7 days, then pause, and nobody is emailed. Private quizzes keep their current dates. [[Data_Lifetime]]: `purgeExpiredQuizzes` in `server.js`

### Ready for an agent

Each of these still needs the owner's OK before it goes to production.

1. **Offer corrected tasks to teachers:** show "this task was corrected, update your copy?" for a question whose `origin_hash` differs from its task and that the teacher did not change. Find the card's place first, because UI must not grow into place. [[Data_Lifetime]], [[Quiz_Editor]]: `src/quiz-editor.js`, `src/backend/quiz-links.js`
2. **Measure quiz sizes on live, read-only,** to replace the estimates in `docs/adr/0001-quiz-storage-and-the-bank.md`. [[Data_Lifetime]]: `quizzes.storage_bytes`
3. **Log deleting a classifier value.** It leaves tasks without an entry in the log. [[Task_Bank]]: `/bank/values/:id` in `src/backend/bank.js`
4. **Correct `AGENTS.md`:** the app runs on spresk.eu, not spresk.lt. [[Build_Deploy]]
5. **Build task bank stage 4 (templates)** inside the existing three-column layout. Check that a quiz can hold a copy of a template. [[Task_Bank]]: `src/bank-workspace.js`, `src/backend/bank.js`, `src/backend/bank-core.js`
6. **Add a teacher path to the smoke test,** because the owner never sees teacher bugs. [[Local_Testing]]: `scripts/smoke-test.js`
7. **Remove the bank's read-only paths.** No role reaches them now that every teacher has `writeMine`, for example `homeFolder` and `hasBankToShow`. [[Task_Bank]]: `src/bank-workspace.js`
8. **Remove unused code.** Delete `src/legal.js` and its empty import at `src/menu.js:7`. Check `src/i18n.js` for the owner's earlier edits, move anything needed to `src/lang.js`, then delete it. [[Branding_Legal]], [[Language_Strings]]
9. **Clear the 35 lint warnings.** [[Local_Testing]]: `eslint.config.mjs`
10. **Move routes out of `server.js`,** following the router in `src/backend/quiz-folders.js`. [[Backend_API]]
11. **Split `src/dashboard-ui.js`,** following `src/admin-quiz-browser.js` and `src/admin-showcase.js`. [[Dashboard]]
12. **Add `/api/admin/overview` to the smoke test.** Its bank counts were silently wrong for a long time and no test covers them. [[Local_Testing]]: `scripts/smoke-test.js`
13. **Add unit tests for the log's comparison.** Key order and new lines in `taskChanges` are covered only by the API flow, which needs a running server. [[Creator_Workflow]]: `tests/bank-history.test.js`

### Defaults the owner never confirmed

These were picked without asking. Ask before treating any of them as settled.

- [[Quiz_Folders]]: folders exist only in the admin tab, and teachers' My quizzes has none.
- [[Theme_System]]: every theme is free, the editor covers colours and shape only, and clicking a gallery theme applies it at once. (owner remarks: fuck if i understood this, the UI wasnt binding to a theme 2-3 pushed before- post this it got fixed)
- [[Task_Bank]]: tags go on tasks and not quizzes, and only staff can submit to the bank.
- [[Creator_Workflow]]: creators can no longer import straight into the shared bank, an admin still approves every send, the vote limits default to 2, admins' votes count like creators', and tasks scrolled past without a vote can come back in a later session.
- [[Showcase]]: `customLabel` and `displayFormat` stay stored in case the titles idea returns. The owner said the idea may be good but was badly done.
- [[Data_Lifetime]]: an unused picture waits 7 days, the brake stops at over 100 pictures and a quarter of all, old quizzes change only when next saved, pictures allow 30,000 requests per 15 minutes per address, and a quiz waits up to 2.5 seconds for its pictures. The owner approved the design and gave the 2.5 seconds the benefit of the doubt.
- [[Data_Lifetime]]: the owner set 30 days from creation, then renewing every 7 days, per quiz, with saving counting, and a 3-day pause before deleting for good. Picked without asking: it applies to public quizzes too, showcase quizzes are exempt, a quiz the teacher deletes still waits 14 days in the deleted ones, and an admin's Renew on a free quiz gives 7 days, not forever.
- [[Data_Lifetime]]: the owner set 14 and 30 days for deleted quizzes. Picked without asking: free teachers cannot restore (only see the dates), admins restore anyone's, a restored free quiz gets a fresh 30 days, an account deleted by an admin loses its quizzes at once, and 5 versions on the free plan against 30 on premium.
