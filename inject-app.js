const fs = require('fs');

let c = fs.readFileSync('src/app.js', 'utf8');

c = c.replace('import { initAnalytics', 'import { initAuthUI } from "./auth-ui.js";\nimport { initDashboardUI } from "./dashboard-ui.js";\nimport { initAnalytics');

c = c.replace('function initApp() {\n    try {\n        // Initialize analytics', 'function initApp() {\n    try {\n        initAuthUI();\n        initDashboardUI();\n        // Initialize analytics');

fs.writeFileSync('src/app.js', c);
