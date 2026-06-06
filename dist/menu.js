import { getRequiredElement, escapeHtml } from "./dom.js";
import { updatePageLanguage, t, getLanguage } from "./lang.js";
import { renderTopicsPage } from "./topics.js";
import { renderFrenzyMode } from "./frenzy.js";
import { showLegalModal } from "./legal.js";
// DOM Elements
let startMenu;
let quizHeader;
let quizMain;
let isStudentMenuOpen = false;

/**
 * Bootstraps the main menu DOM references and top-level navigation buttons.
 */
// Store callbacks at module level
let _adminCallback = null;

export function setupMenu(callbacks) {
    startMenu = getRequiredElement("start-menu");
    quizHeader = document.querySelector(".quiz-header");
    quizMain = document.querySelector(".quiz-main");
    _adminCallback = callbacks.onAdmin;
    // Note: the static #menu-btn-student / #menu-btn-admin buttons no longer exist;
    // they are now injected dynamically by renderStartMenu.
}
export function isStudentViewActive() {
    return isStudentMenuOpen;
}


/**
 * Resets the UI to the initial landing screen — Kahoot-style hero.
 */
export function renderStartMenu() {
    if (!startMenu) {
        console.error("Menu not setup! Call setupMenu() first.");
        return;
    }

    // Show menu, hide game
    startMenu.style.display = "flex";
    quizHeader.style.display = "none";
    quizMain.style.display = "none";

    const quizBackBtn = document.getElementById("quiz-back-btn");
    if (quizBackBtn) quizBackBtn.style.display = "none";

    // Clear any dynamic content
    const container = startMenu.querySelector(".student-form-container");
    if (container) container.remove();
    const topicsContainer = startMenu.querySelector(".topics-page-container");
    if (topicsContainer) topicsContainer.remove();

    isStudentMenuOpen = false;

    // Inject hero layout
    startMenu.innerHTML = `
        <div class="hero-section page-transition" style="animation: slideUpFade 0.5s cubic-bezier(0.16,1,0.3,1) both;">
            <h1 class="hero-headline">${t('menu.heroHeadline')}</h1>

            <!-- PIN / Quiz ID entry -->
            <div class="pin-entry-bar">
                <input id="hero-pin-input" type="text" placeholder="${t('menu.pinPlaceholder')}" autocomplete="off" spellcheck="false" />
                <button class="pin-go-btn" id="hero-pin-go">${t('menu.pinGo')}</button>
            </div>

            <div class="hero-divider">${t('menu.divider')}</div>

            <!-- Discover button -->
            <button class="discover-btn" id="hero-discover-btn">
                <span>🔍</span>
                <span>${t('menu.discover')}</span>
            </button>

            <!-- Admin / Dashboard subtle links -->
            <div class="menu-admin-row">
                <button id="menu-btn-admin" class="btn" style="font-size:0.82rem; padding:6px 14px; opacity:0.7;" data-i18n="menu.admin">${t('menu.admin')}</button>
            </div>
        </div>
    `;

    // Wire PIN go button
    const pinInput = document.getElementById('hero-pin-input');
    const pinGoBtn = document.getElementById('hero-pin-go');
    if (pinGoBtn && pinInput) {
        const doStart = () => {
            const val = pinInput.value.trim();
            if (val) {
                isStudentMenuOpen = true;
                startStudentQuiz('', val);
            } else {
                pinInput.focus();
                pinInput.style.animation = 'shake 0.4s ease-in-out';
                setTimeout(() => { pinInput.style.animation = ''; }, 450);
            }
        };
        pinGoBtn.addEventListener('click', doStart);
        pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doStart(); });
    }

    // Wire Discover button
    const discoverBtn = document.getElementById('hero-discover-btn');
    if (discoverBtn) {
        discoverBtn.addEventListener('click', () => {
            isStudentMenuOpen = true;
            window.history.pushState({}, '', '/topics');
            renderTopicsPage();
        });
    }



    // Wire admin button
    const adminBtn2 = document.getElementById('menu-btn-admin');
    if (adminBtn2) {
        adminBtn2.addEventListener('click', () => {
            try { _adminCallback(); } catch(e) { alert('Admin error: ' + e); }
        });
    }



    // Update translations
    updatePageLanguage();
}

/**
 * Renders the intermediate "Join Quiz" screen shown when a user follows a quiz link.
 * Displays quiz metadata (title, question count, timer) and name input.
 */
