const fs = require('fs');
let c = fs.readFileSync('src/quiz-editor.js', 'utf8');

const regex = /function renderQuestionNavigator\(\) \{[\s\S]*?(?=\nfunction |$)/;
c = c.replace(regex, '');

// also replace any lingering function calls globally
c = c.replace(/renderQuestionNavigator\(\);\n?/g, '');

fs.writeFileSync('src/quiz-editor.js', c);
