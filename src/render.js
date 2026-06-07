import { QuizState, quiz, setQuiz } from "./state.js";
import { questionContainer, answersContainer, statusContainer } from "./dom.js";
import { startTimer, clearTimer } from "./timer.js";
import { saveResult, addPlayerXP } from "./storage.js";
import { renderStartMenu } from "./menu.js";
import { t } from "./lang.js";
import { playCorrect, playWrong, playLevelUp, toggleMute, getIsMuted } from "./audio.js";

// Setup Mute Button
document.addEventListener("DOMContentLoaded", () => {
    const muteBtn = document.getElementById("quiz-mute-btn");
    if (muteBtn) {
        muteBtn.textContent = getIsMuted() ? "🔇" : "🔊";
        muteBtn.addEventListener("click", () => {
            const muted = toggleMute();
            muteBtn.textContent = muted ? "🔇" : "🔊";
        });
    }
});
/**
 * SANITIZER: Explicitly filters and validates URLs to ensure they contain safe image data.
 * This is a critical security layer to prevent XSS via malicious data URIs or protocols.
 *
 * @param url - The raw URL string from the quiz data
 * @returns A validated safe URL or a transparent GIF fallback
 */
function sanitizeImageUrl(url) {
    const safeFallback = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    if (!url)
        return safeFallback;
    // Only allow specific, safe data:image formats using strict regex
    if (/^data:image\/(jpeg|png|gif|webp);base64,/.test(url)) {
        return url;
    }
    // Allow internal app registry references
    if (url.startsWith('local:img')) {
        return url;
    }
    // Strictly enforce http/https for remote URLs
    try {
        const u = new URL(url);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
            return url;
        }
    }
    catch {
        // Fall through to safe fallback
    }
    return safeFallback;
}
/**
 * Utility to recursively remove all child nodes from an element.
 * NOTE: Does not explicitly remove event listeners, relying on GC if listeners are not held elsewhere.
 */
function clearElement(el) {
    if (!el)
        return;
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
}
/**
 * Renders the question text, prompt decorations, and any associated images.
 * Also triggers KaTeX rendering for LaTeX math.
 */
export function renderQuestion(q) {
    const typeLabel = q.type === 'multiple-choice' ?
        (q.allowMultipleAnswers ? t('quiz.mcSelectAll') : t('quiz.mcSelectOne')) : '';
    clearElement(questionContainer);
    // Header
    const header = document.createElement("div");
    header.className = "prompt-header";
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "10px";
    if (typeLabel) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.style.background = "var(--accent)";
        badge.style.color = "white";
        badge.textContent = typeLabel;
        header.appendChild(badge);
    }
    else {
        header.appendChild(document.createElement("span"));
    }
    questionContainer.appendChild(header);
    // Image
    if (q.image) {
        const imgDiv = document.createElement("div");
        imgDiv.className = "question-image";
        imgDiv.style.marginBottom = "15px";
        imgDiv.style.textAlign = "center";
        const img = document.createElement("img");
        img.src = sanitizeImageUrl(q.image);
        img.style.maxWidth = "100%";
        img.style.maxHeight = "300px";
        img.style.borderRadius = "8px";
        img.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
        imgDiv.appendChild(img);
        questionContainer.appendChild(imgDiv);
    }
    // Prompt
    const prompt = document.createElement("div");
    prompt.className = "prompt";
    prompt.textContent = q.prompt;
    questionContainer.appendChild(prompt);
    // Ask KaTeX to render LaTeX
    window.renderMathInElement(questionContainer, {
        delimiters: [
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true },
        ],
    });
}
// Main Answers Dispatcher
export function renderAnswers(q) {
    const type = q.type || 'multiple-choice';
    clearElement(answersContainer);
    answersContainer.className = "answers-container " + type;
    switch (type) {
        case 'multiple-choice':
            renderMCQ(q);
            break;
        case 'numeric':
            renderNumeric(q);
            break;
        case 'fill-blank':
            renderFillBlank(q);
            break;
        case 'true-false':
            renderTrueFalse(q);
            break;
        case 'text':
            renderTextInput(q);
            break;
        case 'image-upload':
            renderImageUpload(q);
            break;
    }
    window.renderMathInElement(answersContainer, {
        delimiters: [
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true },
        ],
    });
}
/**
 * Specialized renderer for Multiple Choice Questions.
 * Handles both single-select (radio) and multi-select (checkbox) styles.
 * Provides immediate feedback in Practice mode, or selection state in Exam mode.
 */
