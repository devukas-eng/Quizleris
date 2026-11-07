// What each kind of account may do. The server decides with these; /api/me hands the result to
// the page as `capabilities`. docs/planai.md compares the plans side by side: change both together.
//
// Kinds of account: a free teacher, a premium teacher (subscription_tier 'premium', until
// subscription_expires_at if set), a creator (kūrėjas, in-house task-bank staff) and an admin.
// Students have no account.

const FREE_QUIZ_LIMIT = 5;
// The free plan keeps a quiz only while its teacher keeps it: saving it or clicking Renew gives it
// KEEP_DAYS. Not renewed, it pauses (students cannot open it) for PAUSE_DAYS, during which Renew
// still brings it back, and then it is deleted for good with its results. Premium never renews.
const KEEP_DAYS = 7;
// ...but only from day FIRST_DAYS: a new quiz is kept that long from its creation without renewing
const FIRST_DAYS = 30;
const PAUSE_DAYS = 3;
// A deleted or expired quiz waits this long, with its results, before it is deleted for good.
// Only premium may bring one back: the wait on the free plan is the time to upgrade.
const RECOVERY_DAYS = { free: 14, premium: 30 };
// Earlier versions of each quiz kept for its owner
const VERSIONS_KEPT = { free: 5, premium: 30 };

// Premium with no expiry date never lapses; with a date, it lapses once that date passes.
const hasActivePremium = (user) =>
    user.subscription_tier === 'premium' &&
    (!user.subscription_expires_at || new Date(user.subscription_expires_at) > new Date());

// Staff get everything premium gives: admins, and creators (in-house task-bank authors)
const isPremium = (user) => user.role === 'admin' || user.role === 'creator' || hasActivePremium(user);

function planOf(user) {
    if (user.role === 'admin') return 'admin';
    if (user.role === 'creator') return 'creator';
    return hasActivePremium(user) ? 'premium' : 'free';
}

/** The plan limits for one user, as sent to the page */
function planCapabilities(user) {
    const premium = isPremium(user);
    return {
        plan: planOf(user),
        max_quizzes: premium ? null : FREE_QUIZ_LIMIT,
        first_days: premium ? null : FIRST_DAYS,
        keep_days: premium ? null : KEEP_DAYS,
        pause_days: premium ? null : PAUSE_DAYS,
        // Importing several files at once (checked in the page: importing runs in the browser)
        import_many: premium,
        // Own themes and the chosen theme saved in the account, so they follow to other devices
        theme_sync: premium,
        recovery_days: recoveryDays(user),
        restore_quizzes: premium,
        versions_kept: versionsKept(user),
    };
}

/** Until when a free quiz created at `createdAt` (null: now) stays after being saved or renewed `now`. */
function keepUntil(createdAt, now = new Date()) {
    const day = 24 * 3600 * 1000;
    const created = createdAt ? new Date(createdAt) : now;
    return new Date(Math.max(created.getTime() + FIRST_DAYS * day, now.getTime() + KEEP_DAYS * day));
}

const recoveryDays =(user) => (user && isPremium(user) ? RECOVERY_DAYS.premium : RECOVERY_DAYS.free);
const versionsKept = (user) => (user && isPremium(user) ? VERSIONS_KEPT.premium : VERSIONS_KEPT.free);

module.exports = {
    FREE_QUIZ_LIMIT, FIRST_DAYS, KEEP_DAYS, PAUSE_DAYS, keepUntil, RECOVERY_DAYS, VERSIONS_KEPT,
    hasActivePremium, isPremium, planCapabilities, recoveryDays, versionsKept
};
