import { quiz } from "./state.js";
import { statusContainer } from "./dom.js";
// Timer state tracking
let rafId = null;
let currentTimerMode = null;
let currentTimerQuizId = null;
let currentTimerQuestionId = null;
/**
 * Starts or updates the quiz timer.
 * Uses requestAnimationFrame for smooth UI updates and accurate timing.
 *
 * @param config - Timer configuration from the quiz
 * @param onTimeout - Callback executed when time hits zero
 */
export function startTimer(config, onTimeout) {
    if (!quiz)
        return;
    const mode = config.mode;
    const limit = config.limitSeconds;
    const quizId = quiz.quiz.id;
    const questionId = quiz.shuffledQuestions[quiz.currentIndex].id;
    // IDEMPOTENCY CHECK:
    // If we are in 'quiz' mode and the timer is already running for this quiz, 
    // do NOT restart it. This prevents the "skip/reset" glitch when moving between questions.
    if (mode === 'quiz' && rafId !== null && currentTimerQuizId === quizId && currentTimerMode === 'quiz') {
        return;
    }
    // Always clear existing RAF loop when starting a new mode or a new question
    clearTimer();
    const timerId = "question-timer";
    let timerEl = document.getElementById(timerId);
    if (!timerEl) {
        timerEl = document.createElement("div");
        timerEl.id = timerId;
        timerEl.className = "question-timer";
        statusContainer.appendChild(timerEl);
    }
    timerEl.classList.remove("text-danger");
    // Capture state for idempotency and mode tracking
    currentTimerMode = mode;
    currentTimerQuizId = quizId;
    currentTimerQuestionId = questionId;
    // Reference start time
    const startTime = mode === 'question'
        ? (quiz.questionStartTimes.get(questionId) || Date.now())
        : quiz.startTime;
    const updateTimer = () => {
        if (!quiz) {
            clearTimer();
            return;
        }
        // Mode-specific stop conditions
        if (mode === 'question' && (quiz.hasAnswered || quiz.shuffledQuestions[quiz.currentIndex].id !== currentTimerQuestionId)) {
            clearTimer();
            return;
        }
        if ((mode === 'quiz' || mode === 'none') && quiz.isLastQuestion && quiz.hasAnswered) {
            clearTimer();
            return;
        }
        const elapsed = (Date.now() - startTime) / 1000;
        if (mode === 'none') {
            // Stopwatch (Count Up)
            const minutes = Math.floor(elapsed / 60);
            const seconds = Math.floor(elapsed % 60);
            timerEl.textContent = `Time: ${minutes}:${seconds.toString().padStart(2, "0")}`;
            rafId = requestAnimationFrame(updateTimer);
        }
        else {
            // Countdown
            const remaining = Math.max(0, limit - elapsed);
            const displayRemaining = Math.ceil(remaining);
            const minutes = Math.floor(displayRemaining / 60);
            const seconds = displayRemaining % 60;
            timerEl.textContent = `Time: ${minutes}:${seconds.toString().padStart(2, "0")}`;
            if (displayRemaining <= 5) {
                timerEl.classList.add("text-danger");
            }
            if (remaining <= 0) {
                clearTimer();
                if (onTimeout)
                    onTimeout();
            }
            else {
                rafId = requestAnimationFrame(updateTimer);
            }
        }
    };
    // Kick off the loop
    rafId = requestAnimationFrame(updateTimer);
}
/**
 * Stops the current timer animation loop and clears state.
 */
export function clearTimer() {
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    currentTimerMode = null;
    currentTimerQuestionId = null;
}
