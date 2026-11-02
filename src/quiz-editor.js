import { quiz } from "./state.js";
import { getRequiredElement, escapeHtml } from "./dom.js";
import { generateQuizId, saveQuizToStorage, saveImageRegistry, getAllQuizIds, loadQuizFromStorage } from "./storage.js";
import { isAdminAccessAllowed, promptAdminPassword } from "./auth.js";
import { t, updatePageLanguage } from "./lang.js";
import { exportQuizForSharing } from "./admin-export.js";
import { parseBulkImportText } from "./admin-import.js";
import { setupDragAndDrop } from "./admin-dragdrop.js";
import { captureFocusAndScroll, restoreFocusAndScroll, insertTextAtCursor, wrapSelectedInMathMode } from "./admin-math.js";
import { confirmDialog, alertDialog } from "./dialog.js";
import "./rich-input.js";
import { exportQuizToDocx } from "./docx-export.js";
import { openPrintPreview } from "./print-preview.js";
import { typeTriggerHtml, openTypeWheel, kindOfQuestion, getKind, ANSWER_KINDS, answerKindTriggerHtml, kindOfChoice } from "./type-wheel.js";
import { getToken, deleteQuizFromCloud, fetchProfile, fetchCloudQuizzes } from "./api.js";

// Private quizzes on the free plan are deleted after this many days (mirrors server PRIVATE_EXPIRY_DAYS)
const FREE_PRIVATE_EXPIRY_DAYS = 30;

let adminMode = false;
let adminQuiz = null;
let adminToggle;
let adminPanel;
let adminQuizTitle;
let adminQuizId;
let adminQuizIdContainer;
let adminQuizVisibility;
let adminQuestionsList;
let adminAddQuestionBtn;
let adminSaveBtn;
let adminPreviewBtn;
let adminExportBtn;
let adminImportBtn;
let adminImportInput;
let adminNewQuizBtn;
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

// null = private quizzes never expire (premium/admin); refreshed from the server profile
let privateExpiryDays = FREE_PRIVATE_EXPIRY_DAYS;

let goHome = () => {
};

function updateVisibilityLabels() {
  if (!adminQuizVisibility) return;
  const privateOpt = adminQuizVisibility.querySelector('option[value="private"]');
  const publicOpt = adminQuizVisibility.querySelector('option[value="public"]');
  if (privateOpt) {
    privateOpt.textContent = privateExpiryDays == null
      ? t("admin.visPrivate")
      : t("admin.visPrivateExpiry").replace("{days}", privateExpiryDays);
  }
  if (publicOpt) publicOpt.textContent = t("admin.visPublic");
}
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
  adminQuizId = document.getElementById("admin-quiz-id");
  adminQuizIdContainer = document.getElementById("admin-quiz-id-container");
  adminQuizVisibility = getRequiredElement("admin-quiz-visibility");
  adminQuestionsList = getRequiredElement("admin-questions-list");
  adminAddQuestionBtn = getRequiredElement("admin-add-question");
  adminSaveBtn = getRequiredElement("admin-save");
  adminPreviewBtn = getRequiredElement("admin-preview");
  adminExportBtn = getRequiredElement("admin-export");
  adminImportBtn = getRequiredElement("admin-import-btn");
  adminImportInput = getRequiredElement("admin-import-input");
  adminNewQuizBtn = getRequiredElement("admin-new-quiz");
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
  window.addEventListener("pagehide", flushDraft);

  setupSegmentedControl();
  setupQuizModeSegmentedControl();
  setupShuffleToggles();
  refreshAdminToggleVisibility();
  document.addEventListener("quizleris-auth-changed", () => {
    refreshAdminToggleVisibility();
    if (adminMode && !isAdminAccessAllowed()) toggleAdminMode();
  });
  setupAdminEventsInternal();
}
function toggleAdminMode() {
  if (!adminMode && !isAdminAccessAllowed()) {
    promptAdminPassword();
    return;
  }
  adminMode = !adminMode;
  adminPanel.style.display = adminMode ? "block" : "none";
  
  const startMenu = document.getElementById("start-menu");
  if (startMenu) startMenu.style.display = adminMode ? "none" : "flex";

  if (adminMode) {
    document.body.classList.add("admin-mode-active");
  } else {
    document.body.classList.remove("admin-mode-active");
  }
  
  adminToggle.textContent = adminMode ? t("admin.playerMode") : t("admin.adminMode");
  if (adminMode) {
    // The editor always resumes the one working draft; a quiz being played is opened instead
    // only when the draft has nothing unsaved.
    const draft = readDraft();
    if (quiz && !draft?.dirty) {
      adminQuiz = JSON.parse(JSON.stringify(quiz.quiz));
      writeDraft(false, true);
    } else if (draft) {
      adminQuiz = draft.quiz;
    } else {
      adminQuiz = blankQuiz();
      writeDraft(false, false);
    }
    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();
    populateLocalSelector();
    renderAdminForm();
    updateDraftStatusBadge(draftBadgeStatus());
  } else {
    flushDraft();
  }
}
// Opens the editor (if closed) and optionally loads one of the user's saved quizzes into it.
async function openEditor(quizId) {
  const draft = readDraft();
  // Same quiz with unsaved edits in the draft: keep the edits instead of reloading the saved copy
  if (quizId && draft?.dirty && draft.quiz.id === quizId) quizId = null;
  if (quizId && !(await confirmReplaceDraft(quizId))) quizId = null;
  if (!adminMode) toggleAdminMode();
  if (!adminMode || !quizId) return;
  await loadIntoEditor(quizId);
}

