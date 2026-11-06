// The landing page's quiz code board: every character sits on its own tile, and the effects work
// tile by tile. Used by the home page and by the admin preview, so the preview is the real thing.
//
// The board always has room for the longest code in the list, so a shorter code never moves the
// text around it.

export const TICKER_EFFECTS = ["flip", "slide", "scramble", "typewriter", "fade"];

const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MIN_WIDTH = 6;
const LONG_CODE = 12;
const BLANK = " ";

/** A code centred on `width` tiles, as an array of characters */
export function padCode(code, width) {
    const chars = [...String(code ?? "")];
    const size = Math.max(width, chars.length);
    const left = Math.floor((size - chars.length) / 2);
    return Array.from({ length: size }, (_, i) => chars[i - left] ?? BLANK);
}

/** How many tiles a list of quizzes needs */
export function boardWidth(items) {
    return items.reduce((max, item) => Math.max(max, [...String(item.id ?? "")].length), MIN_WIDTH);
}


/** The order to show quizzes in: as listed, or each one once in a random order */
export function playOrder(length, order, random = Math.random) {
    const list = Array.from({ length }, (_, i) => i);
    if (order !== "shuffle") return list;
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const noise = (random = Math.random) => GLYPHS[Math.floor(random() * GLYPHS.length)];

function layer(cell, char, className) {
    const el = document.createElement("span");
    el.className = className;
    el.textContent = char;
    cell.appendChild(el);
    return el;
}

// Each effect moves `cells` from the characters in `from` to those in `to` (the cells already
// hold `to` when it runs). It returns how long it takes; the board tidies up after that.
const EFFECTS = {
    // A split-flap departure board: the top half falls away, the bottom half lands
    flip({ cells, from, to, run }) {
        const step = 38, fall = 130, land = 170;
        let order = 0;
        cells.forEach((cell, i) => {
            if (from[i] === to[i]) return;
            const delay = order++ * step;
            cell.querySelector(".ct-ch").classList.add("ct-top");
            layer(cell, from[i], "ct-ch ct-bottom ct-temp");
            const top = layer(cell, from[i], "ct-ch ct-top ct-flap ct-temp");
            const bottom = layer(cell, to[i], "ct-ch ct-bottom ct-flap ct-temp");
            run(top, [
                { transform: "rotateX(0deg)", filter: "brightness(1)" },
                { transform: "rotateX(-90deg)", filter: "brightness(0.84)" },
            ], { duration: fall, delay, easing: "cubic-bezier(0.55, 0, 0.9, 0.5)", fill: "both" });
            run(bottom, [
                { transform: "rotateX(90deg)", filter: "brightness(0.84)" },
                { transform: "rotateX(0deg)", filter: "brightness(1)" },
            ], { duration: land, delay: delay + fall, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.25)", fill: "both" });
        });
        return Math.max(0, order - 1) * step + fall + land;
    },

    // Each tile rolls to its new character like an odometer wheel
    slide({ cells, from, to, run }) {
        const step = 30, duration = 360;
        let order = 0;
        cells.forEach((cell, i) => {
            if (from[i] === to[i]) return;
            const delay = order++ * step;
            const options = { duration, delay, easing: "cubic-bezier(0.3, 1.25, 0.4, 1)", fill: "both" };
            const old = layer(cell, from[i], "ct-ch ct-temp");
            run(old, [{ transform: "translateY(0)" }, { transform: "translateY(-110%)" }], options);
            run(cell.querySelector(".ct-ch"), [{ transform: "translateY(110%)" }, { transform: "translateY(0)" }], options);
        });
        return Math.max(0, order - 1) * step + duration;
    },

    // The tiles run through random characters, and the code locks in from left to right
    scramble({ cells, from, to, wait, every }) {
        const start = 140, step = 58;
        const active = cells.map((cell, i) => (from[i] !== to[i] ? i : -1)).filter(i => i >= 0);
        const noisy = new Set(active);
        const chars = cells.map(cell => cell.querySelector(".ct-ch"));
        active.forEach(i => {
            cells[i].classList.remove("is-blank");
            chars[i].classList.add("is-noise");
        });
        every(46, () => noisy.forEach(i => { chars[i].textContent = noise(); }));
        active.forEach((i, order) => {
            wait(start + order * step, () => {
                noisy.delete(i);
                chars[i].textContent = to[i];
                chars[i].classList.remove("is-noise");
                if (to[i] === BLANK) cells[i].classList.add("is-blank");
            });
        });
        return start + active.length * step;
    },

    // The old code is backspaced, the new one is typed
    typewriter({ cells, from, to, wait }) {
        const erase = 30, type = 72, pause = 130;
        const chars = cells.map(cell => cell.querySelector(".ct-ch"));
        const caret = (i) => {
            cells.forEach(cell => cell.classList.remove("has-caret"));
            if (cells[i]) cells[i].classList.add("has-caret");
        };
        cells.forEach((cell, i) => {
            chars[i].textContent = from[i] === BLANK ? "" : from[i];
            cell.classList.remove("is-blank");
        });
        const written = from.map((char, i) => (char === BLANK ? -1 : i)).filter(i => i >= 0).reverse();
        written.forEach((i, order) => wait(order * erase, () => {
            chars[i].textContent = "";
            caret(i);
        }));
        const typeFrom = written.length * erase + pause;
        const letters = to.map((char, i) => (char === BLANK ? -1 : i)).filter(i => i >= 0);
        letters.forEach((i, order) => wait(typeFrom + order * type, () => {
            chars[i].textContent = to[i];
            caret(i + 1 < to.length ? i + 1 : i);
        }));
        return typeFrom + letters.length * type + 240;
    },

    // A soft dissolve: the old code blurs away while the new one comes into focus
    fade({ cells, from, to, run }) {
        const step = 16, out = 220, into = 300;
        let order = 0;
        cells.forEach((cell, i) => {
            if (from[i] === to[i]) return;
            const delay = order++ * step;
            const old = layer(cell, from[i], "ct-ch ct-temp");
            run(old, [
                { opacity: 1, filter: "blur(0)" },
                { opacity: 0, filter: "blur(5px)" },
            ], { duration: out, delay, easing: "ease-in", fill: "both" });
            run(cell.querySelector(".ct-ch"), [
                { opacity: 0, filter: "blur(5px)" },
                { opacity: 1, filter: "blur(0)" },
            ], { duration: into, delay: delay + 90, easing: "ease-out", fill: "both" });
        });
        return Math.max(0, order - 1) * step + 90 + into;
    },
};

/** A row of tiles inside `root` that shows one code at a time */
export function createBoard(root, { effect = "flip", width = MIN_WIDTH } = {}) {
    let currentEffect = TICKER_EFFECTS.includes(effect) ? effect : "flip";
    let cells = [];
    let shown = [];
    let target = [];
    let animations = [];
    let timers = [];

    root.classList.add("ct-board");
    root.setAttribute("aria-hidden", "true");

    function paint(chars) {
        cells.forEach((cell, i) => {
            cell.querySelector(".ct-ch").textContent = chars[i];
            cell.classList.toggle("is-blank", chars[i] === BLANK);
        });
    }

    /** Ends what is running at once, with the board on its final characters */
    function settle() {
        animations.forEach(animation => animation.cancel());
        animations = [];
        timers.forEach(timer => { clearTimeout(timer); clearInterval(timer); });
        timers = [];
        root.querySelectorAll(".ct-temp").forEach(el => el.remove());
        cells.forEach(cell => {
            cell.classList.remove("has-caret");
            const char = cell.querySelector(".ct-ch");
            char.className = "ct-ch";
        });
        paint(target);
        shown = target;
    }

    function resize(size) {
        settle();
        root.classList.toggle("is-long", size > LONG_CODE);
        root.textContent = "";
        cells = Array.from({ length: size }, () => {
            const cell = document.createElement("span");
            cell.className = "ct-cell is-blank";
            layer(cell, BLANK, "ct-ch");
            root.appendChild(cell);
            return cell;
        });
        shown = target = Array(size).fill(BLANK);
    }

    function show(code, { animate = true } = {}) {
        settle();
        const next = padCode(code, cells.length);
        if (next.length !== cells.length) resize(next.length);
        const from = shown;
        target = next;
        paint(target);
        shown = target;
        if (!animate || reducedMotion() || from.every((char, i) => char === target[i])) return;

        // A tile that is about to fill in needs its face from the start
        cells.forEach((cell, i) => { if (from[i] !== BLANK) cell.classList.remove("is-blank"); });
        const duration = EFFECTS[currentEffect]({
            cells,
            from,
            to: target,
            run(el, frames, options) {
                if (el.animate) animations.push(el.animate(frames, options));
            },
            wait(ms, fn) { timers.push(setTimeout(fn, ms)); },
            every(ms, fn) { timers.push(setInterval(fn, ms)); },
        });
        timers.push(setTimeout(settle, duration + 40));
    }

    resize(width);
    return {
        show,
        settle,
        resize,
        setEffect(next) { if (TICKER_EFFECTS.includes(next)) currentEffect = next; },
    };
}

/**
 * Rotates `items` ({ id }) on a board in `mount`. Waits while the pointer or focus is on `mount`,
 * and while the tab is hidden. The tiles are hidden from screen readers: `describe(code)` gives
 * `mount` the words they read instead.
 */
export function startTicker(mount, { items, effect, order, intervalSeconds, describe }) {
    let list = items;
    let settings = { order, intervalSeconds };
    let queue = [];
    let held = false;
    let timer = null;
    let current = null;

    const face = document.createElement("span");
    mount.appendChild(face);
    const board = createBoard(face, { effect, width: boardWidth(list) });


    function next() {
        if (!list.length) return;
        if (!queue.length) {
            queue = playOrder(list.length, settings.order);
            // Never the same code twice in a row when a new round starts
            if (queue.length > 1 && list[queue[0]] === current) queue.push(queue.shift());
        }
        current = list[queue.shift()];
        board.show(current.id);
        mount.dataset.code = current.id;
        if (describe) mount.setAttribute("aria-label", describe(current.id));
    }

    function schedule() {
        clearInterval(timer);
        timer = null;
        if (list.length < 2) return;
        const ms = Math.max(2000, (Number(settings.intervalSeconds) || 4) * 1000);
        timer = setInterval(() => {
            if (!held && !document.hidden) next();
        }, ms);
    }

    const hold = () => { held = true; };
    const release = () => { held = false; };
    mount.addEventListener("pointerenter", hold);
    mount.addEventListener("pointerleave", release);
    mount.addEventListener("focusin", hold);
    mount.addEventListener("focusout", release);

    next();
    schedule();

    return {
        current: () => current,
        /** New settings or quizzes; the board plays straight away so a change can be seen */
        update(changes) {
            if (changes.items) {
                list = changes.items;
                queue = [];
                board.resize(boardWidth(list));
            }
            if (changes.effect) board.setEffect(changes.effect);
            settings = { ...settings, ...changes };
            if (changes.order) queue = [];
            schedule();
            if (!list.length) {
                current = null;
                board.show("", { animate: false });
                return;
            }
            // A single code has nothing to change to, so it plays in from empty tiles
            if (list.length === 1) board.show("", { animate: false });
            next();
        },
        stop() {
            clearInterval(timer);
            board.settle();
            mount.removeEventListener("pointerenter", hold);
            mount.removeEventListener("pointerleave", release);
            mount.removeEventListener("focusin", hold);
            mount.removeEventListener("focusout", release);
        },
    };
}
