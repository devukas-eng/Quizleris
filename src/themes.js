// Themes are data: a few base colours plus shape settings become every CSS token the app
// uses. The four original themes keep their exact token values; new and custom themes derive
// theirs. Nothing here builds CSS from free text: custom themes hold only #rrggbb colours,
// numbers in range and names from fixed lists (sanitizeTheme), so a shared code can't inject CSS.

export const THEME_KEY = "selected_theme";
export const THEME_CSS_KEY = "selected_theme_css";
export const CUSTOM_THEMES_KEY = "quizleris_custom_themes";
export const RECENT_THEMES_KEY = "quizleris_recent_themes";
export const MAX_CUSTOM_THEMES = 20;
export const DEFAULT_THEME_ID = "emerald";
const SHARE_PREFIX = "QZT1.";

export const FONTS = {
    system: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Segoe UI", system-ui, sans-serif',
    serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
    mono: 'ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, monospace',
};
export const EFFECTS = ["plain", "blobs", "gradient", "grid", "dots"];
export const COLOR_KEYS = ["bg", "surface", "text", "accent", "accent2", "danger", "success"];
export const RANGES = {
    radius: [0, 24],
    glass: [40, 100],
    shadow: [0, 100],
    strength: [0, 100],
};

// ── Colour maths ────────────────────────────────────────────────────────────

const HEX_RE = /^#[0-9a-f]{6}$/i;

