(function () {
  'use strict';

  const QUILL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg>`;
  const QUILL_PURPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg>`;
  const GEAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`;

  const i18n = (key) => chrome.i18n.getMessage(key) || key;

  let currentBtn = null;
  let currentPanel = null;
  let activeElement = null;
  let originalText = '';
  let hideTimeout = null;
  let isPolishing = false;
  let btnEventsAttached = false;
  let panelEventsAttached = false;
  let siteSkipped = false;

  // ---- Helpers ----

  function isEditableElement(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const type = (el.type || '').toLowerCase();
      return ['text', 'search', 'url', 'email', ''].includes(type);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function getTextFromElement(el) {
    if (el.isContentEditable) return el.innerText;
    return el.value || '';
  }

  function getSelectionFromElement(el) {
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        const text = sel.toString();
        if (text) return text;
      }
      return '';
    }
    if (typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
      if (el.selectionStart !== el.selectionEnd) {
        return (el.value || '').substring(el.selectionStart, el.selectionEnd);
      }
    }
    return '';
  }

  function replaceSelectionInElement(el, newText) {
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(newText));
        // Collapse cursor to end
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const val = el.value || '';
      const result = val.substring(0, start) + newText + val.substring(end);
      const nativeSetter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(el), 'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(el, result);
      } else {
        el.value = result;
      }
      // Place cursor after the replacement
      el.selectionStart = el.selectionEnd = start + newText.length;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function setTextToElement(el, text, { dispatchChange = true } = {}) {
    if (el.isContentEditable) {
      el.innerText = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (dispatchChange) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(el), 'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(el, text);
      } else {
        el.value = text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (dispatchChange) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  // ---- Typing Cursor ----

  const CURSOR_SIZE = 12;
  const MIRROR_STYLES = [
    'boxSizing', 'width',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontSize', 'fontFamily',
    'lineHeight', 'letterSpacing', 'wordSpacing', 'textTransform', 'tabSize'
  ];

  let typingCursorEl = null;
  let mirrorEl = null;
  let mirrorMarker = null;

  function ensureTypingCursor() {
    if (!typingCursorEl) {
      typingCursorEl = document.createElement('div');
      typingCursorEl.className = 'aip-typing-cursor';
      document.body.appendChild(typingCursorEl);
    }
    return typingCursorEl;
  }

  function hideTypingCursor() {
    if (typingCursorEl) typingCursorEl.style.display = 'none';
    if (mirrorEl) {
      mirrorEl.remove();
      mirrorEl = null;
      mirrorMarker = null;
    }
  }

  function ensureMirror(el) {
    if (mirrorEl) return;
    mirrorEl = document.createElement('div');
    const cs = getComputedStyle(el);
    for (const prop of MIRROR_STYLES) {
      mirrorEl.style[prop] = cs[prop];
    }
    mirrorEl.style.position = 'fixed';
    mirrorEl.style.top = '0';
    mirrorEl.style.left = '0';
    mirrorEl.style.visibility = 'hidden';
    mirrorEl.style.height = 'auto';
    mirrorEl.style.overflow = 'hidden';
    mirrorEl.style.pointerEvents = 'none';
    if (el.tagName === 'TEXTAREA') {
      mirrorEl.style.whiteSpace = 'pre-wrap';
      mirrorEl.style.wordWrap = 'break-word';
    } else {
      mirrorEl.style.whiteSpace = 'pre';
    }
    mirrorMarker = document.createElement('span');
    mirrorEl.appendChild(mirrorMarker);
    document.body.appendChild(mirrorEl);
  }

  function updateCursorPosition(el, text) {
    const cursor = ensureTypingCursor();
    let top, left;

    if (el.isContentEditable) {
      const pos = getContentEditableCaretPos(el);
      top = pos.top + window.scrollY + (pos.height - CURSOR_SIZE) / 2;
      left = pos.left + window.scrollX + 2;
    } else {
      ensureMirror(el);
      // Update mirror text content (keep marker at end)
      while (mirrorEl.firstChild !== mirrorMarker) {
        mirrorEl.removeChild(mirrorEl.firstChild);
      }
      if (text) {
        mirrorEl.insertBefore(document.createTextNode(text), mirrorMarker);
      }
      mirrorMarker.textContent = '\u200b';

      const elRect = el.getBoundingClientRect();
      const mirrorRect = mirrorEl.getBoundingClientRect();
      const markerRect = mirrorMarker.getBoundingClientRect();

      top = elRect.top + window.scrollY + (markerRect.top - mirrorRect.top) - el.scrollTop;
      left = elRect.left + window.scrollX + (markerRect.left - mirrorRect.left) - el.scrollLeft;

      // Vertically center with line
      top += (markerRect.height - CURSOR_SIZE) / 2;
      left += 2;

      // Clamp within element bounds
      const elRight = elRect.right + window.scrollX;
      const elBottom = elRect.bottom + window.scrollY;
      const elLeft = elRect.left + window.scrollX;
      const elTop = elRect.top + window.scrollY;
      if (left + CURSOR_SIZE > elRight) left = elRight - CURSOR_SIZE;
      if (top + CURSOR_SIZE > elBottom) top = elBottom - CURSOR_SIZE;
      if (left < elLeft) left = elLeft;
      if (top < elTop) top = elTop;
    }

    cursor.style.top = top + 'px';
    cursor.style.left = left + 'px';
    cursor.style.display = 'block';
  }

  function getContentEditableCaretPos(el) {
    const node = el.lastChild;
    if (!node) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        top: r.top + (parseFloat(cs.paddingTop) || 0),
        left: r.left + (parseFloat(cs.paddingLeft) || 0),
        height: parseFloat(cs.fontSize) * 1.2 || 16
      };
    }
    const range = document.createRange();
    if (node.nodeType === Node.TEXT_NODE) {
      range.setStart(node, node.textContent.length);
    } else {
      range.setStartAfter(node);
    }
    range.collapse(true);
    const rects = range.getClientRects();
    if (rects.length) {
      return { top: rects[0].top, left: rects[0].right, height: rects[0].height };
    }
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, height: 16 };
  }

  // ---- UI Creation ----

  function createButton() {
    const btn = document.createElement('button');
    btn.className = 'aip-btn';
    btn.innerHTML = QUILL_SVG;
    btn.title = 'AI Polish';
    document.body.appendChild(btn);
    return btn;
  }

  function createPanel() {
    const panel = document.createElement('div');
    panel.className = 'aip-panel';
    panel.innerHTML = `
      <div class="aip-panel-header">
        <div class="aip-panel-label">${i18n('panelTargetLang')}</div>
        <button class="aip-panel-gear" title="${i18n('popupSettings')}">${GEAR_SVG}</button>
      </div>
      <select class="aip-lang-select">
        <option value="auto">${i18n('panelLangAuto')}</option>
        <option value="中文">中文</option>
        <option value="English">English</option>
        <option value="日本語">日本語</option>
      </select>
      <label class="aip-chat-toggle">
        <input type="checkbox" class="aip-chat-checkbox">
        <span>${i18n('panelChatMode')}</span>
      </label>
      <button class="aip-polish-btn">
        ${QUILL_PURPLE_SVG}
        <span>${i18n('panelPolish')}</span>
      </button>
      <div class="aip-status" style="display:none"></div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('.aip-polish-btn').addEventListener('click', onPolishClick);
    panel.querySelector('.aip-panel-gear').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openOptions' });
    });
    return panel;
  }

  // ---- Positioning ----

  function positionButton(el) {
    const rect = el.getBoundingClientRect();
    const btn = currentBtn;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    btn.style.top = (rect.bottom + scrollY - 30) + 'px';
    btn.style.left = (rect.right + scrollX - 30) + 'px';
  }

  function positionPanel() {
    if (!currentBtn || !currentPanel) return;
    const btnRect = currentBtn.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const panelWidth = 220;
    const gap = 6;

    // Measure panel height (briefly make visible off-screen if needed)
    currentPanel.style.visibility = 'hidden';
    currentPanel.style.display = 'block';
    const panelHeight = currentPanel.offsetHeight;
    currentPanel.style.visibility = '';
    currentPanel.style.display = '';

    let left = btnRect.right + scrollX - panelWidth;
    let top;
    let above = false;

    const spaceBelow = window.innerHeight - btnRect.bottom;
    const spaceAbove = btnRect.top;

    if (spaceBelow >= panelHeight + gap) {
      top = btnRect.bottom + scrollY + gap;
    } else if (spaceAbove >= panelHeight + gap) {
      top = btnRect.top + scrollY - panelHeight - gap;
      above = true;
    } else {
      if (spaceBelow >= spaceAbove) {
        top = btnRect.bottom + scrollY + gap;
      } else {
        top = btnRect.top + scrollY - panelHeight - gap;
        above = true;
      }
    }

    currentPanel.classList.toggle('aip-above', above);

    if (left < 8) left = 8;
    if (left + panelWidth > window.innerWidth + scrollX) {
      left = window.innerWidth + scrollX - panelWidth - 8;
    }

    currentPanel.style.top = top + 'px';
    currentPanel.style.left = left + 'px';
  }

  // ---- Show / Hide ----

  function showButton(el) {
    if (siteSkipped) return;
    if (activeElement === el && currentBtn) {
      positionButton(el);
      return;
    }

    hideAll();
    activeElement = el;

    if (!currentBtn) {
      currentBtn = createButton();
      attachBtnEvents();
    }
    if (!currentPanel) {
      currentPanel = createPanel();
      attachPanelEvents();
    }

    positionButton(el);
    currentBtn.style.display = 'flex';
  }

  function scheduleHide() {
    cancelHide();
    hideTimeout = setTimeout(() => {
      if (currentPanel) currentPanel.classList.remove('aip-visible');
    }, 250);
  }

  function cancelHide() {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  }

  function hideAll() {
    // Don't hide while polishing — protect element reference
    if (isPolishing) return;
    if (currentBtn) currentBtn.style.display = 'none';
    if (currentPanel) currentPanel.classList.remove('aip-visible');
    activeElement = null;
  }

  // ---- Events ----

  function attachBtnEvents() {
    if (btnEventsAttached || !currentBtn) return;
    btnEventsAttached = true;

    currentBtn.addEventListener('mouseenter', () => {
      cancelHide();
      if (currentPanel) {
        updatePolishBtnForSelection();
        positionPanel();
        currentPanel.classList.add('aip-visible');
      }
    });

    currentBtn.addEventListener('mouseleave', () => {
      scheduleHide();
    });
  }

  function attachPanelEvents() {
    if (panelEventsAttached || !currentPanel) return;
    panelEventsAttached = true;

    currentPanel.addEventListener('mouseenter', () => {
      cancelHide();
    });

    currentPanel.addEventListener('mouseleave', () => {
      scheduleHide();
    });
  }

  // ---- Polish (port-based streaming) ----

  let selectionMode = false;
  let selectionStart = 0;
  let selectionEnd = 0;

  function updatePolishBtnForSelection() {
    if (!currentPanel || !activeElement || isPolishing) return;
    const selectedText = getSelectionFromElement(activeElement);
    selectionMode = !!selectedText;
    const btn = currentPanel.querySelector('.aip-polish-btn');
    const label = selectionMode ? i18n('panelPolishSelection') : i18n('panelPolish');
    btn.innerHTML = `${QUILL_PURPLE_SVG}<span>${label}</span>`;

    if (selectionMode && !activeElement.isContentEditable) {
      selectionStart = activeElement.selectionStart;
      selectionEnd = activeElement.selectionEnd;
    }
  }

  function onPolishClick() {
    if (isPolishing || !activeElement) return;

    const selectedText = selectionMode ? getSelectionFromElement(activeElement) : '';
    const text = (selectionMode && selectedText) ? selectedText.trim() : getTextFromElement(activeElement).trim();
    if (!text) {
      showStatus(i18n('panelNoText'), false);
      return;
    }

    const lang = currentPanel.querySelector('.aip-lang-select').value;
    const chatMode = currentPanel.querySelector('.aip-chat-checkbox')?.checked || false;
    originalText = getTextFromElement(activeElement);
    const isSelection = selectionMode && !!selectedText;
    // Snapshot selection range for input/textarea
    const snapSelStart = selectionStart;
    const snapSelEnd = selectionEnd;
    isPolishing = true;
    updatePolishBtn(true);
    clearStatus();

    // Save a direct reference so focusout can't clear it
    const targetEl = activeElement;
    let streamedText = '';
    let streamDone = false;

    const port = chrome.runtime.connect({ name: 'polish-stream' });

    // ---- Typewriter queue ----
    let displayedLen = 0;
    let typingTimer = null;

    function applyStreamText(displayText, isFinal) {
      if (isSelection) {
        // Replace the selected region within the full text
        const prefix = originalText.substring(0, snapSelStart);
        const suffix = originalText.substring(snapSelEnd);
        const full = prefix + displayText + suffix;
        if (targetEl.isContentEditable) {
          targetEl.innerText = full;
          targetEl.dispatchEvent(new Event('input', { bubbles: true }));
          if (isFinal) targetEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(targetEl), 'value'
          )?.set;
          if (nativeSetter) nativeSetter.call(targetEl, full);
          else targetEl.value = full;
          targetEl.dispatchEvent(new Event('input', { bubbles: true }));
          if (isFinal) targetEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        setTextToElement(targetEl, displayText, { dispatchChange: isFinal });
      }
    }

    function typingTick() {
      if (displayedLen >= streamedText.length) {
        if (streamDone) {
          stopTyping();
          hideTypingCursor();
          isPolishing = false;
          updatePolishBtn(false);
          const final = streamedText.trim();
          if (final) {
            applyStreamText(final, true);
          }
          showStatus('', true);
          port.disconnect();
        }
        return;
      }
      const buffered = streamedText.length - displayedLen;
      const chars = Math.max(1, Math.ceil(buffered / 20));
      displayedLen = Math.min(displayedLen + chars, streamedText.length);
      const displayText = streamedText.substring(0, displayedLen);
      applyStreamText(displayText, false);
      if (isSelection) {
        // For cursor positioning in selection mode, show cursor relative to full text
        const prefix = originalText.substring(0, snapSelStart);
        updateCursorPosition(targetEl, prefix + displayText);
      } else {
        updateCursorPosition(targetEl, displayText);
      }
    }

    function startTyping() {
      if (typingTimer) return;
      typingTimer = setInterval(typingTick, 16);
    }

    function stopTyping() {
      if (typingTimer) {
        clearInterval(typingTimer);
        typingTimer = null;
      }
    }

    port.onMessage.addListener((msg) => {
      if (msg.action === 'start') {
        streamedText = '';
        displayedLen = 0;
        streamDone = false;
        applyStreamText('', false);
        if (isSelection) {
          updateCursorPosition(targetEl, originalText.substring(0, snapSelStart));
        } else {
          updateCursorPosition(targetEl, '');
        }
      } else if (msg.action === 'chunk') {
        streamedText += msg.text;
        startTyping();
      } else if (msg.action === 'done') {
        streamDone = true;
        if (!typingTimer) {
          hideTypingCursor();
          isPolishing = false;
          updatePolishBtn(false);
          showStatus('', true);
          port.disconnect();
        }
      } else if (msg.action === 'error') {
        stopTyping();
        hideTypingCursor();
        isPolishing = false;
        updatePolishBtn(false);
        if (!streamedText && originalText) {
          setTextToElement(targetEl, originalText);
        }
        showStatus(msg.error, false);
        port.disconnect();
      }
    });

    port.onDisconnect.addListener(() => {
      if (isPolishing) {
        stopTyping();
        hideTypingCursor();
        isPolishing = false;
        updatePolishBtn(false);
        if (!streamedText && originalText) {
          setTextToElement(targetEl, originalText);
        }
      }
    });

    port.postMessage({
      action: 'polish',
      text: text,
      targetLanguage: lang,
      chatMode: chatMode
    });
  }

  function updatePolishBtn(loading) {
    if (!currentPanel) return;
    const btn = currentPanel.querySelector('.aip-polish-btn');
    if (loading) {
      btn.disabled = true;
      btn.innerHTML = `<div class="aip-spinner"></div><span>${i18n('panelPolishing')}</span>`;
    } else {
      btn.disabled = false;
      btn.innerHTML = `${QUILL_PURPLE_SVG}<span>${i18n('panelPolish')}</span>`;
    }
  }

  function showStatus(msg, success) {
    if (!currentPanel) return;
    const status = currentPanel.querySelector('.aip-status');
    status.style.display = 'block';
    status.className = 'aip-status' + (success ? ' aip-success' : '');

    if (success) {
      status.innerHTML = '';
      const undoBar = document.createElement('div');
      undoBar.className = 'aip-undo-bar';
      undoBar.innerHTML = `<span>${i18n('panelPolished')}</span><button class="aip-undo-btn">${i18n('panelUndo')}</button>`;
      undoBar.querySelector('.aip-undo-btn').addEventListener('click', () => {
        if (activeElement && originalText) {
          setTextToElement(activeElement, originalText);
          status.style.display = 'none';
        }
      });
      status.appendChild(undoBar);
    } else {
      status.textContent = msg;
    }
  }

  function clearStatus() {
    if (!currentPanel) return;
    const status = currentPanel.querySelector('.aip-status');
    status.style.display = 'none';
    status.textContent = '';
  }

  // ---- Focus / blur tracking ----

  document.addEventListener('focusin', (e) => {
    // composedPath() traverses shadow DOM boundaries to find the actual editable element
    const target = e.composedPath().find(
      el => el instanceof Element && isEditableElement(el)
    );
    if (target) {
      showButton(target);
    }
  }, true);

  document.addEventListener('focusout', (e) => {
    setTimeout(() => {
      // Never hide while polishing
      if (isPolishing) return;
      const active = document.activeElement;
      if (
        active !== activeElement &&
        !currentBtn?.contains(active) &&
        !currentPanel?.contains(active)
      ) {
        if (!currentPanel?.matches(':hover') && !currentBtn?.matches(':hover')) {
          hideAll();
        }
      }
    }, 150);
  }, true);

  // Reposition on scroll / resize
  const reposition = () => {
    if (activeElement && currentBtn) {
      positionButton(activeElement);
      if (currentPanel?.classList.contains('aip-visible')) {
        positionPanel();
      }
    }
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);

  // ---- Skip sites: check on load and react to changes ----

  const currentHost = location.hostname;

  chrome.storage.sync.get({ skipSites: [] }, (data) => {
    if (data.skipSites.includes(currentHost)) {
      siteSkipped = true;
      hideAll();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.skipSites) return;
    const newList = changes.skipSites.newValue || [];
    const wasSkipped = siteSkipped;
    siteSkipped = newList.includes(currentHost);
    if (siteSkipped && !wasSkipped) {
      hideAll();
    }
  });

})();
