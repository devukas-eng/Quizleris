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
    // Legacy password prompt removed.
    // Dashboard and Editor are now protected by Firebase Auth & user roles.
    // The "Prisijungti" flow ensures only admins/owners can access the dashboard.
    return true;
}