function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]) {
    return "#" + [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

/** `t` of the way from colour a to colour b */
export function mix(a, b, t) {
    const ca = rgb(a), cb = rgb(b);
    return hex(ca.map((v, i) => v + (cb[i] - v) * t));
}

function alpha(color, a) {
    const [r, g, b] = rgb(color);
    return `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`;
}

function luminance(color) {
    const [r, g, b] = rgb(color).map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21 */
export function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white, whichever reads better on `color` */
export function textOn(color) {
    return contrastRatio(color, "#ffffff") >= contrastRatio(color, "#111111") ? "#ffffff" : "#111111";
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function clampInt(value, [min, max], fallback) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// ── The original four, token for token ──────────────────────────────────────

const LEGACY_SHARED = {
    "--radius": "12px",
    "--control-radius": "10px",
    "--font": '"Inter", system-ui, -apple-system, sans-serif',
    "--on-accent": "#ffffff",
    "--warning": "#f59e0b",
};

const BUILT_INS = [
    {
        id: "emerald", subtitle: "Light Classic", base: "light",
        name: { lt: "Šviesus fonas", en: "Light Classic" },
        colors: { bg: "#ffffff", surface: "#ffffff", text: "#1f2937", accent: "#1b9b7e", accent2: "#22c997", danger: "#f87171", success: "#34d399" },
        radius: 12, font: "system", effect: { kind: "blobs", strength: 50 }, glass: 95, shadow: 50,
        tokens: {
            "--bg": "#FFFFFF", "--panel": "#F3F4F6", "--text": "#1F2937", "--accent": "#1B9B7E",
            "--accent-strong": "#168F6F", "--accent-2": "#22C997", "--danger": "#f87171",
            "--danger-strong": "#dc2626", "--success": "#34d399", "--muted": "#6B7280",
            "--shadow": "0 10px 30px rgba(0, 0, 0, 0.08)",
            "--bg-grad": "radial-gradient(circle at 20% 20%, rgba(27, 155, 126, 0.06), transparent 35%), radial-gradient(circle at 80% 0%, rgba(34, 201, 151, 0.06), transparent 35%), #FFFFFF",
            "--app-bg": "rgba(255, 255, 255, 0.95)", "--border-color": "rgba(0, 0, 0, 0.08)",
            "--input-bg": "#ffffff", "--btn-bg": "#ffffff", "--btn-hover-bg": "#f8fafc",
            "--summary-bg": "#ffffff", "--card-bg": "#ffffff", "--surface-solid": "#ffffff",
            "--glow-color": "rgba(27, 155, 126, 0.4)", "--bubble-a": "#1B9B7E", "--bubble-b": "#ffffff",
            "--theme-picker-bg": "rgba(255, 255, 255, 0.85)", "--theme-picker-text": "#1F2937",
            "--theme-picker-border": "rgba(0, 0, 0, 0.10)",
        },
    },
    {
        id: "slate-dark", subtitle: "Slate / Sky", base: "dark",
        name: { lt: "Tamsus fonas", en: "Dark Mode" },
        colors: { bg: "#0f172a", surface: "#1e293b", text: "#f8fafc", accent: "#38bdf8", accent2: "#0ea5e9", danger: "#f87171", success: "#34d399" },
        radius: 12, font: "system", effect: { kind: "blobs", strength: 50 }, glass: 80, shadow: 50,
        tokens: {
            "--bg": "#0f172a", "--panel": "rgba(30, 41, 59, 0.55)", "--text": "#f8fafc", "--accent": "#38bdf8",
            "--accent-strong": "#0ea5e9", "--accent-2": "#0ea5e9", "--danger": "#f87171",
            "--danger-strong": "#f87171", "--success": "#34d399", "--muted": "#94a3b8",
            "--shadow": "0 15px 35px rgba(15, 23, 42, 0.6)",
            "--bg-grad": "radial-gradient(circle at 20% 20%, rgba(56, 189, 248, 0.12), transparent 40%), radial-gradient(circle at 80% 80%, rgba(14, 165, 233, 0.1), transparent 40%), #020617",
            "--app-bg": "rgba(15, 23, 42, 0.8)", "--border-color": "rgba(255, 255, 255, 0.12)",
            "--input-bg": "rgba(30, 41, 59, 0.7)", "--btn-bg": "rgba(30, 41, 59, 0.7)",
            "--btn-hover-bg": "rgba(255, 255, 255, 0.06)", "--summary-bg": "rgba(30, 41, 59, 0.4)",
            "--card-bg": "rgba(30, 41, 59, 0.4)", "--surface-solid": "#1e293b",
            "--glow-color": "rgba(56, 189, 248, 0.35)", "--bubble-a": "#38bdf8", "--bubble-b": "#1e293b",
            "--theme-picker-bg": "#0c1829", "--theme-picker-text": "#f8fafc",
            "--theme-picker-item-hover": "rgba(56,189,248,0.08)", "--theme-picker-border": "rgba(56, 189, 248, 0.2)",
        },
    },
    {
        id: "solar", subtitle: "Solar Flare", base: "dark",
        name: { lt: "Tamsus fonas²", en: "Dark Mode II" },
        colors: { bg: "#120e0a", surface: "#1f1710", text: "#fff3e6", accent: "#ff9100", accent2: "#ff4d00", danger: "#ef4444", success: "#10b981" },
        radius: 12, font: "system", effect: { kind: "blobs", strength: 50 }, glass: 85, shadow: 50,
        tokens: {
            "--bg": "#120e0a", "--panel": "rgba(32, 24, 18, 0.65)", "--text": "#fff3e6", "--accent": "#ff9100",
            "--accent-strong": "#ff4d00", "--accent-2": "#ff4d00", "--danger": "#ef4444",
            "--danger-strong": "#f87171", "--success": "#10b981", "--muted": "#a69282",
            "--shadow": "0 15px 35px rgba(255, 145, 0, 0.2)",
            "--bg-grad": "radial-gradient(circle at 15% 20%, rgba(255, 145, 0, 0.15), transparent 45%), radial-gradient(circle at 85% 80%, rgba(255, 77, 0, 0.12), transparent 45%), #100b07",
            "--app-bg": "rgba(20, 15, 11, 0.85)", "--border-color": "rgba(255, 145, 0, 0.2)",
            "--input-bg": "rgba(28, 21, 16, 0.8)", "--btn-bg": "rgba(32, 24, 18, 0.8)",
            "--btn-hover-bg": "rgba(255, 255, 255, 0.08)", "--summary-bg": "rgba(24, 18, 14, 0.6)",
            "--card-bg": "rgba(24, 18, 14, 0.6)", "--surface-solid": "#1f1710",
            "--glow-color": "rgba(255, 145, 0, 0.45)", "--bubble-a": "#ff9100", "--bubble-b": "#ff4d00",
            "--theme-picker-bg": "#1a1008", "--theme-picker-text": "#fff3e6",
            "--theme-picker-item-hover": "rgba(255,145,0,0.08)", "--theme-picker-border": "rgba(255, 145, 0, 0.25)",
        },
    },
    {
        id: "cyberpunk", subtitle: "Cyber Midnight", base: "dark",
        name: { lt: "Tamsus fonas³", en: "Dark Mode III" },
        colors: { bg: "#0b071e", surface: "#160d38", text: "#f3f0ff", accent: "#ff007f", accent2: "#00f0ff", danger: "#ff3366", success: "#05ffc5" },
        radius: 12, font: "system", effect: { kind: "blobs", strength: 60 }, glass: 82, shadow: 60,
        tokens: {
            "--bg": "#0b071e", "--panel": "rgba(25, 16, 59, 0.6)", "--text": "#f3f0ff", "--accent": "#ff007f",
            "--accent-strong": "#00f0ff", "--accent-2": "#00f0ff", "--danger": "#ff3366",
            "--danger-strong": "#ff6b8b", "--success": "#05ffc5", "--muted": "#a59bbd",
            "--shadow": "0 15px 35px rgba(255, 0, 127, 0.25)",
            "--bg-grad": "radial-gradient(circle at 20% 20%, rgba(255, 0, 127, 0.15), transparent 45%), radial-gradient(circle at 80% 80%, rgba(0, 240, 255, 0.15), transparent 45%), #090514",
            "--app-bg": "rgba(13, 8, 34, 0.82)", "--border-color": "rgba(255, 0, 127, 0.25)",
            "--input-bg": "rgba(18, 12, 47, 0.8)", "--btn-bg": "rgba(25, 16, 59, 0.8)",
            "--btn-hover-bg": "rgba(255, 255, 255, 0.1)", "--summary-bg": "rgba(18, 12, 47, 0.6)",
            "--card-bg": "rgba(18, 12, 47, 0.6)", "--surface-solid": "#160d38",
            "--glow-color": "rgba(255, 0, 127, 0.4)", "--bubble-a": "#ff007f", "--bubble-b": "#00f0ff",
            "--theme-picker-bg": "#12082e", "--theme-picker-text": "#f3f0ff",
            "--theme-picker-item-hover": "rgba(255,0,127,0.08)", "--theme-picker-border": "rgba(255, 0, 127, 0.3)",
        },
    },
];

// ── The rest of the collection, derived from their colours ──────────────────

const COLLECTION = [
    { id: "paper", subtitle: "Paper", base: "light", name: { lt: "Popierius", en: "Paper" },
        colors: { bg: "#f6f1e7", surface: "#fffdf8", text: "#2b2620", accent: "#b4532a", accent2: "#d98a3d", danger: "#c2410c", success: "#4d7c0f" },
        radius: 8, font: "serif", effect: { kind: "dots", strength: 35 }, glass: 96, shadow: 35 },
    { id: "mint", subtitle: "Mint", base: "light", name: { lt: "Mėtinė", en: "Mint" },
        colors: { bg: "#effaf6", surface: "#ffffff", text: "#12352c", accent: "#0b8f80", accent2: "#3cc9b0", danger: "#e11d48", success: "#16a34a" },
        radius: 16, font: "rounded", effect: { kind: "blobs", strength: 70 }, glass: 92, shadow: 45 },
    { id: "lavender", subtitle: "Lavender", base: "light", name: { lt: "Levanda", en: "Lavender" },
        colors: { bg: "#f5f3ff", surface: "#ffffff", text: "#2e1065", accent: "#7c3aed", accent2: "#c084fc", danger: "#e11d48", success: "#059669" },
        radius: 18, font: "rounded", effect: { kind: "blobs", strength: 80 }, glass: 90, shadow: 50 },
    { id: "amber", subtitle: "Amber", base: "light", name: { lt: "Gintaras", en: "Amber" },
        colors: { bg: "#fffbeb", surface: "#ffffff", text: "#3b2f0b", accent: "#b45309", accent2: "#f59e0b", danger: "#dc2626", success: "#15803d" },
        radius: 12, font: "system", effect: { kind: "gradient", strength: 55 }, glass: 94, shadow: 40 },
    { id: "forest", subtitle: "Forest", base: "dark", name: { lt: "Miškas", en: "Forest" },
        colors: { bg: "#0d1a14", surface: "#15291f", text: "#e8f5ee", accent: "#4ade80", accent2: "#a3e635", danger: "#f87171", success: "#4ade80" },
        radius: 14, font: "system", effect: { kind: "blobs", strength: 55 }, glass: 84, shadow: 55 },
    { id: "ocean", subtitle: "Ocean", base: "dark", name: { lt: "Vandenynas", en: "Ocean" },
        colors: { bg: "#061826", surface: "#0b2a40", text: "#e6f4ff", accent: "#22d3ee", accent2: "#3b82f6", danger: "#fb7185", success: "#34d399" },
        radius: 16, font: "rounded", effect: { kind: "gradient", strength: 70 }, glass: 82, shadow: 55 },
    { id: "sunset", subtitle: "Sunset", base: "dark", name: { lt: "Saulėlydis", en: "Sunset" },
        colors: { bg: "#1a0f1f", surface: "#2a1631", text: "#fdeef4", accent: "#fb7185", accent2: "#f59e0b", danger: "#f87171", success: "#4ade80" },
        radius: 18, font: "rounded", effect: { kind: "gradient", strength: 75 }, glass: 84, shadow: 60 },
    { id: "graphite", subtitle: "Graphite", base: "dark", name: { lt: "Grafitas", en: "Graphite" },
        colors: { bg: "#141414", surface: "#1f1f1f", text: "#f2f2f2", accent: "#e5e5e5", accent2: "#a3a3a3", danger: "#f87171", success: "#86efac" },
        radius: 6, font: "system", effect: { kind: "grid", strength: 30 }, glass: 92, shadow: 50 },
    { id: "terminal", subtitle: "Terminal", base: "dark", name: { lt: "Terminalas", en: "Terminal" },
        colors: { bg: "#050a05", surface: "#0a160a", text: "#b6ffb6", accent: "#33ff66", accent2: "#00cc44", danger: "#ff5555", success: "#33ff66" },
        radius: 2, font: "mono", effect: { kind: "grid", strength: 45 }, glass: 90, shadow: 40 },
];

export const THEMES = [...BUILT_INS, ...COLLECTION].map(theme => Object.freeze({ ...theme, builtIn: true }));

// ── Tokens ──────────────────────────────────────────────────────────────────

function background(c, dark, effect) {
    const s = effect.strength / 100;
    switch (effect.kind) {
        case "blobs": {
            const a = s * (dark ? 0.3 : 0.14);
            return `radial-gradient(circle at 20% 20%, ${alpha(c.accent, a)}, transparent 42%), ` +
                `radial-gradient(circle at 80% 80%, ${alpha(c.accent2, a)}, transparent 42%), ${c.bg}`;
        }
        case "gradient":
            return `linear-gradient(160deg, ${mix(c.bg, c.accent, s * (dark ? 0.28 : 0.16))} 0%, ${c.bg} 55%, ` +
                `${mix(c.bg, c.accent2, s * (dark ? 0.24 : 0.14))} 100%) fixed, ${c.bg}`;
        case "grid": {
            const line = alpha(c.text, s * (dark ? 0.12 : 0.09));
            return `linear-gradient(${line} 1px, transparent 1px) 0 0 / 32px 32px, ` +
                `linear-gradient(90deg, ${line} 1px, transparent 1px) 0 0 / 32px 32px, ${c.bg}`;
        }
        case "dots":
            return `radial-gradient(${alpha(c.text, s * (dark ? 0.22 : 0.18))} 1.2px, transparent 1.6px) 0 0 / 22px 22px, ${c.bg}`;
        default:
            return c.bg;
    }
}

/** Every CSS custom property for a theme */
export function deriveTokens(theme) {
    if (theme.tokens) return { ...LEGACY_SHARED, ...theme.tokens };

    const c = theme.colors;
    const dark = theme.base === "dark";
    const glass = theme.glass / 100;
    const shadow = theme.shadow / 100;
    const radius = theme.radius;
    const field = dark ? alpha(c.surface, 0.75) : c.surface;
    const card = dark ? alpha(c.surface, Math.min(1, glass * 0.6)) : c.surface;
    return {
        "--bg": c.bg,
        "--panel": dark ? alpha(c.surface, 0.6) : mix(c.surface, c.text, 0.05),
        "--text": c.text,
        "--muted": mix(c.text, c.bg, dark ? 0.4 : 0.35),
        "--accent": c.accent,
        "--accent-strong": mix(c.accent, dark ? "#ffffff" : "#000000", 0.14),
        "--accent-2": c.accent2,
        "--on-accent": textOn(c.accent),
        "--danger": c.danger,
        "--danger-strong": mix(c.danger, dark ? "#ffffff" : "#000000", 0.18),
        "--success": c.success,
        "--warning": "#f59e0b",
        "--radius": `${radius}px`,
        "--control-radius": `${Math.round(radius * 0.83)}px`,
        "--font": FONTS[theme.font] || FONTS.system,
        "--shadow": dark ? `0 15px 35px rgba(0, 0, 0, ${+(0.2 + shadow * 0.5).toFixed(2)})`
            : `0 10px 30px rgba(0, 0, 0, ${+(0.02 + shadow * 0.14).toFixed(2)})`,
        "--bg-grad": background(c, dark, theme.effect),
        "--app-bg": alpha(dark ? c.bg : c.surface, glass),
        "--border-color": alpha(c.text, dark ? 0.13 : 0.09),
        "--input-bg": field,
        "--btn-bg": field,
        "--btn-hover-bg": dark ? alpha(c.text, 0.07) : mix(c.surface, c.text, 0.03),
        "--summary-bg": card,
        "--card-bg": card,
        "--surface-solid": c.surface,
        "--glow-color": alpha(c.accent, 0.4),
        "--bubble-a": c.accent,
        "--bubble-b": dark ? c.bg : c.surface,
        "--theme-picker-bg": dark ? mix(c.bg, c.surface, 0.5) : alpha(c.surface, 0.9),
        "--theme-picker-text": c.text,
        "--theme-picker-item-hover": alpha(c.accent, 0.1),
        "--theme-picker-border": alpha(dark ? c.accent : c.text, dark ? 0.22 : 0.1),
    };
}

/** The style sheet that applies a theme to the page */
export function themeCss(theme) {
    const tokens = deriveTokens(theme);
    const body = Object.entries(tokens).map(([k, v]) => `${k}: ${v};`).join(" ");
    return `:root:root { ${body} color-scheme: ${theme.base === "dark" ? "dark" : "light"}; }`;
}

/** Inline style for an element that previews a theme without touching the page */
export function previewStyle(theme) {
    const tokens = deriveTokens(theme);
    return ["--bg", "--panel", "--text", "--muted", "--accent", "--accent-2", "--on-accent", "--radius",
        "--font", "--bg-grad", "--app-bg", "--border-color", "--card-bg", "--btn-bg", "--surface-solid"]
        .map(k => `${k}: ${tokens[k]}`).join("; ");
}

/** Two-tone swatch used for picker bubbles */
export function swatch(theme) {
    const tokens = deriveTokens(theme);
    return `linear-gradient(135deg, ${tokens["--bubble-a"]} 50%, ${tokens["--bubble-b"]} 50%)`;
}

// ── Readability ─────────────────────────────────────────────────────────────

/** Contrast of the pairs that carry text */
export function readability(theme) {
    const c = theme.colors;
    const tokens = deriveTokens(theme);
    const onAccent = tokens["--on-accent"].startsWith("#") ? tokens["--on-accent"] : textOn(c.accent);
    const text = Math.min(contrastRatio(c.text, c.bg), contrastRatio(c.text, c.surface));
    const accent = contrastRatio(onAccent, c.accent);
    return { text, accent, ok: text >= 4.5 && accent >= 3 };
}

/** Pushes the text colour away from the background until it reads (4.5:1) */
export function fixReadability(theme) {
    const fixed = clone(theme);
    const c = fixed.colors;
    const target = theme.base === "dark" ? "#ffffff" : "#000000";
    for (let step = 1; step <= 10 && readability(fixed).text < 4.5; step++) {
        c.text = mix(theme.colors.text, target, step / 10);
    }
    if (readability(fixed).text < 4.5) {
        c.surface = mix(theme.colors.surface, theme.base === "dark" ? "#000000" : "#ffffff", 0.5);
        c.bg = mix(theme.colors.bg, theme.base === "dark" ? "#000000" : "#ffffff", 0.5);
    }
    return fixed;
}

// ── Custom themes ───────────────────────────────────────────────────────────

function cleanName(value) {
    // Drops control characters and angle brackets (names are always escaped too)
    return [...String(value ?? "")].filter(ch => ch >= " " && ch !== "\u007f" && ch !== "<" && ch !== ">")
        .join("").trim().slice(0, 30);
}

/** A valid custom theme from untrusted input, or null */
export function sanitizeTheme(raw) {
    if (!raw || typeof raw !== "object") return null;
    const base = raw.base === "dark" ? "dark" : raw.base === "light" ? "light" : null;
    if (!base || !raw.colors || typeof raw.colors !== "object") return null;
    const colors = {};
    for (const key of COLOR_KEYS) {
        const value = raw.colors[key];
        if (typeof value !== "string" || !HEX_RE.test(value)) return null;
        colors[key] = value.toLowerCase();
    }
    const effect = raw.effect && typeof raw.effect === "object" ? raw.effect : {};
    return {
        id: typeof raw.id === "string" && /^c-[a-z0-9]{4,16}$/.test(raw.id) ? raw.id : newThemeId(),
        name: cleanName(raw.name) || "Mano tema",
        base,
        colors,
        radius: clampInt(raw.radius, RANGES.radius, 12),
        font: Object.hasOwn(FONTS, raw.font) ? raw.font : "system",
        effect: {
            kind: EFFECTS.includes(effect.kind) ? effect.kind : "blobs",
            strength: clampInt(effect.strength, RANGES.strength, 50),
        },
        glass: clampInt(raw.glass, RANGES.glass, 90),
        shadow: clampInt(raw.shadow, RANGES.shadow, 50),
        custom: true,
    };
}

export function newThemeId() {
    return "c-" + Math.random().toString(36).slice(2, 10).padEnd(6, "0");
}

/** A custom copy of any theme, ready to edit */
export function copyTheme(theme, name) {
    return sanitizeTheme({ ...clone(theme), id: newThemeId(), name: name ?? theme.name?.lt ?? theme.name });
}

function toBase64Url(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)));
}

/** Short text that carries a custom theme to someone else */
export function encodeShareCode(theme) {
    const t = sanitizeTheme(theme);
    const compact = {
        n: t.name, b: t.base[0], c: COLOR_KEYS.map(k => t.colors[k].slice(1)).join(""),
        r: t.radius, f: t.font, e: t.effect.kind, s: t.effect.strength, g: t.glass, h: t.shadow,
    };
    return SHARE_PREFIX + toBase64Url(JSON.stringify(compact));
}

/** The theme in a share code, or null if the code is not valid */
export function decodeShareCode(code) {
    const text = String(code ?? "").trim();
    if (!text.startsWith(SHARE_PREFIX) || text.length > 600) return null;
    try {
        const o = JSON.parse(fromBase64Url(text.slice(SHARE_PREFIX.length)));
        if (typeof o.c !== "string" || !/^[0-9a-f]{42}$/i.test(o.c)) return null;
        const colors = Object.fromEntries(COLOR_KEYS.map((k, i) => [k, "#" + o.c.slice(i * 6, i * 6 + 6)]));
        return sanitizeTheme({
            name: o.n, base: o.b === "d" ? "dark" : o.b === "l" ? "light" : null, colors,
            radius: o.r, font: o.f, effect: { kind: o.e, strength: o.s }, glass: o.g, shadow: o.h,
        });
    } catch {
        return null;
    }
}

// ── Storage ─────────────────────────────────────────────────────────────────

function readJson(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        return value ?? fallback;
    } catch {
        return fallback;
    }
}

