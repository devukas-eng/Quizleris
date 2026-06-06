const fs = require('fs');
let c = fs.readFileSync('src/admin.js', 'utf8');
c = c.replace('let adminQuizTitle;', 'let adminQuizTitle;\nlet adminQuizVisibility;');
c = c.replace('adminQuizTitle = getRequiredElement("admin-quiz-title");', 'adminQuizTitle = getRequiredElement("admin-quiz-title");\n    adminQuizVisibility = getRequiredElement("admin-quiz-visibility");');
c = c.replace('adminQuizTitle.value = adminQuiz.title;', 'adminQuizTitle.value = adminQuiz.title;\n    adminQuizVisibility.value = adminQuiz.visibility || "private";');
c = c.replace('adminQuiz.title = adminQuizTitle.value;', 'adminQuiz.title = adminQuizTitle.value;\n    adminQuiz.visibility = adminQuizVisibility.value;');
fs.writeFileSync('src/admin.js', c);
