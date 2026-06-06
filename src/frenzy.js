import { getTopicBundles, addPlayerXP } from "./storage.js";
import { renderStartMenu } from "./menu.js";
import { playCorrect, playWrong, playLevelUp } from "./audio.js";

// --- Game State ---
let lives = 3;
let score = 0;
let multiplier = 1;
let streak = 0;
let bestScore = parseInt(localStorage.getItem('frenzy_best_score') || '0', 10);

let questionPool = [];
let currentQuestionIndex = 0;
let fuseTimer = null;
let fuseDuration = 12000; // Start with 12 seconds per question
let fuseStartTime = 0;
let isAnimating = false;

// --- Entry Point ---
export function renderFrenzyMode() {
    // Reset state
    lives = 3;
    score = 0;
    multiplier = 1;
    streak = 0;
    fuseDuration = 15000; // 15 seconds to start
    isAnimating = false;

    // Build massive question pool
    const bundles = getTopicBundles();
    questionPool = [];
    bundles.forEach(b => {
        if (b.questions) {
            b.questions.forEach(q => {
                // Attach topic name so the player knows what subject it is
                questionPool.push({ ...q, _topicName: b.title });
            });
        }
    });

    // Shuffle pool
    questionPool.sort(() => Math.random() - 0.5);
    currentQuestionIndex = 0;

    // Setup UI
    const startMenu = document.getElementById('start-menu');
    const quizHeader = document.querySelector('.quiz-header');
    const quizMain = document.querySelector('.quiz-main');
    
    if (startMenu) startMenu.style.display = 'none';
    if (quizHeader) quizHeader.style.display = 'none';
    if (quizMain) quizMain.style.display = 'none';

    let frenzyRoot = document.getElementById('frenzy-root');
    if (!frenzyRoot) {
        frenzyRoot = document.createElement('div');
        frenzyRoot.id = 'frenzy-root';
        document.body.appendChild(frenzyRoot);
    }
    
    frenzyRoot.style.display = 'flex';
    frenzyRoot.innerHTML = ''; // clear old

    // Render skeleton
    frenzyRoot.innerHTML = `
        <div class="frenzy-container" id="frenzy-container">
            <!-- HUD -->
            <div class="frenzy-hud">
                <div class="frenzy-hud-left">
                    <button id="frenzy-exit-btn" class="frenzy-exit">✖</button>
                    <div class="frenzy-lives" id="frenzy-lives">❤️❤️❤️</div>
                </div>
                <div class="frenzy-hud-center">
                    <div class="frenzy-streak" id="frenzy-streak">Streak: 0</div>
                    <div class="frenzy-multiplier" id="frenzy-multiplier">1x</div>
                </div>
                <div class="frenzy-hud-right">
                    <div class="frenzy-score" id="frenzy-score">0</div>
                    <div class="frenzy-best">Best: ${bestScore}</div>
                </div>
            </div>

            <!-- Fuse Timer -->
            <div class="frenzy-fuse-container">
                <div class="frenzy-fuse-bar" id="frenzy-fuse-bar"></div>
            </div>

            <!-- Play Area -->
            <div class="frenzy-play-area" id="frenzy-play-area">
                <!-- Content injected here -->
            </div>
        </div>
    `;

    document.getElementById('frenzy-exit-btn').onclick = exitFrenzy;

    loadNextQuestion();
}