export function loadCustomThemes() {
    const list = readJson(CUSTOM_THEMES_KEY, []);
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.map(sanitizeTheme).filter(t => t && !seen.has(t.id) && seen.add(t.id)).slice(0, MAX_CUSTOM_THEMES);
}

export function saveCustomThemes(list) {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(list.slice(0, MAX_CUSTOM_THEMES)));
}

/** Saves a new or edited custom theme; false when the list is full */
export function upsertCustomTheme(theme) {
    const clean = sanitizeTheme(theme);
    const list = loadCustomThemes();
    const i = list.findIndex(t => t.id === clean.id);
    if (i >= 0) list[i] = clean;
    else if (list.length >= MAX_CUSTOM_THEMES) return false;
    else list.push(clean);
    saveCustomThemes(list);
    return clean;
}

export function deleteCustomTheme(id) {
    saveCustomThemes(loadCustomThemes().filter(t => t.id !== id));
}

export function allThemes() {
    return [...THEMES, ...loadCustomThemes()];
}

export function findTheme(id) {
    return allThemes().find(t => t.id === id) || null;
}

export function themeName(theme, lang) {
    if (!theme) return "";
    return typeof theme.name === "string" ? theme.name : (theme.name[lang] || theme.name.lt);
}

export function savedThemeId() {
    return localStorage.getItem(THEME_KEY) || DEFAULT_THEME_ID;
}

export function recentThemeIds() {
    const list = readJson(RECENT_THEMES_KEY, []);
    return Array.isArray(list) ? list.filter(id => typeof id === "string").slice(0, 5) : [];
}

function rememberRecent(id) {
    const list = [id, ...recentThemeIds().filter(x => x !== id)].slice(0, 5);
    localStorage.setItem(RECENT_THEMES_KEY, JSON.stringify(list));
}

// ── Page ────────────────────────────────────────────────────────────────────

/** Puts a theme on the page; `persist` also makes it the saved choice */
export function applyTheme(theme, { persist = false } = {}) {
    const css = themeCss(theme);
    let style = document.getElementById("theme-vars");
    if (!style) {
        style = document.createElement("style");
        style.id = "theme-vars";
        document.head.appendChild(style);
    }
    style.textContent = css;
    document.documentElement.dataset.themeBase = theme.base;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme.colors.bg);
    if (persist) {
        localStorage.setItem(THEME_KEY, theme.id);
        localStorage.setItem(THEME_CSS_KEY, css);
        rememberRecent(theme.id);
    }
}
