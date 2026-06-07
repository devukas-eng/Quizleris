const fs = require('fs');
let c = fs.readFileSync('src/quiz-editor.js', 'utf8');

c = c.replace('import { processOCRImage } from "./ocr.js";\n', '');
c = c.replace('  adminScanQuestionBtn.addEventListener("click", () => adminOcrInput.click());\n', '');
c = c.replace('  adminOcrInput.addEventListener("change", handleOCRUpload);\n', '');
c = c.replace(/function renderQuestionNavigator\(\) \{[\s\S]*?(?=\nfunction |$)/, '');
c = c.replace(/renderQuestionNavigator\(\);\n?/g, '');

fs.writeFileSync('src/quiz-editor.js', c);
