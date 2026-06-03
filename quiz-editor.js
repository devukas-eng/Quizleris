import { quiz } from "./state.js";
import { getRequiredElement } from "./dom.js";
import { generateQuizId, saveQuizToStorage, saveImageRegistry } from "./storage.js";
import { isAdminAccessAllowed, promptAdminPassword } from "./auth.js";
import { processOCRImage } from "./ocr.js";
import { t, updatePageLanguage } from "./lang.js";
let adminMode = false;
let adminQuiz = null;
let adminToggle;
let adminPanel;
let adminQuizTitle;
let adminQuestionsList;
let adminAddQuestionBtn;
let adminScanQuestionBtn;
let adminOcrInput;
let adminSaveBtn;
let adminPreviewBtn;
let adminExportBtn;
let adminImportBtn;
let adminImportInput;
let adminCancelBtn;
let adminShareCode;
let adminTimerMode;
let adminTimerLimit;
let adminShowResultsValue;
let adminResultGroup;
let adminQuizMode;
let adminQuizModeGroup;
let adminQuizModeSelect;
let adminShuffleQuestions;
let adminShuffleAnswers;
let btnShuffleQuestions;
let btnShuffleAnswers;
let adminBulkImportBtn;
let bulkImportOverlay;
let bulkImportCloseBtn;
let bulkImportCancelBtn;
let bulkImportSubmitBtn;
let bulkImportTextarea;
let goHome = () => {
};
function refreshAdminToggleVisibility() {
  if (!adminToggle) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("preview") === "true") {
    adminToggle.style.display = "none";
    return;
  }
  adminToggle.style.display = isAdminAccessAllowed() ? "block" : "none";
}
function refreshAdminUI() {
  if (adminMode && adminQuiz) {
    renderAdminForm();
  }
}
function setupAdmin(callbacks) {
  goHome = callbacks.onHome;
  adminToggle = getRequiredElement("admin-toggle");
  adminPanel = getRequiredElement("admin-panel");
  adminQuizTitle = getRequiredElement("admin-quiz-title");
  adminQuestionsList = getRequiredElement("admin-questions-list");
  adminAddQuestionBtn = getRequiredElement("admin-add-question");
  adminScanQuestionBtn = getRequiredElement("admin-scan-question");
  adminOcrInput = getRequiredElement("admin-ocr-input");
  adminSaveBtn = getRequiredElement("admin-save");
  adminPreviewBtn = getRequiredElement("admin-preview");
  adminExportBtn = getRequiredElement("admin-export");
  adminImportBtn = getRequiredElement("admin-import-btn");
  adminImportInput = getRequiredElement("admin-import-input");
  adminCancelBtn = getRequiredElement("admin-cancel");
  adminShareCode = getRequiredElement("admin-share-code");
  adminTimerMode = getRequiredElement("admin-timer-mode");
  adminTimerLimit = getRequiredElement("admin-timer-limit");
  adminShowResultsValue = getRequiredElement("admin-show-results-value");
  adminResultGroup = getRequiredElement("admin-result-visibility-group");
  adminQuizMode = getRequiredElement("admin-quiz-mode-value");
  adminQuizModeGroup = getRequiredElement("admin-quiz-mode-group");
  adminQuizModeSelect = getRequiredElement("admin-quiz-mode");
  adminShuffleQuestions = getRequiredElement("admin-shuffle-questions");
  adminShuffleAnswers = getRequiredElement("admin-shuffle-answers");
  btnShuffleQuestions = getRequiredElement("btn-shuffle-questions");
  btnShuffleAnswers = getRequiredElement("btn-shuffle-answers");
  adminBulkImportBtn = getRequiredElement("admin-bulk-import-btn");
  bulkImportOverlay = getRequiredElement("bulk-import-modal-overlay");
  bulkImportCloseBtn = getRequiredElement("bulk-import-close-btn");
  bulkImportCancelBtn = getRequiredElement("bulk-import-cancel-btn");
  bulkImportSubmitBtn = getRequiredElement("bulk-import-submit-btn");
  bulkImportTextarea = getRequiredElement("bulk-import-textarea");
  setupSegmentedControl();
  setupQuizModeSegmentedControl();
  setupShuffleToggles();
  refreshAdminToggleVisibility();
  setupAdminEventsInternal();
}
function toggleAdminMode() {
  if (!isAdminAccessAllowed()) {
    if (!promptAdminPassword()) return;
    refreshAdminToggleVisibility();
  }
  adminMode = !adminMode;
  adminPanel.style.display = adminMode ? "block" : "none";
  adminToggle.textContent = adminMode ? t("admin.playerMode") : t("admin.adminMode");
  if (adminMode) {
    if (quiz) {
      adminQuiz = { ...quiz.quiz };
    } else {
      adminQuiz = {
        id: generateQuizId(),
        title: t("admin.newQuiz"),
        questions: []
      };
    }
    renderAdminForm();
  }
}
function renderAdminForm() {
  if (!adminQuiz) return;
  adminQuizTitle.value = adminQuiz.title;
  if (!adminQuiz.timerConfig) {
    adminTimerMode.value = "question";
    adminTimerLimit.value = "30";
  } else {
    adminTimerMode.value = adminQuiz.timerConfig.mode;
    adminTimerLimit.value = String(adminQuiz.timerConfig.limitSeconds);
  }
  const currentMode = adminQuiz.mode || "practice";
  adminQuizMode.value = currentMode;
  updateQuizModeUI(currentMode);
  adminShuffleQuestions.checked = adminQuiz.shuffleConfig?.questions || false;
  adminShuffleAnswers.checked = adminQuiz.shuffleConfig?.answers || false;
  updateShuffleButtonState(btnShuffleQuestions, adminShuffleQuestions.checked);
  updateShuffleButtonState(btnShuffleAnswers, adminShuffleAnswers.checked);
  const currentVal = adminQuiz.showDetailedResults !== false ? "detailed" : "score";
  adminShowResultsValue.value = currentVal;
  updateSegmentedUI(currentVal);
  updateTimerLimitVisibility();
  updatePageLanguage();
  adminTimerMode.onchange = () => updateTimerLimitVisibility();
  adminQuestionsList.innerHTML = "";
  adminQuiz.questions.forEach((q, qIdx) => {
    const qDiv = document.createElement("div");
    qDiv.className = "admin-question-item";
    qDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin:0;">${t("admin.question")} ${qIdx + 1}</h3>
        <div style="display: flex; gap: 10px; align-items: center;">
          <label style="font-size: 0.9rem;">${t("admin.qType")}</label>
          <select class="admin-q-type-selector" data-qidx="${qIdx}" style="padding: 4px 8px; border-radius: 4px; background: rgba(0,0,0,0.2); color: white; border: 1px solid rgba(255,255,255,0.1);">
            <option value="multiple-choice" ${q.type === "multiple-choice" || !q.type ? "selected" : ""}>${t("admin.typeMC")}</option>
            <option value="numeric" ${q.type === "numeric" ? "selected" : ""}>${t("admin.typeNum")}</option>
            <option value="fill-blank" ${q.type === "fill-blank" ? "selected" : ""}>${t("admin.typeBlank")}</option>
            <option value="image-upload" ${q.type === "image-upload" ? "selected" : ""}>${t("admin.typeImage")}</option>
            <option value="text" ${q.type === "text" ? "selected" : ""}>${t("admin.typeText")}</option>
            <option value="true-false" ${q.type === "true-false" ? "selected" : ""}>${t("admin.typeTF")}</option>
          </select>
        </div>
      </div>
      
      <div class="admin-q-image-area" style="margin-bottom: 15px;">
        ${q.image ? `
          <div style="position: relative; display: inline-block;">
            <img src="${q.image.startsWith("data:") ? q.image : "data:image/jpeg;base64," + q.image}" style="max-height: 120px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);" />
            <button class="admin-remove-q-image btn btn-danger btn-icon" data-qidx="${qIdx}" 
                    style="position: absolute; top: -10px; right: -10px; width: 24px; height: 24px; padding: 0; min-width: 24px; font-size: 10px;">\u2715</button>
          </div>
        ` : `
          <button class="admin-add-q-image btn btn-light" data-qidx="${qIdx}">
            \u{1F4F7} ${t("admin.addImage")}
          </button>
        `}
      </div>

      <label>
        ${t("admin.promptLabel")}
        <textarea class="admin-question-prompt" data-qidx="${qIdx}">${q.prompt}</textarea>
      </label>

      <!-- Real-Time LaTeX/Text Preview -->
      <div class="live-preview-container" id="live-preview-${qIdx}" style="margin: 10px 0 15px 0; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px dashed rgba(255,255,255,0.15);">
        <small style="color: var(--accent); font-weight: bold; display: block; margin-bottom: 4px; font-size: 0.8rem;">${t('admin.livePreview') || 'Live Preview'}</small>
        <div class="live-preview-content" style="color: white; min-height: 20px; font-size: 1rem; white-space: pre-wrap;"></div>
      </div>
      
      <div class="admin-q-config-area" data-qidx="${qIdx}">
        ${renderQuestionConfig(q, qIdx)}
      </div>

      <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.05); display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; width: 100%;">
        <button class="admin-remove-question-btn btn btn-danger" data-qidx="${qIdx}" style="margin-right: auto;">${t("admin.removeQuestion")}</button>
        <button class="admin-move-up-btn btn btn-secondary" data-qidx="${qIdx}" ${qIdx === 0 ? "disabled" : ""} style="padding: 6px 12px; font-size: 0.85rem;">⬆️ ${t('admin.moveUp') || 'Up'}</button>
        <button class="admin-move-down-btn btn btn-secondary" data-qidx="${qIdx}" ${qIdx === adminQuiz.questions.length - 1 ? "disabled" : ""} style="padding: 6px 12px; font-size: 0.85rem;">⬇️ ${t('admin.moveDown') || 'Down'}</button>
        <button class="admin-duplicate-question-btn btn btn-secondary" data-qidx="${qIdx}" style="padding: 6px 12px; font-size: 0.85rem; background: rgba(52, 211, 153, 0.15); border-color: rgba(52, 211, 153, 0.3);">📄 ${t('admin.duplicate') || 'Clone'}</button>
      </div>
    `;
    adminQuestionsList.appendChild(qDiv);

    // Initial Live Preview Render
    const pDiv = qDiv.querySelector(`#live-preview-${qIdx} .live-preview-content`);
    if (pDiv) {
      pDiv.textContent = q.prompt || "...";
      try {
        window.renderMathInElement(pDiv, {
          delimiters: [
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true },
          ],
        });
      } catch (e) { console.error(e); }
    }

    const typeSelector = qDiv.querySelector(".admin-q-type-selector");
    typeSelector.onchange = () => {
      if (!adminQuiz) return;
      updateQuizFromDOM();
      const newType = typeSelector.value;
      adminQuiz.questions[qIdx].type = newType;
      if (newType === "multiple-choice") {
        adminQuiz.questions[qIdx].choices = [{ id: "a", text: "", isCorrect: true }, { id: "b", text: "", isCorrect: false }];
      } else if (newType === "numeric") {
        adminQuiz.questions[qIdx].correctAnswerNumber = 0;
      } else if (newType === "fill-blank") {
        adminQuiz.questions[qIdx].blankAnswers = [];
      }
      renderAdminForm();
    };
    qDiv.querySelector(".admin-mc-multiple")?.addEventListener("change", () => {
      updateQuizFromDOM();
      renderAdminForm();
    });
    qDiv.querySelectorAll(".admin-num-answer, .admin-num-tolerance, .admin-num-tolerance-type, .admin-blank-answer").forEach((input) => {
      input.addEventListener("input", () => updateQuizFromDOM());
    });

    // Real-time LaTeX preview handler
    qDiv.querySelector(".admin-question-prompt")?.addEventListener("input", (e) => {
      if (!adminQuiz) return;
      const target = e.target;
      const prompt = target.value;
      const oldBlankCount = (adminQuiz.questions[qIdx].prompt.match(/___/g) || []).length;
      const newBlankCount = (prompt.match(/___/g) || []).length;
      adminQuiz.questions[qIdx].prompt = prompt;

      // Update live preview!
      const previewDiv = qDiv.querySelector(`#live-preview-${qIdx} .live-preview-content`);
      if (previewDiv) {
        previewDiv.textContent = prompt || "...";
        try {
          window.renderMathInElement(previewDiv, {
            delimiters: [
              { left: "\\(", right: "\\)", display: false },
              { left: "\\[", right: "\\]", display: true },
            ],
          });
        } catch (err) { console.error(err); }
      }

      if (adminQuiz.questions[qIdx].type === "fill-blank" && oldBlankCount !== newBlankCount) {
        renderAdminForm();
      }
    });

    qDiv.querySelectorAll(".admin-choice-text").forEach((input) => input.addEventListener("input", () => updateQuizFromDOM()));
    qDiv.querySelector(".admin-insert-blank-btn")?.addEventListener("click", () => {
      const promptEl = qDiv.querySelector(".admin-question-prompt");
      const start = promptEl.selectionStart;
      const end = promptEl.selectionEnd;
      const text = promptEl.value;
      promptEl.value = text.substring(0, start) + "___" + text.substring(end);
      promptEl.focus();
      promptEl.setSelectionRange(start + 3, start + 3);
      promptEl.dispatchEvent(new Event("input", { bubbles: true }));
    });
    if (q.type === "multiple-choice" || !q.type) {
      qDiv.querySelector(`.admin-add-choice-btn`)?.addEventListener("click", () => {
        if (!adminQuiz) return;
        updateQuizFromDOM();
        if (!adminQuiz.questions[qIdx].choices) adminQuiz.questions[qIdx].choices = [];
        adminQuiz.questions[qIdx].choices.push({ id: String.fromCharCode(97 + adminQuiz.questions[qIdx].choices.length), text: "", isCorrect: false });
        renderAdminForm();
      });
      const choicesList = qDiv.querySelector(`.admin-choices-list`);
      choicesList.querySelectorAll(`.admin-remove-choice-btn`).forEach((btn) => {
        btn.addEventListener("click", (e) => {
          if (!adminQuiz) return;
          const cIdx = parseInt(e.currentTarget.dataset.cidx);
          if (!confirm(t("admin.confirmRemoveChoice"))) return;
          updateQuizFromDOM();
          adminQuiz.questions[qIdx].choices.splice(cIdx, 1);
          renderAdminForm();
        });
      });
      choicesList.querySelectorAll(`input[type="checkbox"], input[type="radio"]`).forEach((input) => {
        input.addEventListener("change", (e) => {
          if (!adminQuiz) return;
          updateQuizFromDOM();
          const target = e.target;
          const idx = parseInt(target.dataset.cidx);
          const allowMultiple = adminQuiz.questions[qIdx].allowMultipleAnswers;
          if (!allowMultiple) {
            adminQuiz.questions[qIdx].choices.forEach((c, cIdx) => c.isCorrect = idx === cIdx);
            renderAdminForm();
          } else {
            adminQuiz.questions[qIdx].choices[idx].isCorrect = target.checked;
          }
        });
      });
    }
    if (q.type === "true-false") {
      qDiv.querySelectorAll(`input[name="tf_${qIdx}"]`).forEach((radio) => {
        radio.addEventListener("change", (e) => {
          if (!adminQuiz) return;
          adminQuiz.questions[qIdx].isTrue = e.target.value === "true";
        });
      });
    }

    // Reordering: Move Up
    qDiv.querySelector(".admin-move-up-btn")?.addEventListener("click", () => {
      if (!adminQuiz || qIdx === 0) return;
      updateQuizFromDOM();
      const questions = adminQuiz.questions;
      [questions[qIdx], questions[qIdx - 1]] = [questions[qIdx - 1], questions[qIdx]];
      renderAdminForm();
    });

    // Reordering: Move Down
    qDiv.querySelector(".admin-move-down-btn")?.addEventListener("click", () => {
      if (!adminQuiz || qIdx === adminQuiz.questions.length - 1) return;
      updateQuizFromDOM();
      const questions = adminQuiz.questions;
      [questions[qIdx], questions[qIdx + 1]] = [questions[qIdx + 1], questions[qIdx]];
      renderAdminForm();
    });

    // Duplicate/Clone Question
    qDiv.querySelector(".admin-duplicate-question-btn")?.addEventListener("click", () => {
      if (!adminQuiz) return;
      updateQuizFromDOM();
      const cloned = JSON.parse(JSON.stringify(adminQuiz.questions[qIdx]));
      cloned.id = `q_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      adminQuiz.questions.splice(qIdx + 1, 0, cloned);
      renderAdminForm();
      alert(t('admin.duplicateSuccess') || "Question duplicated!");
    });

    qDiv.querySelector(`.admin-remove-question-btn`).addEventListener("click", () => {
      if (!adminQuiz) return;
      if (!confirm(t("admin.confirmRemoveQuestion"))) return;
      updateQuizFromDOM();
      adminQuiz.questions.splice(qIdx, 1);
      renderAdminForm();
    });
    qDiv.querySelector(".admin-add-q-image")?.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (file && adminQuiz) {
          try {
            const resizedBase64 = await resizeImage(file, 640);
            adminQuiz.questions[qIdx].image = resizedBase64;
            renderAdminForm();
          } catch (err) {
            alert("Error processing image: " + err);
          }
        }
      };
      input.click();
    });
    qDiv.querySelector(".admin-remove-q-image")?.addEventListener("click", () => {
      if (adminQuiz) {
        adminQuiz.questions[qIdx].image = void 0;
        renderAdminForm();
      }
    });
    qDiv.querySelectorAll(".admin-choice-add-image").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const cIdx = parseInt(e.currentTarget.dataset.cidx);
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async (ev) => {
          const file = ev.target.files?.[0];
          if (file && adminQuiz) {
            try {
              const resizedBase64 = await resizeImage(file, 480);
               adminQuiz.questions[qIdx].choices[cIdx].image = resizedBase64;
              renderAdminForm();
            } catch (err) {
              alert("Error processing image: " + err);
            }
          }
        };
        input.click();
      });
    });
    qDiv.querySelectorAll(".admin-choice-remove-image").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const cIdx = parseInt(e.currentTarget.dataset.cidx);
        if (adminQuiz) {
          adminQuiz.questions[qIdx].choices[cIdx].image = void 0;
          renderAdminForm();
        }
      });
    });
  });
}
function renderQuestionConfig(q, qIdx) {
  const type = q.type || "multiple-choice";
  switch (type) {
    case "multiple-choice":
      return `
        <div style="margin-bottom: 10px;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.9rem;">
            <input type="checkbox" class="admin-mc-multiple" data-qidx="${qIdx}" ${q.allowMultipleAnswers ? "checked" : ""} />
            ${t("admin.mcMultiple")}
          </label>
        </div>
        <div class="admin-choices-list" data-qidx="${qIdx}">
          ${(q.choices || []).map((choice, cIdx) => `
            <div class="admin-choice-item" style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                <input type="${q.allowMultipleAnswers ? "checkbox" : "radio"}" name="correct_${qIdx}" ${choice.isCorrect ? "checked" : ""} data-cidx="${cIdx}" />
                <input type="text" class="admin-choice-text" data-qidx="${qIdx}" data-cidx="${cIdx}" value="${choice.text || ""}" style="flex:1; padding: 8px; border: 1px solid rgba(0,0,0,0.2); border-radius: 4px;" />
                
                ${choice.image ? `
                  <div style="position: relative; display: inline-block;">
                    <img src="${choice.image.startsWith("data:") ? choice.image : "data:image/jpeg;base64," + choice.image}" style="max-height: 40px; border-radius: 4px;" />
                    <button class="admin-choice-remove-image btn btn-danger" data-cidx="${cIdx}" style="position: absolute; top: -5px; right: -5px; width: 14px; height: 14px; padding:0; min-width: 14px; font-size: 8px;">\u2715</button>
                  </div>
                ` : `
                  <button class="admin-choice-add-image btn btn-light btn-icon" data-cidx="${cIdx}" title="${t("admin.addImage")}">\u{1F4F7}</button>
                `}
                
                <button class="admin-remove-choice-btn btn btn-danger btn-icon" data-cidx="${cIdx}">\u2715</button>
            </div>
          `).join("")}
        </div>
        <button class="admin-add-choice-btn btn" data-qidx="${qIdx}">+ ${t("admin.addChoice")}</button>
      `;
    case "numeric":
      return `
        <div style="display: flex; gap: 15px; align-items: flex-end;">
          <div style="flex: 2;">
            <label style="display: block; margin-bottom: 5px; font-size: 0.9rem;">${t("admin.numAnswer")}</label>
            <input type="number" class="admin-num-answer" data-qidx="${qIdx}" value="${q.correctAnswerNumber ?? ""}" style="width: 100%; padding: 8px;" />
          </div>
          <div style="flex: 1;">
            <label style="display: block; margin-bottom: 5px; font-size: 0.9rem;">${t("admin.numTolerance")}</label>
            <input type="number" class="admin-num-tolerance" data-qidx="${qIdx}" value="${q.toleranceValue ?? 0}" style="width: 100%; padding: 8px;" />
          </div>
          <div style="flex: 1;">
            <select class="admin-num-tolerance-type" data-qidx="${qIdx}" style="width: 100%; padding: 8px; background: rgba(0,0,0,0.2); color:white;">
              <option value="absolute" ${q.toleranceType === "absolute" ? "selected" : ""}>${t("admin.tolAbs")}</option>
              <option value="percentage" ${q.toleranceType === "percentage" ? "selected" : ""}>${t("admin.tolPct")}</option>
            </select>
          </div>
        </div>
      `;
    case "fill-blank": {
      const blankCount = (q.prompt.match(/___/g) || []).length;
      return `
        <div style="margin-bottom: 12px; display: flex; gap: 10px; align-items: center;">
          <button class="btn btn-secondary btn-icon admin-insert-blank-btn" style="font-size: 0.8rem;">\u2795 ${t("admin.insertBlank")}</button>
          <span style="font-size: 0.8rem; color: #fbbf24;">\u{1F4A1} ${t("admin.blankHint")}</span>
        </div>
        <div class="admin-blanks-list" data-qidx="${qIdx}" style="display: flex; flex-direction: column; gap: 12px;">
          ${Array.from({ length: blankCount }).map((_, bIdx) => `
            <div style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px; display: flex; align-items: center; gap: 12px;">
              <span style="font-size: 0.9rem; font-weight: bold; color: var(--accent); min-width: 90px;">Laukas ${bIdx + 1}:</span>
              <input type="text" class="admin-blank-answer" data-qidx="${qIdx}" data-bidx="${bIdx}" value="${q.blankAnswers?.[bIdx] || ""}" style="flex:1; padding: 10px; background: rgba(0,0,0,0.2); color:white;" />
            </div>
          `).join("")}
          ${blankCount === 0 ? `<p style="color: #ff9800; font-size: 0.85rem;">! Nepamir\u0161kite klausime \u012Fra\u0161yti ___</p>` : ""}
        </div>
      `;
    }
    case "true-false":
      return `
        <div style="display: flex; gap: 20px; margin-top: 10px;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="radio" name="tf_${qIdx}" value="true" ${q.isTrue === true ? "checked" : ""} />
            <span style="color: #4CAF50; font-weight: bold;">TRUE</span>
          </label>
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="radio" name="tf_${qIdx}" value="false" ${q.isTrue === false ? "checked" : ""} />
            <span style="color: #f44336; font-weight: bold;">FALSE</span>
          </label>
        </div>
      `;
    case "text":
      return `
        <div style="margin-bottom: 15px;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.9rem; margin-bottom: 8px;">
            <input type="checkbox" class="admin-text-long" data-qidx="${qIdx}" ${q.isLongAnswer ? "checked" : ""} />
            ${t("admin.longAnswer")}
          </label>
          <label style="display: block; margin-bottom: 5px; font-size: 0.9rem;">${t("admin.keywords")}</label>
          <input type="text" class="admin-text-keywords" data-qidx="${qIdx}" value="${(q.expectedKeywords || []).join(", ")}" style="width: 100%; padding: 8px;" />
        </div>
      `;
    case "image-upload":
      return `<div style="background: rgba(139, 92, 246, 0.1); padding: 15px; border-radius: 8px; text-align: center;"><p style="margin:0; font-size: 0.9rem;">${t("admin.imageUploadHint")}</p></div>`;
    default:
      return "";
  }
}
function updateQuizFromDOM() {
  if (!adminQuiz) return;
  adminQuiz.title = adminQuizTitle.value;
  adminQuiz.mode = adminQuizMode.value;
  adminQuiz.shuffleConfig = { questions: adminShuffleQuestions.checked, answers: adminShuffleAnswers.checked };
  adminQuestionsList.querySelectorAll(".admin-question-item").forEach((qDiv) => {
    const promptArea = qDiv.querySelector(".admin-question-prompt");
    if (!promptArea) return;
    const qIdx = parseInt(promptArea.dataset.qidx);
    const q = adminQuiz.questions[qIdx];
    if (!q) return;
    q.prompt = promptArea.value;
    const typeSelector = qDiv.querySelector(".admin-q-type-selector");
    if (typeSelector) q.type = typeSelector.value;
    switch (q.type) {
      case "multiple-choice":
        const multToggle = qDiv.querySelector(".admin-mc-multiple");
        if (multToggle) q.allowMultipleAnswers = multToggle.checked;
        qDiv.querySelectorAll(".admin-choice-text").forEach((input) => {
          const idx = parseInt(input.dataset.cidx);
          if (q.choices?.[idx]) q.choices[idx].text = input.value;
        });
        break;
      case "numeric":
        q.correctAnswerNumber = parseFloat(qDiv.querySelector(".admin-num-answer")?.value);
        q.toleranceValue = parseFloat(qDiv.querySelector(".admin-num-tolerance")?.value);
        q.toleranceType = qDiv.querySelector(".admin-num-tolerance-type")?.value;
        break;
      case "fill-blank":
        q.blankAnswers = Array.from(qDiv.querySelectorAll(".admin-blank-answer")).map((i) => i.value);
        break;
      case "true-false":
        const checked = qDiv.querySelector(`input[name="tf_${qIdx}"]:checked`);
        if (checked) q.isTrue = checked.value === "true";
        break;
      case "text":
        q.isLongAnswer = qDiv.querySelector(".admin-text-long")?.checked;
        q.expectedKeywords = qDiv.querySelector(".admin-text-keywords")?.value.split(",").map((s) => s.trim()).filter((s) => s);
        break;
    }
  });
}
function updateTimerLimitVisibility() {
  const parent = adminTimerLimit.parentElement;
  if (parent) parent.style.display = adminTimerMode.value === "none" ? "none" : "block";
}
function saveAdminQuiz() {
  if (!adminQuiz) return;
  updateQuizFromDOM();
  if (adminQuiz.questions.length === 0) {
    alert(t("admin.errorNoQuestions"));
    return;
  }
  saveQuizToStorage(adminQuiz);
  const { shareCode, registry } = exportQuizForSharing(adminQuiz);
  saveImageRegistry(adminQuiz.id, registry);
  if (shareCode.length > 8e3) alert("WARNING: Quiz data very large. URL might fail.");
  let path = window.location.pathname;
  if (path.endsWith("/topics") || path.endsWith("/topics/")) {
    path = path.replace(/\/topics\/?$/, "/");
  }
  if (!path.endsWith("/")) path += "/";
  const base = window.location.origin + path;
  const shareUrl = `${base}?quiz=${shareCode}`;
  const dashUrl = `${base}?dashboard=${adminQuiz.id}`;
  adminShareCode.style.display = "block";
  adminShareCode.innerHTML = `
        <div style="background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); padding: 15px; border-radius: 8px;">
            <strong style="color: #4CAF50;">\u2713 ${t("admin.saveSuccess")}</strong><br><br>
            <div style="margin-bottom: 10px;">
                <label style="display: block; font-weight: bold;">Student URL:</label>
                <div style="display: flex; gap: 10px;">
                    <input type="text" readonly value="${shareUrl}" id="share-url-input" style="flex: 1; padding: 8px; background: rgba(0,0,0,0.2); color: white; border: 1px solid rgba(255,255,255,0.1);" />
                    <button id="copy-share-btn" class="btn btn-secondary">Copy</button>
                </div>
            </div>
            <div style="margin-bottom: 10px;">
                <label style="display: block; font-weight: bold;">Dashboard URL:</label>
                <div style="display: flex; gap: 10px;">
                    <input type="text" readonly value="${dashUrl}" id="dash-url-input" style="flex: 1; padding: 8px; background: rgba(0,0,0,0.2); color: white; border: 1px solid rgba(255,255,255,0.1);" />
                    <button id="copy-dash-btn" class="btn btn-secondary">Copy</button>
                </div>
            </div>
            <div><label style="display: block; font-weight: bold;">Quiz ID:</label><code>${adminQuiz.id}</code></div>
        </div>`;
  document.getElementById("copy-share-btn")?.addEventListener("click", () => {
    const input = document.getElementById("share-url-input");
    input.select();
    navigator.clipboard.writeText(shareUrl);
    alert("Copied!");
  });
  document.getElementById("copy-dash-btn")?.addEventListener("click", () => {
    const input = document.getElementById("dash-url-input");
    input.select();
    navigator.clipboard.writeText(dashUrl);
    alert("Copied!");
  });
}
function exportQuizForSharing(sourceQuiz) {
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
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const shareCode = btoa(binary);
  return { shareCode, registry };
}
function previewQuiz() {
  if (!adminQuiz) return;
  updateQuizFromDOM();
  const { shareCode, registry } = exportQuizForSharing(adminQuiz);
  saveImageRegistry(adminQuiz.id, registry);
  const base = window.location.origin + window.location.pathname;
  const previewUrl = `${base}?quiz=${shareCode}&preview=true`;
  window.open(previewUrl, "_blank");
}
async function handleOCRUpload(event) {
  const file = event.target.files?.[0];
  if (!file || !adminQuiz) return;
  adminScanQuestionBtn.textContent = "Processing...";
  try {
    const result = await processOCRImage(file);
    if (result) {
      adminQuiz.questions.push({ id: `q${adminQuiz.questions.length + 1}`, prompt: result.prompt, choices: result.choices.map((t2, i) => ({ id: String.fromCharCode(97 + i), text: t2, isCorrect: i === 0 })) });
      renderAdminForm();
    }
  } catch (e) {
    alert("OCR failed");
  } finally {
    adminScanQuestionBtn.textContent = t("admin.scanOCR");
  }
}
function parseBulkImportText(text) {
  const blocks = text.split(/\n\s*\n+/);
  const questions = [];
  for (let block of blocks) {
    block = block.trim();
    if (!block) continue;
    const lines = block.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) continue;
    let prompt = "";
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
        const choiceMatch = line.match(/^(\*)?\s*([A-Za-z0-9]+[\.\)])\s*(.*)$/);
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
          const choiceMatchClean = cleanLine.match(/^([A-Za-z0-9]+[\.\)])\s*(.*)$/);
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
function setupAdminEventsInternal() {
  adminToggle.addEventListener("click", toggleAdminMode);
  adminAddQuestionBtn.addEventListener("click", () => {
    if (!adminQuiz) adminQuiz = { id: generateQuizId(), title: "New Quiz", questions: [] };
    updateQuizFromDOM();
    adminQuiz.questions.push({ id: `q${adminQuiz.questions.length + 1}`, prompt: "", choices: [{ id: "a", text: "", isCorrect: true }, { id: "b", text: "", isCorrect: false }] });
    renderAdminForm();
  });
  adminScanQuestionBtn.addEventListener("click", () => adminOcrInput.click());
  adminOcrInput.addEventListener("change", handleOCRUpload);
  adminSaveBtn.addEventListener("click", saveAdminQuiz);
  adminPreviewBtn.addEventListener("click", previewQuiz);
  adminExportBtn.addEventListener("click", () => {
    if (!adminQuiz) return;
    const blob = new Blob([JSON.stringify(adminQuiz, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "quiz.json";
    a.click();
  });
  adminImportBtn.addEventListener("click", () => adminImportInput.click());
  adminImportInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result);
        if (json.questions) {
          adminQuiz = json;
          renderAdminForm();
        }
      } catch (e2) {
        alert("Import failed");
      }
    };
    reader.readAsText(file);
  });
  adminCancelBtn.addEventListener("click", () => {
    if (confirm(t("admin.confirmCancel"))) toggleAdminMode();
  });

  // Bulk Import Events
  adminBulkImportBtn.addEventListener("click", () => {
    if (!adminQuiz) adminQuiz = { id: generateQuizId(), title: "New Quiz", questions: [] };
    bulkImportTextarea.value = "";
    bulkImportOverlay.style.display = "flex";
    bulkImportTextarea.focus();
  });
  const hideBulkImport = () => {
    bulkImportOverlay.style.display = "none";
  };
  bulkImportCloseBtn.addEventListener("click", hideBulkImport);
  bulkImportCancelBtn.addEventListener("click", hideBulkImport);
  bulkImportSubmitBtn.addEventListener("click", () => {
    const text = bulkImportTextarea.value;
    const parsed = parseBulkImportText(text);
    if (parsed.length > 0) {
      updateQuizFromDOM();
      adminQuiz.questions.push(...parsed);
      renderAdminForm();
      hideBulkImport();
    } else {
      alert("Neradome jokių klausimų. Patikrinkite formatą.");
    }
  });
  document.getElementById("admin-btn-back")?.addEventListener("click", () => {
    if (adminMode) toggleAdminMode();
    goHome();
  });
}
function setupSegmentedControl() {
  adminResultGroup.querySelectorAll(".segment-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.getAttribute("data-value") || "detailed";
      adminShowResultsValue.value = val;
      updateSegmentedUI(val);
      if (adminQuiz) adminQuiz.showDetailedResults = val === "detailed";
    });
  });
}
function updateSegmentedUI(value) {
  adminResultGroup.querySelectorAll(".segment-btn").forEach((btn) => {
    if (btn.getAttribute("data-value") === value) btn.classList.add("active");
    else btn.classList.remove("active");
  });
}
function setupQuizModeSegmentedControl() {
  const initialVal = adminQuizModeSelect.value || "practice";
  adminQuizMode.value = initialVal;
  updateQuizModeUI(initialVal);
  syncResultVisibility(initialVal);
  adminQuizModeGroup.querySelectorAll(".segment-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.getAttribute("data-value") || "practice";
      adminQuizMode.value = val;
      adminQuizModeSelect.value = val;
      adminQuizModeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      updateQuizModeUI(val);
      syncResultVisibility(val);
      if (adminQuiz) adminQuiz.mode = val;
    });
  });
}
function syncResultVisibility(mode) {
  const visibilityVal = mode === "practice" ? "detailed" : "score";
  adminShowResultsValue.value = visibilityVal;
  updateSegmentedUI(visibilityVal);
  if (adminQuiz) {
    adminQuiz.showDetailedResults = mode === "practice";
  }
}
function updateQuizModeUI(value) {
  adminQuizModeGroup.querySelectorAll(".segment-btn").forEach((btn) => {
    if (btn.getAttribute("data-value") === value) btn.classList.add("active");
    else btn.classList.remove("active");
  });
}
function setupShuffleToggles() {
  const toggles = [
    { btn: btnShuffleQuestions, input: adminShuffleQuestions, key: "questions" },
    { btn: btnShuffleAnswers, input: adminShuffleAnswers, key: "answers" }
  ];
  toggles.forEach((toggle) => {
    toggle.btn.addEventListener("click", () => {
      toggle.input.checked = !toggle.input.checked;
      updateShuffleButtonState(toggle.btn, toggle.input.checked);
      if (adminQuiz) {
        if (!adminQuiz.shuffleConfig) adminQuiz.shuffleConfig = { questions: false, answers: false };
        if (toggle.key === "questions") adminQuiz.shuffleConfig.questions = toggle.input.checked;
        if (toggle.key === "answers") adminQuiz.shuffleConfig.answers = toggle.input.checked;
      }
    });
  });
}
function updateShuffleButtonState(btn, isActive) {
  if (isActive) btn.classList.add("active");
  else btn.classList.remove("active");
}
async function resizeImage(file, maxDim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        if (w > h) {
          if (w > maxDim) {
            h *= maxDim / w;
            w = maxDim;
          }
        } else {
          if (h > maxDim) {
            w *= maxDim / h;
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.5));
      };
      img.onerror = reject;
      img.src = e.target?.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
export {
  previewQuiz,
  refreshAdminToggleVisibility,
  refreshAdminUI,
  renderAdminForm,
  saveAdminQuiz,
  setupAdmin,
  toggleAdminMode
};
