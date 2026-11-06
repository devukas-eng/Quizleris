import { getCurrentUser, showAuthModal, logoutUser } from "./auth-ui.js";
import {
    fetchAllUsers,
    fetchProfile,
    deleteQuizFromCloud,
    fetchInvites,
    createInvites,
    deleteInvite,
    fetchAdminOverview,
    updateAdminUser,
    deleteAdminUser,
} from "./api.js";
import {
    fetchMeta as fetchBankMeta,
    listItems as listBankItems,
    loadItems as loadBankItems,
    forgetItems as forgetBankItems,
    updateItems as updateBankItems,
    updateItem as updateBankItem,
    archiveItems as archiveBankItems,
    decideSubmission as decideBankSubmission,
    closeReports as closeBankReports,
} from "./bank-api.js";
import { t, getLanguage } from "./lang.js";
import { confirmDialog, alertDialog } from "./dialog.js";
import { shareStripHtml, wireCopyButtons } from "./share-links.js";
import { initGlide } from "./glide.js";
import { skeletonHtml } from "./dom.js";
import { renderQuizBrowser } from "./admin-quiz-browser.js";
import { renderShowcase, stopShowcase } from "./admin-showcase.js";

let dashboardModal = null;
let activeAdminTab = "overview";

// Cached admin state for fast tab switching within a session
let adminState = {
    profile: null,
    overview: null,
    users: null,
    bankMeta: null,
    userSearch: "",
    userRoleFilter: "all",
    bankFilter: {
        q: "",
        subject: "",
        grade: "",
        topic: "",
        difficulty: "",
        sort: "new",
    },
};

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

    const closeDashboard = () => {
        stopShowcase();
        dashboardModal.style.display = "none";
    };
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

    // Results open inside the app, and their back button returns here. Opening one in a new tab
    // (Ctrl/Cmd-click, middle click) still works as a plain link, and so does one clicked during a
    // quiz: loading the page is what ends that quiz and records the attempt.
    dashboardModal.addEventListener("click", (e) => {
        const link = e.target.closest("a.dash-results");
        if (!link || e.ctrlKey || e.metaKey || e.shiftKey || document.body.classList.contains("quiz-page")) return;
        e.preventDefault();
        closeDashboard();
        const quizId = new URL(link.href).searchParams.get("dashboard");
        document.dispatchEvent(new window.CustomEvent("open-results", { detail: { quizId } }));
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

    // An admin coming back finds the page as it was while it refreshes; otherwise placeholders
    // hold the window's shape until the data is in
    const returning = cachedUser.role === "admin" && adminState.profile;
    if (returning) renderAdminWorkspace(body);
    else body.innerHTML = skeletonHtml(6);

    const overviewRequest = cachedUser.role === "admin" ? fetchAdminOverview().catch(() => null) : null;
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

    if (user.role === "admin") {
        adminState.profile = profile;
        adminState.users = null;
        adminState.overview = (await (overviewRequest || fetchAdminOverview().catch(() => null))) ?? adminState.overview;
        if (!returning || ["overview", "analytics", "mine"].includes(activeAdminTab)) renderAdminWorkspace(body);
        else updateAdminTabBadges();
        return;
    }

    body.innerHTML = profileCard(user, limits, quizzes.length) + quizzesSection(quizzes);
    wireQuizCardEvents(body);
}

function wireQuizCardEvents(container, onDeleted = renderDashboard) {
    wireCopyButtons(container);
    initGlide(container);
    container.querySelector("#dashboard-create-btn")?.addEventListener("click", createQuiz);
    container.querySelectorAll("[data-edit-quiz]").forEach(btn => {
        btn.addEventListener("click", () => openEditor(btn.dataset.editQuiz));
    });
    container.querySelectorAll("[data-delete-quiz]").forEach(btn => {
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
            document.dispatchEvent(new window.CustomEvent("quizleris-showcase-changed"));
            onDeleted();
        });
    });
}

function setHeader(role) {
    const win = dashboardModal?.querySelector(".dash-window");
    if (win) win.classList.toggle("is-admin", role === "admin");

    document.getElementById("dashboard-title").textContent = role === "admin" ? t("profile.adminTitle")
        : role === "creator" ? t("profile.creatorTitle") : t("profile.teacherTitle");
    document.getElementById("dashboard-logout-btn").textContent = t("profile.logout");
}

// --- Admin Multi-Tab Workspace ---

function switchAdminTab(tab) {
    stopShowcase();
    activeAdminTab = tab;
    const body = document.getElementById("dashboard-body");
    if (body && adminState.profile) {
        renderAdminWorkspace(body);
    }
}

function renderAdminWorkspace(body) {
    const ov = adminState.overview;
    const tabs = [
        { id: "overview", icon: "📊", label: t("adminGui.tabOverview"), badge: null },
        { id: "analytics", icon: "📈", label: t("adminGui.tabAnalytics"), badge: null },
        { id: "approvals", icon: "⏳", label: t("adminGui.tabApprovals"), badge: ov?.bank?.pendingReview ?? 0 },
        { id: "reports", icon: "🚩", label: t("adminGui.tabReports"), badge: ov?.bank?.openReports ?? 0 },
        { id: "bank", icon: "📚", label: t("adminGui.tabBank"), badge: ov?.bank?.published ?? null },
        { id: "quizzes", icon: "🗂", label: t("adminGui.tabAllQuizzes"), badge: ov?.quizzes?.total ?? null },
        { id: "showcase", icon: "✨", label: t("adminGui.tabShowcase"), badge: ov?.quizzes?.featured ?? null },
        { id: "users", icon: "👥", label: t("adminGui.tabUsers"), badge: ov?.users?.total ?? null },
        { id: "invites", icon: "🔑", label: t("adminGui.tabInvites"), badge: null },
        { id: "mine", icon: "📝", label: t("adminGui.tabMyQuizzes"), badge: adminState.profile?.quizzes?.length ?? null },
    ];

    stopShowcase();
    body.innerHTML = `
        <nav class="dash-admin-tabs" role="tablist" aria-label="${escapeHtml(t("profile.adminTitle"))}">
            ${tabs.map(tab => `
                <button type="button" role="tab" class="dash-admin-tab${activeAdminTab === tab.id ? " is-active" : ""}" aria-selected="${activeAdminTab === tab.id}" data-admin-tab="${tab.id}">
                    <span class="dash-admin-tab-icon" aria-hidden="true">${tab.icon}</span>
                    <span>${escapeHtml(tab.label)}</span>
                    ${tab.badge != null ? `<span class="dash-admin-tab-badge">${escapeHtml(tab.badge)}</span>` : ""}
                </button>
            `).join("")}
        </nav>
        <div id="dash-admin-panel" class="dash-admin-panel"></div>
    `;

    body.querySelectorAll("[data-admin-tab]").forEach(btn => {
        btn.addEventListener("click", () => switchAdminTab(btn.dataset.adminTab));
    });

    const panel = body.querySelector("#dash-admin-panel");
    if (activeAdminTab === "overview") renderAdminOverviewTab(panel);
    else if (activeAdminTab === "analytics") renderAdminAnalyticsTab(panel);
    else if (activeAdminTab === "approvals") renderAdminApprovalsTab(panel);
    else if (activeAdminTab === "reports") renderAdminReportsTab(panel);
    else if (activeAdminTab === "bank") renderAdminBankTab(panel);
    else if (activeAdminTab === "mine") renderAdminMyQuizzesTab(panel);
    else if (activeAdminTab === "quizzes") renderQuizBrowser(panel, {
        wireCards: wireQuizCardEvents,
        createQuiz,
        formatDate,
        onCountsChange: refreshOverviewBadges,
    });
    else if (activeAdminTab === "showcase") renderShowcase(panel, {
        settings: adminState.overview?.showcase,
        onSaved(showcase) {
            if (!adminState.overview) adminState.overview = {};
            adminState.overview.showcase = showcase;
            refreshOverviewBadges();
        },
    });
    else if (activeAdminTab === "users") renderAdminUsers(panel);
    else if (activeAdminTab === "invites") {
        panel.innerHTML = `<section class="dash-section dash-invites" id="dash-invites"></section>`;
        const sec = panel.querySelector("#dash-invites");
        buildInvites(sec);
        loadInvites(sec);
    }
}

