import { getTopicBundles, getHighScores } from "./storage.js";
import { renderFrenzyMode } from "./frenzy.js";
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

    // Hide welcome/hero section
    const heroSection = startMenu.querySelector('.hero-section');
    const existingForm = startMenu.querySelector(".student-form-container");
    if (heroSection) heroSection.style.display = "none";
    if (existingForm) existingForm.style.display = "none";

    let topicsContainer = startMenu.querySelector(".topics-page-container");
    if (topicsContainer) {
        topicsContainer.remove();
    }

    topicsContainer = document.createElement("div");
    topicsContainer.className = "topics-page-container page-transition";
    topicsContainer.style.width = "90%";
    topicsContainer.style.maxWidth = "1100px";
    topicsContainer.style.margin = "0 auto";
    topicsContainer.style.padding = "24px 0";

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

    let categoriesHtml = '';
    
    if (activeCategory === 'all') {
        categoriesHtml += `
            <div class="category-section" style="position: relative;">
                <h2 class="category-section-title">🔥 Arcade Modes</h2>
                <div class="bundle-row-wrapper" style="position: relative;">
                    <div class="bundle-row wrap-row" style="scroll-behavior: smooth;">
                        <!-- Frenzy Card -->
                        <div class="bundle-card kahoot-card" id="card-frenzy-mode" style="cursor: pointer; border: 2px solid #ef4444; min-width: 280px; flex: 0 0 auto;">
                            <div class="kahoot-card-header" style="background: linear-gradient(135deg, #7f1d1d, #b91c1c);">
                                <span class="kahoot-card-icon">🔥</span>
                                <h3 class="kahoot-card-title">Frenzy Survival</h3>
                            </div>
                            <div class="kahoot-card-body">
                                <div class="kahoot-badges" style="display: flex; gap: 6px; justify-content: flex-start; flex-wrap: wrap;">
                                    <span class="kahoot-badge" style="color: #ef4444; background: #ef444418; border-color: #ef444440;">🔴 Endless</span>
                                    <span class="kahoot-badge" style="color: #ef4444; background: #ef444418; border-color: #ef444440;">⏱️ Rapid Fire</span>
                                </div>
                                <div class="kahoot-card-desc" style="color: var(--muted); font-size: 0.9rem; margin-top: 10px; margin-bottom: 10px;">
                                    Survive as long as you can! Answer quickly before the fuse burns out.
                                </div>
                                <button id="btn-start-frenzy-topics" class="kahoot-play-btn" style="background: #ef4444; width: 100%;">
                                    ▶ Play Frenzy
                                </button>
                            </div>
                        </div>

                        <!-- Race Mode Card -->
                        <div class="bundle-card kahoot-card" id="card-race-mode" style="cursor: pointer; border: 2px solid #6366f1; min-width: 280px; flex: 0 0 auto; margin-left: 16px;">
                            <div class="kahoot-card-header" style="background: linear-gradient(135deg, #4f46e5, #6366f1);">
                                <span class="kahoot-card-icon">🏎️</span>
                                <h3 class="kahoot-card-title">Real-Time Race</h3>
                            </div>
                            <div class="kahoot-card-body">
                                <div class="kahoot-badges" style="display: flex; gap: 6px; justify-content: flex-start; flex-wrap: wrap;">
                                    <span class="kahoot-badge" style="color: #6366f1; background: rgba(99, 102, 241, 0.1); border-color: rgba(99, 102, 241, 0.3);">🤖 VS Bots</span>
                                    <span class="kahoot-badge" style="color: #6366f1; background: rgba(99, 102, 241, 0.1); border-color: rgba(99, 102, 241, 0.3);">🏁 Race to 10</span>
                                </div>
                                <div class="kahoot-card-desc" style="color: var(--muted); font-size: 0.9rem; margin-top: 10px; margin-bottom: 10px;">
                                    Race in real-time against 3 other opponents! First one to answer 10 questions wins.
                                </div>
                                <button id="btn-start-race-topics" class="kahoot-play-btn" style="background: #6366f1; width: 100%;">
                                    ▶ Join Race
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        let community = [];
        try {
            community = JSON.parse(localStorage.getItem("quizleris_community_quizzes") || "[]");
        } catch(e) {}
        
        if (community.length > 0) {
            categoriesHtml += `
                <div class="category-section" style="position: relative; margin-top: 40px;">
                    <h2 class="category-section-title" style="color: var(--accent);">🌍 Community Quizzes</h2>
                    <div class="bundle-row-wrapper" style="position: relative;">
                        <div class="bundle-row" style="scroll-behavior: smooth;">
                            ${community.map(q => `
                                <div class="bundle-card kahoot-card" style="cursor: pointer; border: 2px solid var(--accent); min-width: 250px; flex: 0 0 auto;" onclick="window.location.search = '?quiz=' + encodeURIComponent('${q.shareCode}')">
                                    <div class="kahoot-card-header" style="background: linear-gradient(135deg, var(--accent), var(--primary));">
                                        <h3 class="kahoot-card-title" style="font-size: 1.1rem;">${q.title}</h3>
                                    </div>
                                    <div class="kahoot-card-body">
                                        <div class="kahoot-badges" style="display: flex; gap: 6px; justify-content: flex-start; flex-wrap: wrap;">
                                            <span class="kahoot-badge" style="color: var(--accent); background: rgba(0,0,0,0.2);">👤 Community</span>
                                            <span class="kahoot-badge" style="color: var(--accent); background: rgba(0,0,0,0.2);">❓ ${q.qCount} Qs</span>
                                        </div>
                                        <button class="kahoot-play-btn" style="background: var(--accent); width: 100%; margin-top: 15px;">
                                            ▶ Play
                                        </button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        }
    }
    const catsToRender = activeCategory === 'all' 
        ? categories.filter(c => c.id !== 'all') 
        : categories.filter(c => c.id === activeCategory);

    catsToRender.forEach(cat => {
        const catBundles = bundles.filter(b => b.category === cat.id);
        if (catBundles.length > 0) {
            const titleHtml = activeCategory === 'all' 
                ? `<h2 class="category-section-title">${cat.label}</h2>` 
                : '';
            
            categoriesHtml += `
                <div class="category-section" style="position: relative; ${activeCategory !== 'all' ? 'margin-top: 24px;' : ''}">
                    ${titleHtml}
                    <div class="bundle-row-wrapper" style="position: relative;">
                        ${activeCategory === 'all' ? `
                        <button class="scroll-btn scroll-left" aria-label="Scroll Left">❮</button>
                        <button class="scroll-btn scroll-right" aria-label="Scroll Right">❯</button>
                        ` : ''}
                        <div class="bundle-row ${activeCategory !== 'all' ? 'wrap-row' : ''}" style="scroll-behavior: smooth;">
                            ${catBundles.map(b => renderBundleCard(b)).join('')}
                        </div>
                    </div>
                </div>
            `;
        }
    });

    if (categoriesHtml === '') {
        categoriesHtml = `
            <div style="text-align: center; padding: 60px 20px; color: var(--muted); font-size: 1.1rem; background: rgba(255,255,255,0.02); border-radius: var(--radius); border: 1px dashed rgba(255,255,255,0.1); margin-top: 24px;">
                No quizzes available in this category.
            </div>
        `;
    }

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
        
        <div id="topics-content-wrapper">
            ${categoriesHtml}
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

    // Wire up Netflix scroll logic
    container.querySelectorAll(".bundle-row-wrapper").forEach(wrapper => {
        const row = wrapper.querySelector(".bundle-row");
        const leftBtn = wrapper.querySelector(".scroll-left");
        const rightBtn = wrapper.querySelector(".scroll-right");
        
        if (row && leftBtn && rightBtn) {
            leftBtn.onclick = () => {
                row.scrollBy({ left: -320, behavior: 'smooth' });
            };
            rightBtn.onclick = () => {
                row.scrollBy({ left: 320, behavior: 'smooth' });
            };
        }
    });

    // Wire up start buttons to show Play-Mode Selector Modal
    bundles.forEach(b => {
        const btn = document.getElementById(`start-bundle-${b.id}`);
        if (btn) {
            btn.onclick = () => {
                openPlayModeModal(b);
            };
        }
    });

    const frenzyBtn = document.getElementById('btn-start-frenzy-topics');
    if (frenzyBtn) {
        frenzyBtn.onclick = () => {
            renderFrenzyMode();
        };
    }

    const raceBtn = document.getElementById('btn-start-race-topics');
    if (raceBtn) {
        raceBtn.onclick = () => {
            import("./race.js").then(m => m.renderRaceMode());
        };
    }
}

function renderBundleCard(bundle) {
    const difficultyColor = bundle.difficulty === 'beginner' ? '#10b981' :
        bundle.difficulty === 'intermediate' ? '#f59e0b' : '#ef4444';
        
    // Generate gradient class/style based on category
    let cardAccent = "var(--accent)";
    if (bundle.category === "math") cardAccent = "#d946ef"; // Purple/Pink
    else if (bundle.category === "lang") cardAccent = "#3b82f6"; // Blue/Cyan
    else if (bundle.category === "cs") cardAccent = "#f97316"; // Cyber orange

    const categoryIcons = { math: '📐', cs: '💻', lang: '🌍' };
    const icon = categoryIcons[bundle.category] || '🧠';
    const diffLabel = bundle.difficulty === 'beginner' ? '🟢 Beginner' : bundle.difficulty === 'intermediate' ? '🟡 Intermediate' : '🔴 Advanced';

    return `
        <div class="bundle-card kahoot-card">
            <div class="kahoot-card-header" style="background: linear-gradient(135deg, ${cardAccent}dd, ${cardAccent}88);">
                <span class="kahoot-card-icon">${icon}</span>
                <h3 class="kahoot-card-title">${bundle.title}</h3>
            </div>
            <div class="kahoot-card-body">
                <div class="kahoot-badges" style="display: flex; gap: 6px; justify-content: flex-start; flex-wrap: wrap;">
                    <span class="kahoot-badge" style="color: ${difficultyColor}; background: ${difficultyColor}18; border-color: ${difficultyColor}40;">${diffLabel}</span>
                    <span class="kahoot-badge" style="color: ${difficultyColor}; background: ${difficultyColor}18; border-color: ${difficultyColor}40;">⏱️ ${bundle.estimatedMinutes}m</span>
                    <span class="kahoot-badge" style="color: ${difficultyColor}; background: ${difficultyColor}18; border-color: ${difficultyColor}40;">❓ ${bundle.questions.length} Qs</span>
                </div>
                <button id="start-bundle-${bundle.id}" class="kahoot-play-btn" style="background: ${cardAccent};">
                    ▶ ${t('modal.playBtn') || 'Play'}
                </button>
            </div>
        </div>
    `;
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
                <h2 style="margin: 0; font-size: 1.5rem; color: var(--accent);">${bundle.title}</h2>
                <button id="modal-close-btn" style="background: none; border: none; color: white; font-size: 1.8rem; cursor: pointer; line-height: 1;">&times;</button>
            </div>
            
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

        // "Dilute" the topic with 3-5 random questions from other bundles
        const allBundles = getTopicBundles();
        let otherQuestions = [];
        allBundles.forEach(b => {
            if (b.id !== quizConfig.id) {
                otherQuestions = otherQuestions.concat(JSON.parse(JSON.stringify(b.questions)));
            }
        });
        otherQuestions.sort(() => 0.5 - Math.random());
        // Pick random questions to inject
        const numToDilute = Math.min(5, Math.max(3, Math.floor(quizConfig.questions.length / 3)));
        if (otherQuestions.length > 0) {
            const toAdd = otherQuestions.slice(0, numToDilute);
            quizConfig.questions = quizConfig.questions.concat(toAdd);
        }
        
        // Force shuffle ON
        if (!quizConfig.shuffleConfig) quizConfig.shuffleConfig = {};
        quizConfig.shuffleConfig.questions = true;
        quizConfig.shuffleConfig.answers = true;

        startTopicQuiz(quizConfig);
    };
}

function startTopicQuiz(quiz) {
    startMenu.style.display = "none";
    if (quizHeader) quizHeader.style.display = "flex";
    if (quizMain) quizMain.style.display = "flex";
    initializeQuiz(quiz);
}
