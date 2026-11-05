# Quizleris Agent Guidelines & Rules

## Production Environment & Deployment
- **Production repository & branch**: `origin/main` on `https://github.com/devukas-eng/Quizleris.git` (`devukas-eng/Quizleris`) is the main production branch used for Quizleris (`spresk.lt`).
- All production changes and fixes must be made to `main` and pushed to `origin/main`.

## Build & Testing
- To run tests: use `npm.cmd test` (Windows environment).
- Build output is generated in `dist/` via `npm.cmd run build` (`node copy-files.js`). Always ensure `dist/` is updated or rebuilds pass before pushing.
