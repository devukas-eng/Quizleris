

// ─── Player Profile & Progression System ───
const STORAGE_KEY_XP = "quizleris_player_xp";

function getPlayerXP() {
    return parseInt(localStorage.getItem(STORAGE_KEY_XP) || "0", 10);
}

function getPlayerLevel(xp) {
    // Basic curve: Level = 1 + floor(sqrt(XP / 100))
    // e.g. 0 XP = Lv 1. 100 XP = Lv 2. 400 XP = Lv 3. 900 XP = Lv 4.
    return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 100));
}

function getXPForNextLevel(level) {
    return Math.pow(level, 2) * 100;
}

function addPlayerXP(amount) {
    if (amount <= 0) return false;
    const oldXp = getPlayerXP();
    const oldLevel = getPlayerLevel(oldXp);
    
    const newXp = oldXp + amount;
    localStorage.setItem(STORAGE_KEY_XP, newXp);
    
    const newLevel = getPlayerLevel(newXp);
    return newLevel > oldLevel; // Returns true if leveled up
}

// Storage keys
const STORAGE_KEY_PREFIX = "quiz_";
const STORAGE_KEY_ALL_IDS = "quiz_all_ids";
const STORAGE_KEY_IMAGE_REGISTRY_PREFIX = "quiz-images_";
/**
 * Generates a unique-enough ID for a quiz using the current timestamp.
 * NOTE: In a multi-user or high-concurrency environment, this should be replaced with a UUID.
 */
function generateQuizId() {
    return `quiz_${Date.now()}`;
}


/**
 * Persists a quiz object to localStorage and updates the global ID index.
 * 2026 Senior Concept: Local-First storage. Saves instantly locally, syncs to cloud in background.
 */
function saveQuizToStorage(quizData) {
    const key = STORAGE_KEY_PREFIX + quizData.id;
    localStorage.setItem(key, JSON.stringify(quizData));
    // Track all quiz IDs
    const allIds = getAllQuizIds();
    if (!allIds.includes(quizData.id)) {
        allIds.push(quizData.id);
        localStorage.setItem(STORAGE_KEY_ALL_IDS, JSON.stringify(allIds));
    }
    
    // Cloud Sync (Background)
    saveQuizToCloud(quizData).then(success => {
        if (success) console.log(`[CloudSync] Quiz ${quizData.id} synced to MySQL!`);
    });
}
// Load quiz from localStorage by ID
function loadQuizFromStorage(quizId) {
    const key = STORAGE_KEY_PREFIX + quizId;
    const data = localStorage.getItem(key);
    if (!data) {
        // Fallback to premade
        if (quizId === "demo")
            return getDemoQuiz();
        const premade = getPremadeQuizzes().find(q => q.id === quizId);
        return premade || null;
    }
    try {
        return JSON.parse(data);
    }
    catch {
        return null;
    }
}
// Get all saved quiz IDs
function getAllQuizIds() {
    const data = localStorage.getItem(STORAGE_KEY_ALL_IDS);
    if (!data)
        return [];
    try {
        return JSON.parse(data);
    }
    catch {
        return [];
    }
}
/**
 * The primary loading routine for the application.
 * Checks for a 'quiz' URL parameter (Base64 data) first, then falls back to localStorage.
 * Handles the heavy lifting of Base64 decoding and image registry restoration.
 */
