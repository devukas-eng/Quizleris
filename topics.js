import { getTopicBundles, getHighScores } from "./storage.js";
import { getRequiredElement } from "./dom.js";
import { renderStartMenu } from "./menu.js";
import { initializeQuiz } from "./render.js";
import { t, getLanguage } from "./lang.js";

let startMenu;
let quizHeader;
let quizMain;
let activeCategory = "all";

export function renderTopicsPage() {
    startMenu = getRequiredElement("start-menu");
    quizHeader = document.querySelector(".quiz-header");
    quizMain = document.querySelector(".quiz-main");

    if (quizHeader) {
        // Hide header on topics overview to avoid ugly white space
        quizHeader.style.display = "none";

        // Ensure logo is always visible
        const logo = document.getElementById("app-logo");
        if (logo) logo.style.display = "block";
    }

    // Hide welcome/student form
    const welcomeH1 = startMenu.querySelector('h1');
    const welcomeP = startMenu.querySelector('p');
    const menuActions = startMenu.querySelector(".menu-actions");
    const existingForm = startMenu.querySelector(".student-form-container");
    if (welcomeH1) welcomeH1.style.display = "none";
    if (welcomeP) welcomeP.style.display = "none";
    if (menuActions) menuActions.style.display = "none";
    if (existingForm) existingForm.style.display = "none";

    let topicsContainer = startMenu.querySelector(".topics-page-container");
    if (topicsContainer) {
        topicsContainer.remove();
    }

    topicsContainer = document.createElement("div");
    topicsContainer.className = "topics-page-container";
    topicsContainer.style.width = "100%";
    topicsContainer.style.maxWidth = "1000px";
    topicsContainer.style.margin = "0 auto";
    topicsContainer.style.padding = "20px";

    startMenu.appendChild(topicsContainer);

    const langToggle = document.getElementById('lang-toggle');
    if (langToggle && langToggle.parentElement) {
        langToggle.parentElement.style.display = "none";
    }

    // Initial render
    renderTopicsContent(topicsContainer);
}

