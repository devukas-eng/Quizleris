import { getCurrentUser, showAuthModal, logoutUser } from "./auth-ui.js";
import {
    fetchAllUsers,
    fetchProfile,
    deleteQuizFromCloud,
    fetchInvites,
    createInvites,
    deleteInvite,
    fetchAdminOverview,
    fetchAdminQuizzes,
    updateAdminQuiz,
    updateAdminUser,
    deleteAdminUser,
    updateShowcaseSettings,
} from "./api.js";
import { t, getLanguage } from "./lang.js";
import { confirmDialog, alertDialog } from "./dialog.js";
import { shareStripHtml, wireCopyButtons } from "./share-links.js";
import { initGlide } from "./glide.js";

let dashboardModal = null;
let activeAdminTab = "overview";
let showcasePreviewTimer = null;

// Cached admin state for fast tab switching within a session
let adminState = {
    profile: null,
    overview: null,
    allQuizzes: null,
    users: null,
    quizSearch: "",
    quizFilter: "all",
    userSearch: "",
    userRoleFilter: "all",
};

export function initDashboardUI() {
    const modalHTML = `
        <div id="dashboard-modal" class="modal-overlay dash-overlay" style="display: none;">
            <div class="dash-window" role="dialog" aria-modal="true" aria-labelledby="dashboard-title">
                <div class="dash-header">
                    <h2 id="dashboard-title"></h2>
                    <button id="dashboard-invites-btn" class="btn btn-secondary dash-invites-btn" hidden aria-expanded="false" aria-controls="dash-invites"></button>
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
        if (showcasePreviewTimer) {
            clearInterval(showcasePreviewTimer);
            showcasePreviewTimer = null;
        }
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
    document.getElementById("dashboard-invites-btn").addEventListener("click", toggleInvites);

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

    if (user.role === "admin") {
        adminState.profile = profile;
        adminState.overview = null;
        adminState.allQuizzes = null;
        adminState.users = null;
        try {
            adminState.overview = await fetchAdminOverview();
        } catch {
            adminState.overview = null;
        }
        renderAdminWorkspace(body);
        return;
    }

    body.innerHTML = profileCard(user, limits, quizzes.length) + quizzesSection(quizzes);
    wireQuizCardEvents(body);
}

function wireQuizCardEvents(container) {
    wireCopyButtons(container);
    initGlide(container);
    container.querySelector("#dashboard-create-btn")?.addEventListener("click", () => openEditor());
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
            if (adminState.allQuizzes) {
                adminState.allQuizzes = adminState.allQuizzes.filter(q => q.id !== btn.dataset.deleteQuiz);
            }
            document.dispatchEvent(new window.CustomEvent("quizleris-showcase-changed"));
            renderDashboard();
        });
    });
}

function setHeader(role) {
    const win = dashboardModal?.querySelector(".dash-window");
    if (win) win.classList.toggle("is-admin", role === "admin");

    document.getElementById("dashboard-title").textContent = role === "admin" ? t("profile.adminTitle")
        : role === "creator" ? t("profile.creatorTitle") : t("profile.teacherTitle");
    document.getElementById("dashboard-logout-btn").textContent = t("profile.logout");
    const invitesBtn = document.getElementById("dashboard-invites-btn");
    invitesBtn.hidden = role !== "admin";
    // The label hides on phones (style.css), leaving the key
    invitesBtn.innerHTML = `<span aria-hidden="true">🔑</span> <span class="dash-invites-label">${escapeHtml(t("invites.button"))}</span>`;
    invitesBtn.title = t("invites.button");
    invitesBtn.setAttribute("aria-label", t("invites.button"));
    invitesBtn.setAttribute("aria-expanded", String(role === "admin" && activeAdminTab === "invites"));
}

// --- Admin Multi-Tab Workspace ---

function switchAdminTab(tab) {
    if (showcasePreviewTimer) {
        clearInterval(showcasePreviewTimer);
        showcasePreviewTimer = null;
    }
    activeAdminTab = tab;
    const invitesBtn = document.getElementById("dashboard-invites-btn");
    if (invitesBtn) invitesBtn.setAttribute("aria-expanded", String(tab === "invites"));
    const body = document.getElementById("dashboard-body");
    if (body && adminState.profile) {
        renderAdminWorkspace(body);
    }
}

function renderAdminWorkspace(body) {
    const ov = adminState.overview;
    const pendingTotal = (ov?.bank?.pendingReview || 0) + (ov?.bank?.openReports || 0);
    const tabs = [
        { id: "overview", icon: "📊", label: t("adminGui.tabOverview"), badge: pendingTotal > 0 ? pendingTotal : null },
        { id: "quizzes", icon: "🗂", label: t("adminGui.tabAllQuizzes"), badge: ov?.quizzes?.total ?? null },
        { id: "showcase", icon: "✨", label: t("adminGui.tabShowcase"), badge: ov?.quizzes?.featured ?? null },
        { id: "users", icon: "👥", label: t("adminGui.tabUsers"), badge: ov?.users?.total ?? null },
        { id: "invites", icon: "🔑", label: t("adminGui.tabInvites"), badge: null },
        { id: "mine", icon: "📝", label: t("adminGui.tabMyQuizzes"), badge: adminState.profile?.quizzes?.length ?? null },
    ];

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
    else if (activeAdminTab === "mine") renderAdminMyQuizzesTab(panel);
    else if (activeAdminTab === "quizzes") renderAdminAllQuizzesTab(panel);
    else if (activeAdminTab === "showcase") renderAdminShowcaseTab(panel);
    else if (activeAdminTab === "users") renderAdminUsers(panel);
    else if (activeAdminTab === "invites") {
        panel.innerHTML = `<section class="dash-section dash-invites" id="dash-invites"></section>`;
        const sec = panel.querySelector("#dash-invites");
        buildInvites(sec);
        loadInvites(sec);
    }
}

function renderAdminOverviewTab(panel) {
    const { user, limits, quizzes } = adminState.profile;
    const ov = adminState.overview;

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
            .replace("{pub}", ov.quizzes.publicCount)
            .replace("{priv}", ov.quizzes.privateCount)
            .replace("{feat}", ov.quizzes.featured)
        : "";

    const aTotal = ov?.quizzes?.attempts ?? "—";
    const bTotal = ov?.bank?.published ?? "—";
    const bSub = ov
        ? t("adminGui.bankBreakdown")
            .replace("{pub}", ov.bank.published)
            .replace("{rev}", ov.bank.pendingReview)
            .replace("{flag}", ov.bank.openReports)
        : "";

    const pendingCount = ov?.bank?.pendingReview ?? 0;
    const flaggedCount = ov?.bank?.openReports ?? 0;
    const featuredCount = ov?.quizzes?.featured ?? 0;

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
                <div class="dash-overview-card">
                    <div class="dash-overview-label">🎯 ${escapeHtml(t("adminGui.totalAttempts"))}</div>
                    <div class="dash-overview-val">${escapeHtml(aTotal)}</div>
                    <div class="dash-overview-sub">${escapeHtml(t("adminGui.attemptsSub"))}</div>
                </div>
                <div class="dash-overview-card">
                    <div class="dash-overview-label">📚 ${escapeHtml(t("adminGui.bankTasks"))}</div>
                    <div class="dash-overview-val">${escapeHtml(bTotal)}</div>
                    <div class="dash-overview-sub">${escapeHtml(bSub)}</div>
                </div>
            </div>

            <div class="dash-moderation-box">
                <div class="dash-moderation-title">${escapeHtml(t("adminGui.moderationTitle"))}</div>
                <div class="dash-moderation-actions">
                    <button type="button" class="btn ${pendingCount > 0 ? "btn-primary" : "btn-secondary"}" data-open-bank-queue="review">
                        ${escapeHtml(t("adminGui.openReviewQueue").replace("{n}", pendingCount))}
                    </button>
                    <button type="button" class="btn ${flaggedCount > 0 ? "btn-primary" : "btn-secondary"}" data-open-bank-queue="flagged">
                        ${escapeHtml(t("adminGui.openFlaggedQueue").replace("{n}", flaggedCount))}
                    </button>
                    <button type="button" class="btn btn-secondary" data-open-bank-editor="1">
                        ${escapeHtml(t("adminGui.openBankEditor"))}
                    </button>
                    <button type="button" class="btn btn-secondary" data-jump-tab="showcase">
                        ${escapeHtml(t("adminGui.manageShowcaseBtn").replace("{n}", featuredCount))}
                    </button>
                </div>
            </div>
        </section>
        ${profileCard(user, limits, quizzes.length)}
    `;

    initGlide(panel);
    panel.querySelectorAll("[data-jump-tab]").forEach(btn => {
        btn.addEventListener("click", () => switchAdminTab(btn.dataset.jumpTab));
    });
    panel.querySelectorAll("[data-open-bank-queue]").forEach(btn => {
        btn.addEventListener("click", () => openEditor(undefined, btn.dataset.openBankQueue));
    });
    panel.querySelector("[data-open-bank-editor]")?.addEventListener("click", () => openEditor());
}

