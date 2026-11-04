// Drag and drop for the task bank and the quiz editor, built on pointer events so a mouse, a pen
// and a finger all work. A mouse or pen drag starts after a small move; a finger has to rest for a
// moment first (so lists still scroll), except on grips marked `immediate`. The dragged thing
// follows the pointer as a lifted ghost, the drop zone under it shows where it would land, the page
// or list scrolls near its edges, and Esc or a drop outside every zone sends the ghost back.
//
// A drop zone is { el, accepts(payload), over(payload, x, y, target) → hint | null, leave(),
// drop(payload, hint, point) → Promise<Element | DOMRect | null> }. `drop` resolves to where the
// thing landed (the ghost flies there and fades) or null when nothing happened (it flies back).

const zones = [];
let session = null;
let endedAt = 0;

const MOVE_THRESHOLD = 5;
const TOUCH_SLOP = 9;
const TOUCH_DELAY = 260;
const EDGE = 72;          // px from an edge where scrolling starts
const MAX_SPEED = 22;     // px per frame at the very edge
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function addDropZone(zone) {
    zones.push(zone);
}

export function isDragging() {
    return !!session;
}

/** True right after a drag ended: the click that follows the pointerup is not a real click. */
export function justDragged() {
    return performance.now() - endedAt < 80;
}

/**
 * Watches a pointerdown and starts a drag if it turns into one.
 * options: { payload, ghost() → Element, source?: Element, immediate?: boolean, onStart?, onEnd?(dropped) }
 */
export function armDrag(down, options) {
    if (session || down.button !== 0 || !down.isPrimary) return;
    const touch = down.pointerType === "touch";
    const waitForHold = touch && !options.immediate;
    const start = { x: down.clientX, y: down.clientY };
    let last = down;
    let timer = null;

    const stop = () => {
        clearTimeout(timer);
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", stop, true);
        window.removeEventListener("pointercancel", stop, true);
    };
    const begin = () => {
        stop();
        startSession(last, start, options);
    };
    const move = e => {
        if (e.pointerId !== down.pointerId) return;
        last = e;
        const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y);
        if (waitForHold) {
            if (distance > TOUCH_SLOP) stop(); // the finger is scrolling
        } else if (distance > MOVE_THRESHOLD) {
            begin();
        }
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
    if (waitForHold) timer = setTimeout(begin, TOUCH_DELAY);
}

function startSession(e, start, options) {
    const sourceRect = options.source?.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    const card = options.ghost();
    card.classList.add("drag-ghost-card");
    ghost.appendChild(card);
    const width = Math.min(sourceRect?.width || 320, 360);
    ghost.style.width = `${width}px`;
    document.body.appendChild(ghost);

    const offset = sourceRect
        ? { x: Math.min(start.x - sourceRect.left, width - 24), y: Math.min(start.y - sourceRect.top, 40) }
        : { x: 24, y: 24 };
    session = {
        options,
        payload: options.payload,
        ghost,
        offset,
        sourceRect,
        point: { x: e.clientX, y: e.clientY },
        moved: true,
        zone: null,
        hint: null,
        raf: 0,
        pointerId: e.pointerId
    };
    document.body.classList.add("is-dragging");
    window.getSelection()?.removeAllRanges();
    if (e.pointerType === "touch") navigator.vibrate?.(8);

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("touchmove", preventScroll, { passive: false, capture: true });
    window.addEventListener("contextmenu", preventDefault, true);
    window.addEventListener("blur", onCancel);
    options.onStart?.();
    session.raf = requestAnimationFrame(tick);
}

function preventScroll(e) {
    if (session && e.cancelable) e.preventDefault();
}

function preventDefault(e) {
    e.preventDefault();
}

function onMove(e) {
    if (!session || e.pointerId !== session.pointerId) return;
    session.point = { x: e.clientX, y: e.clientY };
    session.moved = true;
}

function onUp(e) {
    if (!session || e.pointerId !== session.pointerId) return;
    session.point = { x: e.clientX, y: e.clientY };
    locate();
    finish(true);
}

