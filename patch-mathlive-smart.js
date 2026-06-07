const fs = require('fs');

// --- index.html ---
let indexHtml = fs.readFileSync('src/index.html', 'utf8');
if (!indexHtml.includes('unpkg.com/mathlive')) {
    indexHtml = indexHtml.replace(
        '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>',
        '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>\n  <!-- MathLive for WYSIWYG Math Editor -->\n  <script defer src="https://unpkg.com/mathlive"></script>'
    );
}

// Replace wrapping buttons with a Text Mode button
indexHtml = indexHtml.replace(
    /<button type="button" class="btn btn-secondary wrapper-btn" id="palette-wrap-inline"[\s\S]*?<\/button>\s*<button type="button" class="btn btn-secondary wrapper-btn" id="palette-wrap-display"[\s\S]*?<\/button>/,
    '<button type="button" class="palette-btn btn btn-secondary wrapper-btn" data-latex="\\text{}" style="flex:1; font-size: 0.85rem; padding: 6px; min-width: 0;" title="Teksto Režimas">Teksto Režimas</button>'
);

fs.writeFileSync('src/index.html', indexHtml);
console.log("index.html patched with MathLive and Text Mode button.");

// --- quiz-editor.js ---
let quizEditor = fs.readFileSync('src/quiz-editor.js', 'utf8');

// Replace question prompt textarea with math-field (smart-mode added)
// First we inject a JS variable for unwrapped prompt
quizEditor = quizEditor.replace(
    /const focusState = captureFocusAndScroll\(\);/,
    'const focusState = captureFocusAndScroll();\n  // Function to unwrap latex\n  const unwrapMath = (str) => (str || "").replace(/^\\\\\\(/, "").replace(/\\\\\\)$/, "");'
);

quizEditor = quizEditor.replace(
    /<textarea class="admin-question-prompt" data-qidx="\$\{qIdx\}">\$\{q\.prompt \|\| ""\}<\/textarea>/g,
    '<math-field class="admin-question-prompt" smart-mode math-virtual-keyboard-policy="manual" data-qidx="${qIdx}" style="width: 100%; border: 1px solid rgba(0,0,0,0.2); border-radius: 4px; padding: 8px; font-size: 1.1rem; background: var(--bg-input); color: var(--text);">${unwrapMath(q.prompt)}</math-field>'
);

// Replace choice text input with math-field (smart-mode added)
quizEditor = quizEditor.replace(
    /<input type="text" class="admin-choice-text" data-qidx="\$\{qIdx\}" data-cidx="\$\{cIdx\}" value="\$\{choice\.text \|\| ""\}" style="[\s\S]*?" \/>/g,
    '<math-field class="admin-choice-text" smart-mode math-virtual-keyboard-policy="manual" data-qidx="${qIdx}" data-cidx="${cIdx}" style="width: 100%; padding: 8px; border: 1px solid rgba(0,0,0,0.2); border-radius: 4px; font-size: 1.1rem; background: var(--bg-input); color: var(--text);">${unwrapMath(choice.text)}</math-field>'
);

// Remove live previews
quizEditor = quizEditor.replace(
    /<!-- Real-Time LaTeX\/Text Preview -->[\s\S]*?<\/div>\s*<\/div>/g,
    ''
);
quizEditor = quizEditor.replace(
    /<!-- Real-time mathematical choice-level preview -->[\s\S]*?<\/div>/g,
    ''
);

// Add math-field to focus matching
quizEditor = quizEditor.replace(
    /target\.matches\("input, textarea, select"\)/g,
    'target.matches("input, textarea, select, math-field")'
);

// Add math-field to trackActiveField
quizEditor = quizEditor.replace(
    /\(target\.tagName === "INPUT" \|\| target\.tagName === "TEXTAREA"\)/g,
    '(target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "MATH-FIELD")'
);

// Wrap output in updateQuizFromDOM
quizEditor = quizEditor.replace(
    /q\.prompt = promptArea\.value;/g,
    'const val = promptArea.value.trim();\n    q.prompt = val ? "\\\\(" + val + "\\\\)" : "";'
);

quizEditor = quizEditor.replace(
    /q\.choices\[idx\]\.text = input\.value;/g,
    'const v = input.value.trim();\n          q.choices[idx].text = v ? "\\\\(" + v + "\\\\)" : "";'
);


fs.writeFileSync('src/quiz-editor.js', quizEditor);
console.log("quiz-editor.js patched.");

// --- admin-math.js ---
let adminMath = fs.readFileSync('src/admin-math.js', 'utf8');
if (!adminMath.includes('element.tagName === "MATH-FIELD"')) {
    adminMath = adminMath.replace(
        '  if (!element) return;',
        '  if (!element) return;\n\n  // MathLive support\n  if (element.tagName === "MATH-FIELD" || element.tagName === "MATH-FIELD") {\n    if (text === "\\\\text{}") {\n        element.executeCommand(["insert", "\\\\text{#0}"]);\n    } else {\n        element.executeCommand(["insert", text]);\n    }\n    element.focus();\n    return;\n  }'
    );
    fs.writeFileSync('src/admin-math.js', adminMath);
    console.log("admin-math.js patched.");
}
