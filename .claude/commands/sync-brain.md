---
description: Bring docs/brain up to date with the code, then run the link and path check
argument-hint: "[what changed, if it is not obvious]"
---

Bring the project brain in `docs/brain/` up to date with the code. Extra context: $ARGUMENTS

Read `docs/brain/00_MOC_Architecture.md` and `docs/brain/01_STATE.md` first. Do every step, and skip a step only if nothing in it applies.

## 1. Find what changed

- Start from this conversation and `git status --short`.
- Find the last commit that touched the brain with `git log -1 --format=%h -- docs/brain`, then list what came after it with `git diff --name-only <that commit> HEAD`.
- Match each changed file to its node: search `docs/brain/nodes/` for the path, or use the routing table.
- A changed file that no node lists is a gap. Add it to the right node's file map.

## 2. Update the nodes

For each affected node in `docs/brain/nodes/`:

- Keep the frontmatter and the four sections: `## Purpose & Boundaries`, `## Canonical File Map`, `## Connections & Data Flow`, `## Gotchas & Constraints`.
- Change only what the work changed, with no code blocks. Check each new fact against the code before writing it.
- Set `last_verified` to today's date, and only on nodes you actually re-checked.
- If `status` changes, change it in the routing table too.

A new subsystem needs four things: a node, a routing table row, an entry in the Mermaid diagram and its `class` line, and a canvas card.

## 3. Update the state

In `docs/brain/01_STATE.md`:

- Move finished items out of Next Tasks / TODOs and into Completed in this session, with their `[[Nodes]]`.
- In a new session, replace the earlier Completed rows. Git history keeps them.
- Add newly discovered tasks, each with its `[[Node]]` and target files, so the next session can start without searching.
- Update the live commit, test count and lint count only if you measured them again.
- Update Current Architecture State / Active Context if the wiring changed or something unconfirmed got confirmed.

## 4. Update the canvas

Edit `docs/brain/architecture.canvas` by hand, only if a connection between modules or a next-task card changed.

- Every `file` path starts at `docs/brain/`, for example `nodes/Page_Shell.md`.
- Groups stay first in `nodes`. Cards stay inside their group and must not overlap.
- An arrow between two nodes needs a `[[wikilink]]` in one of them.
- Keep arrow labels short, about 20 characters, so they fit the gaps.
- Orange text cards are the next tasks from `01_STATE.md`. When one is done, point its card and arrow at the next task, or remove both.

## 5. Run the check

Run `node scripts/check-brain.js`. Fix whatever it reports and run it again until it passes.

## 6. Report

Say which nodes changed, which tasks moved or were added, whether the canvas changed, and the check's result. Do not commit or push unless the user asked: a push to `main` deploys.