function loadNextQuestion() {
    if (lives <= 0) {
        gameOver();
        return;
    }
    if (currentQuestionIndex >= questionPool.length) {
        // Highly unlikely they answer all questions, but just in case
        questionPool.sort(() => Math.random() - 0.5);
        currentQuestionIndex = 0;
    }

    isAnimating = false;
    const q = questionPool[currentQuestionIndex];
    currentQuestionIndex++;

    const playArea = document.getElementById('frenzy-play-area');
    
    // Prepare answers (shuffle them)
    // Normalize question object to support different formats
    const isShortAnswer = q.type === 'short-answer' || (!q.choices && q.correctAnswer);
    const questionText = q.prompt || q.text || "Missing Question Text";
    
    // Prepare answers (shuffle them)
    let answersHtml;
    if (!isShortAnswer) {
        let answers = [];
        if (q.choices) {
            answers = [...q.choices].map(c => ({ text: c.text, isCorrect: c.isCorrect }));
        } else if (q.options) {
            answers = [...q.options].map((text, i) => ({ text, isCorrect: i === q.correctIndex }));
        }
        
        answers.sort(() => Math.random() - 0.5);
        
        answersHtml = `
            <div class="frenzy-answers-grid">
                ${answers.map((a) => `
                    <button class="frenzy-ans-btn" data-correct="${a.isCorrect}">${a.text}</button>
                `).join('')}
            </div>
        `;
    } else {
        answersHtml = `
            <div class="frenzy-short-ans">
                <input type="text" id="frenzy-sa-input" placeholder="Type your answer..." autocomplete="off">
                <button class="frenzy-sa-btn" id="frenzy-sa-submit">Submit</button>
            </div>
        `;
    }

    playArea.innerHTML = `
        <div class="frenzy-topic-badge">${q._topicName}</div>
        <div class="frenzy-question-text">${questionText}</div>
        ${answersHtml}
    `;

    if (window.renderMathInElement) {
        window.renderMathInElement(playArea, {
            delimiters: [
                { left: "$$", right: "$$", display: true },
                { left: "\\[", right: "\\]", display: true },
                { left: "\\(", right: "\\)", display: false }
            ]
        });
    }

    // Attach listeners
    if (isShortAnswer) {
        const submitBtn = document.getElementById('frenzy-sa-submit');
        const input = document.getElementById('frenzy-sa-input');
        input.focus();
        
        const doSubmit = () => {
            if (isAnimating || !input.value.trim()) return;
            const isCorrect = input.value.trim().toLowerCase() === q.correctAnswer.toLowerCase();
            handleAnswer(isCorrect, null);
        };
        
        submitBtn.onclick = doSubmit;
        input.onkeydown = (e) => { if (e.key === 'Enter') doSubmit(); };
    } else {
        const btns = playArea.querySelectorAll('.frenzy-ans-btn');
        btns.forEach(btn => {
            btn.onclick = () => {
                if (isAnimating) return;
                const isCorrect = btn.getAttribute('data-correct') === 'true';
                handleAnswer(isCorrect, btn);
            };
        });
    }

    startFuse();
}

function startFuse() {
    const bar = document.getElementById('frenzy-fuse-bar');
    if (!bar) return;
    
    // Reset bar visually instantly
    bar.style.transition = 'none';
    bar.style.width = '100%';
    
    // Force reflow
    void bar.offsetWidth;

    // Start shrink
    bar.style.transition = `width ${fuseDuration}ms linear`;
    bar.style.width = '0%';

    fuseStartTime = Date.now();
    clearTimeout(fuseTimer);
    
    fuseTimer = setTimeout(() => {
        if (!isAnimating) {
            handleAnswer(false, null); // time ran out
        }
    }, fuseDuration);
}

function stopFuse() {
    clearTimeout(fuseTimer);
    const bar = document.getElementById('frenzy-fuse-bar');
    if (bar) {
        // Freeze bar where it is
        const elapsed = Date.now() - fuseStartTime;
        const remainingPct = Math.max(0, 100 - (elapsed / fuseDuration) * 100);
        bar.style.transition = 'none';
        bar.style.width = `${remainingPct}%`;
    }
}

