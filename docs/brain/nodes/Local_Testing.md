---
tags: [node, infra]
status: active
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns how to run and check the app without touching production: the throwaway database, signing in locally, unit tests, lint and browser pane quirks. It also holds `/sync-brain` and the check for these notes. Shipping belongs to [[Build_Deploy]].

## Canonical File Map

- `.claude/launch.json`: local and untracked. The `quizleris-localdb` config runs the app on port 3999.
- `.env.example`: the variables the app expects.
- `vitest.config.js`: unit test config, run with `npm.cmd test`.
- `tests/setup.js`: shared test setup.
- `eslint.config.mjs`: lint rules, run with `npm.cmd run lint`.
- `scripts/init_db.js`: creates the app tables in an empty database.
- `scripts/bench_bank.js`: fills a bench database with `--local --items=200000`.
- `scripts/smoke-test.js`: smoke test, run with `npm.cmd run test:smoke`.
- `scripts/check-brain.js`: checks links, paths, node structure and the canvas in `docs/brain/`.
- `.claude/commands/sync-brain.md`: the slash command's steps, also followed after finishing a feature.

## Connections & Data Flow

- Gates what goes to -> [[Build_Deploy]]
- Runs the server from -> [[Backend_API]]
- Signs in with the session keys from -> [[Auth_Roles_Plans]]
- Empty-bank testing exists because of the live state in -> [[Task_Bank]]

## Gotchas & Constraints

- **Never start the app with the repository `.env`.** It points at the live database. Use the environment in `.claude/launch.json`.
- Local database: XAMPP's `C:\xampp\mysql\bin\mysqld.exe` with its own `my.ini` on port 3399, using `quizleris_dev`, `quizleris_nobank` and `quizleris_bench`. Earlier setups lived in session scratch folders, so it may need recreating.
- Copying a database fails on generated columns, so list the columns.
- Local sign-in: sign a JWT with the `JWT_SECRET` from `.claude/launch.json`, then set `quizleris_jwt` and `quizleris_user` in the browser.
- **Test teacher work as a real teacher:** free plan, signed in through the form, with an empty shared bank like live. Run the live commit beside the working copy to compare.
- The local bank has tasks and live has none. That difference hid the teacher bugs found on 2026-11-06.
- MariaDB returns JSON columns as strings, unlike live MySQL.
- The browser pane can report a 0x0 viewport until `resize_window` runs.
- The pane can stall animations until a screenshot forces frames. A hidden pane gets no frames at all, so CSS transitions, `requestAnimationFrame` and `ResizeObserver` stop. Take a screenshot before calling anything a bug.
- `scripts/check-brain.js` fails when a name in a file map leaves its file, so a rename in the code shows up there. Update the node, not the check.
- To test these notes in real Obsidian without touching the owner's vaults, copy `docs/brain/` to a scratch folder, write an `obsidian.json` for it in a scratch profile, and start Obsidian with `--user-data-dir` and `--remote-debugging-port`. `app.metadataCache.unresolvedLinks` then lists broken links.
- PowerShell 5.1 writes a BOM with `-Encoding utf8`, which breaks JSON files. A here-string piped to `git commit -F -` also failed, so write the message to a file first.