function formatDurationSec(sec) {
    if (!sec || sec <= 0) return "—";
    const s = Math.round(sec);
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function formatDelta(n) {
    const v = Number(n || 0);
    return v > 0 ? `+${v}` : (v === 0 ? "+0" : `${v}`);
}

function formatStorageBytes(bytes) {
    const b = Number(bytes || 0);
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

function renderAdminOverviewTab(panel) {
    const { user, limits, quizzes } = adminState.profile;
    const ov = adminState.overview;
    const an = ov?.analytics || {};

    const uTotal = ov?.users?.total ?? "—";
    const uSub = ov
        ? t("adminGui.staffAndPremium")
            .replace("{p}", ov.users.premium)
            .replace("{c}", ov.users.creators)
            .replace("{a}", ov.users.admins)
        : "";

    const qTotal = ov?.quizzes?.total ?? "—";
    const qSub = ov
        ? t("adminGui.quizzesBreakdown")
            .replace("{pub}", ov.quizzes.publicCount ?? ov.quizzes.public ?? 0)
            .replace("{priv}", ov.quizzes.privateCount ?? ov.quizzes.private ?? 0)
            .replace("{feat}", ov.quizzes.featured ?? 0)
        : "";

    const aTotal = ov?.quizzes?.attempts ?? "—";
    const bTotal = ov?.bank?.published ?? "—";
    const bSub = ov
        ? t("adminGui.bankBreakdown")
            .replace("{pub}", ov.bank.published)
            .replace("{rev}", ov.bank.pendingReview)
            .replace("{flag}", ov.bank.openReports)
        : "";

    panel.innerHTML = `
        <section class="dash-section">
            <div class="dash-section-head"><h3>${escapeHtml(t("adminGui.systemOverview"))}</h3></div>
            <div class="dash-overview-grid" data-glide>
                <button type="button" class="dash-overview-card is-clickable" data-jump-tab="users">
                    <div class="dash-overview-label">👥 ${escapeHtml(t("adminGui.totalUsers"))}</div>
                    <div class="dash-overview-val">${escapeHtml(uTotal)}</div>
                    <div class="dash-overview-sub">${escapeHtml(uSub)}</div>
                </button>
                <button type="button" class="dash-overview-card is-clickable" data-jump-tab="quizzes">
                    <div class="dash-overview-label">🗂 ${escapeHtml(t("adminGui.totalQuizzes"))}</div>
                    <div class="dash-overview-val">${escapeHtml(qTotal)}</div>
                    <div class="dash-overview-sub">${escapeHtml(qSub)}</div>
                </button>
                <button type="button" class="dash-overview-card is-clickable" data-jump-tab="analytics">
                    <div class="dash-overview-label">🎯 ${escapeHtml(t("adminGui.totalAttempts"))}</div>
                    <div class="dash-overview-val">${escapeHtml(aTotal)}</div>
                    <div class="dash-overview-sub">${escapeHtml(t("adminGui.attemptsSub"))}</div>
                </button>
                <button type="button" class="dash-overview-card is-clickable" data-jump-tab="bank">
                    <div class="dash-overview-label">📚 ${escapeHtml(t("adminGui.bankTasks"))}</div>
                    <div class="dash-overview-val">${escapeHtml(bTotal)}</div>
                    <div class="dash-overview-sub">${escapeHtml(bSub)}</div>
                </button>
            </div>

            <div class="dash-analytics-panel dash-analytics-compact">
                <div class="dash-section-head">
                    <div class="dash-chart-head">⚡ ${escapeHtml(t("adminGui.overviewQuickStats"))}</div>
                    <button type="button" class="btn btn-secondary btn-compact" data-jump-tab="analytics">${escapeHtml(t("adminGui.moreAnalyticsBtn"))}</button>
                </div>
                <div class="dash-analytics-kpis">
                    <div class="dash-kpi-item">
                        <span class="dash-kpi-lbl">${escapeHtml(t("adminGui.kpi24h7d"))}</span>
                        <div class="dash-kpi-val-row">
                            <strong class="dash-kpi-val">${escapeHtml(an.attemptsToday ?? 0)}</strong>
                            <span class="dash-kpi-badge">${escapeHtml(t("adminGui.kpiBadgeToday"))}</span>
                        </div>
                        <span class="dash-kpi-sub">${escapeHtml(t("adminGui.kpi7dContext").replace("{w}", an.attempts7d ?? 0))}</span>
                    </div>
                    <div class="dash-kpi-item">
                        <span class="dash-kpi-lbl">${escapeHtml(t("adminGui.kpiNewUsers"))}</span>
                        <div class="dash-kpi-val-row">
                            <strong class="dash-kpi-val">+${escapeHtml(an.newUsers7d ?? 0)}</strong>
                            <span class="dash-kpi-badge">${escapeHtml(t("adminGui.kpiBadge7d"))}</span>
                        </div>
                        <span class="dash-kpi-sub">${escapeHtml(t("adminGui.kpiTodaySub").replace("{t}", formatDelta(an.newUsersToday ?? 0)))}</span>
                    </div>
                    <div class="dash-kpi-item">
                        <span class="dash-kpi-lbl">${escapeHtml(t("adminGui.kpiNewQuizzes"))}</span>
                        <div class="dash-kpi-val-row">
                            <strong class="dash-kpi-val">+${escapeHtml(an.newQuizzes7d ?? 0)}</strong>
                            <span class="dash-kpi-badge">${escapeHtml(t("adminGui.kpiBadge7d"))}</span>
                        </div>
                        <span class="dash-kpi-sub">${escapeHtml(t("adminGui.kpiTodaySub").replace("{t}", formatDelta(an.newQuizzesToday ?? 0)))}</span>
                    </div>
                    <div class="dash-kpi-item">
                        <span class="dash-kpi-lbl">${escapeHtml(t("adminGui.kpiStorage"))}</span>
                        <div class="dash-kpi-val-row">
                            <strong class="dash-kpi-val">${escapeHtml(formatStorageBytes(an.storageBytes))}</strong>
                        </div>
                        <span class="dash-kpi-sub">${escapeHtml(t("adminGui.kpiStorageSub"))}</span>
                    </div>
                </div>
            </div>
        </section>
        ${profileCard(user, limits, quizzes.length)}
    `;

    initGlide(panel);
    panel.querySelectorAll("[data-jump-tab]").forEach(btn => {
        btn.addEventListener("click", () => switchAdminTab(btn.dataset.jumpTab));
    });
}

function renderAdminAnalyticsTab(panel) {
    const ov = adminState.overview;
    const an = ov?.analytics || {};

    const daily = Array.isArray(an.dailyAttempts) && an.dailyAttempts.length
        ? an.dailyAttempts
        : Array.from({ length: 14 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (13 - i));
            return { date: d.toISOString().slice(0, 10), count: 0 };
        });
    const maxDay = Math.max(1, ...daily.map(d => d.count || 0));
    const topQuizzes = an.topQuizzes || [];
    const recentAttempts = an.recentAttempts || [];

    panel.innerHTML = `
        <section class="dash-section">
            <div class="dash-section-head">
                <h3>📈 ${escapeHtml(t("adminGui.analyticsTitle"))}</h3>
            </div>

            <div class="dash-analytics-kpis">
                <div class="dash-kpi-item">
                    <span class="dash-kpi-lbl">${escapeHtml(t("adminGui.kpi24h7d"))}</span>
                    <div class="dash-kpi-val-row">
                        <strong class="dash-kpi-val">${escapeHtml(an.attemptsToday ?? 0)}</strong>
                        <span class="dash-kpi-badge">${escapeHtml(t("adminGui.kpiBadgeToday"))}</span>
                    </div>
                    <span class="dash-kpi-sub">${escapeHtml(t("adminGui.kpi7dContext").replace("{w}", an.attempts7d ?? 0))}</span>
                </div>
                <div class="dash-kpi-item">
                    <span class="dash-kpi-lbl">${escapeHtml(t("adminGui.kpiAvgScore"))}</span>
                    <div class="dash-kpi-val-row">
                        <strong class="dash-kpi-val">${an.avgScorePct != null ? `${escapeHtml(an.avgScorePct)}%` : "—"}</strong>
                    </div>
                    ${an.avgScorePct != null ? `<div class="dash-meter"><span style="width:${Math.min(100, Math.max(0, an.avgScorePct))}%"></span></div>` : `<span class="dash-kpi-sub">—</span>`}
                </div>
                <div class="dash-kpi-item">
                    <span class="dash-kpi-lbl">${escapeHtml(t("adminGui.kpiAvgDuration"))}</span>
                    <div class="dash-kpi-val-row">
                        <strong class="dash-kpi-val">${escapeHtml(formatDurationSec(an.avgDurationSec))}</strong>
                    </div>
                    <span class="dash-kpi-sub">${escapeHtml(t("adminGui.kpiAvgDurationSub"))}</span>
                </div>
                <div class="dash-kpi-item">
                    <span class="dash-kpi-lbl">${escapeHtml(t("adminGui.kpiNewUsers"))}</span>
                    <div class="dash-kpi-val-row">
                        <strong class="dash-kpi-val">+${escapeHtml(an.newUsers7d ?? 0)}</strong>
                        <span class="dash-kpi-badge">${escapeHtml(t("adminGui.kpiBadge7d"))}</span>
                    </div>
                    <span class="dash-kpi-sub">${escapeHtml(t("adminGui.kpiTodaySub").replace("{t}", formatDelta(an.newUsersToday ?? 0)))}</span>
                </div>
                <div class="dash-kpi-item">
                    <span class="dash-kpi-lbl">${escapeHtml(t("adminGui.kpiNewQuizzes"))}</span>
                    <div class="dash-kpi-val-row">
                        <strong class="dash-kpi-val">+${escapeHtml(an.newQuizzes7d ?? 0)}</strong>
                        <span class="dash-kpi-badge">${escapeHtml(t("adminGui.kpiBadge7d"))}</span>
                    </div>
                    <span class="dash-kpi-sub">${escapeHtml(t("adminGui.kpiTodaySub").replace("{t}", formatDelta(an.newQuizzesToday ?? 0)))}</span>
                </div>
                <div class="dash-kpi-item">
                    <span class="dash-kpi-lbl">${escapeHtml(t("adminGui.kpiStorage"))}</span>
                    <div class="dash-kpi-val-row">
                        <strong class="dash-kpi-val">${escapeHtml(formatStorageBytes(an.storageBytes))}</strong>
                    </div>
                    <span class="dash-kpi-sub">${escapeHtml(t("adminGui.kpiStorageSub"))}</span>
                </div>
            </div>

            <div class="dash-chart-box">
                <div class="dash-chart-head">${escapeHtml(t("adminGui.dailyChartTitle"))}</div>
                <div class="dash-bar-chart" role="img" aria-label="${escapeHtml(t("adminGui.dailyChartTitle"))}">
                    ${daily.map(d => {
                        const pct = Math.round(((d.count || 0) / maxDay) * 100);
                        const shortDate = d.date.slice(5);
                        return `
                            <div class="dash-bar-col" title="${escapeHtml(`${d.date}: ${d.count}`)}">
                                <span class="dash-bar-val">${d.count > 0 ? escapeHtml(d.count) : ""}</span>
                                <div class="dash-bar-track">
                                    <div class="dash-bar-fill${d.count > 0 ? " has-val" : ""}" style="height:${Math.max(4, pct)}%"></div>
                                </div>
                                <span class="dash-bar-lbl">${escapeHtml(shortDate)}</span>
                            </div>
                        `;
                    }).join("")}
                </div>
            </div>

            <div class="dash-analytics-columns">
                <div class="dash-analytics-col">
                    <div class="dash-chart-head">${escapeHtml(t("adminGui.topQuizzesTitle"))}</div>
                    ${topQuizzes.length === 0 ? `<p class="dash-muted">${escapeHtml(t("adminGui.noAttemptsYet"))}</p>` : `
                        <div class="dash-mini-list">
                            ${topQuizzes.map((tq, idx) => `
                                <div class="dash-mini-row">
                                    <span class="dash-mini-rank">#${idx + 1}</span>
                                    <div class="dash-mini-info">
                                        <div class="dash-mini-title">${escapeHtml(tq.title || tq.id)}</div>
                                        <div class="dash-muted"><code class="dash-mini-code">${escapeHtml(tq.id)}</code>${tq.author ? ` · ${escapeHtml(tq.author)}` : ""}</div>
                                    </div>
                                    ${tq.avgPct != null ? `<span class="dash-chip ${tq.avgPct >= 75 ? "public" : "private"}">${escapeHtml(tq.avgPct)}%</span>` : ""}
                                    <a class="btn btn-secondary btn-compact dash-results" href="/?dashboard=${encodeURIComponent(tq.id)}">📊 ${escapeHtml(tq.attempts)}</a>
                                </div>
                            `).join("")}
                        </div>
                    `}
                </div>

                <div class="dash-analytics-col">
                    <div class="dash-chart-head">${escapeHtml(t("adminGui.recentAttemptsTitle"))}</div>
                    ${recentAttempts.length === 0 ? `<p class="dash-muted">${escapeHtml(t("adminGui.noAttemptsYet"))}</p>` : `
                        <div class="dash-mini-list">
                            ${recentAttempts.map(ra => {
                                const pct = ra.maxScore > 0 ? Math.round((ra.score / ra.maxScore) * 100) : 0;
                                const student = ra.studentName || t("results.anonymous");
                                return `
                                    <div class="dash-mini-row">
                                        <div class="dash-mini-info">
                                            <div class="dash-mini-title">${escapeHtml(student)} <span class="dash-muted">→ ${escapeHtml(ra.quizTitle || ra.quizId)}</span>${ra.status === 'quit' ? ` <span class="dash-chip" style="color:var(--danger,#ef4444); font-size:0.7rem; padding:1px 5px;">${escapeHtml(t("results.quitBadge"))}</span>` : ""}</div>
                                            <div class="dash-muted">${escapeHtml(formatDurationSec(ra.durationSeconds))} · ${escapeHtml(formatDate(ra.createdAt))}</div>
                                        </div>
                                        <span class="dash-chip ${pct >= 75 ? "public" : "private"}">${escapeHtml(ra.score)}/${escapeHtml(ra.maxScore)} (${pct}%)</span>
                                    </div>
                                `;
                            }).join("")}
                        </div>
                    `}
                </div>
            </div>
        </section>
    `;
}

// --- Dedicated Task Bank, Pending Approvals & Error Reports Pages ---

async function ensureBankMeta() {
    if (adminState.bankMeta) return adminState.bankMeta;
    const res = await fetchBankMeta();
    if (!res.ok) return { subjects: [], grades: [], difficulties: [], topics: [] };
    adminState.bankMeta = {
        subjects: res.data.subjects || [],
        grades: res.data.grades || [],
        difficulties: res.data.difficulties || [],
        topics: res.data.topics || [],
    };
    return adminState.bankMeta;
}

function buildTopicOptionsHtml(meta, subjectId, selectedTopicId) {
    const topics = (meta?.topics || []).filter(tp => !tp.archived && (!subjectId || Number(tp.subjectId) === Number(subjectId)));
    const byParent = new Map();
    for (const tp of topics) {
        const key = tp.parentId || 0;
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key).push(tp);
    }
    const out = [];
    const walk = (parentId, depth) => {
        for (const tp of byParent.get(parentId) || []) {
            const indent = "\u00A0\u00A0".repeat(depth);
            const sel = Number(selectedTopicId) === Number(tp.id) ? " selected" : "";
            out.push(`<option value="${tp.id}"${sel}>${indent}${escapeHtml(tp.name)}</option>`);
            walk(tp.id, depth + 1);
        }
    };
    walk(0, 0);
    return out.join("");
}

