// OCR processing using Tesseract.js
// Process image file with OCR
export async function processOCRImage(imageFile) {
    // Use Tesseract.js (loaded via CDN) to OCR the image
    const objectUrl = URL.createObjectURL(imageFile);
    try {
        const result = await Tesseract.recognize(objectUrl, "eng");
        const raw = result.data.text || "";
        const parsed = parseOCRText(raw);
        return parsed;
    }
    catch (err) {
        console.error("OCR error:", err);
        alert("OCR failed. Please try again or type manually.");
        return null;
    }
    finally {
        URL.revokeObjectURL(objectUrl);
    }
}
// Parse OCR text into question prompt and choices
// Very simple heuristic:
// - Use first non-empty line as the prompt
// - Use next lines (up to 6) as choices; if fewer than 2, generate placeholders
export function parseOCRText(text) {
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    const prompt = lines[0] ?? "Scanned question";
    const choiceLines = lines.slice(1, 7); // up to 6 lines for choices
    let choices = choiceLines;
    if (choices.length < 2) {
        choices = [...choices, "Choice A", "Choice B"].slice(0, 4);
    }
    // Truncate to max 6 to avoid runaway lists
    choices = choices.slice(0, 6);
    return { prompt, choices };
}
