

import { playSound } from "./audio.js";
import { addPlayerXP } from "./storage.js";

let isAnimating = false;
let currentQuestionIndex = 0;
let questionPool = [];

// Race State
const WINNING_SCORE = 10;
let gameActive = false;
let raceIntervals = [];

// Players
let players = [];

// UI Elements
let playArea;
let leaderboardArea;

const BOT_NAMES = ["Alex", "Sam", "Jordan", "Taylor", "Casey", "Riley", "Avery", "Quinn"];

export function renderRaceMode(quizData) {
    const appRoot = document.getElementById('app-root');
    
    // Use the quiz's questions
    questionPool = quizData.questions.map(q => ({ ...q, _topicName: quizData.title }));
    
    // Shuffle pool
    questionPool.sort(() => Math.random() - 0.5);
    
    if (questionPool.length < WINNING_SCORE) {
        alert("Not enough questions for Race Mode! Need at least 10.");
        return;
    }

    // Initialize Players (1 User + 3 Bots)
    const shuffledNames = BOT_NAMES.sort(() => Math.random() - 0.5);
    const userName = localStorage.getItem("current_student_name") || "You";
    players = [
        { id: 'player', name: userName, score: 0, hearts: 3, isBot: false, color: 'var(--primary)', joined: true },
        { id: 'bot1', name: shuffledNames[0], score: 0, hearts: 3, isBot: true, color: '#ef4444', joined: false },
        { id: 'bot2', name: shuffledNames[1], score: 0, hearts: 3, isBot: true, color: '#f59e0b', joined: false },
        { id: 'bot3', name: shuffledNames[2], score: 0, hearts: 3, isBot: true, color: '#10b981', joined: false }
    ];

    // Reset State
    currentQuestionIndex = 0;
    gameActive = false; // Lobby is not active game
    isAnimating = false;
    raceIntervals.forEach(clearInterval);
    raceIntervals = [];

    // Render Race UI
    appRoot.innerHTML = `
        <div id="race-mode-container" style="display: flex; height: 100vh; background: #0f172a; color: #fff;">
            
            <!-- Left: Play Area -->
            <div id="race-play-column" style="flex: 2; padding: 40px; display: flex; flex-direction: column; justify-content: center; position: relative;">
                <button id="race-quit-btn" style="position: absolute; top: 20px; left: 20px; background: none; border: none; color: #fff; font-size: 1.5rem; cursor: pointer; opacity: 0.6; transition: 0.2s;">✖</button>
                <div id="race-play-area">
                    <div style="text-align: center;">
                        <h1 style="font-size: 3rem; color: var(--accent); margin-bottom: 20px;">Race Lobby</h1>
                        <p style="font-size: 1.2rem; color: var(--muted); margin-bottom: 40px;">Waiting for players to join...</p>
                        <div id="lobby-players" style="display: flex; gap: 20px; justify-content: center; margin-bottom: 40px;">
                            <!-- Players injected here -->
                        </div>
                        <button id="lobby-start-btn" class="frenzy-btn-primary" style="opacity: 0.5; pointer-events: none;">Start Race</button>
                    </div>
                </div>
            </div>

            <!-- Right: Leaderboard -->
            <div id="race-leaderboard-column" style="flex: 1; min-width: 300px; background: rgba(0,0,0,0.4); border-left: 1px solid rgba(255,255,255,0.05); padding: 40px 20px; display: flex; flex-direction: column; gap: 20px;">
                <h2 style="font-weight: 900; letter-spacing: 2px; text-align: center; color: var(--accent); text-shadow: 0 0 10px var(--accent); margin-bottom: 20px;">RACE TO 10</h2>
                <div id="race-leaderboard"></div>
            </div>

        </div>
    `;

    document.getElementById('race-quit-btn').onclick = quitRaceMode;
    playArea = document.getElementById('race-play-area');
    leaderboardArea = document.getElementById('race-leaderboard');

    updateLeaderboardUI();
    renderLobby();
}

