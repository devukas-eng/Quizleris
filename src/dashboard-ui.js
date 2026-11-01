import { getCurrentUser, showAuthModal, logoutUser } from "./auth-ui.js";
import { fetchAllUsers } from "./api.js";
import { getAllQuizIds, loadQuizFromStorage } from "./storage.js";

let dashboardModal = null;

export function initDashboardUI() {
    const modalHTML = `
        <div id="dashboard-modal" class="modal-overlay" style="display: none; align-items: center; justify-content: center; z-index: 9999;">
            <div class="modal-content glass-card" style="max-width: 800px; width: 100%; height: 80vh; padding: 30px; display: flex; flex-direction: column;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2 id="dashboard-title" style="margin: 0;">Dashboard</h2>
                    <button id="dashboard-logout-btn" class="btn btn-secondary" style="margin-left: auto; margin-right: 10px;">Atsijungti</button>
                    <button id="dashboard-modal-close-btn" class="btn" style="background: none; border: none; font-size: 1.5rem;">&times;</button>
                </div>
                <div id="dashboard-body" style="flex: 1; overflow-y: auto;">
                    <!-- Content injected here -->
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML("beforeend", modalHTML);
    dashboardModal = document.getElementById("dashboard-modal");

    document.getElementById("dashboard-modal-close-btn").addEventListener("click", () => {
        dashboardModal.style.display = "none";
    });

    document.getElementById("dashboard-logout-btn").addEventListener("click", () => {
        logoutUser();
        dashboardModal.style.display = "none";
    });

    document.addEventListener("open-dashboard", async () => {
        const user = getCurrentUser();
        if (!user) {
            showAuthModal();
            return;
        }
        
        dashboardModal.style.display = "flex";
        const body = document.getElementById("dashboard-body");
        document.getElementById("dashboard-title").textContent = user.role === "admin" ? "Administratoriaus Skydelis" : "Mokytojo Skydelis";
        
        if (user.role === "admin") {
            body.innerHTML = "<p>Kraunama...</p>";
            let users;
            try {
                users = await fetchAllUsers();
            } catch (e) {
                body.innerHTML = `<p>${escapeHtml(e.message)}</p>`;
                return;
            }
            let html = `<h3>Vartotojai</h3><table style="width: 100%; border-collapse: collapse;">
                <tr style="border-bottom: 1px solid var(--border-color);"><th style="padding: 10px; text-align: left;">El. paštas</th><th>Vartotojas</th><th>Rolė</th><th>Planas</th></tr>`;
            users.forEach(u => {
                html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <td style="padding: 10px;">${escapeHtml(u.email)}</td>
                    <td style="text-align: center;">${escapeHtml(u.username)}</td>
                    <td style="text-align: center;">${escapeHtml(u.role)}</td>
                    <td style="text-align: center;">${escapeHtml(u.subscription_tier)}</td>
                </tr>`;
            });
            html += `</table>`;
            body.innerHTML = html;
        } else {
            body.innerHTML = "<p>Kraunama...</p>";
            const quizIds = getAllQuizIds();
            const quizzes = quizIds.map(id => loadQuizFromStorage(id)).filter(q => q !== null);
            let html = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0;">Mano Testai</h3>
                    <button id="dashboard-create-btn" class="btn btn-primary">Sukurti naują testą</button>
                </div>
                <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin: 15px 0;" />
            `;
            if (quizzes.length === 0) {
                html += `<p>Jūs dar neturite sukurtų testų.</p>`;
            } else {
                html += `<div style="display: flex; flex-direction: column; gap: 10px;">`;
                quizzes.forEach(q => {
                    html += `
                        <div class="glass-card" style="padding: 15px; display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <h4 style="margin: 0 0 5px 0;">${escapeHtml(q.title || "Bevardis Testas")}</h4>
                                <div style="font-size: 0.8rem; color: rgba(255,255,255,0.7);">ID: ${escapeHtml(q.id)} | Limit: ${escapeHtml(q.maxStudents || "None")}</div>
                            </div>
                            <div style="display: flex; gap: 10px;">
                                <button class="btn btn-secondary">Rezultatai</button>
                                <button class="btn btn-primary">Redaguoti</button>
                            </div>
                        </div>
                    `;
                });
                html += `</div>`;
            }
            body.innerHTML = html;
            
            // Wire events
            const createBtn = document.getElementById("dashboard-create-btn");
            if (createBtn) {
                createBtn.addEventListener("click", () => {
                    dashboardModal.style.display = "none";
                    document.dispatchEvent(new window.CustomEvent("open-editor"));
                });
            }
        }
    });
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
