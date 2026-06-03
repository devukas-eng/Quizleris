import { getRequiredElement } from "./dom.js";
import { updatePageLanguage, t, getLanguage } from "./lang.js";
import { renderTopicsPage } from "./topics.js";
// DOM Elements
let startMenu;
let quizHeader;
let quizMain;
let studentBtn;
let adminBtn;
let isStudentMenuOpen = false;
/**
 * Bootstraps the main menu DOM references and top-level navigation buttons.
 */
export function setupMenu(callbacks) {
    startMenu = getRequiredElement("start-menu");
    quizHeader = document.querySelector(".quiz-header");
    quizMain = document.querySelector(".quiz-main");
    studentBtn = getRequiredElement("menu-btn-student");
    adminBtn = getRequiredElement("menu-btn-admin");
    adminBtn.onclick = () => {
        try {
            console.log("Admin clicked");
            callbacks.onAdmin();
        }
        catch (e) {
            alert("Admin Click Error: " + e);
        }
    };
    studentBtn.onclick = () => {
        try {
            isStudentMenuOpen = true;
            handleStudentClick();
        }
        catch (e) {
            alert("Student Click Error: " + e);
        }
    };
}
export function isStudentViewActive() {
    return isStudentMenuOpen;
}
/**
 * Resets the UI to the initial landing screen.
 * Hides the quiz interface and clears any active student forms.
 */
export function renderStartMenu() {
    // Ensure elements are ready
    if (!startMenu) {
        console.error("Menu not setup! Call setupMenu() first.");
        return;
    }
    // Show menu, hide game
    startMenu.style.display = "flex";
    quizHeader.style.display = "none";
    quizMain.style.display = "none";
    const quizBackBtn = document.getElementById("quiz-back-btn");
    if (quizBackBtn)
        quizBackBtn.style.display = "none";
    // Restore visibility of hidden children
    const welcomeH1 = startMenu.querySelector('h1');
    const welcomeP = startMenu.querySelector('p');
    const menuActions = startMenu.querySelector(".menu-actions");
    if (welcomeH1)
        welcomeH1.style.display = "block";
    if (welcomeP)
        welcomeP.style.display = "block";
    if (menuActions)
        menuActions.style.display = "flex";
    // Clear student form if it exists
    const container = startMenu.querySelector(".student-form-container");
    if (container)
        container.remove();
    // Clear topics container if it exists
    const topicsContainer = startMenu.querySelector(".topics-page-container");
    if (topicsContainer)
        topicsContainer.remove();
    isStudentMenuOpen = false;
}
/**
 * Renders the intermediate "Join Quiz" screen shown when a user follows a quiz link.
 * Displays quiz metadata (title, question count, timer) and name input.
 */
