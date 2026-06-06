const fs = require('fs');
const execSync = require('child_process').execSync;

execSync('git checkout src/admin.js');

let c = fs.readFileSync('src/admin.js', 'utf8');
c = c.replace('let adminQuizTitle;', 'let adminQuizTitle;\nlet adminQuizVisibility;');
c = c.replace('adminQuizTitle = getRequiredElement("admin-quiz-title");', 'adminQuizTitle = getRequiredElement("admin-quiz-title");\n    adminQuizVisibility = getRequiredElement("admin-quiz-visibility");');
c = c.replace('adminQuizTitle.value = adminQuiz.title;', 'adminQuizTitle.value = adminQuiz.title;\n    adminQuizVisibility.value = adminQuiz.visibility || "private";');
c = c.replace('adminQuiz.title = adminQuizTitle.value;', 'adminQuiz.title = adminQuizTitle.value;\n    adminQuiz.visibility = adminQuizVisibility.value;');

let saveLogic = `    saveQuizToStorage(adminQuiz);
    const { shareCode, registry } = exportQuizForSharing(adminQuiz);
    saveImageRegistry(adminQuiz.id, registry);

    // Add to Community Quizzes if public
    if (adminQuiz.visibility === "public") {
        let community = [];
        try {
            community = JSON.parse(localStorage.getItem("quizleris_community_quizzes") || "[]");
        } catch(e) {}
        community = community.filter(q => q.id !== adminQuiz.id);
        community.unshift({
            id: adminQuiz.id,
            title: adminQuiz.title,
            qCount: adminQuiz.questions.length,
            shareCode: shareCode
        });
        localStorage.setItem("quizleris_community_quizzes", JSON.stringify(community));
    }

    if (shareCode.length > 8000)`;

c = c.replace(`    saveQuizToStorage(adminQuiz);\r\n    const { shareCode, registry } = exportQuizForSharing(adminQuiz);\r\n    saveImageRegistry(adminQuiz.id, registry);\r\n    if (shareCode.length > 8000)`, saveLogic);
c = c.replace(`    saveQuizToStorage(adminQuiz);\n    const { shareCode, registry } = exportQuizForSharing(adminQuiz);\n    saveImageRegistry(adminQuiz.id, registry);\n    if (shareCode.length > 8000)`, saveLogic);

fs.writeFileSync('src/admin.js', c);