function renderMCQ(q) {
    const allowMultiple = q.allowMultipleAnswers;
    // userAnswers might contain a single ID or an array of IDs
    const currentAnswer = quiz?.userAnswers.get(q.id) || [];
    // Feedback is hidden in Exam mode until final submission
    const isAnswered = quiz?.hasAnswered && quiz.quiz.mode !== 'exam';
    q.choices?.forEach((choice) => {
        const btn = document.createElement("button");
        btn.className = "answer-btn mc-btn";
        if (allowMultiple)
            btn.classList.add("checkbox-style");
        btn.dataset.choiceId = choice.id;
        const indicator = document.createElement("div");
        indicator.className = "mc-indicator";
        indicator.textContent = allowMultiple ? '' : choice.id.toUpperCase();
        btn.appendChild(indicator);
        const content = document.createElement("div");
        content.className = "mc-content";
        content.style.display = "flex";
        content.style.flexDirection = "column";
        content.style.gap = "8px";
        content.style.flex = "1";
        if (choice.image) {
            const img = document.createElement("img");
            img.src = sanitizeImageUrl(choice.image);
            img.style.maxHeight = "120px";
            img.style.width = "auto";
            img.style.alignSelf = "flex-start";
            img.style.borderRadius = "4px";
            content.appendChild(img);
        }
        const text = document.createElement("div");
        text.className = "mc-text";
        text.textContent = choice.text;
        content.appendChild(text);
        btn.appendChild(content);
        if (Array.isArray(currentAnswer) && currentAnswer.includes(choice.id)) {
            btn.classList.add("selected");
        }
        if (!isAnswered) {
            btn.onclick = () => {
                if (quiz?.quiz.mode === 'exam') {
                    toggleMCSelection(q.id, choice.id, btn, !!allowMultiple);
                }
                else {
                    if (allowMultiple) {
                        toggleMCSelection(q.id, choice.id, btn, true);
                    }
                    else {
                        onAnswer(choice.id);
                    }
                }
            };
        }
        else {
            // Feedback mode
            if (choice.isCorrect)
                btn.classList.add("correct");
            if (Array.isArray(currentAnswer) && currentAnswer.includes(choice.id) && !choice.isCorrect) {
                btn.classList.add("incorrect");
            }
            btn.disabled = true;
        }
        answersContainer.appendChild(btn);
    });
    if (allowMultiple && !isAnswered) {
        const submitBtn = document.createElement("button");
        submitBtn.className = "btn btn-primary submit-mc-btn";
        submitBtn.textContent = (quiz?.quiz.mode === 'exam') ? t('quiz.answered') : t('quiz.nextQuestion');
        submitBtn.onclick = () => {
            const selected = Array.from(answersContainer.querySelectorAll(".answer-btn.selected"))
                .map(b => b.dataset.choiceId);
            onAnswer(selected);
        };
        // In exam mode, we don't need a specific submit for MC, but it helps UX
        if (quiz?.quiz.mode !== 'exam') {
            answersContainer.appendChild(submitBtn);
        }
    }
}
function toggleMCSelection(qId, choiceId, btn, multiple) {
    if (!quiz)
        return;
    let current = quiz.userAnswers.get(qId) || [];
    if (!Array.isArray(current))
        current = [current];
    if (multiple) {
        if (current.includes(choiceId)) {
            current = current.filter((id) => id !== choiceId);
            btn.classList.remove("selected");
        }
        else {
            current.push(choiceId);
            btn.classList.add("selected");
        }
    }
    else {
        // Radio style
        answersContainer.querySelectorAll(".answer-btn").forEach(b => b.classList.remove("selected"));
        current = [choiceId];
        btn.classList.add("selected");
    }
    quiz.userAnswers.set(qId, current);
    if (quiz.quiz.mode === 'exam') {
        renderExamNavigation(); // Update "answered" status
    }
}
function renderNumeric(q) {
    const isAnswered = quiz?.hasAnswered && quiz.quiz.mode !== 'exam';
    const currentVal = quiz?.userAnswers.get(q.id) || "";
    const input = document.createElement("input");
    input.type = "number";
    input.className = "quiz-input numeric-input";
    input.value = currentVal;
    input.placeholder = "0.00";
    input.disabled = !!isAnswered;
    input.oninput = () => {
        if (quiz)
            quiz.userAnswers.set(q.id, input.value);
        if (quiz?.quiz.mode === 'exam')
            renderExamNavigation();
    };
    if (quiz?.quiz.mode !== 'exam' && !isAnswered) {
        input.onkeydown = (e) => {
            if (e.key === 'Enter')
                onAnswer(input.value);
        };
    }
    answersContainer.appendChild(input);
    if (!isAnswered && quiz?.quiz.mode !== 'exam') {
        const btn = document.createElement("button");
        btn.className = "btn btn-primary";
        btn.textContent = t('quiz.nextQuestion');
        btn.onclick = () => onAnswer(input.value);
        answersContainer.appendChild(btn);
    }
}
/**
 * Renders Fill-in-the-Blank inputs based on '___' patterns in the prompt.
 * NOTE: The prompt parsing relies on a simple regex; complex patterns might need a formal parser.
 */
