// The feed of unsorted tasks: staff scroll through them one screen at a time, in random order, and say
// what they think of each. Enough dislikes take a task out, enough likes put it before an admin, and a
// task can go straight into one of one's #tags to be sent to the bank with them.
import * as api from "./bank-api.js";
import { escapeHtml, renderBankTaskPreviewHtml, typesetMath } from "./admin-task-cards.js";
import { t } from "./lang.js";

const PAGE = 20;
const LOAD_AHEAD = 6;    // the next page is asked for this many tasks before the end
const LAST_TAG_KEY = "quizleris_feed_tag";
const TOAST_MS = 2600;

let overlay = null;

const lastTag = () => {
    try {
        return localStorage.getItem(LAST_TAG_KEY) || "";
    } catch {
        return "";
    }
};

const rememberTag = (tag) => {
    try {
        localStorage.setItem(LAST_TAG_KEY, tag);
    } catch {
        // a private window: the tag is simply not remembered
    }
};

function cardHtml(item) {
    return `
        <article class="feed-card" data-id="${item.id}">
            <div class="feed-task">
                <div class="feed-task-head">
                    <span class="dash-chip private">#${item.id}</span>
                    <span class="dash-muted">${escapeHtml(t(`bank.qtype.${item.content?.type || "multiple-choice"}`))}</span>
                    ${item.source ? `<span class="dash-muted feed-source">${escapeHtml(item.source)}</span>` : ""}
                    <span class="feed-score"><span data-score="likes">${item.likes}</span> 👍 · <span data-score="dislikes">${item.dislikes}</span> 👎</span>
                </div>
                ${renderBankTaskPreviewHtml(item.content)}
            </div>
        </article>
    `;
}

export function closeFeed() {
    overlay?.remove();
    overlay = null;
}

