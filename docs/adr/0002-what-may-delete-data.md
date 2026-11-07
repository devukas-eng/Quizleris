# ADR-0002: What may delete data

**Status:** Accepted by the owner on 2026-11-07, not yet deployed
**Date:** 2026-11-07
**Deciders:** The owner
**Follows:** [ADR-0001](0001-quiz-storage-and-the-bank.md)

## Context

ADR-0001 found that the hourly cleanup could delete pictures quizzes rely on. The owner asked what else it can delete. Shared tasks had already needed protecting once, so this is a pattern, not a single bug.

### Everything that deletes data without a person asking

All of it ran from `purgeExpiredQuizzes` in `server.js`, at every server start and then every hour.

| What was deleted | Why | Risk | Finding |
|---|---|---|---|
| Student results | Their quiz could not be found | **High** | Also ran on every quiz delete and account delete. The code's own comment admits results look orphaned during an ID conversion. A failed conversion or a bad restore of `quizzes` would lose them for good |
| Teachers' own tasks | Their account could not be found | **High** | One bad restore of `users` would wipe every teacher's private bank within the hour, with their stars, nicknames, tags and folders |
| Pictures | No task linked them | **High** | See the three holes below |
| Expired private quizzes | 30 days since the last save | **Medium** | Public and showcase quizzes could go too. See below |
| Filing rows of quizzes | Their quiz could not be found | Low | Only a folder placement, the quiz is not touched |

### Holes in the picture cleanup

1. **Quizzes were not counted.** Harmless while quizzes embed pictures, fatal once they share them.
2. **Undo could break.** Editing a shared task's picture dropped the old link. A day later the picture was gone, and undoing that edit in the log failed with "Unknown picture".
3. **The 24-hour grace was not real.** It counted from when a picture was first uploaded. An old picture that lost its last link was deleted in the very next hourly run.

### Holes in quiz expiry

- `expires_at` is only cleared by saving. An admin making a free teacher's private quiz public, or adding it to the showcase, left the old date in place, so the quiz was still deleted on that date.
- A quiz's results go with it. That is the promised behaviour, but see the open question below.

### Checked and found safe

These only happen when a person asks, and they keep the data:

- Deleting a bank folder moves its tasks up. Deleting a quiz folder does the same.
- Deleting a topic is refused while tasks use it, and deleting a classifier is refused while it has values.
- Shared tasks cannot be purged.
- Browser storage holds only caches and drafts. `saveImageRegistry` can drop other quizzes' cached pictures when full, but quizzes live on the server.

One small gap stays: deleting a classifier value removes it from tasks without an entry in the log (`src/backend/bank.js`, `/bank/values/:id`). It needs an admin's click.

## Decision

**Nothing is deleted because its parent cannot be found. Data is deleted by name, by the action that owns it.**

- Deleting a quiz deletes that quiz's results, filing and links, by quiz ID, in one transaction.
- Deleting an account deletes that account's quizzes, tasks, folders and labels, by account ID.
- The sweeps "delete what has no parent" are gone. If something is ever left behind, it stays: a forgotten row costs a few bytes, a wrong delete costs a teacher's work.

Pictures are the one exception, because many things share them and no single action owns them. Their cleanup gets five protections:

| Protection | What it stops |
|---|---|
| Counts every use: tasks and quizzes | The hole ADR-0001 found |
| A real clock: `unused_since` starts when the last use ends, and the picture waits 7 days | A mistake being final within the hour |
| A brake: if more than 100 pictures and over a quarter of all pictures look unused at once, nothing is deleted and the log says so | A bad restore emptying the store |
| The database refuses: `quiz_media` and `bank_item_media` have foreign keys to `bank_media` | A bug in the cleanup itself |
| A shared task keeps its old pictures, like it keeps its log | Undo failing |

If a reference table is missing, the cleanup's query fails and nothing is deleted. Failing means keeping.

## Design

**Saving a quiz**, one transaction, so a quiz can never point at a picture nobody counts:

```
editor ──POST /api/quizzes──▶ server
                               ├─ data: pictures ──▶ bank_media (stored once by hash)
                               ├─ quiz_data with /api/media/<hash> ──▶ quizzes
                               ├─ which pictures ──▶ quiz_media
                               └─ which tasks ──▶ quiz_bank_links
                              then, outside the transaction:
                               └─ bank_items.uses recounted
```

**Playing a quiz:** the student gets a small JSON document, then the pictures as separate files that the browser keeps for a year.

**New tables** (`src/backend/quiz-links.js`):

| Table | Holds | Foreign key |
|---|---|---|
| `quiz_media` | Quiz ID, picture hash | To `bank_media`, refusing a delete |
| `quiz_bank_links` | Quiz ID, question ID, task ID, the task's hash when copied, the question's hash now | To `bank_items`, the link goes when an own task is purged. The quiz keeps its copy |

**Load:** a class of 30 with 20 pictures makes about 600 picture requests from one school address. The general limit of 3,000 per 15 minutes would soon block a school, so pictures get their own, much looser limit.

**Failure modes**

| If this fails | What happens |
|---|---|
| The link tables cannot be created | Quizzes save as before, with pictures inside. The cleanup finds no table and deletes nothing |
| A picture is too large or an odd type | It stays inside the quiz, as today. The save still works |
| A quiz points at a picture that no longer exists | The save still works, and that one picture stays broken |
| Recounting `uses` fails | It is logged. The count is corrected by the next save of a quiz using that task |
| The network drops during a test | Pictures were loaded when the quiz started, so they stay |

## Small ideas

| Idea | Verdict |
|---|---|
| Load all pictures when the quiz starts, and wait up to 2.5 seconds for them | **Built.** Stops the page jumping and keeps a test working if the network drops |
| Give pictures their own request limit | **Built.** Schools share one address |
| Keep the last 10 versions of each quiz on save | **Proposed.** Saving overwrites with no way back, which is how quizzes were lost before. Quiz JSON is small now that pictures are out, so versions cost little. Needs `quiz_media` to count them too |
| Warn teachers before a quiz expires, or count student use as activity | **Owner's call.** A class can be using a quiz when it expires, because only saving resets the clock |
| Link hand-typed questions that match a bank task by hash | **Later.** Better usage numbers, not needed now |

## Trade-offs

- **Leftovers over losses.** Without sweeps, a crash halfway through a delete could leave rows behind. Deletes are transactions, so this should not happen, and if it does it costs almost nothing.
- **Pictures are served by Node from MySQL.** No worse than today, when the same bytes came inside the JSON. Revisit with a file store or CDN if serving them becomes slow.
- **Old quizzes keep their embedded pictures until the next save.** No job rewrites teachers' quizzes on its own. A deliberate one-off conversion can be run later.

## Open questions for the owner

1. When a free teacher's private quiz expires, its student results go with it, with no warning besides the date shown when saving. Is that the intended promise?
2. Should quiz versions be built next?

## Action Items

1. [x] Delete by name, and remove the sweeps
2. [x] Protect pictures as designed
3. [x] Clear `expires_at` on public and showcase quizzes
4. [ ] Decide the open questions
5. [ ] Check on live after the deploy: run the read-only size totals from ADR-0001