function renderFillBlank(q) {
    const isAnswered = quiz?.hasAnswered && quiz.quiz.mode !== 'exam';
    const currentAnswers = quiz?.userAnswers.get(q.id) || [];
    // Counting occurrences of '___' to determine number of input fields
    const blankCount = (q.prompt.match(/___/g) || []).length;
    const container = document.createElement("div");
    container.className = "blanks-container";
    for (let i = 0; i < blankCount; i++) {
        const row = document.createElement("div");
        row.className = "blank-row";
        const label = document.createElement("span");
        label.className = "blank-label";
        label.textContent = `${i + 1}:`;
        row.appendChild(label);
        const input = document.createElement("input");
        input.type = "text";
        input.className = "quiz-input blank-input";
        input.value = currentAnswers[i] || "";
        input.disabled = !!isAnswered;
        input.oninput = () => {
            const answers = quiz?.userAnswers.get(q.id) || [];
            answers[i] = input.value;
            quiz?.userAnswers.set(q.id, answers);
            if (quiz?.quiz.mode === 'exam')
                renderExamNavigation();
        };
        row.appendChild(input);
        container.appendChild(row);
    }
    answersContainer.appendChild(container);
    if (!isAnswered && quiz?.quiz.mode !== 'exam') {
        const btn = document.createElement("button");
        btn.className = "btn btn-primary";
        btn.textContent = t('quiz.nextQuestion');
        btn.onclick = () => onAnswer(quiz?.userAnswers.get(q.id));
        answersContainer.appendChild(btn);
    }
}
function renderTrueFalse(q) {
    const isAnswered = quiz?.hasAnswered && quiz.quiz.mode !== 'exam';
    const currentAnswer = quiz?.userAnswers.get(q.id);
    const options = [
        { val: true, text: "TRUE", color: "#4CAF50" },
        { val: false, text: "FALSE", color: "#f44336" }
    ];
    options.forEach(opt => {
        const btn = document.createElement("button");
        btn.className = "answer-btn tf-btn";
        btn.textContent = opt.text;
        btn.style.borderColor = opt.color;
        if (currentAnswer !== undefined && (currentAnswer === opt.val || currentAnswer === String(opt.val))) {
            btn.classList.add("selected");
            btn.style.background = opt.color;
            btn.style.color = "white";
        }
        if (!isAnswered) {
            btn.onclick = () => {
                if (quiz?.quiz.mode === 'exam') {
                    quiz.userAnswers.set(q.id, opt.val);
                    renderAnswers(q); // re-render to show selection
                    renderExamNavigation();
                }
                else {
                    onAnswer(opt.val);
                }
            };
        }
        else {
            if (q.isTrue === opt.val)
                btn.classList.add("correct");
            if (currentAnswer === opt.val && q.isTrue !== opt.val)
                btn.classList.add("incorrect");
            btn.disabled = true;
        }
        answersContainer.appendChild(btn);
    });
}
function renderTextInput(q) {
    const isAnswered = quiz?.hasAnswered && quiz.quiz.mode !== 'exam';
    const currentVal = quiz?.userAnswers.get(q.id) || "";
    const input = q.isLongAnswer ? document.createElement("textarea") : document.createElement("input");
    input.className = "quiz-input text-input";
    if (input instanceof HTMLTextAreaElement)
        input.rows = 5;
    input.value = currentVal;
    input.disabled = !!isAnswered;
    input.oninput = () => {
        if (quiz)
            quiz.userAnswers.set(q.id, input.value);
        if (quiz?.quiz.mode === 'exam')
            renderExamNavigation();
    };
    answersContainer.appendChild(input);
    if (!isAnswered && quiz?.quiz.mode !== 'exam') {
        const btn = document.createElement("button");
        btn.className = "btn btn-primary";
        btn.textContent = t('quiz.nextQuestion');
        btn.onclick = () => onAnswer(input.value);
        answersContainer.appendChild(btn);
    }
}
function renderImageUpload(q) {
    const isAnswered = quiz?.hasAnswered && quiz.quiz.mode !== 'exam';
    const currentAnswer = quiz?.userAnswers.get(q.id); // base64
    if (currentAnswer) {
        const img = document.createElement("img");
        img.src = sanitizeImageUrl(currentAnswer);
        img.className = "uploaded-preview";
        img.style.maxWidth = "100%";
        img.style.borderRadius = "8px";
        img.style.marginBottom = "15px";
        answersContainer.appendChild(img);
    }
    if (!isAnswered) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.style.display = "none";
        const btn = document.createElement("button");
        btn.className = "btn btn-secondary";
        btn.textContent = currentAnswer ? "Change Photo" : "📷 Upload Work";
        btn.onclick = () => input.click();
        input.onchange = (e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const base64 = ev.target?.result;
                quiz?.userAnswers.set(q.id, base64);
                renderAnswers(q);
                if (quiz?.quiz.mode === 'exam')
                    renderExamNavigation();
            };
            reader.readAsDataURL(file);
        };
        answersContainer.appendChild(input);
        answersContainer.appendChild(btn);
        if (quiz?.quiz.mode !== 'exam') {
            const sub = document.createElement("button");
            sub.className = "btn btn-primary";
            sub.textContent = t('quiz.nextQuestion');
            sub.style.marginLeft = "10px";
            sub.onclick = () => onAnswer(quiz?.userAnswers.get(q.id));
            answersContainer.appendChild(sub);
        }
    }
}
function triggerCSSConfetti(target) {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + window.scrollX;
    const y = rect.top + rect.height / 2 + window.scrollY;
    const colors = ["#10B981", "#3B82F6", "#F59E0B", "#EF4444", "#EC4899", "#8B5CF6", "#06B6D4"];
    for (let i = 0; i < 20; i++) {
        const p = document.createElement("div");
        p.className = "confetti-particle";
        p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        const size = Math.random() * 8 + 6;
        p.style.width = `${size}px`;
        p.style.height = `${size}px`;
        const shape = Math.random();
        if (shape < 0.33) {
            p.style.borderRadius = "50%";
        } else if (shape < 0.66) {
            p.style.clipPath = "polygon(50% 0%, 0% 100%, 100% 100%)";
        }
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 120 + 60;
        const tx = Math.cos(angle) * velocity;
        const ty = Math.sin(angle) * velocity - (Math.random() * 80 + 20);
        p.style.setProperty("--tx", `${tx}px`);
        p.style.setProperty("--ty", `${ty}px`);
        p.style.animation = `confetti-pop 1.2s cubic-bezier(0.1, 0.8, 0.3, 1) forwards`;
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 1200);
    }
}
/**
 * Handles the logic when a user provides an answer to a question.
 * Records the answer in the state and triggers a re-render for feedback if in Practice mode.
 */
