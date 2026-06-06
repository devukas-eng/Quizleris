import { getPlayerXP, getPlayerLevel, getXPForNextLevel } from "./storage.js";
import { playClick } from "./audio.js";

export function showProfileModal() {
    playClick();
    
    let modalRoot = document.getElementById('profile-modal-root');
    if (!modalRoot) {
        modalRoot = document.createElement('div');
        modalRoot.id = 'profile-modal-root';
        document.body.appendChild(modalRoot);
    }
    
    const xp = getPlayerXP();
    const level = getPlayerLevel(xp);
    const nextXp = getXPForNextLevel(level);
    const prevXp = level === 1 ? 0 : getXPForNextLevel(level - 1);
    
    const xpInCurrentLevel = xp - prevXp;
    const xpRequiredForNext = nextXp - prevXp;
    const progressPct = Math.min(100, Math.max(0, (xpInCurrentLevel / xpRequiredForNext) * 100));

    // Determine Rank
    let rankName = "Beginner";
    let rankIcon = "🌱";
    if (level >= 5) { rankName = "Scholar"; rankIcon = "📚"; }
    if (level >= 10) { rankName = "Quizmaster"; rankIcon = "🎓"; }
    if (level >= 20) { rankName = "Genius"; rankIcon = "🧠"; }
    if (level >= 50) { rankName = "Omniscient"; rankIcon = "👁️"; }

    modalRoot.innerHTML = `
        <div class="profile-modal-overlay">
            <div class="profile-card">
                <button id="profile-close-btn" class="profile-close">&times;</button>
                
                <div class="profile-header">
                    <div class="profile-avatar">${rankIcon}</div>
                    <div class="profile-name">Player ID: #${Math.floor(Math.random() * 9000 + 1000)}</div>
                    <div class="profile-rank">${rankName}</div>
                </div>
                
                <div class="profile-level-badge">Lv. ${level}</div>
                
                <div class="profile-xp-section">
                    <div class="profile-xp-labels">
                        <span>XP: ${xp.toLocaleString()}</span>
                        <span>Next: ${nextXp.toLocaleString()}</span>
                    </div>
                    <div class="profile-xp-bar-bg">
                        <div class="profile-xp-bar-fill" style="width: ${progressPct}%"></div>
                    </div>
                    <div class="profile-xp-detail">
                        ${xpInCurrentLevel.toLocaleString()} / ${xpRequiredForNext.toLocaleString()} to Lv. ${level + 1}
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('profile-close-btn').onclick = () => {
        playClick();
        modalRoot.innerHTML = '';
    };
}
