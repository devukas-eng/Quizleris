
// ─── Player Profile & Progression System ───
export const STORAGE_KEY_XP = "quizleris_player_xp";

export function getPlayerXP() {
    return parseInt(localStorage.getItem(STORAGE_KEY_XP) || "0", 10);
}

export function getPlayerLevel(xp) {
    // Basic curve: Level = 1 + floor(sqrt(XP / 100))
    // e.g. 0 XP = Lv 1. 100 XP = Lv 2. 400 XP = Lv 3. 900 XP = Lv 4.
    return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 100));
}

export function getXPForNextLevel(level) {
    return Math.pow(level, 2) * 100;
}

export function addPlayerXP(amount) {
    if (amount <= 0) return false;
    const oldXp = getPlayerXP();
    const oldLevel = getPlayerLevel(oldXp);
    
    const newXp = oldXp + amount;
    localStorage.setItem(STORAGE_KEY_XP, newXp);
    
    const newLevel = getPlayerLevel(newXp);
    return newLevel > oldLevel; // Returns true if leveled up
}

// Storage keys
export const STORAGE_KEY_PREFIX = "quiz_";
export const STORAGE_KEY_ALL_IDS = "quiz_all_ids";
export const STORAGE_KEY_IMAGE_REGISTRY_PREFIX = "quiz-images_";
/**
 * Generates a collision-resistant, non-guessable quiz ID (fits the server's VARCHAR(50) / [A-Za-z0-9_-] rule).
 */
export function generateQuizId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") {
        return `quiz_${c.randomUUID().replace(/-/g, "")}`;
    }
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return `quiz_${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}`;
}
import { saveQuizToCloud, fetchQuizDetails } from "./api.js";

/**
 * 2026 Senior Concept: Pure Cloud Mode. Saves instantly to cloud. LocalStorage is deprecated for quizzes.
 */
export async function saveQuizToStorage(quizData) {
    // Cloud Sync
    const result = await saveQuizToCloud(quizData);
    if (result.success) {
        console.log(`[CloudSync] Quiz ${quizData.id} synced to MySQL!`);
    }
    return result;
}
// Load quiz strictly from the cloud (sends the login token so owners can open their private quizzes)
export async function loadQuizFromStorage(quizId) {
    try {
        return await fetchQuizDetails(quizId);
    } catch (err) {
        console.error("Cloud fetch failed", err);
        return null;
    }
}
// Get all saved quiz IDs (Deprecated)
export function getAllQuizIds() {
    return [];
}
export async function loadQuiz() {
    // Check URL param first: ?quiz=abc123
    const params = new URLSearchParams(window.location.search);
    const quizParam = params.get("quiz");
    if (quizParam) {
        // Try to decode as base64 JSON (for sharing)
        try {
            // Enhanced decoding: supports UTF-8 (Lithuanian chars) and handles binary data safety.
            const binary = atob(quizParam);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++)
                bytes[i] = binary.charCodeAt(i);
            const decoded = new TextDecoder().decode(bytes);
            const parsed = JSON.parse(decoded);
            const prefix = "data:image/jpeg;base64,";
            parsed.questions.forEach(q => {
                if (q.image && !q.image.startsWith("data:") && !q.image.startsWith("local:")) {
                    q.image = prefix + q.image;
                }
                q.choices?.forEach(c => {
                    if (c.image && !c.image.startsWith("data:") && !c.image.startsWith("local:")) {
                        c.image = prefix + c.image;
                    }
                });
            });
            return parsed;
        }
        catch (e) {
            console.warn("Base64 decode failed, trying raw string lookup", e);
            // It might be a quiz ID from the cloud database
            const loaded = await loadQuizFromStorage(quizParam);
            return loaded || null;
        }
    }
    return null;
}


// Premade quizzes moved to the database (data/premade-quizzes.json, seeded by the server on boot)
// so their answers no longer ship in the frontend. Players open them by entering the quiz ID.
export function getTopicBundles() {
    return [];
}
export const STORAGE_KEY_RESULTS = "quiz_results";
/**
 * Records a student's quiz result in the local history.
 */
export function saveResult(result) {
    const results = getResults();
    results.push(result);
    localStorage.setItem(STORAGE_KEY_RESULTS, JSON.stringify(results));
}
export function getResults() {
    const data = localStorage.getItem(STORAGE_KEY_RESULTS);
    if (!data)
        return [];
    try {
        return JSON.parse(data);
    }
    catch {
        return [];
    }
}
export function getResultsByQuizId(quizId) {
    return getResults().filter(r => r.quizId === quizId);
}
export function clearResults() {
    localStorage.removeItem(STORAGE_KEY_RESULTS);
}
export function getHighScores(allResults) {
    const results = allResults || getResults();
    const highScores = new Map();
    results.forEach(r => {
        if (!highScores.has(r.quizId) || r.score > highScores.get(r.quizId).score) {
            highScores.set(r.quizId, r);
        }
    });
    return Array.from(highScores.values());
}
/**
 * Stores a map of image IDs to Base64 data for a specific quiz.
 * This is used to keep shareable URLs short by moving image data to local storage.
 */
export function saveImageRegistry(quizId, images) {
    const key = STORAGE_KEY_IMAGE_REGISTRY_PREFIX + quizId;
    localStorage.setItem(key, JSON.stringify(images));
}
export function getImageFromRegistry(quizId, imgId) {
    const key = STORAGE_KEY_IMAGE_REGISTRY_PREFIX + quizId;
    const data = localStorage.getItem(key);
    if (!data)
        return null;
    try {
        const registry = JSON.parse(data);
        return registry[imgId] || null;
    }
    catch {
        return null;
    }
}

/**
 * Clears all locally saved quizzes from localStorage.
 * Preserves the result history, but wipes all user-created quizzes and their image registries.
 */
export function clearAllLocalQuizzes() {
    const allIds = getAllQuizIds();
    allIds.forEach(id => {
        localStorage.removeItem(STORAGE_KEY_PREFIX + id);
        localStorage.removeItem(STORAGE_KEY_IMAGE_REGISTRY_PREFIX + id);
    });
    localStorage.removeItem(STORAGE_KEY_ALL_IDS);
}
