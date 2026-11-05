import { getRequiredElement, escapeHtml } from "./dom.js";
import { t, getLanguage } from "./lang.js";
import { confirmDialog } from "./dialog.js";
import { getToken, fetchAttempts, fetchAttempt, deleteAttempt } from "./api.js";
let dashboardView;
let dashboardContent;
let closeBtn;
export function setupDashboard(callbacks) {
    dashboardView = getRequiredElement("dashboard-view");
    dashboardContent = getRequiredElement("dashboard-content");
    closeBtn = getRequiredElement("dashboard-close-btn");
    closeBtn.addEventListener("click", () => {
        dashboardView.style.display = "none";
        shownQuizId = null;
        callbacks.onHome();
    });
}
let shownQuizId = null;
export async function renderDashboard(quizId) {
    dashboardView.style.display = "block";
    shownQuizId = quizId || null;
    // Results are only for the quiz's owner (or an admin), checked by the server. Nobody else gets a
    // fallback: this device's history could hold other students' results on a shared classroom PC.
    if (!quizId) return renderLocked("noAccess");
    if (!getToken()) return renderLocked("signIn");
    dashboardContent.innerHTML = `<p class="no-results">${t("profile.loading")}</p>`;
    const res = await fetchAttempts(quizId);
    if (shownQuizId !== quizId) return; // another dashboard opened meanwhile
    if (res.ok) return renderServerAttempts(res.data);
    renderLocked(res.status === 401 ? "signIn" : res.status === 0 || res.status >= 500 ? "failed" : "noAccess");
}

// A signed-in change (logging in from the locked page, logging out) re-checks the open results page
document.addEventListener("quizleris-auth-changed", () => {
    if (shownQuizId && dashboardView && dashboardView.style.display !== "none") renderDashboard(shownQuizId);
});

function renderLocked(reason) {
    const body = { signIn: t("results.signInBody"), noAccess: t("results.noAccessBody"), failed: t("results.loadFailed") }[reason];
    dashboardContent.innerHTML = `
        <div class="att-locked">
            <div class="att-locked-icon" aria-hidden="true">🔒</div>
            <h3>${escapeHtml(reason === "failed" ? t("results.loadFailedTitle") : t("results.lockedTitle"))}</h3>
            <p>${escapeHtml(body)}</p>
            ${reason === "signIn" ? `<button type="button" class="btn btn-primary att-signin">${escapeHtml(t("results.signIn"))}</button>` : ""}
            ${reason === "failed" ? `<button type="button" class="btn btn-secondary att-retry">↻ ${escapeHtml(t("results.refresh"))}</button>` : ""}
        </div>`;
    dashboardContent.querySelector(".att-signin")?.addEventListener("click", () => document.dispatchEvent(new window.CustomEvent("open-auth")));
    dashboardContent.querySelector(".att-retry")?.addEventListener("click", () => renderDashboard(shownQuizId));
}

// --- Server results (the quiz's owner) ---

const percentOf = (a) => (a.max_score ? Math.round((a.score / a.max_score) * 100) : 0);
const scoreClass = (pct) => (pct >= 80 ? "good" : pct < 50 ? "bad" : "avg");
const formatDuration = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);

