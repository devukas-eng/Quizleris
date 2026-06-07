const fs = require('fs');
let c = fs.readFileSync('src/quiz-editor.js', 'utf8');

// Fix Undo/Redo blocking native inputs
c = c.replace(
  '  // Ctrl+Z / Meta+Z -> Undo\n  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {\n    e.preventDefault();\n    performUndo();\n  }',
  '  // Ctrl+Z / Meta+Z -> Undo\n  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {\n    const active = document.activeElement;\n    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;\n    e.preventDefault();\n    performUndo();\n  }'
);

c = c.replace(
  '  // Ctrl+Y / Meta+Y -> Redo\n  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {\n    e.preventDefault();\n    performRedo();\n  }',
  '  // Ctrl+Y / Meta+Y -> Redo\n  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {\n    const active = document.activeElement;\n    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;\n    e.preventDefault();\n    performRedo();\n  }'
);

// Toggle math editor collapsed
const mathToggleLogic = `
  const mathHeader = document.getElementById("math-editor-header");
  if (mathHeader) {
    mathHeader.addEventListener("click", () => {
      const editor = document.getElementById("admin-math-editor-toggle");
      if (editor) {
        editor.classList.toggle("collapsed");
      }
    });
  }
`;

c = c.replace('  adminQuizModeSelect.addEventListener("change", triggerAutoSave);', `  adminQuizModeSelect.addEventListener("change", triggerAutoSave);\n${mathToggleLogic}`);

// Fix performRedo bug: if (redoStack.length > 20) { undoStack.shift(); } -> if (undoStack.length > 20) { undoStack.shift(); }
c = c.replace('    if (redoStack.length > 20) {\n      undoStack.shift();\n    }', '    if (undoStack.length > 20) {\n      undoStack.shift();\n    }');

fs.writeFileSync('src/quiz-editor.js', c);
console.log('quiz-editor.js updated');
