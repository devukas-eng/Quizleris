const fs = require('fs');
let c = fs.readFileSync('src/quiz-editor.js', 'utf8');

c = c.replace(/function renderQuestionNavigator\(\) \{[\s\S]*?\n\}/, '');
c = c.replace('  renderQuestionNavigator();\n', '');
c = c.replace('  renderQuestionNavigator();\n', '');
c = c.replace('  renderQuestionNavigator();\n', '');
c = c.replace('  renderQuestionNavigator();\n', '');

fs.writeFileSync('src/quiz-editor.js', c);
