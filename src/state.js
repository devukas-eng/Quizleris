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
                    this.shuffleArray(q.choices);
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
                const selectedIds = Array.isArray(answer) ? answer : [answer];
                const correctIds = q.choices?.filter(c => c.isCorrect).map(c => c.id) || [];
                // Selection must match exactly: all correct ones and no incorrect ones
                const isCorrect = selectedIds.length === correctIds.length &&
                    selectedIds.every(id => correctIds.includes(id));
                return { isCorrect, pendingReview: false };
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
                const isCorrect = correctAnswers.every((correct, idx) => 
                // Normalizing input with trim and lowercase for robustness.
                String(studentAnswers[idx] || "").trim().toLowerCase() === correct.trim().toLowerCase());
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