function renderAdminMyQuizzesTab(panel) {
    const quizzes = adminState.profile?.quizzes || [];
    panel.innerHTML = quizzesSection(quizzes);
    wireQuizCardEvents(panel);
}

async function renderAdminAllQuizzesTab(panel) {
    if (!adminState.allQuizzes) {
        panel.innerHTML = `<p class="dash-muted">${t("profile.loading")}</p>`;
        try {
            adminState.allQuizzes = await fetchAdminQuizzes();
        } catch (e) {
            panel.innerHTML = `<p class="dash-muted">${escapeHtml(e.message)}</p>`;
            return;
        }
    }

    const all = adminState.allQuizzes;
    const countAll = all.length;
    const countFeatured = all.filter(q => q.featured).length;
    const countPublic = all.filter(q => q.visibility === "public").length;
    const countPrivate = all.filter(q => q.visibility !== "public").length;

    panel.innerHTML = `
        <section class="dash-section">
            <div class="dash-section-head">
                <h3>${escapeHtml(t("adminGui.allQuizzesTitle"))} <span class="dash-muted">(${countAll})</span></h3>
                <button id="dashboard-create-btn" class="btn btn-primary">+ ${t("profile.createQuiz")}</button>
            </div>
            <div class="dash-filter-bar">
                <input type="search" id="dash-quiz-search" class="input-field dash-search-input" placeholder="${escapeHtml(t("adminGui.searchQuizzes"))}" value="${escapeHtml(adminState.quizSearch)}">
                <div class="dash-filter-chips" role="group">
                    <button type="button" class="dash-filter-chip${adminState.quizFilter === "all" ? " is-active" : ""}" data-qfilter="all">${escapeHtml(t("adminGui.filterAll"))} <span>${countAll}</span></button>
                    <button type="button" class="dash-filter-chip${adminState.quizFilter === "featured" ? " is-active" : ""}" data-qfilter="featured">${escapeHtml(t("adminGui.filterFeatured"))} <span>${countFeatured}</span></button>
                    <button type="button" class="dash-filter-chip${adminState.quizFilter === "public" ? " is-active" : ""}" data-qfilter="public">${escapeHtml(t("adminGui.filterPublic"))} <span>${countPublic}</span></button>
                    <button type="button" class="dash-filter-chip${adminState.quizFilter === "private" ? " is-active" : ""}" data-qfilter="private">${escapeHtml(t("adminGui.filterPrivate"))} <span>${countPrivate}</span></button>
                </div>
            </div>
            <div id="dash-all-quizzes-list" class="dash-quiz-list"></div>
        </section>
    `;

    const searchInput = panel.querySelector("#dash-quiz-search");
    const listEl = panel.querySelector("#dash-all-quizzes-list");

    const drawList = () => {
        const qStr = adminState.quizSearch.trim().toLowerCase();
        const filtered = adminState.allQuizzes.filter(q => {
            if (adminState.quizFilter === "featured" && !q.featured) return false;
            if (adminState.quizFilter === "public" && q.visibility !== "public") return false;
            if (adminState.quizFilter === "private" && q.visibility === "public") return false;
            if (!qStr) return true;
            return (
                (q.title || "").toLowerCase().includes(qStr) ||
                (q.id || "").toLowerCase().includes(qStr) ||
                (q.author || "").toLowerCase().includes(qStr) ||
                (q.author_email || "").toLowerCase().includes(qStr)
            );
        });

        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="dash-empty"><p class="dash-muted">${escapeHtml(t("adminGui.noQuizzesMatch"))}</p></div>`;
            return;
        }

        listEl.innerHTML = filtered.map(q => {
            const isPublic = q.visibility === "public";
            const authorLabel = q.author ? t("adminGui.byAuthor").replace("{author}", q.author) : "—";
            return `
                <div class="dash-quiz" data-glide>
                    <div class="dash-quiz-main">
                        <div class="dash-quiz-title-row">
                            <button type="button" class="dash-star-btn${q.featured ? " is-active" : ""}" data-feature-quiz="${escapeHtml(q.id)}" title="${escapeHtml(t("adminGui.featureToggle"))}" aria-label="${escapeHtml(t("adminGui.featureToggle"))}" aria-pressed="${Boolean(q.featured)}">★</button>
                            <div class="dash-quiz-title">${escapeHtml(q.title || "—")}</div>
                            ${q.featured ? `<span class="dash-chip featured">⭐ ${escapeHtml(t("adminGui.featuredBadge"))}</span>` : ""}
                        </div>
                        <div class="dash-quiz-meta">
                            <button type="button" class="dash-chip dash-chip-btn ${isPublic ? "public" : "private"}" data-toggle-vis="${escapeHtml(q.id)}" title="${escapeHtml(t("adminGui.toggleVisibility"))}">${isPublic ? t("profile.public") : t("profile.private")}</button>
                            <span class="dash-muted">${escapeHtml(t("adminGui.questionsCount").replace("{n}", q.question_count ?? 0))}</span>
                            <span class="dash-muted">· ${escapeHtml(authorLabel)}</span>
                            <span class="dash-muted">· ${t("profile.updated")} ${escapeHtml(formatDate(q.updated_at || q.created_at))}</span>
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
        }).join("");

        wireQuizCardEvents(listEl);

        listEl.querySelectorAll("[data-feature-quiz]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const qId = btn.dataset.featureQuiz;
                const item = adminState.allQuizzes.find(x => x.id === qId);
                if (!item) return;
                btn.disabled = true;
                const nextFeatured = !item.featured;
                const res = await updateAdminQuiz(qId, {
                    featured: nextFeatured,
                    featured_order: nextFeatured ? Date.now() % 100000 : 0
                });
                btn.disabled = false;
                if (!res.ok) {
                    await alertDialog(t("profile.loadError"), res.data?.error || "");
                    return;
                }
                item.featured = nextFeatured;
                if (adminState.overview?.quizzes) {
                    adminState.overview.quizzes.featured = adminState.allQuizzes.filter(x => x.featured).length;
                }
                document.dispatchEvent(new window.CustomEvent("quizleris-showcase-changed"));
                renderAdminAllQuizzesTab(panel);
                updateAdminTabBadges();
            });
        });

        listEl.querySelectorAll("[data-toggle-vis]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const qId = btn.dataset.toggleVis;
                const item = adminState.allQuizzes.find(x => x.id === qId);
                if (!item) return;
                btn.disabled = true;
                const nextVis = item.visibility === "public" ? "private" : "public";
                const res = await updateAdminQuiz(qId, { visibility: nextVis });
                btn.disabled = false;
                if (!res.ok) {
                    await alertDialog(t("profile.loadError"), res.data?.error || "");
                    return;
                }
                item.visibility = nextVis;
                renderAdminAllQuizzesTab(panel);
            });
        });
    };

    searchInput.addEventListener("input", () => {
        adminState.quizSearch = searchInput.value;
        drawList();
    });

    panel.querySelectorAll("[data-qfilter]").forEach(chip => {
        chip.addEventListener("click", () => {
            adminState.quizFilter = chip.dataset.qfilter;
            panel.querySelectorAll("[data-qfilter]").forEach(c => c.classList.toggle("is-active", c === chip));
            drawList();
        });
    });

    panel.querySelector("#dashboard-create-btn")?.addEventListener("click", () => openEditor());
    drawList();
}

