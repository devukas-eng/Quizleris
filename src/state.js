// Typed answers are compared without formula markers, case or extra spaces;
// numbers compare by value so "0,5", "0.5" and ".5" all match.
function normalizeAnswer(value) {
    return String(value ?? "").replace(/\\\(|\\\)|\\\[|\\\]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
function toNumber(text) {
    const v = text.replace(",", ".");
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(v) ? parseFloat(v) : NaN;
}
export function answersMatch(given, expected) {
    const a = normalizeAnswer(given);
    const b = normalizeAnswer(expected);
    if (!a || !b) return false;
    if (a === b) return true;
    const x = toNumber(a);
    const y = toNumber(b);
    return !isNaN(x) && !isNaN(y) && Math.abs(x - y) < 1e-9;
}

// Answer slots of a choice question: plain options, or "write"/"number" slots the student types into
export const isTypedSlot = (choice) => choice?.kind === 'write' || choice?.kind === 'number';

export function typedSlotMatches(choice, value) {
    if (choice.kind === 'number') {
        const given = toNumber(normalizeAnswer(value));
        return !isNaN(given) && typeof choice.number === 'number' && !isNaN(choice.number) &&
            Math.abs(given - choice.number) <= (choice.tolerance || 0) + 1e-9;
    }
    return (choice.accepted || []).some(a => answersMatch(value, a));
}

// Questions with typed slots store { selected: [ids], typed: { id: text } }; others keep id / [ids]
const isSlotAnswer = (answer) => !!answer && typeof answer === 'object' && Array.isArray(answer.selected);

/**
 * Pairs what the student typed with the question's correct write-in / number slots. Which box the
 * student typed into doesn't matter: each typed answer may fill any correct slot of the same kind,
 * once. Returns `matched` (typed slot id -> the correct slot it fills) and `missing` (correct slots
 * nothing filled).
 */
export function matchTypedAnswers(q, answer) {
    const choices = q.choices || [];
    const selected = isSlotAnswer(answer) ? answer.selected : [];
    const typed = isSlotAnswer(answer) ? (answer.typed || {}) : {};
    const entries = choices.filter(c => isTypedSlot(c) && selected.includes(c.id) && String(typed[c.id] ?? '').trim());
    const targets = choices.filter(c => isTypedSlot(c) && c.isCorrect);
    const owner = new Map(); // correct slot id -> typed slot id filling it
    // Augmenting paths: a typed answer that fits a taken slot may move the earlier answer elsewhere
    const place = (entry, seen) => targets.some(target => {
        if (target.kind !== entry.kind || seen.has(target.id) || !typedSlotMatches(target, typed[entry.id])) return false;
        seen.add(target.id);
        const holder = owner.get(target.id);
        if (holder && !place(entries.find(e => e.id === holder), seen)) return false;
        owner.set(target.id, entry.id);
        return true;
    });
    entries.forEach(entry => place(entry, new Set()));
    const matched = new Map();
    owner.forEach((entryId, targetId) => matched.set(entryId, targets.find(c => c.id === targetId)));
    return { matched, missing: targets.filter(c => !owner.has(c.id)) };
}

/**
 * The answer slots a student is given, on screen and on paper. Several write-in / number slots of
 * one kind are the teacher's list of answers, not boxes to fill: one box per kind for a single
 * answer, and with "select all" one box per correct answer of that kind (grading ignores which
 * box holds which answer). Plain options are all kept.
 */
export function studentChoices(q) {
    const choices = q.choices || [];
    const shown = new Set();
    ['write', 'number'].forEach(kind => {
        const slots = choices.filter(c => c.kind === kind);
        const wanted = q.allowMultipleAnswers ? Math.max(1, slots.filter(c => c.isCorrect).length) : 1;
        slots.slice(0, wanted).forEach(c => shown.add(c.id));
    });
    return choices.filter(c => !isTypedSlot(c) || shown.has(c.id));
}

/** A typed slot's accepted answer as text ("katė / katinas", "2 ± 0.1"). */
export const typedSlotAnswerText = (choice) => choice.kind === 'number'
    ? `${choice.number}${choice.tolerance ? ` ± ${choice.tolerance}` : ''}`
    : (choice.accepted || []).join(' / ');

/**
 * The answer key for a choice question as the student sees it: [{ letter, text, typed }], where
 * the letters follow studentChoices (A, B, ... with hidden slots skipped) and each kind of typed
 * answer is one entry naming its boxes and every correct answer of that kind.
 */
export function choiceAnswerKey(q) {
    const shown = studentChoices(q);
    const letter = (c) => String.fromCharCode(65 + shown.indexOf(c));
    const key = shown.filter(c => c.isCorrect && !isTypedSlot(c)).map(c => ({ letter: letter(c), choice: c, typed: false }));
    ['write', 'number'].forEach(kind => {
        const correct = (q.choices || []).filter(c => c.kind === kind && c.isCorrect);
        if (!correct.length) return;
        const boxes = shown.filter(c => c.kind === kind).map(letter).join(', ');
        key.push({ letter: boxes, text: correct.map(typedSlotAnswerText).join('; '), typed: true });
    });
    return key;
}

// Readable form of an answer for result reviews (choice IDs become the option text)
function describeAnswer(q, answer) {
    if (answer === null || answer === undefined) return null;
    if ((q.type || 'multiple-choice') !== 'multiple-choice') return null;
    const describe = (id) => {
        const c = q.choices?.find(ch => ch.id === id);
        if (!c) return id;
        if (isTypedSlot(c)) return `✎ ${isSlotAnswer(answer) ? (answer.typed?.[id] ?? '') : ''}`;
        return c.text || (c.image ? "🖼" : id);
    };
    const ids = isSlotAnswer(answer) ? answer.selected : (Array.isArray(answer) ? answer : [answer]);
    return ids.map(describe).join(', ');
}

/**
 * Encapsulates the runtime state of a single quiz session.
 * Handles shuffling, question traversal, answer recording, and scoring logic.
 */
export class QuizState {
    constructor(quiz) {
        this.currentIndex = 0;
        this.hasAnswered = false; // Only used for Practice mode flow control
        this.score = 0;
        this.streak = 0;
        this.maxStreak = 0;
        this.startTime = Date.now();
        // Map question ID to user answer (string, number, string[], base64)
        this.userAnswers = new Map();
        this.questionStartTimes = new Map();
        this.questionDurations = new Map();
        this.questionScores = new Map();
        this.quiz = quiz;
        // Perform a deep clone to safely shuffle without affecting the original quiz template.
        this.shuffledQuestions = JSON.parse(JSON.stringify(quiz.questions));
        // 1. Shuffle Questions if configured
        if (quiz.shuffleConfig?.questions) {
            this.shuffleArray(this.shuffledQuestions);
        }
        // 2. Shuffle Choices if configured
        if (quiz.shuffleConfig?.answers) {
            this.shuffledQuestions.forEach(q => {
                if (q.choices && q.choices.length > 0) {
                    // Write-in / number slots stay after the options ("or type your own" reads last)
                    const options = q.choices.filter(c => !isTypedSlot(c));
                    this.shuffleArray(options);
                    q.choices = [...options, ...q.choices.filter(isTypedSlot)];
                    // Reassign IDs after shuffling to keep A, B, C, D in order
                    q.choices.forEach((c, idx) => {
                        c.id = String.fromCharCode(97 + idx); // 'a', 'b', 'c', 'd'...
                    });
                }
            });
        }
        this.questionStartTimes.set(this.shuffledQuestions[0].id, Date.now());
    }
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
    get currentQuestion() {
        return this.shuffledQuestions[this.currentIndex];
    }
    get isLastQuestion() {
        return this.currentIndex >= this.shuffledQuestions.length - 1;
    }
    get totalTime() {
        return Date.now() - this.startTime;
    }
    /**
     * Submits an answer for the current or a specific question.
     * In Practice mode, this triggers immediate grading and records the score.
     * In Exam mode, it simply archives the answer for later grading.
     */
    submitAnswer(answer, questionId) {
        const targetQ = questionId ?
            this.shuffledQuestions.find(q => q.id === questionId) :
            this.currentQuestion;
        if (!targetQ)
            return false;
        // Store answer
        this.userAnswers.set(targetQ.id, answer);
        // Record time if not already recorded (useful for Exam Mode)
        const start = this.questionStartTimes.get(targetQ.id);
        if (start && !this.questionDurations.has(targetQ.id)) {
            this.questionDurations.set(targetQ.id, Date.now() - start);
        }
        const grading = this.gradeQuestion(targetQ, answer);
        if (this.quiz.mode !== 'exam') {
            this.hasAnswered = true;
            if (grading.isCorrect) {
                // Dynamic Scoring Calculation
                const timeTakenSec = (this.questionDurations.get(targetQ.id) || 0) / 1000;
                // Base limit 30s if not specified globally or on question
                const limit = targetQ.timeLimit || this.quiz.timeLimitSeconds || 30;
                
                // Speed calculation: 1000 base, drops to 500 over the time limit
                const timeRatio = Math.min(Math.max(timeTakenSec / limit, 0), 1);
                const speedScore = Math.round(1000 - (500 * timeRatio));
                
                // Multiplier: 1x to 5x based on current streak
                const multiplier = Math.min((this.streak || 0) + 1, 5);
                const points = speedScore * multiplier;
                
                this.questionScores.set(targetQ.id, points);
                this.score += points;
                
                this.streak += 1;
                if (this.streak > this.maxStreak) {
                    this.maxStreak = this.streak;
                }
            } else {
                if (!grading.pendingReview) {
                    this.streak = 0;
                }
            }
            return grading.isCorrect;
        }
        return false; // Result not immediately relevant in Exam Mode
    }
    /**
     * Determines the correctness of an answer based on question type.
     * Multi-choice: Exact set match.
     * Numeric: Comparison within tolerance.
     * Fill-blank: Case-insensitive string match for all blanks.
     * Image/Text: Always pending manual review.
     */
    gradeQuestion(q, answer) {
        if (answer === null || answer === undefined)
            return { isCorrect: false, pendingReview: false };
        const type = q.type || 'multiple-choice';
        switch (type) {
            case 'multiple-choice': {
                const selectedIds = isSlotAnswer(answer) ? answer.selected : (Array.isArray(answer) ? answer : [answer]);
                const choices = q.choices || [];
                const byId = (id) => choices.find(c => c.id === id);
                // Plain options must match exactly: all correct ones and no incorrect ones
                const pickedOptions = selectedIds.filter(id => !isTypedSlot(byId(id)));
                const correctOptions = choices.filter(c => c.isCorrect && !isTypedSlot(c)).map(c => c.id);
                const sameOptions = pickedOptions.length === correctOptions.length &&
                    pickedOptions.every(id => correctOptions.includes(id));
                // Typed answers: every one must fill a correct slot, and every correct slot must be filled.
                // A picked slot left empty counts as a wrong answer.
                const pickedTyped = selectedIds.filter(id => isTypedSlot(byId(id)));
                const { matched, missing } = matchTypedAnswers(q, answer);
                const typedOk = missing.length === 0 && pickedTyped.every(id => matched.has(id));
                return { isCorrect: sameOptions && typedOk, pendingReview: false };
            }
            case 'numeric': {
                const val = parseFloat(answer);
                if (isNaN(val) || q.correctAnswerNumber === undefined)
                    return { isCorrect: false, pendingReview: false };
                let tolerance = q.toleranceValue || 0;
                if (q.toleranceType === 'percentage') {
                    tolerance = (Math.abs(q.correctAnswerNumber) * tolerance) / 100;
                }
                // Using a small epsilon to handle typical floating point precision issues.
                const isCorrect = Math.abs(val - q.correctAnswerNumber) <= (tolerance + 0.000001);
                return { isCorrect, pendingReview: false };
            }
            case 'fill-blank': {
                const studentAnswers = Array.isArray(answer) ? answer : [answer];
                const correctAnswers = q.blankAnswers || [];
                if (correctAnswers.length === 0)
                    return { isCorrect: false, pendingReview: false };
                // Same comparison as write-in answers: case, spaces and decimal comma don't matter
                const isCorrect = correctAnswers.every((correct, idx) => answersMatch(studentAnswers[idx], correct));
                return { isCorrect, pendingReview: false };
            }
            case 'true-false': {
                return { isCorrect: (answer === 'true' || answer === true) === q.isTrue, pendingReview: false };
            }
            case 'image-upload':
            case 'text':
                // Keyword matching for auto-hinting (disabled/informational only).
                if (type === 'text' && q.expectedKeywords && q.expectedKeywords.length > 0) {
                    const txt = String(answer).toLowerCase();
                    if (q.expectedKeywords.some(kw => txt.includes(kw.toLowerCase()))) {
                        // Logic for proximity-based auto-grading could be added here.
                    }
                }
                return { isCorrect: false, pendingReview: true };
            default:
                return { isCorrect: false, pendingReview: false };
        }
    }
    /**
     * What is submitted when time runs out: whatever the student has typed, uploaded or ticked on
     * the current question so far (null if nothing), so a timeout doesn't throw their work away.
     */
    timeoutAnswer() {
        return this.userAnswers.get(this.currentQuestion.id) ?? null;
    }
    nextQuestion() {
        if (this.isLastQuestion)
            return;
        this.currentIndex += 1;
        this.hasAnswered = false;
        if (!this.questionStartTimes.has(this.shuffledQuestions[this.currentIndex].id)) {
            this.questionStartTimes.set(this.shuffledQuestions[this.currentIndex].id, Date.now());
        }
    }
    // Move to a specific question (Exam Mode)
    jumpToQuestion(idx) {
        if (idx < 0 || idx >= this.shuffledQuestions.length)
            return;
        this.currentIndex = idx;
        if (!this.questionStartTimes.has(this.shuffledQuestions[this.currentIndex].id)) {
            this.questionStartTimes.set(this.shuffledQuestions[this.currentIndex].id, Date.now());
        }
    }
    /**
     * Compiles final analytics for the quiz session.
     * Calculates the final percentage, total time, and per-question breakdowns.
     */
    getResults() {
        let finalScore = 0;
        let correctCount = 0;
        const totalQuestions = this.shuffledQuestions.length;
        const results = this.shuffledQuestions.map(q => {
            const answer = this.userAnswers.get(q.id);
            const grading = this.gradeQuestion(q, answer);
            
            let pts = 0;
            if (grading.isCorrect) {
                correctCount++;
                if (this.quiz.mode === 'exam') {
                    // Exam mode is flat points
                    pts = 1000; 
                } else {
                    pts = this.questionScores.get(q.id) || 0;
                }
                finalScore += pts;
            }
            
            return {
                questionId: q.id,
                questionPrompt: q.prompt,
                type: q.type || 'multiple-choice',
                answer: answer,
                answerText: describeAnswer(q, answer),
                isCorrect: grading.isCorrect,
                pendingReview: grading.pendingReview,
                points: pts,
                timeSpent: this.questionDurations.get(q.id) || 0
            };
        });
        
        // Add final bonus for hearts if in practice mode
        if (this.quiz.mode !== 'exam') {
            const heartsRemaining = window.quizHearts !== undefined ? window.quizHearts : 0;
            const heartsBonus = heartsRemaining * 500;
            finalScore += heartsBonus;
        }

        return {
            score: finalScore,
            correctCount: correctCount,
            total: totalQuestions,
            percentage: totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0,
            totalTime: this.totalTime,
            questionResults: results,
        };
    }
}
// Global quiz state
export let quiz = null;
export function setQuiz(newQuiz) {
    quiz = newQuiz;
}