function loadQuiz() {
    // Check URL param first: ?quiz=abc123
    const params = new URLSearchParams(window.location.search);
    const quizParam = params.get("quiz");
    if (quizParam) {
        // Try to decode as base64 JSON (for sharing)
        try {
            // Enhanced decoding: supports UTF-8 (Lithuanian chars) and handles binary data safety.
            // Uses TextDecoder to correctly interpret multi-byte characters.
            const binary = atob(quizParam);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++)
                bytes[i] = binary.charCodeAt(i);
            const decoded = new TextDecoder().decode(bytes);
            const parsed = JSON.parse(decoded);
            // Restore image prefixes (Approach #1) and Local Registry references (Approach #2)
            const prefix = "data:image/jpeg;base64,";
            parsed.questions.forEach(q => {
                // Handle Approach #1 (Prefix Stripping)
                if (q.image && !q.image.startsWith("data:") && !q.image.startsWith("local:")) {
                    q.image = prefix + q.image;
                }
                // Handle Approach #2 (Local Registry)
                if (q.image?.startsWith("local:")) {
                    const imgId = q.image.substring(6);
                    q.image = getImageFromRegistry(parsed.id, imgId) || "";
                }
                q.choices?.forEach(c => {
                    // Handle Approach #1
                    if (c.image && !c.image.startsWith("data:") && !c.image.startsWith("local:")) {
                        c.image = prefix + c.image;
                    }
                    // Handle Approach #2
                    if (c.image?.startsWith("local:")) {
                        const imgId = c.image.substring(6);
                        c.image = getImageFromRegistry(parsed.id, imgId) || "";
                    }
                });
            });
            return parsed;
        }
        catch (e) {
            console.warn("Base64 decode failed, trying raw string lookup", e);
            // If not base64, treat as localStorage ID
            const loaded = loadQuizFromStorage(quizParam);
            if (loaded)
                return loaded;
        }
    }
    // Try to load from localStorage (most recent, or first available)
    const allIds = getAllQuizIds();
    if (allIds.length > 0) {
        const lastId = allIds[allIds.length - 1];
        const loaded = loadQuizFromStorage(lastId);
        if (loaded)
            return loaded;
    }
    // Fallback: return a default demo quiz
    // Fallback: return a default demo quiz
    return getDemoQuiz();
}
function getDemoQuiz() {
    return {
        id: "demo",
        title: t('quiz.demoTitle'),
        questions: [
            {
                id: "q1",
                prompt: "What is the derivative of \\(x^2\\)?",
                choices: [
                    { id: "a", text: "\\(2x\\)", isCorrect: true },
                    { id: "b", text: "\\(x\\)", isCorrect: false },
                    { id: "c", text: "\\(x^2\\)", isCorrect: false },
                    { id: "d", text: "\\(2\\)", isCorrect: false },
                ],
            },
        ],
    };
}
function getPremadeQuizzes() {
    return [
        {
            ...getDemoQuiz(),
            shuffleConfig: { questions: true, answers: true }
        },
        {
            id: "algebra",
            title: t('quiz.algebraTitle'),
            questions: [
                {
                    id: "a1",
                    prompt: "Solve for \\(x\\): \\(2x + 5 = 15\\)",
                    choices: [
                        { id: "a", text: "5", isCorrect: true },
                        { id: "b", text: "10", isCorrect: false },
                        { id: "c", text: "2.5", isCorrect: false },
                        { id: "d", text: "7.5", isCorrect: false }
                    ]
                },
                {
                    id: "a2",
                    prompt: "Expand the expression \\((x+3)(x-3)\\)",
                    choices: [
                        { id: "a", text: "\\(x^2 - 9\\)", isCorrect: true },
                        { id: "b", text: "\\(x^2 + 9\\)", isCorrect: false },
                        { id: "c", text: "\\(x^2 - 6x + 9\\)", isCorrect: false },
                        { id: "d", text: "\\(x^2 + 6x + 9\\)", isCorrect: false }
                    ]
                },
                {
                    id: "a3",
                    prompt: "Simplify: \\(3(x - 2) + 4x\\)",
                    choices: [
                        { id: "a", text: "\\(7x - 6\\)", isCorrect: true },
                        { id: "b", text: "\\(7x - 2\\)", isCorrect: false },
                        { id: "c", text: "\\(x - 6\\)", isCorrect: false },
                        { id: "d", text: "\\(12x - 6\\)", isCorrect: false }
                    ]
                }
            ],
            shuffleConfig: { questions: true, answers: true }
        },
        {
            id: "combinatorics",
            title: t('quiz.combinatoricsTitle'),
            questions: [
                {
                    id: "c1",
                    prompt: "How many distinct ways can the letters in the word 'BANANA' be arranged?",
                    choices: [
                        { id: "a", text: "60", isCorrect: true },
                        { id: "b", text: "120", isCorrect: false },
                        { id: "c", text: "720", isCorrect: false },
                        { id: "d", text: "360", isCorrect: false }
                    ]
                },
                {
                    id: "c2",
                    prompt: "A committee of 3 people is to be chosen from a group of 10. How many different committees are possible?",
                    choices: [
                        { id: "a", text: "120", isCorrect: true },
                        { id: "b", text: "720", isCorrect: false },
                        { id: "c", text: "30", isCorrect: false },
                        { id: "d", text: "1000", isCorrect: false }
                    ]
                },
                {
                    id: "c3",
                    prompt: "In how many ways can 5 people span in a line?",
                    choices: [
                        { id: "a", text: "120", isCorrect: true },
                        { id: "b", text: "24", isCorrect: false },
                        { id: "c", text: "720", isCorrect: false },
                        { id: "d", text: "25", isCorrect: false }
                    ]
                },
                {
                    id: "c4",
                    prompt: "What is the coefficient of \\(x^2\\) in the expansion of \\((1+x)^5\\)?",
                    choices: [
                        { id: "a", text: "10", isCorrect: true },
                        { id: "b", text: "5", isCorrect: false },
                        { id: "c", text: "20", isCorrect: false },
                        { id: "d", text: "1", isCorrect: false }
                    ]
                },
                {
                    id: "c5",
                    prompt: "You have 4 different math books and 5 different history books. How many ways can you arrange them on a shelf if books of the same subject must be together?",
                    choices: [
                        { id: "a", text: "69,120", isCorrect: false },
                        { id: "b", text: "5,760", isCorrect: true },
                        { id: "c", text: "362,880", isCorrect: false },
                        { id: "d", text: "20", isCorrect: false }
                    ]
                }
            ],
            shuffleConfig: { questions: true, answers: true }
        }
    ];
}
function getTopicBundles() {
    return [
        {
            id: "algebra-linear-beginner",
            title: "Algebra: Linear Equations",
            language: "en",
            category: "math",
            difficulty: "beginner",
            estimatedMinutes: 15,
            mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 45 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "alg_lin_b_1", prompt: "Solve for \\(x\\): \\(3x + 7 = 22\\)", choices: [{ id: "a", text: "5", isCorrect: true }, { id: "b", text: "3", isCorrect: false }, { id: "c", text: "7", isCorrect: false }, { id: "d", text: "15", isCorrect: false }] },
                { id: "alg_lin_b_2", prompt: "Solve for \\(x\\): \\(2x - 8 = 10\\)", choices: [{ id: "a", text: "9", isCorrect: true }, { id: "b", text: "8", isCorrect: false }, { id: "c", text: "4", isCorrect: false }, { id: "d", text: "6", isCorrect: false }] },
                { id: "alg_lin_b_3", prompt: "Solve for \\(x\\): \\(5x = 35\\)", choices: [{ id: "a", text: "7", isCorrect: true }, { id: "b", text: "5", isCorrect: false }, { id: "c", text: "30", isCorrect: false }, { id: "d", text: "40", isCorrect: false }] },
                { id: "alg_lin_b_4", prompt: "Solve for \\(x\\): \\(x/4 = 6\\)", choices: [{ id: "a", text: "24", isCorrect: true }, { id: "b", text: "10", isCorrect: false }, { id: "c", text: "2", isCorrect: false }, { id: "d", text: "1.5", isCorrect: false }] },
                { id: "alg_lin_b_5", prompt: "Solve for \\(x\\): \\(4x + 3 = 19\\)", choices: [{ id: "a", text: "4", isCorrect: true }, { id: "b", text: "16", isCorrect: false }, { id: "c", text: "5", isCorrect: false }, { id: "d", text: "3", isCorrect: false }] },
                { id: "alg_lin_b_6", prompt: "Solve for \\(x\\): \\(6 - 2x = 0\\)", choices: [{ id: "a", text: "3", isCorrect: true }, { id: "b", text: "2", isCorrect: false }, { id: "c", text: "6", isCorrect: false }, { id: "d", text: "4", isCorrect: false }] },
                { id: "alg_lin_b_7", prompt: "Solve for \\(x\\): \\(9 + x = 15\\)", choices: [{ id: "a", text: "6", isCorrect: true }, { id: "b", text: "24", isCorrect: false }, { id: "c", text: "9", isCorrect: false }, { id: "d", text: "15", isCorrect: false }] },
                { id: "alg_lin_b_8", prompt: "Solve for \\(x\\): \\(2x + 5 = x + 8\\)", choices: [{ id: "a", text: "3", isCorrect: true }, { id: "b", text: "13", isCorrect: false }, { id: "c", text: "5", isCorrect: false }, { id: "d", text: "2", isCorrect: false }] },
                { id: "alg_lin_b_9", prompt: "Solve for \\(y\\): \\(3y - 4 = 11\\)", choices: [{ id: "a", text: "5", isCorrect: true }, { id: "b", text: "3", isCorrect: false }, { id: "c", text: "7", isCorrect: false }, { id: "d", text: "4", isCorrect: false }] },
                { id: "alg_lin_b_10", prompt: "Solve for \\(x\\): \\(7x = 42\\)", choices: [{ id: "a", text: "6", isCorrect: true }, { id: "b", text: "7", isCorrect: false }, { id: "c", text: "35", isCorrect: false }, { id: "d", text: "49", isCorrect: false }] },
                { id: "alg_lin_b_11", prompt: "Solve for \\(x\\): \\(10 - x = 3\\)", choices: [{ id: "a", text: "7", isCorrect: true }, { id: "b", text: "10", isCorrect: false }, { id: "c", text: "13", isCorrect: false }, { id: "d", text: "3", isCorrect: false }] },
                { id: "alg_lin_b_12", prompt: "Solve for \\(x\\): \\(x/3 + 2 = 5\\)", choices: [{ id: "a", text: "9", isCorrect: true }, { id: "b", text: "3", isCorrect: false }, { id: "c", text: "15", isCorrect: false }, { id: "d", text: "6", isCorrect: false }] }
            ]
        },
        {
            id: "algebra-quadratic-intermediate",
            title: "Algebra: Quadratic Equations",
            language: "en",
            category: "math",
            difficulty: "intermediate",
            estimatedMinutes: 20,
            mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 60 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "alg_quad_i_1", prompt: "Solve: \\(x^2 - 5x + 6 = 0\\)", choices: [{ id: "a", text: "\\(x = 2, 3\\)", isCorrect: true }, { id: "b", text: "\\(x = 1, 6\\)", isCorrect: false }, { id: "c", text: "\\(x = -2, -3\\)", isCorrect: false }, { id: "d", text: "\\(x = 0, 5\\)", isCorrect: false }] },
                { id: "alg_quad_i_2", prompt: "Solve: \\(x^2 - 9 = 0\\)", choices: [{ id: "a", text: "\\(x = \\pm 3\\)", isCorrect: true }, { id: "b", text: "\\(x = 3\\)", isCorrect: false }, { id: "c", text: "\\(x = 9\\)", isCorrect: false }, { id: "d", text: "\\(x = 0\\)", isCorrect: false }] },
                { id: "alg_quad_i_3", prompt: "Solve: \\(2x^2 + x - 1 = 0\\)", choices: [{ id: "a", text: "\\(x = \\frac{1}{2}, -1\\)", isCorrect: true }, { id: "b", text: "\\(x = 1, 2\\)", isCorrect: false }, { id: "c", text: "\\(x = 2, -\\frac{1}{2}\\)", isCorrect: false }, { id: "d", text: "\\(x = -\\frac{1}{2}, 2\\)", isCorrect: false }] },
                { id: "alg_quad_i_4", prompt: "What is the vertex of \\(y = (x-2)^2 + 3\\)?", choices: [{ id: "a", text: "(2, 3)", isCorrect: true }, { id: "b", text: "(-2, 3)", isCorrect: false }, { id: "c", text: "(2, -3)", isCorrect: false }, { id: "d", text: "(3, 2)", isCorrect: false }] },
                { id: "alg_quad_i_5", prompt: "Solve: \\(x^2 + 4x + 4 = 0\\)", choices: [{ id: "a", text: "\\(x = -2\\)", isCorrect: true }, { id: "b", text: "\\(x = 2\\)", isCorrect: false }, { id: "c", text: "\\(x = \\pm 2\\)", isCorrect: false }, { id: "d", text: "No real solution", isCorrect: false }] },
                { id: "alg_quad_i_6", prompt: "Solve: \\(x^2 - 7x + 12 = 0\\)", choices: [{ id: "a", text: "\\(x = 3, 4\\)", isCorrect: true }, { id: "b", text: "\\(x = 2, 6\\)", isCorrect: false }, { id: "c", text: "\\(x = -3, -4\\)", isCorrect: false }, { id: "d", text: "\\(x = 7, 12\\)", isCorrect: false }] },
                { id: "alg_quad_i_7", prompt: "Solve: \\(3x^2 - 12 = 0\\)", choices: [{ id: "a", text: "\\(x = \\pm 2\\)", isCorrect: true }, { id: "b", text: "\\(x = 4\\)", isCorrect: false }, { id: "c", text: "\\(x = \\pm 4\\)", isCorrect: false }, { id: "d", text: "\\(x = 12\\)", isCorrect: false }] },
                { id: "alg_quad_i_8", prompt: "Using the quadratic formula, solve: \\(x^2 + 2x - 3 = 0\\)", choices: [{ id: "a", text: "\\(x = 1, -3\\)", isCorrect: true }, { id: "b", text: "\\(x = -1, 3\\)", isCorrect: false }, { id: "c", text: "\\(x = 2, -2\\)", isCorrect: false }, { id: "d", text: "\\(x = 3, -1\\)", isCorrect: false }] },
                { id: "alg_quad_i_9", prompt: "What is the axis of symmetry of \\(y = x^2 - 4x + 3\\)?", choices: [{ id: "a", text: "\\(x = 2\\)", isCorrect: true }, { id: "b", text: "\\(x = -2\\)", isCorrect: false }, { id: "c", text: "\\(x = 4\\)", isCorrect: false }, { id: "d", text: "\\(x = 1\\)", isCorrect: false }] },
                { id: "alg_quad_i_10", prompt: "Solve: \\(x^2 - 1 = 0\\)", choices: [{ id: "a", text: "\\(x = \\pm 1\\)", isCorrect: true }, { id: "b", text: "\\(x = 1\\)", isCorrect: false }, { id: "c", text: "\\(x = 0\\)", isCorrect: false }, { id: "d", text: "No solution", isCorrect: false }] },
                { id: "alg_quad_i_11", prompt: "Solve: \\(x^2 + 3x + 2 = 0\\)", choices: [{ id: "a", text: "\\(x = -1, -2\\)", isCorrect: true }, { id: "b", text: "\\(x = 1, 2\\)", isCorrect: false }, { id: "c", text: "\\-3, -2\\", isCorrect: false }, { id: "d", text: "\\(2, 3\\)", isCorrect: false }] },
                { id: "alg_quad_i_12", prompt: "For the quadratic \\(x^2 - 6x + 9\\), the discriminant is:", choices: [{ id: "a", text: "0", isCorrect: true }, { id: "b", text: "1", isCorrect: false }, { id: "c", text: "36", isCorrect: false }, { id: "d", text: "-1", isCorrect: false }] },
                { id: "alg_quad_i_13", prompt: "Solve: \\(4x^2 - 25 = 0\\)", choices: [{ id: "a", text: "\\(x = \\pm \\frac{5}{2}\\)", isCorrect: true }, { id: "b", text: "2.5", isCorrect: true }, { id: "c", text: "\\(x = \\pm 5\\)", isCorrect: false }, { id: "d", text: "25", isCorrect: false }] },
                { id: "alg_quad_i_14", prompt: "What are the roots of \\(y = (x-1)(x+4)\\)?", choices: [{ id: "a", text: "\\(x = 1, -4\\)", isCorrect: true }, { id: "b", text: "\\(x = -1, 4\\)", isCorrect: false }, { id: "c", text: "\\(x = 1, 4\\)", isCorrect: false }, { id: "d", text: "\\(x = -1, -4\\)", isCorrect: false }] },
                { id: "alg_quad_i_15", prompt: "Solve: \\(x^2 - 10x + 25 = 0\\)", choices: [{ id: "a", text: "\\(x = 5\\)", isCorrect: true }, { id: "b", text: "\\(x = -5\\)", isCorrect: false }, { id: "c", text: "\\(x = \\pm 5\\)", isCorrect: false }, { id: "d", text: "10", isCorrect: false }] }
            ]
        },
        {
            id: "algebra-polynomials-intermediate",
            title: "Algebra: Polynomials & Factoring",
            language: "en",
            category: "math",
            difficulty: "intermediate",
            estimatedMinutes: 18,
            mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 60 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "alg_poly_i_1", prompt: "Factor: \\(x^2 + 5x + 6\\)", choices: [{ id: "a", text: "(x+2)(x+3)", isCorrect: true }, { id: "b", text: "(x+1)(x+6)", isCorrect: false }, { id: "c", text: "(x-2)(x-3)", isCorrect: false }, { id: "d", text: "(x+5)(x+1)", isCorrect: false }] },
                { id: "alg_poly_i_2", prompt: "Expand: \\((x+3)(x-3)\\)", choices: [{ id: "a", text: "\\(x^2 - 9\\)", isCorrect: true }, { id: "b", text: "\\(x^2 + 9\\)", isCorrect: false }, { id: "c", text: "\\(x^2 + 6x - 9\\)", isCorrect: false }, { id: "d", text: "\\(x^2 - 6x + 9\\)", isCorrect: false }] },
                { id: "alg_poly_i_3", prompt: "Factor: \\(2x^2 + 5x + 3\\)", choices: [{ id: "a", text: "(2x+3)(x+1)", isCorrect: true }, { id: "b", text: "(2x+1)(x+3)", isCorrect: false }, { id: "c", text: "(x+3)(x+1)", isCorrect: false }, { id: "d", text: "(2x+5)(x+3)", isCorrect: false }] },
                { id: "alg_poly_i_4", prompt: "Expand: \\((x+4)^2\\)", choices: [{ id: "a", text: "\\(x^2 + 8x + 16\\)", isCorrect: true }, { id: "b", text: "\\(x^2 + 16\\)", isCorrect: false }, { id: "c", text: "\\(x^2 + 4x + 16\\)", isCorrect: false }, { id: "d", text: "\\(x^2 + 4\\)", isCorrect: false }] },
                { id: "alg_poly_i_5", prompt: "Factor: \\(x^3 - x\\)", choices: [{ id: "a", text: "\\(x(x-1)(x+1)\\)", isCorrect: true }, { id: "b", text: "\\((x-1)(x+1)\\)", isCorrect: false }, { id: "c", text: "\\(x(x-1)\\)", isCorrect: false }, { id: "d", text: "\\(x^2(x-1)\\)", isCorrect: false }] },
                { id: "alg_poly_i_6", prompt: "Simplify: \\(3(x-2) + 4(x+1)\\)", choices: [{ id: "a", text: "\\(7x - 2\\)", isCorrect: true }, { id: "b", text: "\\(7x - 5\\)", isCorrect: false }, { id: "c", text: "\\(7x + 2\\)", isCorrect: false }, { id: "d", text: "\\(x - 2\\)", isCorrect: false }] },
                { id: "alg_poly_i_7", prompt: "Factor: \\(x^2 - 4x + 4\\)", choices: [{ id: "a", text: "\\((x-2)^2\\)", isCorrect: true }, { id: "b", text: "\\((x+2)^2\\)", isCorrect: false }, { id: "c", text: "\\((x-4)(x-1)\\)", isCorrect: false }, { id: "d", text: "\\((x-2)(x+2)\\)", isCorrect: false }] },
                { id: "alg_poly_i_8", prompt: "Expand: \\((a+b)^2\\)", choices: [{ id: "a", text: "\\(a^2 + 2ab + b^2\\)", isCorrect: true }, { id: "b", text: "\\(a^2 + b^2\\)", isCorrect: false }, { id: "c", text: "\\(a^2 + ab + b^2\\)", isCorrect: false }, { id: "d", text: "\\(a + 2b\\)", isCorrect: false }] },
                { id: "alg_poly_i_9", prompt: "Factor: \\(x^2 - 16\\)", choices: [{ id: "a", text: "(x-4)(x+4)", isCorrect: true }, { id: "b", text: "\\((x-4)^2\\)", isCorrect: false }, { id: "c", text: "(x-8)(x+8)", isCorrect: false }, { id: "d", text: "\\((x-16)^2\\)", isCorrect: false }] },
                { id: "alg_poly_i_10", prompt: "What is the degree of the polynomial \\(3x^4 - 2x^2 + x - 5\\)?", choices: [{ id: "a", text: "4", isCorrect: true }, { id: "b", text: "3", isCorrect: false }, { id: "c", text: "2", isCorrect: false }, { id: "d", text: "5", isCorrect: false }] },
                { id: "alg_poly_i_11", prompt: "Simplify: \\((2x - 3)(x + 4)\\)", choices: [{ id: "a", text: "\\(2x^2 + 5x - 12\\)", isCorrect: true }, { id: "b", text: "\\(2x^2 + 5x + 12\\)", isCorrect: false }, { id: "c", text: "\\(2x^2 - 5x - 12\\)", isCorrect: false }, { id: "d", text: "\\(x^2 + x - 12\\)", isCorrect: false }] },
                { id: "alg_poly_i_12", prompt: "Factor completely: \\(x^3 + 3x^2 + 2x\\)", choices: [{ id: "a", text: "\\(x(x+1)(x+2)\\)", isCorrect: true }, { id: "b", text: "\\(x(x+3)(x+2)\\)", isCorrect: false }, { id: "c", text: "\\((x)(x^2 + 3x + 2)\\)", isCorrect: false }, { id: "d", text: "\\(x(x+1)^2\\)", isCorrect: false }] }
            ]
        },
        {
            id: "physics-mechanics-intermediate",
            title: "Physics: Classical Mechanics",
            language: "en",
            category: "math",
            difficulty: "intermediate",
            estimatedMinutes: 20,
            mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 60 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                {
                    id: "phys_mech_1",
                    prompt: "What is the kinetic energy \\(E_k\\) of an object of mass \\(m\\) moving with velocity \\(v\\)?",
                    choices: [
                        { id: "a", text: "\\(E_k = \\frac{1}{2}mv^2\\)", isCorrect: true },
                        { id: "b", text: "\\(E_k = mv\\)", isCorrect: false },
                        { id: "c", text: "\\(E_k = mgh\\)", isCorrect: false },
                        { id: "d", text: "\\(E_k = \\frac{1}{2}mv\\)", isCorrect: false }
                    ]
                },
                {
                    id: "phys_mech_2",
                    prompt: "According to Newton's Second Law, force \\(F\\) is equal to:",
                    choices: [
                        { id: "a", text: "\\(F = ma\\) (mass × acceleration)", isCorrect: true },
                        { id: "b", text: "\\(F = mv\\) (mass × velocity)", isCorrect: false },
                        { id: "c", text: "\\(F = \\frac{m}{a}\\)", isCorrect: false },
                        { id: "d", text: "\\(F = mgh\\)", isCorrect: false }
                    ]
                },
                {
                    id: "phys_mech_3",
                    prompt: "What is the gravitational potential energy \\(E_p\\) of an object near Earth's surface?",
                    choices: [
                        { id: "a", text: "\\(E_p = mgh\\)", isCorrect: true },
                        { id: "b", text: "\\(E_p = \\frac{1}{2}mv^2\\)", isCorrect: false },
                        { id: "c", text: "\\(E_p = Fd\\)", isCorrect: false },
                        { id: "d", text: "\\(E_p = mg\\)", isCorrect: false }
                    ]
                },
                {
                    id: "phys_mech_4",
                    prompt: "Which of the following describes the escape velocity \\(v_e\\) from a spherical planet of mass \\(M\\) and radius \\(R\\)?",
                    choices: [
                        { id: "a", text: "\\(v_e = \\sqrt{\\frac{2GM}{R}}\\)", isCorrect: true },
                        { id: "b", text: "\\(v_e = \\sqrt{\\frac{GM}{R}}\\)", isCorrect: false },
                        { id: "c", text: "\\(v_e = \\frac{2GM}{R}\\)", isCorrect: false },
                        { id: "d", text: "\\(v_e = \\sqrt{2gR}\\)", isCorrect: true }
                    ]
                }
            ]
        },
        {
            id: "combinatorics-counting-beginner",
            title: "Combinatorics: Counting Principles",
            language: "en",
            category: "math",
            difficulty: "beginner",
            estimatedMinutes: 16,
            mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 45 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "comb_cnt_b_1", prompt: "A restaurant offers 3 appetizers and 4 main courses. How many different appetizer/main course combinations are there?", choices: [{ id: "a", text: "12", isCorrect: true }, { id: "b", text: "7", isCorrect: false }, { id: "c", text: "24", isCorrect: false }, { id: "d", text: "4", isCorrect: false }] },
                { id: "comb_cnt_b_2", prompt: "How many ways can you choose 1 item from a menu with 5 items?", choices: [{ id: "a", text: "5", isCorrect: true }, { id: "b", text: "1", isCorrect: false }, { id: "c", text: "10", isCorrect: false }, { id: "d", text: "25", isCorrect: false }] },
                { id: "comb_cnt_b_3", prompt: "A coin is flipped 2 times. How many possible outcomes are there?", choices: [{ id: "a", text: "4", isCorrect: true }, { id: "b", text: "2", isCorrect: false }, { id: "c", text: "6", isCorrect: false }, { id: "d", text: "8", isCorrect: false }] },
                { id: "comb_cnt_b_4", prompt: "How many 2-digit numbers can be formed using the digits 1, 2, 3 (digits can repeat)?", choices: [{ id: "a", text: "9", isCorrect: true }, { id: "b", text: "6", isCorrect: false }, { id: "c", text: "3", isCorrect: false }, { id: "d", text: "12", isCorrect: false }] },
                { id: "comb_cnt_b_5", prompt: "A student must choose 2 different classes from a list of 4 classes. How many ways can this be done?", choices: [{ id: "a", text: "6", isCorrect: true }, { id: "b", text: "8", isCorrect: false }, { id: "c", text: "12", isCorrect: false }, { id: "d", text: "4", isCorrect: false }] },
                { id: "comb_cnt_b_6", prompt: "How many ways can 3 different books be arranged on a shelf?", choices: [{ id: "a", text: "6", isCorrect: true }, { id: "b", text: "3", isCorrect: false }, { id: "c", text: "9", isCorrect: false }, { id: "d", text: "27", isCorrect: false }] },
                { id: "comb_cnt_b_7", prompt: "How many ways can you select 1 card from a standard 52-card deck?", choices: [{ id: "a", text: "52", isCorrect: true }, { id: "b", text: "26", isCorrect: false }, { id: "c", text: "13", isCorrect: false }, { id: "d", text: "4", isCorrect: false }] },
                { id: "comb_cnt_b_8", prompt: "A die is rolled twice. How many possible outcomes are there?", choices: [{ id: "a", text: "36", isCorrect: true }, { id: "b", text: "12", isCorrect: false }, { id: "c", text: "6", isCorrect: false }, { id: "d", text: "72", isCorrect: false }] },
                { id: "comb_cnt_b_9", prompt: "How many different outfits can you make from 3 shirts and 2 pairs of pants?", choices: [{ id: "a", text: "6", isCorrect: true }, { id: "b", text: "5", isCorrect: false }, { id: "c", text: "9", isCorrect: false }, { id: "d", text: "12", isCorrect: false }] },
                { id: "comb_cnt_b_10", prompt: "A password consists of 1 letter followed by 2 digits. How many possible passwords are there?", choices: [{ id: "a", text: "2600", isCorrect: true }, { id: "b", text: "260", isCorrect: false }, { id: "c", text: "26000", isCorrect: false }, { id: "d", text: "676", isCorrect: false }] },
                { id: "comb_cnt_b_11", prompt: "How many ways can you arrange the letters in the word 'CAT'?", choices: [{ id: "a", text: "6", isCorrect: true }, { id: "b", text: "3", isCorrect: false }, { id: "c", text: "9", isCorrect: false }, { id: "d", text: "12", isCorrect: false }] },
                { id: "comb_cnt_b_12", prompt: "A teacher needs to choose 2 students from a group of 5 for a project. How many ways can this be done?", choices: [{ id: "a", text: "10", isCorrect: true }, { id: "b", text: "20", isCorrect: false }, { id: "c", text: "5", isCorrect: false }, { id: "d", text: "15", isCorrect: false }] }
            ]
        },
        {
            id: "combinatorics-permutations-intermediate",
            title: "Combinatorics: Permutations & Combinations",
            language: "en",
            category: "math",
            difficulty: "intermediate",
            estimatedMinutes: 22,
            mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 60 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "comb_perm_i_1", prompt: "How many ways can 5 people stand in a line?", choices: [{ id: "a", text: "120", isCorrect: true }, { id: "b", text: "25", isCorrect: false }, { id: "c", text: "60", isCorrect: false }, { id: "d", text: "10", isCorrect: false }] },
                { id: "comb_perm_i_2", prompt: "A committee of 3 people is to be chosen from a group of 10. How many different committees are possible?", choices: [{ id: "a", text: "120", isCorrect: true }, { id: "b", text: "720", isCorrect: false }, { id: "c", text: "30", isCorrect: false }, { id: "d", text: "1000", isCorrect: false }] },
                { id: "comb_perm_i_3", prompt: "How many distinct ways can the letters in 'BANANA' be arranged?", choices: [{ id: "a", text: "60", isCorrect: true }, { id: "b", text: "720", isCorrect: false }, { id: "c", text: "120", isCorrect: false }, { id: "d", text: "360", isCorrect: false }] },
                { id: "comb_perm_i_4", prompt: "In how many ways can we arrange 4 people in a row?", choices: [{ id: "a", text: "24", isCorrect: true }, { id: "b", text: "16", isCorrect: false }, { id: "c", text: "4", isCorrect: false }, { id: "d", text: "12", isCorrect: false }] },
                { id: "comb_perm_i_5", prompt: "How many ways can 4 distinct books be arranged on a shelf?", choices: [{ id: "a", text: "24", isCorrect: true }, { id: "b", text: "4", isCorrect: false }, { id: "c", text: "12", isCorrect: false }, { id: "d", text: "16", isCorrect: false }] },
                { id: "comb_perm_i_6", prompt: "How many permutations are there of the letters in 'BOOK'?", choices: [{ id: "a", text: "12", isCorrect: true }, { id: "b", text: "24", isCorrect: false }, { id: "c", text: "4", isCorrect: false }, { id: "d", text: "6", isCorrect: false }] },
                { id: "comb_perm_i_7", prompt: "A room has 6 doors. In how many ways can you enter through one door and exit through a different door?", choices: [{ id: "a", text: "30", isCorrect: true }, { id: "b", text: "36", isCorrect: false }, { id: "c", text: "6", isCorrect: false }, { id: "d", text: "12", isCorrect: false }] },
                { id: "comb_perm_i_8", prompt: "How many ways can we choose 2 items from 8 items? (Order matters)", choices: [{ id: "a", text: "56", isCorrect: true }, { id: "b", text: "28", isCorrect: false }, { id: "c", text: "8", isCorrect: false }, { id: "d", text: "4", isCorrect: false }] },
                { id: "comb_perm_i_9", prompt: "How many ways can we select and arrange 3 people from a group of 7?", choices: [{ id: "a", text: "210", isCorrect: true }, { id: "b", text: "35", isCorrect: false }, { id: "c", text: "343", isCorrect: false }, { id: "d", text: "21", isCorrect: false }] },
                { id: "comb_perm_i_10", prompt: "How many ways can 5 different colored balls be distributed into 5 different boxes (one ball per box)?", choices: [{ id: "a", text: "120", isCorrect: true }, { id: "b", text: "25", isCorrect: false }, { id: "c", text: "60", isCorrect: false }, { id: "d", text: "10", isCorrect: false }] },
                { id: "comb_perm_i_11", prompt: "From a deck of 52 cards, how many ways can you choose 5 cards if the order matters?", choices: [{ id: "a", text: "311875200", isCorrect: true }, { id: "b", text: "2598960", isCorrect: false }, { id: "c", text: "52", isCorrect: false }, { id: "d", text: "260", isCorrect: false }] },
                { id: "comb_perm_i_12", prompt: "How many distinct arrangements are there of the word 'LETTER'?", choices: [{ id: "a", text: "180", isCorrect: true }, { id: "b", text: "720", isCorrect: false }, { id: "c", text: "360", isCorrect: false }, { id: "d", text: "120", isCorrect: false }] },
                { id: "comb_perm_i_13", prompt: "How many ways can you arrange 2 identical red balls and 3 identical blue balls in a row?", choices: [{ id: "a", text: "10", isCorrect: true }, { id: "b", text: "120", isCorrect: false }, { id: "c", text: "30", isCorrect: false }, { id: "d", text: "5", isCorrect: false }] },
                { id: "comb_perm_i_14", prompt: "You have 4 math books and 5 history books. How many ways can you arrange them if books of the same subject must be together?", choices: [{ id: "a", text: "5760", isCorrect: true }, { id: "b", text: "362880", isCorrect: false }, { id: "c", text: "20", isCorrect: false }, { id: "d", text: "69120", isCorrect: false }] },
                { id: "comb_perm_i_15", prompt: "How many ways can 3 people be chosen and arranged from a group of 8?", choices: [{ id: "a", text: "336", isCorrect: true }, { id: "b", text: "56", isCorrect: false }, { id: "c", text: "8", isCorrect: false }, { id: "d", text: "512", isCorrect: false }] }
            ]
        },
        {
            id: "combinatorics-binomial-advanced",
            title: "Combinatorics: Binomial Theorem",
            language: "en",
            category: "math",
            difficulty: "advanced",
            estimatedMinutes: 18,
            mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 90 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "comb_bin_a_1", prompt: "What is the coefficient of \\(x^2\\) in the expansion of \\((1+x)^5\\)?", choices: [{ id: "a", text: "10", isCorrect: true }, { id: "b", text: "5", isCorrect: false }, { id: "c", text: "20", isCorrect: false }, { id: "d", text: "1", isCorrect: false }] },
                { id: "comb_bin_a_2", prompt: "What is \\(\\binom{6}{3}\\)?", choices: [{ id: "a", text: "20", isCorrect: true }, { id: "b", text: "15", isCorrect: false }, { id: "c", text: "120", isCorrect: false }, { id: "d", text: "10", isCorrect: false }] },
                { id: "comb_bin_a_3", prompt: "Expand \\((a+b)^3\\) using the binomial theorem.", choices: [{ id: "a", text: "\\(a^3 + 3a^2b + 3ab^2 + b^3\\)", isCorrect: true }, { id: "b", text: "\\(a^3 + 3ab + b^3\\)", isCorrect: false }, { id: "c", text: "\\(a^3 + b^3\\)", isCorrect: false }, { id: "d", text: "\\(3a + 3b\\)", isCorrect: false }] },
                { id: "comb_bin_a_4", prompt: "Find the coefficient of \\(x^3y^2\\) in the expansion of \\((x+y)^5\\)", choices: [{ id: "a", text: "10", isCorrect: true }, { id: "b", text: "5", isCorrect: false }, { id: "c", text: "20", isCorrect: false }, { id: "d", text: "1", isCorrect: false }] },
                { id: "comb_bin_a_5", prompt: "What is \\(\\binom{7}{4}\\)?", choices: [{ id: "a", text: "35", isCorrect: true }, { id: "b", text: "21", isCorrect: false }, { id: "c", text: "28", isCorrect: false }, { id: "d", text: "7", isCorrect: false }] },
                { id: "comb_bin_a_6", prompt: "What is the coefficient of \\(x^4\\) in \\((2+x)^6\\)?", choices: [{ id: "a", text: "240", isCorrect: true }, { id: "b", text: "60", isCorrect: false }, { id: "c", text: "120", isCorrect: false }, { id: "d", text: "720", isCorrect: false }] },
                { id: "comb_bin_a_7", prompt: "How many terms are in the expansion of \\((x+y)^{10}\\)?", choices: [{ id: "a", text: "11", isCorrect: true }, { id: "b", text: "10", isCorrect: false }, { id: "c", text: "45", isCorrect: false }, { id: "d", text: "20", isCorrect: false }] },
                { id: "comb_bin_a_8", prompt: "What is the sum of all coefficients in \\((x+y)^5\\)?", choices: [{ id: "a", text: "32", isCorrect: true }, { id: "b", text: "25", isCorrect: false }, { id: "c", text: "10", isCorrect: false }, { id: "d", text: "120", isCorrect: false }] },
                { id: "comb_bin_a_9", prompt: "Expand \\((1-x)^4\\) using the binomial theorem.", choices: [{ id: "a", text: "\\(1 - 4x + 6x^2 - 4x^3 + x^4\\)", isCorrect: true }, { id: "b", text: "\\(1 - 4x + 4x^2\\)", isCorrect: false }, { id: "c", text: "\\(1 - x^4\\)", isCorrect: false }, { id: "d", text: "\\(1 + 4x + 6x^2 + 4x^3 + x^4\\)", isCorrect: false }] },
                { id: "comb_bin_a_10", prompt: "What is the middle term in the expansion of \\((2a+b)^6\\)?", choices: [{ id: "a", text: "\\(160a^3b^3\\)", isCorrect: true }, { id: "b", text: "\\(64a^3b^3\\)", isCorrect: false }, { id: "c", text: "\\(240a^2b^4\\)", isCorrect: false }, { id: "d", text: "\\(8a^6b\\)", isCorrect: false }] }
            ]
        },
        {
            id: "cs-javascript-beginner",
            title: "JavaScript Fundamentals",
            language: "en",
            category: "cs",
            difficulty: "beginner",
            estimatedMinutes: 20,
            mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 45 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                {
                    id: "cs_js_1",
                    prompt: "What is the value of `typeof null` in JavaScript?",
                    choices: [
                        { id: "a", text: '`"object"`', isCorrect: true },
                        { id: "b", text: '`"null"`', isCorrect: false },
                        { id: "c", text: '`"undefined"`', isCorrect: false },
                        { id: "d", text: '`"function"`', isCorrect: false }
                    ]
                },
                {
                    id: "cs_js_2",
                    prompt: "Which keyword declares a block-scoped variable that cannot be reassigned?",
                    choices: [
                        { id: "a", text: "`const`", isCorrect: true },
                        { id: "b", text: "`let`", isCorrect: false },
                        { id: "c", text: "`var`", isCorrect: false },
                        { id: "d", text: "`static`", isCorrect: false }
                    ]
                },
                {
                    id: "cs_js_3",
                    prompt: "What is the result of `\"5\" + 2` in JavaScript?",
                    choices: [
                        { id: "a", text: '`"52"`', isCorrect: true },
                        { id: "b", text: "`7`", isCorrect: false },
                        { id: "c", text: "`NaN`", isCorrect: false },
                        { id: "d", text: "`TypeError`", isCorrect: false }
                    ]
                },
                {
                    id: "cs_js_4",
                    prompt: "Which array method creates a new array with all elements that pass a test?",
                    choices: [
                        { id: "a", text: "`.filter()`", isCorrect: true },
                        { id: "b", text: "`.map()`", isCorrect: false },
                        { id: "c", text: "`.forEach()`", isCorrect: false },
                        { id: "d", text: "`.reduce()`", isCorrect: false }
                    ]
                },
                { id: "cs_js_5", prompt: "What does `===` check in JavaScript?", choices: [{ id: "a", text: "Value AND type", isCorrect: true }, { id: "b", text: "Only value", isCorrect: false }, { id: "c", text: "Reference equality", isCorrect: false }, { id: "d", text: "Truthiness", isCorrect: false }] },
                { id: "cs_js_6", prompt: "Which method converts a JSON string into a JavaScript object?", choices: [{ id: "a", text: "`JSON.parse()`", isCorrect: true }, { id: "b", text: "`JSON.stringify()`", isCorrect: false }, { id: "c", text: "`JSON.decode()`", isCorrect: false }, { id: "d", text: "`Object.parse()`", isCorrect: false }] },
                { id: "cs_js_7", prompt: "What is a closure in JavaScript?", choices: [{ id: "a", text: "A function that retains access to its outer scope after the outer function returns", isCorrect: true }, { id: "b", text: "A way to close the browser window", isCorrect: false }, { id: "c", text: "A syntax for defining classes", isCorrect: false }, { id: "d", text: "A loop that runs indefinitely", isCorrect: false }] },
                { id: "cs_js_8", prompt: "What is the output of `Boolean(0)`?", choices: [{ id: "a", text: "`false`", isCorrect: true }, { id: "b", text: "`true`", isCorrect: false }, { id: "c", text: "`0`", isCorrect: false }, { id: "d", text: "`undefined`", isCorrect: false }] },
                { id: "cs_js_9", prompt: "Which of the following is NOT a JavaScript primitive type?", choices: [{ id: "a", text: "Object", isCorrect: true }, { id: "b", text: "String", isCorrect: false }, { id: "c", text: "Boolean", isCorrect: false }, { id: "d", text: "Symbol", isCorrect: false }] },
                { id: "cs_js_10", prompt: "What does the spread operator `...` do when used in a function call?", choices: [{ id: "a", text: "Expands an iterable into individual arguments", isCorrect: true }, { id: "b", text: "Combines multiple arrays", isCorrect: false }, { id: "c", text: "Declares a rest parameter", isCorrect: false }, { id: "d", text: "Creates a shallow copy of an object", isCorrect: false }] }
            ]
        },
        {
            id: "cs-algorithms-intermediate",
            title: "Data Structures & Algorithms",
            language: "en",
            category: "cs",
            difficulty: "intermediate",
            estimatedMinutes: 15,
            mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 60 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                {
                    id: "cs_algo_1",
                    prompt: "What is the average time complexity of searching in a Balanced Binary Search Tree?",
                    choices: [
                        { id: "a", text: "\\(O(\\log n)\\)", isCorrect: true },
                        { id: "b", text: "\\(O(n)\\)", isCorrect: false },
                        { id: "c", text: "\\(O(1)\\)", isCorrect: false },
                        { id: "d", text: "\\(O(n \\log n)\\)", isCorrect: false }
                    ]
                },
                {
                    id: "cs_algo_2",
                    prompt: "Which sorting algorithm has a worst-case time complexity of \\(O(n^2)\\) but is efficient for small datasets?",
                    choices: [
                        { id: "a", text: "Insertion Sort", isCorrect: true },
                        { id: "b", text: "Merge Sort", isCorrect: false },
                        { id: "c", text: "Heap Sort", isCorrect: false },
                        { id: "d", text: "Radix Sort", isCorrect: false }
                    ]
                },
                {
                    id: "cs_algo_3",
                    prompt: "Which abstract data type operates on a LIFO (Last-In, First-Out) basis?",
                    choices: [
                        { id: "a", text: "Stack", isCorrect: true },
                        { id: "b", text: "Queue", isCorrect: false },
                        { id: "c", text: "Min-Heap", isCorrect: false },
                        { id: "d", text: "Linked List", isCorrect: false }
                    ]
                },
                { id: "cs_algo_4", prompt: "What data structure uses FIFO (First-In, First-Out) ordering?", choices: [{ id: "a", text: "Queue", isCorrect: true }, { id: "b", text: "Stack", isCorrect: false }, { id: "c", text: "Tree", isCorrect: false }, { id: "d", text: "Graph", isCorrect: false }] },
                { id: "cs_algo_5", prompt: "What is the time complexity of accessing an element in an array by index?", choices: [{ id: "a", text: "\\(O(1)\\)", isCorrect: true }, { id: "b", text: "\\(O(n)\\)", isCorrect: false }, { id: "c", text: "\\(O(\\log n)\\)", isCorrect: false }, { id: "d", text: "\\(O(n^2)\\)", isCorrect: false }] },
                { id: "cs_algo_6", prompt: "Which algorithm traverses every vertex of a graph level-by-level from a source?", choices: [{ id: "a", text: "Breadth-First Search (BFS)", isCorrect: true }, { id: "b", text: "Depth-First Search (DFS)", isCorrect: false }, { id: "c", text: "Dijkstra's Algorithm", isCorrect: false }, { id: "d", text: "Merge Sort", isCorrect: false }] },
                { id: "cs_algo_7", prompt: "What is the best-case time complexity of Bubble Sort?", choices: [{ id: "a", text: "\\(O(n)\\)", isCorrect: true }, { id: "b", text: "\\(O(n^2)\\)", isCorrect: false }, { id: "c", text: "\\(O(\\log n)\\)", isCorrect: false }, { id: "d", text: "\\(O(1)\\)", isCorrect: false }] },
                { id: "cs_algo_8", prompt: "In a max-heap, where is the largest element always located?", choices: [{ id: "a", text: "The root", isCorrect: true }, { id: "b", text: "The last leaf", isCorrect: false }, { id: "c", text: "The middle node", isCorrect: false }, { id: "d", text: "A random position", isCorrect: false }] },
                { id: "cs_algo_9", prompt: "Which of the following sorting algorithms has \\(O(n \\log n)\\) time complexity in all cases?", choices: [{ id: "a", text: "Merge Sort", isCorrect: true }, { id: "b", text: "Quick Sort", isCorrect: false }, { id: "c", text: "Bubble Sort", isCorrect: false }, { id: "d", text: "Insertion Sort", isCorrect: false }] },
                { id: "cs_algo_10", prompt: "What does a hash table use to map keys to values?", choices: [{ id: "a", text: "A hash function", isCorrect: true }, { id: "b", text: "A binary tree", isCorrect: false }, { id: "c", text: "A sorted array", isCorrect: false }, { id: "d", text: "A doubly linked list", isCorrect: false }] }
            ]
        },
        {
            id: "lang-english-grammar-intermediate",
            title: "English: Advanced Idioms & Grammar",
            language: "en",
            category: "lang",
            difficulty: "intermediate",
            estimatedMinutes: 10,
            mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 30 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                {
                    id: "lang_en_1",
                    prompt: "Complete the sentence: 'If I ___ you, I would have accepted the offer immediately.'",
                    choices: [
                        { id: "a", text: "had been", isCorrect: true },
                        { id: "b", text: "were", isCorrect: false },
                        { id: "c", text: "was", isCorrect: false },
                        { id: "d", text: "would be", isCorrect: false }
                    ]
                },
                {
                    id: "lang_en_2",
                    prompt: "What does the idiom 'bite the bullet' mean?",
                    choices: [
                        { id: "a", text: "To endure a painful situation with courage", isCorrect: true },
                        { id: "b", text: "To speak without thinking", isCorrect: false },
                        { id: "c", text: "To refuse a bad decision", isCorrect: false },
                        { id: "d", text: "To waste resources", isCorrect: false }
                    ]
                },
                {
                    id: "lang_en_3",
                    prompt: "Choose the grammatically correct sentence:",
                    choices: [
                        { id: "a", text: "The team has finished their preparations.", isCorrect: true },
                        { id: "b", text: "Each of the students are required to submit homework.", isCorrect: false },
                        { id: "c", text: "Neither the teacher nor the students was happy.", isCorrect: false },
                        { id: "d", text: "Between you and I, this is controversial.", isCorrect: false }
                    ]
                },
                { id: "lang_en_4", prompt: "What does 'spill the beans' mean?", choices: [{ id: "a", text: "To reveal a secret accidentally", isCorrect: true }, { id: "b", text: "To make a mess", isCorrect: false }, { id: "c", text: "To exaggerate a story", isCorrect: false }, { id: "d", text: "To waste food", isCorrect: false }] },
                { id: "lang_en_5", prompt: "Which sentence uses the subjunctive mood correctly?", choices: [{ id: "a", text: "I suggest that he be present at the meeting.", isCorrect: true }, { id: "b", text: "I suggest that he is present at the meeting.", isCorrect: false }, { id: "c", text: "I suggest that he was present at the meeting.", isCorrect: false }, { id: "d", text: "I suggest that he will be present at the meeting.", isCorrect: false }] },
                { id: "lang_en_6", prompt: "What is the correct plural of 'criterion'?", choices: [{ id: "a", text: "Criteria", isCorrect: true }, { id: "b", text: "Criterions", isCorrect: false }, { id: "c", text: "Criterias", isCorrect: false }, { id: "d", text: "Criterium", isCorrect: false }] },
                { id: "lang_en_7", prompt: "Which word is a synonym for 'ephemeral'?", choices: [{ id: "a", text: "Transient", isCorrect: true }, { id: "b", text: "Permanent", isCorrect: false }, { id: "c", text: "Substantial", isCorrect: false }, { id: "d", text: "Ancient", isCorrect: false }] },
                { id: "lang_en_8", prompt: "Choose the sentence with the correct use of a semicolon:", choices: [{ id: "a", text: "She studied hard; she passed the exam.", isCorrect: true }, { id: "b", text: "She studied; hard and passed.", isCorrect: false }, { id: "c", text: "She studied hard, she; passed.", isCorrect: false }, { id: "d", text: "She; studied hard and passed the exam.", isCorrect: false }] }
            ]
        },
        {
            id: "lt-cs-javascript",
            title: "JavaScript Pagrindai",
            language: "lt",
            category: "cs",
            difficulty: "beginner",
            estimatedMinutes: 10,
            mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 45 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                {
                    id: "lt_js_1",
                    prompt: "Kokia yra reikšmė `typeof []` JavaScript kalboje?",
                    choices: [
                        { id: "a", text: '`"object"`', isCorrect: true },
                        { id: "b", text: '`"array"`', isCorrect: false },
                        { id: "c", text: '`"list"`', isCorrect: false },
                        { id: "d", text: '`"undefined"`', isCorrect: false }
                    ]
                },
                {
                    id: "lt_js_2",
                    prompt: "Kuris raktinis žodis sukuria kintamąjį, kurio reikšmės negalima pakeisti?",
                    choices: [
                        { id: "a", text: "`const`", isCorrect: true },
                        { id: "b", text: "`let`", isCorrect: false },
                        { id: "c", text: "`var`", isCorrect: false },
                        { id: "d", text: "`static`", isCorrect: false }
                    ]
                },
                {
                    id: "lt_js_3",
                    prompt: "Ką grąžina reiškinys `NaN === NaN`?",
                    choices: [
                        { id: "a", text: "`false`", isCorrect: true },
                        { id: "b", text: "`true`", isCorrect: false },
                        { id: "c", text: "`undefined`", isCorrect: false },
                        { id: "d", text: "`TypeError`", isCorrect: false }
                    ]
                },
                {
                    id: "lt_js_4",
                    prompt: "Kuris masyvo metodas prideda elementą į jo pabaigą?",
                    choices: [
                        { id: "a", text: "`.push()`", isCorrect: true },
                        { id: "b", text: "`.pop()`", isCorrect: false },
                        { id: "c", text: "`.shift()`", isCorrect: false },
                        { id: "d", text: "`.unshift()`", isCorrect: false }
                    ]
                },
                { id: "lt_js_5", prompt: "Ką reiškia `===` JavaScript kalboje?", choices: [{ id: "a", text: "Tikrina reikšmę IR tipą", isCorrect: true }, { id: "b", text: "Tikrina tik reikšmę", isCorrect: false }, { id: "c", text: "Priskiria reikšmę", isCorrect: false }, { id: "d", text: "Tikrina tik tipą", isCorrect: false }] },
                { id: "lt_js_6", prompt: "Koks yra `typeof undefined` rezultatas?", choices: [{ id: "a", text: "`\"undefined\"`", isCorrect: true }, { id: "b", text: "`\"null\"`", isCorrect: false }, { id: "c", text: "`\"object\"`", isCorrect: false }, { id: "d", text: "`\"string\"`", isCorrect: false }] },
                { id: "lt_js_7", prompt: "Kuris metodas transformuoja kiekvieną masyvo elementą ir grąžina naują masyvą?", choices: [{ id: "a", text: "`.map()`", isCorrect: true }, { id: "b", text: "`.filter()`", isCorrect: false }, { id: "c", text: "`.forEach()`", isCorrect: false }, { id: "d", text: "`.find()`", isCorrect: false }] },
                { id: "lt_js_8", prompt: "Kas yra uždara sritis (closure) JavaScript?", choices: [{ id: "a", text: "Funkcija, kuri turi prieigą prie išorinės srities kintamųjų net po to, kai išorinė funkcija baigė vykdymą", isCorrect: true }, { id: "b", text: "Funkcija, kuri vykdoma tik vieną kartą", isCorrect: false }, { id: "c", text: "Specialus ciklo tipas", isCorrect: false }, { id: "d", text: "Kintamasis, kurio negalima keisti", isCorrect: false }] },
                { id: "lt_js_9", prompt: "Kokia yra `Boolean(\"\")` reikšmė?", choices: [{ id: "a", text: "`false`", isCorrect: true }, { id: "b", text: "`true`", isCorrect: false }, { id: "c", text: "`undefined`", isCorrect: false }, { id: "d", text: "`0`", isCorrect: false }] },
                { id: "lt_js_10", prompt: "Kuris metodas grąžina naują masyvą, sujungiant du masyvus?", choices: [{ id: "a", text: "`.concat()`", isCorrect: true }, { id: "b", text: "`.join()`", isCorrect: false }, { id: "c", text: "`.push()`", isCorrect: false }, { id: "d", text: "`.merge()`", isCorrect: false }] }
            ]
        },
        {
            id: "lt-math-beginner",
            title: "Tiesinės Lygtys",
            language: "lt",
            category: "math",
            difficulty: "beginner",
            estimatedMinutes: 12,
            mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 45 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                {
                    id: "lt_mat_1",
                    prompt: "Išspręskite lygtį: \\(2x - 6 = 12\\)",
                    choices: [
                        { id: "a", text: "9", isCorrect: true },
                        { id: "b", text: "6", isCorrect: false },
                        { id: "c", text: "3", isCorrect: false },
                        { id: "d", text: "12", isCorrect: false }
                    ]
                },
                {
                    id: "lt_mat_2",
                    prompt: "Išspręskite lygtį: \\(3x + 4 = x + 10\\)",
                    choices: [
                        { id: "a", text: "3", isCorrect: true },
                        { id: "b", text: "2", isCorrect: false },
                        { id: "c", text: "4", isCorrect: false },
                        { id: "d", text: "5", isCorrect: false }
                    ]
                },
                {
                    id: "lt_mat_3",
                    prompt: "Išspręskite lygtį: \\(x/5 = 7\\)",
                    choices: [
                        { id: "a", text: "35", isCorrect: true },
                        { id: "b", text: "12", isCorrect: false },
                        { id: "c", text: "5", isCorrect: false },
                        { id: "d", text: "1.4", isCorrect: false }
                    ]
                },
                {
                    id: "lt_mat_4",
                    prompt: "Kokia yra \\(x\\) reikšmė: \\(12 - 3x = 0\\)",
                    choices: [
                        { id: "a", text: "4", isCorrect: true },
                        { id: "b", text: "3", isCorrect: false },
                        { id: "c", text: "12", isCorrect: false },
                        { id: "d", text: "0", isCorrect: false }
                    ]
                },
                { id: "lt_mat_5", prompt: "Išspręskite lygtį: \\(5x + 10 = 0\\)", choices: [{ id: "a", text: "-2", isCorrect: true }, { id: "b", text: "2", isCorrect: false }, { id: "c", text: "10", isCorrect: false }, { id: "d", text: "-10", isCorrect: false }] },
                { id: "lt_mat_6", prompt: "Raskite \\(x\\): \\(4x - 7 = 13\\)", choices: [{ id: "a", text: "5", isCorrect: true }, { id: "b", text: "4", isCorrect: false }, { id: "c", text: "6", isCorrect: false }, { id: "d", text: "3", isCorrect: false }] },
                { id: "lt_mat_7", prompt: "Išspręskite: \\(2(x + 3) = 14\\)", choices: [{ id: "a", text: "4", isCorrect: true }, { id: "b", text: "8", isCorrect: false }, { id: "c", text: "5", isCorrect: false }, { id: "d", text: "7", isCorrect: false }] },
                { id: "lt_mat_8", prompt: "Raskite \\(x\\): \\(x/3 - 1 = 4\\)", choices: [{ id: "a", text: "15", isCorrect: true }, { id: "b", text: "9", isCorrect: false }, { id: "c", text: "12", isCorrect: false }, { id: "d", text: "3", isCorrect: false }] },
                { id: "lt_mat_9", prompt: "Kokia yra \\(y\\) reikšmė, jei \\(6y = 42\\)?", choices: [{ id: "a", text: "7", isCorrect: true }, { id: "b", text: "6", isCorrect: false }, { id: "c", text: "8", isCorrect: false }, { id: "d", text: "36", isCorrect: false }] },
                { id: "lt_mat_10", prompt: "Išspręskite: \\(3x + 2x = 25\\)", choices: [{ id: "a", text: "5", isCorrect: true }, { id: "b", text: "10", isCorrect: false }, { id: "c", text: "15", isCorrect: false }, { id: "d", text: "3", isCorrect: false }] }
            ]
        },

        // ── MATH: GEOMETRY ───────────────────────────────────────────────────
        {
            id: "math-geometry-beginner",
            title: "Geometry: Shapes & Angles",
            language: "en", category: "math", difficulty: "beginner",
            estimatedMinutes: 14, mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 40 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "geo_1", prompt: "How many degrees are in the interior angles of a triangle?", choices: [{ id: "a", text: "180°", isCorrect: true }, { id: "b", text: "360°", isCorrect: false }, { id: "c", text: "90°", isCorrect: false }, { id: "d", text: "270°", isCorrect: false }] },
                { id: "geo_2", prompt: "What is the area of a circle with radius \\(r\\)?", choices: [{ id: "a", text: "\\(\\pi r^2\\)", isCorrect: true }, { id: "b", text: "\\(2\\pi r\\)", isCorrect: false }, { id: "c", text: "\\(\\pi r\\)", isCorrect: false }, { id: "d", text: "\\(\\frac{\\pi r^2}{2}\\)", isCorrect: false }] },
                { id: "geo_3", prompt: "State the Pythagorean theorem:", choices: [{ id: "a", text: "\\(a^2 + b^2 = c^2\\)", isCorrect: true }, { id: "b", text: "\\(a + b = c\\)", isCorrect: false }, { id: "c", text: "\\(a^2 - b^2 = c\\)", isCorrect: false }, { id: "d", text: "\\(a \\cdot b = c^2\\)", isCorrect: false }] },
                { id: "geo_4", prompt: "How many sides does a hexagon have?", choices: [{ id: "a", text: "6", isCorrect: true }, { id: "b", text: "5", isCorrect: false }, { id: "c", text: "7", isCorrect: false }, { id: "d", text: "8", isCorrect: false }] },
                { id: "geo_5", prompt: "What is the perimeter of a rectangle with length 8 and width 5?", choices: [{ id: "a", text: "26", isCorrect: true }, { id: "b", text: "40", isCorrect: false }, { id: "c", text: "13", isCorrect: false }, { id: "d", text: "20", isCorrect: false }] },
                { id: "geo_6", prompt: "Two parallel lines cut by a transversal form which type of equal angles?", choices: [{ id: "a", text: "Alternate interior angles", isCorrect: true }, { id: "b", text: "Supplementary angles", isCorrect: false }, { id: "c", text: "Complementary angles", isCorrect: false }, { id: "d", text: "Obtuse angles", isCorrect: false }] },
                { id: "geo_7", prompt: "What is the area of a triangle with base 10 and height 6?", choices: [{ id: "a", text: "30", isCorrect: true }, { id: "b", text: "60", isCorrect: false }, { id: "c", text: "16", isCorrect: false }, { id: "d", text: "20", isCorrect: false }] },
                { id: "geo_8", prompt: "How many degrees are in a right angle?", choices: [{ id: "a", text: "90°", isCorrect: true }, { id: "b", text: "180°", isCorrect: false }, { id: "c", text: "45°", isCorrect: false }, { id: "d", text: "60°", isCorrect: false }] },
                { id: "geo_9", prompt: "What is the volume of a cube with side length 3?", choices: [{ id: "a", text: "27", isCorrect: true }, { id: "b", text: "9", isCorrect: false }, { id: "c", text: "18", isCorrect: false }, { id: "d", text: "54", isCorrect: false }] },
                { id: "geo_10", prompt: "An isosceles triangle has how many equal sides?", choices: [{ id: "a", text: "2", isCorrect: true }, { id: "b", text: "3", isCorrect: false }, { id: "c", text: "0", isCorrect: false }, { id: "d", text: "1", isCorrect: false }] }
            ]
        },

        // ── MATH: TRIGONOMETRY ────────────────────────────────────────────────
        {
            id: "math-trigonometry-intermediate",
            title: "Trigonometry Essentials",
            language: "en", category: "math", difficulty: "intermediate",
            estimatedMinutes: 22, mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 60 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "trig_1", prompt: "What is \\(\\sin(30°)\\)?", choices: [{ id: "a", text: "\\(\\frac{1}{2}\\)", isCorrect: true }, { id: "b", text: "\\(\\frac{\\sqrt{3}}{2}\\)", isCorrect: false }, { id: "c", text: "\\(1\\)", isCorrect: false }, { id: "d", text: "\\(\\frac{\\sqrt{2}}{2}\\)", isCorrect: false }] },
                { id: "trig_2", prompt: "What is \\(\\cos(0°)\\)?", choices: [{ id: "a", text: "1", isCorrect: true }, { id: "b", text: "0", isCorrect: false }, { id: "c", text: "-1", isCorrect: false }, { id: "d", text: "\\(\\frac{1}{2}\\)", isCorrect: false }] },
                { id: "trig_3", prompt: "Which identity is correct?", choices: [{ id: "a", text: "\\(\\sin^2\\theta + \\cos^2\\theta = 1\\)", isCorrect: true }, { id: "b", text: "\\(\\sin^2\\theta - \\cos^2\\theta = 1\\)", isCorrect: false }, { id: "c", text: "\\(\\tan^2\\theta + 1 = \\sin^2\\theta\\)", isCorrect: false }, { id: "d", text: "\\(\\sin\\theta = \\cos\\theta\\) always", isCorrect: false }] },
                { id: "trig_4", prompt: "What is \\(\\tan(45°)\\)?", choices: [{ id: "a", text: "1", isCorrect: true }, { id: "b", text: "0", isCorrect: false }, { id: "c", text: "\\(\\sqrt{2}\\)", isCorrect: false }, { id: "d", text: "Undefined", isCorrect: false }] },
                { id: "trig_5", prompt: "What is \\(\\sin(90°)\\)?", choices: [{ id: "a", text: "1", isCorrect: true }, { id: "b", text: "0", isCorrect: false }, { id: "c", text: "\\(\\frac{1}{2}\\)", isCorrect: false }, { id: "d", text: "-1", isCorrect: false }] },
                { id: "trig_6", prompt: "How many radians is 180°?", choices: [{ id: "a", text: "\\(\\pi\\)", isCorrect: true }, { id: "b", text: "\\(2\\pi\\)", isCorrect: false }, { id: "c", text: "\\(\\frac{\\pi}{2}\\)", isCorrect: false }, { id: "d", text: "\\(\\frac{\\pi}{4}\\)", isCorrect: false }] },
                { id: "trig_7", prompt: "What is \\(\\cos(60°)\\)?", choices: [{ id: "a", text: "\\(\\frac{1}{2}\\)", isCorrect: true }, { id: "b", text: "\\(\\frac{\\sqrt{3}}{2}\\)", isCorrect: false }, { id: "c", text: "1", isCorrect: false }, { id: "d", text: "0", isCorrect: false }] },
                { id: "trig_8", prompt: "What is the period of \\(y = \\sin(x)\\)?", choices: [{ id: "a", text: "\\(2\\pi\\)", isCorrect: true }, { id: "b", text: "\\(\\pi\\)", isCorrect: false }, { id: "c", text: "\\(\\frac{\\pi}{2}\\)", isCorrect: false }, { id: "d", text: "1", isCorrect: false }] },
                { id: "trig_9", prompt: "Which ratio defines \\(\\tan(\\theta)\\)?", choices: [{ id: "a", text: "\\(\\frac{\\sin\\theta}{\\cos\\theta}\\)", isCorrect: true }, { id: "b", text: "\\(\\frac{\\cos\\theta}{\\sin\\theta}\\)", isCorrect: false }, { id: "c", text: "\\(\\sin\\theta \\cdot \\cos\\theta\\)", isCorrect: false }, { id: "d", text: "\\(\\frac{1}{\\sin\\theta}\\)", isCorrect: false }] },
                { id: "trig_10", prompt: "What is \\(\\sin(-\\theta)\\)?", choices: [{ id: "a", text: "\\(-\\sin\\theta\\)", isCorrect: true }, { id: "b", text: "\\(\\sin\\theta\\)", isCorrect: false }, { id: "c", text: "\\(\\cos\\theta\\)", isCorrect: false }, { id: "d", text: "\\(-\\cos\\theta\\)", isCorrect: false }] }
            ]
        },

        // ── MATH: CALCULUS ────────────────────────────────────────────────────
        {
            id: "math-calculus-derivatives-advanced",
            title: "Calculus: Derivatives",
            language: "en", category: "math", difficulty: "advanced",
            estimatedMinutes: 25, mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 90 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "calc_d1", prompt: "What is the derivative of \\(f(x) = x^3\\)?", choices: [{ id: "a", text: "\\(3x^2\\)", isCorrect: true }, { id: "b", text: "\\(x^2\\)", isCorrect: false }, { id: "c", text: "\\(3x^3\\)", isCorrect: false }, { id: "d", text: "\\(x^4\\)", isCorrect: false }] },
                { id: "calc_d2", prompt: "What is \\(\\frac{d}{dx}[e^x]\\)?", choices: [{ id: "a", text: "\\(e^x\\)", isCorrect: true }, { id: "b", text: "\\(xe^{x-1}\\)", isCorrect: false }, { id: "c", text: "\\(e\\)", isCorrect: false }, { id: "d", text: "\\(e^{x+1}\\)", isCorrect: false }] },
                { id: "calc_d3", prompt: "What is \\(\\frac{d}{dx}[\\ln x]\\)?", choices: [{ id: "a", text: "\\(\\frac{1}{x}\\)", isCorrect: true }, { id: "b", text: "\\(\\ln x\\)", isCorrect: false }, { id: "c", text: "\\(x\\)", isCorrect: false }, { id: "d", text: "\\(e^x\\)", isCorrect: false }] },
                { id: "calc_d4", prompt: "What is \\(\\frac{d}{dx}[\\sin x]\\)?", choices: [{ id: "a", text: "\\(\\cos x\\)", isCorrect: true }, { id: "b", text: "\\(-\\sin x\\)", isCorrect: false }, { id: "c", text: "\\(-\\cos x\\)", isCorrect: false }, { id: "d", text: "\\(\\tan x\\)", isCorrect: false }] },
                { id: "calc_d5", prompt: "Apply the chain rule: What is \\(\\frac{d}{dx}[\\sin(x^2)]\\)?", choices: [{ id: "a", text: "\\(2x\\cos(x^2)\\)", isCorrect: true }, { id: "b", text: "\\(\\cos(x^2)\\)", isCorrect: false }, { id: "c", text: "\\(2x\\sin(x^2)\\)", isCorrect: false }, { id: "d", text: "\\(-2x\\cos(x^2)\\)", isCorrect: false }] },
                { id: "calc_d6", prompt: "What is the derivative of \\(f(x) = x^5 - 3x^2 + 7\\)?", choices: [{ id: "a", text: "\\(5x^4 - 6x\\)", isCorrect: true }, { id: "b", text: "\\(5x^4 - 3x\\)", isCorrect: false }, { id: "c", text: "\\(x^4 - 6x\\)", isCorrect: false }, { id: "d", text: "\\(5x^4 + 7\\)", isCorrect: false }] },
                { id: "calc_d7", prompt: "What does \\(f'(x) = 0\\) at a point indicate?", choices: [{ id: "a", text: "A critical point (possible max or min)", isCorrect: true }, { id: "b", text: "The function equals zero there", isCorrect: false }, { id: "c", text: "The function is undefined", isCorrect: false }, { id: "d", text: "The function is always increasing", isCorrect: false }] },
                { id: "calc_d8", prompt: "What is \\(\\frac{d}{dx}[\\cos x]\\)?", choices: [{ id: "a", text: "\\(-\\sin x\\)", isCorrect: true }, { id: "b", text: "\\(\\sin x\\)", isCorrect: false }, { id: "c", text: "\\(\\cos x\\)", isCorrect: false }, { id: "d", text: "\\(-\\cos x\\)", isCorrect: false }] },
                { id: "calc_d9", prompt: "Product rule: What is \\(\\frac{d}{dx}[x \\cdot e^x]\\)?", choices: [{ id: "a", text: "\\(e^x + xe^x\\)", isCorrect: true }, { id: "b", text: "\\(xe^x\\)", isCorrect: false }, { id: "c", text: "\\(e^x\\)", isCorrect: false }, { id: "d", text: "\\(x^2 e^x\\)", isCorrect: false }] },
                { id: "calc_d10", prompt: "Power rule: What is \\(\\frac{d}{dx}[x^n]\\)?", choices: [{ id: "a", text: "\\(nx^{n-1}\\)", isCorrect: true }, { id: "b", text: "\\(x^{n-1}\\)", isCorrect: false }, { id: "c", text: "\\(nx^n\\)", isCorrect: false }, { id: "d", text: "\\((n-1)x^n\\)", isCorrect: false }] }
            ]
        },

        // ── MATH: STATISTICS ──────────────────────────────────────────────────
        {
            id: "math-statistics-intermediate",
            title: "Statistics & Probability",
            language: "en", category: "math", difficulty: "intermediate",
            estimatedMinutes: 18, mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 50 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "stat_1", prompt: "What is the mean of {2, 4, 6, 8, 10}?", choices: [{ id: "a", text: "6", isCorrect: true }, { id: "b", text: "5", isCorrect: false }, { id: "c", text: "8", isCorrect: false }, { id: "d", text: "4", isCorrect: false }] },
                { id: "stat_2", prompt: "What is the median of {3, 7, 1, 9, 5}?", choices: [{ id: "a", text: "5", isCorrect: true }, { id: "b", text: "3", isCorrect: false }, { id: "c", text: "7", isCorrect: false }, { id: "d", text: "6", isCorrect: false }] },
                { id: "stat_3", prompt: "What is the mode of {4, 4, 6, 7, 4, 9}?", choices: [{ id: "a", text: "4", isCorrect: true }, { id: "b", text: "6", isCorrect: false }, { id: "c", text: "7", isCorrect: false }, { id: "d", text: "9", isCorrect: false }] },
                { id: "stat_4", prompt: "A fair coin is flipped 3 times. Probability of all heads?", choices: [{ id: "a", text: "\\(\\frac{1}{8}\\)", isCorrect: true }, { id: "b", text: "\\(\\frac{1}{4}\\)", isCorrect: false }, { id: "c", text: "\\(\\frac{1}{2}\\)", isCorrect: false }, { id: "d", text: "\\(\\frac{1}{3}\\)", isCorrect: false }] },
                { id: "stat_5", prompt: "What does standard deviation measure?", choices: [{ id: "a", text: "Spread of data around the mean", isCorrect: true }, { id: "b", text: "The average value of the data", isCorrect: false }, { id: "c", text: "The most common value", isCorrect: false }, { id: "d", text: "The total sum of data", isCorrect: false }] },
                { id: "stat_6", prompt: "P(A) = 0.4, P(B) = 0.3, A and B independent. What is P(A and B)?", choices: [{ id: "a", text: "0.12", isCorrect: true }, { id: "b", text: "0.7", isCorrect: false }, { id: "c", text: "0.1", isCorrect: false }, { id: "d", text: "0.04", isCorrect: false }] },
                { id: "stat_7", prompt: "Which value is the 50th percentile of a dataset?", choices: [{ id: "a", text: "The median", isCorrect: true }, { id: "b", text: "The mean", isCorrect: false }, { id: "c", text: "The mode", isCorrect: false }, { id: "d", text: "The range", isCorrect: false }] },
                { id: "stat_8", prompt: "Rolling a standard 6-sided die — probability of rolling a 4?", choices: [{ id: "a", text: "\\(\\frac{1}{6}\\)", isCorrect: true }, { id: "b", text: "\\(\\frac{1}{4}\\)", isCorrect: false }, { id: "c", text: "\\(\\frac{4}{6}\\)", isCorrect: false }, { id: "d", text: "\\(\\frac{1}{3}\\)", isCorrect: false }] },
                { id: "stat_9", prompt: "What is the variance when all values in a dataset are identical?", choices: [{ id: "a", text: "0", isCorrect: true }, { id: "b", text: "1", isCorrect: false }, { id: "c", text: "The mean", isCorrect: false }, { id: "d", text: "Undefined", isCorrect: false }] },
                { id: "stat_10", prompt: "In a normal distribution, ~what % of data falls within 1 standard deviation?", choices: [{ id: "a", text: "68%", isCorrect: true }, { id: "b", text: "95%", isCorrect: false }, { id: "c", text: "50%", isCorrect: false }, { id: "d", text: "99.7%", isCorrect: false }] }
            ]
        },

        // ── CS: PYTHON ─────────────────────────────────────────────────────────
        {
            id: "cs-python-beginner",
            title: "Python Fundamentals",
            language: "en", category: "cs", difficulty: "beginner",
            estimatedMinutes: 16, mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 45 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "py_1", prompt: "Which keyword is used to define a function in Python?", choices: [{ id: "a", text: "`def`", isCorrect: true }, { id: "b", text: "`function`", isCorrect: false }, { id: "c", text: "`fn`", isCorrect: false }, { id: "d", text: "`define`", isCorrect: false }] },
                { id: "py_2", prompt: "What does `len([1, 2, 3, 4])` return?", choices: [{ id: "a", text: "4", isCorrect: true }, { id: "b", text: "3", isCorrect: false }, { id: "c", text: "10", isCorrect: false }, { id: "d", text: "0", isCorrect: false }] },
                { id: "py_3", prompt: "Which of the following is a mutable data type in Python?", choices: [{ id: "a", text: "List", isCorrect: true }, { id: "b", text: "Tuple", isCorrect: false }, { id: "c", text: "String", isCorrect: false }, { id: "d", text: "Integer", isCorrect: false }] },
                { id: "py_4", prompt: "What is the output of `print(type(3.14))`?", choices: [{ id: "a", text: "`<class 'float'>`", isCorrect: true }, { id: "b", text: "`<class 'int'>`", isCorrect: false }, { id: "c", text: "`<class 'str'>`", isCorrect: false }, { id: "d", text: "`3.14`", isCorrect: false }] },
                { id: "py_5", prompt: "Which symbol is used for single-line comments in Python?", choices: [{ id: "a", text: "`#`", isCorrect: true }, { id: "b", text: "`//`", isCorrect: false }, { id: "c", text: "`--`", isCorrect: false }, { id: "d", text: "`/*`", isCorrect: false }] },
                { id: "py_6", prompt: "What is the result of `'hello'[1]` in Python?", choices: [{ id: "a", text: "`'e'`", isCorrect: true }, { id: "b", text: "`'h'`", isCorrect: false }, { id: "c", text: "`'l'`", isCorrect: false }, { id: "d", text: "`1`", isCorrect: false }] },
                { id: "py_7", prompt: "Which loop iterates over a sequence in Python?", choices: [{ id: "a", text: "`for` loop", isCorrect: true }, { id: "b", text: "`loop` statement", isCorrect: false }, { id: "c", text: "`each` loop", isCorrect: false }, { id: "d", text: "`repeat` loop", isCorrect: false }] },
                { id: "py_8", prompt: "What does `range(5)` produce?", choices: [{ id: "a", text: "Numbers 0 through 4", isCorrect: true }, { id: "b", text: "Numbers 1 through 5", isCorrect: false }, { id: "c", text: "Numbers 0 through 5", isCorrect: false }, { id: "d", text: "5 random numbers", isCorrect: false }] },
                { id: "py_9", prompt: "What keyword handles exceptions in Python?", choices: [{ id: "a", text: "`except`", isCorrect: true }, { id: "b", text: "`catch`", isCorrect: false }, { id: "c", text: "`handle`", isCorrect: false }, { id: "d", text: "`error`", isCorrect: false }] },
                { id: "py_10", prompt: "What does `dict.get('key', 'default')` return if 'key' doesn't exist?", choices: [{ id: "a", text: "`'default'`", isCorrect: true }, { id: "b", text: "`None`", isCorrect: false }, { id: "c", text: "`KeyError`", isCorrect: false }, { id: "d", text: "`False`", isCorrect: false }] }
            ]
        },

        // ── CS: HTML & CSS ─────────────────────────────────────────────────────
        {
            id: "cs-html-css-beginner",
            title: "HTML & CSS Basics",
            language: "en", category: "cs", difficulty: "beginner",
            estimatedMinutes: 14, mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 40 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "html_1", prompt: "Which HTML tag is used for the largest heading?", choices: [{ id: "a", text: "`<h1>`", isCorrect: true }, { id: "b", text: "`<h6>`", isCorrect: false }, { id: "c", text: "`<head>`", isCorrect: false }, { id: "d", text: "`<title>`", isCorrect: false }] },
                { id: "html_2", prompt: "Which CSS property changes the text color?", choices: [{ id: "a", text: "`color`", isCorrect: true }, { id: "b", text: "`font-color`", isCorrect: false }, { id: "c", text: "`text-color`", isCorrect: false }, { id: "d", text: "`background-color`", isCorrect: false }] },
                { id: "html_3", prompt: "What does CSS stand for?", choices: [{ id: "a", text: "Cascading Style Sheets", isCorrect: true }, { id: "b", text: "Creative Style Syntax", isCorrect: false }, { id: "c", text: "Computer Style System", isCorrect: false }, { id: "d", text: "Coded Style Structure", isCorrect: false }] },
                { id: "html_4", prompt: "Which HTML element links an external CSS file?", choices: [{ id: "a", text: "`<link>`", isCorrect: true }, { id: "b", text: "`<style>`", isCorrect: false }, { id: "c", text: "`<css>`", isCorrect: false }, { id: "d", text: "`<script>`", isCorrect: false }] },
                { id: "html_5", prompt: "Which CSS property sets the space outside an element's border?", choices: [{ id: "a", text: "`margin`", isCorrect: true }, { id: "b", text: "`padding`", isCorrect: false }, { id: "c", text: "`border`", isCorrect: false }, { id: "d", text: "`spacing`", isCorrect: false }] },
                { id: "html_6", prompt: "What does the `<a href>` tag create?", choices: [{ id: "a", text: "A hyperlink", isCorrect: true }, { id: "b", text: "An image", isCorrect: false }, { id: "c", text: "A button", isCorrect: false }, { id: "d", text: "A table", isCorrect: false }] },
                { id: "html_7", prompt: "Which CSS property makes a container use flexbox layout?", choices: [{ id: "a", text: "`display: flex`", isCorrect: true }, { id: "b", text: "`display: block`", isCorrect: false }, { id: "c", text: "`layout: flex`", isCorrect: false }, { id: "d", text: "`position: flex`", isCorrect: false }] },
                { id: "html_8", prompt: "What HTML attribute specifies an image URL?", choices: [{ id: "a", text: "`src`", isCorrect: true }, { id: "b", text: "`href`", isCorrect: false }, { id: "c", text: "`url`", isCorrect: false }, { id: "d", text: "`link`", isCorrect: false }] },
                { id: "html_9", prompt: "Which CSS selector targets elements with a specific class?", choices: [{ id: "a", text: "`.classname`", isCorrect: true }, { id: "b", text: "`#classname`", isCorrect: false }, { id: "c", text: "`@classname`", isCorrect: false }, { id: "d", text: "`*classname`", isCorrect: false }] },
                { id: "html_10", prompt: "Which tag creates an unordered (bulleted) list?", choices: [{ id: "a", text: "`<ul>`", isCorrect: true }, { id: "b", text: "`<ol>`", isCorrect: false }, { id: "c", text: "`<li>`", isCorrect: false }, { id: "d", text: "`<list>`", isCorrect: false }] }
            ]
        },

        // ── CS: SQL ───────────────────────────────────────────────────────────
        {
            id: "cs-sql-beginner",
            title: "SQL Fundamentals",
            language: "en", category: "cs", difficulty: "beginner",
            estimatedMinutes: 15, mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 45 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "sql_1", prompt: "Which SQL statement retrieves data from a database?", choices: [{ id: "a", text: "`SELECT`", isCorrect: true }, { id: "b", text: "`GET`", isCorrect: false }, { id: "c", text: "`FETCH`", isCorrect: false }, { id: "d", text: "`READ`", isCorrect: false }] },
                { id: "sql_2", prompt: "Which clause filters results in a SELECT query?", choices: [{ id: "a", text: "`WHERE`", isCorrect: true }, { id: "b", text: "`FILTER`", isCorrect: false }, { id: "c", text: "`HAVING`", isCorrect: false }, { id: "d", text: "`LIMIT`", isCorrect: false }] },
                { id: "sql_3", prompt: "Which SQL command adds a new row to a table?", choices: [{ id: "a", text: "`INSERT INTO`", isCorrect: true }, { id: "b", text: "`ADD ROW`", isCorrect: false }, { id: "c", text: "`CREATE ROW`", isCorrect: false }, { id: "d", text: "`PUSH`", isCorrect: false }] },
                { id: "sql_4", prompt: "What does `SELECT * FROM users` return?", choices: [{ id: "a", text: "All columns and rows from the users table", isCorrect: true }, { id: "b", text: "Only the first row", isCorrect: false }, { id: "c", text: "The column names only", isCorrect: false }, { id: "d", text: "The count of rows", isCorrect: false }] },
                { id: "sql_5", prompt: "Which SQL statement removes rows from a table?", choices: [{ id: "a", text: "`DELETE`", isCorrect: true }, { id: "b", text: "`REMOVE`", isCorrect: false }, { id: "c", text: "`DROP`", isCorrect: false }, { id: "d", text: "`ERASE`", isCorrect: false }] },
                { id: "sql_6", prompt: "Which aggregate function counts the number of rows?", choices: [{ id: "a", text: "`COUNT()`", isCorrect: true }, { id: "b", text: "`SUM()`", isCorrect: false }, { id: "c", text: "`TOTAL()`", isCorrect: false }, { id: "d", text: "`NUM()`", isCorrect: false }] },
                { id: "sql_7", prompt: "What does `ORDER BY name DESC` do?", choices: [{ id: "a", text: "Sorts by name Z to A (descending)", isCorrect: true }, { id: "b", text: "Sorts by name A to Z (ascending)", isCorrect: false }, { id: "c", text: "Deletes sorted rows", isCorrect: false }, { id: "d", text: "Groups results by name", isCorrect: false }] },
                { id: "sql_8", prompt: "Which JOIN returns only rows matching in BOTH tables?", choices: [{ id: "a", text: "`INNER JOIN`", isCorrect: true }, { id: "b", text: "`LEFT JOIN`", isCorrect: false }, { id: "c", text: "`FULL OUTER JOIN`", isCorrect: false }, { id: "d", text: "`CROSS JOIN`", isCorrect: false }] },
                { id: "sql_9", prompt: "Which SQL command modifies existing data in a table?", choices: [{ id: "a", text: "`UPDATE`", isCorrect: true }, { id: "b", text: "`MODIFY`", isCorrect: false }, { id: "c", text: "`CHANGE`", isCorrect: false }, { id: "d", text: "`ALTER`", isCorrect: false }] },
                { id: "sql_10", prompt: "What does `GROUP BY` do in SQL?", choices: [{ id: "a", text: "Groups rows with the same value into summary rows", isCorrect: true }, { id: "b", text: "Sorts the data alphabetically", isCorrect: false }, { id: "c", text: "Joins two tables", isCorrect: false }, { id: "d", text: "Filters duplicate rows", isCorrect: false }] }
            ]
        },

        // ── CS: OOP CONCEPTS ──────────────────────────────────────────────────
        {
            id: "cs-oop-intermediate",
            title: "OOP Concepts",
            language: "en", category: "cs", difficulty: "intermediate",
            estimatedMinutes: 18, mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 55 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "oop_1", prompt: "Which OOP principle hides internal data and only exposes necessary methods?", choices: [{ id: "a", text: "Encapsulation", isCorrect: true }, { id: "b", text: "Polymorphism", isCorrect: false }, { id: "c", text: "Inheritance", isCorrect: false }, { id: "d", text: "Abstraction", isCorrect: false }] },
                { id: "oop_2", prompt: "What allows one class to derive properties from another?", choices: [{ id: "a", text: "Inheritance", isCorrect: true }, { id: "b", text: "Encapsulation", isCorrect: false }, { id: "c", text: "Abstraction", isCorrect: false }, { id: "d", text: "Composition", isCorrect: false }] },
                { id: "oop_3", prompt: "What is polymorphism?", choices: [{ id: "a", text: "Different classes treated as instances of the same class through a shared interface", isCorrect: true }, { id: "b", text: "Hiding data from other classes", isCorrect: false }, { id: "c", text: "Creating multiple instances of the same class", isCorrect: false }, { id: "d", text: "Grouping related classes together", isCorrect: false }] },
                { id: "oop_4", prompt: "What is an abstract class?", choices: [{ id: "a", text: "A class that cannot be instantiated and may contain abstract methods", isCorrect: true }, { id: "b", text: "A class with no methods", isCorrect: false }, { id: "c", text: "A class that inherits from all other classes", isCorrect: false }, { id: "d", text: "A class with only private fields", isCorrect: false }] },
                { id: "oop_5", prompt: "What is a constructor?", choices: [{ id: "a", text: "A special method that initializes a new object", isCorrect: true }, { id: "b", text: "A method that deletes an object", isCorrect: false }, { id: "c", text: "A type of loop inside a class", isCorrect: false }, { id: "d", text: "A method that returns a string", isCorrect: false }] },
                { id: "oop_6", prompt: "What does 'overriding' mean in OOP?", choices: [{ id: "a", text: "A subclass provides a new implementation of a parent's method", isCorrect: true }, { id: "b", text: "Same method name, different params in same class", isCorrect: false }, { id: "c", text: "Calling a superclass method", isCorrect: false }, { id: "d", text: "Creating a class inside another class", isCorrect: false }] },
                { id: "oop_7", prompt: "Key difference between interface and abstract class?", choices: [{ id: "a", text: "Interface only defines signatures; abstract class can have implementations", isCorrect: true }, { id: "b", text: "Interface can have fields; abstract class cannot", isCorrect: false }, { id: "c", text: "They are functionally identical", isCorrect: false }, { id: "d", text: "Abstract class can only be used once", isCorrect: false }] },
                { id: "oop_8", prompt: "What is method overloading?", choices: [{ id: "a", text: "Multiple methods with the same name but different parameters", isCorrect: true }, { id: "b", text: "Replacing a method from a parent class", isCorrect: false }, { id: "c", text: "Running two methods simultaneously", isCorrect: false }, { id: "d", text: "Calling a private method externally", isCorrect: false }] },
                { id: "oop_9", prompt: "Which keyword refers to the current class instance in most OOP languages?", choices: [{ id: "a", text: "`this` (or `self` in Python)", isCorrect: true }, { id: "b", text: "`current`", isCorrect: false }, { id: "c", text: "`instance`", isCorrect: false }, { id: "d", text: "`base`", isCorrect: false }] },
                { id: "oop_10", prompt: "Which SOLID principle says a class should have only one reason to change?", choices: [{ id: "a", text: "Single Responsibility Principle", isCorrect: true }, { id: "b", text: "Open/Closed Principle", isCorrect: false }, { id: "c", text: "Liskov Substitution Principle", isCorrect: false }, { id: "d", text: "Dependency Inversion Principle", isCorrect: false }] }
            ]
        },

        // ── LANG: WORLD GEOGRAPHY ─────────────────────────────────────────────
        {
            id: "lang-geography-beginner",
            title: "World Geography",
            language: "en", category: "lang", difficulty: "beginner",
            estimatedMinutes: 12, mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 35 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "geo_w1", prompt: "What is the capital of France?", choices: [{ id: "a", text: "Paris", isCorrect: true }, { id: "b", text: "Lyon", isCorrect: false }, { id: "c", text: "Berlin", isCorrect: false }, { id: "d", text: "Madrid", isCorrect: false }] },
                { id: "geo_w2", prompt: "Which is the largest ocean on Earth?", choices: [{ id: "a", text: "Pacific Ocean", isCorrect: true }, { id: "b", text: "Atlantic Ocean", isCorrect: false }, { id: "c", text: "Indian Ocean", isCorrect: false }, { id: "d", text: "Arctic Ocean", isCorrect: false }] },
                { id: "geo_w3", prompt: "On which continent is Brazil located?", choices: [{ id: "a", text: "South America", isCorrect: true }, { id: "b", text: "Africa", isCorrect: false }, { id: "c", text: "Asia", isCorrect: false }, { id: "d", text: "North America", isCorrect: false }] },
                { id: "geo_w4", prompt: "What is the longest river in the world?", choices: [{ id: "a", text: "The Nile", isCorrect: true }, { id: "b", text: "The Amazon", isCorrect: false }, { id: "c", text: "The Yangtze", isCorrect: false }, { id: "d", text: "The Mississippi", isCorrect: false }] },
                { id: "geo_w5", prompt: "How many countries are in the European Union (2024)?", choices: [{ id: "a", text: "27", isCorrect: true }, { id: "b", text: "28", isCorrect: false }, { id: "c", text: "25", isCorrect: false }, { id: "d", text: "30", isCorrect: false }] },
                { id: "geo_w6", prompt: "What is the capital of Japan?", choices: [{ id: "a", text: "Tokyo", isCorrect: true }, { id: "b", text: "Osaka", isCorrect: false }, { id: "c", text: "Kyoto", isCorrect: false }, { id: "d", text: "Hiroshima", isCorrect: false }] },
                { id: "geo_w7", prompt: "Which country has the most land area?", choices: [{ id: "a", text: "Russia", isCorrect: true }, { id: "b", text: "Canada", isCorrect: false }, { id: "c", text: "United States", isCorrect: false }, { id: "d", text: "China", isCorrect: false }] },
                { id: "geo_w8", prompt: "Which mountain is the tallest in the world?", choices: [{ id: "a", text: "Mount Everest", isCorrect: true }, { id: "b", text: "K2", isCorrect: false }, { id: "c", text: "Mont Blanc", isCorrect: false }, { id: "d", text: "Kilimanjaro", isCorrect: false }] },
                { id: "geo_w9", prompt: "What is the smallest country in the world by area?", choices: [{ id: "a", text: "Vatican City", isCorrect: true }, { id: "b", text: "Monaco", isCorrect: false }, { id: "c", text: "San Marino", isCorrect: false }, { id: "d", text: "Liechtenstein", isCorrect: false }] },
                { id: "geo_w10", prompt: "Which city is known as 'The Eternal City'?", choices: [{ id: "a", text: "Rome", isCorrect: true }, { id: "b", text: "Athens", isCorrect: false }, { id: "c", text: "Istanbul", isCorrect: false }, { id: "d", text: "Cairo", isCorrect: false }] }
            ]
        },

        // ── LANG: SCIENCE TRIVIA ──────────────────────────────────────────────
        {
            id: "lang-science-trivia-intermediate",
            title: "Science Trivia",
            language: "en", category: "lang", difficulty: "intermediate",
            estimatedMinutes: 15, mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 40 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "sci_1", prompt: "What is the chemical symbol for Gold?", choices: [{ id: "a", text: "Au", isCorrect: true }, { id: "b", text: "Go", isCorrect: false }, { id: "c", text: "Gd", isCorrect: false }, { id: "d", text: "Ag", isCorrect: false }] },
                { id: "sci_2", prompt: "Approximate speed of light in a vacuum?", choices: [{ id: "a", text: "300,000 km/s", isCorrect: true }, { id: "b", text: "150,000 km/s", isCorrect: false }, { id: "c", text: "450,000 km/s", isCorrect: false }, { id: "d", text: "3,000 km/s", isCorrect: false }] },
                { id: "sci_3", prompt: "How many bones are in the adult human body?", choices: [{ id: "a", text: "206", isCorrect: true }, { id: "b", text: "208", isCorrect: false }, { id: "c", text: "196", isCorrect: false }, { id: "d", text: "214", isCorrect: false }] },
                { id: "sci_4", prompt: "What is the powerhouse of the cell?", choices: [{ id: "a", text: "Mitochondria", isCorrect: true }, { id: "b", text: "Nucleus", isCorrect: false }, { id: "c", text: "Ribosome", isCorrect: false }, { id: "d", text: "Golgi apparatus", isCorrect: false }] },
                { id: "sci_5", prompt: "Which planet is known as the Red Planet?", choices: [{ id: "a", text: "Mars", isCorrect: true }, { id: "b", text: "Jupiter", isCorrect: false }, { id: "c", text: "Venus", isCorrect: false }, { id: "d", text: "Saturn", isCorrect: false }] },
                { id: "sci_6", prompt: "What is the atomic number of Carbon?", choices: [{ id: "a", text: "6", isCorrect: true }, { id: "b", text: "12", isCorrect: false }, { id: "c", text: "8", isCorrect: false }, { id: "d", text: "14", isCorrect: false }] },
                { id: "sci_7", prompt: "DNA stands for:", choices: [{ id: "a", text: "Deoxyribonucleic Acid", isCorrect: true }, { id: "b", text: "Dinitrogen Acid", isCorrect: false }, { id: "c", text: "Dynamic Nucleic Acid", isCorrect: false }, { id: "d", text: "Deoxyribose Nucleotide Acid", isCorrect: false }] },
                { id: "sci_8", prompt: "What force keeps planets in orbit around the sun?", choices: [{ id: "a", text: "Gravity", isCorrect: true }, { id: "b", text: "Magnetism", isCorrect: false }, { id: "c", text: "Centrifugal force", isCorrect: false }, { id: "d", text: "Nuclear force", isCorrect: false }] },
                { id: "sci_9", prompt: "Boiling point of water at sea level?", choices: [{ id: "a", text: "100°C", isCorrect: true }, { id: "b", text: "90°C", isCorrect: false }, { id: "c", text: "120°C", isCorrect: false }, { id: "d", text: "212°C", isCorrect: false }] },
                { id: "sci_10", prompt: "Which gas makes up the majority (~78%) of Earth's atmosphere?", choices: [{ id: "a", text: "Nitrogen", isCorrect: true }, { id: "b", text: "Oxygen", isCorrect: false }, { id: "c", text: "Carbon Dioxide", isCorrect: false }, { id: "d", text: "Argon", isCorrect: false }] }
            ]
        },

        // ── LANG: LITHUANIAN GENERAL KNOWLEDGE ────────────────────────────────
        {
            id: "lt-general-knowledge",
            title: "Bendroji Žinija",
            language: "lt", category: "lang", difficulty: "beginner",
            estimatedMinutes: 12, mode: "practice",
            timerConfig: { mode: 'question', limitSeconds: 35 },
            shuffleConfig: { questions: true, answers: true },
            questions: [
                { id: "lt_gk1", prompt: "Kokia yra Lietuvos sostinė?", choices: [{ id: "a", text: "Vilnius", isCorrect: true }, { id: "b", text: "Kaunas", isCorrect: false }, { id: "c", text: "Klaipėda", isCorrect: false }, { id: "d", text: "Šiauliai", isCorrect: false }] },
                { id: "lt_gk2", prompt: "Kiek šalių yra Europos Sąjungoje (2024 m.)?", choices: [{ id: "a", text: "27", isCorrect: true }, { id: "b", text: "28", isCorrect: false }, { id: "c", text: "25", isCorrect: false }, { id: "d", text: "30", isCorrect: false }] },
                { id: "lt_gk3", prompt: "Kuris vandenynas yra didžiausias pasaulyje?", choices: [{ id: "a", text: "Ramusis vandenynas", isCorrect: true }, { id: "b", text: "Atlanto vandenynas", isCorrect: false }, { id: "c", text: "Indijos vandenynas", isCorrect: false }, { id: "d", text: "Arkties vandenynas", isCorrect: false }] },
                { id: "lt_gk4", prompt: "Kokios dujos sudaro didžiausią dalį Žemės atmosferos?", choices: [{ id: "a", text: "Azotas (~78%)", isCorrect: true }, { id: "b", text: "Deguonis", isCorrect: false }, { id: "c", text: "Anglies dioksidas", isCorrect: false }, { id: "d", text: "Vandenilis", isCorrect: false }] },
                { id: "lt_gk5", prompt: "Koks yra aukščiausias kalnas pasaulyje?", choices: [{ id: "a", text: "Everestas", isCorrect: true }, { id: "b", text: "K2", isCorrect: false }, { id: "c", text: "Monblanas", isCorrect: false }, { id: "d", text: "Kilimandžaras", isCorrect: false }] },
                { id: "lt_gk6", prompt: "Koks yra cheminis aukso simbolis?", choices: [{ id: "a", text: "Au", isCorrect: true }, { id: "b", text: "Ag", isCorrect: false }, { id: "c", text: "Fe", isCorrect: false }, { id: "d", text: "Cu", isCorrect: false }] },
                { id: "lt_gk7", prompt: "Kiek kaulų yra suaugusio žmogaus kūne?", choices: [{ id: "a", text: "206", isCorrect: true }, { id: "b", text: "212", isCorrect: false }, { id: "c", text: "196", isCorrect: false }, { id: "d", text: "220", isCorrect: false }] },
                { id: "lt_gk8", prompt: "Kokia yra Japonijos sostinė?", choices: [{ id: "a", text: "Tokijas", isCorrect: true }, { id: "b", text: "Osaka", isCorrect: false }, { id: "c", text: "Kiotas", isCorrect: false }, { id: "d", text: "Jokohama", isCorrect: false }] },
                { id: "lt_gk9", prompt: "Kuri šalis turi didžiausią sausumos plotą pasaulyje?", choices: [{ id: "a", text: "Rusija", isCorrect: true }, { id: "b", text: "Kanada", isCorrect: false }, { id: "c", text: "JAV", isCorrect: false }, { id: "d", text: "Kinija", isCorrect: false }] },
                { id: "lt_gk10", prompt: "Kas yra ląstelės jėgainė?", choices: [{ id: "a", text: "Mitochondrija", isCorrect: true }, { id: "b", text: "Branduolys", isCorrect: false }, { id: "c", text: "Ribosoma", isCorrect: false }, { id: "d", text: "Golgi aparatas", isCorrect: false }] }
            ]
        }
    ];
}
const STORAGE_KEY_RESULTS = "quiz_results";
/**
 * Records a student's quiz result in the local history.
 */
function saveResult(result) {
    const results = getResults();
    results.push(result);
    localStorage.setItem(STORAGE_KEY_RESULTS, JSON.stringify(results));
}
function getResults() {
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
function getResultsByQuizId(quizId) {
    return getResults().filter(r => r.quizId === quizId);
}
function clearResults() {
    localStorage.removeItem(STORAGE_KEY_RESULTS);
}
function getHighScores(allResults) {
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
function saveImageRegistry(quizId, images) {
    const key = STORAGE_KEY_IMAGE_REGISTRY_PREFIX + quizId;
    localStorage.setItem(key, JSON.stringify(images));
}
function getImageFromRegistry(quizId, imgId) {
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
function clearAllLocalQuizzes() {
    const allIds = getAllQuizIds();
    allIds.forEach(id => {
        localStorage.removeItem(STORAGE_KEY_PREFIX + id);
        localStorage.removeItem(STORAGE_KEY_IMAGE_REGISTRY_PREFIX + id);
    });
    localStorage.removeItem(STORAGE_KEY_ALL_IDS);
}


module.exports = { getPremadeQuizzes };