function renderLobby() {
    const lobbyPlayers = document.getElementById('lobby-players');
    const startBtn = document.getElementById('lobby-start-btn');
    
    const updateLobbyUI = () => {
        lobbyPlayers.innerHTML = players.map(p => `
            <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; width: 120px; border: 2px solid ${p.joined ? p.color : 'transparent'}; opacity: ${p.joined ? 1 : 0.3}; transition: 0.3s;">
                <div style="font-size: 2rem; margin-bottom: 10px;">${p.joined ? '👤' : '⏳'}</div>
                <div style="font-weight: bold;">${p.joined ? p.name : 'Waiting...'}</div>
            </div>
        `).join('');
        
        const allJoined = players.every(p => p.joined);
        if (allJoined) {
            startBtn.style.opacity = '1';
            startBtn.style.pointerEvents = 'auto';
            startBtn.innerText = "Start Race!";
            startBtn.onclick = () => {
                gameActive = true;
                startBots();
                loadNextQuestion();
            };
        }
    };
    
    updateLobbyUI();
    
    // Simulate bots joining
    let delay = 1000;
    players.forEach((p) => {
        if (p.isBot) {
            setTimeout(() => {
                p.joined = true;
                playSound('correct');
                updateLobbyUI();
            }, delay);
            delay += Math.random() * 1500 + 500;
        }
    });
}

function updateLeaderboardUI() {
    if (!gameActive) return;

    // Sort players by score descending
    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

    leaderboardArea.innerHTML = sortedPlayers.map((p, index) => {
        const progressPct = (p.score / WINNING_SCORE) * 100;
        let heartsHtml = '';
        for (let i = 0; i < 3; i++) {
            heartsHtml += i < p.hearts ? '❤️' : '🖤';
        }
        
        const isEliminated = p.hearts <= 0;

        return `
            <div class="race-player-card" style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 15px; position: relative; opacity: ${isEliminated ? '0.4' : '1'}; transition: all 0.3s;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-weight: 800; font-size: 1.1rem;">${index === 0 ? '👑 ' : ''}${p.name}</span>
                    <span style="font-size: 0.9rem;">${heartsHtml}</span>
                </div>
                <div style="height: 12px; background: rgba(0,0,0,0.5); border-radius: 6px; overflow: hidden; position: relative;">
                    <div style="height: 100%; width: ${progressPct}%; background: ${p.color}; transition: width 0.3s ease-out; box-shadow: 0 0 10px ${p.color};"></div>
                </div>
                <div style="font-size: 0.8rem; color: var(--muted); text-align: right; margin-top: 5px;">
                    ${isEliminated ? 'ELIMINATED' : `${p.score} / ${WINNING_SCORE}`}
                </div>
            </div>
        `;
    }).join('');
}

function startBots() {
    players.forEach(p => {
        if (!p.isBot) return;

        const loop = () => {
            if (!gameActive || p.hearts <= 0 || p.score >= WINNING_SCORE) return;

            // Bots take between 2 to 7 seconds to answer
            const delay = Math.random() * 5000 + 2000;
            const timer = setTimeout(() => {
                if (!gameActive || p.hearts <= 0) return;

                // 15% chance to get it wrong
                const isWrong = Math.random() < 0.15;
                if (isWrong) {
                    p.hearts--;
                    if (p.hearts <= 0) {
                        playSound('wrong'); // Play sound if someone gets eliminated?
                    }
                } else {
                    p.score++;
                }

                updateLeaderboardUI();
                
                if (p.score >= WINNING_SCORE) {
                    endGame(p);
                } else {
                    loop(); // Schedule next move
                }
            }, delay);
            raceIntervals.push(timer);
        };
        loop();
    });
}

