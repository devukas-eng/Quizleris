// Smooth reflow: when resizing makes an item move to another row (or jump sideways), it glides
// from its old place instead of jumping there. Containers opt in with [data-glide]; their direct
// children are followed. Positions are measured relative to the container and without
// transforms, so scrolling, content above growing, or a running glide never count as a jump.

const DURATION = 420;
const EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const MIN_DY = 6;   // a new row
const MIN_DX = 40;  // a sideways jump (continuous drift while resizing stays below this per frame)
const REFRESH_MS = 140;

function layoutOffset(el) {
    let x = 0, y = 0;
    for (let node = el; node; node = node.offsetParent) {
        x += node.offsetLeft;
        y += node.offsetTop;
    }
    return { x, y };
}

function glide(el, dx, dy) {
    // A glide still running: continue from where the item is now
    const running = el.getAnimations().filter(a => a.id === "glide");
    if (running.length) {
        const current = getComputedStyle(el).transform;
        if (current && current !== "none") {
            const m = new DOMMatrixReadOnly(current);
            dx += m.m41;
            dy += m.m42;
        }
        running.forEach(a => a.cancel());
    }
    const anim = el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
        { duration: DURATION, easing: EASING }
    );
    anim.id = "glide";
}

/** Starts following the [data-glide] containers inside root while root is resized. */
export function initGlide(root) {
    if (!root || root.dataset.glideReady || !window.ResizeObserver) return;
    root.dataset.glideReady = "true";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const measure = () => {
        const positions = new Map();
        root.querySelectorAll("[data-glide]").forEach(container => {
            if (!container.offsetParent) return; // hidden
            const origin = layoutOffset(container);
            for (const el of container.children) {
                if (!el.offsetParent) continue;
                const p = layoutOffset(el);
                positions.set(el, { x: p.x - origin.x, y: p.y - origin.y });
            }
        });
        return positions;
    };

    let last = measure();
    let lastWidth = root.clientWidth;

    new ResizeObserver(() => {
        const width = root.clientWidth;
        const resized = width !== lastWidth;
        lastWidth = width;
        const now = measure();
        if (resized && !reduceMotion.matches) {
            const top = -200;
            const bottom = window.innerHeight + 200;
            for (const [el, pos] of now) {
                const prev = last.get(el);
                if (!prev) continue;
                const dx = prev.x - pos.x;
                const dy = prev.y - pos.y;
                if (Math.abs(dy) < MIN_DY && Math.abs(dx) < MIN_DX) continue;
                const rect = el.getBoundingClientRect();
                if (rect.bottom < top || rect.top > bottom) continue; // off screen: no need
                if (getComputedStyle(el).display === "inline") continue;
                glide(el, dx, dy);
            }
        }
        last = now;
    }).observe(root);

    // Edits (typing, re-rendered questions, pictures loading) move things without a resize:
    // take fresh reference positions shortly after, so they are not mistaken for jumps
    let timer = null;
    const refresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { last = measure(); }, REFRESH_MS);
    };
    new MutationObserver(refresh).observe(root, { childList: true, subtree: true, characterData: true });
    root.addEventListener("input", refresh);
    root.addEventListener("load", refresh, true);
    root.addEventListener("transitionend", refresh);
}