function renderClassificationBarHtml(meta, item) {
    const subjId = item.subjectId || meta.subjects[0]?.id || "";
    return `
        <div class="dash-bank-classify" data-classify-id="${item.id}">
            <label title="${escapeHtml(t("bank.subject"))}">
                <span>${escapeHtml(t("bank.subject"))}</span>
                <select class="admin-select-compact" name="subjectId">
                    <option value="">—</option>
                    ${meta.subjects.map(s => `<option value="${s.id}" ${Number(item.subjectId) === Number(s.id) ? "selected" : ""}>${escapeHtml(`${s.icon || ""} ${s.name}`.trim())}</option>`).join("")}
                </select>
            </label>
            <label title="${escapeHtml(t("bank.grade"))}">
                <span>${escapeHtml(t("bank.grade"))}</span>
                <select class="admin-select-compact" name="gradeId">
                    <option value="">—</option>
                    ${meta.grades.map(g => `<option value="${g.id}" ${Number(item.gradeId) === Number(g.id) ? "selected" : ""}>${escapeHtml(t("bank.gradeShort").replace("{n}", g.id))}</option>`).join("")}
                </select>
            </label>
            <label class="dash-bank-classify-topic" title="${escapeHtml(t("bank.topic"))}">
                <span>${escapeHtml(t("bank.topic"))}</span>
                <select class="admin-select-compact" name="topicId">
                    <option value="">${escapeHtml(t("bank.noTopic"))}</option>
                    ${buildTopicOptionsHtml(meta, subjId, item.topicId)}
                </select>
            </label>
            <label title="${escapeHtml(t("bank.level"))}">
                <span>${escapeHtml(t("bank.level"))}</span>
                <select class="admin-select-compact" name="difficultyId">
                    <option value="">—</option>
                    ${meta.difficulties.map(d => `<option value="${d.id}" ${Number(item.difficultyId) === Number(d.id) ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("")}
                </select>
            </label>
        </div>
    `;
}

function readClassificationBar(barEl) {
    if (!barEl) return {};
    const val = (name) => {
        const v = barEl.querySelector(`[name="${name}"]`)?.value;
        return v ? Number(v) : null;
    };
    return {
        subjectId: val("subjectId"),
        gradeId: val("gradeId"),
        topicId: val("topicId"),
        difficultyId: val("difficultyId"),
    };
}

function wireClassificationBars(container, meta, { autoSave = false } = {}) {
    container.querySelectorAll(".dash-bank-classify").forEach(bar => {
        const id = Number(bar.dataset.classifyId);
        const subjSel = bar.querySelector('[name="subjectId"]');
        const topicSel = bar.querySelector('[name="topicId"]');
        subjSel?.addEventListener("change", () => {
            const sId = subjSel.value ? Number(subjSel.value) : null;
            topicSel.innerHTML = `<option value="">${escapeHtml(t("bank.noTopic"))}</option>${buildTopicOptionsHtml(meta, sId, null)}`;
            if (autoSave) saveBarClassification(bar, id);
        });
        if (autoSave) {
            bar.querySelectorAll('select:not([name="subjectId"])').forEach(sel => {
                sel.addEventListener("change", () => saveBarClassification(bar, id));
            });
        }
    });
}

async function saveBarClassification(barEl, id) {
    const set = readClassificationBar(barEl);
    const res = await updateBankItems([id], set, "shared");
    if (!res.ok) await alertDialog(t("profile.loadError"), res.data?.error || "");
    forgetBankItems([id]);
}

function renderBankTaskPreviewHtml(q) {
    if (!q) return "";
    const picture = src => (src ? `<img class="bank-q-img" src="${escapeHtml(src)}" alt="">` : "");
    const type = q.type || "multiple-choice";
    let answer;
    if (type === "multiple-choice") {
        answer = `<ol class="bank-q-choices">${(q.choices || []).map(choice => `
            <li class="${choice.isCorrect ? "is-correct" : ""}">${picture(choice.image)}<span class="bank-math">${escapeHtml(choice.text || "")}</span>${choice.isCorrect ? " ✓" : ""}</li>`).join("")}</ol>`;
    } else if (type === "numeric") {
        const tolerance = Number(q.toleranceValue) ? ` ± ${escapeHtml(String(q.toleranceValue))}` : "";
        answer = `<p class="bank-q-answer"><span>${escapeHtml(t("bank.answer"))}:</span> <b class="bank-math">${escapeHtml(String(q.correctAnswerNumber ?? "—"))}${tolerance}</b></p>`;
    } else if (type === "true-false") {
        answer = `<p class="bank-q-answer"><span>${escapeHtml(t("bank.answer"))}:</span> <b class="bank-math">${escapeHtml(q.isTrue ? t("bank.true") : t("bank.false"))}</b></p>`;
    } else if (type === "fill-blank") {
        answer = `<p class="bank-q-answer"><span>${escapeHtml(t("bank.answers"))}:</span> <b class="bank-math">${escapeHtml((q.blankAnswers || []).join("; ") || "—")}</b></p>`;
    } else {
        answer = `<p class="bank-q-note">${escapeHtml(t(type === "image-upload" ? "bank.upload" : "bank.freeText"))}</p>`;
    }
    return `
        <div class="dash-bank-task-preview">
            ${picture(q.image)}
            <div class="bank-q-prompt bank-math">${escapeHtml(q.prompt || "")}</div>
            ${answer}
        </div>
    `;
}

function renderInlineTaskEditFormHtml(full) {
    const q = full?.content || {};
    const type = q.type || "multiple-choice";
    let answerFields = "";
    if (type === "multiple-choice") {
        answerFields = `
            <div class="dash-task-edit-choices">
                ${(q.choices || []).map((c, idx) => `
                    <label class="dash-task-edit-choice">
                        <input type="checkbox" data-choice-correct="${idx}" ${c.isCorrect ? "checked" : ""} title="${escapeHtml(t("admin.markCorrect"))}">
                        <input type="text" class="input-field" data-choice-text="${idx}" value="${escapeHtml(c.text || "")}">
                    </label>
                `).join("")}
            </div>
        `;
    } else if (type === "numeric") {
        answerFields = `
            <div class="dash-task-edit-row">
                <label>${escapeHtml(t("admin.numAnswer"))}
                    <input type="number" step="any" class="input-field" name="correctAnswerNumber" value="${escapeHtml(q.correctAnswerNumber ?? "")}">
                </label>
                <label>${escapeHtml(t("admin.numTolerance"))}
                    <input type="number" step="any" class="input-field" name="toleranceValue" value="${escapeHtml(q.toleranceValue ?? 0)}">
                </label>
            </div>
        `;
    } else if (type === "true-false") {
        answerFields = `
            <label class="dash-showcase-check">
                <input type="checkbox" name="isTrue" ${q.isTrue ? "checked" : ""}>
                <span>${escapeHtml(t("admin.isTrue"))}</span>
            </label>
        `;
    } else if (type === "fill-blank") {
        answerFields = `
            <label>${escapeHtml(t("admin.blankAnswers"))}
                <input type="text" class="input-field" name="blankAnswers" value="${escapeHtml((q.blankAnswers || []).join("; "))}">
            </label>
        `;
    }
    return `
        <form class="dash-task-edit-form" id="dash-task-form-${full.id}" data-edit-form="${full.id}" hidden>
            <label>${escapeHtml(t("admin.promptLabel"))}
                <textarea class="input-field" name="prompt" rows="2">${escapeHtml(q.prompt || "")}</textarea>
            </label>
            ${answerFields}
        </form>
    `;
}

// One spot on the card: Edit, and while editing Save and Cancel in its place, so they are in reach
// however long the form is. Both of those shrink the card back.
function taskEditButtonsHtml(id) {
    return `
        <button type="button" class="btn btn-secondary btn-compact" data-toggle-edit="${id}">✎ ${escapeHtml(t("profile.edit"))}</button>
        <button type="submit" form="dash-task-form-${id}" class="btn btn-primary btn-compact" data-save-edit="${id}" hidden>${escapeHtml(t("adminGui.saveTaskChanges"))}</button>
        <button type="button" class="btn btn-secondary btn-compact" data-cancel-edit="${id}" hidden>${escapeHtml(t("dialog.cancel"))}</button>
    `;
}

function wireInlineTaskEditors(container, fullItemsMap) {
    // The form takes the preview's place, so an open card is not both of them stacked
    const setEditing = (id, editing) => {
        const card = container.querySelector(`[data-bank-card="${id}"]`);
        if (!card) return;
        card.classList.toggle("is-editing", editing);
        card.querySelector(`[data-edit-form="${id}"]`).hidden = !editing;
        card.querySelector(`[data-toggle-edit="${id}"]`).hidden = editing;
        card.querySelector(`[data-save-edit="${id}"]`).hidden = !editing;
        card.querySelector(`[data-cancel-edit="${id}"]`).hidden = !editing;
        const preview = card.querySelector(".dash-bank-task-preview");
        if (preview) preview.hidden = editing;
    };
    container.querySelectorAll("[data-toggle-edit]").forEach(btn => {
        btn.addEventListener("click", () => setEditing(Number(btn.dataset.toggleEdit), true));
    });
    container.querySelectorAll("[data-cancel-edit]").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = Number(btn.dataset.cancelEdit);
            container.querySelector(`[data-edit-form="${id}"]`)?.reset();
            setEditing(id, false);
        });
    });
    container.querySelectorAll("[data-edit-form]").forEach(form => {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const id = Number(form.dataset.editForm);
            const full = fullItemsMap.get(id);
            if (!full) return;
            const content = JSON.parse(JSON.stringify(full.content || {}));
            content.prompt = form.prompt.value.trim();
            const type = content.type || "multiple-choice";
            if (type === "multiple-choice" && Array.isArray(content.choices)) {
                content.choices.forEach((c, idx) => {
                    const txt = form.querySelector(`[data-choice-text="${idx}"]`);
                    const chk = form.querySelector(`[data-choice-correct="${idx}"]`);
                    if (txt) c.text = txt.value;
                    if (chk) c.isCorrect = chk.checked;
                });
            } else if (type === "numeric") {
                content.correctAnswerNumber = Number(form.correctAnswerNumber?.value || 0);
                content.toleranceValue = Number(form.toleranceValue?.value || 0);
            } else if (type === "true-false") {
                content.isTrue = Boolean(form.isTrue?.checked);
            } else if (type === "fill-blank") {
                content.blankAnswers = String(form.blankAnswers?.value || "").split(";").map(s => s.trim()).filter(Boolean);
            }
            const card = form.closest(".dash-bank-card");
            // What the bar shows is what gets saved, an emptied field included
            const classified = readClassificationBar(card.querySelector(".dash-bank-classify"));
            const saveBtn = card.querySelector(`[data-save-edit="${id}"]`);
            saveBtn.disabled = true;
            const res = await updateBankItem(id, { content, ...classified });
            saveBtn.disabled = false;
            if (!res.ok) {
                await alertDialog(t("profile.loadError"), res.data?.error || "");
                return;
            }
            forgetBankItems([id]);
            // Only this card changes: the list keeps its place instead of reloading around it
            Object.assign(full, classified, { content });
            for (const field of form.elements) {
                field.defaultValue = field.value;
                field.defaultChecked = field.checked;
            }
            card.querySelector(".dash-bank-task-preview")?.remove();
            form.insertAdjacentHTML("beforebegin", renderBankTaskPreviewHtml(content));
            typesetMath(card.querySelector(".dash-bank-task-preview"));
            setEditing(id, false);
        });
    });
}

function typesetMath(el) {
    try {
        window.renderMathInElement?.(el, {
            delimiters: [{ left: "\\(", right: "\\)", display: false }, { left: "\\[", right: "\\]", display: true }],
            throwOnError: false,
        });
    } catch {
        // leave plain text if KaTeX is unavailable
    }
}

async function renderAdminApprovalsTab(panel) {
    panel.innerHTML = skeletonHtml(5);
    const [meta, listRes] = await Promise.all([
        ensureBankMeta(),
        listBankItems({ review: 1, status: "draft", sort: "new", limit: 100, facets: "none" }),
    ]);
    if (!listRes.ok) {
        panel.innerHTML = `<div class="dash-empty"><p class="dash-muted">${escapeHtml(t("bank.loadFailed"))}</p></div>`;
        return;
    }
    const items = listRes.data.items || [];
    if (adminState.overview?.bank) {
        adminState.overview.bank.pendingReview = listRes.data.total ?? items.length;
    }
    updateAdminTabBadges();

    if (items.length === 0) {
        panel.innerHTML = `
            <section class="dash-section">
                <div class="dash-section-head"><h3>⏳ ${escapeHtml(t("bank.reviewTitle"))} <span class="dash-muted">(0)</span></h3></div>
                <div class="dash-empty">
                    <div class="dash-empty-icon" aria-hidden="true">⏳</div>
                    <p class="dash-muted">${escapeHtml(t("adminGui.approvalsEmpty"))}</p>
                </div>
            </section>
        `;
        return;
    }

    forgetBankItems(items.map(i => i.id));
    const fullList = (await loadBankItems(items.map(i => i.id))).filter(Boolean);
    const fullMap = new Map(fullList.map(f => [f.id, f]));

    panel.innerHTML = `
        <section class="dash-section">
            <div class="dash-section-head">
                <h3>⏳ ${escapeHtml(t("bank.reviewTitle"))} <span class="dash-muted">(${fullList.length})</span></h3>
            </div>
            <div class="dash-bank-list">
                ${fullList.map(full => {
                    const sender = full.submitted?.user || "—";
                    const dateStr = full.submitted?.createdAt ? formatDate(full.submitted.createdAt) : "—";
                    const qtype = full.content?.type || "multiple-choice";
                    return `
                        <div class="dash-bank-card" data-bank-card="${full.id}">
                            <div class="dash-bank-card-head">
                                <span class="dash-chip public">⏳ ${escapeHtml(t("bank.reviewFrom").replace("{user}", sender).replace("{date}", dateStr))}</span>
                                <span class="dash-muted">${escapeHtml(t(`bank.qtype.${qtype}`))}</span>
                                <div class="dash-bank-head-actions">${taskEditButtonsHtml(full.id)}</div>
                            </div>
                            ${renderClassificationBarHtml(meta, full)}
                            ${renderBankTaskPreviewHtml(full.content)}
                            ${renderInlineTaskEditFormHtml(full)}
                            <div class="dash-bank-review-footer">
                                <input type="text" class="input-field dash-reject-note" data-reject-note="${full.id}" maxlength="500" placeholder="${escapeHtml(t("bank.rejectNote"))}">
                                <div class="dash-bank-review-btns">
                                    <button type="button" class="btn btn-primary" data-decide-id="${full.id}" data-decide-act="approve">✓ ${escapeHtml(t("bank.approve"))}</button>
                                    <button type="button" class="btn btn-secondary" data-decide-id="${full.id}" data-decide-act="reject">✕ ${escapeHtml(t("bank.reject"))}</button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>
        </section>
    `;

    typesetMath(panel);
    wireClassificationBars(panel, meta, { autoSave: false });
    wireInlineTaskEditors(panel, fullMap);

    panel.querySelectorAll("[data-decide-id]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = Number(btn.dataset.decideId);
            const action = btn.dataset.decideAct;
            const card = panel.querySelector(`[data-bank-card="${id}"]`);
            card.querySelectorAll("[data-decide-id]").forEach(b => { b.disabled = true; });
            if (action === "approve") {
                const cls = readClassificationBar(card.querySelector(".dash-bank-classify"));
                const classified = await updateBankItems([id], cls, "shared");
                if (!classified.ok) {
                    card.querySelectorAll("[data-decide-id]").forEach(b => { b.disabled = false; });
                    await alertDialog(t("profile.loadError"), classified.data?.error || "");
                    return;
                }
            }
            const note = card.querySelector(`[data-reject-note="${id}"]`)?.value || "";
            const res = await decideBankSubmission(id, action, note);
            if (!res.ok) {
                card.querySelectorAll("[data-decide-id]").forEach(b => { b.disabled = false; });
                await alertDialog(t("profile.loadError"), res.data?.error || "");
                return;
            }
            forgetBankItems([id]);
            if (adminState.overview?.bank && action === "approve") {
                adminState.overview.bank.published = (adminState.overview.bank.published || 0) + 1;
            }
            renderAdminApprovalsTab(panel);
        });
    });
}

