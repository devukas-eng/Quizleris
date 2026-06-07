export function captureFocusAndScroll() {
  const active = document.activeElement;
  const state = {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    focusedSelector: null,
    selectionStart: null,
    selectionEnd: null,
  };

  if (active && active.closest("#admin-panel")) {
    let selector;
    if (active.id) {
      selector = `#${active.id}`;
    } else {
      const tagName = active.tagName.toLowerCase();
      let classPart = "";
      if (active.className) {
        const classes = Array.from(active.classList).filter(c => c !== "active");
        if (classes.length > 0) {
          classPart = `.${classes.join(".")}`;
        }
      }
      
      let attrPart = "";
      if (active.dataset.qidx !== undefined) {
        attrPart += `[data-qidx="${active.dataset.qidx}"]`;
      }
      if (active.dataset.cidx !== undefined) {
        attrPart += `[data-cidx="${active.dataset.cidx}"]`;
      }
      if (active.dataset.bidx !== undefined) {
        attrPart += `[data-bidx="${active.dataset.bidx}"]`;
      }
      selector = `${tagName}${classPart}${attrPart}`;
    }

    state.focusedSelector = selector;
    if (typeof active.selectionStart === "number") {
      state.selectionStart = active.selectionStart;
      state.selectionEnd = active.selectionEnd;
    }
  }
  return state;
}

export function restoreFocusAndScroll(state) {
  if (!state) return;
  
  window.scrollTo(state.scrollX, state.scrollY);

  if (state.focusedSelector) {
    try {
      const el = document.querySelector(state.focusedSelector);
      if (el) {
        el.focus();
        if (typeof state.selectionStart === "number" && typeof el.selectionStart === "number") {
          el.setSelectionRange(state.selectionStart, state.selectionEnd);
        }
      }
    } catch (e) {
      console.warn("Failed to restore focus:", e);
    }
  }
}

export function findSmartCursorOffset(text) {
  const idx = text.indexOf('{');
  if (idx !== -1) return idx + 1;
  const idx2 = text.indexOf('[');
  if (idx2 !== -1) return idx2 + 1;
  const idx3 = text.indexOf('(');
  if (idx3 !== -1) return idx3 + 1;
  return text.length;
}

export function insertTextAtCursor(element, text, autoWrapMath = false) {
  if (!element) return;

  // MathLive support
  if (element.tagName === "MATH-FIELD" || element.tagName === "MATH-FIELD") {
    element.executeCommand(["insert", text]);
    element.focus();
    return;
  }
  
  let finalText = text;
  if (autoWrapMath) {
    const beforeCursor = element.value.substring(0, element.selectionStart);
    const inlineOpen = (beforeCursor.match(/\\\(/g) || []).length;
    const inlineClose = (beforeCursor.match(/\\\)/g) || []).length;
    const displayOpen = (beforeCursor.match(/\\\[/g) || []).length;
    const displayClose = (beforeCursor.match(/\\\]/g) || []).length;
    const isInsideMath = (inlineOpen > inlineClose) || (displayOpen > displayClose);
    
    if (!isInsideMath) {
      finalText = `\\(${text}\\)`;
    }
  }

  element.focus();
  const start = element.selectionStart;

  // Use document.execCommand for proper Undo/Redo stack preservation
  const success = document.execCommand("insertText", false, finalText);
  
  // Fallback if execCommand fails (though it shouldn't in modern browsers for textareas)
  if (!success) {
    const value = element.value;
    const end = element.selectionEnd;
    const before = value.substring(0, start);
    const after = value.substring(end);
    element.value = before + finalText + after;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const smartOffset = findSmartCursorOffset(finalText);
  element.setSelectionRange(start + smartOffset, start + smartOffset);
}

export function wrapSelectedInMathMode(element, isDisplay = false) {
  if (!element) return;
  const start = element.selectionStart;
  const end = element.selectionEnd;
  const value = element.value;
  const selected = value.substring(start, end);

  const left = isDisplay ? "\\[ " : "\\(";
  const right = isDisplay ? " \\]" : "\\)";

  const wrapped = left + selected + right;
  const before = value.substring(0, start);
  const after = value.substring(end);
  element.value = before + wrapped + after;

  element.dispatchEvent(new Event("input", { bubbles: true }));

  element.focus();
  if (selected) {
    element.setSelectionRange(start + left.length, start + left.length + selected.length);
  } else {
    element.setSelectionRange(start + left.length, start + left.length);
  }
}