export function onAnswer(answer) {
    if (!quiz || (quiz.hasAnswered && quiz.quiz.mode !== 'exam'))
        return;
    const grading = quiz.gradeQuestion(quiz.currentQuestion, answer);
    const wasCorrect = grading.isCorrect && !grading.pendingReview;
    quiz.submitAnswer(answer);
    if (quiz.quiz.mode !== 'exam') {
        renderQuiz(); // Redraw with feedback
        if (wasCorrect) {
            playCorrect();
            const activeBtn = document.activeElement;
            if (activeBtn && activeBtn.classList.contains("answer-btn")) {
                triggerCSSConfetti(activeBtn);
            } else {
                triggerCSSConfetti(answersContainer);
            }
        } else {
            playWrong();
        }
    }
}
/**
 * The primary entry point for drawing the current state of the quiz.
 * Orchestrates prompt rendering, answer rendering, status updates, and timer management.
 */
export function renderQuiz() {
    if (!quiz)
        return;
    // Update header title
    const headerTitle = document.querySelector(".quiz-header h1");
    if (headerTitle) {
        headerTitle.textContent = quiz.quiz.title;
    }
    if (quiz.quiz.mode === 'exam') {
        renderExamNavigation();
    }
    else {
        renderQuestionCounter();
    }
    renderQuestion(quiz.currentQuestion);
    renderAnswers(quiz.currentQuestion);
    // Status text
    if (quiz.quiz.mode !== 'exam') {
        if (quiz.hasAnswered) {
            const grading = quiz.gradeQuestion(quiz.currentQuestion, quiz.userAnswers.get(quiz.currentQuestion.id));
            renderStatus(grading.isCorrect ? t('quiz.correct') : t('quiz.incorrect'), grading.isCorrect ? "correct" : "incorrect");
        }
        else {
            renderStatus(t('quiz.chooseAnswer'), "neutral");
        }
    }
    else {
        renderStatus(`${t('quiz.answered')}: ${quiz.userAnswers.size} / ${quiz.shuffledQuestions.length}`, "neutral");
    }
    renderNextButton();
    // Start timer (global for entire quiz or per question)
    const config = quiz.quiz.timerConfig || { mode: 'question', limitSeconds: 30 };
    if (!quiz.hasAnswered) {
        startTimer(config, () => {
            if (quiz?.quiz.mode === 'exam') {
                showResults(); // Hard stop for exam
            }
            else {
                onAnswer(null); // Time out for practice
            }
        });
    }
}
export function renderExamNavigation() {
    if (!quiz)
        return;
    const navId = "exam-nav";
    let nav = document.getElementById(navId);
    // Hide if only one question
    if (quiz.shuffledQuestions.length <= 1) {
        if (nav)
            nav.style.display = "none";
        return;
    }
    if (!nav) {
        nav = document.createElement("div");
        nav.id = navId;
        nav.className = "exam-navigation";
        document.querySelector(".quiz-main")?.prepend(nav);
    }
    nav.style.display = "flex";
    clearElement(nav);
    quiz.shuffledQuestions.forEach((q, idx) => {
        const isAnswered = quiz.userAnswers.has(q.id);
        const isActive = quiz.currentIndex === idx;
        const btn = document.createElement("button");
        btn.className = `nav-dot ${isActive ? 'active' : ''} ${isAnswered ? 'answered' : ''}`;
        btn.textContent = String(idx + 1);
        btn.onclick = () => window.jumpTo(idx);
        nav.appendChild(btn);
    });
    // Expose jumpTo globally for onclick handlers
    window.jumpTo = (idx) => {
        if (!quiz)
            return;
        quiz.jumpToQuestion(idx);
        renderQuiz();
    };
}
// Render status message
export function renderStatus(message, kind) {
    const colorClass = kind === "correct" ? "badge badge-correct" : kind === "incorrect" ? "badge badge-incorrect" : "badge";
    const scoreText = `${t('quiz.score')}: ${quiz?.score ?? 0}`;
    clearElement(statusContainer);
    const msgSpan = document.createElement("span");
    msgSpan.className = colorClass;
    msgSpan.textContent = message;
    statusContainer.appendChild(msgSpan);
    if (quiz?.quiz.mode !== 'exam') {
        const scoreSpan = document.createElement("span");
        scoreSpan.className = "badge";
        scoreSpan.textContent = scoreText;
        statusContainer.appendChild(scoreSpan);
        
        if (quiz && quiz.streak >= 3) {
            const streakSpan = document.createElement("span");
            streakSpan.className = "badge streak-badge animate-pulse";
            streakSpan.style.background = "linear-gradient(135deg, #ff4e50, #f9d423)";
            streakSpan.style.color = "white";
            streakSpan.style.border = "none";
            streakSpan.style.boxShadow = "0 0 10px rgba(255, 78, 80, 0.5)";
            streakSpan.style.fontWeight = "bold";
            streakSpan.style.animation = "streak-pulse 1s infinite alternate";
            streakSpan.textContent = `${t('quiz.streak')}: x${quiz.streak}`;
            statusContainer.appendChild(streakSpan);
        }
    }
}
export function renderQuestionCounter() {
    if (!quiz)
        return;
    const counterId = "question-counter";
    let counter = document.getElementById(counterId);
    if (!counter) {
        counter = document.createElement("div");
        counter.id = counterId;
        counter.className = "question-counter";
        questionContainer.insertBefore(counter, questionContainer.firstChild);
    }
    counter.textContent = `${t('quiz.question')} ${quiz.currentIndex + 1} ${t('quiz.of')} ${quiz.shuffledQuestions.length}`;
}
/**
 * Controls the visibility and text of the main flow button (Next/Submit/Results).
 * Dynamically changes behavior based on Exam vs Practice mode.
 */
