import { quiz } from "./state.js";
import { getRequiredElement, escapeHtml } from "./dom.js";
import { generateQuizId, saveQuizToStorage, saveImageRegistry, getAllQuizIds, loadQuizFromStorage } from "./storage.js";
import { isAdminAccessAllowed, promptAdminPassword } from "./auth.js";
import { t, updatePageLanguage } from "./lang.js";
import { exportQuizForSharing } from "./admin-export.js";
import { parseBulkImportText } from "./admin-import.js";
import { setupDragAndDrop } from "./admin-dragdrop.js";
import { captureFocusAndScroll, restoreFocusAndScroll, insertTextAtCursor, wrapSelectedInMathMode } from "./admin-math.js";
let adminMode = false;
let adminQuiz = null;
let adminToggle;
let adminPanel;
let adminQuizTitle;
let adminQuizVisibility;
let adminQuestionsList;
let adminAddQuestionBtn;
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

// QoL Editor Features
let undoStack = [];
let redoStack = [];
let autoSaveTimer = null;
let lastActiveInputField = null;
let collapsedQuestions = {}; // Tracks collapsed state of questions by ID


// DOM references for QoL features
 // Sticky Question Navigator sidebar
let adminDraftStatus = null;
let adminUndoBtn = null;
let adminRedoBtn = null;
let adminLocalSelector = null;
let adminLocalDeleteBtn = null;
let adminDraftBanner = null;
let adminDraftBannerText = null;
let adminDraftRestoreBtn = null;
let adminDraftDismissBtn = null;

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
  adminQuizVisibility = getRequiredElement("admin-quiz-visibility");
  adminQuestionsList = getRequiredElement("admin-questions-list");
  adminAddQuestionBtn = getRequiredElement("admin-add-question");
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

  // QoL references
  
  adminDraftStatus = getRequiredElement("admin-draft-status");
  adminUndoBtn = getRequiredElement("admin-undo-btn");
  adminRedoBtn = getRequiredElement("admin-redo-btn");
  adminLocalSelector = getRequiredElement("admin-local-selector");
  adminLocalDeleteBtn = getRequiredElement("admin-local-delete-btn");
  adminDraftBanner = getRequiredElement("admin-draft-banner");
  adminDraftBannerText = getRequiredElement("admin-draft-banner-text");
  adminDraftRestoreBtn = getRequiredElement("admin-draft-restore-btn");
  adminDraftDismissBtn = getRequiredElement("admin-draft-dismiss-btn");

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
  
  const startMenu = document.getElementById("start-menu");
  if (startMenu) startMenu.style.display = adminMode ? "none" : "flex";

  const mathEditor = document.getElementById("admin-math-editor-toggle");
  if (mathEditor) mathEditor.style.display = adminMode ? "flex" : "none";
  if (adminMode) {
    document.body.classList.add("admin-mode-active");
  } else {
    document.body.classList.remove("admin-mode-active");
  }
  
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
    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();
    populateLocalSelector();
    checkAndPromptDraft();
    renderAdminForm();
  }
}
function renderAdminForm() {
  if (!adminQuiz) return;
  const focusState = captureFocusAndScroll();
  adminQuizTitle.value = adminQuiz.title;
  if (adminQuizVisibility) adminQuizVisibility.value = adminQuiz.visibility || "private";
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
    if (!q.id) {
      q.id = `q_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    }
    const isCollapsed = !!collapsedQuestions[q.id];
    const validation = validateQuestion(q);
    const validationClass = validation.isValid ? "valid" : "warning";

    const qDiv = document.createElement("div");
    qDiv.className = `admin-question-item ${isCollapsed ? "collapsed" : ""} ${validationClass}`;
    qDiv.setAttribute("data-qidx", qIdx);
    qDiv.setAttribute("draggable", "true");

    if (isCollapsed) {
      const shortType = getShortTypeLabel(q.type);
      qDiv.innerHTML = `
        <div class="collapsed-card-layout">
          <div class="drag-handle" title="${t('admin.dragToReorder') || 'Drag to reorder'}">⋮⋮</div>
          <div class="collapsed-card-content">
            <span class="badge" style="background: rgba(255,255,255,0.08); font-weight: bold; border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; display: flex; align-items: center; gap: 4px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.1);">
              #${qIdx + 1} <span style="color: var(--accent); font-weight: 800;">${shortType}</span>
            </span>
            <div class="collapsed-q-text" id="collapsed-prompt-${qIdx}" style="opacity: 0.95;"></div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
            <span class="card-collapse-toggle" data-qidx="${qIdx}" title="Expand" style="font-size: 1.1rem; padding: 4px 8px;">▼</span>
            <button class="admin-duplicate-question-btn btn btn-secondary btn-icon" data-qidx="${qIdx}" title="${t('admin.duplicate') || 'Clone'}" style="padding: 0; width: 28px; height: 28px; min-width: 28px; font-size: 0.8rem; background: rgba(52, 211, 153, 0.15); border-color: rgba(52, 211, 153, 0.3);">📄</button>
            <button class="admin-remove-question-btn btn btn-danger btn-icon" data-qidx="${qIdx}" title="${t('admin.removeQuestion') || 'Remove'}" style="padding: 0; width: 28px; height: 28px; min-width: 28px; font-size: 0.8rem;">🗑️</button>
          </div>
        </div>
      `;
    } else {
      qDiv.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="drag-handle" title="${t('admin.dragToReorder') || 'Drag to reorder'}">⋮⋮</div>
            <h3 style="margin:0;">${t("admin.question")} ${qIdx + 1}</h3>
          </div>
          <div style="display: flex; gap: 12px; align-items: center;">
            <div style="display: flex; gap: 10px; align-items: center;">
              <label style="font-size: 0.9rem; margin:0;">${t("admin.qType")}</label>
              <select class="admin-q-type-selector" data-qidx="${qIdx}" style="padding: 4px 8px; border-radius: 4px; background: rgba(0,0,0,0.2); color: white; border: 1px solid rgba(255,255,255,0.1); margin-top:0;">
                <option value="multiple-choice" ${q.type === "multiple-choice" || !q.type ? "selected" : ""}>${t("admin.typeMC")}</option>
                <option value="numeric" ${q.type === "numeric" ? "selected" : ""}>${t("admin.typeNum")}</option>
                <option value="fill-blank" ${q.type === "fill-blank" ? "selected" : ""}>${t("admin.typeBlank")}</option>
                <option value="image-upload" ${q.type === "image-upload" ? "selected" : ""}>${t("admin.typeImage")}</option>
                <option value="text" ${q.type === "text" ? "selected" : ""}>${t("admin.typeText")}</option>
                <option value="true-false" ${q.type === "true-false" ? "selected" : ""}>${t("admin.typeTF")}</option>
              </select>
            </div>
            <span class="card-collapse-toggle" data-qidx="${qIdx}" title="Collapse" style="font-size: 1.1rem; padding: 4px 8px;">▲</span>
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
          <textarea class="admin-question-prompt" data-qidx="${qIdx}">${q.prompt || ""}</textarea>
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
    }

    adminQuestionsList.appendChild(qDiv);

    // --- COMMON LISTENERS & HANDLERS ---
    
    // Collapse / Expand Toggle
    qDiv.querySelectorAll(".card-collapse-toggle").forEach((toggle) => {
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        saveStateForUndo();
        updateQuizFromDOM();
        collapsedQuestions[q.id] = !collapsedQuestions[q.id];
        renderAdminForm();
      });
    });

    // Duplicate/Clone Question
    qDiv.querySelector(".admin-duplicate-question-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!adminQuiz) return;
      saveStateForUndo();
      updateQuizFromDOM();
      const cloned = JSON.parse(JSON.stringify(adminQuiz.questions[qIdx]));
      cloned.id = `q_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      adminQuiz.questions.splice(qIdx + 1, 0, cloned);
      renderAdminForm();
      
      setTimeout(() => {
        const items = adminQuestionsList.querySelectorAll(".admin-question-item");
        if (items[qIdx + 1]) {
          const dupItem = items[qIdx + 1];
          dupItem.scrollIntoView({ behavior: "smooth", block: "center" });
          const textarea = dupItem.querySelector(".admin-question-prompt");
          if (textarea) textarea.focus();
        }
      }, 100);
    });

    // Remove Question
    qDiv.querySelector(".admin-remove-question-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!adminQuiz) return;
      if (!confirm(t("admin.confirmRemoveQuestion"))) return;
      saveStateForUndo();
      updateQuizFromDOM();
      adminQuiz.questions.splice(qIdx, 1);
      renderAdminForm();
    });

    setupDragAndDrop(qDiv, qIdx, adminQuiz, adminQuestionsList, () => {
      saveStateForUndo();
      updateQuizFromDOM();
    }, () => {
      renderAdminForm();
    });

    // --- CONDITIONAL STATE LISTENERS ---
    if (isCollapsed) {
      const colPromptDiv = qDiv.querySelector(`#collapsed-prompt-${qIdx}`);
      if (colPromptDiv) {
        colPromptDiv.textContent = q.prompt || "...";
        try {
          window.renderMathInElement(colPromptDiv, {
            delimiters: [
              { left: "\\(", right: "\\)", display: false },
              { left: "\\[", right: "\\]", display: true },
            ],
          });
        } catch (err) { console.error(err); }
      }
    } else {
      // Expanded Editor listeners & rendering

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

      // Q-Type Selector Change
      const typeSelector = qDiv.querySelector(".admin-q-type-selector");
      if (typeSelector) {
        typeSelector.onchange = () => {
          if (!adminQuiz) return;
          saveStateForUndo();
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
      }

      // Multiple choice checkboxes multiple correct toggle
      qDiv.querySelector(".admin-mc-multiple")?.addEventListener("change", () => {
        saveStateForUndo();
        updateQuizFromDOM();
        renderAdminForm();
      });

      // Basic inputs
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
        } else {
          triggerAutoSave();
          
        }
      });

      // Choices Inputs Real-time mathematical preview
      qDiv.querySelectorAll(".admin-choice-text").forEach((input) => {
        input.addEventListener("input", () => {
          updateQuizFromDOM();
          const cIdx = parseInt(input.dataset.cidx);
          const previewDiv = qDiv.querySelector(`#choice-preview-${qIdx}-${cIdx}`);
          if (previewDiv) {
            const val = input.value;
            if (val.trim()) {
              previewDiv.style.display = "inline-block";
              previewDiv.textContent = val;
              try {
                window.renderMathInElement(previewDiv, {
                  delimiters: [
                    { left: "\\(", right: "\\)", display: false },
                    { left: "\\[", right: "\\]", display: true },
                  ],
                });
              } catch (err) { console.error(err); }
            } else {
              previewDiv.style.display = "none";
            }
          }
        });
      });

      // Initial Choice Previews Render
      qDiv.querySelectorAll(".choice-live-preview").forEach((previewDiv) => {
        const cIdx = parseInt(previewDiv.id.split("-")[3]);
        const choice = q.choices?.[cIdx];
        if (choice && choice.text && choice.text.trim()) {
          previewDiv.textContent = choice.text;
          try {
            window.renderMathInElement(previewDiv, {
              delimiters: [
                { left: "\\(", right: "\\)", display: false },
                { left: "\\[", right: "\\]", display: true },
              ],
            });
          } catch (err) { console.error(err); }
        }
      });

      // Insert blank helper
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

      // Multiple choice choices click handlers
      if (q.type === "multiple-choice" || !q.type) {
        qDiv.querySelector(`.admin-add-choice-btn`)?.addEventListener("click", () => {
          if (!adminQuiz) return;
          saveStateForUndo();
          updateQuizFromDOM();
          if (!adminQuiz.questions[qIdx].choices) adminQuiz.questions[qIdx].choices = [];
          adminQuiz.questions[qIdx].choices.push({ id: String.fromCharCode(97 + adminQuiz.questions[qIdx].choices.length), text: "", isCorrect: false });
          renderAdminForm();
          
          setTimeout(() => {
            const items = adminQuestionsList.querySelectorAll(".admin-question-item");
            const qItem = items[qIdx];
            if (qItem) {
              const choices = qItem.querySelectorAll(".admin-choice-text");
              if (choices.length > 0) {
                const lastChoice = choices[choices.length - 1];
                lastChoice.scrollIntoView({ behavior: "smooth", block: "nearest" });
                lastChoice.focus();
              }
            }
          }, 100);
        });
        const choicesList = qDiv.querySelector(`.admin-choices-list`);
        choicesList.querySelectorAll(`.admin-remove-choice-btn`).forEach((btn) => {
          btn.addEventListener("click", (e) => {
            if (!adminQuiz) return;
            const cIdx = parseInt(e.currentTarget.dataset.cidx);
            if (!confirm(t("admin.confirmRemoveChoice"))) return;
            saveStateForUndo();
            updateQuizFromDOM();
            adminQuiz.questions[qIdx].choices.splice(cIdx, 1);
            renderAdminForm();
          });
        });
        choicesList.querySelectorAll(`input[type="checkbox"], input[type="radio"]`).forEach((input) => {
          input.addEventListener("change", (e) => {
            if (!adminQuiz) return;
            saveStateForUndo();
            updateQuizFromDOM();
            const target = e.target;
            const idx = parseInt(target.dataset.cidx);
            const allowMultiple = adminQuiz.questions[qIdx].allowMultipleAnswers;
            if (!allowMultiple) {
              adminQuiz.questions[qIdx].choices.forEach((c, cIdx) => c.isCorrect = idx === cIdx);
              renderAdminForm();
            } else {
              adminQuiz.questions[qIdx].choices[idx].isCorrect = target.checked;
              triggerAutoSave();
              
            }
          });
        });
      }

      // True / False radios
      if (q.type === "true-false") {
        qDiv.querySelectorAll(`input[name="tf_${qIdx}"]`).forEach((radio) => {
          radio.addEventListener("change", (e) => {
            if (!adminQuiz) return;
            saveStateForUndo();
            adminQuiz.questions[qIdx].isTrue = e.target.value === "true";
            triggerAutoSave();
            
          });
        });
      }

      // Text keywords / inputs
      if (q.type === "text") {
        qDiv.querySelector(".admin-text-long")?.addEventListener("change", () => {
          saveStateForUndo();
          updateQuizFromDOM();
        });
        qDiv.querySelector(".admin-text-keywords")?.addEventListener("input", () => {
          updateQuizFromDOM();
        });
      }

      // Reordering: Move Up (Expanded)
      qDiv.querySelector(".admin-move-up-btn")?.addEventListener("click", () => {
        if (!adminQuiz || qIdx === 0) return;
        saveStateForUndo();
        updateQuizFromDOM();
        const questions = adminQuiz.questions;
        [questions[qIdx], questions[qIdx - 1]] = [questions[qIdx - 1], questions[qIdx]];
        renderAdminForm();
      });

      // Reordering: Move Down (Expanded)
      qDiv.querySelector(".admin-move-down-btn")?.addEventListener("click", () => {
        if (!adminQuiz || qIdx === adminQuiz.questions.length - 1) return;
        saveStateForUndo();
        updateQuizFromDOM();
        const questions = adminQuiz.questions;
        [questions[qIdx], questions[qIdx + 1]] = [questions[qIdx + 1], questions[qIdx]];
        renderAdminForm();
      });

      // Image attachments
      qDiv.querySelector(".admin-add-q-image")?.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async (e) => {
          const file = e.target.files?.[0];
          if (file && adminQuiz) {
            try {
              saveStateForUndo();
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
          saveStateForUndo();
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
                saveStateForUndo();
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
            saveStateForUndo();
            adminQuiz.questions[qIdx].choices[cIdx].image = void 0;
            renderAdminForm();
          }
        });
      });
    }
  });

  
  restoreFocusAndScroll(focusState);
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
            <div class="admin-choice-item" style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px;">
                <input type="${q.allowMultipleAnswers ? "checkbox" : "radio"}" name="correct_${qIdx}" ${choice.isCorrect ? "checked" : ""} data-cidx="${cIdx}" style="margin-top: 12px;" />
                <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                    <input type="text" class="admin-choice-text" data-qidx="${qIdx}" data-cidx="${cIdx}" value="${choice.text || ""}" style="width: 100%; padding: 8px; border: 1px solid rgba(0,0,0,0.2); border-radius: 4px;" />
                    <!-- Real-time mathematical choice-level preview -->
                    <div class="choice-live-preview" id="choice-preview-${qIdx}-${cIdx}" style="display: ${choice.text ? "inline-block" : "none"};"></div>
                </div>
                
                ${choice.image ? `
                  <div style="position: relative; display: inline-block; margin-top: 4px;">
                    <img src="${choice.image.startsWith("data:") ? choice.image : "data:image/jpeg;base64," + choice.image}" style="max-height: 40px; border-radius: 4px;" />
                    <button class="admin-choice-remove-image btn btn-danger" data-cidx="${cIdx}" style="position: absolute; top: -5px; right: -5px; width: 14px; height: 14px; padding:0; min-width: 14px; font-size: 8px;">\u2715</button>
                  </div>
                ` : `
                  <button class="admin-choice-add-image btn btn-light btn-icon" data-cidx="${cIdx}" title="${t("admin.addImage")}" style="margin-top: 4px;">\u{1F4F7}</button>
                `}
                
                <button class="admin-remove-choice-btn btn btn-danger btn-icon" data-cidx="${cIdx}" style="margin-top: 4px;">\u2715</button>
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
  if (adminQuizVisibility) adminQuiz.visibility = adminQuizVisibility.value;
  adminQuiz.mode = adminQuizMode.value;
  adminQuiz.shuffleConfig = { questions: adminShuffleQuestions.checked, answers: adminShuffleAnswers.checked };
  adminQuestionsList.querySelectorAll(".admin-question-item").forEach((qDiv) => {
    if (qDiv.classList.contains("collapsed")) {
      return; // Skip reading from DOM for collapsed cards as they are not fully rendered
    }
    const promptArea = qDiv.querySelector(".admin-question-prompt");
    if (!promptArea) return;
    const qIdx = parseInt(promptArea.dataset.qidx);
    const q = adminQuiz.questions[qIdx];
    if (!q) return;
    q.prompt = promptArea.value;
    const typeSelector = qDiv.querySelector(".admin-q-type-selector");
    if (typeSelector) q.type = typeSelector.value;
    switch (q.type) {
      case "multiple-choice": {
        const multToggle = qDiv.querySelector(".admin-mc-multiple");
        if (multToggle) q.allowMultipleAnswers = multToggle.checked;
        qDiv.querySelectorAll(".admin-choice-text").forEach((input) => {
          const idx = parseInt(input.dataset.cidx);
          if (q.choices?.[idx]) q.choices[idx].text = input.value;
        });
        break;
      }
      case "numeric":
        q.correctAnswerNumber = parseFloat(qDiv.querySelector(".admin-num-answer")?.value);
        q.toleranceValue = parseFloat(qDiv.querySelector(".admin-num-tolerance")?.value);
        q.toleranceType = qDiv.querySelector(".admin-num-tolerance-type")?.value;
        break;
      case "fill-blank":
        q.blankAnswers = Array.from(qDiv.querySelectorAll(".admin-blank-answer")).map((i) => i.value);
        break;
      case "true-false": {
        const checked = qDiv.querySelector(`input[name="tf_${qIdx}"]:checked`);
        if (checked) q.isTrue = checked.value === "true";
        break;
      }
      case "text":
        q.isLongAnswer = qDiv.querySelector(".admin-text-long")?.checked;
        q.expectedKeywords = qDiv.querySelector(".admin-text-keywords")?.value.split(",").map((s) => s.trim()).filter((s) => s);
        break;
    }
  });
  triggerAutoSave();
  
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
  localStorage.removeItem("quiz_editor_draft");
  if (adminDraftBanner) adminDraftBanner.style.display = "none";
  populateLocalSelector();
  const { shareCode, registry } = exportQuizForSharing(adminQuiz);
  saveImageRegistry(adminQuiz.id, registry);
  
  if (adminQuiz.visibility === "public") {
      let community = [];
      try {
          community = JSON.parse(localStorage.getItem("quizleris_community_quizzes") || "[]");
      } catch(e) { console.error("Error parsing community quizzes:", e); }
      community = community.filter(q => q.id !== adminQuiz.id);
      community.unshift({
          id: adminQuiz.id,
          title: adminQuiz.title,
          qCount: adminQuiz.questions.length,
          shareCode: shareCode
      });
      localStorage.setItem("quizleris_community_quizzes", JSON.stringify(community));
  }

  if (shareCode.length > 8e3) alert("WARNING: Quiz data very large. URL might fail.");
  const base = window.location.origin + "/";
  const shareUrl = `${base}?quiz=${shareCode}`;
  const dashUrl = `${base}?dashboard=${escapeHtml(adminQuiz.id)}`;
  adminShareCode.style.display = "block";
  adminShareCode.innerHTML = `
        <div style="background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); padding: 15px; border-radius: 8px;">
            <strong style="color: #4CAF50;">\u2713 ${t("admin.saveSuccess")}</strong><br><br>
            <div style="margin-bottom: 10px;">
                <label style="display: block; font-weight: bold;">Student URL:</label>
                <div style="display: flex; gap: 10px;">
                    <input type="text" readonly value="${escapeHtml(shareUrl)}" id="share-url-input" style="flex: 1; padding: 8px; background: rgba(0,0,0,0.2); color: white; border: 1px solid rgba(255,255,255,0.1);" />
                    <button id="copy-share-btn" class="btn btn-secondary">Copy</button>
                </div>
            </div>
            <div style="margin-bottom: 10px;">
                <label style="display: block; font-weight: bold;">Dashboard URL:</label>
                <div style="display: flex; gap: 10px;">
                    <input type="text" readonly value="${escapeHtml(dashUrl)}" id="dash-url-input" style="flex: 1; padding: 8px; background: rgba(0,0,0,0.2); color: white; border: 1px solid rgba(255,255,255,0.1);" />
                    <button id="copy-dash-btn" class="btn btn-secondary">Copy</button>
                </div>
            </div>
            <div><label style="display: block; font-weight: bold;">Quiz ID:</label><code>${escapeHtml(adminQuiz.id)}</code></div>
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

function previewQuiz() {
  if (!adminQuiz) return;
  updateQuizFromDOM();
  const { shareCode, registry } = exportQuizForSharing(adminQuiz);
  saveImageRegistry(adminQuiz.id, registry);
  const base = window.location.origin + "/";
  const previewUrl = `${base}?quiz=${shareCode}&preview=true`;
  window.open(previewUrl, "_blank");
}


function setupAdminEventsInternal() {
  adminToggle.addEventListener("click", toggleAdminMode);
  adminAddQuestionBtn.addEventListener("click", () => {
    if (!adminQuiz) adminQuiz = { id: generateQuizId(), title: "New Quiz", questions: [] };
    updateQuizFromDOM();
    adminQuiz.questions.push({ id: `q${adminQuiz.questions.length + 1}`, prompt: "", choices: [{ id: "a", text: "", isCorrect: true }, { id: "b", text: "", isCorrect: false }] });
    renderAdminForm();
    
    setTimeout(() => {
      const items = adminQuestionsList.querySelectorAll(".admin-question-item");
      if (items.length > 0) {
        const lastItem = items[items.length - 1];
        lastItem.scrollIntoView({ behavior: "smooth", block: "center" });
        const textarea = lastItem.querySelector(".admin-question-prompt");
        if (textarea) textarea.focus();
      }
    }, 100);
  });
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
          saveStateForUndo();
          adminQuiz = json;
          renderAdminForm();
          triggerAutoSave();
        }
      } catch {
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
      saveStateForUndo();
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

  // Wire up Undo/Redo Click Listeners
  if (adminUndoBtn) adminUndoBtn.addEventListener("click", performUndo);
  if (adminRedoBtn) adminRedoBtn.addEventListener("click", performRedo);

  // Wire up Local Selector Dropdown & Delete Button Listeners
  if (adminLocalSelector) adminLocalSelector.addEventListener("change", handleLocalSelectorChange);
  if (adminLocalDeleteBtn) adminLocalDeleteBtn.addEventListener("click", handleLocalDeleteClick);

  // Wire up Draft Banner Action Buttons
  if (adminDraftRestoreBtn) adminDraftRestoreBtn.addEventListener("click", restoreDraft);
  if (adminDraftDismissBtn) adminDraftDismissBtn.addEventListener("click", dismissDraft);

  // Global keyboard listener for shortcuts (Z / Y)
  window.addEventListener("keydown", handleEditorKeyboardShortcuts);

  // Event Delegation with Capture Phase on the admin panel to checkpoint state immediately before modifications
  if (adminPanel) {
    adminPanel.addEventListener("focusin", (e) => {
      const target = e.target;
      if (target && target.matches("input, textarea, select")) {
        saveStateForUndo();
      }
    }, { capture: true });

    adminPanel.addEventListener("change", () => {
      saveStateForUndo();
    }, { capture: true });

    adminPanel.addEventListener("click", (e) => {
      const btn = e.target.closest("button, .segment-btn");
      if (!btn) return;
      const id = btn.id;
      if (
        id === "admin-undo-btn" || 
        id === "admin-redo-btn" || 
        id === "admin-preview" || 
        id === "admin-export" || 
        id === "admin-cancel" || 
        id === "admin-btn-back" || 
        id === "admin-bulk-import-btn" || 
        id === "bulk-import-close-btn" || 
        id === "bulk-import-cancel-btn" || 
        id === "admin-import-btn" ||
        btn.classList.contains("admin-choice-add-image") ||
        btn.classList.contains("admin-add-q-image")
      ) {
        return; // Exclude non-mutating clicks & sub-triggers that open a file picker (where we handle checkpointing separately)
      }
      saveStateForUndo();
    }, { capture: true });
  }

  // Track last active input field (excluding sidebar elements)
  const trackActiveField = (e) => {
    const target = e.target;
    if (target && target.closest("#admin-panel") && !target.closest(".admin-sidebar-column") && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      lastActiveInputField = target;
    }
  };
  document.addEventListener("focusin", trackActiveField);
  document.addEventListener("click", trackActiveField);

  // LaTeX Palette Tab Switching
  const paletteCard = document.getElementById("admin-latex-palette");
  if (paletteCard) {
    paletteCard.querySelectorAll(".palette-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        paletteCard.querySelectorAll(".palette-tab-btn").forEach(b => {
          b.classList.remove("active");
          b.style.background = "transparent";
          b.style.color = "var(--text)";
        });
        paletteCard.querySelectorAll(".palette-tab-content").forEach(c => c.style.display = "none");

        btn.classList.add("active");
        btn.style.background = "var(--accent)";
        btn.style.color = "black";
        
        const tabId = btn.getAttribute("data-tab");
        const tabContent = document.getElementById(`tab-${tabId}`);
        if (tabContent) {
          tabContent.style.display = "block";
        }
      });
    });
    
    // Initial Math Render inside Palette
    try {
      window.renderMathInElement(paletteCard, {
        delimiters: [
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true },
        ],
      });
    } catch (err) { console.error("Error rendering math in palette:", err); }
  }

  // LaTeX Palette Symbol Clicks
  document.querySelectorAll(".palette-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const latex = btn.getAttribute("data-latex");
      if (latex && lastActiveInputField) {
        saveStateForUndo();
        insertTextAtCursor(lastActiveInputField, latex, true);
      } else if (!lastActiveInputField) {
        alert(t("admin.selectFieldFirst") || "Please click on a question input or choice field first!");
      }
    });
  });

  // Selection Wrappers
  document.getElementById("palette-wrap-inline")?.addEventListener("click", () => {
    if (lastActiveInputField) {
      saveStateForUndo();
      wrapSelectedInMathMode(lastActiveInputField, false);
    } else {
      alert(t("admin.selectFieldFirst") || "Please click on a question input or choice field first!");
    }
  });

  document.getElementById("palette-wrap-display")?.addEventListener("click", () => {
    if (lastActiveInputField) {
      saveStateForUndo();
      wrapSelectedInMathMode(lastActiveInputField, true);
    } else {
      alert(t("admin.selectFieldFirst") || "Please click on a question input or choice field first!");
    }
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

// ==========================================
// QoL Quiz Maker Helper Functions
// ==========================================

function validateQuestion(q) {
  const errors = [];
  if (!q.prompt || !q.prompt.trim()) {
    errors.push("empty_prompt");
  }
  const type = q.type || "multiple-choice";
  if (type === "multiple-choice") {
    const choices = q.choices || [];
    if (choices.length < 2) {
      errors.push("min_choices");
    }
    let correctCount = 0;
    let emptyChoice = false;
    choices.forEach(c => {
      if (!c.text || !c.text.trim()) {
        emptyChoice = true;
      }
      if (c.isCorrect) {
        correctCount++;
      }
    });
    if (emptyChoice) {
      errors.push("empty_choice_text");
    }
    if (correctCount === 0) {
      errors.push("no_correct_choice");
    }
  } else if (type === "numeric") {
    if (q.correctAnswerNumber === undefined || q.correctAnswerNumber === null || isNaN(q.correctAnswerNumber)) {
      errors.push("invalid_numeric");
    }
  } else if (type === "fill-blank") {
    const blankCount = (q.prompt.match(/___/g) || []).length;
    if (blankCount === 0) {
      errors.push("no_blanks_in_prompt");
    } else {
      const answers = q.blankAnswers || [];
      if (answers.length < blankCount) {
        errors.push("missing_blank_answers");
      } else {
        let emptyBlank = false;
        for (let i = 0; i < blankCount; i++) {
          if (!answers[i] || !answers[i].trim()) {
            emptyBlank = true;
          }
        }
        if (emptyBlank) {
          errors.push("empty_blank_answer");
        }
      }
    }
  } else if (type === "true-false") {
    if (q.isTrue !== true && q.isTrue !== false) {
      errors.push("no_tf_value");
    }
  }
  return {
    isValid: errors.length === 0,
    errors: errors
  };
}


function getShortTypeLabel(type) {
  switch (type) {
    case "multiple-choice": return "MC";
    case "numeric": return "NUM";
    case "fill-blank": return "BLNK";
    case "true-false": return "TF";
    case "text": return "TXT";
    case "image-upload": return "IMG";
    default: return "MC";
  }
}

function flashCard(card) {
  card.style.boxShadow = "0 0 25px var(--accent)";
  card.style.borderColor = "var(--accent)";
  card.style.transform = "scale(1.02)";
  setTimeout(() => {
    card.style.boxShadow = "";
    card.style.borderColor = "";
    card.style.transform = "";
  }, 1000);
  
  const promptTextarea = card.querySelector(".admin-question-prompt");
  if (promptTextarea) {
    promptTextarea.focus();
  }
}



function saveStateForUndo() {
  if (!adminQuiz) return;
  const stateClone = JSON.parse(JSON.stringify(adminQuiz));
  
  if (undoStack.length > 0) {
    const lastStateStr = JSON.stringify(undoStack[undoStack.length - 1]);
    const currStateStr = JSON.stringify(stateClone);
    if (lastStateStr === currStateStr) {
      return; // No change, don't duplicate state
    }
  }
  
  undoStack.push(stateClone);
  if (undoStack.length > 20) {
    undoStack.shift();
  }
  redoStack = [];
  updateUndoRedoButtons();
}

function performUndo() {
  if (undoStack.length === 0) return;
  
  if (adminQuiz) {
    redoStack.push(JSON.parse(JSON.stringify(adminQuiz)));
    if (redoStack.length > 20) {
      redoStack.shift();
    }
  }
  
  adminQuiz = undoStack.pop();
  renderAdminForm();
  updateUndoRedoButtons();
  triggerAutoSave();
}

function performRedo() {
  if (redoStack.length === 0) return;
  
  if (adminQuiz) {
    undoStack.push(JSON.parse(JSON.stringify(adminQuiz)));
    if (redoStack.length > 20) {
      undoStack.shift();
    }
  }
  
  adminQuiz = redoStack.pop();
  renderAdminForm();
  updateUndoRedoButtons();
  triggerAutoSave();
}

function updateUndoRedoButtons() {
  if (adminUndoBtn) {
    adminUndoBtn.disabled = undoStack.length === 0;
    adminUndoBtn.style.opacity = undoStack.length === 0 ? "0.4" : "1";
    adminUndoBtn.style.cursor = undoStack.length === 0 ? "not-allowed" : "pointer";
  }
  if (adminRedoBtn) {
    adminRedoBtn.disabled = redoStack.length === 0;
    adminRedoBtn.style.opacity = redoStack.length === 0 ? "0.4" : "1";
    adminRedoBtn.style.cursor = redoStack.length === 0 ? "not-allowed" : "pointer";
  }
}

function handleEditorKeyboardShortcuts(e) {
  if (!adminMode) return;
  
  // Ctrl+Z / Meta+Z -> Undo
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    performUndo();
  }
  // Ctrl+Y / Meta+Y -> Redo
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    performRedo();
  }
  // Ctrl+S / Alt+S -> Save
  if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") || (e.altKey && e.key.toLowerCase() === "s")) {
    e.preventDefault();
    saveAdminQuiz();
  }
  // Alt+N -> Add Question
  if (e.altKey && e.key.toLowerCase() === "n") {
    e.preventDefault();
    if (adminAddQuestionBtn) {
      adminAddQuestionBtn.click();
    }
  }
  // Ctrl+M -> LaTeX wrap inline
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
    e.preventDefault();
    if (lastActiveInputField) {
      saveStateForUndo();
      wrapSelectedInMathMode(lastActiveInputField, false);
    }
  }
}

function triggerAutoSave() {
  if (!adminQuiz) return;
  
  updateDraftStatusBadge("saving");
  
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  
  autoSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem("quiz_editor_draft", JSON.stringify(adminQuiz));
      updateDraftStatusBadge("saved");
    } catch (e) {
      console.error("Error auto-saving draft:", e);
    }
  }, 1000);
}

function updateDraftStatusBadge(status) {
  if (!adminDraftStatus) return;
  
  const textSpan = adminDraftStatus.querySelector("span:not([style*='width'])");
  const dotSpan = adminDraftStatus.querySelector("span[style*='width']");
  
  if (status === "saving") {
    adminDraftStatus.style.background = "rgba(245, 158, 11, 0.15)";
    adminDraftStatus.style.borderColor = "rgba(245, 158, 11, 0.3)";
    adminDraftStatus.style.color = "#f59e0b";
    if (textSpan) textSpan.textContent = t("admin.savingDraft") || "Saving Draft...";
    if (dotSpan) {
      dotSpan.style.background = "#f59e0b";
      dotSpan.style.boxShadow = "0 0 8px #f59e0b";
    }
  } else if (status === "saved") {
    adminDraftStatus.style.background = "rgba(16, 185, 129, 0.15)";
    adminDraftStatus.style.borderColor = "rgba(16, 185, 129, 0.3)";
    adminDraftStatus.style.color = "#10b981";
    if (textSpan) textSpan.textContent = t("admin.draftSaved") || "Draft Saved";
    if (dotSpan) {
      dotSpan.style.background = "#10b981";
      dotSpan.style.boxShadow = "0 0 8px #10b981";
    }
  }
}

function checkAndPromptDraft() {
  const draftStr = localStorage.getItem("quiz_editor_draft");
  if (!draftStr) {
    if (adminDraftBanner) adminDraftBanner.style.display = "none";
    return;
  }
  
  try {
    const draft = JSON.parse(draftStr);
    if (!draft || !draft.questions || draft.questions.length === 0) {
      if (adminDraftBanner) adminDraftBanner.style.display = "none";
      return;
    }
    
    const currentQuizStr = JSON.stringify(adminQuiz);
    const draftQuizStr = JSON.stringify(draft);
    
    if (currentQuizStr !== draftQuizStr) {
      if (adminDraftBanner) {
        adminDraftBanner.style.display = "flex";
        if (adminDraftBannerText) {
          adminDraftBannerText.textContent = t("admin.draftDetected") || "Unsaved draft detected! Would you like to restore it?";
        }
        
        const restoreBtn = document.getElementById("admin-draft-restore-btn");
        const dismissBtn = document.getElementById("admin-draft-dismiss-btn");
        if (restoreBtn) restoreBtn.textContent = t("admin.restore") || "Restore";
        if (dismissBtn) dismissBtn.textContent = t("admin.dismiss") || "Dismiss";
      }
    } else {
      if (adminDraftBanner) adminDraftBanner.style.display = "none";
    }
  } catch (e) {
    console.error("Error reading draft:", e);
    if (adminDraftBanner) adminDraftBanner.style.display = "none";
  }
}

function restoreDraft() {
  const draftStr = localStorage.getItem("quiz_editor_draft");
  if (!draftStr) return;
  try {
    saveStateForUndo();
    adminQuiz = JSON.parse(draftStr);
    renderAdminForm();
    if (adminDraftBanner) adminDraftBanner.style.display = "none";
    
    if (adminLocalSelector) {
      adminLocalSelector.value = adminQuiz.id || "";
      toggleLocalDeleteButtonVisibility();
    }
    
    updateDraftStatusBadge("saved");
  } catch {
    alert("Failed to restore draft.");
  }
}

function dismissDraft() {
  localStorage.removeItem("quiz_editor_draft");
  if (adminDraftBanner) adminDraftBanner.style.display = "none";
}

function populateLocalSelector() {
  if (!adminLocalSelector) return;
  
  adminLocalSelector.innerHTML = "";
  
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = t("admin.loadSavedQuiz") || "-- Load Saved Quiz --";
  adminLocalSelector.appendChild(defaultOpt);
  
  const allIds = getAllQuizIds();
  allIds.forEach(id => {
    const quizData = loadQuizFromStorage(id);
    if (quizData) {
      const opt = document.createElement("option");
      opt.value = quizData.id;
      const displayTitle = quizData.title.length > 25 ? quizData.title.substring(0, 22) + "..." : quizData.title;
      opt.textContent = `${displayTitle} (${quizData.questions.length} q.)`;
      adminLocalSelector.appendChild(opt);
    }
  });
  
  if (adminQuiz && allIds.includes(adminQuiz.id)) {
    adminLocalSelector.value = adminQuiz.id;
  } else {
    adminLocalSelector.value = "";
  }
  
  toggleLocalDeleteButtonVisibility();
}

function toggleLocalDeleteButtonVisibility() {
  if (!adminLocalDeleteBtn || !adminLocalSelector) return;
  if (adminLocalSelector.value) {
    adminLocalDeleteBtn.style.display = "inline-flex";
  } else {
    adminLocalDeleteBtn.style.display = "none";
  }
}

function handleLocalSelectorChange() {
  if (!adminLocalSelector) return;
  const selectedId = adminLocalSelector.value;
  if (!selectedId) {
    toggleLocalDeleteButtonVisibility();
    return;
  }
  
  const loadedQuiz = loadQuizFromStorage(selectedId);
  if (loadedQuiz) {
    saveStateForUndo();
    adminQuiz = JSON.parse(JSON.stringify(loadedQuiz));
    renderAdminForm();
    toggleLocalDeleteButtonVisibility();
    
    if (adminDraftBanner) adminDraftBanner.style.display = "none";
    
    triggerAutoSave();
  }
}

function handleLocalDeleteClick() {
  if (!adminLocalSelector) return;
  const selectedId = adminLocalSelector.value;
  if (!selectedId) return;
  
  const confirmMsg = t("admin.deleteConfirm") || "Are you sure you want to delete this saved quiz from your device?";
  if (!confirm(confirmMsg)) return;
  
  localStorage.removeItem("quiz_" + selectedId);
  localStorage.removeItem("quiz-images_" + selectedId);
  
  let allIds = getAllQuizIds();
  allIds = allIds.filter(id => id !== selectedId);
  localStorage.setItem("quiz_all_ids", JSON.stringify(allIds));
  
  if (adminQuiz && adminQuiz.id === selectedId) {
    adminQuiz = {
      id: generateQuizId(),
      title: t("admin.newQuiz") || "New Quiz",
      questions: []
    };
    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();
    localStorage.removeItem("quiz_editor_draft");
    if (adminDraftBanner) adminDraftBanner.style.display = "none";
    renderAdminForm();
  }
  
  populateLocalSelector();
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
