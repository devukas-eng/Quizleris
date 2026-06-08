import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// TODO: Replace with real config once provided
const firebaseConfig = {
    apiKey: "MOCK_API_KEY",
    authDomain: "mock-project.firebaseapp.com",
    projectId: "mock-project",
    storageBucket: "mock-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456"
};

let app, auth, db;
let useMock = true; // Set to true until real config is added

if (firebaseConfig.apiKey !== "MOCK_API_KEY") {
    useMock = false;
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
}

// ----------------------------------------------------
// Mock Implementations for UI Testing
// ----------------------------------------------------
const mockAuth = {
    currentUser: null,
    listeners: [],
    notify: function() { this.listeners.forEach(cb => cb(this.currentUser)); },
    signIn: async (email, _pass) => {
        if (email === "owner@quizleris.com") {
            mockAuth.currentUser = { uid: "owner123", email, role: "owner" };
            localStorage.setItem("mock_user", JSON.stringify(mockAuth.currentUser));
            mockAuth.notify();
            return mockAuth.currentUser;
        }
        mockAuth.currentUser = { uid: "admin123", email, role: "admin" };
        localStorage.setItem("mock_user", JSON.stringify(mockAuth.currentUser));
        mockAuth.notify();
        return mockAuth.currentUser;
    },
    signOut: async () => {
        mockAuth.currentUser = null;
        localStorage.removeItem("mock_user");
        mockAuth.notify();
    }
};

// Initialize mock session
const savedUser = localStorage.getItem("mock_user");
if (savedUser) mockAuth.currentUser = JSON.parse(savedUser);

// ----------------------------------------------------
// Exported Service Methods
// ----------------------------------------------------
export function subscribeToAuthChanges(callback) {
    if (useMock) {
        mockAuth.listeners.push(callback);
        callback(mockAuth.currentUser);
        return () => { mockAuth.listeners = mockAuth.listeners.filter(cb => cb !== callback); };
    } else {
        return onAuthStateChanged(auth, callback);
    }
}

export async function loginWithEmail(email, password) {
    if (useMock) return mockAuth.signIn(email, password);
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
}

export async function loginWithGoogle() {
    if (useMock) return mockAuth.signIn("google-user@gmail.com", "mock");
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    return result.user;
}

export async function logout() {
    if (useMock) return mockAuth.signOut();
    return signOut(auth);
}

// ----------------------------------------------------
// Firestore Database Mocks
// ----------------------------------------------------
export async function saveQuizToCloud(quizData) {
    if (useMock) {
        let all = JSON.parse(localStorage.getItem("mock_quizzes") || "[]");
        all = all.filter(q => q.id !== quizData.id);
        all.push(quizData);
        localStorage.setItem("mock_quizzes", JSON.stringify(all));
        return true;
    }
    await setDoc(doc(db, "quizzes", quizData.id), quizData);
}

export async function getTeacherQuizzes(teacherId) {
    if (useMock) {
        let all = JSON.parse(localStorage.getItem("mock_quizzes") || "[]");
        return all; // Mock returns all for now
    }
    const q = query(collection(db, "quizzes"), where("ownerId", "==", teacherId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data());
}

export async function getAllUsers() {
    if (useMock) {
        return [
            { uid: "owner123", email: "owner@quizleris.com", role: "owner" },
            { uid: "admin123", email: "teacher@school.com", role: "admin" },
            { uid: "admin456", email: "newteacher@school.com", role: "admin" }
        ];
    }
    const snapshot = await getDocs(collection(db, "users"));
    return snapshot.docs.map(doc => doc.data());
}
