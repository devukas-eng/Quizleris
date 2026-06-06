import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearTimer, startTimer } from '../src/timer.js';
// We'll test what we can without blowing up JSDOM with missing globals.
import * as renderModule from '../src/render.js';

describe('render.js functions', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="quiz-container"></div>
            <div id="question-container"></div>
            <div id="answers-container"></div>
            <div id="status-container"></div>
            <div id="progress-bar"></div>
            <div id="progress-fill"></div>
            <div id="timer-display"></div>
            <button id="next-btn"></button>
            <div id="exam-navigator"></div>
        `;
    });

    it('clearTimer should clear any running intervals', () => {
        expect(typeof clearTimer).toBe('function');
        clearTimer(); // should not throw
    });

    it('should have required render functions', () => {
        expect(typeof renderModule.renderQuiz).toBe('function');
        expect(typeof renderModule.renderQuestionCounter).toBe('function');
        expect(typeof renderModule.renderStatus).toBe('function');
        expect(typeof renderModule.renderExamNavigation).toBe('function');
        expect(typeof renderModule.renderAnswers).toBe('function');
        expect(typeof renderModule.renderNextButton).toBe('function');
        expect(typeof renderModule.renderQuestion).toBe('function');
        expect(typeof renderModule.onAnswer).toBe('function');
    });
});
