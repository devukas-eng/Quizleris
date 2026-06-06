let dragInitiatedOnHandle = false;
let draggedCardIndex = null;

export function setupDragAndDrop(qDiv, qIdx, adminQuiz, adminQuestionsList, onStateChangeCallback, onRenderCallback) {
  qDiv.addEventListener("dragstart", (e) => {
    if (!dragInitiatedOnHandle) {
      e.preventDefault();
      return;
    }
    draggedCardIndex = qIdx;
    qDiv.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", qIdx);
  });

  qDiv.addEventListener("dragend", () => {
    qDiv.classList.remove("dragging");
    dragInitiatedOnHandle = false;
    draggedCardIndex = null;
    adminQuestionsList.querySelectorAll(".admin-question-item").forEach(item => {
      item.classList.remove("drag-over");
    });
  });

  qDiv.addEventListener("dragover", (e) => {
    if (draggedCardIndex === null || draggedCardIndex === qIdx) return;
    e.preventDefault();
    qDiv.classList.add("drag-over");
  });

  qDiv.addEventListener("dragleave", () => {
    qDiv.classList.remove("drag-over");
  });

  qDiv.addEventListener("drop", (e) => {
    e.preventDefault();
    qDiv.classList.remove("drag-over");
    if (draggedCardIndex === null || draggedCardIndex === qIdx) return;
    
    onStateChangeCallback();
    
    const questions = adminQuiz.questions;
    const draggedQuestion = questions[draggedCardIndex];
    questions.splice(draggedCardIndex, 1);
    questions.splice(qIdx, 0, draggedQuestion);
    
    onRenderCallback();
  });

  const handle = qDiv.querySelector(".drag-handle");
  if (handle) {
    handle.addEventListener("mousedown", () => {
      dragInitiatedOnHandle = true;
    });
    handle.addEventListener("mouseup", () => {
      dragInitiatedOnHandle = false;
    });
  }
}