function updateAdminTabBadges() {
    const body = document.getElementById("dashboard-body");
    if (!body) return;
    const featCount = adminState.allQuizzes
        ? adminState.allQuizzes.filter(q => q.featured).length
        : adminState.overview?.quizzes?.featured;
    const showcaseTab = body.querySelector('[data-admin-tab="showcase"] .dash-admin-tab-badge');
    if (showcaseTab && featCount != null) showcaseTab.textContent = String(featCount);
}

async function renderAdminShowcaseTab(panel) {
    if (showcasePreviewTimer) {
        clearInterval(showcasePreviewTimer);
        showcasePreviewTimer = null;
    }

    if (!adminState.allQuizzes) {
        panel.innerHTML = `<p class="dash-muted">${t("profile.loading")}</p>`;
        try {
            adminState.allQuizzes = await fetchAdminQuizzes();
        } catch (e) {
            panel.innerHTML = `<p class="dash-muted">${escapeHtml(e.message)}</p>`;
            return;
        }
    }

    const showcaseCfg = adminState.overview?.showcase || {
        enabled: true,
        intervalSeconds: 4,
        action: "fill"
    };

    const featured = adminState.allQuizzes
        .filter(q => q.featured)
        .sort((a, b) => (a.featured_order || 0) - (b.featured_order || 0));

    panel.innerHTML = `
        <section class="dash-section">
            <div class="dash-section-head"><h3>✨ ${escapeHtml(t("adminGui.showcaseTitle"))}</h3></div>
            <p class="dash-muted">${escapeHtml(t("adminGui.showcaseIntro"))}</p>

            <div class="dash-showcase-preview-box">
                <span class="dash-showcase-preview-label">${escapeHtml(t("adminGui.showcaseLivePreview"))}</span>
                <p class="hero-pin-hint" id="dash-showcase-preview-hint"></p>
            </div>

            <form class="dash-showcase-form" id="dash-showcase-form">
                <label class="dash-showcase-check">
                    <input type="checkbox" name="enabled" ${showcaseCfg.enabled !== false ? "checked" : ""}>
                    <span>${escapeHtml(t("adminGui.showcaseEnabled"))}</span>
                </label>
                <div class="dash-showcase-fields">
                    <label>
                        <span>${escapeHtml(t("adminGui.showcaseInterval"))}</span>
                        <input type="number" name="intervalSeconds" class="input-field" min="2" max="30" value="${Number(showcaseCfg.intervalSeconds) || 4}">
                    </label>
                    <label>
                        <span>${escapeHtml(t("adminGui.showcaseAction"))}</span>
                        <select name="action" class="admin-select-compact">
                            <option value="fill" ${showcaseCfg.action !== "start" ? "selected" : ""}>${escapeHtml(t("adminGui.showcaseActionFill"))}</option>
                            <option value="start" ${showcaseCfg.action === "start" ? "selected" : ""}>${escapeHtml(t("adminGui.showcaseActionStart"))}</option>
                        </select>
                    </label>
                    <button type="submit" class="btn btn-primary">${escapeHtml(t("adminGui.showcaseSave"))}</button>
                </div>
            </form>

            <div class="dash-section-head" style="margin-top: 20px;">
                <h4>${escapeHtml(t("adminGui.showcaseOrderTitle"))} <span class="dash-muted">(${featured.length})</span></h4>
                <button type="button" class="btn btn-secondary btn-compact" data-go-pick-quizzes="1">${escapeHtml(t("adminGui.showcasePickQuizzes"))}</button>
            </div>
            ${featured.length === 0 ? `
                <div class="dash-empty">
                    <p class="dash-muted">${escapeHtml(t("adminGui.showcaseEmpty"))}</p>
                </div>
            ` : `
                <div class="dash-showcase-list" id="dash-showcase-list">
                    ${featured.map((q, idx) => `
                        <div class="dash-showcase-item" data-id="${escapeHtml(q.id)}">
                            <span class="dash-showcase-pos">#${idx + 1}</span>
                            <code class="dash-showcase-code">${escapeHtml(q.id)}</code>
                            <div class="dash-showcase-info">
                                <div class="dash-showcase-item-title">${escapeHtml(q.title || "—")}</div>
                                <div class="dash-muted">${escapeHtml(q.author ? t("adminGui.byAuthor").replace("{author}", q.author) : "")}</div>
                            </div>
                            <div class="dash-showcase-item-actions">
                                <button type="button" class="btn btn-secondary btn-icon btn-compact" data-move-dir="-1" data-idx="${idx}" ${idx === 0 ? "disabled" : ""} title="${escapeHtml(t("admin.moveUp"))}" aria-label="${escapeHtml(t("admin.moveUp"))}">↑</button>
                                <button type="button" class="btn btn-secondary btn-icon btn-compact" data-move-dir="1" data-idx="${idx}" ${idx === featured.length - 1 ? "disabled" : ""} title="${escapeHtml(t("admin.moveDown"))}" aria-label="${escapeHtml(t("admin.moveDown"))}">↓</button>
                                <button type="button" class="btn btn-secondary btn-icon btn-compact" data-unfeature="${escapeHtml(q.id)}" title="${escapeHtml(t("adminGui.showcaseRemove"))}" aria-label="${escapeHtml(t("adminGui.showcaseRemove"))}">✕</button>
                            </div>
                        </div>
                    `).join("")}
                </div>
            `}
        </section>
    `;

    // Live preview inside the Showcase tab
    const previewHint = panel.querySelector("#dash-showcase-preview-hint");
    if (previewHint) {
        if (!showcaseCfg.enabled || featured.length === 0) {
            previewHint.textContent = t("menu.pinHint");
        } else {
            let pIdx = 0;
            const drawPreview = (item, animate) => {
                previewHint.innerHTML = `${escapeHtml(t("menu.pinHintPrefix"))} <button type="button" class="hero-code-ticker${animate ? " is-flipping" : ""}"><span class="hero-code-val">${escapeHtml(item.id)}</span>${item.title ? `<span class="hero-code-title"> · ${escapeHtml(item.title)}</span>` : ""}</button>.`;
            };
            drawPreview(featured[0], false);
            if (featured.length > 1) {
                const ms = Math.max(2000, Math.min(30000, (Number(showcaseCfg.intervalSeconds) || 4) * 1000));
                showcasePreviewTimer = setInterval(() => {
                    pIdx = (pIdx + 1) % featured.length;
                    drawPreview(featured[pIdx], true);
                }, ms);
            }
        }
    }

    panel.querySelector("[data-go-pick-quizzes]")?.addEventListener("click", () => {
        adminState.quizFilter = "all";
        switchAdminTab("quizzes");
    });

    const form = panel.querySelector("#dash-showcase-form");
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector("button[type=submit]");
        submitBtn.disabled = true;
        const payload = {
            enabled: form.enabled.checked,
            intervalSeconds: Math.max(2, Math.min(30, Number(form.intervalSeconds.value) || 4)),
            action: form.action.value === "start" ? "start" : "fill",
            featured_order: featured.map(q => q.id),
        };
        const res = await updateShowcaseSettings(payload);
        submitBtn.disabled = false;
        if (!res.ok) {
            await alertDialog(t("profile.loadError"), res.data?.error || "");
            return;
        }
        if (!adminState.overview) adminState.overview = {};
        adminState.overview.showcase = payload;
        submitBtn.textContent = t("adminGui.showcaseSaved");
        document.dispatchEvent(new window.CustomEvent("quizleris-showcase-changed"));
        setTimeout(() => {
            if (panel.isConnected) renderAdminShowcaseTab(panel);
        }, 700);
    });

    panel.querySelectorAll("[data-move-dir]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const idx = Number(btn.dataset.idx);
            const dir = Number(btn.dataset.moveDir);
            const swapIdx = idx + dir;
            if (swapIdx < 0 || swapIdx >= featured.length) return;
            const temp = featured[idx];
            featured[idx] = featured[swapIdx];
            featured[swapIdx] = temp;
            featured.forEach((q, i) => { q.featured_order = i + 1; });

            const payload = {
                enabled: form.enabled.checked,
                intervalSeconds: Math.max(2, Math.min(30, Number(form.intervalSeconds.value) || 4)),
                action: form.action.value === "start" ? "start" : "fill",
                featured_order: featured.map(q => q.id),
            };
            await updateShowcaseSettings(payload);
            if (!adminState.overview) adminState.overview = {};
            adminState.overview.showcase = payload;
            document.dispatchEvent(new window.CustomEvent("quizleris-showcase-changed"));
            renderAdminShowcaseTab(panel);
        });
    });

    panel.querySelectorAll("[data-unfeature]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const qId = btn.dataset.unfeature;
            btn.disabled = true;
            const res = await updateAdminQuiz(qId, { featured: false, featured_order: 0 });
            if (!res.ok) {
                btn.disabled = false;
                return;
            }
            const item = adminState.allQuizzes.find(q => q.id === qId);
            if (item) item.featured = false;
            if (adminState.overview?.quizzes) {
                adminState.overview.quizzes.featured = adminState.allQuizzes.filter(x => x.featured).length;
            }
            document.dispatchEvent(new window.CustomEvent("quizleris-showcase-changed"));
            updateAdminTabBadges();
            renderAdminShowcaseTab(panel);
        });
    });
}

