// Main entry point - imports and initializes all modules
import { setupAdmin, toggleAdminMode, refreshAdminUI } from "./quiz-editor.js";
import { renderStartMenu, setupMenu, renderStudentJoin, isStudentViewActive, handleStudentClick } from "./menu.js";
import { setupDashboard, renderDashboard } from "./dashboard.js";
import { loadQuiz } from "./storage.js";
import { initLanguage, setLanguage, getLanguage, updatePageLanguage } from "./lang.js";
import { renderTopicsPage } from "./topics.js";
/**
 * The main application bootstrap function.
 * Orchestrates the initialization of all modules, sets up global callbacks,
 * handles initial routing via URL parameters, and wires up the language switcher.
 */
function initApp() {
    try {
        // Initialize language system first
        initLanguage();
        
        // Initialize theme switching system
        const themeSelector = document.getElementById("theme-selector");
        const applyTheme = (theme) => {
            document.body.classList.remove("theme-emerald", "theme-cyberpunk", "theme-solar", "theme-slate-dark");
            document.body.classList.add(`theme-${theme}`);
        };
        if (themeSelector) {
            const savedTheme = localStorage.getItem("selected_theme") || "emerald";
            themeSelector.value = savedTheme;
            applyTheme(savedTheme);
            themeSelector.addEventListener("change", (e) => {
                const theme = e.target.value;
                localStorage.setItem("selected_theme", theme);
                applyTheme(theme);
            });
        }
        // Callbacks
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
        // 6. Wire up language toggle
        const langToggle = document.getElementById('lang-toggle');
        const langLabel = document.getElementById('lang-label');
        if (langToggle && langLabel) {
            // Set initial label
            langLabel.textContent = getLanguage().toUpperCase();
            langToggle.addEventListener('click', () => {
                const newLang = getLanguage() === 'lt' ? 'en' : 'lt';
                setLanguage(newLang);
                langLabel.textContent = newLang.toUpperCase();
                // 1. Update static elements
                updatePageLanguage();
                // 2. Re-render current dynamic view to update quiz titles etc
                const currentParams = new URLSearchParams(window.location.search);
                const currentDash = currentParams.get("dashboard");
                const currentQuiz = currentParams.get("quiz");
                if (currentDash) {
                    renderDashboard(currentDash);
                }
                else if (currentQuiz) {
                    renderStudentJoin(loadQuiz());
                }
                else {
                    if (isStudentViewActive()) {
                        handleStudentClick();
                    }
                    else {
                        renderStartMenu();
                    }
                }
                // 3. Refresh Admin UI if active
                try {
                    refreshAdminUI();
                }
                catch (e) {
                    console.error("Admin Refresh Error", e);
                }
            });
        }
    }
    catch (e) {
        alert("Application Init Error: " + e);
        console.error(e);
    }
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
    const langToggle = document.getElementById('lang-toggle');
    if (langToggle && langToggle.parentElement) {
        langToggle.parentElement.style.display = "block"; // Reset to visible
    }
    // Simple routing reload
    location.reload();
};
