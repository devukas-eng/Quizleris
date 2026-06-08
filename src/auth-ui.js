import { login, register, getToken } from "./api.js";

let authModal = null;
let currentUser = null;

export function initAuthUI() {
    // Inject Modal HTML
    const modalHTML = `
        <div id="auth-modal" class="modal-overlay" style="display: none; align-items: center; justify-content: center; z-index: 10000;">
            <div class="modal-content glass-card" style="max-width: 400px; width: 100%; padding: 30px; text-align: center;">
                <h2 id="auth-title" style="margin-bottom: 20px; color: var(--text);">Prisijungti</h2>
                <div id="auth-error-msg" style="color: #ff4d4d; background: rgba(255, 77, 77, 0.1); padding: 10px; border-radius: 8px; margin-bottom: 15px; display: none; font-size: 0.9em;"></div>
                <input type="text" id="auth-username" class="input-field" placeholder="Vartotojo vardas" style="width: 100%; margin-bottom: 10px;" />
                <input type="email" id="auth-email" class="input-field" placeholder="El. paštas (tik registracijai)" style="width: 100%; margin-bottom: 10px; display: none;" />
                <input type="password" id="auth-password" class="input-field" placeholder="Slaptažodis" style="width: 100%; margin-bottom: 20px;" />
                <button id="auth-submit-btn" class="btn btn-primary" style="width: 100%; margin-bottom: 10px;">Prisijungti</button>
                <button id="auth-toggle-btn" class="btn" style="width: 100%; margin-bottom: 10px; background: transparent;">Neturite paskyros? Registruotis</button>
                <button id="auth-close-btn" class="btn" style="width: 100%;">Atšaukti</button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML("beforeend", modalHTML);
    authModal = document.getElementById("auth-modal");
    const errorBox = document.getElementById("auth-error-msg");

    let isRegistering = false;

    function showError(msg) {
        if (!msg) {
            errorBox.style.display = "none";
            return;
        }
        errorBox.textContent = msg;
        errorBox.style.display = "block";
        // Shake animation for UX
        errorBox.style.animation = "shake 0.4s";
        setTimeout(() => errorBox.style.animation = "", 400);
    }

    // Event Listeners
    document.getElementById("auth-close-btn").addEventListener("click", () => {
        authModal.style.display = "none";
        showError(null);
    });

    document.getElementById("auth-toggle-btn").addEventListener("click", () => {
        isRegistering = !isRegistering;
        showError(null);
        document.getElementById("auth-title").textContent = isRegistering ? "Registracija" : "Prisijungti";
        document.getElementById("auth-email").style.display = isRegistering ? "block" : "none";
        document.getElementById("auth-submit-btn").textContent = isRegistering ? "Registruotis" : "Prisijungti";
        document.getElementById("auth-toggle-btn").textContent = isRegistering ? "Turite paskyrą? Prisijungti" : "Neturite paskyros? Registruotis";
    });

    document.getElementById("auth-submit-btn").addEventListener("click", async () => {
        showError(null);
        const username = document.getElementById("auth-username").value.trim();
        const email = document.getElementById("auth-email").value.trim();
        const pass = document.getElementById("auth-password").value;
        
        if (!username || !pass || (isRegistering && !email)) {
            return showError("Visi laukai yra privalomi.");
        }
        
        try {
            document.getElementById("auth-submit-btn").disabled = true;
            document.getElementById("auth-submit-btn").textContent = "Kraunama...";
            
            if (isRegistering) {
                await register(username, email, pass);
                document.getElementById("auth-email").value = "";
                document.getElementById("auth-password").value = "";
                showError("Registracija sėkminga! Dabar galite prisijungti.");
                errorBox.style.color = "#4dff88"; // green success message temporarily
                errorBox.style.background = "rgba(77, 255, 136, 0.1)";
                setTimeout(() => document.getElementById("auth-toggle-btn").click(), 2000);
            } else {
                currentUser = await login(username, pass);
                authModal.style.display = "none";
                updateMenuAuthButton();
            }
        } catch (e) {
            errorBox.style.color = "#ff4d4d"; // reset back to red error
            errorBox.style.background = "rgba(255, 77, 77, 0.1)";
            showError("Klaida: " + (e.message || "Nepavyko prisijungti prie serverio."));
        } finally {
            document.getElementById("auth-submit-btn").disabled = false;
            document.getElementById("auth-submit-btn").textContent = isRegistering ? "Registruotis" : "Prisijungti";
        }
    });

    // Check if already logged in via localStorage
    try {
        const token = getToken();
        if (token) {
            const savedUser = localStorage.getItem('quizleris_user');
            if (savedUser) {
                currentUser = JSON.parse(savedUser);
            }
        }
    } catch(e) {
        console.warn("Failed to parse user from localStorage", e);
    }
    updateMenuAuthButton();
}

export function showAuthModal() {
    if (authModal) authModal.style.display = "flex";
}

export function getCurrentUser() {
    return currentUser;
}

function updateMenuAuthButton() {
    const btn = document.getElementById("nav-auth-btn");
    if (!btn) return;
    
    if (currentUser) {
        btn.textContent = currentUser.role === "owner" ? "Owner Dashboard" : "Teacher Dashboard";
        btn.onclick = () => {
            // Trigger Dashboard Open Event
            document.dispatchEvent(new window.CustomEvent("open-dashboard"));
        };
    } else {
        btn.textContent = "Prisijungti";
        btn.onclick = showAuthModal;
    }
}
