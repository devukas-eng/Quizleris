import { vi } from 'vitest';

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
        <div id="admin-toggle"></div>
        <div id="admin-panel"></div>
        <div id="admin-quiz-title"></div>
        <div id="admin-questions-list"></div>
        <div id="admin-add-question"></div>
        <div id="admin-scan-question"></div>
        <div id="admin-ocr-input"></div>
        <div id="admin-save"></div>
        <div id="admin-preview"></div>
        <div id="admin-export"></div>
        <div id="admin-import-btn"></div>
        <div id="admin-import-input"></div>
        <div id="admin-cancel"></div>
        <div id="admin-share-code"></div>
        <div id="admin-timer-mode"></div>
        <div id="admin-timer-limit"></div>
        <div id="admin-show-results-value"></div>
        <div id="admin-result-visibility-group"></div>
        <div id="admin-quiz-mode-value"></div>
        <div id="admin-quiz-mode-group"></div>
        <div id="admin-quiz-mode"></div>
        <div id="admin-shuffle-questions"></div>
        <div id="admin-shuffle-answers"></div>
        <div id="btn-shuffle-questions"></div>
        <div id="btn-shuffle-answers"></div>
        <div id="admin-bulk-import-btn"></div>
        <div id="bulk-import-modal-overlay"></div>
        <div id="bulk-import-close-btn"></div>
        <div id="bulk-import-cancel-btn"></div>
        <div id="bulk-import-submit-btn"></div>
        <div id="bulk-import-textarea"></div>
        <div id="admin-navigator"></div>
        <div id="admin-draft-status"></div>
        <div id="admin-undo-btn"></div>
        <div id="admin-redo-btn"></div>
        <div id="admin-local-selector"></div>
        <div id="admin-local-delete-btn"></div>
        <div id="admin-draft-banner"></div>
        <div id="admin-draft-banner-text"></div>
        <div id="admin-draft-restore-btn"></div>
        <div id="admin-draft-dismiss-btn"></div>
        <div id="menu-language-select"></div>
        <div id="menu-sound-toggle"></div>
        <div id="frenzy-root"></div>
        <div id="start-menu"></div>
        <div id="topics-overlay"></div>
    `;
    window.alert = () => {};
    window.AudioContext = class {
        createOscillator() {
            return {
                connect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
            };
        }
        createGain() {
            return {
                connect: vi.fn(),
                gain: { value: 0, exponentialRampToValueAtTime: vi.fn() }
            };
        }
        destination = {}
    };
    window.webkitAudioContext = window.AudioContext;