export function renderStudentJoin(quizToJoin) {
    if (!startMenu)
        return;
    // Hide everything else in menu
    const welcomeH1 = startMenu.querySelector('h1');
    const welcomeP = startMenu.querySelector('p');
    const menuActions = startMenu.querySelector(".menu-actions");
    const existingForm = startMenu.querySelector(".student-form-container");
    if (welcomeH1)
        welcomeH1.style.display = "none";
    if (welcomeP)
        welcomeP.style.display = "none";
    if (menuActions)
        menuActions.style.display = "none";
    if (existingForm)
        existingForm.style.display = "none";
    let joinContainer = startMenu.querySelector(".student-join-container");
    if (!joinContainer) {
        joinContainer = document.createElement("div");
        joinContainer.className = "student-form-container student-join-container";
        startMenu.appendChild(joinContainer);
    }
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
                <h2 style="font-size: 2.2rem; margin-bottom: 12px;">${quizToJoin.title}</h2>
                <p style="font-size: 1.1rem; color: var(--muted);">${quizToJoin.questions.length} ${t('join.questions')} | ${timeInfo}</p>
             </div>
             
             <div class="join-input-group">
                <label for="join-student-name" class="join-label">${t('join.yourName')}</label>
                <input type="text" id="join-student-name" class="join-input" placeholder="${t('join.namePlaceholder')}">
             </div>
             
             <div class="join-actions">
                <button id="join-start-btn" class="btn btn-primary btn-xl">${t('join.startBtn')}</button>
                <button id="join-back-btn" class="btn btn-secondary">${t('join.backBtn')}</button>
             </div>
        </div>
    `;
    document.getElementById("join-start-btn").onclick = () => {
        const nameInput = document.getElementById("join-student-name");
        const name = nameInput.value.trim() || "Anonymous";
        startStudentQuizDirect(name, quizToJoin);
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
        if (welcomeH1)
            welcomeH1.style.display = "block";
        if (welcomeP)
            welcomeP.style.display = "block";
        if (menuActions)
            menuActions.style.display = "flex";
    };
}
// Student form handling
/**
 * Displays the student role choosing form.
 * Generates a list of premade quizzes and inputs for custom Quiz IDs.
 * NOTE: Uses 'data-i18n' attributes for dynamic translation support.
 */
export function handleStudentClick() {
    // Hide welcome text and buttons, show student form
    const welcomeH1 = startMenu.querySelector('h1');
    const welcomeP = startMenu.querySelector('p');
    const menuActions = startMenu.querySelector(".menu-actions");
    if (welcomeH1)
        welcomeH1.style.display = "none";
    if (welcomeP)
        welcomeP.style.display = "none";
    menuActions.style.display = "none";
    let formContainer = startMenu.querySelector(".student-form-container");
    if (formContainer) {
        formContainer.remove();
    }
    formContainer = document.createElement("div");
    formContainer.className = "student-form-container";
    formContainer.innerHTML = `
            <div style="margin-bottom: 20px;">
                <label data-i18n="student.nameLabel" style="display: block; margin-bottom: 8px; font-weight: 500;">Your Name (optional)</label>
                <input type="text" id="student-name" class="admin-form" data-i18n-placeholder="student.namePlaceholder" placeholder="Enter name to track results">
            </div>
            
            <div style="margin: 20px 0;">
                <label style="margin-bottom:12px; display:block; font-weight: 500;" data-i18n="student.premadeLabel">Try a Premade Quiz:</label>
                <div id="premade-list" style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px;"></div>
            </div>

            <div style="margin-top: 20px;">
                <label data-i18n="student.quizIdLabel" style="display: block; margin-bottom: 8px; font-weight: 500;">Or Enter Quiz Code / ID</label>
                <input type="text" id="quiz-id-input" class="admin-form" data-i18n-placeholder="student.quizIdPlaceholder" placeholder="demo">
            </div>
            <div style="margin-top: 32px; display: flex; gap: 12px;">
                <button id="start-quiz-btn" class="btn btn-primary" data-i18n="student.startBtn" style="flex: 1; padding: 12px;">Start Quiz</button>
                <button id="back-menu-btn" class="btn" data-i18n="student.backBtn" style="flex: 1; padding: 12px;">Back</button>
            </div>
        `;
    // We reuse .admin-form input styles or add specific ones
    // Just adjusting the input class to match existing styles if possible
    const inputs = formContainer.querySelectorAll("input");
    inputs.forEach(inp => {
        inp.style.width = "100%";
        inp.style.padding = "10px";
        inp.style.borderRadius = "12px";
        inp.style.border = "1px solid #D1D5DB";
        inp.style.background = "var(--bg)";
        inp.style.color = "var(--text)";
        inp.style.marginBottom = "4px";
        inp.style.transition = "all 0.2s";
        // Add focus handler for green outline
        inp.addEventListener('focus', () => {
            inp.style.borderColor = "#06C167";
            inp.style.boxShadow = "0 0 0 2px rgba(6, 193, 103, 0.18)";
            inp.style.outline = "none";
        });
        inp.addEventListener('blur', () => {
            inp.style.borderColor = "#D1D5DB";
            inp.style.boxShadow = "none";
        });
    });
    startMenu.appendChild(formContainer);
    // Ensure translations are applied immediately after creation
    updatePageLanguage();
    // Wire up buttons
    formContainer.querySelector("#back-menu-btn").addEventListener("click", () => {
        const welcomeH1 = startMenu.querySelector('h1');
        const welcomeP = startMenu.querySelector('p');
        formContainer.style.display = "none";
        if (welcomeH1)
            welcomeH1.style.display = "block";
        if (welcomeP)
            welcomeP.style.display = "block";
        menuActions.style.display = "flex";
        isStudentMenuOpen = false;
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
            btn.style.border = "1px solid #D1D5DB";
            btn.style.borderRadius = "12px";
            btn.style.background = "#ffffff";
            btn.style.transition = "all 0.2s";
            btn.setAttribute("data-i18n", "student.premadeEnglish");
            btn.textContent = t("student.premadeEnglish");
            // Add focus handler for green outline
            btn.onfocus = () => {
                btn.style.borderColor = "#06C167";
                btn.style.boxShadow = "0 0 0 2px rgba(6, 193, 103, 0.18)";
                btn.style.outline = "none";
            };
            btn.onblur = () => {
                btn.style.borderColor = "#D1D5DB";
                btn.style.boxShadow = "none";
            };
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
            btnEn.style.border = "1px solid #D1D5DB";
            btnEn.style.borderRadius = "12px";
            btnEn.style.background = "#ffffff";
            btnEn.style.transition = "all 0.2s";
            btnEn.setAttribute("data-i18n", "student.premadeEnglish");
            btnEn.textContent = t("student.premadeEnglish");
            // Add focus handlers
            btnEn.onfocus = () => {
                btnEn.style.borderColor = "#06C167";
                btnEn.style.boxShadow = "0 0 0 2px rgba(6, 193, 103, 0.18)";
                btnEn.style.outline = "none";
            };
            btnEn.onblur = () => {
                btnEn.style.borderColor = "#D1D5DB";
                btnEn.style.boxShadow = "none";
            };
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
            btnLt.style.border = "1px solid #D1D5DB";
            btnLt.style.borderRadius = "12px";
            btnLt.style.background = "#ffffff";
            btnLt.style.transition = "all 0.2s";
            btnLt.style.marginTop = "8px";
            btnLt.setAttribute("data-i18n", "student.premadeLithuanianSoon");
            btnLt.textContent = t("student.premadeLithuanianSoon");
            // Add focus handlers
            btnLt.onfocus = () => {
                btnLt.style.borderColor = "#06C167";
                btnLt.style.boxShadow = "0 0 0 2px rgba(6, 193, 103, 0.18)";
                btnLt.style.outline = "none";
            };
            btnLt.onblur = () => {
                btnLt.style.borderColor = "#D1D5DB";
                btnLt.style.boxShadow = "none";
            };
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