function onCancel() {
    if (session) finish(false);
}

function onKey(e) {
    if (e.key === "Escape" && session) {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
    }
}

// Every frame: move the ghost, scroll near edges, and re-read the zone when anything moved
function tick() {
    if (!session) return;
    const { point, offset, ghost } = session;
    const scrolled = autoScroll(point);
    if (session.moved || scrolled) {
        ghost.style.transform = `translate3d(${point.x - offset.x}px, ${point.y - offset.y}px, 0)`;
        locate();
        session.moved = false;
    }
    session.raf = requestAnimationFrame(tick);
}

function locate() {
    const { point, payload } = session;
    const target = document.elementFromPoint(point.x, point.y);
    const zone = target ? zones.find(z => z.el.isConnected && z.el.contains(target) && z.accepts(payload)) : null;
    if (zone !== session.zone) {
        session.zone?.leave();
        session.zone = zone || null;
    }
    session.hint = zone ? zone.over(payload, point.x, point.y, target) : null;
    session.ghost.classList.toggle("no-drop", !session.hint);
    session.target = target;
}

// The nearest scrollable box under the pointer (stopping at fixed panels), else the page
function scrollerAt(target) {
    for (let el = target; el && el !== document.body; el = el.parentElement) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) return el;
        if (style.position === "fixed") return null;
    }
    return document.scrollingElement;
}

function autoScroll(point) {
    const scroller = session.target ? scrollerAt(session.target) : null;
    if (!scroller) return false;
    const page = scroller === document.scrollingElement;
    const rect = page ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
    const edge = Math.min(EDGE, (rect.bottom - rect.top) / 4);
    let speed = 0;
    if (point.y < rect.top + edge) speed = -((rect.top + edge - point.y) / edge);
    else if (point.y > rect.bottom - edge) speed = (point.y - (rect.bottom - edge)) / edge;
    if (!speed) return false;
    const before = scroller.scrollTop;
    scroller.scrollTop += Math.sign(speed) * Math.ceil(Math.min(1, Math.abs(speed)) ** 2 * MAX_SPEED);
    return scroller.scrollTop !== before;
}

function removeListeners() {
    cancelAnimationFrame(session.raf);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("touchmove", preventScroll, { capture: true });
    window.removeEventListener("contextmenu", preventDefault, true);
    window.removeEventListener("blur", onCancel);
}

async function finish(dropped) {
    const s = session;
    removeListeners();
    session = null;
    endedAt = performance.now();
    document.body.classList.remove("is-dragging");

    let landing = null;
    if (dropped && s.zone && s.hint) {
        s.ghost.classList.add("is-dropping");
        try {
            landing = await s.zone.drop(s.payload, s.hint, s.point);
        } catch (error) {
            console.error("Drop failed", error);
        }
    }
    s.zone?.leave();
    endedAt = performance.now();
    s.options.onEnd?.(!!landing);
    flyGhost(s.ghost, landing ? toRect(landing) : s.sourceRect, !!landing);
}

function toRect(landing) {
    return landing instanceof Element ? landing.getBoundingClientRect() : landing;
}

// The ghost settles into where the thing landed (or back where it came from) and fades out
function flyGhost(ghost, rect, landed) {
    const from = ghost.getBoundingClientRect();
    if (!rect || reduceMotion() || !rect.width) {
        ghost.remove();
        return;
    }
    const card = ghost.firstElementChild;
    card.style.animation = "none";
    const dx = rect.left - from.left;
    const dy = rect.top - from.top;
    const scale = Math.max(0.2, Math.min(rect.width / from.width, 1.6));
    const anim = ghost.animate([
        { transform: getComputedStyle(ghost).transform, opacity: 1 },
        { transform: `translate3d(${from.left + dx}px, ${from.top + dy}px, 0) scale(${scale})`, opacity: landed ? 0 : 0.4 }
    ], { duration: landed ? 360 : 300, easing: EASE, fill: "forwards" });
    anim.onfinish = () => ghost.remove();
    anim.oncancel = () => ghost.remove();
}
