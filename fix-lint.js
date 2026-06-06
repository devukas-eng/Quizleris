const fs = require('fs');

function replaceFile(path, replacer) {
    let c = fs.readFileSync(path, 'utf8');
    c = replacer(c);
    fs.writeFileSync(path, c);
}

replaceFile('src/admin.js', c => c.replace('catch(e) {}', 'catch(e) { console.error("Error parsing community quizzes:", e); }'));
replaceFile('src/topics.js', c => c.replace('catch(e) {}', 'catch(e) { console.error("Error parsing community quizzes:", e); }'));

replaceFile('src/app.js', c => {
    return c.replace('import { showProfileModal }', 'import { }')
            .replace('import { playSound, initAudio, toggleMute, getIsMuted }', 'import { playSound, initAudio }');
});

replaceFile('src/menu.js', c => {
    return c.replace('import { renderFrenzyMode }', 'import { }')
            .replace('import { showLegalModal }', 'import { }');
});

replaceFile('src/race.js', c => {
    return c.replace('import { getTopicBundles } from "./storage.js";', '')
            .replace('import { renderTopicsPage } from "./topics.js";', '')
            .replace('players.forEach((p, i) => {', 'players.forEach((p) => {');
});

// For frenzy.js and race.js answersHtml warning, just ignore since it's used.
