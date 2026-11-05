import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as api from '../src/api.js';
import * as storage from '../src/storage.js';
import * as dialog from '../src/dialog.js';
import {
    initializeQuiz,
    isQuizActive,
    recordQuizQuit,
    quitQuizGracefully,
    showResults
} from '../src/render.js';
import { quiz, setQuiz } from '../src/state.js';

describe('Student quitting a quiz logic', () => {
    const sampleQuiz = {
        id: 'test-quiz-123',
        title: 'Bandomasis testas',
        mode: 'practice',
        questions: [
            {
                id: 'q1',
                prompt: 'Kiek yra 2 + 2?',
                choices: [
                    { id: 'a', text: '3', isCorrect: false },
                    { id: 'b', text: '4', isCorrect: true }
                ]
            },
            {
                id: 'q2',
                prompt: 'Kokia Lietuvos sostinė?',
                choices: [
                    { id: 'a', text: 'Kaunas', isCorrect: false },
                    { id: 'b', text: 'Vilnius', isCorrect: true }
                ]
            }
        ]
    };

    beforeEach(() => {
        document.body.innerHTML = `
            <header class="quiz-header" style="display: flex;">
                <button id="quiz-back-btn" class="btn" style="display: none;">Back</button>
            </header>
            <main class="quiz-main" style="display: flex;">
                <div id="question-container"></div>
                <div id="answers-container"></div>
                <div id="status-container"></div>
            </main>
            <div id="start-menu" style="display: none;"></div>
        `;
        localStorage.clear();
        localStorage.setItem('current_student_name', 'Jonas');
        vi.spyOn(api, 'submitAttempt').mockResolvedValue(true);
        vi.spyOn(api, 'submitAttemptBeacon').mockReturnValue(true);
        setQuiz(null);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        setQuiz(null);
    });

    it('isQuizActive reports true during quiz and false after quitting or finishing', () => {
        expect(isQuizActive()).toBe(false);

        initializeQuiz(sampleQuiz);
        expect(isQuizActive()).toBe(true);

        const recorded = recordQuizQuit();
        expect(recorded).toBe(true);
        expect(isQuizActive()).toBe(false);

        // Calling again does not double-record
        expect(recordQuizQuit()).toBe(false);
    });

    it('records a quit attempt with status "quit" and questions answered so far', () => {
        const beaconSpy = vi.spyOn(api, 'submitAttemptBeacon').mockReturnValue(true);
        const submitSpy = vi.spyOn(api, 'submitAttempt').mockResolvedValue(true);

        initializeQuiz(sampleQuiz);

        // Student answers question 1 correctly
        quiz.submitAnswer('b', 'q1');

        // Student quits before answering question 2
        const recorded = recordQuizQuit({ beacon: true });
        expect(recorded).toBe(true);

        // Check local storage
        const localResults = storage.getResults();
        expect(localResults.length).toBe(1);
        expect(localResults[0].status).toBe('quit');
        expect(localResults[0].score).toBe(1);
        expect(localResults[0].maxScore).toBe(2);
        expect(localResults[0].name).toBe('Jonas');
        expect(localResults[0].quizId).toBe('test-quiz-123');

        // Check payload sent to server
        expect(beaconSpy).toHaveBeenCalledTimes(1);
        const [quizIdSent, attemptSent] = beaconSpy.mock.calls[0];
        expect(quizIdSent).toBe('test-quiz-123');
        expect(attemptSent.status).toBe('quit');
        expect(attemptSent.score).toBe(1);
        expect(attemptSent.maxScore).toBe(2);
        expect(attemptSent.name).toBe('Jonas');
        expect(attemptSent.details).toBeDefined();
        expect(attemptSent.details.length).toBe(2);
        expect(attemptSent.details[0].isCorrect).toBe(true);
        expect(attemptSent.details[1].isCorrect).toBe(false);
    });

    it('quitQuizGracefully asks confirmation and records quit when confirmed', async () => {
        const beaconSpy = vi.spyOn(api, 'submitAttemptBeacon').mockReturnValue(true);
        vi.spyOn(dialog, 'confirmDialog').mockResolvedValue(true);

        initializeQuiz(sampleQuiz);
        expect(isQuizActive()).toBe(true);

        const result = await quitQuizGracefully();
        expect(result).toBe(true);
        expect(isQuizActive()).toBe(false);
        expect(quiz).toBeNull();
        expect(beaconSpy).toHaveBeenCalledTimes(1);

        const local = storage.getResults();
        expect(local.length).toBe(1);
        expect(local[0].status).toBe('quit');
    });

    it('quitQuizGracefully does nothing if user cancels dialog', async () => {
        const beaconSpy = vi.spyOn(api, 'submitAttemptBeacon').mockReturnValue(true);
        vi.spyOn(dialog, 'confirmDialog').mockResolvedValue(false);

        initializeQuiz(sampleQuiz);
        expect(isQuizActive()).toBe(true);

        const result = await quitQuizGracefully();
        expect(result).toBe(false);
        expect(isQuizActive()).toBe(true);
        expect(beaconSpy).not.toHaveBeenCalled();
        expect(storage.getResults().length).toBe(0);
    });

    it('ungraceful exit (pagehide) automatically records quit if quiz was active', () => {
        const beaconSpy = vi.spyOn(api, 'submitAttemptBeacon').mockReturnValue(true);

        initializeQuiz(sampleQuiz);
        expect(isQuizActive()).toBe(true);

        // Simulate browser tab close / navigation
        window.dispatchEvent(new Event('pagehide'));

        expect(beaconSpy).toHaveBeenCalledTimes(1);
        expect(beaconSpy.mock.calls[0][1].status).toBe('quit');
        expect(isQuizActive()).toBe(false);

        const local = storage.getResults();
        expect(local.length).toBe(1);
        expect(local[0].status).toBe('quit');
    });

    it('completed quiz records status "completed" and does not trigger quit on subsequent pagehide', () => {
        const submitSpy = vi.spyOn(api, 'submitAttempt').mockResolvedValue(true);
        const beaconSpy = vi.spyOn(api, 'submitAttemptBeacon').mockReturnValue(true);

        initializeQuiz(sampleQuiz);
        quiz.submitAnswer('b', 'q1');
        quiz.submitAnswer('b', 'q2');

        showResults();

        // Local storage should have completed attempt
        const local = storage.getResults();
        expect(local.length).toBe(1);
        expect(local[0].status).toBe('completed');
        expect(local[0].score).toBe(2);

        // Server should have received completed attempt
        expect(submitSpy).toHaveBeenCalledTimes(1);
        expect(submitSpy.mock.calls[0][1].status).toBe('completed');

        // Now if the student closes the tab after seeing results:
        window.dispatchEvent(new Event('pagehide'));

        // No quit attempt should be sent
        expect(beaconSpy).not.toHaveBeenCalled();
        expect(storage.getResults().length).toBe(1);
    });

    it('getHighScores ignores quit attempts', () => {
        storage.saveResult({
            quizId: 'q1',
            score: 10,
            status: 'quit'
        });
        storage.saveResult({
            quizId: 'q1',
            score: 7,
            status: 'completed'
        });

        const highScores = storage.getHighScores();
        expect(highScores.length).toBe(1);
        expect(highScores[0].score).toBe(7);
    });
});