export function renderStudentJoin(quizToJoin) {
    if (!startMenu)
        return;
    // Clear the dynamically rendered hero content
    startMenu.innerHTML = '';
    let joinContainer = document.createElement("div");
    joinContainer.className = "student-form-container student-join-container";
    startMenu.appendChild(joinContainer);
    joinContainer.style.display = "flex";

    // Time information
    let timeInfo = t('admin.timerNone');
    if (quizToJoin.timerConfig && quizToJoin.timerConfig.mode !== "none") {
        const limit = quizToJoin.timerConfig.limitSeconds;
        if (quizToJoin.timerConfig.mode === "question") {
            timeInfo = `${limit}s / ${t('admin.timerPerQuestion').toLowerCase()}`;
        }
        else {
            timeInfo = `${Math.floor(limit / 60)}m ${limit % 60}s ${t('admin.timerWholeQuiz').toLowerCase()}`;
        }
    }
    joinContainer.innerHTML = `
        <div class="join-card">
             <div style="margin-bottom: 24px;">
                <span style="background: var(--accent); color: #000; padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px;">
                    ${t('join.joinQuiz')}
                </span>
             </div>
             <div class="join-quiz-info">
                <h2 style="font-size: 2.2rem; margin-bottom: 12px;">${escapeHtml(quizToJoin.title)}</h2>
                <p style="font-size: 1.1rem; color: var(--muted);">${quizToJoin.questions.length} ${t('join.questions')} | ${escapeHtml(timeInfo)}</p>
             </div>
             
             <div class="join-input-group">
                <label for="join-student-name" class="join-label">${t('join.yourName')}</label>
                <input type="text" id="join-student-name" class="join-input" placeholder="${t('join.namePlaceholder')}">
             </div>
             
             <div class="join-actions" style="display: flex; flex-direction: column; gap: 10px;">
                <button id="join-host-race-btn" class="btn btn-secondary btn-xl" style="background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; border: none; font-weight: 800;">🏎️ Host Race</button>
                <div style="display: flex; gap: 10px; width: 100%;">
                    <button id="join-start-btn" class="btn btn-primary btn-xl" style="flex: 1;">${t('join.startBtn')}</button>
                    <button id="join-back-btn" class="btn btn-secondary" style="flex: 1;">${t('join.backBtn')}</button>
                </div>
             </div>
        </div>
    `;
    document.getElementById("join-start-btn").onclick = () => {
        const nameInput = document.getElementById("join-student-name");
        const name = nameInput.value.trim() || "Anonymous";
        startStudentQuizDirect(name, quizToJoin);
    };
    
    document.getElementById("join-host-race-btn").onclick = () => {
        const nameInput = document.getElementById("join-student-name");
        const name = nameInput.value.trim() || "Anonymous";
        if (name) localStorage.setItem("current_student_name", name);
        
        joinContainer.style.display = "none";
        document.getElementById('start-menu').style.display = "none";
        
        import("./race.js").then(m => m.renderRaceMode(quizToJoin));
    };
    // Auto-fill name in preview mode
    const params = new URLSearchParams(window.location.search);
    if (params.get("preview") === "true") {
        const nameInput = document.getElementById("join-student-name");
        if (nameInput) {
            nameInput.value = t('admin.previewName');
        }
    }
    document.getElementById("join-back-btn").onclick = () => {
        joinContainer.style.display = "none";
        renderStartMenu();
    };
}
// Student form handling
/**
 * Displays the student role choosing form.
 * Generates a list of premade quizzes and inputs for custom Quiz IDs.
 * NOTE: Uses 'data-i18n' attributes for dynamic translation support.
 */