async function renderAdminReportsTab(panel) {
    panel.innerHTML = skeletonHtml(5);
    const [meta, listRes] = await Promise.all([
        ensureBankMeta(),
        listBankItems({ flagged: 1, sort: "new", limit: 100, facets: "none" }),
    ]);
    if (!listRes.ok) {
        panel.innerHTML = `<div class="dash-empty"><p class="dash-muted">${escapeHtml(t("bank.loadFailed"))}</p></div>`;
        return;
    }
    const items = listRes.data.items || [];
    if (adminState.overview?.bank) {
        adminState.overview.bank.openReports = listRes.data.total ?? items.length;
    }
    updateAdminTabBadges();

    if (items.length === 0) {
        panel.innerHTML = `
            <section class="dash-section">
                <div class="dash-section-head"><h3>🚩 ${escapeHtml(t("bank.flaggedTitle"))} <span class="dash-muted">(0)</span></h3></div>
                <div class="dash-empty">
                    <div class="dash-empty-icon" aria-hidden="true">🚩</div>
                    <p class="dash-muted">${escapeHtml(t("adminGui.reportsEmpty"))}</p>
                </div>
            </section>
        `;
        return;
    }

    forgetBankItems(items.map(i => i.id));
    const fullList = (await loadBankItems(items.map(i => i.id))).filter(Boolean);
    const fullMap = new Map(fullList.map(f => [f.id, f]));

    panel.innerHTML = `
        <section class="dash-section">
            <div class="dash-section-head">
                <h3>🚩 ${escapeHtml(t("bank.flaggedTitle"))} <span class="dash-muted">(${fullList.length})</span></h3>
            </div>
            <div class="dash-bank-list">
                ${fullList.map(full => {
                    const reports = full.reports || [];
                    return `
                        <div class="dash-bank-card" data-bank-card="${full.id}">
                            <div class="dash-reports-box">
                                <div class="dash-reports-head">🚩 ${escapeHtml(t("bank.reportsOpen").replace("{n}", reports.length))}</div>
                                <ul class="dash-reports-ul">
                                    ${reports.map(r => `
                                        <li>
                                            <b>${escapeHtml(t(`bank.reason.${r.reason}`))}</b>
                                            ${r.note ? ` — „${escapeHtml(r.note)}“` : ""}
                                            <span class="dash-muted"> · ${escapeHtml(r.user || "—")} · ${escapeHtml(formatDate(r.createdAt))}</span>
                                        </li>
                                    `).join("")}
                                </ul>
                            </div>
                            ${renderClassificationBarHtml(meta, full)}
                            ${renderBankTaskPreviewHtml(full.content)}
                            ${renderInlineTaskEditFormHtml(full)}
                            <div class="dash-bank-card-actions">
                                <button type="button" class="btn btn-primary" data-report-act="resolve" data-task-id="${full.id}">✓ ${escapeHtml(t("bank.resolve"))}</button>
                                <button type="button" class="btn btn-secondary" data-report-act="dismiss" data-task-id="${full.id}">${escapeHtml(t("bank.dismiss"))}</button>
                                ${taskEditButtonsHtml(full.id)}
                                <button type="button" class="btn btn-secondary dash-delete" data-report-act="archive" data-task-id="${full.id}" style="margin-left:auto;">🗑 ${escapeHtml(t("bank.archiveTask"))}</button>
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>
        </section>
    `;

    typesetMath(panel);
    wireClassificationBars(panel, meta, { autoSave: true });
    wireInlineTaskEditors(panel, fullMap);

    panel.querySelectorAll("[data-report-act]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = Number(btn.dataset.taskId);
            const act = btn.dataset.reportAct;
            if (act === "archive") {
                const ok = await confirmDialog({
                    title: t("bank.archiveTitle"),
                    message: t("bank.archiveBody"),
                    confirmText: t("bank.archiveTask"),
                    danger: true,
                });
                if (!ok) return;
                btn.disabled = true;
                const archRes = await archiveBankItems([id], "shared");
                if (!archRes.ok) {
                    btn.disabled = false;
                    await alertDialog(t("profile.loadError"), archRes.data?.error || "");
                    return;
                }
                if (adminState.overview?.bank) {
                    adminState.overview.bank.published = Math.max(0, (adminState.overview.bank.published || 1) - 1);
                }
            }
            btn.disabled = true;
            await closeBankReports(id, act === "dismiss" ? "dismissed" : "resolved");
            forgetBankItems([id]);
            renderAdminReportsTab(panel);
        });
    });
}

async function renderAdminBankTab(panel) {
    panel.innerHTML = skeletonHtml(5);
    const meta = await ensureBankMeta();
    const bf = adminState.bankFilter;

    panel.innerHTML = `
        <section class="dash-section">
            <div class="dash-section-head">
                <h3>📚 ${escapeHtml(t("bank.title"))} <span class="dash-muted" id="dash-bank-total"></span></h3>
            </div>
            <div class="dash-filter-bar dash-bank-filters">
                <input type="search" id="dash-bank-q" class="input-field dash-search-input" placeholder="${escapeHtml(t("bank.search"))}" value="${escapeHtml(bf.q)}">
                <select id="dash-bank-subj" class="admin-select-compact">
                    <option value="">${escapeHtml(t("bank.subject"))}: ${escapeHtml(t("adminGui.filterAll"))}</option>
                    ${meta.subjects.map(s => `<option value="${s.id}" ${String(bf.subject) === String(s.id) ? "selected" : ""}>${escapeHtml(`${s.icon || ""} ${s.name}`.trim())}</option>`).join("")}
                </select>
                <select id="dash-bank-grade" class="admin-select-compact">
                    <option value="">${escapeHtml(t("bank.grade"))}: ${escapeHtml(t("bank.allGrades"))}</option>
                    ${meta.grades.map(g => `<option value="${g.id}" ${String(bf.grade) === String(g.id) ? "selected" : ""}>${escapeHtml(t("bank.gradeShort").replace("{n}", g.id))}</option>`).join("")}
                </select>
                <select id="dash-bank-topic" class="admin-select-compact">
                    <option value="">${escapeHtml(t("bank.allTopics"))}</option>
                    <option value="none" ${bf.topic === "none" ? "selected" : ""}>${escapeHtml(t("bank.noTopic"))}</option>
                    ${buildTopicOptionsHtml(meta, bf.subject, bf.topic)}
                </select>
                <select id="dash-bank-diff" class="admin-select-compact">
                    <option value="">${escapeHtml(t("adminGui.allDifficulties"))}</option>
                    ${meta.difficulties.map(d => `<option value="${d.id}" ${String(bf.difficulty) === String(d.id) ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("")}
                </select>
                <select id="dash-bank-sort" class="admin-select-compact">
                    <option value="new" ${bf.sort === "new" ? "selected" : ""}>${escapeHtml(t("bank.sort.new"))}</option>
                    <option value="popular" ${bf.sort === "popular" ? "selected" : ""}>${escapeHtml(t("bank.sort.popular"))}</option>
                    <option value="level" ${bf.sort === "level" ? "selected" : ""}>${escapeHtml(t("bank.sort.level"))}</option>
                </select>
            </div>
            <div id="dash-bank-results" class="dash-bank-list">${skeletonHtml(5)}</div>
        </section>
    `;

    const resultsEl = panel.querySelector("#dash-bank-results");
    const totalEl = panel.querySelector("#dash-bank-total");

    const loadList = async () => {
        resultsEl.innerHTML = skeletonHtml(5);
        const res = await listBankItems({
            q: bf.q.trim() || undefined,
            subject: bf.subject || undefined,
            grade: bf.grade || undefined,
            topic: bf.topic || undefined,
            difficulty: bf.difficulty || undefined,
            sort: bf.sort,
            limit: 60,
            facets: "none",
        });
        if (!res.ok) {
            resultsEl.innerHTML = `<div class="dash-empty"><p class="dash-muted">${escapeHtml(t("bank.loadFailed"))}</p></div>`;
            return;
        }
        const items = res.data.items || [];
        // The server's total can lag about a second behind a change. A list that fits on one page
        // needs no total: it is the rows themselves, so deleting a task never leaves the old count.
        const total = res.data.nextCursor ? res.data.total ?? items.length : items.length;
        totalEl.textContent = `(${total})`;

        if (items.length === 0) {
            resultsEl.innerHTML = `
                <div class="dash-empty">
                    <div class="dash-empty-icon" aria-hidden="true">📚</div>
                    <h4>${escapeHtml(t("bank.empty"))}</h4>
                    <p class="dash-muted">${escapeHtml(t("bank.emptyHint"))}</p>
                </div>
            `;
            return;
        }

        const fullList = (await loadBankItems(items.map(i => i.id))).filter(Boolean);
        const fullMap = new Map(fullList.map(f => [f.id, f]));

        resultsEl.innerHTML = fullList.map(full => {
            const qtype = full.content?.type || "multiple-choice";
            return `
                <div class="dash-bank-card" data-bank-card="${full.id}">
                    <div class="dash-bank-card-head">
                        <span class="dash-chip private">#${full.id}</span>
                        <span class="dash-muted">${escapeHtml(t(`bank.qtype.${qtype}`))}</span>
                        <div class="dash-bank-head-actions">
                            ${taskEditButtonsHtml(full.id)}
                            <button type="button" class="btn btn-secondary btn-icon btn-compact dash-delete" data-archive-task="${full.id}" title="${escapeHtml(t("bank.archiveTask"))}" aria-label="${escapeHtml(t("bank.archiveTask"))}">🗑</button>
                        </div>
                    </div>
                    ${renderClassificationBarHtml(meta, full)}
                    ${renderBankTaskPreviewHtml(full.content)}
                    ${renderInlineTaskEditFormHtml(full)}
                </div>
            `;
        }).join("");

        typesetMath(resultsEl);
        wireClassificationBars(resultsEl, meta, { autoSave: true });
        wireInlineTaskEditors(resultsEl, fullMap);

        resultsEl.querySelectorAll("[data-archive-task]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = Number(btn.dataset.archiveTask);
                const ok = await confirmDialog({
                    title: t("bank.archiveTitle"),
                    message: t("bank.archiveBody"),
                    confirmText: t("bank.archiveTask"),
                    danger: true,
                });
                if (!ok) return;
                btn.disabled = true;
                const archRes = await archiveBankItems([id], "shared");
                if (!archRes.ok) {
                    btn.disabled = false;
                    await alertDialog(t("profile.loadError"), archRes.data?.error || "");
                    return;
                }
                forgetBankItems([id]);
                if (adminState.overview?.bank) {
                    adminState.overview.bank.published = Math.max(0, (adminState.overview.bank.published || 1) - 1);
                }
                updateAdminTabBadges();
                loadList();
            });
        });
    };

    let qTimer = null;
    panel.querySelector("#dash-bank-q").addEventListener("input", (e) => {
        bf.q = e.target.value;
        clearTimeout(qTimer);
        qTimer = setTimeout(loadList, 250);
    });
    panel.querySelector("#dash-bank-subj").addEventListener("change", (e) => {
        bf.subject = e.target.value;
        bf.topic = "";
        panel.querySelector("#dash-bank-topic").innerHTML = `
            <option value="">${escapeHtml(t("bank.allTopics"))}</option>
            <option value="none">${escapeHtml(t("bank.noTopic"))}</option>
            ${buildTopicOptionsHtml(meta, bf.subject, "")}
        `;
        loadList();
    });
    panel.querySelector("#dash-bank-grade").addEventListener("change", (e) => {
        bf.grade = e.target.value;
        loadList();
    });
    panel.querySelector("#dash-bank-topic").addEventListener("change", (e) => {
        bf.topic = e.target.value;
        loadList();
    });
    panel.querySelector("#dash-bank-diff").addEventListener("change", (e) => {
        bf.difficulty = e.target.value;
        loadList();
    });
    panel.querySelector("#dash-bank-sort").addEventListener("change", (e) => {
        bf.sort = e.target.value;
        loadList();
    });

    loadList();
}