function renderTopicsContent(container) {
    const bundles = getTopicBundles();
    
    // Categories list
    const categories = [
        { id: "all", label: t('topics.categories.all') || "All" },
        { id: "math", label: t('topics.categories.math') || "Math & Physics" },
        { id: "lang", label: t('topics.categories.lang') || "Languages & Trivia" },
        { id: "cs", label: t('topics.categories.cs') || "Computer Science" }
    ];

    // Filter bundles by active tab
    const filteredBundles = activeCategory === "all" 
        ? bundles 
        : bundles.filter(b => b.category === activeCategory);

    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
            <h1 style="font-size: 2.2rem; margin: 0; background: linear-gradient(135deg, var(--accent), #34d399); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${t('topics.title') || 'Premade Quizzes'}</h1>
            <button id="topics-back-btn" class="btn btn-secondary" style="font-size: 0.95rem; padding: 8px 16px;">${t('admin.backToMenu') || 'Back'}</button>
        </div>

        <!-- Glassmorphic Category Tabs -->
        <div class="category-tabs-container">
            <div class="category-tabs">
                ${categories.map(cat => `
                    <button class="category-tab ${activeCategory === cat.id ? 'active' : ''}" data-category="${cat.id}">
                        ${cat.label}
                    </button>
                `).join('')}
            </div>
        </div>
        
        <div class="bundle-grid" style="margin-top: 24px;">
            ${filteredBundles.map(b => renderBundleCard(b)).join('')}
            ${filteredBundles.length === 0 ? `
                <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--muted); font-size: 1.1rem; background: rgba(255,255,255,0.02); border-radius: var(--radius); border: 1px dashed rgba(255,255,255,0.1);">
                    No quizzes available in this category.
                </div>
            ` : ''}
        </div>
    `;

    // Wire up back button
    document.getElementById("topics-back-btn").onclick = () => {
        window.history.pushState({}, '', '/');
        renderStartMenu();
    };

    // Wire up tabs
    container.querySelectorAll(".category-tab").forEach(tab => {
        tab.onclick = () => {
            activeCategory = tab.dataset.category;
            renderTopicsContent(container);
        };
    });

    // Wire up start buttons to show Play-Mode Selector Modal
    filteredBundles.forEach(b => {
        const btn = document.getElementById(`start-bundle-${b.id}`);
        if (btn) {
            btn.onclick = () => {
                openPlayModeModal(b);
            };
        }
    });
}

function renderBundleCard(bundle) {
    const difficultyColor = bundle.difficulty === 'beginner' ? '#10b981' :
        bundle.difficulty === 'intermediate' ? '#f59e0b' : '#ef4444';
        
    // Generate gradient class/style based on category
    let cardAccent = "var(--accent)";
    if (bundle.category === "math") cardAccent = "#d946ef"; // Purple/Pink
    else if (bundle.category === "lang") cardAccent = "#3b82f6"; // Blue/Cyan
    else if (bundle.category === "cs") cardAccent = "#f97316"; // Cyber orange

    return `
        <div class="bundle-card premium-card" style="border-top: 4px solid ${cardAccent};">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; gap: 12px;">
                <h3 style="margin: 0; font-size: 1.2rem; font-weight: 700; line-height: 1.3;">${bundle.title}</h3>
                <span class="difficulty-badge" style="color: ${difficultyColor}; background: ${difficultyColor}15; border: 1px solid ${difficultyColor}30;">
                    ${bundle.difficulty}
                </span>
            </div>
            <p style="color: var(--muted); font-size: 0.9rem; margin: 0 0 20px 0; flex-grow: 1; display: flex; align-items: center; gap: 6px;">
                <span>📂 ${getCategoryLabel(bundle.category)}</span>
                <span>•</span>
                <span>⏱️ ~${bundle.estimatedMinutes} min</span>
                <span>•</span>
                <span>❓ ${bundle.questions.length} ${getQuestionsWord(bundle.questions.length)}</span>
            </p>
            <button id="start-bundle-${bundle.id}" class="btn btn-primary" style="margin-top: auto; width: 100%; border-radius: 8px; font-weight: bold; background: ${cardAccent}; border-color: ${cardAccent};">
                ${t('modal.playBtn') || 'Play'}
            </button>
        </div>
    `;
}

function getCategoryLabel(category) {
    const lang = getLanguage();
    if (category === "math") return lang === 'lt' ? 'Matematika' : 'Math & Physics';
    if (category === "lang") return lang === 'lt' ? 'Kalbos' : 'Languages & Trivia';
    if (category === "cs") return lang === 'lt' ? 'Informatika' : 'Computer Science';
    return category;
}

function getQuestionsWord(count) {
    const lang = getLanguage();
    if (lang === 'lt') {
        if (count % 10 === 1 && count % 100 !== 11) return 'klausimas';
        if (count % 10 >= 2 && count % 10 <= 9 && (count % 100 < 11 || count % 100 > 19)) return 'klausimai';
        return 'klausimų';
    }
    return count === 1 ? 'question' : 'questions';
}

function openPlayModeModal(bundle) {
    // Remove existing modal if any
    const existing = document.getElementById("play-mode-modal-overlay");
    if (existing) existing.remove();

    // High score query
    const scores = getHighScores();
    const myHighScore = scores.find(s => s.quizId === bundle.id);
    let highScoreHtml = "";
    if (myHighScore) {
        const pct = Math.round((myHighScore.score / myHighScore.maxScore) * 100);
        highScoreHtml = `
            <div class="modal-highscore-badge">
                🏆 ${t('modal.highScore') || 'High Score'}: <strong>${myHighScore.score}/${myHighScore.maxScore} (${pct}%)</strong> (${myHighScore.name})
            </div>
        `;
    }

    const lang = getLanguage();
    const modePracticeTitle = lang === 'lt' ? 'Treniruotė' : 'Practice Mode';
    const modeTimeAttackTitle = lang === 'lt' ? 'Laiko Ataka' : 'Time Attack';
    const modeExamTitle = lang === 'lt' ? 'Egzaminas' : 'Exam Mode';

    const overlay = document.createElement("div");
    overlay.id = "play-mode-modal-overlay";
    overlay.className = "modal-overlay active";

    overlay.innerHTML = `
        <div class="modal-window play-mode-modal fade-in" style="max-width: 600px; padding: 24px; border-radius: 16px; background: rgba(31, 41, 55, 0.95); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 20px 50px rgba(0,0,0,0.5);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px;">
                <h2 style="margin: 0; font-size: 1.5rem; color: var(--accent);">${t('modal.playTitle') || 'Select Play Mode'}</h2>
                <button id="modal-close-btn" style="background: none; border: none; color: white; font-size: 1.8rem; cursor: pointer; line-height: 1;">&times;</button>
            </div>
            
            <h4 style="margin: 0 0 12px 0; color: white; font-size: 1.1rem; text-align: center;">${bundle.title}</h4>
            
            ${highScoreHtml}

            <div class="mode-options-grid" style="display: flex; flex-direction: column; gap: 12px; margin: 20px 0;">
                <div class="mode-card active" data-mode="practice" style="cursor: pointer; padding: 16px; border-radius: 10px; border: 2px solid var(--accent); background: rgba(27, 155, 126, 0.1); transition: all 0.2s;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                        <span style="font-size: 1.5rem;">📖</span>
                        <h3 style="margin: 0; font-size: 1.1rem; color: white;">${modePracticeTitle}</h3>
                    </div>
                    <p style="margin: 0; font-size: 0.85rem; color: var(--muted);">${t('modal.practiceDesc') || 'Best for learning: instant feedback and answers.'}</p>
                </div>

                <div class="mode-card" data-mode="time-attack" style="cursor: pointer; padding: 16px; border-radius: 10px; border: 2px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); transition: all 0.2s;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                        <span style="font-size: 1.5rem;">⏱️</span>
                        <h3 style="margin: 0; font-size: 1.1rem; color: white;">${modeTimeAttackTitle}</h3>
                    </div>
                    <p style="margin: 0; font-size: 0.85rem; color: var(--muted);">${t('modal.timeAttackDesc') || 'Exciting mode: tight 15s limit per question!'}</p>
                </div>

                <div class="mode-card" data-mode="exam" style="cursor: pointer; padding: 16px; border-radius: 10px; border: 2px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); transition: all 0.2s;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                        <span style="font-size: 1.5rem;">📝</span>
                        <h3 style="margin: 0; font-size: 1.1rem; color: white;">${modeExamTitle}</h3>
                    </div>
                    <p style="margin: 0; font-size: 0.85rem; color: var(--muted);">${t('modal.examDesc') || 'Formal exam: results after full submission only.'}</p>
                </div>
            </div>

            <button id="modal-start-btn" class="btn btn-primary" style="width: 100%; padding: 12px; font-weight: bold; font-size: 1.1rem; border-radius: 10px;">
                ${t('modal.playBtn') || 'Play Now!'}
            </button>
        </div>
    `;

    document.body.appendChild(overlay);

    let selectedMode = "practice";

    // Set up click handlers on cards
    const cards = overlay.querySelectorAll(".mode-card");
    cards.forEach(card => {
        card.onclick = () => {
            cards.forEach(c => {
                c.classList.remove("active");
                c.style.borderColor = "rgba(255,255,255,0.08)";
                c.style.background = "rgba(255,255,255,0.02)";
            });
            card.classList.add("active");
            card.style.borderColor = "var(--accent)";
            card.style.background = "rgba(27, 155, 126, 0.1)";
            selectedMode = card.dataset.mode;
        };
    });

    // Close button
    overlay.querySelector("#modal-close-btn").onclick = () => {
        overlay.remove();
    };

    // Close on clicking overlay outside the window
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };

    // Start button click
    overlay.querySelector("#modal-start-btn").onclick = () => {
        overlay.remove();
        
        // Deep copy of bundle configuration to modify mode dynamically
        const quizConfig = JSON.parse(JSON.stringify(bundle));
        
        if (selectedMode === "practice") {
            quizConfig.mode = "practice";
        } else if (selectedMode === "time-attack") {
            quizConfig.mode = "practice"; // Immediate feedback but tight timer
            quizConfig.timerConfig = {
                mode: "question",
                limitSeconds: 15 // Enforce a 15-second timer per question
            };
        } else if (selectedMode === "exam") {
            quizConfig.mode = "exam"; // Exam mode with results only at the end
        }

        startTopicQuiz(quizConfig);
    };
}

function startTopicQuiz(quiz) {
    const name = localStorage.getItem("current_student_name") || "Anonymous";
    startMenu.style.display = "none";
    if (quizHeader) quizHeader.style.display = "flex";
    if (quizMain) quizMain.style.display = "flex";
    initializeQuiz(quiz);
}
