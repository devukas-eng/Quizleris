---
tags: [node, bank]
status: wip
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns the shared and private task banks shown beside the quiz editor: browsing, classifying, stars, nicknames, tags, mistake reports and creator submissions. Stages 1 to 3 are live, and stage 4 (templates) is next.

## Canonical File Map

- `src/bank-workspace.js`: the columns beside the editor and their rules, such as `hasBankToShow` and `homeFolder` (about 2,700 lines).
- `src/bank-api.js`: the `/api/bank` client. Calls never throw and resolve to `{ ok, status, data }`.
- `src/bank-list.js`: the virtualized task list (`createTaskList`).
- `src/bank-drag.js`: the pointer drag engine (`armDrag`, `addDropZone`).
- `src/bank-forms.js`: classifying and topic forms.
- `src/backend/bank.js`: `SCHEMA`, `MIGRATIONS`, `bankLimits`, `sharedGroups`, `createBankRouter` and `cleanupBank`.
- `src/backend/bank-core.js`: core helpers used by the bank router.
- `tests/bank-access.test.js`: covers who may do what.
- `tests/bank-core.test.js`: covers the core helpers.

## Connections & Data Flow

- Sits beside, and feeds tasks into -> [[Quiz_Editor]]
- The dashboard window glides into its left column, using the position sent by -> [[Dashboard]]
- Reads and writes `/api/bank` on -> [[Backend_API]]
- Who may read or write depends on the role from -> [[Auth_Roles_Plans]]
- Started at boot and on sign-in by -> [[Page_Shell]]

## Gotchas & Constraints

- `bankLimits`: every teacher may read the shared bank and keep an own bank, and only staff (admin, creator) may write the shared one. Students get neither.
- For teachers the bank appears only beside the quiz editor. Admins also have the Bank, Approvals and Reports tabs in [[Dashboard]].
- Below 1100px the bank is only an orange button at the bottom right, and closing it on a wider screen is remembered in `quizleris_bank_prefs`. Either can read as "the bank is missing", so ask about the screen before suspecting the account.
- Nothing on the server depends on an account's age: `bankLimits` reads only the role, fresh from the database.
- `src/app.js` loads this code at boot, on sign-in and on every `editor-mode`, because a role changed in the database reaches the browser only with the profile. `requestMeta` also asks again after any failure, so one refused request does not hide the bank until a reload.
- `homeFolder` and `hasBankToShow` still handle a user with no own bank, but no role reaches those paths now.
- The live shared bank is empty while the local one has tasks, which hides teacher bugs. Test with an empty bank, see [[Local_Testing]].
- List totals and tree counts come from the in-memory `sharedGroups`. A row changed directly in the database appears in lists, but counts update only after the next API write or a restart.
- New tables go into `SCHEMA`. Changing an existing table needs a `MIGRATIONS` step.
- Nicknames and tags are per-user overlays (`bank_nicknames`, `bank_tags`) and never change the task.
- A quiz question dropped on Starred or a #tag becomes a task first (`taskOfQuestion`): an unchanged bank question uses its bank task, anything else is saved as an own task, and a blank question is refused with a notice.
- Creators send tasks for approval through `bank_submissions`. An admin's own send publishes at once.
- `src/bank-drag.js` also drives question reordering in the editor, so changes reach both.
- Layout follows the owner's sketch: own tasks left, editor middle, bank right. Three columns from 1400px, tabs from 1100px, a drawer below that, and full screen on phones.
- Large screens must use the room, with 1920x1080 as the owner's standard. Later stages stay inside this layout.
- Unconfirmed defaults are listed in [[01_STATE]].
