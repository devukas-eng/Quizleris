# Quizleris – Premium Modular Quiz Platform

[![Vanilla JS](https://img.shields.io/badge/Vanilla%20JS-ES2020-yellow)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Version](https://img.shields.io/badge/version-v0.6.0-blue)](package.json)
[![Vercel](https://img.shields.io/badge/deploy-Vercel-black)](vercel.json)

**Quizleris** is an ultra-premium, browser-based quiz and mathematical examination platform designed for educators, students, and quiz lovers. Built with pure Vanilla JS, CSS, and HTML, the app delivers a top-tier visual experience combining **glassmorphism**, **custom themes**, **Netflix-style discovery horizontal carousels**, and **advanced math rendering**—all powered locally without a backend.

---

## ✨ Key Features

### 🎬 Netflix-Style Quiz Discovery
*   **Immersive Categories**: Browse and discover quizzes grouped by topics in smooth, horizontal-scrolling carousels reminiscent of Netflix.
*   **Quick Actions**: Instantly start a quiz, copy sharing URLs, or preview content directly from the discovery interface.

### 🌐 Apple-Like Language Switcher & Localization
*   **Dual-Language Support**: Fully localized in English (EN) and Lithuanian (LT).
*   **Splendid UI Controls**: Top-right animated sliding toggle featuring custom flag icons.
*   **Split Flag Design**: The English toggle features a custom split-flag (divided into an X shape containing parts of the USA, UK, Canada, and Australia flags) representing global English speakers without exclusion.

### 🛠️ Professional Admin Suite (Quiz Creator)
*   **6 Question Formats**: Create Multiple-choice, Numeric, Fill-in-the-blank, Text, True/False, and Image upload questions.
*   **KaTeX Mathematical Integration**: Render complex formulas and mathematical equations on-the-fly.
*   **OCR Support**: Scan equations or text from printed quiz papers directly into the editor using **Tesseract.js**.
*   **Quiz Export/Import**: Download your quizzes as JSON files or import existing files instantly.

### 🎓 Interactive Student Interface
*   **Two Game Modes**:
    *   *Practice Mode*: Rapid-fire learning with immediate correctness checks and step-by-step reasoning.
    *   *Exam Mode*: Formally timed assessment with navigation index, warning states for unanswered questions, and secure submission.
*   **Layout Adaptability**: Headers, logos, and configuration panels fade/disappear elegantly as you scroll down, letting the main content overlap smoothly.

### 🛡️ Privacy, Safety & Legal Modals
*   Includes detailed and compliant interactive modal pages for:
    *   **Terms of Service**
    *   **Privacy Policy**
    *   **Cookie Policy**
*   Includes clear deletion support via the support email `eblogsmod@gmail.com`.

---

## 🛠️ Technical Architecture

*   **Core**: HTML5, CSS3 Variables, ES2020 modules (Vanilla JS).
*   **Math Rendering**: [KaTeX](https://katex.org/)
*   **OCR Engine**: [Tesseract.js](https://tesseract.projectnaptha.com/)
*   **State Management**: Pure JS state tracker (`state.js`) persisting state to `localStorage`.
*   **Localization**: Dynamic client-side dictionaries (`lang.js`, `i18n.js`).

---

## 📥 Installation & Local Development

### Prerequisites
*   [Node.js](https://nodejs.org/) (v16+ recommended)

### Setup
1.  **Clone the Repository**
    ```bash
    git clone https://github.com/p0mkin/Quizleris.git
    cd Quizleris
    ```
2.  **Install Local Dev Dependencies**
    ```bash
    npm install
    ```
3.  **Run Development Server**
    ```bash
    npm start
    ```
    Open your browser and navigate to `http://localhost:8080`.

---

## 📜 Changelog

### v0.6.0
*   **Feat**: Implemented "Netflix/Kahoot-style" quiz discovery landing page with horizontal scroll topics.
*   **Feat**: Added custom split-flag animated toggle switcher for LT/EN.
*   **Feat**: Added comprehensive and compliant Privacy, Terms, and Cookie policy modals with direct contact support.
*   **UX**: Optimized scroll interactions for dynamic header transitions.

### v0.5.x
*   **Cleanup**: Removed legacy TypeScript files and compiler setup.
*   **Refactor**: Pure Vanilla JS transition.

---
Created with ❤️ by [e1tvis](https://github.com/p0mkin).
