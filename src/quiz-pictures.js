// How a quiz's pictures are written. Once saved, a picture lives on the server and a question holds its
// address (/api/media/<hash>). Until then, and in quizzes not saved since this came in, it is a data
// URL inside the quiz, or in the oldest quizzes bare base64 JPEG.
const STORED_PICTURE_RE = /^\/api\/media\/[0-9a-f]{64}$/;

export function isStoredPicture(value) {
    return typeof value === "string" && STORED_PICTURE_RE.test(value);
}

/** What an <img> can show for a picture as a question holds it. */
export function imageSrc(value) {
    if (typeof value !== "string" || !value) return "";
    if (isStoredPicture(value) || /^(data:|local:|https?:)/.test(value)) return value;
    return `data:image/jpeg;base64,${value}`;
}

function* picturesOf(quiz) {
    for (const question of quiz?.questions || []) {
        for (const holder of [question, ...(question?.choices || [])]) {
            if (holder?.image) yield { question, holder };
        }
    }
}

// The same key as pictureKey in src/backend/quiz-links.js
const keyOf = (question, holder) => `${question.id}|${holder === question ? "" : holder.id}`;

/** The pictures still inside a quiz, to compare with after a save. */
export function embeddedPictures(quiz) {
    const sent = new Map();
    for (const { question, holder } of picturesOf(quiz)) {
        if (!isStoredPicture(holder.image)) sent.set(keyOf(question, holder), holder.image);
    }
    return sent;
}

/** After a save: the quiz stops carrying what the server now keeps, unless the picture was changed meanwhile. */
export function adoptStoredPictures(quiz, stored, sent) {
    if (!stored) return;
    for (const { question, holder } of picturesOf(quiz)) {
        const key = keyOf(question, holder);
        if (stored[key] && holder.image === sent.get(key)) holder.image = stored[key];
    }
}

/**
 * Starts loading all of a quiz's stored pictures, and resolves when they are in or `waitMs` has passed.
 * A test then carries on if the network drops, and the page does not jump as pictures arrive.
 */
export function preloadPictures(quiz, waitMs = 2500) {
    const urls = new Set();
    for (const { holder } of picturesOf(quiz)) if (isStoredPicture(holder.image)) urls.add(holder.image);
    if (!urls.size) return Promise.resolve();
    const loads = [...urls].map(url => new Promise(resolve => {
        const img = new Image();
        img.onload = img.onerror = resolve;
        img.src = url;
    }));
    return Promise.race([Promise.all(loads), new Promise(resolve => setTimeout(resolve, waitMs))]);
}
