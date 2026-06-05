<div align="center">
  <img src="https://raw.githubusercontent.com/p0mkin/Quizleris/main/favicon.ico" width="80" height="80" alt="Quizleris Logo">
  <h1>Quizleris</h1>
  <p><b>An ultra-premium, zero-backend, modular math and trivia quiz platform built for the modern web.</b></p>

  [![Vanilla JS](https://img.shields.io/badge/Vanilla%20JS-ES2020-yellow?style=for-the-badge&logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
  [![KaTeX](https://img.shields.io/badge/KaTeX-Math%20Typesetting-333333?style=for-the-badge&logo=latex)](https://katex.org/)
  [![Version](https://img.shields.io/badge/version-v0.6.0-blue?style=for-the-badge)](package.json)
  [![Vercel](https://img.shields.io/badge/deploy-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
</div>

---

## 🌟 What is Quizleris?

**Quizleris** is a meticulously crafted, browser-based examination platform designed to bring a premium, app-like experience to quizzes. Unlike clunky traditional exam software, Quizleris focuses heavily on **aesthetics, user experience, and performance**. It combines a gorgeous glassmorphism UI with powerful math rendering capabilities—all running entirely on the client side without needing a backend server.

Whether you're a teacher building a complex physics exam with LaTeX equations, or a student swiping through a Kahoot-style discovery feed for weekend trivia, Quizleris provides a seamless, zero-lag experience.

---

## 🚀 Deep Dive: Features & Mechanics

### 🎬 Netflix-Style Discovery Hub
Forget boring lists of exams. Quizleris greets users with an immersive, horizontal-scrolling **Discovery Hub**.
*   **Categorized Carousels**: Quizzes are grouped by topics (Mathematics, Physics, Languages, Computer Science) in sleek, scrollable rows.
*   **Instant Access**: Preview a quiz's difficulty, copy a direct sharing link, or jump straight into the action directly from the carousel card.
*   **Fluid Animations**: Cards scale and glow on hover, utilizing CSS hardware acceleration for butter-smooth interactions.

### 🍎 Premium Apple-Inspired UI
*   **Glassmorphism Engine**: Modals, panels, and cards use dynamic `backdrop-filter: blur()` effects to create a modern frosted-glass aesthetic.
*   **Custom iOS-Style Language Switcher**: A deeply customized sliding toggle allows users to switch between **English (EN)** and **Lithuanian (LT)** natively. The English flag is uniquely designed as an X-shape combining elements of the USA, UK, Canada, and Australia flags for global inclusivity.
*   **Smart Layout Adaptability**: Elements like the top navigation bar and settings seamlessly fade out and retract as you scroll down, ensuring the main quiz content is never obstructed.

### 🎨 Dynamic Theming System
Built-in CSS-variable theming that remembers your choice:
*   ⚪ **Light Classic**: Clean, high-contrast, perfect for bright environments.
*   🌑 **Dark Mode**: Sleek, eye-friendly layout for late-night studying.
*   🟢 **Emerald**: Vibrant, Kahoot-inspired playful greens.
*   🌆 **Cyberpunk**: High-contrast neon accents for an edgy, futuristic feel.

### 🛠️ The Ultimate Admin Creator Suite
Educators and power users can build complex assessments effortlessly:
*   **6 Interactive Question Types**: Multiple-choice, Numeric exact, Fill-in-the-blank, Text-based essay, True/False, and Image upload based questions.
*   **LaTeX Math Palette**: A built-in virtual keyboard for instantly injecting complex mathematical symbols (`\int`, `\sum`, fractions) without memorizing KaTeX syntax. It auto-wraps expressions in math brackets `\( ... \)` for instant rendering.
*   **Tesseract.js OCR Integration**: Have a printed math worksheet? Use the built-in OCR feature to scan an image and automatically extract the text/equations directly into the question editor!
*   **Undo/Redo History**: Full `Ctrl+Z` / `Ctrl+Y` tracking for the quiz builder preventing accidental data loss.

### 🎓 The Student Experience
*   **Practice Mode**: Provides immediate feedback after every question. Great for formative learning.
*   **Exam Mode**: A stricter mode with a navigation sidebar, allowing students to skip questions, review unanswered warnings, and submit everything at the end.
*   **Real-time Timers**: Administrators can configure global quiz timers or per-question countdowns that enforce focus.

### 🔒 Privacy-First "Zero Backend" Architecture
*   **100% Local Storage**: All quiz data, user states, and settings are saved securely in the browser's `localStorage`.
*   **No Databases Needed**: Quizleris runs entirely from static files. There are no databases to configure, no authentication servers to secure, and zero latency.
*   **Portable JSON**: Quizzes can be instantly exported to `.json` files and shared with students via email or messaging apps, then imported with a single click.
*   **Compliant Legal Modals**: Includes elegantly rendered, natively integrated overlays for Terms of Service, Privacy Policy, and Cookie Policy, with built-in data deletion workflows (contact `eblogsmod@gmail.com`).

---

## 📥 Installation & Local Development

Quizleris is built using **Pure Vanilla JS (ES2020+)** and avoids heavy frameworks like React or Vue, keeping the bundle incredibly lightweight and fast.

### Prerequisites
*   [Node.js](https://nodejs.org/) (for the local development server)

### Quick Start
1.  **Clone the Repository**
    ```bash
    git clone https://github.com/p0mkin/Quizleris.git
    cd Quizleris
    ```
2.  **Install the Dev Server**
    ```bash
    npm install
    ```
3.  **Run Locally**
    ```bash
    npm start
    ```
    Open your browser and navigate to `http://localhost:8080`.

---

## 🏗️ Project Structure
*   `app.js` - Core bootstrapping and global event delegation.
*   `topics.js` - Handles the Netflix-style discovery landing page.
*   `admin.js` & `quiz-editor.js` - The quiz creation suite and LaTeX/OCR integrations.
*   `render.js` - The student exam/practice mode DOM rendering engine.
*   `i18n.js` & `lang.js` - Localization dictionaries and toggle logic.
*   `storage.js` - LocalStorage interaction and file export/import.
*   `style.css` - Global design tokens, glassmorphism, and responsive breakpoints.

---

## 📜 Recent Changelog

### v0.6.0
*   **Major Feature**: Netflix-style horizontal carousel for quiz discovery.
*   **Design**: Introduced the custom split-flag sliding toggle for language selection.
*   **UX**: Smart layout ratio optimization (`#app-root` dynamically adjusts width to aspect-ratio bounds).
*   **Compliance**: Fully fledged legal modals for Privacy & Cookies.

---
<div align="center">
  <i>Created with ❤️ and a passion for education by <a href="https://github.com/p0mkin">e1tvis</a>.</i>
</div>
