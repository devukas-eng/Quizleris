---
tags: [state, architecture]
status: active
last_verified: 2026-11-06
---

# Project state

Start at [[00_MOC_Architecture]]. Check what is really live before trusting this page: see [[Build_Deploy]].

| Check | State on 2026-11-06 |
|---|---|
| Live | `main` on spresk.eu, confirm it with the hash check in [[Build_Deploy]] |
| Tests | 133 passing with `npm.cmd test` |
| Lint | 0 errors, 35 warnings with `npm.cmd run lint` |

## Completed in this session

All of this shipped in commit `97f9904`.

| What changed | Nodes |
|---|---|
| Theme picker: a pick survives a reload during sync, the try-on trap is gone, clicks are no longer lost, and tabs stay in step | [[Theme_System]] |
| Address bar: the home page clears `?dashboard=` and `?quiz=`, results open in-app, and a dead `?quiz=` link goes home | [[URL_Routing]], [[Dashboard]] |
| Loading: fixed dashboard size, no size transitions, and the page box stays hidden until filled | [[Page_Shell]] |
| All quizzes: server-side recursive folders, one folder loaded at a time, with server search | [[Quiz_Folders]], [[Backend_API]] |
| Showcase: rebuilt as one screen with autosave, search to add and drag to order, plus a shared code board with five effects | [[Showcase]] |
| Quiz titles under the landing code: removed at the owner's request | [[Showcase]] |
| Teacher panel: "Create new quiz" starts blank, drafts belong to their account, `[hidden]` always wins, unused bank columns stay away, and refusals use the teacher's language | [[Quiz_Editor]], [[Task_Bank]], [[Dashboard]], [[Page_Shell]] |
| Business name: UAB Judelta in the title, footer, cookie banner and legal text | [[Branding_Legal]], [[Language_Strings]] |
| Footer: back in the main window, and at the page bottom only during a quiz | [[Page_Shell]], [[Quiz_Runtime]] |
| API: `/api/showcase` no longer exposes playlists, and `/api/quizzes/:id` reads JSON columns safely | [[Showcase]], [[Backend_API]] |
| Final code review: 10 findings fixed before the commit, then pushed and verified live | [[Build_Deploy]] |

Later commits added:

- This brain, with `/sync-brain` and `scripts/check-brain.js`, see [[Local_Testing]].
- The real contact address on every legal page and in `README.md`, see [[Branding_Legal]].
- The task bank for every teacher: the `BANK_OPEN` switch is gone and each teacher gets a bank of their own, see [[Task_Bank]].
- A new site icon, the logo's `s` in white on green, with icon links in `src/index.html`, see [[Branding_Legal]].

The latest push added:

- Editor header: undo and redo moved beside close, and the quiz picker and delete button now share one oval, see [[Quiz_Editor]].
- Admin badges: the bank counts on `/api/admin/overview` were always 0, and now match the tabs, see [[Dashboard]].
- Approvals tab: it never listed waiting tasks because it asked for published ones, see [[Dashboard]].
- Task cards in the admin tabs: Save and Cancel sit where Edit was, stay in reach while scrolling, and saving shrinks the card in place, see [[Dashboard]].
- Bank loading: it now recovers from a role changed in the database and from one failed request, see [[Task_Bank]].
- Browser translation: the page no longer says it is English and refuses machine translation, see [[Language_Strings]].

Then:

- Admin Bank tab: slim rows that open and shrink in place, loaded as you scroll, so it no longer stops at 60 tasks, see [[Dashboard]].

## Current Architecture State / Active Context

**How it is wired now**

- **Boot:** `src/app.js` starts themes, the dashboard and the bank workspace, then picks a screen from the address: results, a linked quiz, or the home page. Removing `booting` reveals the page. See [[Page_Shell]] and [[URL_Routing]].
- **Between screens:** modules talk through document events: `open-editor`, `open-results`, `quizleris-auth-changed` and `quizleris-themes-changed`.
- **Data:** the browser calls the server through `src/api.js`, and through `src/bank-api.js` for the bank. See [[Backend_API]] and [[Task_Bank]].
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
7. **Ask the old teacher what they see after the deploy.** Their exact cause is not confirmed. Ask for a reload, whether an orange "Užduočių bankas" button shows at the bottom right, and check their `role` in the database is exactly `teacher`. [[Task_Bank]]: `src/bank-workspace.js`

### Ready for an agent

Each of these still needs the owner's OK before it goes to production.

1. **Correct `AGENTS.md`:** the app runs on spresk.eu, not spresk.lt. [[Build_Deploy]]
2. **Build task bank stage 4 (templates)** inside the existing three-column layout. [[Task_Bank]]: `src/bank-workspace.js`, `src/backend/bank.js`, `src/backend/bank-core.js`
3. **Add a teacher path to the smoke test,** because the owner never sees teacher bugs. [[Local_Testing]]: `scripts/smoke-test.js`
4. **Remove the bank's read-only paths.** No role reaches them now that every teacher has `writeMine`, for example `homeFolder` and `hasBankToShow`. [[Task_Bank]]: `src/bank-workspace.js`
5. **Remove unused code.** Delete `src/legal.js` and its empty import at `src/menu.js:7`. Check `src/i18n.js` for the owner's earlier edits, move anything needed to `src/lang.js`, then delete it. [[Branding_Legal]], [[Language_Strings]]
6. **Clear the 35 lint warnings.** [[Local_Testing]]: `eslint.config.mjs`
7. **Move routes out of `server.js`,** following the router in `src/backend/quiz-folders.js`. [[Backend_API]]
8. **Split `src/dashboard-ui.js`,** following `src/admin-quiz-browser.js` and `src/admin-showcase.js`. [[Dashboard]]
9. **Add `/api/admin/overview` to the smoke test.** Its bank counts were silently wrong for a long time and no test covers them. [[Local_Testing]]: `scripts/smoke-test.js`

### Defaults the owner never confirmed

These were picked without asking. Ask before treating any of them as settled.

- [[Quiz_Folders]]: folders exist only in the admin tab, and teachers' My quizzes has none.
- [[Theme_System]]: every theme is free, the editor covers colours and shape only, and clicking a gallery theme applies it at once. (owner remarks: fuck if i understood this, the UI wasnt binding to a theme 2-3 pushed before- post this it got fixed)
- [[Task_Bank]]: tags go on tasks and not quizzes, only staff can submit to the bank, and creators can import straight into the shared bank without approval.
- [[Showcase]]: `customLabel` and `displayFormat` stay stored in case the titles idea returns. The owner said the idea may be good but was badly done.
