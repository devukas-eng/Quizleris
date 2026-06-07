const fs = require('fs');

// --- index.html ---
let indexHtml = fs.readFileSync('src/index.html', 'utf8');

// Find floating-math-editor
const editorStart = indexHtml.indexOf('<div class="floating-math-editor');
if (editorStart !== -1) {
    // Find the end by looking for "</div>" twice (since there's a wrapper).
    // Let's just use regex to match the whole div.
    const regex = /<div class="floating-math-editor collapsed" id="admin-math-editor-toggle">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
    const match = indexHtml.match(regex);
    if (match) {
        const mathEditorHtml = match[0];
        // Remove it from its current position
        indexHtml = indexHtml.replace(mathEditorHtml, '');
        // Append it just before </body>
        indexHtml = indexHtml.replace('</body>', mathEditorHtml + '\n</body>');
        fs.writeFileSync('src/index.html', indexHtml);
        console.log("Moved floating-math-editor out of #app-root");
    } else {
        console.log("Could not match floating-math-editor properly.");
    }
}

// --- quiz-editor.js ---
let quizEditor = fs.readFileSync('src/quiz-editor.js', 'utf8');

// Add visibility logic for start-menu and floating-math-editor to toggleAdminMode
const oldLogic = '  adminPanel.style.display = adminMode ? "block" : "none";';
const newLogic = `  adminPanel.style.display = adminMode ? "block" : "none";
  
  const startMenu = document.getElementById("start-menu");
  if (startMenu) startMenu.style.display = adminMode ? "none" : "flex";

  const mathEditor = document.getElementById("admin-math-editor-toggle");
  if (mathEditor) mathEditor.style.display = adminMode ? "flex" : "none";`;

quizEditor = quizEditor.replace(oldLogic, newLogic);
fs.writeFileSync('src/quiz-editor.js', quizEditor);
console.log("Updated toggleAdminMode in quiz-editor.js");
