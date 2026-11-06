---
tags: [node, content]
status: wip
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns the public name, copyright and legal texts. The business is UAB Judelta, the brand is spresk, and Quizleris remains only the codebase name. The legal pages still lack a company code and address.

## Canonical File Map

- `src/index.html`: page title, meta description, footer copyright and cookie banner.
- `src/app.js`: live legal texts in `getLegalContent`, shown by `openLegalModal`, plus cookie banner wiring and `.legal-year`.
- `src/lang.js`: brand wording in the interface strings.
- `src/legal.js`: unused. `showLegalModal` is never called, but `src/menu.js` still has an empty import that loads the file.
- `tests/branding.test.js`: keeps the old name out of what visitors see.

## Connections & Data Flow

- Gives the title, footer and legal pages to -> [[Page_Shell]]
- Brand strings live in -> [[Language_Strings]]
- The cookie policy names the storage keys used in -> [[Auth_Roles_Plans]] and [[Theme_System]]

## Gotchas & Constraints

- Legal text is inline HTML in `src/app.js`, not in `src/lang.js`. Edit `getLegalContent`.
- The company was founded about 2024-05-15, from the age the owner gave on 2026-11-06. The footer reads 2024 to the current year.
- `.legal-year` is set once at boot, so the year in the HTML is only a fallback.
- The copyright text also exists in a fallback footer in `src/app.js`, used only if `#legal-footer` is missing. That fallback is built after `.legal-year` runs, so it would keep the written year.
- Keep the lowercase `quizleris_*` storage keys. The cookie policy names them, so renaming would make the policy wrong.
- `src/legal.js` and `src/i18n.js` still show the old name. Both are planned for removal, see [[01_STATE]].
