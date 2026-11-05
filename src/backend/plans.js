// What each kind of account may do. The server decides with these; /api/me hands the result to
// the page as `capabilities`. docs/planai.md compares the plans side by side: change both together.
//
// Kinds of account: a free teacher, a premium teacher (subscription_tier 'premium', until
// subscription_expires_at if set), a creator (kūrėjas, in-house task-bank staff) and an admin.
// Students have no account.

const FREE_QUIZ_LIMIT = 5;
const PRIVATE_EXPIRY_DAYS = 30;

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
        private_expiry_days: premium ? null : PRIVATE_EXPIRY_DAYS,
        // Importing several files at once (checked in the page: importing runs in the browser)
        import_many: premium,
        // Own themes and the chosen theme saved in the account, so they follow to other devices
        theme_sync: premium,
    };
}

module.exports = { FREE_QUIZ_LIMIT, PRIVATE_EXPIRY_DAYS, hasActivePremium, isPremium, planCapabilities };
