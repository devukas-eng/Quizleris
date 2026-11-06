---
tags: [node, frontend]
status: active
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns the single HTML page, the boot order, and how any screen sits and appears: `#app-root`, the footer, the landing page and the no-grow loading rule. It does not own what each screen shows.

## Canonical File Map

- `src/index.html`: the only page, with `html.booting`, `#app-root`, `.quiz-main`, `#legal-footer` and the cookie banner.
- `src/app.js`: boot order, document event wiring, footer placement (`placeFooter`), language buttons and the legal modal.
- `src/style.css`: all styles (about 11,500 lines), including `[hidden]`, `--ui-transition`, `.dash-window`, `html.booting` and `body.quiz-page`.
- `src/dom.js`: `getRequiredElement`, `skeletonHtml` and `escapeHtml`.
- `src/menu.js`: the landing page and student join (`renderStartMenu`, `renderStudentJoin`).
- `src/dialog.js`: in-app dialogs such as `alertDialog`.

## Connections & Data Flow

- Reads the address at boot and hands it to -> [[URL_Routing]]
- Starts `initThemePicker` and `initThemeSync` in -> [[Theme_System]]
- Gets all visible text from -> [[Language_Strings]]
- Gets the title, footer text and legal pages from -> [[Branding_Legal]]
- Forwards the `open-editor` event to -> [[Quiz_Editor]]
- Forwards the `open-results` event to -> [[URL_Routing]] and [[Dashboard]]
- Starts `loadBankWorkspace`, and reruns it on sign-in, for -> [[Task_Bank]]
- `renderStartMenu` starts the code board from -> [[Showcase]]
- Watches `.quiz-main` from -> [[Quiz_Runtime]] to place the footer

## Gotchas & Constraints

- **No grow-in.** The owner reads a page that loads small and grows as a bug. Never use `transition: all` or a scale entrance on pages or windows. Transitions use `--ui-transition`, which leaves out size properties.
- Load into a fixed shape: `.dash-window` has a fixed height and `skeletonHtml` fills the wait.
- `html.booting` hides `#app-root` until `src/app.js` has filled it. Both the normal path and the `catch` remove the class, so keep both.
- `[hidden]` is `display: none !important` on purpose. Without it, a component's own `display` rule beat `hidden` and staff buttons showed to teachers. `tests/quiz-save-errors.test.js` checks this rule.
- `#legal-footer` belongs inside `#app-root`. `placeFooter` moves it to `body` and sets `body.quiz-page` only while `.quiz-main` is visible, which is the owner's rule.
- `placeFooter` watches the `style` attribute of `.quiz-main`, so a new way of showing the quiz must still change that element's `display`.
- A stray `</div>` in `src/index.html` once pulled the footer out of the main window. If the footer jumps, count the divs first.
- `#app-root` is 900px wide, but only 680px while the landing hero or student join shows. The editor and results have their own rules so the hero's narrow rule cannot hold them, which removing the bank columns exposed.
