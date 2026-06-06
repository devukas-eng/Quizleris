// Admin authentication constants
export const ADMIN_PASSWORD_KEY = "quiz_admin_password";
export const ADMIN_SESSION_KEY = "quiz_admin_session";
// Check if admin access is allowed (URL param ?admin=true or session flag)
export function isAdminAccessAllowed() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("admin") === "true")
        return true;
    // Check session storage for admin session
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === "true";
}
// Prompt for admin password
export function promptAdminPassword() {
    const storedPassword = localStorage.getItem(ADMIN_PASSWORD_KEY);
    // If no password set, set one now
    if (!storedPassword) {
        const newPassword = prompt("Set admin password (you'll need this to access admin mode):");
        if (!newPassword)
            return false;
        localStorage.setItem(ADMIN_PASSWORD_KEY, newPassword);
        sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
        return true;
    }
    // Verify password
    const entered = prompt("Enter admin password:");
    if (entered === storedPassword) {
        sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
        return true;
    }
    alert("Incorrect password.");
    return false;
}