/** Opens the feed over the whole screen; onClose runs when it is left, as votes change the counts. */
export async function openFeed({ onClose = () => {} } = {}) {
    closeFeed();
    const returnFocus = document.activeElement;
    const el = document.createElement("div");
    overlay = el;
    el.className = "feed-overlay";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", t("feed.title"));
    el.tabIndex = -1;
    el.innerHTML = `
        <header class="feed-head">
            <h2>${escapeHtml(t("feed.title"))}</h2>
            <span class="feed-left dash-muted"></span>
            <button type="button" class="btn btn-secondary btn-icon" data-act="close" aria-label="${escapeHtml(t("bank.close"))}">×</button>
        </header>
        <div class="feed-scroll" tabindex="-1"></div>
        <div class="feed-toast" role="status" hidden></div>
        <footer class="feed-bar">
            <button type="button" class="feed-btn is-no" data-vote="-1">👎 <span>${escapeHtml(t("feed.dislike"))}</span><kbd>←</kbd></button>
            <form class="feed-tag" autocomplete="off">
                <button type="button" class="feed-last-tag" data-act="last-tag" hidden></button>
                <input type="text" class="input-field" maxlength="41" list="feed-tags" placeholder="${escapeHtml(t("feed.tagPlaceholder"))}" aria-label="${escapeHtml(t("feed.tagPlaceholder"))}">
                <datalist id="feed-tags"></datalist>
            </form>
            <button type="button" class="feed-btn is-yes" data-vote="1">👍 <span>${escapeHtml(t("feed.like"))}</span><kbd>→</kbd></button>
        </footer>`;
    document.body.appendChild(el);
    el.focus({ preventScroll: true });

    const scroller = el.querySelector(".feed-scroll");
    const left = el.querySelector(".feed-left");
    const toastEl = el.querySelector(".feed-toast");
    const tagInput = el.querySelector(".feed-tag input");
    const lastTagBtn = el.querySelector(".feed-last-tag");
    let cursor = null;
    let started = false;
    let loading = false;
    let remaining = 0;
    let limits = { likes: 0, dislikes: 0 };
    let toastTimer = 0;
    const votes = new Map(); // id → this person's vote

    const close = () => {
        closeFeed();
        returnFocus?.focus?.({ preventScroll: true });
        onClose();
    };

    const toast = (text, tone = "ok") => {
        toastEl.textContent = text;
        toastEl.className = `feed-toast is-${tone}`;
        toastEl.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastEl.hidden = true; }, TOAST_MS);
    };

    const showLeft = () => {
        left.textContent = t("feed.left").replace("{n}", Math.max(0, remaining));
    };

    const cards = () => [...scroller.querySelectorAll(".feed-card")];
    const currentIndex = () => Math.round(scroller.scrollTop / Math.max(1, scroller.clientHeight));
    const currentCard = () => cards()[currentIndex()] || null;

    const goTo = (index) => {
        scroller.scrollTo({ top: index * scroller.clientHeight, behavior: "smooth" });
    };

    const paintButtons = () => {
        const id = Number(currentCard()?.dataset.id);
        const vote = votes.get(id) || 0;
        el.querySelectorAll("[data-vote]").forEach(button => {
            button.classList.toggle("is-on", Number(button.dataset.vote) === vote);
            button.disabled = !id;
        });
        tagInput.disabled = !id;
        lastTagBtn.disabled = !id;
    };

    const showEnd = () => {
        if (scroller.querySelector(".feed-end")) return;
        const none = !cards().length;
        scroller.insertAdjacentHTML("beforeend", `
            <div class="feed-end">
                <div class="dash-empty-icon" aria-hidden="true">${none ? "🌱" : "🎉"}</div>
                <h3>${escapeHtml(t(none ? "feed.emptyTitle" : "feed.endTitle"))}</h3>
                <p class="dash-muted">${escapeHtml(t(none ? "feed.emptyHint" : "feed.endHint"))}</p>
            </div>`);
    };

    const load = async () => {
        if (loading || (started && !cursor)) return;
        loading = true;
        const res = await api.poolFeed(cursor, PAGE);
        loading = false;
        if (overlay !== el) return;
        if (!res.ok) {
            toast(res.data?.error || t("bank.loadFailed"), "error");
            return;
        }
        started = true;
        cursor = res.data.nextCursor;
        limits = res.data.limits || limits;
        const items = res.data.items || [];
        const html = items.map(cardHtml).join("");
        if (html) {
            scroller.insertAdjacentHTML("beforeend", html);
            cards().slice(-items.length).forEach(typesetMath);
        }
        if (!cursor) showEnd();
        paintButtons();
    };

    const next = () => {
        const index = currentIndex();
        if (index >= cards().length - 1 && !scroller.querySelector(".feed-end")) return;
        goTo(index + 1);
    };

    const vote = async (value) => {
        const card = currentCard();
        const id = Number(card?.dataset.id);
        if (!id) return;
        const before = votes.get(id) || 0;
        const chosen = before === value ? 0 : value; // a second press takes the vote back
        votes.set(id, chosen);
        paintButtons();
        if (chosen) next();
        const res = await api.poolVote(id, chosen);
        if (overlay !== el) return;
        if (!res.ok) {
            votes.set(id, before);
            paintButtons();
            toast(res.status === 404 ? t("feed.gone") : res.data?.error || t("bank.saveFailed"), "error");
            return;
        }
        if (!before && chosen) remaining--;
        if (before && !chosen) remaining++;
        showLeft();
        card.querySelector('[data-score="likes"]').textContent = res.data.likes;
        card.querySelector('[data-score="dislikes"]').textContent = res.data.dislikes;
        limits = res.data.limits || limits;
        if (res.data.decision === "remove") toast(t("feed.removed"));
        else if (res.data.decision === "suggest") toast(t("feed.suggested"));
    };

    const addTag = async (raw) => {
        const card = currentCard();
        const id = Number(card?.dataset.id);
        const tag = String(raw ?? "").trim().replace(/^[#@]+/, "");
        if (!id || !tag) return;
        const res = await api.tagItems([id], { add: [tag] });
        if (overlay !== el) return;
        if (!res.ok) {
            toast(res.data?.error || t("bank.saveFailed"), "error");
            return;
        }
        rememberTag(tag);
        lastTagBtn.textContent = `+ #${tag}`;
        lastTagBtn.hidden = false;
        tagInput.value = "";
        tagInput.blur();
        el.focus({ preventScroll: true });
        toast(t("feed.tagged").replace("{tag}", `#${tag}`));
        next();
    };

    el.addEventListener("click", (e) => {
        if (e.target.closest('[data-act="close"]')) close();
        const button = e.target.closest("[data-vote]");
        if (button) vote(Number(button.dataset.vote));
        if (e.target.closest('[data-act="last-tag"]')) addTag(lastTag());
    });

    el.querySelector(".feed-tag").addEventListener("submit", (e) => {
        e.preventDefault();
        addTag(tagInput.value);
    });

    el.addEventListener("keydown", (e) => {
        e.stopPropagation(); // not the editor's shortcuts
        if (e.key === "Escape") {
            if (document.activeElement === tagInput) {
                tagInput.blur();
                el.focus({ preventScroll: true });
            } else {
                close();
            }
            return;
        }
        if (e.target === tagInput) return;
        const keys = {
            ArrowRight: () => vote(1),
            ArrowLeft: () => vote(-1),
            ArrowDown: next,
            PageDown: next,
            " ": next,
            ArrowUp: () => goTo(Math.max(0, currentIndex() - 1)),
            PageUp: () => goTo(Math.max(0, currentIndex() - 1)),
            t: () => tagInput.focus(),
        };
        const run = keys[e.key];
        if (!run) return;
        e.preventDefault();
        run();
    });

    let settle = 0;
    scroller.addEventListener("scroll", () => {
        clearTimeout(settle);
        settle = setTimeout(() => {
            paintButtons();
            if (cards().length - currentIndex() <= LOAD_AHEAD) load();
        }, 80);
    }, { passive: true });

    const remembered = lastTag();
    if (remembered) {
        lastTagBtn.textContent = `+ #${remembered}`;
        lastTagBtn.hidden = false;
    }
    paintButtons();
    const [stats, tags] = await Promise.all([api.poolStats(), api.listTags(), load()]);
    if (overlay !== el) return;
    if (stats.ok) {
        remaining = stats.data.total - stats.data.rated;
        showLeft();
    }
    if (tags.ok) {
        el.querySelector("#feed-tags").innerHTML = (tags.data.tags || []).map(row => `<option value="#${escapeHtml(row.tag)}"></option>`).join("");
    }
}