function handleAnswer(isCorrect, clickedBtn) {
    isAnimating = true;
    stopFuse();

    const container = document.getElementById('frenzy-container');

    if (isCorrect) {
        // Visuals
        if (clickedBtn) clickedBtn.classList.add('correct');
        container.classList.add('flash-green');
        
        // Confetti!
        if (window.confetti) {
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 },
                colors: ['#34d399', '#10b981', '#ffffff']
            });
        }
        
        playCorrect(multiplier);

        // Logic
        streak++;
        score += (100 * multiplier);
        if (streak % 3 === 0 && multiplier < 10) multiplier++; // Max 10x multiplier
        
        // Speed up timer slightly (min 4 seconds)
        fuseDuration = Math.max(4000, fuseDuration - 500);

    } else {
        // Visuals
        if (clickedBtn) clickedBtn.classList.add('wrong');
        container.classList.add('flash-red');
        container.classList.add('shake');
        
        playWrong();
        
        // Highlight correct answer if MC
        const playArea = document.getElementById('frenzy-play-area');
        if (playArea) {
            const btns = playArea.querySelectorAll('.frenzy-ans-btn');
            btns.forEach(b => {
                if (b.getAttribute('data-correct') === 'true') {
                    b.classList.add('correct');
                }
            });
        }

        // Logic
        lives--;
        streak = 0;
        multiplier = 1;
        fuseDuration = Math.min(15000, fuseDuration + 2000); // Give them a bit more time next round
    }

    updateHUD();

    setTimeout(() => {
        container.classList.remove('flash-green', 'flash-red', 'shake');
        loadNextQuestion();
    }, 1200);
}

function updateHUD() {
    const livesEl = document.getElementById('frenzy-lives');
    const scoreEl = document.getElementById('frenzy-score');
    const multiEl = document.getElementById('frenzy-multiplier');
    const streakEl = document.getElementById('frenzy-streak');

    if (livesEl) {
        let h = '';
        for(let i=0; i<3; i++) h += (i < lives) ? '❤️' : '🖤';
        livesEl.innerHTML = h;
    }
    
    if (scoreEl) {
        scoreEl.innerText = score.toLocaleString();
    }
    
    if (multiEl) {
        multiEl.innerText = `${multiplier}x`;
        multiEl.className = 'frenzy-multiplier';
        if (multiplier >= 5) multiEl.classList.add('fire');
        else if (multiplier >= 3) multiEl.classList.add('hot');
    }

    if (streakEl) {
        streakEl.innerText = `Streak: ${streak}`;
    }
}

function gameOver() {
    clearTimeout(fuseTimer);
    
    // XP Calculation
    const xpEarned = Math.floor(score / 50); // E.g. 500 score = 10 XP
    let levelUpMsg = "";
    if (xpEarned > 0) {
        const leveledUp = addPlayerXP(xpEarned);
        if (leveledUp) {
            playLevelUp();
            levelUpMsg = "<div style='color:#10b981; font-weight:800; font-size:1.5rem; margin-bottom: 20px;'>LEVEL UP! 🎉</div>";
        } else {
            levelUpMsg = `<div style='color:#818cf8; font-weight:700; margin-bottom: 20px;'>+${xpEarned} XP</div>`;
        }
    }
    
    // Check High Score
    const isNewBest = score > bestScore;
    if (isNewBest) {
        bestScore = score;
        localStorage.setItem('frenzy_best_score', bestScore);
        if (window.confetti) {
            const duration = 3000;
            const end = Date.now() + duration;
            (function frame() {
                confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 } });
                confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 } });
                if (Date.now() < end) requestAnimationFrame(frame);
            }());
        }
    }

    const frenzyRoot = document.getElementById('frenzy-root');
    frenzyRoot.innerHTML = `
        <div class="frenzy-gameover-container">
            <h1 class="frenzy-go-title">GAME OVER</h1>
            <div class="frenzy-go-score">${score.toLocaleString()}</div>
            ${levelUpMsg}
            <div class="frenzy-go-subtitle">${isNewBest ? '🎉 NEW HIGH SCORE! 🎉' : `Best Score: ${bestScore}`}</div>
            
            <div class="frenzy-go-actions">
                <button class="frenzy-btn-primary" id="frenzy-restart">Play Again</button>
                <button class="frenzy-btn-secondary" id="frenzy-quit">Main Menu</button>
            </div>
        </div>
    `;

    document.getElementById('frenzy-restart').onclick = renderFrenzyMode;
    document.getElementById('frenzy-quit').onclick = exitFrenzy;
}

function exitFrenzy() {
    clearTimeout(fuseTimer);
    const frenzyRoot = document.getElementById('frenzy-root');
    if (frenzyRoot) {
        frenzyRoot.style.display = 'none';
        frenzyRoot.innerHTML = '';
    }
    renderStartMenu();
}