function renderAdminMyQuizzesTab(panel) {
    const quizzes = adminState.profile?.quizzes || [];
    panel.innerHTML = quizzesSection(quizzes);
    wireQuizCardEvents(panel);
}

async function refreshOverviewBadges() {
    try {
        adminState.overview = await fetchAdminOverview();
        updateAdminTabBadges();
    } catch {
        // The badges keep their numbers until the next refresh
    }
}

function updateAdminTabBadges() {
    const body = document.getElementById("dashboard-body");
    if (!body) return;
    const setBadge = (tabId, val) => {
        const el = body.querySelector(`[data-admin-tab="${tabId}"] .dash-admin-tab-badge`);
        if (el && val != null) el.textContent = String(val);
    };
    setBadge("quizzes", adminState.overview?.quizzes?.total);
    setBadge("showcase", adminState.overview?.quizzes?.featured);
    setBadge("approvals", adminState.overview?.bank?.pendingReview);
    setBadge("reports", adminState.overview?.bank?.openReports);
    setBadge("bank", adminState.overview?.bank?.published);
}

// --- Registration codes (admins) ---

function buildInvites(section) {
    section.dataset.built = "1";
    section.innerHTML = `
        <div class="dash-section-head"><h3>${t("invites.title")}</h3></div>
        <p class="dash-muted">${t("invites.intro")}</p>
        <form class="dash-invite-form">
            <label>${t("invites.role")}
                <select name="role" class="admin-select-compact">
                    <option value="teacher">${t("invites.roleTeacher")}</option>
                    <option value="creator">${t("invites.roleCreator")}</option>
                </select>
            </label>
            <label>${t("invites.count")}
                <input name="count" class="input-field" type="number" min="1" max="50" value="1" inputmode="numeric">
            </label>
            <label class="dash-invite-note">${t("invites.note")}
                <input name="note" class="input-field" type="text" maxlength="120" placeholder="${escapeHtml(t("invites.notePlaceholder"))}">
            </label>
            <button type="submit" class="btn btn-primary">${t("invites.generate")}</button>
        </form>
        <div class="dash-invite-new" hidden></div>
        <p class="dash-invite-error" role="alert" hidden></p>
        <div class="dash-invite-list">${skeletonHtml(3)}</div>
    `;
    const form = section.querySelector("form");
    const error = section.querySelector(".dash-invite-error");
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const submit = form.querySelector("button[type=submit]");
        submit.disabled = true;
        error.hidden = true;
        const res = await createInvites(form.role.value, Number(form.count.value) || 1, form.note.value);
        submit.disabled = false;
        if (!res.ok) {
            error.textContent = res.data.error || t("invites.failed");
            error.hidden = false;
            return;
        }
        form.note.value = "";
        showNewCodes(section.querySelector(".dash-invite-new"), res.data.codes);
        loadInvites(section);
    });
    section.querySelector(".dash-invite-list").addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-withdraw]");
        if (!btn) return;
        btn.disabled = true;
        const res = await deleteInvite(btn.dataset.withdraw);
        if (!res.ok) {
            btn.disabled = false;
            error.textContent = res.data.error || t("invites.failed");
            error.hidden = false;
            return;
        }
        loadInvites(section);
    });
}

