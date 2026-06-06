const fs = require('fs');
let c = fs.readFileSync('src/topics.js', 'utf8');

// Replace the block of Race card
const startMarker = '<!-- Race Mode Card -->';
const endMarker = '</div>\r\n                    </div>\r\n                </div>\r\n            </div>\r\n        `;';
const endMarker2 = '</div>\n                    </div>\n                </div>\n            </div>\n        `;';

let idx = c.indexOf(startMarker);
if(idx !== -1) {
    let nextIdx = c.indexOf('`;', idx);
    if(nextIdx !== -1) {
        c = c.substring(0, idx) + '                    </div>\n                </div>\n            </div>\n        `;' + c.substring(nextIdx + 2);
    }
}

// Replace listener
c = c.replace(/const raceBtn[\s\S]*?\}\s*\}/, '}');

fs.writeFileSync('src/topics.js', c);
