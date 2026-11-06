---
tags: [node, frontend]
status: active
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns what the address bar says and how every way out of a page clears it. There is no router library: the routes are the query parameters `dashboard`, `quiz`, `preview` and `view`, read at boot.

## Canonical File Map

- `src/url-state.js`: `ROUTE_PARAMS`, `homeUrl`, `clearRoute` and `pushResultsRoute`.
- `src/app.js`: reads the parameters at boot, runs `openLinkedQuiz`, and handles `open-results`.
- `src/dashboard.js`: `closeResults` clears the route.
- `src/menu.js`: `renderStartMenu` clears the route, so going home always cleans the address.
- `src/share-links.js`: builds the quiz links and share strip (`quizLinks`, `shareStripHtml`).
- `tests/url-state.test.js`: covers `homeUrl` and the other address rules.

## Connections & Data Flow

- `?dashboard=<id>` opens the results screen in -> [[Dashboard]]
- `?quiz=<id>` goes through `openLinkedQuiz` into -> [[Quiz_Runtime]]
- Receives `open-results` from a dashboard link in -> [[Dashboard]]
- Boot order and the `booting` class belong to -> [[Page_Shell]]

## Gotchas & Constraints

- A reload and a language switch both read the address, so a stale value drags the old page back. Every way out of a page must clear it.
- A new route parameter must go into `ROUTE_PARAMS`, or it will stick in the address.
- `homeUrl` keeps any other parameters and the hash. It also turns the old `/topics` path into `/`.
- `clearRoute` uses `replaceState`, so it adds no history step. `pushResultsRoute` does add one.
- A dead `?quiz=` link goes to the home page with an alert. It used to leave students on a blank page.
- Results open in-app, except during a quiz. `src/dashboard-ui.js` skips the in-app path while `body.quiz-page` is set, because the quiz would keep running underneath.
- Ctrl, Cmd or Shift on a dashboard results link also skips the in-app path, so opening in a new tab still works.
