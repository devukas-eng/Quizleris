---
tags: [node, content]
status: wip
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns the public name, copyright and legal texts. The business is UAB Judelta, the brand is spresk, and Quizleris remains only the codebase name. The legal pages still lack a company code and address.

## Canonical File Map

- `src/index.html`: page title, meta description, icon links, footer copyright and cookie banner.
- `src/favicon.svg`: the site icon, a white `s` on a solid `#1B9B7E` tile.
- `src/favicon.ico`: the same icon at 16, 32 and 48 pixels, for browsers without SVG icons.
- `src/apple-touch-icon.png`: the same icon for iOS home screens.
- `src/spresk.svg`: the logo vector the icon's `s` was taken from.
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
- Every legal page takes its contact address from the `email` constant in `getLegalContent`. `tests/branding.test.js` fails if a personal Gmail address returns.
- The company was founded about 2024-05-15, from the age the owner gave on 2026-11-06. The footer reads 2024 to the current year.
- `.legal-year` is set once at boot, so the year in the HTML is only a fallback.
- The copyright text also exists in a fallback footer in `src/app.js`, used only if `#legal-footer` is missing. That fallback is built after `.legal-year` runs, so it would keep the written year.
- Keep the lowercase `quizleris_*` storage keys. The cookie policy names them, so renaming would make the policy wrong.
- The icon's `s` is the first letter's outline from `src/spresk.svg`, not a font. It fills 87.5% of the tile so its edges land on whole pixels at 16, 32 and 48. The full word is unreadable at tab size, which is what was wrong with the old icon.
- Browsers hold on to favicons, so raise the `?v=` on the icon links in `src/index.html` when an icon changes. `copy-files.js` stamps only the stylesheet and script.
- `src/apple-touch-icon.png` has square corners and no transparency on purpose: iOS rounds it and turns transparent areas black.
- `src/legal.js` and `src/i18n.js` still show the old name. Both are planned for removal, see [[01_STATE]].
