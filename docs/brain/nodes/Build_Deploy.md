---
tags: [node, infra]
status: active
last_verified: 2026-11-07
---

## Purpose & Boundaries

Owns how code reaches production and how to prove what is live. A push to `main` on `devukas-eng/Quizleris` deploys through Hostinger to spresk.eu. Running the app locally belongs to [[Local_Testing]].

## Canonical File Map

- `copy-files.js`: builds `dist/` from `src/` and stamps the `style.css?v=` and `app.js?v=` hashes.
- `package.json`: scripts for `build`, `start`, `test`, `lint` and the database.
- `AGENTS.md`: project rules. It still names spresk.lt, which is wrong.
- `.gitignore`: ignores `dist/`, so the host builds it.
- `vercel.json`: Vercel rewrite config. Production does not deploy through it.

## Connections & Data Flow

- Ships `dist/` and `server.js` to the host that runs -> [[Backend_API]]
- Takes only what has passed -> [[Local_Testing]]
- Live state and the pending checks are recorded in -> [[01_STATE]]

## Gotchas & Constraints

- **Every push needs the owner's explicit OK.** Approval covers that one push only.
- Run `git ls-remote https://github.com/devukas-eng/Quizleris.git refs/heads/main` before assuming what is live. A collaborator pushes too.
- Other sessions may commit in the same checkout. Stage only your own hunks, and push the approved commit's sha after checking `git log <live>..<sha>`.
- Never stage `.claude/launch.json`. It holds local database credentials, and `.gitignore` covers it. Only `.claude/commands/` is tracked.
- spresk.lt is a separate Hostinger Website Builder site. Check spresk.eu.
- A deploy takes under a minute. Mid-deploy, a new path can answer 200 while the files are still old.
- **Hash check:** the live `/` names `style.css?v=<hash>` and `app.js?v=<hash>`, and both must equal a local build of the pushed commit.
- Build that check from `git archive -o <file>.tar <sha> copy-files.js src`, then `tar -xf` and `node copy-files.js`. Building in the working copy gives other hashes because of CRLF line endings, and piping `git archive` through PowerShell corrupts it.
- **Content check:** a new file must contain a new function name, because unknown paths answer 200 with `index.html`.
- The `hcdn` CDN re-encodes PNG files, so a live PNG has other bytes and a file hash cannot match. Compare its pixels instead. A PNG path that does not exist answers 422, not 200.
- **Route checks without a token:** `/api/bank/meta` and `/api/admin/quiz-browser` should answer 401. A 503 on the bank means its schema failed at start. `/api/quiz-trash` should answer 401 too, and 503 there means the deleted-quizzes table failed, see [[Data_Lifetime]].
- An open tab keeps the old files until it reloads. Report this to the owner after a deploy.
- Hostinger serves through its `hcdn` CDN with `max-age=0`, so nothing stale sits in between.
