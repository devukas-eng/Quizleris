import { getCurrentUser, showAuthModal, logoutUser } from "./auth-ui.js";
import { fetchAllUsers, fetchProfile, deleteQuizFromCloud } from "./api.js";
import { t, getLanguage } from "./lang.js";
import { confirmDialog, alertDialog } from "./dialog.js";
import { shareStripHtml, wireCopyButtons } from "./share-links.js";
import { initGlide } from "./glide.js";

let dashboardModal = null;

export function initDashboardUI() {
    const modalHTML = `
        <div id="dashboard-modal" class="modal-overlay dash-overlay" style="display: none;">
            <div class="dash-window" role="dialog" aria-modal="true" aria-labelledby="dashboard-title">
                <div class="dash-header">
                    <h2 id="dashboard-title"></h2>
                    <button id="dashboard-logout-btn" class="btn btn-secondary dash-logout"></button>
                    <button id="dashboard-modal-close-btn" class="btn btn-secondary btn-icon dash-close" aria-label="Close">&times;</button>
                </div>
                <div id="dashboard-body" class="dash-body"></div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML("beforeend", modalHTML);
    dashboardModal = document.getElementById("dashboard-modal");

    const closeDashboard = () => { dashboardModal.style.display = "none"; };
    document.getElementById("dashboard-modal-close-btn").addEventListener("click", closeDashboard);
    dashboardModal.addEventListener("mousedown", (e) => {
        if (e.target === dashboardModal) closeDashboard();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && dashboardModal.style.display !== "none" && !document.querySelector(".app-dialog-overlay.open")) {
            closeDashboard();
        }
    });

    document.getElementById("dashboard-logout-btn").addEventListener("click", () => {
        logoutUser();
        closeDashboard();
    });

    document.addEventListener("open-dashboard", () => {
        if (!getCurrentUser()) {
            showAuthModal();
            return;
        }
        dashboardModal.style.display = "flex";
        renderDashboard();
    });
}

async function renderDashboard() {
    const body = document.getElementById("dashboard-body");
    const cachedUser = getCurrentUser();
    setHeader(cachedUser.role);
    body.innerHTML = `<p class="dash-muted">${t("profile.loading")}</p>`;

    let profile;
    try {
        profile = await fetchProfile();
    } catch (e) {
        body.innerHTML = `<div class="dash-empty"><p>${escapeHtml(t("profile.loadError"))}</p><p class="dash-muted">${escapeHtml(e.message)}</p></div>`;
        return;
    }

    const { user, limits, quizzes } = profile;
    // Role may have changed in the database since login
    cachedUser.role = user.role;
    cachedUser.subscription_tier = user.subscription_tier;
    setHeader(user.role);

    body.innerHTML = profileCard(user, limits, quizzes.length) + quizzesSection(quizzes) +
        (user.role === "admin" ? `<section class="dash-section" id="dash-admin-users"><p class="dash-muted">${t("profile.loading")}</p></section>` : "");

    wireCopyButtons(body);
    initGlide(body);
    body.querySelector("#dashboard-create-btn")?.addEventListener("click", () => openEditor());
    body.querySelectorAll("[data-edit-quiz]").forEach(btn => {
        btn.addEventListener("click", () => openEditor(btn.dataset.editQuiz));
    });
    body.querySelectorAll("[data-delete-quiz]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const ok = await confirmDialog({
                title: t("admin.deleteTitle"),
                message: `„${btn.dataset.title}“ — ${t("admin.deleteConfirm")}`,
                confirmText: t("dialog.delete"),
                danger: true
            });
            if (!ok) return;
            btn.disabled = true;
            const result = await deleteQuizFromCloud(btn.dataset.deleteQuiz);
            if (!result.success) {
                btn.disabled = false;
                await alertDialog(t("profile.loadError"), result.error);
                return;
            }
            renderDashboard();
        });
    });

    if (user.role === "admin") renderAdminUsers(body.querySelector("#dash-admin-users"));
}

function setHeader(role) {
    document.getElementById("dashboard-title").textContent = role === "admin" ? t("profile.adminTitle") : t("profile.teacherTitle");
    document.getElementById("dashboard-logout-btn").textContent = t("profile.logout");
}

function openEditor(quizId) {
    dashboardModal.style.display = "none";
    document.dispatchEvent(new window.CustomEvent("open-editor", { detail: { quizId } }));
}

function profileCard(user, limits, quizCount) {
    const isAdmin = user.role === "admin";
    const premium = isAdmin || user.premium_active;

    let planLabel = t("profile.planFree");
    let planClass = "free";
    if (isAdmin) { planLabel = t("profile.planAdmin"); planClass = "admin"; }
    else if (user.premium_active) { planLabel = t("profile.planPremium"); planClass = "premium"; }

    let validity = "—";
    if (premium) {
        validity = user.subscription_expires_at && !isAdmin ? formatDate(user.subscription_expires_at) : t("profile.noExpiry");
    } else if (user.subscription_tier === "premium" && user.subscription_expires_at) {
        validity = `${t("profile.expired")} ${formatDate(user.subscription_expires_at)}`;
    }

    const quizUsage = limits.max_quizzes == null
        ? `${quizCount} <span class="dash-muted">/ ${t("profile.unlimited").toLowerCase()}</span>`
        : `${quizCount} <span class="dash-muted">/ ${limits.max_quizzes}</span>`;
    const usagePct = limits.max_quizzes == null ? 0 : Math.min(100, Math.round((quizCount / limits.max_quizzes) * 100));
    const privatePolicy = limits.private_expiry_days == null
        ? t("profile.privateKept")
        : t("profile.privateDeleted").replace("{days}", limits.private_expiry_days);

    return `
        <section class="dash-profile">
            <div class="dash-identity">
                <div class="dash-avatar" aria-hidden="true">${escapeHtml((user.username || "?").charAt(0).toUpperCase())}</div>
                <div class="dash-identity-text">
                    <div class="dash-name">${escapeHtml(user.username)}</div>
                    <div class="dash-muted">${escapeHtml(user.email)}</div>
                </div>
                <span class="dash-plan-badge ${planClass}">${escapeHtml(planLabel)}</span>
            </div>
            <div class="dash-stats" data-glide>
                <div class="dash-stat">
                    <div class="dash-stat-label">${t("profile.validUntil")}</div>
                    <div class="dash-stat-value">${escapeHtml(validity)}</div>
                </div>
                <div class="dash-stat">
                    <div class="dash-stat-label">${t("profile.quizzes")}</div>
                    <div class="dash-stat-value">${quizUsage}</div>
                    ${limits.max_quizzes == null ? "" : `<div class="dash-meter" role="progressbar" aria-valuenow="${quizCount}" aria-valuemin="0" aria-valuemax="${limits.max_quizzes}"><span style="width: ${usagePct}%"></span></div>`}
                </div>
                <div class="dash-stat">
                    <div class="dash-stat-label">${t("profile.privateQuizzes")}</div>
                    <div class="dash-stat-value">${escapeHtml(privatePolicy)}</div>
                </div>
                <div class="dash-stat">
                    <div class="dash-stat-label">${t("profile.memberSince")}</div>
                    <div class="dash-stat-value">${escapeHtml(formatDate(user.created_at))}</div>
                </div>
            </div>
            ${premium ? "" : `<p class="dash-hint">${escapeHtml(t("profile.upgradeHint"))}</p>`}
        </section>
    `;
}

function quizzesSection(quizzes) {
    let html = `
        <section class="dash-section">
            <div class="dash-section-head">
                <h3>${t("profile.myQuizzes")}</h3>
                <button id="dashboard-create-btn" class="btn btn-primary">+ ${t("profile.createQuiz")}</button>
            </div>
    `;
    if (quizzes.length === 0) {
        html += `
            <div class="dash-empty">
                <div class="dash-empty-icon" aria-hidden="true">📝</div>
                <h4>${t("profile.emptyTitle")}</h4>
                <p class="dash-muted">${t("profile.emptyBody")}</p>
            </div>
        `;
    } else {
        html += `<div class="dash-quiz-list">`;
        quizzes.forEach(q => {
            const isPublic = q.visibility === "public";
            const expiry = q.expires_at ? ` · ${escapeHtml(t("profile.expiresOn").replace("{date}", formatDate(q.expires_at)))}` : "";
            html += `
                <div class="dash-quiz" data-glide>
                    <div class="dash-quiz-main">
                        <div class="dash-quiz-title">${escapeHtml(q.title || "—")}</div>
                        <div class="dash-quiz-meta">
                            <span class="dash-chip ${isPublic ? "public" : "private"}">${isPublic ? t("profile.public") : t("profile.private")}</span>
                            <span class="dash-muted">${t("profile.updated")} ${escapeHtml(formatDate(q.updated_at || q.created_at))}${expiry}</span>
                        </div>
                    </div>
                    <div class="dash-quiz-actions">
                        <a class="btn btn-secondary dash-results" href="/?dashboard=${encodeURIComponent(q.id)}">📊 ${t("results.open")}${q.attempts ? ` <span class="dash-count">${q.attempts}</span>` : ""}</a>
                        <button class="btn btn-secondary" data-edit-quiz="${escapeHtml(q.id)}">${t("profile.edit")}</button>
                        <button class="btn btn-secondary btn-icon dash-delete" data-delete-quiz="${escapeHtml(q.id)}" data-title="${escapeHtml(q.title || "")}" title="${t("profile.delete")}" aria-label="${t("profile.delete")}">🗑</button>
                    </div>
                    ${shareStripHtml(q)}
                </div>
            `;
        });
        html += `</div>`;
    }
    return html + `</section>`;
}

async function renderAdminUsers(container) {
    let users;
    try {
        users = await fetchAllUsers();
    } catch (e) {
        container.innerHTML = `<p class="dash-muted">${escapeHtml(e.message)}</p>`;
        return;
    }
    let html = `
        <div class="dash-section-head"><h3>${t("profile.users")} <span class="dash-muted">(${users.length})</span></h3></div>
        <div class="dash-table-wrap"><table class="dash-table">
            <thead><tr><th>${t("profile.email")}</th><th>${t("profile.username")}</th><th>${t("profile.role")}</th><th>${t("profile.plan")}</th><th>${t("profile.memberSince")}</th></tr></thead>
            <tbody>
    `;
    users.forEach(u => {
        html += `<tr>
            <td>${escapeHtml(u.email)}</td>
            <td>${escapeHtml(u.username)}</td>
            <td>${escapeHtml(u.role)}</td>
            <td><span class="dash-chip ${u.subscription_tier === "premium" ? "public" : "private"}">${escapeHtml(u.subscription_tier)}</span></td>
            <td>${escapeHtml(formatDate(u.created_at))}</td>
        </tr>`;
    });
    container.innerHTML = html + `</tbody></table></div>`;
}

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString(getLanguage() === "lt" ? "lt-LT" : "en-GB", { year: "numeric", month: "long", day: "numeric" });
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
