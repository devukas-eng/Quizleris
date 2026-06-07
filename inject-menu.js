const fs = require('fs');

let c = fs.readFileSync('src/menu.js', 'utf8');

c = c.replace(
    '<button id="menu-btn-admin" class="btn"',
    '<button id="menu-btn-admin" class="btn"'
);

// We want to replace the row
const rowTarget = '<div class="menu-admin-row">\n                <button id="menu-btn-admin" class="btn" style="font-size:0.82rem; padding:6px 14px; opacity:0.7;" data-i18n="menu.admin">${t(\'menu.admin\')}</button>\n            </div>';

const rowNew = '<div class="menu-admin-row" style="display:flex; justify-content:center; gap: 10px;">\n                <button id="menu-btn-admin" class="btn" style="font-size:0.82rem; padding:6px 14px; opacity:0.7;" data-i18n="menu.admin">${t(\'menu.admin\')}</button>\n                <button id="menu-auth-btn" class="btn btn-primary" style="font-size:0.82rem; padding:6px 14px;">Prisijungti</button>\n            </div>';

c = c.replace(rowTarget, rowNew);

fs.writeFileSync('src/menu.js', c);