// Replaces the working draft with a saved quiz from the cloud
async function loadIntoEditor(quizId) {
  const loadedQuiz = await loadQuizFromStorage(quizId);
  if (!loadedQuiz) {
    await alertDialog(t("profile.loadError"), quizId);
    return;
  }
  adminQuiz = JSON.parse(JSON.stringify(loadedQuiz));
  undoStack = [];
  redoStack = [];
  updateUndoRedoButtons();
  if (adminShareCode) adminShareCode.style.display = "none";
  writeDraft(false, true);
  updateDraftStatusBadge("cloud");
  renderAdminForm();
  if (adminLocalSelector) {
    adminLocalSelector.value = quizId;
    toggleLocalDeleteButtonVisibility();
  }
}

// --- Working draft ---
// One draft per device, saved on every change and resumed whenever the editor opens.
// "dirty" means it has changes that are not saved to the cloud yet.
const DRAFT_KEY = "quiz_editor_draft";

function readDraft() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (!parsed) return null;
    if (parsed.quiz && Array.isArray(parsed.quiz.questions)) return parsed;
    // Older format stored the bare quiz object
    return Array.isArray(parsed.questions) ? { quiz: parsed, dirty: true } : null;
  } catch {
    return null;
  }
}

// inCloud: this quiz exists in the cloud (loaded from or saved to it); kept across autosaves
function writeDraft(dirty, inCloud) {
  if (!adminQuiz) return;
  if (inCloud === undefined) {
    const prev = readDraft();
    inCloud = !!prev?.inCloud && prev.quiz.id === adminQuiz.id;
  }
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ quiz: adminQuiz, dirty, inCloud }));
  } catch (e) {
    console.error("Error saving draft:", e);
  }
}

function draftBadgeStatus() {
  const draft = readDraft();
  return draft && !draft.dirty && draft.inCloud ? "cloud" : "saved";
}

// Saves a pending debounced autosave right away (closing the editor, leaving the page)
function flushDraft() {
  if (!autoSaveTimer) return;
  clearTimeout(autoSaveTimer);
  autosaveNow();
}

function blankQuiz() {
  return { id: generateQuizId(), title: t("admin.newQuiz"), questions: [] };
}

function draftHasContent(q) {
  const defaultTitles = [t("admin.newQuiz"), "New Quiz", "Naujas testas"];
  if (q.title && q.title.trim() && !defaultTitles.includes(q.title.trim())) return true;
  return (q.questions || []).some(question =>
    question.prompt?.trim() || question.image ||
    (question.choices || []).some(c => c.text?.trim() || c.image));
}

