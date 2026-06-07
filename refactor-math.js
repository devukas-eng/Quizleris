const fs = require('fs');

let c = fs.readFileSync('src/index.html', 'utf8');

// 1. Move Auth Button
// Find the language-toggle-container
const toggleContainerStart = c.indexOf('<div id="language-toggle-container"');
const insertPoint = c.indexOf('>', toggleContainerStart) + 1;
const authBtnHtml = `\n    <!-- Prisijungti Button -->\n    <button id="nav-auth-btn" class="btn btn-primary" style="font-size:0.82rem; padding:6px 14px;">Prisijungti</button>`;
c = c.slice(0, insertPoint) + authBtnHtml + c.slice(insertPoint);

// 2. Fix Math Editor
// Replace <details class="admin-math-editor-toggle"...>
c = c.replace(
  /<details class="admin-math-editor-toggle"[\s\S]*?<summary[\s\S]*?>[\s\S]*?<span>📐 Math Editor \/ LaTeX<\/span>[\s\S]*?<\/summary>/,
  `<div class="floating-math-editor collapsed" id="admin-math-editor-toggle">
            <div class="math-editor-header" id="math-editor-header">
              <span>📐 Math Editor / LaTeX</span>
              <span class="math-editor-chevron">▲</span>
            </div>`
);

// Add Space (\quad) button after Fraction
c = c.replace(
  '<button type="button" class="palette-btn" data-latex="\\\\frac{a}{b}"',
  '<button type="button" class="palette-btn" data-latex="\\quad" title="Space (Quad)" style="background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); color: var(--text); border-radius: 6px; height: 35px; cursor: pointer; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">(Tarpas)</button>\n                    <button type="button" class="palette-btn" data-latex="\\\\frac{a}{b}"'
);

// Fix double backslashes in data-latex
// Find all data-latex="\\..." and replace with data-latex="\..."
c = c.replace(/data-latex="\\\\/g, 'data-latex="\\');

// Close the div correctly
c = c.replace(
  /<\/div>\s*<\/details>/,
  `</div>\n          </div>`
);

fs.writeFileSync('src/index.html', c);
console.log('index.html refactored');
