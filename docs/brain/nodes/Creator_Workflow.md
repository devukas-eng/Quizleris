---
tags: [node, bank]
status: wip
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns how tasks reach the shared bank: creators sorting them when they send, admins deciding whole sends, the unsorted tasks and their feed, and the log of every change. The bank itself, its columns and its listings belong to [[Task_Bank]].

## Canonical File Map

- `src/bank-send.js`: the send window for a #tag or a single task (`openSendDialog`, `topicPicker`).
- `src/bank-send-rules.js`: its logic without the page (`searchTopics`, `tagHints`, `blockedReason`, `sendSummary`).
- `src/bank-feed.js`: the full-screen feed of unsorted tasks (`openFeed`).
- `src/bank-studio.js`: the creator's desk, also the admin's Creation tab (`renderStudio`).
- `src/admin-approvals.js`: whole sends and suggestions (`renderApprovals`).
- `src/admin-bank-log.js`: the log and a task's own story (`renderBankLog`, `renderTaskHistory`).
- `src/admin-task-cards.js`: slim rows and cards shared by those screens (`createTaskRows`, `createPager`).
- `src/text-diff.js`: the log's diff (`diffRows`).
- `src/backend/bank.js`: `submitItems`, `decideDraft`, `decideBatch`, `statusMoved`, `publishExisting`, `restoreItem`, `statusBeforeArchive`, `reopenSubmissions`, `revertChange` and `createOwner`.
- `src/backend/bank-history.js`: `taskChanges`, `recordHistory` and `listHistory`.
- `src/backend/bank-pool.js`: `poolDecision`, `poolRoutes`, `addToPool` and `leavePool`.
- `tests/bank-history.test.js`: the log, votes and the feed cursor.
- `tests/bank-send.test.js`: the send rules and the diff.
- `scripts/bank-flow-test.js`: the whole flow through the real API.

## Connections & Data Flow

- Sends tasks into, and reads tags and classifiers from -> [[Task_Bank]]
- Shown in the creator's dashboard and the admin's tabs of -> [[Dashboard]]
- Reads and writes `/api/bank` on -> [[Backend_API]]
- Who may send, decide and undo depends on the role from -> [[Auth_Roles_Plans]]

## Gotchas & Constraints

- **The way in:** a creator cannot add to the shared bank directly (`createOwner`). Tasks reach it through a send, or by an admin. An admin's send publishes at once.
- A send needs a topic, grade and difficulty on every task (`fullClassification`), so an admin only has to say yes. Tasks lacking one are held back as `incomplete`.
- **Shared tasks are never deleted.** Purging is refused for the shared bank, and a rejected copy is archived, or goes back to the unsorted tasks if it came from there. Sending an archived one again brings the same row back. Only teachers' own tasks can go for good.
- **Unsorted tasks** have status `pool` in `bank_items`: the same table, so one hash check stops duplicates between them and the bank, and every teacher path already filters on `published`. `pool` is reached only by adding (`scope: pool`) or restoring, because a task also needs a `bank_pool` row.
- `bank_pool.shuffle` is a random place set once, so a feed page is an index range and not `ORDER BY RAND()`. Each session starts at a random place and walks the ring. Measured with 150,000 tasks: about 15 ms a page.
- A `bank_pool` row marks a task that came from the unsorted ones and is still sorted out of them: a rejected one goes back there, and `leavePool` drops the row on publishing. Restoring reads the log first, and the row only decides for a task archived before the log existed.
- Votes: `poolDecision` is the whole rule. The limits live in `bank_settings` (`pool_likes`, `pool_dislikes`), default 2, and an admin sets them. Lowering a limit applies to votes already cast. One creator alone needs a limit of 1.
- A task voted out stays out when added again, and an admin can restore it with a clean slate.
- Staff's #tags also hold unsorted and waiting tasks (`labelStatuses`). A sent unsorted task moves in place, with no copy.
- **The log** is `bank_item_history`, with no foreign keys so it outlives accounts. Each entry keeps both sides of what changed, in the caller's transaction. Own banks are not logged.
- `REVERTIBLE` and `ACTIONS` live only on the server: entries carry `revertible`, and `/bank/history/users` lists the actions. A merge cannot be undone, because its topic is gone.
- **Any status change of a shared task goes through `statusMoved`** (bulk change, edit, archive, import): it settles pending submissions and drops the `bank_pool` row, so no send stays stuck.
- `restoreItem` returns a task to where it was, by the log (`statusBeforeArchive`). A rejected or waiting task goes back to waiting (`reopenSubmissions`), never live: only an approval publishes a creator's task.
- A rejected task is never left as `draft`: it goes back to the unsorted tasks, or is archived.
- An admin importing a task that is unsorted or waiting publishes it (`publishExisting`).
- The topic list in `src/bank-send.js` is `position: fixed`, placed by script. Do not put `content-visibility` on the rows: its containment clips the list. Closing the window after a change asks first.
- `scripts/bank-flow-test.js` walks all of this through the real API, see [[Local_Testing]].
- `src/bank-send.js` keeps suggestions on screen after a choice. Hiding them moved the buttons below, under the pointer.
- Waiting means `draft` with a pending submission. A waiting task someone archives leaves the queue, so lists join on `i.status = 'draft'`.
- Unconfirmed defaults are listed in [[01_STATE]].
