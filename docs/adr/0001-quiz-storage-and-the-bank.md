# ADR-0001: How quizzes store questions that come from the bank

**Status:** Accepted by the owner on 2026-11-07. Steps 1 and 2 are built, not yet deployed
**Date:** 2026-11-07
**Deciders:** The owner

## Context

The vision is that the task bank becomes the normal source of quiz questions. Storage was not built with that in mind.

**How it works today**

- A quiz is one JSON document, `quizzes.quiz_data`, holding every question in full.
- Adding a bank task deep-copies its content into the quiz and gives it a new ID (`toQuestion`, `src/bank-workspace.js:1744`).
- The copy keeps a small note of where it came from: `source: { bankId }`. Only the browser reads it. The server cannot ask which quizzes use a task.
- Pictures are the worst part. The bank stores each picture once by hash (`bank_media`), but `inlineImage` (`src/bank-workspace.js:1763`) turns it back into base64 text inside every quiz that uses it.
- Students load the whole document from one route, `GET /api/quizzes/:id`, pictures included, on every load.

**What is wrong with that**

| Problem | Evidence |
|---|---|
| The same picture is stored again in every quiz | `toQuestion` embeds it, and the comment there says a quiz carries its own pictures |
| Quizzes are heavy to load and to save | Base64 inside the JSON cannot be cached by the browser, and the server allows 20 MB bodies for this reason (`server.js:61`) |
| A quiz with many pictures can lose its draft silently | The draft goes to `localStorage`, and a full store only logs an error (`writeDraft`, `src/quiz-editor.js:333`) |
| A corrected task never reaches the quizzes that hold it | Nothing links a task to its copies on the server |
| `bank_items.uses` is not a real count | It rises when a task is added in the editor, before any save, and never falls (`/bank/used`, `src/backend/bank.js:1885`) |
| An unchanged bank question with a picture looks edited | `taskOfQuestion` compares `data:` text with the bank's `/api/media/` address, so dropping it on Starred or a #tag makes a needless own copy. Found by reading the code, not run |

**What the copy gets right**

A copy is a snapshot, and for a test that is valuable:

- Creators can edit a published shared task without an admin (`updateItem`, `src/backend/bank.js:1097`). With live links, that edit would change every teacher's quiz, including the correct answer, possibly during a test.
- Saved attempts keep `questionId`, `questionPrompt` and the raw `answer` (`src/state.js:340`). Choice answers are stored as choice IDs, so old results need the question as it was when the student answered.
- Teachers change questions after adding them. Each change must split that question from the bank task.
- Own tasks can be deleted for good, and a deleted account's tasks go too (`cleanupBank`). A live link would break any quiz pointing at them.
- Students cannot read the bank (`bankLimits`), so resolving links must happen on the server in any design.

**Sizes**

These are estimates, not measurements. The local database was not running, and the live one was not touched.

- Assumed about 2 KB of text per question.
- Assumed about 300 KB per picture as base64, from the 1400 px limit in `resizeImage`.
- A 20-question quiz with 10 pictures is then about 40 KB of text and about 3 MB of pictures.

So on these assumptions pictures outweigh text by roughly 75 to 1. Action item 1 replaces the guess with real numbers.

The local test database later showed about 275 bytes of text per question, so the text estimate was generous. Its 31 quizzes hold no pictures, and its tasks are made up, so the picture size is still a guess.

**Timing**

The live bank has only a handful of tasks, so a change now costs far less than one after the bank is filled.

## Decision

Keep the question text as a snapshot in the quiz, and make two changes around it:

1. **Pictures are stored once and referenced.** A picture never changes, because its address is its hash, so a reference is safe.
2. **The server records which quiz uses which task.** Each saved quiz writes link rows, which gives real usage counts and lets a corrected task be offered to teachers.

A correction reaches a quiz only when its teacher accepts it. Do not fetch question text live.

## Options Considered

### Option A: Keep full copies

| Dimension | Assessment |
|---|---|
| Complexity | None |
| Cost | Storage and load size grow with every picture used |
| Scalability | Poor for pictures, fine for text |
| Team familiarity | Already in place |

**Pros:** No work, and quizzes never change by accident.
**Cons:** Every problem in the table above remains.

