import { getTopicBundles } from "./storage.js";
import { renderTopicsPage } from "./topics.js";
import { playSound } from "./audio.js";

let isAnimating = false;
let currentQuestionIndex = 0;
let questionPool = [];

// Ghost Racer State
let playerScore = 0;
let ghostScore = 0;
const targetScore = 15; // First to 15 wins
let ghostInterval;
let gameActive = false;

// UI Elements
let playArea;
let playerBar;
let ghostBar;
let ghostMessage;

export function renderGhostRacerMode() {
    const appRoot = document.getElementById('app-root');
    
    // Compile pool of questions
    const bundles = getTopicBundles();
    questionPool = [];
    bundles.forEach(b => {
        b.questions.forEach(q => {
            questionPool.push({ ...q, _topicName: b.title });
        });
    });
    
    // Shuffle pool
    questionPool.sort(() => Math.random() - 0.5);
    
    if (questionPool.length < targetScore) {
        alert("Not enough questions for Ghost Racer!");
        return;
    }

    // Reset State
    playerScore = 0;
    ghostScore = 0;
    currentQuestionIndex = 0;
    gameActive = true;
    isAnimating = false;

    // Render Ghost UI
    appRoot.innerHTML = `
        <div id="ghost-mode-container">
            <!-- Header bars -->
            <div class="ghost-header">
                <button id="ghost-quit-btn" aria-label="Quit">✖</button>
                
                <div class="ghost-vs-bars">
                    <div class="ghost-bar-container player-side">
                        <div class="ghost-bar-label">👤 YOU (<span id="player-score-display">0</span>/${targetScore})</div>
                        <div class="ghost-bar-track">
                            <div id="player-progress" class="ghost-bar-fill player-fill"></div>
                        </div>
                    </div>
                    
                    <div class="ghost-vs-text">VS</div>
                    
                    <div class="ghost-bar-container ghost-side">
                        <div class="ghost-bar-label">👻 GHOST (<span id="ghost-score-display">0</span>/${targetScore})</div>
                        <div class="ghost-bar-track">
                            <div id="ghost-progress" class="ghost-bar-fill ghost-fill"></div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div id="ghost-play-area"></div>
        </div>
    `;

    document.getElementById('ghost-quit-btn').onclick = quitGhostMode;
    
    playerBar = document.getElementById('player-progress');
    ghostBar = document.getElementById('ghost-progress');
    playArea = document.getElementById('ghost-play-area');

    startGhostAI();
    loadNextQuestion();
}

function updateProgressUI() {
    const playerPct = (playerScore / targetScore) * 100;
    const ghostPct = (ghostScore / targetScore) * 100;
    
    playerBar.style.width = `${playerPct}%`;
    ghostBar.style.width = `${ghostPct}%`;
    
    document.getElementById('player-score-display').innerText = playerScore;
    document.getElementById('ghost-score-display').innerText = ghostScore;
}

function startGhostAI() {
    // The ghost answers randomly every 3.5 to 6.5 seconds
    const scheduleNextGhostMove = () => {
        if (!gameActive) return;
        
        const delay = Math.random() * 3000 + 3500;
        ghostInterval = setTimeout(() => {
            if (!gameActive) return;
            ghostScore++;
            updateProgressUI();
            playSound('tap');
            
            // Show a quick visual indicator that ghost scored
            const container = document.getElementById('ghost-mode-container');
            container.classList.add('ghost-flash');
            setTimeout(() => container.classList.remove('ghost-flash'), 300);

            if (ghostScore >= targetScore) {
                endGame(false);
            } else {
                scheduleNextGhostMove();
            }
        }, delay);
    };
    
    scheduleNextGhostMove();
}