export function renderNextButton() {
    const btnId = "next-btn";
    let btn = document.getElementById(btnId);
    if (!btn) {
        btn = document.createElement("button");
        btn.id = btnId;
        btn.className = "btn btn-primary";
        btn.style.marginTop = "15px";
        statusContainer.appendChild(btn);
    }
    if (!quiz) {
        btn.style.display = "none";
        return;
    }
    if (quiz.quiz.mode === 'exam') {
        const q = quiz; // Capture for closure
        btn.style.display = "block";
        if (q.isLastQuestion) {
            btn.textContent = t('quiz.examSubmit');
            btn.onclick = () => {
                const unanswered = q.shuffledQuestions.length - q.userAnswers.size;
                const confirmMsg = unanswered > 0 ?
                    `Tau dar liko ${unanswered} neatsakytų klausimų. Ar tikrai norite pateikti?` :
                    t('quiz.examConfirm');
                if (confirm(confirmMsg))
                    showResults();
            };
        }
        else {
            btn.textContent = t('quiz.nextQuestion');
            btn.onclick = () => {
                q.nextQuestion();
                renderQuiz();
            };
        }
    }
    else {
        if (quiz.isLastQuestion && quiz.hasAnswered) {
            btn.style.display = "block";
            btn.textContent = t('quiz.viewResults');
            btn.onclick = showResults;
        }
        else {
            btn.style.display = quiz.hasAnswered ? "block" : "none";
            btn.textContent = t('quiz.nextQuestion');
            btn.onclick = () => {
                quiz.nextQuestion();
                renderQuiz();
            };
        }
    }
}
/**
 * Final phase of the quiz.
 * Stops timers, calculates final results, saves to local history, and displays the results card.
 */
