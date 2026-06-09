import { getRequiredElement, escapeHtml } from "./dom.js";
import { getResults, getHighScores, STORAGE_KEY_RESULTS } from "./storage.js";
import { t } from "./lang.js";
let dashboardView;
let dashboardContent;
let closeBtn;
let clearBtn;
export function setupDashboard(callbacks) {
    dashboardView = getRequiredElement("dashboard-view");
    dashboardContent = getRequiredElement("dashboard-content");
    closeBtn = getRequiredElement("dashboard-close-btn");
    clearBtn = getRequiredElement("dashboard-clear-btn");
    closeBtn.addEventListener("click", () => {
        dashboardView.style.display = "none";
        callbacks.onHome();
    });
    clearBtn.addEventListener("click", () => {
        if (confirm("Are you sure you want to clear all history?")) {
            localStorage.removeItem(STORAGE_KEY_RESULTS);
            renderDashboardList();
        }
    });
}
export function renderDashboard(quizId) {
    dashboardView.style.display = "block";
    renderDashboardList(quizId);
}
function renderDashboardList(quizId) {
    const allResults = getResults();
    const results = quizId ? allResults.filter(r => r.quizId === quizId) : allResults;
    const highScores = getHighScores(allResults).filter(h => !quizId || h.quizId === quizId);
    if (results.length === 0) {
        dashboardContent.innerHTML = `<p class='no-results'>${quizId ? `${t('dashboard.noResults')}` : t('dashboard.noResults')}</p>`;
        clearBtn.disabled = true;
        return;
    }
    clearBtn.disabled = false;
    // Sort by date desc
    results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    let html = `
        <h2 style="text-align:center; margin-bottom:32px; color:var(--accent); font-size: 1.5rem;">${quizId ? escapeHtml(`${results[0]?.quizTitle || quizId}`) : t('dashboard.unified')}</h2>
        <div style="display:flex; flex-direction: column; gap:40px;">
            <div style="width: 100%;">
                <h3 style="margin-bottom:16px; color:var(--accent); font-size: 1.2rem;">${t('dashboard.recentActivity')}</h3>
                <table class="dashboard-table">
                    <thead>
                        <tr>
                            <th>${t('dashboard.date')}</th>
                            <th>${t('dashboard.name')}</th>
                            ${!quizId ? `<th>${t('dashboard.quiz')}</th>` : ''}
                            <th>${t('dashboard.score')}</th>
                            <th>${t('dashboard.actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
    `;
    results.forEach(r => {
        const dateStr = new Date(r.date).toLocaleDateString() + " " + new Date(r.date).toLocaleTimeString();
        const displayScore = (r.correctCount !== undefined) ? r.correctCount : (r.score > r.maxScore ? Math.round((r.percentage || 0) / 100 * r.maxScore) : r.score);
        const percentage = Math.round((displayScore / r.maxScore) * 100);
        const scoreClass = percentage >= 80 ? "good" : percentage < 50 ? "bad" : "avg";
        html += `
            <tr data-result-idx="${allResults.indexOf(r)}">
                <td>${dateStr}</td>
                <td>${escapeHtml(r.name)}</td>
                ${!quizId ? `<td>${escapeHtml(r.quizTitle || r.quizId)}</td>` : ''}
                <td class="score-${scoreClass}">
                    ${displayScore}/${r.maxScore} (${percentage}%)
                </td>
                <td>
                    <button class="btn btn-secondary view-details-btn" style="padding: 6px 12px; font-size: 0.85rem;">${t('dashboard.details')}</button>
                </td>
            </tr>
        `;
    });
    html += `</tbody></table></div>`;
    // High Scores Section
    html += `
            </div>
            <div style="width: 100%;">
                <h3 style="margin-bottom:16px; color:var(--success); font-size: 1.2rem;">${t('dashboard.highScores')}</h3>
                 <table class="dashboard-table">
                    <thead>
                        <tr>
                            ${!quizId ? `<th>${t('admin.quizId')}</th>` : ''}
                            <th>${t('dashboard.topStudent')}</th>
                            <th>${t('dashboard.score')}</th>
                            <th>${t('dashboard.date')}</th>
                        </tr>
                    </thead>
                    <tbody>
    `;
    highScores.forEach(h => {
        const displayScore = (h.correctCount !== undefined) ? h.correctCount : (h.score > h.maxScore ? Math.round((h.percentage || 0) / 100 * h.maxScore) : h.score);
        const percentage = Math.round((displayScore / h.maxScore) * 100);
        html += `
            <tr>
                ${!quizId ? `<td>${escapeHtml(h.quizId)}</td>` : ''}
                <td>${escapeHtml(h.name)}</td>
                <td class="score-good">${displayScore}/${h.maxScore} (${percentage}%)</td>
                <td>${new Date(h.date).toLocaleDateString()}</td>
            </tr>
         `;
    });
    html += `</tbody></table></div></div>`;
    dashboardContent.innerHTML = html;
    // After setting innerHTML, wire up Detail buttons
    dashboardContent.querySelectorAll(".view-details-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const row = e.target.closest("tr");
            const idx = parseInt(row?.dataset.resultIdx || "-1");
            if (idx >= 0) {
                showResultDetails(allResults[idx]);
            }
        });
    });
}
function showResultDetails(result) {
    const detailId = "dashboard-detail-view";
    let detailView = document.getElementById(detailId);
    if (!detailView) {
        detailView = document.createElement("div");
        detailView.id = detailId;
        detailView.className = "results-container detail-modal";
        document.body.appendChild(detailView);
    }
    detailView.style.display = "block";
    let detailsHtml = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px; padding-bottom: 15px;">
            <h2 style="margin:0; font-size: 1.5rem; color: var(--accent);">${t('dashboard.resultDetail')} ${escapeHtml(result.name)}</h2>
            <button id="close-detail-btn" class="btn btn-secondary">${t('dashboard.closeDetails')}</button>
        </div>
        <p style="font-size: 1.1rem; margin-bottom: 8px;">${t('dashboard.quiz')}: <strong>${escapeHtml(result.quizTitle || result.quizId)}</strong></p>
        <p style="font-size: 1.1rem; margin-bottom: 8px;">${t('dashboard.date')}: <strong>${new Date(result.date).toLocaleString()}</strong></p>
        <p style="font-size: 1.1rem; margin-bottom: 24px;">${t('dashboard.score')}: <strong class="text-success">${(result.correctCount !== undefined ? result.correctCount : (result.score > result.maxScore ? Math.round((result.percentage || 0) / 100 * result.maxScore) : result.score))} / ${result.maxScore}</strong></p>
        
        <div class="results-review" style="max-height: 50vh; overflow-y: auto; margin-top: 24px; padding-right: 10px;">
    `;
    if (result.details && result.details.length > 0) {
        result.details.forEach((d, idx) => {
            const timeS = Math.round(d.timeSpent / 1000);
            const isPending = d.pendingReview;
            const statusClass = d.isCorrect ? 'badge-correct' : (isPending ? 'badge-pending' : 'badge-incorrect');
            const statusText = d.isCorrect ? t('quiz.correct') : (isPending ? t('quiz.pending') : t('quiz.incorrect'));
            const statusColor = d.isCorrect ? 'var(--success)' : (isPending ? 'var(--accent)' : 'var(--danger)');
            detailsHtml += `
                <div class="result-question-item ${d.isCorrect ? '' : (isPending ? 'pending-bg' : 'incorrect-bg')}">
                    <div class="result-question-header">
                        <strong>${t('quiz.question')} ${idx + 1}</strong>
                        <span class="badge ${statusClass}" style="border-color: ${statusColor}; color: ${statusColor};">${statusText} | ${t('quiz.time')}: ${timeS}s</span>
                    </div>
                    <div class="result-question-prompt" style="font-size: 1.1rem; border-left: 3px solid var(--accent); padding-left: 12px; margin: 12px 0;">${escapeHtml(d.questionPrompt)}</div>
                    <div class="result-question-answer" style="margin-top:12px; font-size: 1rem;">
                        ${t('dashboard.selected')}: <span style="font-weight:bold; color: ${statusColor};">
                            ${formatDashboardAnswer(d)}
                        </span>
                    </div>
                </div>
            `;
        });
    }
    else {
        detailsHtml += `<p style="padding: 30px; text-align: center; color: var(--muted); font-size: 1.1rem;">${t('dashboard.noDetails')}</p>`;
    }
    detailsHtml += `</div>`;
    detailView.innerHTML = detailsHtml;
    // LaTeX
    renderMathInElement(detailView, {
        delimiters: [
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true },
        ],
    });
    document.getElementById("close-detail-btn")?.addEventListener("click", () => {
        detailView.style.display = "none";
    });
}
function formatDashboardAnswer(r) {
    if (r.type === 'image-upload' && r.answer) {
        return `<br><img src="${escapeHtml(r.answer)}" style="max-height: 150px; margin-top: 5px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);" />`;
    }
    if (Array.isArray(r.answer)) {
        return escapeHtml(r.answer.join(', '));
    }
    return escapeHtml(String(r.answer || t('quiz.noAnswer')));
}
