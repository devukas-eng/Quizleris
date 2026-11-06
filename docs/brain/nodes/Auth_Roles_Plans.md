---
tags: [node, backend]
status: active
last_verified: 2026-11-06
---

## Purpose & Boundaries

Owns who a user is and what they may do: login, the JWT session, the roles teacher, creator and admin, invite codes, and free and premium limits. Browser checks only decide what to show, and the server enforces every write.

## Canonical File Map

- `src/auth.js`: session reads for the interface (`EDITOR_ROLES`, `getStoredUser`, `isAdminAccessAllowed`).
- `src/auth-ui.js`: the login and register modal (`showAuthModal`, `getCurrentUser`, `logoutUser`).
- `server.js`: `/api/auth/register`, `/api/auth/login`, `/api/me`, `/api/admin/invites`, and `authenticateToken`, `optionalAuth` and `requireAdmin`.
- `src/backend/plans.js`: `FREE_QUIZ_LIMIT`, `PRIVATE_EXPIRY_DAYS`, `isPremium`, `hasActivePremium` and `planCapabilities`.
- `docs/planai.md`: side-by-side plan comparison.
- `tests/plans.test.js`: covers the plan rules.

## Connections & Data Flow

- Guards the routes in -> [[Backend_API]]
- Fires `quizleris-auth-changed` for -> [[Theme_System]] and [[Task_Bank]]
- Decides which tabs and buttons show in -> [[Dashboard]]
- Limits quiz creation in -> [[Quiz_Editor]]
- Decides bank access in -> [[Task_Bank]]

## Gotchas & Constraints

- Registration needs a single-use invite code from table `invite_codes`, for the role teacher or creator. Admins make codes from the dashboard header.
- `creator` means bank staff: shared bank writes and reports, but not classifier lists, purging or invites.
- `isPremium` covers admins, creators and active premium accounts. Hourly cleanup clears `expires_at` on private quizzes whose owner now has premium's limits.
- The session lives in `quizleris_jwt` and `quizleris_user`. Keep the `quizleris_` names, because the cookie policy names them, see [[Branding_Legal]].
- Hide staff-only controls with `hidden`, and rely on the `[hidden]` rule in [[Page_Shell]].
- To test a role locally without the form, see [[Local_Testing]].