export function handleStudentClick() {
    // Clear the hero layout and inject student form
    startMenu.innerHTML = '';
    let formContainer = document.createElement("div");
    formContainer.className = "student-form-container";
    formContainer.innerHTML = `
            <div style="margin-bottom: 20px;">
                <label data-i18n="student.nameLabel" style="display: block; margin-bottom: 8px; font-weight: 500;">Your Name (optional)</label>
                <input type="text" id="student-name" class="input-field" data-i18n-placeholder="student.namePlaceholder" placeholder="Enter name to track results">
            </div>
            
            <div style="margin: 20px 0;">
                <label style="margin-bottom:12px; display:block; font-weight: 500;" data-i18n="student.premadeLabel">Try a Premade Quiz:</label>
                <div id="premade-list" style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px;"></div>
            </div>

            <div style="margin-top: 20px;">
                <label data-i18n="student.quizIdLabel" style="display: block; margin-bottom: 8px; font-weight: 500;">Or Enter Quiz Code / ID</label>
                <input type="text" id="quiz-id-input" class="input-field" data-i18n-placeholder="student.quizIdPlaceholder" placeholder="demo">
            </div>
            <div style="margin-top: 32px; display: flex; gap: 12px;">
                <button id="start-quiz-btn" class="btn btn-primary" data-i18n="student.startBtn" style="flex: 1; padding: 12px;">Start Quiz</button>
                <button id="back-menu-btn" class="btn" data-i18n="student.backBtn" style="flex: 1; padding: 12px;">Back</button>
            </div>
        `;
    startMenu.appendChild(formContainer);
    // Ensure translations are applied immediately after creation
    updatePageLanguage();
    // Wire up buttons
    formContainer.querySelector("#back-menu-btn").addEventListener("click", () => {
        isStudentMenuOpen = false;
        renderStartMenu();
    });
    formContainer.querySelector("#start-quiz-btn").addEventListener("click", () => {
        const nameInput = document.getElementById("student-name");
        const quizInput = document.getElementById("quiz-id-input");
        startStudentQuiz(nameInput.value, quizInput.value);
    });

    // Populate premade quizzes based on language
    const premadeList = formContainer.querySelector("#premade-list");
    if (premadeList) {
        const currentLang = getLanguage();
        if (currentLang === 'en') {
            const btn = document.createElement("button");
            btn.className = "btn";
            btn.style.width = "100%";
            btn.style.padding = "10px 12px";
            btn.style.fontSize = "0.9rem";
            btn.setAttribute("data-i18n", "student.premadeEnglish");
            btn.textContent = t("student.premadeEnglish");
            btn.onclick = () => {
                window.history.pushState({}, "", "/topics");
                renderTopicsPage();
            };
            premadeList.appendChild(btn);
        }
        else {
            const btnEn = document.createElement("button");
            btnEn.className = "btn";
            btnEn.style.width = "100%";
            btnEn.style.padding = "10px 12px";
            btnEn.style.fontSize = "0.9rem";
            btnEn.setAttribute("data-i18n", "student.premadeEnglish");
            btnEn.textContent = t("student.premadeEnglish");
            btnEn.onclick = () => {
                window.history.pushState({}, "", "/topics");
                renderTopicsPage();
            };
            premadeList.appendChild(btnEn);

            const btnLt = document.createElement("button");
            btnLt.className = "btn";
            btnLt.style.width = "100%";
            btnLt.style.padding = "10px 12px";
            btnLt.style.fontSize = "0.9rem";
            btnLt.style.marginTop = "8px";
            btnLt.setAttribute("data-i18n", "student.premadeLithuanianSoon");
            btnLt.textContent = t("student.premadeLithuanianSoon");
            btnLt.onclick = () => {
                window.history.pushState({}, "", "/topics");
                renderTopicsPage();
            };
            premadeList.appendChild(btnLt);
        }
    }
}
function startStudentQuizDirect(name, quizData) {
    // Reuse logic
    if (name)
        localStorage.setItem("current_student_name", name);
    startMenu.style.display = "none";
    quizHeader.style.display = "flex";
    quizMain.style.display = "flex";
    initializeQuiz(quizData);
}
import { loadQuizFromStorage, getDemoQuiz, getPremadeQuizzes } from "./storage.js";
import { initializeQuiz } from "./render.js";
function startStudentQuiz(name, quizId) {
    quizId = quizId.trim() || "demo"; // default to demo if empty
    let quiz = loadQuizFromStorage(quizId);
    // If not found in storage, check premade quizzes
    if (!quiz) {
        if (quizId === "demo") {
            quiz = getDemoQuiz();
        }
        else {
            const premade = getPremadeQuizzes().find(q => q.id === quizId);
            if (premade) {
                quiz = premade;
            }
        }
    }
    if (!quiz) {
        alert("Quiz not found with that ID.");
        return;
    }
    // Save student name to session/local for results later
    if (name) {
        localStorage.setItem("current_student_name", name);
    }
    // Start Game
    startMenu.style.display = "none";
    quizHeader.style.display = "flex";
    quizMain.style.display = "flex";
    initializeQuiz(quiz);
}
