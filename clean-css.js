const fs = require('fs');
let c = fs.readFileSync('src/style.css', 'utf8');

const ghostStart = c.indexOf('/* =========================================\n   Ghost Racer Mode\n   ========================================= */');
if (ghostStart !== -1) {
    const ghostEnd = c.indexOf('/* =========================================\n   Media Queries & Responsiveness\n   ========================================= */', ghostStart);
    if (ghostEnd !== -1) {
        c = c.substring(0, ghostStart) + c.substring(ghostEnd);
    } else {
        console.log("Could not find end of ghost section");
    }
} else {
    // Try without exact newlines
    const startRegex = /\/\*\s*=========================================\s*Ghost Racer Mode\s*=========================================\s*\*\//;
    const endRegex = /\/\*\s*=========================================\s*Media Queries & Responsiveness\s*=========================================\s*\*\//;
    const startMatch = c.match(startRegex);
    const endMatch = c.match(endRegex);
    if (startMatch && endMatch && startMatch.index < endMatch.index) {
        c = c.substring(0, startMatch.index) + c.substring(endMatch.index);
    }
}

// Remove any remaining .ghost- classes using regex
c = c.replace(/\.ghost-[^{]*\{[^}]*\}/g, '');

fs.writeFileSync('src/style.css', c);
