const fs = require('fs');

// 1. Remove from quiz-editor.js
let js = fs.readFileSync('src/quiz-editor.js', 'utf8');
js = js.replace('let adminNavigator = null;', '');
js = js.replace('adminNavigator = getRequiredElement("admin-navigator");', '');
js = js.replace(/if \(adminNavigator\) \{\s*adminNavigator\.style\.display = adminMode \? "flex" : "none";\s*\}/, '');
js = js.replace(/function renderQuestionNavigator\(\) \{[\s\S]*?\}(?=\nfunction setupAdmin)/, '');
js = js.replace('renderQuestionNavigator();', '');
js = js.replace('renderQuestionNavigator();', '');
js = js.replace('renderQuestionNavigator();', '');
fs.writeFileSync('src/quiz-editor.js', js);

// 2. Remove CSS from style.css
let css = fs.readFileSync('src/style.css', 'utf8');
css = css.replace(/\.admin-grid-layout \{[\s\S]*?\}/, '');
css = css.replace(/\.admin-navigator-column \{[\s\S]*?\}/, '');
css = css.replace(/\.admin-main-column \{[\s\S]*?\}/, '');
css = css.replace(/#app-root:has\(\.admin-grid-layout\) \{[\s\S]*?\}/, '');
css = css.replace(/\.admin-grid-layout \{[\s\S]*?\}/, ''); // Might be in media query too
fs.writeFileSync('src/style.css', css);

console.log("Cleanup complete");