function loadNextQuestion() {
    if (!gameActive) return;
    
    if (playerScore >= targetScore) {
        endGame(true);
        return;
    }
    
    isAnimating = false;
    const q = questionPool[currentQuestionIndex];
    currentQuestionIndex++;

    const isShortAnswer = q.type === 'short-answer' || (!q.choices && q.correctAnswer);
    const questionText = q.prompt || q.text || "Missing Question Text";
    
    let answersHtml = '';
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
                    <button class="ghost-ans-btn frenzy-ans-btn" data-correct="${a.isCorrect}">${a.text}</button>
                `).join('')}
            </div>
        `;
    } else {
        answersHtml = `
            <div class="frenzy-short-ans">
                <input type="text" id="ghost-sa-input" class="frenzy-sa-input" placeholder="Type your answer..." autocomplete="off">
                <button class="frenzy-sa-btn" id="ghost-sa-submit">Submit</button>
            </div>
        `;
    }

    playArea.innerHTML = `
        <div class="frenzy-topic-badge">${q._topicName}</div>
        <div class="frenzy-question-text">${questionText}</div>
        ${answersHtml}
    `;

    // Listeners
    if (isShortAnswer) {
        const submitBtn = document.getElementById('ghost-sa-submit');
        const input = document.getElementById('ghost-sa-input');
        input.focus();
        
        const doSubmit = () => {
            if (isAnimating || !input.value.trim() || !gameActive) return;
            const isCorrect = input.value.trim().toLowerCase() === q.correctAnswer.toLowerCase();
            handleAnswer(isCorrect, null);
        };
        
        submitBtn.onclick = doSubmit;
        input.onkeydown = (e) => { if (e.key === 'Enter') doSubmit(); };
    } else {
        const btns = playArea.querySelectorAll('.ghost-ans-btn');
        btns.forEach(btn => {
            btn.onclick = () => {
                if (isAnimating || !gameActive) return;
                const isCorrect = btn.getAttribute('data-correct') === 'true';
                handleAnswer(isCorrect, btn);
            };
        });
    }
}

function handleAnswer(isCorrect, btn) {
    if (isAnimating || !gameActive) return;
    isAnimating = true;

    if (btn) {
        btn.classList.add(isCorrect ? 'correct' : 'wrong');
        // Highlight correct answer if they got it wrong
        if (!isCorrect) {
            const btns = playArea.querySelectorAll('.ghost-ans-btn');
            btns.forEach(b => {
                if (b.getAttribute('data-correct') === 'true') {
                    b.classList.add('correct');
                }
            });
        }
    } else {
        const input = document.getElementById('ghost-sa-input');
        if (input) {
            input.classList.add(isCorrect ? 'correct' : 'wrong');
        }
    }

    if (isCorrect) {
        playSound('correct');
        playerScore++;
        updateProgressUI();
        
        if (playerScore >= targetScore) {
            endGame(true);
            return;
        }
        
        setTimeout(() => {
            if (gameActive) loadNextQuestion();
        }, 500);
    } else {
        playSound('wrong');
        // Penalty screen shake
        const container = document.getElementById('ghost-mode-container');
        container.classList.add('shake-penalty');
        
        setTimeout(() => {
            container.classList.remove('shake-penalty');
            if (gameActive) loadNextQuestion();
        }, 1500); // 1.5 second penalty
    }
}

function endGame(playerWon) {
    gameActive = false;
    clearTimeout(ghostInterval);
    playSound(playerWon ? 'win' : 'wrong');
    
    playArea.innerHTML = `
        <div class="ghost-end-screen fade-in">
            <h1 style="font-size: 3rem; color: ${playerWon ? '#10b981' : '#ef4444'};">
                ${playerWon ? '🏆 YOU WON!' : '👻 GHOST WINS!'}
            </h1>
            <p style="font-size: 1.5rem; margin-top: 10px; color: var(--muted);">
                Final Score: ${playerScore} to ${ghostScore}
            </p>
            <button id="ghost-retry-btn" class="frenzy-retry-btn" style="margin-top: 30px;">Play Again</button>
        </div>
    `;
    
    document.getElementById('ghost-retry-btn').onclick = renderGhostRacerMode;
}

function quitGhostMode() {
    gameActive = false;
    clearTimeout(ghostInterval);
    renderTopicsPage();
}
