// Main entry point - imports and initializes all modules
import { setupAdmin, toggleAdminMode, refreshAdminUI } from "./quiz-editor.js";
import { renderStartMenu, setupMenu, renderStudentJoin, isStudentViewActive, handleStudentClick } from "./menu.js";
import { setupDashboard, renderDashboard } from "./dashboard.js";
import { loadQuiz } from "./storage.js";
import { initLanguage, setLanguage, getLanguage, updatePageLanguage } from "./lang.js";
import { renderTopicsPage } from "./topics.js";
import { initAnalytics, logEvent, hasDecidedConsent, grantConsent, revokeConsent } from "./analytics.js";

/**
 * The main application bootstrap function.
 * Orchestrates the initialization of all modules, sets up global callbacks,
 * handles initial routing via URL parameters, and wires up the language switcher.
 */
function initApp() {
    try {
        // Initialize analytics & error tracking early
        initAnalytics();

        // Initialize language system first
        initLanguage();

        // ── Apple-like Theme Picker ──────────────────────────────────
        const THEMES = [
            { value: 'emerald',    labelLt: '\u0160viesus Fonas',    labelEn: 'Light Classic' },
            { value: 'slate-dark', labelLt: 'Tamsus Fonas',         labelEn: 'Dark Mode' },
            { value: 'solar',      labelLt: 'Tamsus Fonas\u00b2',   labelEn: 'Dark Mode II' },
            { value: 'cyberpunk',  labelLt: 'Tamsus Fonas\u00b3',   labelEn: 'Dark Mode III' },
        ];

        const applyTheme = (theme) => {
            document.body.classList.remove(
                'theme-emerald', 'theme-cyberpunk', 'theme-solar',
                'theme-slate-dark', 'theme-dark-2', 'theme-dark-3'
            );
            document.body.classList.add(`theme-${theme}`);
        };

        let currentTheme = localStorage.getItem('selected_theme') || 'emerald';
        applyTheme(currentTheme);

        const themeBtn = document.getElementById('theme-btn');
        const themePopup = document.getElementById('theme-picker-popup');
        const themeBtnLabel = document.getElementById('theme-btn-label');

        function getThemeLabel(value) {
            const lang = getLanguage();
            const th = THEMES.find(t => t.value === value);
            if (!th) return value;
            return lang === 'lt' ? th.labelLt : th.labelEn;
        }

        function updateThemePickerUI(theme) {
            if (themeBtnLabel) themeBtnLabel.textContent = getThemeLabel(theme);
            document.querySelectorAll('.theme-picker-item').forEach(item => {
                item.classList.toggle('active', item.dataset.theme === theme);
            });
        }

        function setTheme(theme) {
            currentTheme = theme;
            localStorage.setItem('selected_theme', theme);
            applyTheme(theme);
            updateThemePickerUI(theme);
            logEvent('theme', 'change', { theme });
        }

        let popupOpen = false;
        function openThemePopup() {
            if (!themeBtn || !themePopup) return;
            const rect = themeBtn.getBoundingClientRect();
            themePopup.style.top = (rect.bottom + 8) + 'px';
            themePopup.style.right = (window.innerWidth - rect.right) + 'px';
            themePopup.style.left = 'auto';
            themePopup.classList.add('open');
            popupOpen = true;
        }
        function closeThemePopup() {
            if (!themePopup) return;
            themePopup.classList.remove('open');
            popupOpen = false;
        }

        if (themeBtn) {
            themeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (popupOpen) closeThemePopup();
                else openThemePopup();
            });
        }

        document.querySelectorAll('.theme-picker-item').forEach(item => {
            item.addEventListener('click', () => {
                setTheme(item.dataset.theme);
                closeThemePopup();
            });
            item.addEventListener('mouseenter', () => { applyTheme(item.dataset.theme); });
            item.addEventListener('mouseleave', () => { applyTheme(currentTheme); });
        });

        document.addEventListener('click', (e) => {
            if (popupOpen && themePopup && !themePopup.contains(e.target)) closeThemePopup();
        });

        updateThemePickerUI(currentTheme);

        const onHome = () => renderStartMenu();
        const onAdmin = () => toggleAdminMode();
        // 1. Setup Dashboard (needs onHome)
        setupDashboard({ onHome });
        // 2. Setup Menu (needs onAdmin only)
        setupMenu({ onAdmin });
        // 3. Setup Admin (needs onHome)
        setupAdmin({ onHome });
        // 4. Show Initial Screen or Dashboard if param present
        const params = new URLSearchParams(window.location.search);
        const dashParam = params.get("dashboard");
        const quizParam = params.get("quiz");
        const viewParam = params.get("view");
        const path = window.location.pathname;

        // Logo click logic
        const logo = document.getElementById('app-logo');
        if (logo) {
            logo.addEventListener('click', () => {
                const currentParams = new URLSearchParams(window.location.search);
                const isTopics = currentParams.get("view") === "topics" || path.includes("/topics");
                const isResults = !!document.getElementById("results-container");

                // Get global quiz state safely
                try {
                    const questionCounter = document.getElementById("question-counter");
                    const examNav = document.getElementById("exam-nav");
                    const quizMain = document.querySelector(".quiz-main");
                    const isQuizVisible = quizMain && quizMain.style.display !== "none";
                    const isResultVisible = !!document.getElementById("results-container");

                    // If we are in a quiz view (quiz visible, no results), or we see specific counters
                    if ((questionCounter || examNav || isQuizVisible) && !isResultVisible) {
                        // Double check we are not just on an empty container (e.g. before render)
                        // But usually if quizMain is visible and no results, we are in a quiz.
                        if (confirm("Palikti testą?")) {
                            window.location.href = "/";
                        }
                        return;
                    }
                } catch (e) { console.error(e); }

                if (isTopics || isResults) {
                    window.location.href = "/";
                } else {
                    // Default behavior (Start Menu, Dashboard, etc.) -> Reload
                    window.location.href = "/";
                }
            });


            // Global Back Button Logic (for the arrow in header)
            const quizBackBtn = document.getElementById("quiz-back-btn");
            if (quizBackBtn) {
                quizBackBtn.addEventListener("click", () => {
                    // Check if active quiz
                    const isResultVisible = !!document.getElementById("results-container");
                    // Back button usually only appears IN quiz, but let's be safe
                    if (!isResultVisible) {
                        if (confirm("Palikti testą?")) {
                            window.location.href = "/";
                        }
                    } else {
                        // If result is visible, just go home
                        window.location.href = "/";
                    }
                });
            }

            // Handle cursor style based on page
            const updateLogoCursor = () => {
                // Always clickable now
                logo.style.cursor = "pointer";
                logo.style.opacity = "1";
            };

            // Poll for changes since state isn't easily observable from here without more refactoring
            setInterval(updateLogoCursor, 500);
        }

        if (dashParam) {
            renderDashboard(dashParam);
        }
        else if (quizParam) {
            const quizData = loadQuiz();
            renderStudentJoin(quizData);
        }
        else if (viewParam === "topics" || path === "/topics" || path.endsWith("/topics")) {
            renderTopicsPage();
        }
        else {
            renderStartMenu();
        }
        // 5. Update page language
        updatePageLanguage();
        // ── Language Flag Pills ──────────────────────────────────────
        const langLtBtn = document.getElementById('lang-lt-btn');
        const langEnBtn = document.getElementById('lang-en-btn');

        function updateLangPillUI(lang) {
            if (langLtBtn) langLtBtn.classList.toggle('active', lang === 'lt');
            if (langEnBtn) langEnBtn.classList.toggle('active', lang === 'en');
            // Also update theme button labels on lang change
            updateThemePickerUI(currentTheme);
        }

        function switchLanguage(newLang) {
            setLanguage(newLang);
            updateLangPillUI(newLang);
            updatePageLanguage();
            logEvent('language', 'change', { lang: newLang });
            const currentParams = new URLSearchParams(window.location.search);
            const currentDash = currentParams.get('dashboard');
            const currentQuiz = currentParams.get('quiz');
            if (currentDash) {
                renderDashboard(currentDash);
            } else if (currentQuiz) {
                renderStudentJoin(loadQuiz());
            } else {
                if (isStudentViewActive()) handleStudentClick();
                else renderStartMenu();
            }
            try { refreshAdminUI(); } catch (e) { console.error('Admin Refresh Error', e); }
        }

        if (langLtBtn) langLtBtn.addEventListener('click', () => switchLanguage('lt'));
        if (langEnBtn) langEnBtn.addEventListener('click', () => switchLanguage('en'));

        // Init lang pill state
        updateLangPillUI(getLanguage());

        // ── Cookie Consent ───────────────────────────────────────────
        const cookieBanner = document.getElementById('cookie-banner');
        const cookieAcceptBtn = document.getElementById('cookie-accept-btn');
        const cookieDeclineBtn = document.getElementById('cookie-decline-btn');
        const cookiePrivacyLink = document.getElementById('cookie-privacy-link');

        function hideCookieBanner() {
            if (!cookieBanner) return;
            cookieBanner.classList.add('hiding');
            setTimeout(() => { cookieBanner.style.display = 'none'; }, 380);
        }

        if (cookieBanner && !hasDecidedConsent()) {
            cookieBanner.style.display = 'flex';
        }

        if (cookieAcceptBtn) {
            cookieAcceptBtn.addEventListener('click', () => {
                grantConsent();
                hideCookieBanner();
                logEvent('consent', 'granted');
            });
        }
        if (cookieDeclineBtn) {
            cookieDeclineBtn.addEventListener('click', () => {
                revokeConsent();
                hideCookieBanner();
            });
        }
        if (cookiePrivacyLink) {
            cookiePrivacyLink.addEventListener('click', () => openLegalModal('privacy'));
        }

        // ── Legal Modal ──────────────────────────────────────────────
        const legalModal = document.getElementById('legal-modal');
        const legalModalTitle = document.getElementById('legal-modal-title');
        const legalModalBody = document.getElementById('legal-modal-body');
        const legalModalClose = document.getElementById('legal-modal-close');

        function openLegalModal(type) {
            if (!legalModal) return;
            const content = getLegalContent(type, getLanguage());
            if (legalModalTitle) legalModalTitle.textContent = content.title;
            if (legalModalBody) legalModalBody.innerHTML = content.body;
            legalModal.classList.add('open');
            logEvent('legal', 'open', { type });
        }

        if (legalModalClose) {
            legalModalClose.addEventListener('click', () => {
                if (legalModal) legalModal.classList.remove('open');
            });
        }
        if (legalModal) {
            legalModal.addEventListener('click', (e) => {
                if (e.target === legalModal) legalModal.classList.remove('open');
            });
        }

        // ── Legal Footer ─────────────────────────────────────────────
        const appRoot = document.getElementById('app-root');
        if (appRoot) {
            const footer = document.createElement('div');
            footer.id = 'legal-footer';
            footer.innerHTML = `
                <button class="legal-link" id="lf-terms">Naudojimo s\u0105lygos</button>
                <span class="legal-link-sep">|</span>
                <button class="legal-link" id="lf-privacy">Privatumo politika</button>
                <span class="legal-link-sep">|</span>
                <button class="legal-link" id="lf-cookies">Slapukai</button>
                <span class="legal-link-sep">|</span>
                <span class="legal-link" style="cursor:default;opacity:0.4;">&copy; 2025 Quizleris</span>
            `;
            appRoot.appendChild(footer);
            footer.querySelector('#lf-terms')?.addEventListener('click', () => openLegalModal('terms'));
            footer.querySelector('#lf-privacy')?.addEventListener('click', () => openLegalModal('privacy'));
            footer.querySelector('#lf-cookies')?.addEventListener('click', () => openLegalModal('cookies'));
        }
    }
    catch (e) {
        alert("Application Init Error: " + e);
        console.error(e);
    }
}

