import js from "@eslint/js";

export default [
    { ignores: ["dist/**", "tests/**", "node_modules/**"] },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                window: "readonly",
                document: "readonly",
                localStorage: "readonly",
                console: "readonly",
                alert: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                requestAnimationFrame: "readonly",
                Math: "readonly",
                Date: "readonly",
                URLSearchParams: "readonly",
                navigator: "readonly",
                btoa: "readonly",
                atob: "readonly",
                fetch: "readonly",
                TextEncoder: "readonly",
                TextDecoder: "readonly",
                Blob: "readonly",
                FileReader: "readonly",
                Event: "readonly",
                Image: "readonly",
                HTMLTextAreaElement: "readonly",
                confirm: "readonly",
                cancelAnimationFrame: "readonly",
                URL: "readonly",
                confetti: "readonly",
                Tesseract: "readonly",
                sessionStorage: "readonly",
                prompt: "readonly",
                location: "readonly",
                renderMathInElement: "readonly",
                HTMLInputElement: "readonly"
            }
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "warn"
        }
    }
];