function renderServerAttempts({ quiz, attempts }) {
    dashboardContent.innerHTML = `
        <div class="att-head">
            <h2 class="att-title">${escapeHtml(quiz.title || quiz.id)} <span class="att-code">${escapeHtml(quiz.id)}</span></h2>
            <div class="att-stats"></div>
            <div class="att-tools">
                <input type="search" class="att-search" placeholder="${escapeHtml(t("results.search"))}" aria-label="${escapeHtml(t("results.search"))}">
                <button type="button" class="btn btn-secondary att-refresh">↻ ${t("results.refresh")}</button>
            </div>
        </div>
        <div class="att-body"></div>
    `;
    let list = attempts;
    const search = dashboardContent.querySelector(".att-search");
    const body = dashboardContent.querySelector(".att-body");

    const renderStats = () => {
        const pcts = list.map(percentOf);
        const names = new Set(list.map(a => (a.student_name || "").toLowerCase()));
        const stat = (label, value) => `<div class="att-stat"><span>${label}</span><strong>${value}</strong></div>`;
        dashboardContent.querySelector(".att-stats").innerHTML = list.length
            ? stat(t("results.attempts"), list.length) + stat(t("results.students"), names.size) +
              stat(t("results.average"), `${Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length)}%`) +
              stat(t("results.best"), `${Math.max(...pcts)}%`)
            : "";
    };
    const renderRows = () => {
        const term = search.value.trim().toLowerCase();
        const shown = term ? list.filter(a => (a.student_name || t("results.anonymous")).toLowerCase().includes(term)) : list;
        if (!list.length) {
            body.innerHTML = `<p class="no-results">${t("results.empty")}</p>`;
            return;
        }
        if (!shown.length) {
            body.innerHTML = `<p class="no-results">${t("results.noMatch")}</p>`;
            return;
        }
        body.innerHTML = `
            <div class="att-table-wrap"><table class="dashboard-table att-table">
                <thead><tr>
                    <th>${t("dashboard.date")}</th><th>${t("dashboard.name")}</th><th>${t("dashboard.score")}</th>
                    <th>${t("results.time")}</th><th><span class="sr-only">${t("dashboard.actions")}</span></th>
                </tr></thead>
                <tbody>${shown.map(a => {
                    const pct = percentOf(a);
                    const isQuit = a.status === 'quit';
                    return `<tr data-attempt="${a.id}">
                        <td>${escapeHtml(new Date(a.created_at).toLocaleString(getLanguage() === "lt" ? "lt-LT" : "en-GB", { dateStyle: "medium", timeStyle: "short" }))}</td>
                        <td>${escapeHtml(a.student_name || t("results.anonymous"))}${isQuit ? ` <span class="badge badge-quit" style="font-size:0.75rem; padding:2px 6px; border-radius:4px; background:rgba(239,68,68,0.15); color:var(--danger, #ef4444); border:1px solid rgba(239,68,68,0.3); margin-left:6px;">${escapeHtml(t("results.quitBadge"))}</span>` : ""}</td>
                        <td class="score-${scoreClass(pct)}">${a.score}/${a.max_score} (${pct}%)</td>
                        <td>${formatDuration(a.duration_seconds || 0)}</td>
                        <td class="att-actions">
                            <button type="button" class="btn btn-secondary btn-compact" data-att="details">${t("dashboard.details")}</button>
                            <button type="button" class="btn btn-secondary btn-icon btn-compact" data-att="delete" title="${t("dialog.delete")}" aria-label="${t("dialog.delete")}">🗑</button>
                        </td>
                    </tr>`;
                }).join("")}</tbody>
            </table></div>`;
    };
    const refresh = async () => {
        const res = await fetchAttempts(quiz.id);
        if (!res.ok) return;
        list = res.data.attempts;
        renderStats();
        renderRows();
    };

    search.addEventListener("input", renderRows);
    dashboardContent.querySelector(".att-refresh").addEventListener("click", refresh);
    body.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-att]");
        if (!btn) return;
        const id = btn.closest("tr").dataset.attempt;
        const attempt = list.find(a => String(a.id) === id);
        if (btn.dataset.att === "details") {
            const res = await fetchAttempt(quiz.id, id);
            if (!res.ok) return;
            const a = res.data.attempt;
            showResultDetails({
                name: a.student_name || t("results.anonymous"),
                quizTitle: quiz.title,
                date: a.created_at,
                correctCount: a.score,
                maxScore: a.max_score,
                status: a.status,
                details: Array.isArray(a.details) ? a.details : []
            });
            return;
        }
        const ok = await confirmDialog({
            title: t("results.deleteTitle"),
            message: t("results.deleteBody").replace("{name}", attempt?.student_name || t("results.anonymous")),
            confirmText: t("dialog.delete"),
            danger: true
        });
        if (!ok) return;
        const res = await deleteAttempt(quiz.id, id);
        if (!res.ok) return;
        list = list.filter(a => String(a.id) !== id);
        renderStats();
        renderRows();
    });
    renderStats();
    renderRows();
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
        ${result.status === 'quit' ? `<div style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); border-radius:6px; padding:10px 14px; margin-bottom:16px; color:var(--danger, #ef4444); font-weight:600;">⚠️ ${escapeHtml(t('results.studentQuitNotice'))}</div>` : ''}
        <p style="font-size: 1.1rem; margin-bottom: 8px;">${t('dashboard.quiz')}: <strong>${escapeHtml(result.quizTitle || result.quizId)}</strong></p>
        <p style="font-size: 1.1rem; margin-bottom: 8px;">${t('dashboard.date')}: <strong>${new Date(result.date).toLocaleString(getLanguage() === "lt" ? "lt-LT" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}</strong></p>
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
    if (r.answerText) {
        return escapeHtml(r.answerText);
    }
    if (r.type === 'true-false' && (r.answer === true || r.answer === false || r.answer === 'true' || r.answer === 'false')) {
        return escapeHtml(String(r.answer) === 'true' ? t('docx.true') : t('docx.false'));
    }
    if (Array.isArray(r.answer)) {
        return escapeHtml(r.answer.join(', '));
    }
    return escapeHtml(String(r.answer || t('quiz.noAnswer')));
}
