import { t } from "./lang.js";

// Radial question-type picker. Each "kind" is what the teacher picks; it maps onto the stored
// question fields (single/multi are both type "multiple-choice", told apart by allowMultipleAnswers).

const svg = (paths) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const QUESTION_KINDS = [
    {
        key: "single", label: "qtype.single", desc: "qtype.singleDesc", short: "1✓",
        icon: svg('<circle cx="6" cy="7" r="2.6" fill="currentColor"/><path d="M11 7h9"/><circle cx="6" cy="17" r="2.6"/><path d="M11 17h9"/>')
    },
    {
        key: "multi", label: "qtype.multi", desc: "qtype.multiDesc", short: "✓✓",
        icon: svg('<rect x="3" y="4" width="6" height="6" rx="1.5"/><path d="M4.6 7.1l1.3 1.3 2-2.4"/><path d="M12.5 7h8"/><rect x="3" y="14" width="6" height="6" rx="1.5"/><path d="M4.6 17.1l1.3 1.3 2-2.4"/><path d="M12.5 17h8"/>')
    },
    {
        key: "true-false", label: "qtype.trueFalse", desc: "qtype.trueFalseDesc", short: "T/F",
        icon: svg('<path d="M3 12.5l3 3 5.5-6.5"/><path d="M15 9l6 6M21 9l-6 6"/>')
    },
    {
        key: "numeric", label: "qtype.numeric", desc: "qtype.numericDesc", short: "123",
        icon: svg('<path d="M9.5 4L7.5 20M16.5 4l-2 16M4.5 9h15.5M4 15h15.5"/>')
    },
    {
        key: "fill-blank", label: "qtype.fillBlank", desc: "qtype.fillBlankDesc", short: "_ _",
        icon: svg('<path d="M3.5 8h17"/><path d="M3.5 15.5h4"/><path d="M10 17h5" stroke-width="2.6"/><path d="M17.5 15.5h3"/>')
    },
    {
        key: "text", label: "qtype.text", desc: "qtype.textDesc", short: "Aa",
        icon: svg('<path d="M4 6h16M4 11h16M4 16h8.5"/><path d="M16.5 14.5v6M15 14.5h3M15 20.5h3"/>')
    },
    {
        key: "image-upload", label: "qtype.image", desc: "qtype.imageDesc", short: "IMG",
        icon: svg('<rect x="3" y="7" width="18" height="13" rx="2.5"/><circle cx="12" cy="13.5" r="3.4"/><path d="M8.5 7l1.6-2.5h3.8L15.5 7"/>')
    }
];

// What a single answer slot of a choice question is. Students pick a slot; "write" and
// "number" slots also take what they type, which is checked against the teacher's answer.
export const ANSWER_KINDS = [
    {
        key: "option", label: "akind.option", desc: "akind.optionDesc",
        icon: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>')
    },
    {
        key: "write", label: "akind.write", desc: "akind.writeDesc",
        icon: svg('<path d="M4 20l1.2-4.2L15.5 5.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8z"/><path d="M13.5 7.5l3 3"/>')
    },
    {
        key: "number", label: "akind.number", desc: "akind.numberDesc",
        icon: svg('<path d="M9.5 4L7.5 20M16.5 4l-2 16M4.5 9h15.5M4 15h15.5"/>')
    }
];

export function kindOfChoice(choice) {
    return ANSWER_KINDS.some(k => k.key === choice?.kind) ? choice.kind : "option";
}

/** HTML for the small per-answer button that shows the slot kind and opens the wheel. */
export function answerKindTriggerHtml(choice, qIdx, cIdx) {
    const kind = ANSWER_KINDS.find(k => k.key === kindOfChoice(choice));
    const label = `${t("akind.title")}: ${t(kind.label)}`;
    return `<button type="button" class="answer-kind-trigger" data-qidx="${qIdx}" data-cidx="${cIdx}"
        aria-haspopup="dialog" aria-label="${label}" title="${label}">${kind.icon}</button>`;
}

const CHEVRON = svg('<path d="M7 10l5 5 5-5"/>');

export function kindOfQuestion(q) {
    const type = q.type || "multiple-choice";
    if (type === "multiple-choice") return q.allowMultipleAnswers ? "multi" : "single";
    return QUESTION_KINDS.some(k => k.key === type) ? type : "single";
}

export function getKind(key) {
    return QUESTION_KINDS.find(k => k.key === key) || QUESTION_KINDS[0];
}

/** HTML for the button that shows the current type and opens the wheel. */
export function typeTriggerHtml(q, qIdx) {
    const kind = getKind(kindOfQuestion(q));
    const label = t(kind.label);
    return `
        <button type="button" class="qtype-trigger" data-qidx="${qIdx}" aria-haspopup="dialog"
            aria-label="${t("qtype.title")}: ${label}" title="${t("qtype.title")}">
            <span class="qtype-trigger-icon">${kind.icon}</span>
            <span class="qtype-trigger-label">${label}</span>
            <span class="qtype-trigger-chevron">${CHEVRON}</span>
        </button>
    `;
}

let openWheel = null;

/**
 * Opens the radial picker centred on `trigger`.
 * @param {HTMLElement} trigger
 * @param {string} currentKey
 * @param {(key: string) => void} onSelect
 * @param {{ kinds?: typeof QUESTION_KINDS, title?: string }} [options] defaults to question types
 */