// Codes are shown in groups of three ("K7M-3QX-P2A") so they are easy to read out; any form works
const groupCode = (code) => code.replace(/(.{3})(?=.)/g, "$1-");

function showNewCodes(box, codes) {
    box.hidden = false;
    box.innerHTML = `
        <p>${t("invites.new")}</p>
        <div class="dash-invite-codes">${codes.map(c => `<code>${escapeHtml(groupCode(c))}</code>`).join("")}</div>
        <button type="button" class="btn btn-secondary btn-compact">📋 ${t("invites.copyAll")}</button>
    `;
    const copy = box.querySelector("button");
    copy.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(codes.map(groupCode).join("\n"));
            copy.textContent = `✓ ${t("invites.copied")}`;
        } catch {
            // Clipboard refused (an old browser or no permission): the codes stay on screen to select
            window.getSelection()?.selectAllChildren(box.querySelector(".dash-invite-codes"));
        }
    });
}

async function loadInvites(section) {
    const list = section.querySelector(".dash-invite-list");
    const res = await fetchInvites();
    if (!res.ok) {
        list.innerHTML = `<p class="dash-muted">${escapeHtml(res.data.error || t("invites.failed"))}</p>`;
        return;
    }
    const invites = res.data.invites || [];
    if (!invites.length) {
        list.innerHTML = `<p class="dash-muted">${t("invites.empty")}</p>`;
        return;
    }
    list.innerHTML = `
        <div class="dash-table-wrap"><table class="dash-table">
            <thead><tr><th>${t("invites.code")}</th><th>${t("invites.role")}</th><th>${t("invites.note")}</th><th>${t("invites.created")}</th><th>${t("invites.usedBy")}</th><th><span class="sr-only">${t("dashboard.actions")}</span></th></tr></thead>
            <tbody>${invites.map(i => `<tr class="${i.used_at ? "dash-invite-used" : ""}">
                <td><code>${escapeHtml(groupCode(i.code))}</code></td>
                <td>${escapeHtml(t(`role.${i.role}`))}</td>
                <td>${escapeHtml(i.note || "")}</td>
                <td>${escapeHtml(formatDate(i.created_at))}</td>
                <td>${i.used_at ? escapeHtml(`${i.used_by || "—"} · ${formatDate(i.used_at)}`) : `<span class="dash-muted">${t("invites.unused")}</span>`}</td>
                <td>${i.used_at ? "" : `<button type="button" class="btn btn-secondary btn-icon btn-compact" data-withdraw="${escapeHtml(i.code)}" title="${t("invites.withdraw")}" aria-label="${t("invites.withdraw")}">✕</button>`}</td>
            </tr>`).join("")}</tbody>
        </table></div>`;
}