export function showResults() {
    if (!quiz)
        return;
    clearTimer();
    const params = new URLSearchParams(window.location.search);
    const isPreview = params.get("preview") === "true";
    const results = quiz.getResults();
    const studentName = localStorage.getItem("current_student_name") || "Anonymous";
    const timeSpentSec = results.totalTime / 1000;
    const avgSpeed = results.total > 0 ? (timeSpentSec / results.total).toFixed(1) : 0;
    
    saveResult({
        name: studentName,
        quizId: quiz.quiz.id,
        quizTitle: quiz.quiz.title,
        score: results.score,
        maxScore: results.total,
        date: new Date().toISOString(),
        heartsLeft: window.quizHearts !== undefined ? window.quizHearts : 0,
        avgSpeed: avgSpeed,
        mode: quiz.quiz.mode || 'practice',
        details: results.questionResults
    });
    // Clean UI
    questionContainer.style.display = "none";
    answersContainer.style.display = "none";
    statusContainer.style.display = "none";
    document.getElementById("exam-nav")?.remove();
    const resultsId = "results-container";
    let container = document.getElementById(resultsId);
    if (!container) {
        container = document.createElement("div");
        container.id = resultsId;
        container.className = "results-container fade-in";
        document.querySelector(".quiz-main").appendChild(container);
    }
    const timeMin = Math.floor(results.totalTime / 60000);
    const timeSec = Math.floor((results.totalTime % 60000) / 1000);
    const card = document.createElement("div");
    card.className = "results-card";
    const title = document.createElement("h2");
    title.textContent = t('quiz.complete');
    card.appendChild(title);
    const scoreDiv = document.createElement("div");
    scoreDiv.className = "final-score";
    const percentDiv = document.createElement("div");
    percentDiv.className = "big-percent";
    percentDiv.textContent = `${results.percentage}%`;
    const ratioDiv = document.createElement("div");
    ratioDiv.className = "small-ratio";
    ratioDiv.textContent = `${results.correctCount} / ${results.total}`;
    
    const pointsDiv = document.createElement("div");
    pointsDiv.className = "total-points";
    pointsDiv.style.fontSize = "1.2rem";
    pointsDiv.style.fontWeight = "bold";
    pointsDiv.style.color = "var(--primary-light)";
    pointsDiv.style.marginTop = "5px";
    pointsDiv.textContent = `${results.score} PTS`;
    
    scoreDiv.appendChild(percentDiv);
    scoreDiv.appendChild(ratioDiv);
    scoreDiv.appendChild(pointsDiv);
    card.appendChild(scoreDiv);
    const statsDiv = document.createElement("div");
    statsDiv.className = "final-stats";
    const timeSpan = document.createElement("span");
    timeSpan.textContent = `⏱️ ${timeMin}:${timeSec.toString().padStart(2, '0')}`;
    
    const timeSpentSecVal = results.totalTime / 1000;
    const avgSpeedVal = results.total > 0 ? (timeSpentSecVal / results.total).toFixed(1) : 0;
    const speedSpan = document.createElement("span");
    speedSpan.style.marginLeft = "15px";
    speedSpan.textContent = `⚡ ${avgSpeedVal}s / q`;
    
    const heartsRemaining = window.quizHearts !== undefined ? window.quizHearts : 0;
    const heartsSpan = document.createElement("span");
    heartsSpan.style.marginLeft = "15px";
    heartsSpan.textContent = `❤️ ${heartsRemaining}`;

    statsDiv.appendChild(timeSpan);
    if (quiz.quiz.mode !== 'exam') {
        statsDiv.appendChild(speedSpan);
        statsDiv.appendChild(heartsSpan);
    }
    card.appendChild(statsDiv);
    // In Exam mode, we hide the detailed per-question review to maintain integrity.
    // In Practice mode, we show it unless explicitly disabled in the config.
    const showDetails = quiz.quiz.showDetailedResults !== false && quiz.quiz.mode !== 'exam';
    if (showDetails) {
        buildResultsReviewList(results, card);
    }
    
    if (isPreview) {
        buildPreviewFinishedInfo(card);
    }
    
    buildResultsRankCard(quiz, results, isPreview, card);
    buildResultsActions(quiz, container, isPreview, card);
    
    clearElement(container);
    container.appendChild(card);
    window.renderMathInElement(container, {
        delimiters: [{ left: "\\(", right: "\\)", display: false }, { left: "\\[", right: "\\]", display: true }]
    });
}

function buildResultsReviewList(results, card) {
    const reviewList = document.createElement("div");
    reviewList.className = "results-review-list";
    reviewList.style.marginTop = "30px";
    reviewList.style.textAlign = "left";
    const h3 = document.createElement("h3");
    h3.style.borderBottom = "2px solid var(--accent)";
    h3.style.paddingBottom = "8px";
    h3.textContent = t('dashboard.review');
    reviewList.appendChild(h3);
    results.questionResults.forEach((r, idx) => {
        const item = document.createElement("div");
        item.className = `result-item ${r.isCorrect ? 'correct' : (r.pendingReview ? 'pending' : 'incorrect')}`;
        item.style.padding = "15px";
        item.style.borderRadius = "8px";
        item.style.marginBottom = "15px";
        item.style.background = "rgba(255,255,255,0.03)";
        item.style.borderLeft = `4px solid ${r.isCorrect ? 'var(--success)' : (r.pendingReview ? 'var(--accent)' : 'var(--danger)')}`;
        const qNum = document.createElement("div");
        qNum.style.fontWeight = "bold";
        qNum.style.marginBottom = "5px";
        qNum.textContent = `${t('quiz.question')} ${idx + 1}`;
        item.appendChild(qNum);
        const qPrompt = document.createElement("div");
        qPrompt.style.marginBottom = "10px";
        qPrompt.style.fontStyle = "italic";
        qPrompt.textContent = r.questionPrompt;
        item.appendChild(qPrompt);
        const ansInfo = document.createElement("div");
        ansInfo.style.fontSize = "0.9rem";
        const strong = document.createElement("strong");
        strong.textContent = "Atsakymas: ";
        ansInfo.appendChild(strong);
        appendResultAnswer(r, ansInfo);
        item.appendChild(ansInfo);
        if (r.pendingReview) {
            const pend = document.createElement("div");
            pend.style.color = "var(--accent)";
            pend.style.fontSize = "0.8rem";
            pend.style.marginTop = "5px";
            pend.textContent = `⏳ ${t('quiz.pending')}`;
            item.appendChild(pend);
        }
        reviewList.appendChild(item);
    });
    card.appendChild(reviewList);
}

