import { fetchCloudQuizzes } from './api.js';
import { STORAGE_KEY_PREFIX, STORAGE_KEY_ALL_IDS } from './storage.js';

export async function syncCloudQuizzes() {
    try {
        const quizzes = await fetchCloudQuizzes();
        let allIds = [];
        try {
            allIds = JSON.parse(localStorage.getItem(STORAGE_KEY_ALL_IDS)) || [];
        } catch(e) {
            console.warn("Failed to parse ALL_IDS from localStorage", e);
        }
        let updated = false;

        for (const quiz of quizzes) {
            // We just store the basic info in localStorage so it appears in the Dashboard/Discovery Hub
            // We don't overwrite local quizzes if they already exist, to prevent erasing local edits
            if (!allIds.includes(quiz.id)) {
                allIds.push(quiz.id);
                // Create a stub quiz payload just so it renders in the menu. 
                // Full quiz data will be fetched when they click on it!
                const stub = {
                    id: quiz.id,
                    title: quiz.title,
                    questions: [],
                    cloud_synced: true,
                    author: quiz.author,
                    visibility: quiz.visibility
                };
                localStorage.setItem(STORAGE_KEY_PREFIX + quiz.id, JSON.stringify(stub));
                updated = true;
            }
        }

        if (updated) {
            localStorage.setItem(STORAGE_KEY_ALL_IDS, JSON.stringify(allIds));
            // Trigger a UI refresh if needed
            window.dispatchEvent(new Event('quizleris_cloud_synced'));
        }
    } catch(e) {
        console.error("Failed to sync cloud quizzes", e);
    }
}
