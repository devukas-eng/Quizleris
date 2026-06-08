import { login, register, getToken } from "./api.js";

let authModal = null;
let currentUser = null;

export function initAuthUI() {
    // Inject Modal HTML
    const modalHTML = `
        <div id="auth-modal" class="modal-overlay" style="display: none; align-items: center; justify-content: center; z-index: 10000;">
            <div class="modal-content glass-card" style="max-width: 400px; width: 100%; padding: 30px; text-align: center;">
                <h2 id="auth-title" style="margin-bottom: 20px; color: var(--text);">Prisijungti</h2>
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

    let isRegistering = false;

    // Event Listeners
    document.getElementById("auth-close-btn").addEventListener("click", () => {
        authModal.style.display = "none";
    });

    document.getElementById("auth-toggle-btn").addEventListener("click", () => {
        isRegistering = !isRegistering;
        document.getElementById("auth-title").textContent = isRegistering ? "Registracija" : "Prisijungti";
        document.getElementById("auth-email").style.display = isRegistering ? "block" : "none";
        document.getElementById("auth-submit-btn").textContent = isRegistering ? "Registruotis" : "Prisijungti";
        document.getElementById("auth-toggle-btn").textContent = isRegistering ? "Turite paskyrą? Prisijungti" : "Neturite paskyros? Registruotis";
    });

    document.getElementById("auth-submit-btn").addEventListener("click", async () => {
        const username = document.getElementById("auth-username").value;
        const email = document.getElementById("auth-email").value;
        const pass = document.getElementById("auth-password").value;
        
        if (!username || !pass || (isRegistering && !email)) return alert("Įveskite duomenis");
        
        try {
            if (isRegistering) {
                await register(username, email, pass);
                alert("Registracija sėkminga! Dabar galite prisijungti.");
                document.getElementById("auth-toggle-btn").click(); // switch back to login
            } else {
                currentUser = await login(username, pass);
                authModal.style.display = "none";
                updateMenuAuthButton();
            }
        } catch (e) {
            alert("Klaida: " + e.message);
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
    } catch(e) {}
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