function buildPreviewFinishedInfo(card) {
    const previewInfo = document.createElement("div");
    previewInfo.className = "preview-finished-info";
    previewInfo.style.marginTop = "25px";
    previewInfo.style.padding = "15px";
    previewInfo.style.background = "rgba(251, 191, 36, 0.1)";
    previewInfo.style.border = "1px solid var(--accent)";
    previewInfo.style.borderRadius = "8px";
    previewInfo.style.color = "var(--accent)";
    previewInfo.style.fontWeight = "bold";
    previewInfo.style.textAlign = "center";
    previewInfo.textContent = t('quiz.previewFinished');
    card.appendChild(previewInfo);
}

function buildResultsRankCard(quiz, results, isPreview, card) {
    const maxStreak = quiz.maxStreak || 0;
    const accuracy = results.percentage;
    const score = results.correctCount || 0;
    const xpEarned = (score * 100) + (maxStreak * 50) + (accuracy * 5);
    
    if (!isPreview && xpEarned > 0) {
        const leveledUp = addPlayerXP(xpEarned);
        if (leveledUp) {
            playLevelUp();
            setTimeout(() => {
                if (window.confetti) confetti({ particleCount: 200, spread: 100, origin: { y: 0.3 } });
            }, 500);
        }
    }

    let rankTitle = t('rank.novice');
    let rankClass = "rank-novice";
    let rankComment = t('rank.novice.desc');
    let nextLevelXp = 300;
    if (xpEarned >= 1500) { rankTitle = t('rank.genius'); rankClass = "rank-genius"; rankComment = t('rank.genius.desc'); nextLevelXp = 1500; }
    else if (xpEarned >= 1000) { rankTitle = t('rank.master'); rankClass = "rank-master"; rankComment = t('rank.master.desc'); nextLevelXp = 1500; }
    else if (xpEarned >= 600) { rankTitle = t('rank.adept'); rankClass = "rank-adept"; rankComment = t('rank.adept.desc'); nextLevelXp = 1000; }
    else if (xpEarned >= 300) { rankTitle = t('rank.apprentice'); rankClass = "rank-apprentice"; rankComment = t('rank.apprentice.desc'); nextLevelXp = 600; }

    const rankCard = document.createElement("div");
    rankCard.className = `xp-rank-card ${rankClass}`;
    rankCard.style.marginTop = "25px";
    rankCard.style.padding = "20px";
    rankCard.style.borderRadius = "12px";
    rankCard.style.background = "rgba(255, 255, 255, 0.05)";
    rankCard.style.border = "1px solid rgba(255, 255, 255, 0.1)";
    rankCard.style.textAlign = "center";
    rankCard.style.boxShadow = "0 8px 32px rgba(0, 0, 0, 0.15)";
    rankCard.style.backdropFilter = "blur(12px)";
    rankCard.style.webkitBackdropFilter = "blur(12px)";

    const xpTitle = document.createElement("h4");
    xpTitle.style.margin = "0 0 10px 0";
    xpTitle.style.fontSize = "1rem";
    xpTitle.style.color = "var(--muted)";
    xpTitle.textContent = t('quiz.xpEarned');
    rankCard.appendChild(xpTitle);

    const xpVal = document.createElement("div");
    xpVal.className = "xp-value-glow";
    xpVal.style.fontSize = "2.2rem";
    xpVal.style.fontWeight = "800";
    xpVal.style.color = "var(--accent)";
    xpVal.style.marginBottom = "5px";
    xpVal.textContent = `+${xpEarned} XP`;
    rankCard.appendChild(xpVal);

    const rankLabel = document.createElement("div");
    rankLabel.style.fontSize = "0.9rem";
    rankLabel.style.color = "var(--muted)";
    rankLabel.style.marginBottom = "2px";
    rankLabel.textContent = t('quiz.rank');
    rankCard.appendChild(rankLabel);

    const rankBadge = document.createElement("div");
    rankBadge.className = "rank-badge";
    rankBadge.style.fontSize = "1.5rem";
    rankBadge.style.fontWeight = "700";
    rankBadge.style.display = "inline-block";
    rankBadge.style.padding = "6px 16px";
    rankBadge.style.borderRadius = "20px";
    rankBadge.style.background = "rgba(255, 255, 255, 0.08)";
    rankBadge.style.marginTop = "5px";
    rankBadge.textContent = rankTitle;
    rankCard.appendChild(rankBadge);

    const rankCommentEl = document.createElement("div");
    rankCommentEl.className = "rank-comment-glow";
    rankCommentEl.style.fontSize = "1rem";
    rankCommentEl.style.fontStyle = "italic";
    rankCommentEl.style.color = "var(--text)";
    rankCommentEl.style.marginTop = "15px";
    rankCommentEl.style.marginBottom = "5px";
    rankCommentEl.style.lineHeight = "1.45";
    rankCommentEl.style.opacity = "0.95";
    rankCommentEl.style.fontWeight = "500";
    rankCommentEl.textContent = rankComment;
    rankCard.appendChild(rankCommentEl);

    const progressContainer = document.createElement("div");
    progressContainer.style.width = "100%";
    progressContainer.style.background = "rgba(0, 0, 0, 0.2)";
    progressContainer.style.height = "8px";
    progressContainer.style.borderRadius = "4px";
    progressContainer.style.marginTop = "15px";
    progressContainer.style.overflow = "hidden";

    const progressBar = document.createElement("div");
    progressBar.style.height = "100%";
    progressBar.style.background = "var(--accent)";
    progressBar.style.borderRadius = "4px";

    const progressPercent = nextLevelXp > 0 ? (xpEarned / nextLevelXp) * 100 : 100;
    progressBar.style.width = `${Math.min(100, progressPercent)}%`;
    progressBar.style.transition = "width 1s ease-out";

    progressContainer.appendChild(progressBar);
    rankCard.appendChild(progressContainer);
    card.appendChild(rankCard);
}

