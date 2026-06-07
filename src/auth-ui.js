import { loginWithEmail, loginWithGoogle, logout, subscribeToAuthChanges } from "./firebase-service.js";

let authModal = null;
let currentUser = null;

export function initAuthUI() {
    // Inject Modal HTML
    const modalHTML = `
        <div id="auth-modal" class="modal-overlay" style="display: none; align-items: center; justify-content: center; z-index: 10000;">
            <div class="modal-content glass-card" style="max-width: 400px; width: 100%; padding: 30px; text-align: center;">
                <h2 style="margin-bottom: 20px; color: var(--text);">Prisijungti</h2>
                <input type="email" id="auth-email" class="input-field" placeholder="El. paštas" style="width: 100%; margin-bottom: 10px;" />
                <input type="password" id="auth-password" class="input-field" placeholder="Slaptažodis" style="width: 100%; margin-bottom: 20px;" />
                <button id="auth-login-btn" class="btn btn-primary" style="width: 100%; margin-bottom: 10px;">Prisijungti su El. paštu</button>
                <div style="margin: 15px 0; color: rgba(255,255,255,0.5);">— arba —</div>
                <button id="auth-google-btn" class="btn btn-secondary" style="width: 100%; margin-bottom: 20px;">Prisijungti su Google</button>
                <button id="auth-close-btn" class="btn" style="width: 100%;">Atšaukti</button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML("beforeend", modalHTML);
    authModal = document.getElementById("auth-modal");

    // Event Listeners
    document.getElementById("auth-close-btn").addEventListener("click", () => {
        authModal.style.display = "none";
    });

    document.getElementById("auth-login-btn").addEventListener("click", async () => {
        const email = document.getElementById("auth-email").value;
        const pass = document.getElementById("auth-password").value;
        if (!email || !pass) return alert("Įveskite duomenis");
        try {
            await loginWithEmail(email, pass);
            authModal.style.display = "none";
        } catch (e) {
            alert("Klaida: " + e.message);
        }
    });

    document.getElementById("auth-google-btn").addEventListener("click", async () => {
        try {
            await loginWithGoogle();
            authModal.style.display = "none";
        } catch (e) {
            alert("Klaida: " + e.message);
        }
    });

    // Subscribe to state changes
    subscribeToAuthChanges((user) => {
        currentUser = user;
        updateMenuAuthButton();
    });
}

export function showAuthModal() {
    if (authModal) authModal.style.display = "flex";
}

export function getCurrentUser() {
    return currentUser;
}

function updateMenuAuthButton() {
    const btn = document.getElementById("menu-auth-btn");
    if (!btn) return;
    
    if (currentUser) {
        btn.textContent = currentUser.role === "owner" ? "Owner Dashboard" : "Teacher Dashboard";
        btn.onclick = () => {
            // Trigger Dashboard Open Event
            document.dispatchEvent(new CustomEvent("open-dashboard"));
        };
    } else {
        btn.textContent = "Prisijungti";
        btn.onclick = showAuthModal;
    }
}