// --- Registration codes (admins): opened from the header button or tab ---

function toggleInvites() {
    const cachedUser = getCurrentUser();
    if (cachedUser?.role === "admin") {
        switchAdminTab(activeAdminTab === "invites" ? "overview" : "invites");
        return;
    }
    const section = document.getElementById("dash-invites");
    const btn = document.getElementById("dashboard-invites-btn");
    if (!section) return; // the dashboard is still loading
    const open = section.hidden;
    section.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (!open) return;
    if (!section.dataset.built) buildInvites(section);
    loadInvites(section);
    section.scrollIntoView({ block: "nearest" });
}

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
        <div class="dash-invite-list"><p class="dash-muted">${t("profile.loading")}</p></div>
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
function openEditor(quizId, bankQueue) {
    if (showcasePreviewTimer) {
        clearInterval(showcasePreviewTimer);
        showcasePreviewTimer = null;
    }
    const win = dashboardModal.querySelector(".dash-window");
    const from = win ? { rect: win.getBoundingClientRect(), node: win.cloneNode(true) } : null;
    dashboardModal.style.display = "none";
    document.dispatchEvent(new window.CustomEvent("open-editor", { detail: { quizId, bankQueue, from } }));
}

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
    if (!adminState.users) {
        container.innerHTML = `<p class="dash-muted">${t("profile.loading")}</p>`;
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