// Asks before unsaved work in the draft is replaced by another (or a new) quiz
async function confirmReplaceDraft(nextId) {
  flushDraft();
  const draft = readDraft();
  if (!draft || !draft.dirty || draft.quiz.id === nextId || !draftHasContent(draft.quiz)) return true;
  return confirmDialog({
    title: t("admin.replaceDraftTitle"),
    message: t("admin.replaceDraftBody").replace("{title}", draft.quiz.title || "—"),
    confirmText: t("admin.replaceDraftConfirm"),
    danger: true
  });
}
function renderAdminForm() {
  if (!adminQuiz) return;
  const focusState = captureFocusAndScroll();
  adminQuizTitle.value = adminQuiz.title;
  
  if (adminQuizIdContainer && adminQuizId) {
      const userStr = localStorage.getItem('quizleris_user');
      let isAdmin = false;
      try {
          const user = JSON.parse(userStr);
          isAdmin = user && user.role === 'admin';
      } catch(e) {
          console.warn("Could not parse user string", e);
      }
      
      if (isAdmin) {
          adminQuizIdContainer.style.display = 'block';
          adminQuizId.value = adminQuiz.id;
      } else {
          adminQuizIdContainer.style.display = 'none';
      }
  }
  
  if (adminQuizVisibility) {
    updateVisibilityLabels();
    adminQuizVisibility.value = adminQuiz.visibility || "private";
  }
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
      const shortType = getShortTypeLabel(q);
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
            <button class="admin-duplicate-question-btn btn btn-secondary btn-icon" data-qidx="${qIdx}" title="${t('admin.duplicate') || 'Clone'}" aria-label="${t('admin.duplicate') || 'Clone'}" style="padding: 0; width: 28px; height: 28px; min-width: 28px; font-size: 0.8rem; background: rgba(52, 211, 153, 0.15); border-color: rgba(52, 211, 153, 0.3);">📄</button>
            <button class="admin-remove-question-btn btn btn-danger btn-icon" data-qidx="${qIdx}" title="${t('admin.removeQuestion') || 'Remove'}" aria-label="${t('admin.removeQuestion') || 'Remove'}" style="padding: 0; width: 28px; height: 28px; min-width: 28px; font-size: 0.8rem;">🗑️</button>
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
            ${typeTriggerHtml(q, qIdx)}
            <span class="card-collapse-toggle" data-qidx="${qIdx}" title="Collapse" style="font-size: 1.1rem; padding: 4px 8px;">▲</span>
          </div>
        </div>
        
        <div class="admin-q-image-area" style="margin-bottom: 15px;">
          ${q.image ? `
            <div style="position: relative; display: inline-block;">
              <img src="${q.image.startsWith("data:") ? q.image : "data:image/jpeg;base64," + q.image}" style="max-height: 120px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);" />
              <button class="admin-remove-q-image btn btn-danger btn-icon" aria-label="Remove Image" data-qidx="${qIdx}" 
                      style="position: absolute; top: -10px; right: -10px; width: 24px; height: 24px; padding: 0; min-width: 24px; font-size: 10px;">\u2715</button>
            </div>
          ` : `
            <button class="admin-add-q-image btn btn-light" data-qidx="${qIdx}">
              \u{1F4F7} ${t("admin.addImage")}
            </button>
          `}
        </div>

        <div class="admin-field-label">${t("admin.promptLabel")}</div>
        <rich-input class="admin-question-prompt" multiline data-qidx="${qIdx}"
          value="${escapeHtml(q.prompt || "")}" placeholder="${t("rich.promptPlaceholder")}"></rich-input>

        
        
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
    qDiv.querySelector(".admin-remove-question-btn")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!adminQuiz) return;
      updateQuizFromDOM();
      const question = adminQuiz.questions[qIdx];
      const isBlank = !question?.prompt?.trim() && !question?.image && !(question?.choices || []).some(c => c.text?.trim() || c.image);
      if (!isBlank) {
        const ok = await confirmDialog({
          title: t("admin.removeQuestionTitle"),
          message: t("admin.removeQuestionBody").replace("{n}", qIdx + 1),
          confirmText: t("dialog.delete"),
          danger: true
        });
        if (!ok || !adminQuiz) return;
      }
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

      // Question type wheel
      const typeTrigger = qDiv.querySelector(".qtype-trigger");
      typeTrigger?.addEventListener("click", () => {
        if (!adminQuiz) return;
        openTypeWheel(typeTrigger, kindOfQuestion(adminQuiz.questions[qIdx]), (kind) => applyQuestionKind(qIdx, kind));
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
        qDiv.querySelector(".admin-question-prompt")?.insertText("___");
      });

      // Per-answer kind wheel (option / write-in / number) and the typed-answer fields
      qDiv.querySelectorAll(".answer-kind-trigger").forEach((trigger) => {
        trigger.addEventListener("click", () => {
          const cIdx = parseInt(trigger.dataset.cidx);
          const choice = adminQuiz?.questions[qIdx]?.choices?.[cIdx];
          if (!choice) return;
          openTypeWheel(trigger, kindOfChoice(choice), (kind) => applyChoiceKind(qIdx, cIdx, kind),
            { kinds: ANSWER_KINDS, title: t("akind.title") });
        });
      });
      qDiv.querySelectorAll(".admin-choice-accepted, .admin-choice-number, .admin-choice-tolerance").forEach((input) => {
        input.addEventListener("input", () => updateQuizFromDOM());
      });

      // Choice list handlers (single and multiple answers)
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
          btn.addEventListener("click", async (e) => {
            if (!adminQuiz) return;
            const cIdx = parseInt(e.currentTarget.dataset.cidx);
            updateQuizFromDOM();
            const choice = adminQuiz.questions[qIdx].choices[cIdx];
            // Empty choices are removed straight away: nothing to lose, and undo still works
            const choiceKind = kindOfChoice(choice);
            const preview = choiceKind === "write" ? (choice?.accepted || []).join("; ")
              : choiceKind === "number" ? String(choice?.number ?? "")
              : plainPreview(choice?.text);
            if (choice && (preview || choice.image)) {
              const text = preview || "🖼";
              const ok = await confirmDialog({
                title: t("admin.removeChoiceTitle"),
                message: t("admin.removeChoiceBody").replace("{text}", text.length > 60 ? text.slice(0, 57) + "…" : text),
                confirmText: t("dialog.remove"),
                danger: true
              });
              if (!ok || !adminQuiz) return;
            }
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
            const question = adminQuiz.questions[qIdx];
            const allowMultiple = question.type === "multiple-choice" && question.allowMultipleAnswers;
            if (!allowMultiple) {
              question.choices.forEach((c, cIdx) => c.isCorrect = idx === cIdx);
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
              const resizedBase64 = await resizeImage(file, 1400);
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
                const resizedBase64 = await resizeImage(file, 900);
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
// Answer options with a correct-answer marker (radio for one correct, checkbox for several)
function renderChoiceList(q, qIdx, multiple) {
  return `
    <div class="admin-choices-list" data-qidx="${qIdx}">
      ${(q.choices || []).map((choice, cIdx) => `
        <div class="admin-choice-item kind-${kindOfChoice(choice)}" data-cidx="${cIdx}">
            <input type="${multiple ? "checkbox" : "radio"}" name="correct_${qIdx}" ${choice.isCorrect ? "checked" : ""} data-cidx="${cIdx}"
              aria-label="${t("admin.markCorrect")}" title="${t("admin.markCorrect")}" />
            ${answerKindTriggerHtml(choice, qIdx, cIdx)}
            ${renderChoiceBody(choice, qIdx, cIdx)}
            <button class="admin-remove-choice-btn btn btn-danger btn-icon" aria-label="Remove Choice" data-cidx="${cIdx}">✕</button>
        </div>
      `).join("")}
    </div>
    <button class="admin-add-choice-btn btn" data-qidx="${qIdx}">+ ${t("admin.addChoice")}</button>
  `;
}

// The editable part of one answer slot, by kind
function renderChoiceBody(choice, qIdx, cIdx) {
  const kind = kindOfChoice(choice);
  if (kind === "write") {
    return `
      <input type="text" class="admin-choice-accepted" data-qidx="${qIdx}" data-cidx="${cIdx}"
        value="${escapeHtml((choice.accepted || []).join("; "))}" placeholder="${t("akind.writePlaceholder")}"
        aria-label="${t("admin.otherAnswersLabel")}" />
    `;
  }
  if (kind === "number") {
    return `
      <input type="number" step="any" class="admin-choice-number" data-qidx="${qIdx}" data-cidx="${cIdx}"
        value="${escapeHtml(String(choice.number ?? ""))}" placeholder="${t("akind.numberPlaceholder")}" aria-label="${t("akind.numberPlaceholder")}" />
      <input type="number" step="any" min="0" class="admin-choice-tolerance" data-qidx="${qIdx}" data-cidx="${cIdx}"
        value="${escapeHtml(String(choice.tolerance ?? ""))}" placeholder="± 0" title="${t("akind.tolerance")}" aria-label="${t("akind.tolerance")}" />
    `;
  }
  return `
    <rich-input class="admin-choice-text" data-qidx="${qIdx}" data-cidx="${cIdx}"
      value="${escapeHtml(choice.text || "")}" placeholder="${t("rich.choicePlaceholder")} ${String.fromCharCode(65 + cIdx)}"></rich-input>
    ${choice.image ? `
      <div style="position: relative; display: inline-block;">
        <img src="${choice.image.startsWith("data:") ? choice.image : "data:image/jpeg;base64," + choice.image}" style="max-height: 40px; border-radius: 4px;" />
        <button class="admin-choice-remove-image btn btn-danger" aria-label="Remove Image" data-cidx="${cIdx}" style="position: absolute; top: -5px; right: -5px; width: 14px; height: 14px; padding:0; min-width: 14px; font-size: 8px;">✕</button>
      </div>
    ` : `
      <button class="admin-choice-add-image btn btn-light btn-icon" data-cidx="${cIdx}" title="${t("admin.addImage")}" aria-label="${t("admin.addImage")}">\u{1F4F7}</button>
    `}
  `;
}

// Changes what one answer slot is (picked on the per-answer wheel)
function applyChoiceKind(qIdx, cIdx, kind) {
  if (!adminQuiz) return;
  saveStateForUndo();
  updateQuizFromDOM();
  const choice = adminQuiz.questions[qIdx]?.choices?.[cIdx];
  if (!choice) return;
  if (kind === "option") delete choice.kind;
  else choice.kind = kind;
  if (kind === "write" && !Array.isArray(choice.accepted)) {
    // Start from the option's text so nothing typed is lost
    const plain = plainPreview(choice.text);
    choice.accepted = plain ? [plain] : [];
  }
  renderAdminForm();
  adminQuestionsList.querySelector(`.answer-kind-trigger[data-qidx="${qIdx}"][data-cidx="${cIdx}"]`)?.focus();
}

// Shown in dialogs: the text without the \( \) formula markers
function plainPreview(text) {
  const plain = String(text || "").replace(/\\\(|\\\)|\\\[|\\\]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > 60 ? plain.slice(0, 57) + "…" : plain;
}

// Applies a kind picked on the type wheel, keeping whatever content still fits the new kind.
function applyQuestionKind(qIdx, kind) {
  if (!adminQuiz) return;
  saveStateForUndo();
  updateQuizFromDOM();
  const q = adminQuiz.questions[qIdx];
  if (!q) return;

  const ensureChoices = (count) => {
    if (!Array.isArray(q.choices)) q.choices = [];
    while (q.choices.length < count) {
      q.choices.push({ id: String.fromCharCode(97 + q.choices.length), text: "", isCorrect: false });
    }
  };
  // Single-answer kinds keep at most one marked option
  const keepOneCorrect = () => {
    let found = false;
    q.choices.forEach(c => {
      if (c.isCorrect && !found) found = true;
      else c.isCorrect = false;
    });
    if (!found && q.choices[0]) q.choices[0].isCorrect = true;
  };

  switch (kind) {
    case "single":
      q.type = "multiple-choice";
      q.allowMultipleAnswers = false;
      ensureChoices(2);
      keepOneCorrect();
      break;
    case "multi":
      q.type = "multiple-choice";
      q.allowMultipleAnswers = true;
      ensureChoices(2);
      if (!q.choices.some(c => c.isCorrect)) q.choices[0].isCorrect = true;
      break;
    case "numeric":
      q.type = "numeric";
      if (q.toleranceValue === undefined || isNaN(q.toleranceValue)) q.toleranceValue = 0;
      break;
    case "fill-blank":
      q.type = "fill-blank";
      q.blankAnswers = q.blankAnswers || [];
      break;
    case "true-false":
      q.type = "true-false";
      if (q.isTrue !== true && q.isTrue !== false) q.isTrue = true;
      break;
    default:
      q.type = kind; // "text", "image-upload"
  }
  renderAdminForm();
  adminQuestionsList.querySelector(`.qtype-trigger[data-qidx="${qIdx}"]`)?.focus();
}

function renderQuestionConfig(q, qIdx) {
  const type = q.type || "multiple-choice";
  switch (type) {
    case "multiple-choice":
      return renderChoiceList(q, qIdx, !!q.allowMultipleAnswers);
    case "numeric":
      return `
        <div style="display: flex; gap: 15px; align-items: flex-end;">
          <div style="flex: 2;">
            <label style="display: block; margin-bottom: 5px; font-size: 0.9rem;">${t("admin.numAnswer")}</label>
            <input type="number" class="admin-num-answer" data-qidx="${qIdx}" value="${escapeHtml(String(q.correctAnswerNumber ?? ""))}" />
          </div>
          <div style="flex: 1;">
            <label style="display: block; margin-bottom: 5px; font-size: 0.9rem;">${t("admin.numTolerance")}</label>
            <input type="number" class="admin-num-tolerance" data-qidx="${qIdx}" value="${escapeHtml(String(q.toleranceValue ?? 0))}" />
          </div>
          <div style="flex: 1;">
            <select class="admin-num-tolerance-type" data-qidx="${qIdx}">
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
          <button class="btn btn-secondary btn-icon admin-insert-blank-btn" aria-label="${t('admin.insertBlank')}" style="font-size: 0.8rem;">\u2795 ${t("admin.insertBlank")}</button>
          <span style="font-size: 0.8rem; color: #fbbf24;">\u{1F4A1} ${t("admin.blankHint")}</span>
        </div>
        <div class="admin-blanks-list" data-qidx="${qIdx}" style="display: flex; flex-direction: column; gap: 12px;">
          ${Array.from({ length: blankCount }).map((_, bIdx) => `
            <div class="admin-blank-row">
              <span class="admin-blank-label">Laukas ${bIdx + 1}:</span>
              <input type="text" class="admin-blank-answer" data-qidx="${qIdx}" data-bidx="${bIdx}" value="${escapeHtml(q.blankAnswers?.[bIdx] || "")}" />
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
          <input type="text" class="admin-text-keywords" data-qidx="${qIdx}" value="${escapeHtml((q.expectedKeywords || []).join(", "))}" />
          <button class="btn btn-sm btn-light" onclick="document.getElementById('shortcuts-panel').style.display='block'">View Shortcuts</button>
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
  if (adminQuizId && adminQuizIdContainer && adminQuizIdContainer.style.display !== 'none') {
      const newId = adminQuizId.value.trim();
      if (newId) {
          // Santize ID: allow alphanumeric, dashes, underscores
          adminQuiz.id = newId.replace(/[^a-zA-Z0-9_-]/g, '-');
      }
  }
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
    // Rich inputs already hold text with \( … \) formulas, the format the player renders
    q.prompt = promptArea.value.trim();
    if (!q.type) q.type = "multiple-choice";
    switch (q.type) {
      case "multiple-choice": {
        qDiv.querySelectorAll(".admin-choice-item[data-cidx]").forEach((row) => {
          const choice = q.choices?.[parseInt(row.dataset.cidx)];
          if (!choice) return;
          const kind = kindOfChoice(choice);
          if (kind === "write") {
            // Semicolons separate answers, so decimal commas like 0,5 stay intact
            const accepted = row.querySelector(".admin-choice-accepted")?.value || "";
            choice.accepted = accepted.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
          } else if (kind === "number") {
            choice.number = parseFloat(String(row.querySelector(".admin-choice-number")?.value ?? "").replace(",", "."));
            const tol = parseFloat(String(row.querySelector(".admin-choice-tolerance")?.value ?? "").replace(",", "."));
            choice.tolerance = isNaN(tol) ? 0 : Math.abs(tol);
          } else {
            const input = row.querySelector(".admin-choice-text");
            if (input) choice.text = input.value.trim();
          }
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
async function saveAdminQuiz() {
  if (!adminQuiz) return;
  updateQuizFromDOM();
  if (adminQuiz.questions.length === 0) {
    await alertDialog(t("admin.saveFailed"), t("admin.errorNoQuestions"));
    return;
  }
  if (!getToken()) {
    await alertDialog(t("admin.saveFailed"), t("admin.loginToSave"));
    document.dispatchEvent(new window.CustomEvent("open-auth"));
    return;
  }
  adminSaveBtn.disabled = true;
  const saveResult = await saveQuizToStorage(adminQuiz);
  adminSaveBtn.disabled = false;
  if (saveResult && !saveResult.success) {
      await alertDialog(t("admin.saveFailed"), saveResult.error || "");
      return;
  }
  // The draft stays as the working copy; it now matches the cloud
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  writeDraft(false, true);
  updateDraftStatusBadge("cloud");
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

  if (shareCode.length > 8e3) await alertDialog("⚠️", "Quiz data is very large. The share URL might not work in every browser.");
  const base = window.location.origin + "/";
  const shareUrl = `${base}?quiz=${shareCode}`;
  const dashUrl = `${base}?dashboard=${escapeHtml(adminQuiz.id)}`;
  
  let warningHtml = '';
  if (saveResult && saveResult.expires_at) {
      const expDate = new Date(saveResult.expires_at).toLocaleDateString('lt-LT');
      const bytes = saveResult.storage_bytes || 0;
      const kb = (bytes / 1024).toFixed(1);
      warningHtml = `
      <div class="admin-notice warning">
          <strong>⚠️ Nemokamas planas</strong>
          <span>Šis testas galios iki <strong>${expDate}</strong>. Dydis: <strong>${kb} KB</strong>. Norėdami išlaikyti testus visam laikui be limito, įsigykite Premium planą.</span>
      </div>`;
  }
  
  adminShareCode.style.display = "block";
  adminShareCode.innerHTML = `
        <div class="admin-notice success">
            <strong>\u2713 ${t("admin.saveSuccess") || "Išsaugota sėkmingai!"}</strong>
            <label class="admin-share-row">
                <span>Student URL:</span>
                <span class="admin-share-field">
                    <input type="text" readonly value="${escapeHtml(shareUrl)}" id="share-url-input" />
                    <button id="copy-share-btn" class="btn btn-secondary">${t("admin.copy")}</button>
                </span>
            </label>
            <label class="admin-share-row">
                <span>Dashboard URL:</span>
                <span class="admin-share-field">
                    <input type="text" readonly value="${escapeHtml(dashUrl)}" id="dash-url-input" />
                    <button id="copy-dash-btn" class="btn btn-secondary">${t("admin.copy")}</button>
                </span>
            </label>
            <div class="admin-share-row"><span>Quiz ID:</span><code>${escapeHtml(adminQuiz.id)}</code></div>
            ${warningHtml}
        </div>`;
  const wireCopy = (btnId, inputId, value) => {
    const btn = document.getElementById(btnId);
    btn?.addEventListener("click", async (e) => {
      e.preventDefault();
      document.getElementById(inputId).select();
      await navigator.clipboard.writeText(value);
      const label = btn.textContent;
      btn.textContent = "✓";
      setTimeout(() => { btn.textContent = label; }, 1200);
    });
  };
  wireCopy("copy-share-btn", "share-url-input", shareUrl);
  wireCopy("copy-dash-btn", "dash-url-input", dashUrl);
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


// "File" menu: Word printouts and JSON export/import in one place
function setupFileMenu() {
  const btn = document.getElementById("admin-file-btn");
  const menu = document.getElementById("admin-file-menu");
  if (!btn || !menu) return;
  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector("button")?.focus();
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(menu.hidden);
  });
  menu.addEventListener("click", () => setOpen(false));
  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll("button")];
    const idx = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
  });
  document.addEventListener("mousedown", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });

  // Print preview: layout changes (order, image sizes, page breaks…) are saved with the quiz
  const printBtn = document.getElementById("admin-docx-btn");
  if (printBtn) {
    printBtn.title = t("admin.printPreview").replace(/…$/, "");
    printBtn.setAttribute("aria-label", printBtn.title);
  }
  printBtn?.addEventListener("click", () => {
    if (!adminQuiz) return;
    updateQuizFromDOM();
    openPrintPreview(adminQuiz, {
      onLayoutChange: (layout) => {
        if (!adminQuiz) return;
        adminQuiz.printLayout = layout;
        triggerAutoSave();
      },
      onExport: async (quizToPrint, options) => {
        try {
          await exportQuizToDocx(quizToPrint, options);
        } catch (err) {
          console.error("Word export failed", err);
          await alertDialog(t("docx.exportFailed"), err.message || "");
        }
      }
    });
  });
}

function setupAdminEventsInternal() {
  adminToggle.addEventListener("click", toggleAdminMode);
  adminAddQuestionBtn.addEventListener("click", () => {
    if (!adminQuiz) adminQuiz = { id: generateQuizId(), title: "New Quiz", questions: [] };
    updateQuizFromDOM();
    // Unique ID: answers are keyed by question ID, so "q<n>" could collide after a deletion
    adminQuiz.questions.push({
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: "multiple-choice",
      prompt: "",
      choices: [{ id: "a", text: "", isCorrect: true }, { id: "b", text: "", isCorrect: false }]
    });
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
        alertDialog(t("admin.importError"), t("admin.importInvalid"));
      }
    };
    reader.readAsText(file);
  });
  setupFileMenu();

  // Start a fresh quiz (the draft is always saved, so closing the editor loses nothing)
  adminNewQuizBtn.addEventListener("click", async () => {
    updateQuizFromDOM();
    if (!(await confirmReplaceDraft(null))) return;
    adminQuiz = blankQuiz();
    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();
    adminShareCode.style.display = "none";
    writeDraft(false, false);
    updateDraftStatusBadge("saved");
    renderAdminForm();
    if (adminLocalSelector) {
      adminLocalSelector.value = "";
      toggleLocalDeleteButtonVisibility();
    }
    adminQuizTitle.focus();
    adminQuizTitle.select();
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

  // Global keyboard listener for shortcuts (Z / Y)
  window.addEventListener("keydown", handleEditorKeyboardShortcuts);

  // Event Delegation with Capture Phase on the admin panel to checkpoint state immediately before modifications
  if (adminPanel) {
    adminPanel.addEventListener("focusin", (e) => {
      const target = e.target;
      if (target && target.matches("input, textarea, select, math-field, .rich-input-editor")) {
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
        id === "admin-file-btn" ||
        id === "admin-docx-btn" ||
        id === "admin-new-quiz" ||
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
    if (target && target.closest("#admin-panel") && !target.closest(".admin-sidebar-column") && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "MATH-FIELD")) {
      lastActiveInputField = target;
    }
    
    // Toggle Shortcuts Panel
    const shortcutsPanel = document.getElementById("math-shortcuts-panel");
    if (shortcutsPanel) {
      if (document.activeElement && document.activeElement.tagName === "MATH-FIELD") {
        shortcutsPanel.style.display = "block";
        // Position it above the virtual keyboard if possible
        if (window.mathVirtualKeyboard && window.mathVirtualKeyboard.boundingRect) {
            shortcutsPanel.style.bottom = (window.mathVirtualKeyboard.boundingRect.height + 20) + "px";
        } else {
            shortcutsPanel.style.bottom = "320px"; // safe default fallback
        }
      } else {
        shortcutsPanel.style.display = "none";
      }
    }
  };
  document.addEventListener("focusin", trackActiveField);
  document.addEventListener("click", trackActiveField);
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
        canvas.width = Math.round(w);
        canvas.height = Math.round(h);
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        // Images are printed too, so keep them sharp. Transparent images (diagrams) stay PNG,
        // since JPEG would turn the transparency black; otherwise use whichever format is smaller
        // (PNG wins for screenshots and line drawings, JPEG for photos).
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let transparent = false;
        for (let i = 3; i < pixels.length; i += 4 * 7) { if (pixels[i] < 250) { transparent = true; break; } }
        const png = canvas.toDataURL("image/png");
        if (transparent) { resolve(png); return; }
        const jpeg = canvas.toDataURL("image/jpeg", 0.85);
        resolve(png.length < jpeg.length ? png : jpeg);
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
    const hasTypedSlot = choices.some(c => kindOfChoice(c) !== "option");
    // A lone write-in/number slot is a valid question; plain options need at least two
    if (choices.length < (hasTypedSlot ? 1 : 2)) {
      errors.push("min_choices");
    }
    let correctCount = 0;
    choices.forEach(c => {
      const kind = kindOfChoice(c);
      if (kind === "option" && (!c.text || !c.text.trim()) && !c.image) errors.push("empty_choice_text");
      // A typed slot marked correct needs something to compare the student's answer with
      if (c.isCorrect && kind === "write" && !(c.accepted || []).length) errors.push("no_accepted_answers");
      if (c.isCorrect && kind === "number" && (c.number === undefined || c.number === null || isNaN(c.number))) errors.push("invalid_numeric");
      if (c.isCorrect) correctCount++;
    });
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


function getShortTypeLabel(q) {
  return getKind(kindOfQuestion(q)).short;
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
}

function triggerAutoSave() {
  if (!adminQuiz) return;
  
  updateDraftStatusBadge("saving");
  
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  
  autoSaveTimer = setTimeout(autosaveNow, 600);
}

// Writes the draft; it only becomes "unsaved" when the content actually changed
function autosaveNow() {
  autoSaveTimer = null;
  const prev = readDraft();
  const changed = !prev || JSON.stringify(prev.quiz) !== JSON.stringify(adminQuiz);
  writeDraft(!!prev?.dirty || changed);
  updateDraftStatusBadge(draftBadgeStatus());
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
  } else if (status === "saved" || status === "cloud") {
    adminDraftStatus.style.background = "rgba(16, 185, 129, 0.15)";
    adminDraftStatus.style.borderColor = "rgba(16, 185, 129, 0.3)";
    adminDraftStatus.style.color = "#10b981";
    // "saved": kept on this device, not yet saved to the cloud; "cloud": matches the saved quiz
    if (textSpan) textSpan.textContent = status === "cloud" ? t("admin.savedToCloud") : t("admin.draftSaved");
    if (dotSpan) {
      dotSpan.style.background = "#10b981";
      dotSpan.style.boxShadow = "0 0 8px #10b981";
    }
  }
}

async function populateLocalSelector() {
  if (!adminLocalSelector) return;
  
  adminLocalSelector.innerHTML = "";
  
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = t("admin.loadSavedQuiz") || "-- Load Saved Quiz --";
  adminLocalSelector.appendChild(defaultOpt);
  
  try {
      // Teachers can only edit their own quizzes, so list those (not every public quiz); admins can edit all
      if (getToken()) {
          const { user, quizzes: ownQuizzes, limits } = await fetchProfile();
          privateExpiryDays = limits.private_expiry_days;
          updateVisibilityLabels();
          const quizzes = user.role === "admin" ? await fetchCloudQuizzes() : ownQuizzes;
          quizzes.forEach(q => {
              const opt = document.createElement("option");
              opt.value = q.id;
              const displayTitle = q.title.length > 32 ? q.title.substring(0, 29) + "…" : q.title;
              opt.textContent = `${displayTitle} · ${q.visibility === "public" ? t("profile.public") : t("profile.private")}`;
              adminLocalSelector.appendChild(opt);
          });
      }
  } catch (err) {
      console.error("Failed to load quizzes for dropdown", err);
  }
  
  // A new (unsaved) quiz has no entry; fall back to the placeholder instead of a blank select
  adminLocalSelector.value = adminQuiz?.id || "";
  if (adminLocalSelector.selectedIndex === -1) adminLocalSelector.value = "";

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

async function handleLocalSelectorChange() {
  if (!adminLocalSelector) return;
  const selectedId = adminLocalSelector.value;
  if (!selectedId) {
    toggleLocalDeleteButtonVisibility();
    return;
  }
  
  if (selectedId === adminQuiz?.id) return;
  if (!(await confirmReplaceDraft(selectedId))) {
    adminLocalSelector.value = adminQuiz?.id || "";
    if (adminLocalSelector.selectedIndex === -1) adminLocalSelector.value = "";
    toggleLocalDeleteButtonVisibility();
    return;
  }
  await loadIntoEditor(selectedId);
}

async function handleLocalDeleteClick() {
  if (!adminLocalSelector) return;
  const selectedId = adminLocalSelector.value;
  if (!selectedId) return;
  
  const selectedTitle = adminLocalSelector.selectedOptions[0]?.textContent || "";
  const ok = await confirmDialog({
    title: t("admin.deleteTitle"),
    message: `„${selectedTitle}“ — ${t("admin.deleteConfirm")}`,
    confirmText: t("dialog.delete"),
    danger: true
  });
  if (!ok) return;

  const result = await deleteQuizFromCloud(selectedId);
  if (!result.success) {
    await alertDialog(t("admin.saveFailed"), result.error);
    return;
  }
  
  // Also clean local if it happens to be there
  localStorage.removeItem("quiz_" + selectedId);
  localStorage.removeItem("quiz-images_" + selectedId);
  
  if (adminQuiz && adminQuiz.id === selectedId) {
    adminQuiz = blankQuiz();
    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    writeDraft(false, false);
    updateDraftStatusBadge("saved");
    renderAdminForm();
  }
  
  await populateLocalSelector();
}
export {
  openEditor,
  previewQuiz,
  refreshAdminToggleVisibility,
  refreshAdminUI,
  renderAdminForm,
  saveAdminQuiz,
  setupAdmin,
  toggleAdminMode
};