function loadNextQuestion() {
    if (!gameActive) return;
    const user = players.find(p => p.id === 'player');
    
    if (user.hearts <= 0) {
        playArea.innerHTML = `<h1 style="text-align:center; color:#ef4444;">ELIMINATED</h1><p style="text-align:center; color:var(--muted);">Waiting for race to finish...</p>`;
        return;
    }

    if (user.score >= WINNING_SCORE) {
        // Handled in handleAnswer, but just in case
        return;
    }
    
    isAnimating = false;
    const q = questionPool[currentQuestionIndex];
    currentQuestionIndex++;
    if (currentQuestionIndex >= questionPool.length) {
        currentQuestionIndex = 0; // Loop questions if we run out somehow
    }

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
                    <button class="race-ans-btn frenzy-ans-btn" data-correct="${a.isCorrect}">${a.text}</button>
                `).join('')}
            </div>
        `;
    } else {
        answersHtml = `
            <div class="frenzy-short-ans">
                <input type="text" id="race-sa-input" class="frenzy-sa-input" placeholder="Type your answer..." autocomplete="off">
                <button class="frenzy-sa-btn" id="race-sa-submit">Submit</button>
            </div>
        `;
    }

    playArea.innerHTML = `
        <div style="max-width: 600px; margin: 0 auto; width: 100%;">
            <div class="frenzy-topic-badge">${q._topicName}</div>
            <div class="frenzy-question-text" style="font-size: 2rem; margin: 30px 0;">${questionText}</div>
            ${answersHtml}
        </div>
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

    // Listeners
    if (isShortAnswer) {
        const submitBtn = document.getElementById('race-sa-submit');
        const input = document.getElementById('race-sa-input');
        input.focus();
        
        const doSubmit = () => {
            if (isAnimating || !input.value.trim() || !gameActive) return;
            const isCorrect = input.value.trim().toLowerCase() === q.correctAnswer.toLowerCase();
            handleAnswer(isCorrect, null);
        };
        
        submitBtn.onclick = doSubmit;
        input.onkeydown = (e) => { if (e.key === 'Enter') doSubmit(); };
    } else {
        const btns = playArea.querySelectorAll('.race-ans-btn');
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
    
    const user = players.find(p => p.id === 'player');

    if (btn) {
        btn.classList.add(isCorrect ? 'correct' : 'wrong');
        if (!isCorrect) {
            const btns = playArea.querySelectorAll('.race-ans-btn');
            btns.forEach(b => {
                if (b.getAttribute('data-correct') === 'true') {
                    b.classList.add('correct');
                }
            });
        }
    } else {
        const input = document.getElementById('race-sa-input');
        if (input) {
            input.classList.add(isCorrect ? 'correct' : 'wrong');
        }
    }

    if (isCorrect) {
        playSound('correct');
        user.score++;
        updateLeaderboardUI();
        
        if (user.score >= WINNING_SCORE) {
            endGame(user);
            return;
        }
        
        setTimeout(() => {
            if (gameActive) loadNextQuestion();
        }, 500);
    } else {
        playSound('wrong');
        user.hearts--;
        updateLeaderboardUI();

        // Penalty screen shake
        const container = document.getElementById('race-play-column');
        container.style.animation = 'none';
        container.offsetHeight; // trigger reflow
        container.style.animation = 'shake 0.5s cubic-bezier(.36,.07,.19,.97) both';
        
        if (user.hearts <= 0) {
            setTimeout(() => {
                if (gameActive) loadNextQuestion(); // Will show eliminated screen
            }, 1000);
        } else {
            // Wait out penalty
            setTimeout(() => {
                if (gameActive) loadNextQuestion();
            }, 1500);
        }
    }
}

function endGame(winner) {
    gameActive = false;
    raceIntervals.forEach(clearInterval);
    
    const userWon = winner.id === 'player';
    playSound(userWon ? 'win' : 'wrong');

    let xpMsg = '';
    if (userWon) {
        const xpEarned = 15; // fixed XP for winning a race
        const leveledUp = addPlayerXP(xpEarned);
        if (leveledUp) {
            playSound('level-up');
            xpMsg = "<div style='color:#10b981; font-weight:800; font-size:1.5rem; margin-top: 15px;'>LEVEL UP! 🎉</div>";
        } else {
            xpMsg = `<div style='color:#818cf8; font-weight:700; margin-top: 15px;'>+${xpEarned} XP</div>`;
        }
        
        if (window.confetti) {
            confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        }
    }
    
    playArea.innerHTML = `
        <div style="text-align: center; animation: fadeIn 0.5s;">
            <h1 style="font-size: 3rem; color: ${userWon ? '#10b981' : '#ef4444'}; text-shadow: 0 0 20px ${userWon ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)'};">
                ${userWon ? '🏆 YOU WON!' : `💥 ${winner.name.toUpperCase()} WINS!`}
            </h1>
            <p style="font-size: 1.5rem; margin-top: 10px; color: var(--muted);">
                ${userWon ? 'You crossed the finish line first!' : 'You didn\'t win this time.'}
            </p>
            ${xpMsg}
            <div style="margin-top: 40px; display: flex; gap: 16px; justify-content: center;">
                <button id="race-retry-btn" class="frenzy-btn-primary">Play Again</button>
                <button id="race-quit-btn-end" class="frenzy-btn-secondary">Main Menu</button>
            </div>
        </div>
    `;
    
    document.getElementById('race-retry-btn').onclick = renderRaceMode;
    document.getElementById('race-quit-btn-end').onclick = quitRaceMode;
}

function quitRaceMode() {
    gameActive = false;
    raceIntervals.forEach(clearInterval);
    window.location.href = window.location.origin + window.location.pathname; // Reload to main menu
}