// ── Legal content helper ──────────────────────────────────────────────────────
function getLegalContent(type, lang) {
    const isLt = lang === 'lt';
    const content = {
        terms: {
            title: isLt ? 'Naudojimo s\u0105lygos' : 'Terms of Service',
            body: isLt ? `
                <p>Naudodamiesi <strong>Quizleris</strong> platforma, sutinkate su šiomis naudojimo s\u0105lygomis.</p>
                <h3>1. Paslauga</h3>
                <p>Quizleris yra mokymo ir vertinimo platforma, skirta kurti ir dalyvauti testuose. Ji teikiama be joki\u0173 garantij\u0173.</p>
                <h3>2. Atsakomyb\u0117</h3>
                <p>J\u016bs atsakote u\u017e testo turin\u012f, kur\u012f \u012fkeliate. Draud\u017eiama \u012fkelti neteising\u0105, \u017eid\u017iani\u0105 ar neteist\u0105 turin\u012f.</p>
                <h3>3. Privatumas</h3>
                <p>Mes renkame minimalius anoniminius duomenis, b\u016btinus paslaugai gerinti. Daugiau informacijos rasite Privatumo politikoje.</p>
                <h3>4. Pakeitimai</h3>
                <p>Mes pasiliekame teis\u0119 keisti \u0161ias s\u0105lygas. Apie esminius pakeitimus pranerime vartotojams.</p>
            ` : `
                <p>By using <strong>Quizleris</strong>, you agree to these Terms of Service.</p>
                <h3>1. Service</h3>
                <p>Quizleris is an educational testing platform for creating and taking quizzes. It is provided without warranties of any kind.</p>
                <h3>2. Responsibility</h3>
                <p>You are responsible for the quiz content you upload. Uploading false, offensive, or illegal content is prohibited.</p>
                <h3>3. Privacy</h3>
                <p>We collect minimal anonymous data necessary to improve the service. See our Privacy Policy for more details.</p>
                <h3>4. Changes</h3>
                <p>We reserve the right to update these terms. We will notify users of significant changes.</p>
            `
        },
        privacy: {
            title: isLt ? 'Privatumo politika' : 'Privacy Policy',
            body: isLt ? `
                <p><strong>Quizleris</strong> gerbia j\u016bs\u0173 privatum\u0105.</p>
                <h3>Kokie duomenys renkami?</h3>
                <ul>
                    <li>Anoniminiai naudojimo \u012fvy\u010diai (tema, kalba, testo u\u017ebaigimas)</li>
                    <li>Technin\u0117 informacija (nar\u0161ykl\u0117s tipas, ekrano skyriai)</li>
                    <li>Rezultatai, s\u0105moningai \u012fvesti \u012f platform\u0105</li>
                </ul>
                <h3>Kaip naudojami?</h3>
                <p>Duomenys naudojami tik paslaugai gerinti. Jie n\u0117ra parduodami ar perduodami tre\u010diosioms \u0161alims.</p>
                <h3>Slapukai</h3>
                <p>Naudojame tik b\u016btinus funkcinius slapukus ir, j\u016bs\u0173 sutikimu, analitikos slapukus.</p>
                <h3>J\u016bs\u0173 teis\u0117s</h3>
                <p>Galite bet kada paklausti, kokie j\u016bs\u0173 duomenys s\u0105ugomi, ir pra\u0161yti juos i\u0161trinti.</p>
            ` : `
                <p><strong>Quizleris</strong> respects your privacy.</p>
                <h3>What data is collected?</h3>
                <ul>
                    <li>Anonymous usage events (theme, language, quiz completion)</li>
                    <li>Technical information (browser type, screen resolution)</li>
                    <li>Results you intentionally enter into the platform</li>
                </ul>
                <h3>How is it used?</h3>
                <p>Data is used solely to improve the service. It is not sold or shared with third parties.</p>
                <h3>Cookies</h3>
                <p>We use only essential functional cookies and, with your consent, analytics cookies.</p>
                <h3>Your rights</h3>
                <p>You may request at any time what data is stored about you, and ask for it to be deleted.</p>
            `
        },
        cookies: {
            title: isLt ? 'Slapuk\u0173 politika' : 'Cookie Policy',
            body: isLt ? `
                <p>\u0160iame puslapyje ai\u0161kiname, kaip naudojame slapukus.</p>
                <h3>B\u016btini slapukai</h3>
                <ul>
                    <li><strong>selected_theme</strong> &mdash; j\u016bs\u0173 pasirinkta tema</li>
                    <li><strong>quiz_language</strong> &mdash; j\u016bs\u0173 kalba</li>
                    <li><strong>quiz_*</strong> &mdash; i\u0161saugoti testai ir rezultatai</li>
                </ul>
                <h3>Analitikos slapukai (sutikimu)</h3>
                <ul>
                    <li><strong>quizleris_event_queue</strong> &mdash; anoniminiai naudojimo \u012fvy\u010diai</li>
                    <li><strong>quizleris_analytics_consent</strong> &mdash; j\u016bs\u0173 sutikimo b\u016bsena</li>
                </ul>
                <p>Galite bet kada pa\u010derinti savo sprendim\u0105 naudodamiesi slapuk\u0173 juosteliu (i\u0161kraunama puslapyje pirmam apsilankymui).</p>
            ` : `
                <p>This page explains how we use cookies.</p>
                <h3>Essential Cookies</h3>
                <ul>
                    <li><strong>selected_theme</strong> &mdash; your chosen colour theme</li>
                    <li><strong>quiz_language</strong> &mdash; your language preference</li>
                    <li><strong>quiz_*</strong> &mdash; saved quizzes and results</li>
                </ul>
                <h3>Analytics Cookies (with consent)</h3>
                <ul>
                    <li><strong>quizleris_event_queue</strong> &mdash; anonymous usage events</li>
                    <li><strong>quizleris_analytics_consent</strong> &mdash; your consent status</li>
                </ul>
                <p>You can change your mind at any time via the cookie banner (shown on first visit).</p>
            `
        }
    };
    return content[type] || content.terms;
}

// Initialize admin UI & Menu after DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
}
else {
    initApp();
}
// Global popstate handler for back/forward navigation
window.onpopstate = () => {
    // Simple routing reload
    location.reload();
};