function buildResultsActions(quiz, container, isPreview, card) {
    const actions = document.createElement("div");
    actions.style.marginTop = "30px";
    actions.style.display = "flex";
    actions.style.gap = "15px";
    actions.style.justifyContent = "center";
    
    const restartBtn = document.createElement("button");
    restartBtn.id = "restart-quiz-btn";
    restartBtn.className = "btn btn-primary";
    restartBtn.textContent = t('quiz.takeAgain');
    actions.appendChild(restartBtn);
    
    const menuBtn = document.createElement("button");
    menuBtn.id = "back-to-menu-btn";
    menuBtn.className = "btn";
    menuBtn.textContent = t('quiz.backToMenu');
    
    if (isPreview) {
        menuBtn.style.display = "none";
        const closeBtn = document.createElement("button");
        closeBtn.id = "close-preview-btn";
        closeBtn.className = "btn btn-secondary";
        closeBtn.textContent = t('admin.closePreview');
        actions.appendChild(closeBtn);
    } else {
        actions.appendChild(menuBtn);
    }
    card.appendChild(actions);

    setTimeout(() => {
        document.getElementById("restart-quiz-btn").onclick = () => {
            setQuiz(new QuizState(quiz.quiz));
            container.remove();
            questionContainer.style.display = "block";
            answersContainer.style.display = "block";
            statusContainer.style.display = "flex";
            renderQuiz();
        };
        document.getElementById("back-to-menu-btn")?.addEventListener("click", () => {
            window.location.href = "/";
        });
        if (isPreview) {
            document.getElementById("close-preview-btn")?.addEventListener("click", () => {
                window.close();
                alert(t('quiz.previewFinished'));
            });
        }
    }, 0);
}
function appendResultAnswer(r, parent) {
    if (r.type === 'image-upload' && r.answer) {
        parent.appendChild(document.createElement("br"));
        const img = document.createElement("img");
        img.src = sanitizeImageUrl(r.answer);
        img.style.maxHeight = "150px";
        img.style.marginTop = "5px";
        img.style.borderRadius = "4px";
        img.style.border = "1px solid rgba(255,255,255,0.1)";
        parent.appendChild(img);
        return;
    }
    const txt = Array.isArray(r.answer) ? r.answer.join(', ') : String(r.answer || t('quiz.noAnswer'));
    parent.appendChild(document.createTextNode(txt));
}
export function initializeQuiz(quizData) {
    setQuiz(new QuizState(quizData));
    // Show/hide back button for demo/premade quizzes only
    const backBtn = document.getElementById('quiz-back-btn');
    const isPremadeOrDemo = quizData.id.startsWith('demo') ||
        quizData.id.startsWith('algebra') ||
        quizData.id.startsWith('combinatorics');
    if (backBtn) {
        if (isPremadeOrDemo) {
            backBtn.style.display = 'inline-flex';
            backBtn.onclick = () => {
                if (confirm(t('quiz.backConfirm'))) {
                    // Clear quiz state
                    setQuiz(null);
                    clearTimer();
                    // Hide quiz interface
                    const quizHeader = document.querySelector('.quiz-header');
                    const quizMain = document.querySelector('.quiz-main');
                    if (quizHeader)
                        quizHeader.style.display = 'none';
                    if (quizMain)
                        quizMain.style.display = 'none';
                    // Show start menu
                    renderStartMenu();
                }
            };
        }
        else {
            backBtn.style.display = 'none';
        }
    }
    renderQuiz();
}
