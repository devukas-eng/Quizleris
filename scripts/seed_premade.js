const pool = require('../src/backend/db.js');
const { seedPremadeQuizzes } = require('../src/backend/premade.js');

// Manual run of the seeding the server also does on boot: npm run db:seed
seedPremadeQuizzes(pool)
    .then(added => console.log(`✅ premade quizzes added: ${added}`))
    .catch(err => {
        console.error('❌ Seeding failed:', err.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