### Option B: Live links, fetched on the spot

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Cost | Least storage |
| Scalability | Good, one batched query per quiz load |
| Team familiarity | New: the editor must split a question from its task on every edit |

**Pros:** One copy of everything, and a fix reaches every quiz at once.
**Cons:** Any edit silently changes running tests and breaks old results. Own tasks can vanish from under a quiz. This also makes the creators' edit rights far more dangerous.

### Option C: Links pinned to a fixed version

The quiz stores `{ bankId, version }`, and versions of a task are never changed.

| Dimension | Assessment |
|---|---|
| Complexity | High: a versions table, assembly on the server, split-on-edit in the editor |
| Cost | Least storage that is still safe |
| Scalability | Good |
| Team familiarity | New |

**Pros:** Safe like a snapshot and small like a link.
**Cons:** Saves only the text, which is the small part. Every reader of `quiz_data` must learn to assemble it. Own tasks would need versions too, because `bank_item_history` covers shared tasks only.

### Option D: Text snapshot, shared pictures, server links (chosen)

| Dimension | Assessment |
|---|---|
| Complexity | Medium, in two independent steps |
| Cost | Removes the repeated pictures and keeps the small repeated text |
| Scalability | Good: text stays small, pictures are cached by browsers for a year |
| Team familiarity | High: reuses `bank_media` and the existing save route |

**Pros:** Fixes the costly part, and old results and running tests stay safe. It also keeps Option C open, because link rows with hashes are what C would start from.
**Cons:** Text is still repeated. A correction needs a teacher's click. Quizzes come to depend on `/api/media`.

## Trade-off Analysis

The main choice is between one source of truth and a stable test. For tasks in a bank, one source of truth is right. For a test already given to students, stability is right. D gives each its own place: the bank is the source, and a quiz is a dated copy that knows where it came from.

Pictures avoid this conflict entirely. A hash address always means the same bytes, so sharing them has none of the dangers of sharing text. That is why they can be references now.

B's main benefit, fixing a mistake everywhere at once, is real. D gets most of it through the link rows, with the teacher agreeing first.

## Consequences

**Easier**

- Quizzes load faster and repeat visits reuse cached pictures.
- Drafts fit in browser storage.
- Tasks can show a true "used in N quizzes".
- Teachers can be told when a task they use was corrected.
- Comparing a question with its task becomes a plain hash check, which also removes the Starred bug above.

**Harder**

- `cleanupBank` deletes pictures that no task links to, so it must learn about quiz pictures in the same change, or quizzes will lose them.
- A quiz save now writes to more tables, and must do it in one transaction.
- A private quiz's pictures sit at a public address. It needs the 64-character hash, so it cannot be guessed, but the rule changes from today.

**To revisit**

- Move to Option C if measured quiz text passes about 1 GB, or if teachers routinely accept corrections across many quizzes.
- Stage 4 templates: check that a quiz can hold a snapshot of a template, not just of a finished task.

## Action Items

1. [ ] **Measure live.** With the owner's OK, run read-only totals on `quizzes.storage_bytes` and split text from pictures, to confirm the sizes above.
2. [x] **Answer the open question:** a corrected task reaches existing quizzes only when the teacher accepts.
3. [x] **Step 1, pictures:**
   - Move `data:` pictures into `bank_media` during `POST /api/quizzes`, reusing the code around `src/backend/bank.js:890`.
   - Add a `quiz_media` table and make `cleanupBank` check it.
   - Stop inlining in `toQuestion`.
   - Allow `/api/media/<sha>` in `sanitizeImageUrl` (`src/render.js:132`) and the editor previews (`src/quiz-editor.js:476`, `:930`), which would both break on it today.
   - Check the Word export and print preview with these addresses.
   - Old quizzes change when next saved, and any picture over `MAX_IMAGE_BYTES` stays inline. No job rewrites them, see [ADR-0002](0002-what-may-delete-data.md).
4. [x] **Step 2, links:**
   - Add a link table of quiz, question, bank task and content hash, written in the save transaction.
   - Work out `uses` from it.
   - Replace the comparison in `taskOfQuestion` with the hash.
5. [ ] **Step 3, corrections:** show "this task was corrected, update your copy?" in the editor.
6. [x] Add tests for picture cleanup with quiz links, and a teacher path through saving a quiz with bank pictures.
