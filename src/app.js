// Main entry point - imports and initializes all modules
import { setupAdmin, toggleAdminMode, refreshAdminUI } from "./quiz-editor.js";
import { renderStartMenu, setupMenu, renderStudentJoin } from "./menu.js";
import { setupDashboard, renderDashboard } from "./dashboard.js";
import { loadQuiz } from "./storage.js";
import { initLanguage, setLanguage, getLanguage, updatePageLanguage } from "./lang.js";
import { renderTopicsPage } from "./topics.js";
import { initAuthUI } from "./auth-ui.js";
import { initDashboardUI } from "./dashboard-ui.js";
import { initAnalytics, logEvent, hasDecidedConsent, grantConsent, revokeConsent } from "./analytics.js";
import { syncCloudQuizzes } from "./sync.js";

/**
 * The main application bootstrap function.
 * Orchestrates the initialization of all modules, sets up global callbacks,
 * handles initial routing via URL parameters, and wires up the language switcher.
 */
async function initApp() {
    try {
        // Initialize analytics & error tracking early
        initAnalytics();
        initAuthUI();
        initDashboardUI();

        // Initialize language system first
        initLanguage();
        
        // Background sync quizzes from cloud
        syncCloudQuizzes();

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

        window.addEventListener('click', () => {
            if (popupOpen) closeThemePopup();
        });
        updateThemePickerUI(currentTheme);

        // --- Core App Callbacks ---
        // Register callbacks from menu.js to setupDashboard / setupAdmin

        const onHome = () => renderStartMenu();
        const onAdmin = () => toggleAdminMode();
        // 1. Setup Dashboard (needs onHome)
        setupDashboard({ onHome });
        document.addEventListener("open-editor", () => { toggleAdminMode(); });
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
            const quizData = await loadQuiz();
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

        async function switchLanguage(newLang) {
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
                renderStudentJoin(await loadQuiz());
            } else if (window.location.pathname.includes('/topics')) {
                renderTopicsPage();
            } else {
                renderStartMenu();
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
    const email = 'eblogsmod@gmail.com';
    const content = {
        terms: {
            title: isLt ? 'Naudojimo sąlygos' : 'Terms of Service',
            body: isLt ? `
                <p><strong>1. Bendrosios nuostatos</strong></p>
                <p>Naudodamiesi <strong>Quizleris</strong> platforma, Jūs patvirtinate, kad sutinkate su šiomis išsamiomis naudojimo sąlygomis. Šios sąlygos taikomos visiems vartotojams, neatsižvelgiant į tai, ar esate registruotas vartotojas, ar svečias.</p>
                
                <p><strong>2. Paslaugos teikimas ir prieinamumas</strong></p>
                <p>Quizleris yra mokymo, testavimo ir interaktyvaus mokymosi platforma. Mes dedame visas pastangas, kad užtikrintume nenutrūkstamą paslaugos veikimą, tačiau platforma teikiama "tokia, kokia yra" (angl. "as is"). Mes negarantuojame, kad paslauga veiks be klaidų ar pertraukimų.</p>
                
                <p><strong>3. Vartotojų atsakomybė ir turinys</strong></p>
                <p>Jūs esate visiškai atsakingas už visą turinį (klausimus, atsakymus, testus), kurį sukuriate ar įkeliate į Quizleris. Griežtai draudžiama įkelti neteisėtą, autorių teises pažeidžiantį, įžeidžiantį, diskriminuojantį ar kitaip žalingą turinį. Mes pasiliekame teisę be išankstinio įspėjimo pašalinti bet kokį turinį, pažeidžiantį šias taisykles.</p>
                
                <p><strong>4. Intelektinė nuosavybė</strong></p>
                <p>Visi platformos dizaino elementai, kodas, grafika ir prekės ženklai yra išskirtinė Quizleris nuosavybė. Jūs negalite kopijuoti, platinti ar modifikuoti mūsų platformos kodo ar dizaino elementų be išankstinio rašytinio sutikimo.</p>
                
                <p><strong>5. Susisiekite su mumis</strong></p>
                <p>Jei turite klausimų dėl šių sąlygų, pažeidimų ar norite pranešti apie netinkamą turinį, prašome susisiekti su mumis el. paštu: <strong>${email}</strong>.</p>
            ` : `
                <p><strong>1. General Provisions</strong></p>
                <p>By accessing and using the <strong>Quizleris</strong> platform, you acknowledge and agree to be bound by these comprehensive Terms of Service. These terms apply to all users, whether registered or visiting as guests.</p>
                
                <p><strong>2. Service Provision and Availability</strong></p>
                <p>Quizleris is an educational, testing, and interactive learning platform. While we strive for maximum uptime and reliability, the service is provided on an "as is" and "as available" basis without any warranties. We do not guarantee uninterrupted or error-free operation.</p>
                
                <p><strong>3. User Responsibility and Content</strong></p>
                <p>You are solely responsible for any content (quizzes, questions, answers) you create, upload, or share on Quizleris. It is strictly prohibited to upload content that is illegal, infringes on intellectual property rights, or is offensive, discriminatory, or malicious. We reserve the right to remove any violating content without prior notice.</p>
                
                <p><strong>4. Intellectual Property</strong></p>
                <p>All platform design elements, source code, graphics, and trademarks are the exclusive property of Quizleris. You may not copy, distribute, or modify any part of our platform without explicit prior written consent.</p>
                
                <p><strong>5. Contact Information</strong></p>
                <p>For questions regarding these Terms, reporting violations, or general inquiries, please contact us at: <strong>${email}</strong>.</p>
            `
        },
        privacy: {
            title: isLt ? 'Privatumo politika' : 'Privacy Policy',
            body: isLt ? `
                <p><strong>1. Įvadas</strong></p>
                <p>Jūsų privatumas mums yra nepaprastai svarbus. Šioje Privatumo politikoje išsamiai paaiškinama, kokią informaciją <strong>Quizleris</strong> renka, kaip ją naudoja, saugo ir atskleidžia.</p>
                
                <p><strong>2. Kokie duomenys renkami?</strong></p>
                <ul>
                    <li><strong>Techninė ir naudojimo informacija:</strong> Renkame anoniminius analitikos duomenis, tokius kaip jūsų naršyklės tipas, įrenginio operacinė sistema, pasirinkta kalba, temos nustatymai, ir sąveika su testais.</li>
                    <li><strong>Vartotojo pateikti duomenys:</strong> Duomenys, kuriuos savanoriškai įvedate, pavyzdžiui, slapyvardžiai, testų atsakymai bei sukurto turinio informacija.</li>
                </ul>
                
                <p><strong>3. Kaip naudojame jūsų duomenis?</strong></p>
                <p>Surinkta informacija yra naudojama tik teikti, tobulinti ir apsaugoti mūsų paslaugas. Analizuojame naudojimo tendencijas, kad galėtume optimizuoti vartotojo sąsają ir užtikrinti sklandų veikimą. Jūsų duomenys nėra parduodami ar be pagrindo perduodami trečiosioms šalims.</p>
                
                <p><strong>4. Duomenų saugumas ir saugojimas</strong></p>
                <p>Mes taikome pažangias technines ir organizacines saugumo priemones, siekdami apsaugoti jūsų duomenis nuo neteisėtos prieigos, praradimo ar sunaikinimo. Dauguma jūsų asmeninių nustatymų saugoma tiesiogiai jūsų įrenginyje (Local Storage).</p>
                
                <p><strong>5. Jūsų teisės ir duomenų ištrynimas</strong></p>
                <p>Jūs turite teisę žinoti, kokius duomenis mes tvarkome, reikalauti juos ištaisyti arba ištrinti. Dėl paskyros, duomenų ištrynimo ar bet kokių kitų privatumo klausimų kreipkitės: <strong>${email}</strong>.</p>
            ` : `
                <p><strong>1. Introduction</strong></p>
                <p>Your privacy is of utmost importance to us. This Privacy Policy outlines in detail how <strong>Quizleris</strong> collects, uses, stores, and protects your information.</p>
                
                <p><strong>2. What Data We Collect</strong></p>
                <ul>
                    <li><strong>Technical and Usage Information:</strong> We collect anonymous analytics data such as your browser type, device OS, language preferences, theme settings, and interactions with our quizzes.</li>
                    <li><strong>User-Provided Data:</strong> Any information you voluntarily enter into the platform, including nicknames, quiz answers, and custom quiz content.</li>
                </ul>
                
                <p><strong>3. How We Use Your Data</strong></p>
                <p>The information we collect is used exclusively to provide, maintain, and improve our services. We analyze usage trends to optimize the user experience and ensure platform stability. We do not sell your personal data or share it with unauthorized third parties.</p>
                
                <p><strong>4. Data Security and Retention</strong></p>
                <p>We implement robust technical and organizational security measures to protect your data against unauthorized access, alteration, or destruction. Much of your personalized data is stored directly on your device (Local Storage).</p>
                
                <p><strong>5. Your Rights and Data Deletion</strong></p>
                <p>You have the right to access, rectify, or request the deletion of your data. For data deletion requests, account inquiries, or any privacy-related matters, please contact our support at: <strong>${email}</strong>.</p>
            `
        },
        cookies: {
            title: isLt ? 'Slapukų politika' : 'Cookie Policy',
            body: isLt ? `
                <p><strong>1. Kas yra slapukai?</strong></p>
                <p>Slapukai (angl. cookies) yra nedideli tekstiniai failai ar informacijos fragmentai (pvz., Local Storage), kurie išsaugomi jūsų naršyklėje ar įrenginyje, kai lankotės <strong>Quizleris</strong> svetainėje.</p>
                
                <p><strong>2. Būtini (Funkciniai) slapukai</strong></p>
                <p>Šie failai yra absoliučiai būtini tam, kad svetainė veiktų tinkamai. Jų išjungti mūsų sistemose negalima:</p>
                <ul>
                    <li><strong>selected_theme</strong> &mdash; Išsaugo jūsų pasirinktą vizualinę temą (pvz., tamsų ar šviesų foną).</li>
                    <li><strong>quiz_language</strong> &mdash; Išsaugo jūsų kalbos nustatymus.</li>
                    <li><strong>quiz_*</strong> &mdash; Vietinėje atmintyje išsaugoti testai, juodraščiai ir jūsų progresas.</li>
                </ul>
                
                <p><strong>3. Analitikos slapukai (tik su jūsų sutikimu)</strong></p>
                <p>Mes naudojame analitikos įrankius, kad suprastume, kaip vartotojai naudojasi platforma. Šie slapukai renkami tik jei duodate sutikimą Cookie sutikimo juostoje:</p>
                <ul>
                    <li><strong>quizleris_event_queue</strong> &mdash; Kaupia anoniminius navigacijos ir naudojimo įvykius statistikai.</li>
                    <li><strong>quizleris_analytics_consent</strong> &mdash; Išsaugo jūsų sutikimo arba atsisakymo būseną, kad nereikėtų klausti kiekvieną kartą.</li>
                </ul>
                
                <p><strong>4. Slapukų valdymas</strong></p>
                <p>Jūs galite bet kada pakeisti savo sutikimo nustatymus arba išvalyti naršyklės Local Storage. Jei turite klausimų dėl mūsų slapukų naudojimo, susisiekite su mumis el. paštu: <strong>${email}</strong>.</p>
            ` : `
                <p><strong>1. What are Cookies?</strong></p>
                <p>Cookies and similar storage technologies (like Local Storage) are small pieces of data saved on your browser or device when you visit the <strong>Quizleris</strong> website.</p>
                
                <p><strong>2. Essential (Functional) Cookies</strong></p>
                <p>These are strictly necessary for the website to function correctly and cannot be disabled in our systems:</p>
                <ul>
                    <li><strong>selected_theme</strong> &mdash; Remembers your chosen visual theme (e.g., dark or light mode).</li>
                    <li><strong>quiz_language</strong> &mdash; Stores your preferred language setting.</li>
                    <li><strong>quiz_*</strong> &mdash; Locally stores your custom quizzes, drafts, and progress.</li>
                </ul>
                
                <p><strong>3. Analytics Cookies (Consent Required)</strong></p>
                <p>We use analytics tools to understand how our platform is used. These are only activated if you provide consent via the Cookie banner:</p>
                <ul>
                    <li><strong>quizleris_event_queue</strong> &mdash; Collects anonymous navigation and usage events for statistical analysis.</li>
                    <li><strong>quizleris_analytics_consent</strong> &mdash; Remembers your consent choice so you are not prompted repeatedly.</li>
                </ul>
                
                <p><strong>4. Managing Cookies</strong></p>
                <p>You can manage your consent preferences or clear your browser's Local Storage at any time. If you have any questions regarding our cookie practices, please contact us at: <strong>${email}</strong>.</p>
            `
        }
    };
    
    return content[type] || content.terms;
}

// Initialize admin UI & Menu after DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", async () => {
        await loadQuiz();
        initApp();
    });
}
else {
    initApp();
}
// Global popstate handler for back/forward navigation
window.onpopstate = () => {
    // Simple routing reload
    location.reload();
};
