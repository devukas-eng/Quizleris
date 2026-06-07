export function parseBulkImportText(text) {
  const blocks = text.split(/\n\s*\n+/);
  const questions = [];
  for (let block of blocks) {
    block = block.trim();
    if (!block) continue;
    const lines = block.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) continue;
    let prompt;
    const choices = [];
    let isTF = false;
    let isTrue = false;
    let firstLine = lines[0];
    if (firstLine.toUpperCase().startsWith("Q:") || firstLine.toUpperCase().startsWith("KLAUSIMAS:")) {
      prompt = firstLine.replace(/^(Q:|KLAUSIMAS:)\s*/i, "").trim();
    } else {
      prompt = firstLine;
    }
    const choiceLines = lines.slice(1);
    const tfKeywords = ["TAIP", "NE", "TRUE", "FALSE", "TEISINGA", "NETEISINGA"];
    const singleWordTF = choiceLines.length === 1 && tfKeywords.includes(choiceLines[0].toUpperCase());
    if (singleWordTF) {
      isTF = true;
      const val = choiceLines[0].toUpperCase();
      isTrue = (val === "TAIP" || val === "TRUE" || val === "TEISINGA");
    } else {
      for (let line of choiceLines) {
        const choiceMatch = line.match(/^(\*)?\s*([A-Za-z0-9]+[.)])\s*(.*)$/);
        if (choiceMatch) {
          const isCorrect = !!choiceMatch[1];
          const textVal = choiceMatch[3].trim();
          choices.push({
            id: String.fromCharCode(97 + choices.length),
            text: textVal,
            isCorrect: isCorrect
          });
        } else {
          let isCorrect = line.startsWith("*") || line.endsWith("*");
          let cleanLine = line.replace(/^\*\s*/, "").replace(/\s*\*$/, "").trim();
          const choiceMatchClean = cleanLine.match(/^([A-Za-z0-9]+[.)])\s*(.*)$/);
          if (choiceMatchClean) {
            choices.push({
              id: String.fromCharCode(97 + choices.length),
              text: choiceMatchClean[2].trim(),
              isCorrect: isCorrect
            });
          } else {
            if (cleanLine.toUpperCase() === "TAIP" || cleanLine.toUpperCase() === "TRUE" || cleanLine.toUpperCase() === "TEISINGA" ||
                cleanLine.toUpperCase() === "NE" || cleanLine.toUpperCase() === "FALSE" || cleanLine.toUpperCase() === "NETEISINGA") {
              isTF = true;
              if (isCorrect) {
                isTrue = (cleanLine.toUpperCase() === "TAIP" || cleanLine.toUpperCase() === "TRUE" || cleanLine.toUpperCase() === "TEISINGA");
              }
            } else {
              choices.push({
                id: String.fromCharCode(97 + choices.length),
                text: cleanLine,
                isCorrect: isCorrect
              });
            }
          }
        }
      }
    }
    if (isTF) {
      questions.push({
        id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        prompt: prompt,
        type: "true-false",
        isTrue: isTrue
      });
    } else if (choices.length > 0) {
      if (!choices.some(c => c.isCorrect)) {
        choices[0].isCorrect = true;
      }
      const correctCount = choices.filter(c => c.isCorrect).length;
      questions.push({
        id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        prompt: prompt,
        type: "multiple-choice",
        allowMultipleAnswers: correctCount > 1,
        choices: choices
      });
    } else {
      questions.push({
        id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        prompt: prompt,
        type: "text",
        isLongAnswer: false,
        expectedKeywords: []
      });
    }
  }
  return questions;
}
