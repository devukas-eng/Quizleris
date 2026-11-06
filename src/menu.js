import { getRequiredElement, escapeHtml } from "./dom.js";
import { updatePageLanguage, t, getLanguage } from "./lang.js";
import { renderTopicsPage } from "./topics.js";
import { fetchShowcase } from "./api.js";
import { clearRoute } from "./url-state.js";
import { startTicker } from "./code-ticker.js";
import { } from "./legal.js";
const SHOWCASE_CACHE_KEY = "quizleris_showcase";
// DOM Elements
let startMenu;
let quizHeader;
let quizMain;
let isStudentMenuOpen = false;
let heroTicker = null;

/**
 * Bootstraps the main menu DOM references and top-level navigation buttons.
 */
export function setupMenu(_callbacks) {
    startMenu = getRequiredElement("start-menu");
    quizHeader = document.querySelector(".quiz-header");
    quizMain = document.querySelector(".quiz-main");
    document.addEventListener("quizleris-showcase-changed", () => {
        if (document.getElementById("hero-pin-hint")) initHeroShowcase();
    });
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

    // Whatever page led here, the home page's address carries no trace of it
    clearRoute();

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
        <div class="hero-section">
            <h1 class="hero-headline">${t('menu.heroHeadline')}</h1>

            <!-- PIN / Quiz ID entry -->
            <div class="pin-entry-bar">
                <input id="hero-pin-input" type="text" placeholder="${t('menu.pinPlaceholder')}" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="60" />
                <button class="pin-go-btn" id="hero-pin-go">${t('menu.pinGo')}</button>
            </div>
            <p class="hero-pin-hint" id="hero-pin-hint">${t('menu.pinHint')}</p>
        </div>
    `;

    // Wire PIN go button
    const pinInput = document.getElementById('hero-pin-input');
    const pinGoBtn = document.getElementById('hero-pin-go');
    if (pinGoBtn && pinInput) {
        const doStart = () => {
            // Codes may be typed with spaces ("K7M 3QX"); IDs never contain them
            const val = pinInput.value.trim().replace(/\s+/g, "");
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

    // Update translations
    updatePageLanguage();
    initHeroShowcase();
}

function hasCodes(data) {
    return Boolean(data?.enabled) && Array.isArray(data.quizzes) && data.quizzes.length > 0;
}

function readCachedShowcase() {
    try {
        return JSON.parse(localStorage.getItem(SHOWCASE_CACHE_KEY));
    } catch {
        return null;
    }
}

function drawShowcase(data) {
    heroTicker?.stop();
    heroTicker = null;
    const hint = document.getElementById("hero-pin-hint");
    if (!hint) return;
    if (!hasCodes(data)) {
        hint.textContent = t("menu.pinHint");
        return;
    }
    hint.innerHTML = `
        <span class="hero-hint-line">${escapeHtml(t("menu.pinHintPrefix"))}
            <button type="button" class="ct-button"></button>
        </span>`;
    const button = hint.querySelector(".ct-button");
    heroTicker = startTicker(button, {
        items: data.quizzes,
        effect: data.animStyle,
        order: data.order,
        intervalSeconds: data.intervalSeconds,
        describe: code => `${t("menu.pinHintUse")}: ${code}`,
    });
    button.addEventListener("click", () => {
        const code = heroTicker?.current()?.id;
        if (!code) return;
        if (data.action === "start") {
            isStudentMenuOpen = true;
            startStudentQuiz("", code);
            return;
        }
        const pinInput = document.getElementById("hero-pin-input");
        if (!pinInput) return;
        pinInput.value = code;
        pinInput.focus();
        pinInput.classList.remove("pin-filled-flash");
        void pinInput.offsetWidth;
        pinInput.classList.add("pin-filled-flash");
    });
}

/**
 * The codes from the last visit show at once, so the page doesn't change shape when the
 * answer arrives. It is only drawn again if the codes or their settings changed.
 */
async function initHeroShowcase() {
    const cached = readCachedShowcase();
    drawShowcase(cached);
    const data = await fetchShowcase();
    if (!data || !document.getElementById("hero-pin-hint")) return;
    if (JSON.stringify(data) === JSON.stringify(cached)) return;
    try {
        localStorage.setItem(SHOWCASE_CACHE_KEY, JSON.stringify(data));
    } catch {
        // Storage full or blocked: the codes just come a moment later next time
    }
    drawShowcase(data);
}

/** "1 klausimas", "5 klausimai", "12 klausimų" — Lithuanian has three count forms, English two. */
function questionCountLabel(n) {
    const mod10 = n % 10, mod100 = n % 100;
    let key = 'join.questionsMany';
    if (getLanguage() !== 'lt') key = n === 1 ? 'join.questionsOne' : 'join.questionsMany';
    else if (mod10 === 1 && mod100 !== 11) key = 'join.questionsOne';
    else if (mod10 >= 2 && (mod100 < 10 || mod100 >= 20)) key = 'join.questionsFew';
    return `${n} ${t(key)}`;
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

    // Time information, short enough to stay on one line
    let timeInfo = t('join.noTimer');
    if (quizToJoin.timerConfig && quizToJoin.timerConfig.mode !== "none") {
        const limit = quizToJoin.timerConfig.limitSeconds;
        if (quizToJoin.timerConfig.mode === "question") {
            timeInfo = t('join.perQuestion').replace('{s}', limit);
        }
        else {
            const min = Math.floor(limit / 60);
            const sec = limit % 60;
            const span = [min ? `${min} min` : '', sec ? `${sec} s` : ''].filter(Boolean).join(' ');
            timeInfo = t('join.wholeQuiz').replace('{time}', span);
        }
    }
    const isPreview = new URLSearchParams(window.location.search).get("preview") === "true";
    joinContainer.innerHTML = `
        <div class="join-card">
             <div style="margin-bottom: 24px;">
                <span style="background: var(--accent); color: var(--on-accent); padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px;">
                    ${t('join.joinQuiz')}
                </span>
             </div>
             <div class="join-quiz-info">
                <h2 style="font-size: 2.2rem; margin-bottom: 6px;">${escapeHtml(quizToJoin.title)}</h2>
                <p style="font-size: 1.1rem; color: var(--muted);">${questionCountLabel(quizToJoin.questions.length)} · ${escapeHtml(timeInfo)}</p>
             </div>
             
             <div class="join-input-group">
                <label for="join-student-name" class="join-label">${t('join.yourName')}</label>
                <input type="text" id="join-student-name" class="join-input" placeholder="${t('join.namePlaceholder')}">
             </div>
             
             <div class="join-actions" style="display: flex; flex-direction: column; gap: 10px;">
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
    // Auto-fill name in preview mode
    if (isPreview) {
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
import { loadQuizFromStorage } from "./storage.js";
import { initializeQuiz } from "./render.js";
async function startStudentQuiz(name, quizId) {
    quizId = quizId.trim() || "demo"; // default to demo if empty
    let quiz = await loadQuizFromStorage(quizId);
    
    if (!quiz) {
        const { alertDialog } = await import("./dialog.js");
        await alertDialog(t("menu.quizNotFoundTitle"), t("menu.quizNotFound"));
        document.getElementById("hero-pin-input")?.focus();
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
