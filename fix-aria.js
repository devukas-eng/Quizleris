const fs = require('fs');
let c = fs.readFileSync('src/quiz-editor.js', 'utf8');

c = c.replace(/<button class="admin-duplicate-question-btn ([^"]+)"([^>]*)title="([^"]+)"([^>]*)>/g, '<button class="admin-duplicate-question-btn $1"$2title="$3" aria-label="$3"$4>');
c = c.replace(/<button class="admin-remove-question-btn ([^"]+)"([^>]*)title="([^"]+)"([^>]*)>/g, '<button class="admin-remove-question-btn $1"$2title="$3" aria-label="$3"$4>');
c = c.replace(/class="admin-remove-q-image ([^"]+)"([^>]*)>/g, 'class="admin-remove-q-image $1" aria-label="Remove Image"$2>');
c = c.replace(/class="admin-choice-remove-image ([^"]+)"([^>]*)>/g, 'class="admin-choice-remove-image $1" aria-label="Remove Image"$2>');
c = c.replace(/class="admin-choice-add-image ([^"]+)"([^>]*)title="([^"]+)"([^>]*)>/g, 'class="admin-choice-add-image $1"$2title="$3" aria-label="$3"$4>');
c = c.replace(/class="admin-remove-choice-btn ([^"]+)"([^>]*)>/g, 'class="admin-remove-choice-btn $1" aria-label="Remove Choice"$2>');
c = c.replace(/class="btn btn-secondary btn-icon admin-insert-blank-btn"([^>]*)>/g, 'class="btn btn-secondary btn-icon admin-insert-blank-btn" aria-label="${t(\'admin.insertBlank\')}"$1>');

fs.writeFileSync('src/quiz-editor.js', c);
