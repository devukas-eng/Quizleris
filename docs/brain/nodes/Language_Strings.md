---
tags: [node, frontend]
status: active
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns every Lithuanian and English interface string and how the page switches language. Legal page text is the exception: it lives in `src/app.js` and belongs to [[Branding_Legal]].

## Canonical File Map

- `src/lang.js`: the live strings and `t`, `getLanguage`, `setLanguage`, `initLanguage` and `updatePageLanguage`.
- `src/i18n.js`: unused older copy. Nothing imports it, so editing it changes nothing.
- `tests/lang.test.js`: checks the string tables.

## Connections & Data Flow

- Supplies `t` to every screen, and `updatePageLanguage` is called during boot by -> [[Page_Shell]]
- A language switch rereads the address, which is why stale routes matter in -> [[URL_Routing]]
- Brand wording here is checked with -> [[Branding_Legal]]
- Server refusals become the teacher's language through `quizSaveError`, see -> [[Quiz_Editor]]

## Gotchas & Constraints

- Always edit `src/lang.js`, never `src/i18n.js`. The two export the same function names, so a search can land on the wrong file.
- `src/i18n.js` holds the owner's earlier edits and still has the old name. Check it before deleting, as planned in [[01_STATE]].
- Elements with `data-i18n` are refilled by `updatePageLanguage`. Text set any other way must be set again after a language switch.
- New teacher-facing text needs both languages. Teachers once saw an English limit error.