export function openTypeWheel(trigger, currentKey, onSelect, options = {}) {
    closeTypeWheel(false);

    const kinds = options.kinds || QUESTION_KINDS;
    const title = options.title || t("qtype.title");
    const getKind = (key) => kinds.find(k => k.key === key) || kinds[0];
    const count = kinds.length;
    const radius = count <= 4 ? 76 : (window.innerWidth < 420 ? 88 : 100);
    const size = radius * 2 + 64;

    const overlay = document.createElement("div");
    overlay.className = "qtype-wheel-overlay";
    const wheel = document.createElement("div");
    wheel.className = "qtype-wheel";
    wheel.setAttribute("role", "dialog");
    wheel.setAttribute("aria-label", title);
    wheel.style.setProperty("--size", `${size}px`);

    const items = kinds.map((kind, i) => {
        const angle = (-90 + (360 / count) * i) * (Math.PI / 180);
        const x = Math.round(Math.cos(angle) * radius);
        const y = Math.round(Math.sin(angle) * radius);
        const label = t(kind.label);
        return `
            <button type="button" class="qtype-wheel-item ${kind.key === currentKey ? "current" : ""}"
                data-key="${kind.key}" style="--x: ${x}px; --y: ${y}px; --i: ${i};"
                aria-label="${label}" aria-pressed="${kind.key === currentKey}">${kind.icon}</button>
        `;
    }).join("");

    wheel.innerHTML = `
        <div class="qtype-wheel-disc"></div>
        <div class="qtype-wheel-hub" aria-live="polite">
            <div class="qtype-hub-label"></div>
            <div class="qtype-hub-desc"></div>
        </div>
        ${items}
        <div class="qtype-wheel-hint">${t("qtype.hint")}</div>
    `;
    overlay.appendChild(wheel);
    document.body.appendChild(overlay);

    // Centre on the trigger, kept fully on screen (re-run when the viewport changes, e.g. when
    // a phone's on-screen keyboard closes, instead of dismissing the wheel)
    const half = size / 2;
    const position = () => {
        const rect = trigger.getBoundingClientRect();
        const cx = Math.min(Math.max(rect.left + rect.width / 2, half + 8), window.innerWidth - half - 8);
        const cy = Math.min(Math.max(rect.top + rect.height / 2, half + 8), window.innerHeight - half - 40);
        wheel.style.left = `${cx - half}px`;
        wheel.style.top = `${cy - half}px`;
    };
    position();

    const buttons = [...wheel.querySelectorAll(".qtype-wheel-item")];
    const hubLabel = wheel.querySelector(".qtype-hub-label");
    const hubDesc = wheel.querySelector(".qtype-hub-desc");
    const showHub = (key) => {
        const kind = getKind(key);
        hubLabel.textContent = t(kind.label);
        hubDesc.textContent = t(kind.desc);
        buttons.forEach(b => b.classList.toggle("hover", b.dataset.key === key));
    };
    showHub(currentKey);

    const focusIndex = (i) => {
        const btn = buttons[(i + count) % count];
        btn.focus();
        showHub(btn.dataset.key);
    };
    const currentIndex = () => Math.max(0, buttons.indexOf(document.activeElement));

    const choose = (key) => {
        const btn = buttons.find(b => b.dataset.key === key);
        btn?.classList.add("picked");
        closeTypeWheel(false);
        if (key !== currentKey) onSelect(key);
        else trigger.focus();
    };

    buttons.forEach(btn => {
        btn.addEventListener("mouseenter", () => showHub(btn.dataset.key));
        btn.addEventListener("focus", () => showHub(btn.dataset.key));
        btn.addEventListener("click", () => choose(btn.dataset.key));
    });
    wheel.addEventListener("mouseleave", () => {
        if (!wheel.contains(document.activeElement)) showHub(currentKey);
    });

    wheel.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); focusIndex(currentIndex() + 1); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); focusIndex(currentIndex() - 1); }
        else if (e.key === "Home") { e.preventDefault(); focusIndex(0); }
        else if (e.key === "End") { e.preventDefault(); focusIndex(count - 1); }
        else if (e.key === "Tab") { e.preventDefault(); focusIndex(currentIndex() + (e.shiftKey ? -1 : 1)); }
        else if (e.key === "Escape") { e.preventDefault(); closeTypeWheel(true); }
    });

    // Scroll to spin through the types
    let wheelLock = 0;
    wheel.addEventListener("wheel", (e) => {
        e.preventDefault();
        const now = Date.now();
        if (now - wheelLock < 110 || Math.abs(e.deltaY) < 2) return;
        wheelLock = now;
        focusIndex(currentIndex() + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });

    overlay.addEventListener("mousedown", (e) => {
        if (e.target === overlay) closeTypeWheel(true);
    });

    const onViewportChange = () => {
        if (!trigger.isConnected) closeTypeWheel(false);
        else position();
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);

    openWheel = { overlay, trigger, cleanup: () => {
        window.removeEventListener("resize", onViewportChange);
        window.removeEventListener("scroll", onViewportChange, true);
    } };

    requestAnimationFrame(() => {
        wheel.classList.add("open");
        focusIndex(Math.max(0, kinds.findIndex(k => k.key === currentKey)));
        setTimeout(() => wheel.classList.add("settled"), 450);
    });
}

export function closeTypeWheel(returnFocus) {
    if (!openWheel) return;
    const { overlay, trigger, cleanup } = openWheel;
    openWheel = null;
    cleanup();
    overlay.querySelector(".qtype-wheel")?.classList.remove("open");
    overlay.classList.add("closing");
    setTimeout(() => overlay.remove(), 200);
    if (returnFocus && trigger.isConnected) trigger.focus();
}
