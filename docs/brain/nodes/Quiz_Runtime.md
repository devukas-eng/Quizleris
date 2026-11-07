---
tags: [node, frontend]
status: active
last_verified: 2026-11-07
---

## Purpose & Boundaries

Owns the student side: joining by code, playing a quiz, grading, quit tracking and the result shown at the end. The teacher's results screen belongs to [[Dashboard]].

## Canonical File Map

- `src/render.js`: the play screen and its flow (`initializeQuiz`, `renderQuiz`, `showResults`, `isQuizActive`, `recordQuizQuit`, `quitQuizGracefully`).
- `src/state.js`: `QuizState` and answer matching (`answersMatch`, `matchTypedAnswers`).
- `src/menu.js`: student join (`renderStudentJoin`, `handleStudentClick`).
- `src/storage.js`: `loadQuiz` and local results (`saveResult`, `getResults`).
- `src/quiz-pictures.js`: `preloadPictures`.
- `server.js`: `GET /api/quizzes/:id` and `POST /api/quizzes/:id/attempts`.
- `tests/state.test.js`: covers state and answer matching.
- `tests/render.test.js`: covers rendering.
- `tests/quiz-quit.test.js`: covers quit tracking.

## Connections & Data Flow

- Opened from `?quiz=<id>` by `openLinkedQuiz` in -> [[URL_Routing]]
- Loads quizzes and records attempts through -> [[Backend_API]]
- Showing `.quiz-main` moves the footer in -> [[Page_Shell]]
- Attempts appear on the results screen in -> [[Dashboard]]
- Quiz pictures are stored and kept by -> [[Data_Lifetime]]

## Gotchas & Constraints

- A quiz waits up to 2.5 seconds for its pictures before it starts (`preloadPictures` in `src/menu.js`). Pictures load separately from the quiz now, so without this the page jumps as they arrive, and a dropped connection would lose the later ones.
- `sanitizeImageUrl` in `src/render.js` must keep accepting stored pictures, or they turn into an empty image.
- `.quiz-main` being visible is the signal for "in a quiz". `placeFooter` sets `body.quiz-page` from it, and [[Dashboard]] reads that class to avoid opening results over a running quiz.
- Typed answers compare without formula markers, case or extra spaces. Numbers compare by value, so `0,5`, `0.5` and `.5` all match.
- Quit attempts are recorded both for a graceful exit and for an abrupt one.
- `GET /api/quizzes/:id` must accept JSON columns as strings. Local MariaDB returns them that way, and live MySQL does not.
