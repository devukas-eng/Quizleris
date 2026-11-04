// Drag and drop in the quiz editor, on the shared engine (bank-drag.js): questions are reordered by
// their ⋮⋮ grip with a mouse, pen or finger, and tasks dragged in from the task bank land where
// the cards part to make room.
import { armDrag, addDropZone } from "./bank-drag.js";
import { t } from "./lang.js";

const GAP = 76; // px the cards part where the drop would land

/**
 * panel: the editor panel (the whole drop zone); list: #admin-questions-list.
 * move(from, to) → moved card; insert(questions, index) → new cards; describe(index) → { title, text }
 */
export function setupEditorDnd({ panel, list, move, insert, describe }) {
    let cards = [];      // the cards' natural positions in page coordinates, measured on entering
    let listTop = 0;
    let marker = null;
    let current = -1;

    list.addEventListener("pointerdown", e => {
        const card = e.target.closest(".drag-handle")?.closest(".admin-question-item");
        if (!card || card.parentElement !== list) return;
        if (e.pointerType === "mouse") e.preventDefault();
        const index = Number(card.dataset.qidx);
        armDrag(e, {
            immediate: true,
            source: card,
            payload: { kind: "question", index },
            ghost: () => questionGhost(describe(index)),
            onStart: () => card.classList.add("is-drag-source"),
            onEnd: () => card.classList.remove("is-drag-source")
        });
    });

    function measure() {
        const scrollY = window.scrollY;
        cards = [...list.children].filter(el => el.classList.contains("admin-question-item")).map(el => {
            const rect = el.getBoundingClientRect();
            return { el, top: rect.top + scrollY, bottom: rect.bottom + scrollY };
        });
        listTop = list.getBoundingClientRect().top + scrollY;
        list.classList.add("is-drop-target");
        cards.forEach(card => card.el.classList.add("is-parting"));
        marker = document.createElement("div");
        marker.className = "editor-drop-marker";
        marker.innerHTML = `<span>${t("bank.dropHere")}</span>`;
        list.appendChild(marker);
    }

    function part(index, noop) {
        if (index === current) return;
        current = index;
        cards.forEach((card, i) => {
            card.el.style.transform = !noop && i >= index ? `translateY(${GAP}px)` : "";
        });
        const wasVisible = marker.classList.contains("is-visible");
        marker.classList.toggle("is-visible", !noop);
        if (noop) return;
        const above = index > 0 ? cards[index - 1].bottom : (cards[0]?.top ?? listTop) - 12;
        const below = index < cards.length ? cards[index].top + GAP : above + GAP;
        // It glides between gaps, but first appears where it is (not sliding in from the top)
        if (!wasVisible) marker.style.transition = "opacity 0.18s ease";
        marker.style.transform = `translateY(${(above + below) / 2 - listTop}px)`;
        if (!wasVisible) requestAnimationFrame(() => { if (marker) marker.style.transition = ""; });
    }

    addDropZone({
        el: panel,
        accepts: payload => payload.kind === "question" || payload.kind === "tasks",
        over(payload, x, y) {
            if (!marker) measure();
            const pageY = y + window.scrollY;
            let index = cards.findIndex(card => pageY < (card.top + card.bottom) / 2);
            if (index < 0) index = cards.length;
            const noop = payload.kind === "question" && (index === payload.index || index === payload.index + 1);
            part(index, noop);
            return { index, noop };
        },
        leave() {
            cards.forEach(card => {
                card.el.style.transform = "";
                card.el.classList.remove("is-parting");
            });
            cards = [];
            current = -1;
            marker?.remove();
            marker = null;
            list.classList.remove("is-drop-target");
        },
        async drop(payload, hint, point) {
            if (payload.kind === "question") {
                return hint.noop ? cards[payload.index]?.el ?? null : move(payload.index, hint.index);
            }
            marker?.classList.add("is-loading");
            const questions = await payload.questions(point);
            if (!questions?.length) return null;
            return insert(questions, hint.index)[0] ?? null;
        }
    });
}

function questionGhost({ title, text }) {
    const el = document.createElement("div");
    el.className = "drag-question";
    el.innerHTML = `<span class="drag-question-grip" aria-hidden="true">⋮⋮</span><b></b><span class="drag-question-text"></span>`;
    el.querySelector("b").textContent = title;
    const body = el.querySelector(".drag-question-text");
    body.textContent = text || "…";
    try {
        window.renderMathInElement?.(body, { delimiters: [{ left: "\\(", right: "\\)", display: false }, { left: "\\[", right: "\\]", display: false }], throwOnError: false });
    } catch {
        // the plain text stays
    }
    return el;
}
