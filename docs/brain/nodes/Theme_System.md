---
tags: [node, frontend]
status: active
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns how the app looks: built-in themes as data, custom themes, the header picker, the gallery with its editor, and premium account sync. It does not own layout, which belongs to [[Page_Shell]].

## Canonical File Map

- `src/themes.js`: theme data and browser storage (`sanitizeTheme`, `loadCustomThemes`, `upsertCustomTheme`), plus `QZT1.` share codes.
- `src/theme-picker.js`: the header picker (`setTheme`, `beginTryOn`, `endTryOn`, `reloadSavedTheme`) and the lazy loader for the gallery.
- `src/theme-store.js`: the gallery and custom theme editor, loaded on first use.
- `src/theme-sync.js`: account sync (`initThemeSync`, `themeSyncStatus`).
- `src/backend/user-themes.js`: server-side checks for table `user_themes` (`cleanThemePayload`).
- `tests/theme-sync.test.js`: sync order, pending flag and free accounts.
- `tests/themes.test.js`: theme data and sanitizing.

## Connections & Data Flow

- Started at boot by -> [[Page_Shell]]
- Reacts to `quizleris-auth-changed` from -> [[Auth_Roles_Plans]]
- Reads and writes `/api/me/themes` through -> [[Backend_API]]
- Whether an account may sync depends on `isPremium` in -> [[Auth_Roles_Plans]]
- Interface text comes from -> [[Language_Strings]]

## Gotchas & Constraints

- Browser keys are `selected_theme`, `quizleris_theme_sync_user` and `quizleris_theme_sync_pending`. Changes announce themselves with `quizleris-themes-changed`.
- The pending key means a local change has not reached the account. An unsent local pick beats the account on the next sync, and a no-op push must still clear the flag.
- After the first sync in a browser, the account wins, so a theme deleted on another device stays deleted.
- A free account gets 403 `premium_required`, and its themes stay in the browser.
- `isPremium` covers admins, creators and active premium accounts.
- `openThemeStore` exists twice on purpose: the one in `src/theme-picker.js` lazily imports the real one in `src/theme-store.js`.
- A tab left open across a deploy can fail that import. It then shows a dialog asking for a reload.
- Clicking a gallery card applies the theme at once. Try-on remains only for the editor's draft.
- The picker's lists are rendered when it opens, so they cannot show a stale theme. A `storage` event keeps tabs in step.
- Primary buttons follow each theme's accent.
- Unconfirmed defaults are listed in [[01_STATE]].
