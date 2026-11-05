// Themes kept in a premium account (table user_themes, one row per user): the chosen theme's id and
// the user's own themes. Checked field by field like the page's sanitizeTheme (src/themes.js), so
// what is stored can only ever become #rrggbb colours, numbers in range and names from fixed lists.

const MAX_CUSTOM_THEMES = 20;
const COLOR_KEYS = ['bg', 'surface', 'text', 'accent', 'accent2', 'danger', 'success'];
const FONTS = ['system', 'rounded', 'serif', 'mono'];
const EFFECTS = ['plain', 'blobs', 'gradient', 'grid', 'dots'];
const RANGES = { radius: [0, 24], glass: [40, 100], shadow: [0, 100], strength: [0, 100] };
const HEX_RE = /^#[0-9a-f]{6}$/i;
const CUSTOM_ID_RE = /^c-[a-z0-9]{4,16}$/;
const SELECTED_RE = /^[a-z0-9-]{1,24}$/;

function clampInt(value, [min, max], fallback) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function cleanName(value) {
    return [...String(value ?? '')].filter(ch => ch >= ' ' && ch !== '\u007f' && ch !== '<' && ch !== '>')
        .join('').trim().slice(0, 30);
}

/** One own theme, or null when it can't be one */
function cleanTheme(raw) {
    if (!raw || typeof raw !== 'object' || !CUSTOM_ID_RE.test(raw.id)) return null;
    if (raw.base !== 'light' && raw.base !== 'dark') return null;
    if (!raw.colors || typeof raw.colors !== 'object') return null;
    const colors = {};
    for (const key of COLOR_KEYS) {
        if (typeof raw.colors[key] !== 'string' || !HEX_RE.test(raw.colors[key])) return null;
        colors[key] = raw.colors[key].toLowerCase();
    }
    const effect = raw.effect && typeof raw.effect === 'object' ? raw.effect : {};
    return {
        id: raw.id,
        name: cleanName(raw.name) || 'Mano tema',
        base: raw.base,
        colors,
        radius: clampInt(raw.radius, RANGES.radius, 12),
        font: FONTS.includes(raw.font) ? raw.font : 'system',
        effect: {
            kind: EFFECTS.includes(effect.kind) ? effect.kind : 'blobs',
            strength: clampInt(effect.strength, RANGES.strength, 50),
        },
        glass: clampInt(raw.glass, RANGES.glass, 90),
        shadow: clampInt(raw.shadow, RANGES.shadow, 50),
        custom: true,
    };
}

/** { selected, custom } ready to store, or null when the body is not that shape */
function cleanThemePayload(body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.custom)) return null;
    if (body.custom.length > MAX_CUSTOM_THEMES) return null;
    const seen = new Set();
    const custom = [];
    for (const raw of body.custom) {
        const theme = cleanTheme(raw);
        if (!theme || seen.has(theme.id)) return null;
        seen.add(theme.id);
        custom.push(theme);
    }
    const selected = typeof body.selected === 'string' && SELECTED_RE.test(body.selected) ? body.selected : null;
    return { selected, custom };
}

module.exports = { cleanThemePayload, MAX_CUSTOM_THEMES };