// The dashboard's place and look go along, so the task bank can glide it into its own column
function openEditor(quizId, bankQueue, fresh = false) {
    stopShowcase();
    const win = dashboardModal.querySelector(".dash-window");
    const from = win ? { rect: win.getBoundingClientRect(), node: win.cloneNode(true) } : null;
    dashboardModal.style.display = "none";
    document.dispatchEvent(new window.CustomEvent("open-editor", { detail: { quizId, bankQueue, from, fresh } }));
}

const createQuiz = () => openEditor(null, null, true);

function profileCard(user, limits, quizCount) {
    const isAdmin = user.role === "admin";
    // Staff (admins and creators) have premium's limits for good (src/backend/plans.js)
    const staff = isAdmin || user.role === "creator";
    const premium = staff || user.premium_active;

    let planLabel = t("profile.planFree");
    let planClass = "free";
    if (isAdmin) { planLabel = t("profile.planAdmin"); planClass = "admin"; }
    else if (user.role === "creator") { planLabel = t("profile.planCreator"); planClass = "admin"; }
    else if (user.premium_active) { planLabel = t("profile.planPremium"); planClass = "premium"; }

    let validity = "—";
    if (premium) {
        validity = user.subscription_expires_at && !staff ? formatDate(user.subscription_expires_at) : t("profile.noExpiry");
    } else if (user.subscription_tier === "premium" && user.subscription_expires_at) {
        validity = `${t("profile.expired")} ${formatDate(user.subscription_expires_at)}`;
    }

    const quizUsage = limits.max_quizzes == null
        ? `${quizCount} <span class="dash-muted">/ ${t("profile.unlimited").toLowerCase()}</span>`
        : `${quizCount} <span class="dash-muted">/ ${limits.max_quizzes}</span>`;
    const usagePct = limits.max_quizzes == null ? 0 : Math.min(100, Math.round((quizCount / limits.max_quizzes) * 100));
    const atLimit = limits.max_quizzes != null && quizCount >= limits.max_quizzes;
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
            ${premium ? "" : `<p class="dash-hint">${escapeHtml(atLimit ? t("profile.limitReached").replace("{n}", limits.max_quizzes) : t("profile.upgradeHint"))}</p>`}
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
    if (!adminState.users) {
        container.innerHTML = skeletonHtml(5);
        try {
            adminState.users = await fetchAllUsers();
        } catch (e) {
            container.innerHTML = `<p class="dash-muted">${escapeHtml(e.message)}</p>`;
            return;
        }
    }

    const currentId = adminState.profile?.user?.id;
    const users = adminState.users;

    container.innerHTML = `
        <section class="dash-section">
            <div class="dash-section-head"><h3>${t("profile.users")} <span class="dash-muted">(${users.length})</span></h3></div>
            <div class="dash-filter-bar">
                <input type="search" id="dash-user-search" class="input-field dash-search-input" placeholder="${escapeHtml(t("adminGui.searchUsers"))}" value="${escapeHtml(adminState.userSearch)}">
                <select id="dash-user-role-filter" class="admin-select-compact">
                    <option value="all" ${adminState.userRoleFilter === "all" ? "selected" : ""}>${escapeHtml(t("adminGui.filterRoleAll"))}</option>
                    <option value="teacher" ${adminState.userRoleFilter === "teacher" ? "selected" : ""}>${escapeHtml(t("role.teacher"))}</option>
                    <option value="creator" ${adminState.userRoleFilter === "creator" ? "selected" : ""}>${escapeHtml(t("role.creator"))}</option>
                    <option value="admin" ${adminState.userRoleFilter === "admin" ? "selected" : ""}>${escapeHtml(t("role.admin"))}</option>
                </select>
            </div>
            <div id="dash-users-table-box" class="dash-table-wrap"></div>
        </section>
    `;

    const searchInput = container.querySelector("#dash-user-search");
    const roleFilter = container.querySelector("#dash-user-role-filter");
    const tableBox = container.querySelector("#dash-users-table-box");

    const drawTable = () => {
        const qStr = adminState.userSearch.trim().toLowerCase();
        const filtered = adminState.users.filter(u => {
            if (adminState.userRoleFilter !== "all" && u.role !== adminState.userRoleFilter) return false;
            if (!qStr) return true;
            return (
                (u.email || "").toLowerCase().includes(qStr) ||
                (u.username || "").toLowerCase().includes(qStr)
            );
        });

        let html = `
            <table class="dash-table dash-users-table">
                <thead>
                    <tr>
                        <th>${t("profile.username")} / ${t("profile.email")}</th>
                        <th>${t("profile.role")}</th>
                        <th>${t("profile.plan")}</th>
                        <th>${t("profile.quizzes")}</th>
                        <th>${t("profile.memberSince")}</th>
                        <th><span class="sr-only">${t("dashboard.actions")}</span></th>
                    </tr>
                </thead>
                <tbody>
        `;

        filtered.forEach(u => {
            const isSelf = u.id === currentId;
            const isPremium = u.premium_active || u.role === "admin" || u.role === "creator";
            const expText = u.subscription_expires_at ? ` (${formatDate(u.subscription_expires_at)})` : "";
            const planBadge = u.role === "admin" || u.role === "creator"
                ? `<span class="dash-chip public">${escapeHtml(t(`role.${u.role}`))}</span>`
                : isPremium
                    ? `<span class="dash-chip public">${escapeHtml(t("profile.planPremium"))}${escapeHtml(expText)}</span>`
                    : `<span class="dash-chip private">${escapeHtml(t("profile.planFree"))}</span>`;

            html += `
                <tr>
                    <td>
                        <div class="dash-user-cell">
                            <span class="dash-user-name">${escapeHtml(u.username)}</span>
                            <span class="dash-muted">${escapeHtml(u.email)}</span>
                        </div>
                    </td>
                    <td>
                        <select class="admin-select-compact" data-user-role="${u.id}" ${isSelf ? `disabled title="${escapeHtml(t("adminGui.cannotEditSelf"))}"` : ""}>
                            <option value="teacher" ${u.role === "teacher" ? "selected" : ""}>${escapeHtml(t("role.teacher"))}</option>
                            <option value="creator" ${u.role === "creator" ? "selected" : ""}>${escapeHtml(t("role.creator"))}</option>
                            <option value="admin" ${u.role === "admin" ? "selected" : ""}>${escapeHtml(t("role.admin"))}</option>
                        </select>
                    </td>
                    <td>
                        <div class="dash-user-plan-cell">
                            ${planBadge}
                            <select class="admin-select-compact dash-premium-select" data-user-premium="${u.id}">
                                <option value="">${escapeHtml(t("adminGui.grantPremium"))}</option>
                                <option value="30d">${escapeHtml(t("adminGui.premium30d"))}</option>
                                <option value="365d">${escapeHtml(t("adminGui.premium365d"))}</option>
                                <option value="forever">${escapeHtml(t("adminGui.premiumForever"))}</option>
                                <option value="revoke">${escapeHtml(t("adminGui.premiumRevoke"))}</option>
                            </select>
                        </div>
                    </td>
                    <td>${escapeHtml(u.quiz_count ?? 0)}</td>
                    <td>${escapeHtml(formatDate(u.created_at))}</td>
                    <td>
                        <button type="button" class="btn btn-secondary btn-icon btn-compact dash-delete" data-delete-user="${u.id}" data-username="${escapeHtml(u.username)}" data-email="${escapeHtml(u.email)}" ${isSelf ? `disabled title="${escapeHtml(t("adminGui.cannotEditSelf"))}"` : `title="${escapeHtml(t("adminGui.deleteUser"))}"`} aria-label="${escapeHtml(t("adminGui.deleteUser"))}">🗑</button>
                    </td>
                </tr>
            `;
        });

        tableBox.innerHTML = html + `</tbody></table>`;

        tableBox.querySelectorAll("[data-user-role]").forEach(sel => {
            sel.addEventListener("change", async () => {
                const uid = Number(sel.dataset.userRole);
                const role = sel.value;
                sel.disabled = true;
                const res = await updateAdminUser(uid, { role });
                sel.disabled = false;
                if (!res.ok) {
                    await alertDialog(t("profile.loadError"), res.data?.error || "");
                    renderAdminUsers(container);
                    return;
                }
                const target = adminState.users.find(x => x.id === uid);
                if (target) target.role = role;
                drawTable();
            });
        });

        tableBox.querySelectorAll("[data-user-premium]").forEach(sel => {
            sel.addEventListener("change", async () => {
                const action = sel.value;
                if (!action) return;
                const uid = Number(sel.dataset.userPremium);
                sel.disabled = true;
                let payload;
                if (action === "30d") payload = { subscription_tier: "premium", duration_days: 30 };
                else if (action === "365d") payload = { subscription_tier: "premium", duration_days: 365 };
                else if (action === "forever") payload = { subscription_tier: "premium", duration_days: null };
                else payload = { subscription_tier: "free" };

                const res = await updateAdminUser(uid, payload);
                sel.disabled = false;
                if (!res.ok) {
                    await alertDialog(t("profile.loadError"), res.data?.error || "");
                    return;
                }
                adminState.users = await fetchAllUsers();
                drawTable();
            });
        });

        tableBox.querySelectorAll("[data-delete-user]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const uid = Number(btn.dataset.deleteUser);
                const ok = await confirmDialog({
                    title: t("adminGui.deleteUserTitle"),
                    message: t("adminGui.deleteUserConfirm")
                        .replace("{name}", btn.dataset.username || "")
                        .replace("{email}", btn.dataset.email || ""),
                    confirmText: t("dialog.delete"),
                    danger: true,
                });
                if (!ok) return;
                btn.disabled = true;
                const res = await deleteAdminUser(uid);
                if (!res.ok) {
                    btn.disabled = false;
                    await alertDialog(t("profile.loadError"), res.data?.error || "");
                    return;
                }
                adminState.users = adminState.users.filter(x => x.id !== uid);
                if (adminState.overview?.users) {
                    adminState.overview.users.total = adminState.users.length;
                }
                renderAdminUsers(container);
            });
        });
    };

    searchInput.addEventListener("input", () => {
        adminState.userSearch = searchInput.value;
        drawTable();
    });
    roleFilter.addEventListener("change", () => {
        adminState.userRoleFilter = roleFilter.value;
        drawTable();
    });

    drawTable();
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
