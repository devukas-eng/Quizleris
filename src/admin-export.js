export function exportQuizForSharing(sourceQuiz) {
  const quizToShare = JSON.parse(JSON.stringify(sourceQuiz));
  const registry = {};
  let imgCounter = 1;
  quizToShare.questions.forEach((q) => {
    if (q.image && q.image.startsWith("data:")) {
      const imgId = `img${imgCounter++}`;
      registry[imgId] = q.image;
      q.image = `local:${imgId}`;
    }
    q.choices?.forEach((c) => {
      if (c.image && c.image.startsWith("data:")) {
        const imgId = `img${imgCounter++}`;
        registry[imgId] = c.image;
        c.image = `local:${imgId}`;
      }
    });
  });
  const bytes = new TextEncoder().encode(JSON.stringify(quizToShare));
  const binary = Array.from(bytes, b => String.fromCharCode(b)).join("");
  const shareCode = btoa(binary);
  return { shareCode, registry };
}
