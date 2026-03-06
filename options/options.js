const i18n = (key) => chrome.i18n.getMessage(key) || key;

const DEFAULT_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const DEFAULT_PROMPT = `You are a professional text polishing assistant. Your task is to improve the given text while preserving its original meaning and tone.

Rules:
1. Fix grammar, spelling, and punctuation errors
2. Improve clarity and readability
3. Maintain the original tone and style
4. Keep the same language as the input unless a target language is specified
5. If a target language is specified, translate and polish into that language
6. Only output the polished text, no explanations or additional content

Target language: {{targetLanguage}}

Text to polish:
{{text}}`;

const PRESET_MODELS = [
  'google/gemini-3-flash-preview',
  'google/gemini-3.1-pro-preview',
  'qwen/qwen3.5-122b-a10b',
  'openai/gpt-5.2',
  'anthropic/claude-opus-4.6',
  'anthropic/claude-sonnet-4.6'
];

const $apiUrl = document.getElementById('apiUrl');
const $apiKey = document.getElementById('apiKey');
const $prompt = document.getElementById('prompt');
const $skipSitesText = document.getElementById('skipSitesText');
const $modelList = document.getElementById('modelList');

// State: each model entry has { id, context_length?, prompt_cost?, completion_cost?, org_icon? }
// org_icon stores the org slug (e.g. "google"); actual data URLs are in iconCache
let models = [];
let selectedModelId = '';
let addRowActive = false;
let dragSrcIndex = null;
let iconCache = {}; // orgSlug -> dataUrl, loaded from chrome.storage.local

// ---- i18n: Apply labels ----

document.title = i18n('optTitle');
document.getElementById('headerTitle').textContent = i18n('optTitle');
document.getElementById('cardApiConfig').textContent = i18n('optApiConfig');
document.getElementById('labelApiUrl').textContent = i18n('optApiUrl');
document.getElementById('hintApiUrl').textContent = i18n('optApiUrlHint');
document.querySelector('#labelApiKey span').textContent = i18n('optApiKey');
document.getElementById('signupLink').textContent = i18n('optSignup');
document.getElementById('testApi').textContent = i18n('optTestApi');
document.getElementById('labelModel').textContent = i18n('optModel');
document.getElementById('addModelBtn').textContent = i18n('optModelAdd');
document.getElementById('deleteModelBtn').textContent = i18n('optModelDelete');
document.getElementById('fetchModelInfo').textContent = i18n('optModelInfoFetch');
document.getElementById('clearModelInfo').textContent = i18n('optModelClearInfo');
document.getElementById('bulkEditBtn').textContent = i18n('optModelBulkEdit');
document.getElementById('hintBulkEdit').textContent = i18n('optModelBulkEditHint');
document.getElementById('bulkEditCancel').textContent = i18n('optCancel');
document.getElementById('cardPrompt').textContent = i18n('optPromptTemplate');
document.getElementById('labelPrompt').textContent = i18n('optSystemPrompt');
document.getElementById('hintPrompt').textContent = i18n('optPromptHint');
document.getElementById('resetPrompt').textContent = i18n('optResetPrompt');
document.getElementById('cardSkipSites').textContent = i18n('optSkipSites');
document.getElementById('hintSkipSites').textContent = i18n('optSkipSitesHint');
document.getElementById('save').textContent = i18n('optSave');
document.getElementById('headerSave').textContent = i18n('optSave');

// ---- Persist models to storage ----

function persistModels() {
  chrome.storage.sync.set({ models, model: selectedModelId });
}

// ---- Model list rendering ----

function renderModelList() {
  document.getElementById('selectedModelDisplay').textContent =
    selectedModelId ? i18n('optModelSelected') + selectedModelId : '';
  $modelList.innerHTML = '';

  models.forEach((m, idx) => {
    const item = document.createElement('div');
    item.className = 'model-item' + (m.id === selectedModelId ? ' selected' : '');
    item.draggable = true;
    item.dataset.index = idx;

    // Drag handle
    const handle = document.createElement('span');
    handle.className = 'model-item-handle';
    handle.textContent = '\u2261';
    item.appendChild(handle);

    // Org icon — resolve from local icon cache
    const icon = document.createElement('img');
    icon.className = 'model-item-icon';
    const orgSlug = m.org_icon || m.id.split('/')[0];
    const cachedIcon = iconCache[orgSlug];
    if (cachedIcon) {
      icon.src = cachedIcon;
      icon.onerror = () => { icon.style.display = 'none'; };
    } else if (m.org_icon && m.org_icon.startsWith('data:')) {
      // Legacy: org_icon might be a data URL from older versions
      icon.src = m.org_icon;
      icon.onerror = () => { icon.style.display = 'none'; };
    } else {
      icon.style.display = 'none';
    }
    item.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'model-item-name';
    name.textContent = m.id;
    item.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'model-item-meta';

    if (m.context_length) {
      const ctx = document.createElement('span');
      const ctxK = Math.round(m.context_length / 1000);
      ctx.textContent = i18n('optModelCtx') + ': ' + (ctxK >= 1000 ? (ctxK / 1000) + 'M' : ctxK + 'k');
      meta.appendChild(ctx);
    }
    if (m.prompt_cost) {
      const pc = document.createElement('span');
      pc.textContent = i18n('optModelPromptCost') + ' $' + (parseFloat(m.prompt_cost) * 1000000).toFixed(2);
      meta.appendChild(pc);
    }
    if (m.completion_cost) {
      const cc = document.createElement('span');
      cc.textContent = i18n('optModelCompCost') + ' $' + (parseFloat(m.completion_cost) * 1000000).toFixed(2);
      meta.appendChild(cc);
    }

    item.appendChild(meta);

    item.addEventListener('click', () => {
      if (selectedModelId === m.id) return;
      selectedModelId = m.id;
      renderModelList();
      persistModels();
    });

    // Drag events
    item.addEventListener('dragstart', (e) => {
      dragSrcIndex = idx;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      dragSrcIndex = null;
      $modelList.querySelectorAll('.model-item').forEach((el) => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      $modelList.querySelectorAll('.model-item').forEach((el) => el.classList.remove('drag-over'));
      if (dragSrcIndex !== null && dragSrcIndex !== idx) {
        item.classList.add('drag-over');
      }
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragSrcIndex === null || dragSrcIndex === idx) return;
      const [moved] = models.splice(dragSrcIndex, 1);
      models.splice(idx, 0, moved);
      dragSrcIndex = null;
      renderModelList();
      persistModels();
    });

    $modelList.appendChild(item);
  });
}

// ---- Add model (inline row) ----

function showAddRow() {
  if (addRowActive) return;
  addRowActive = true;

  const row = document.createElement('div');
  row.className = 'model-add-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = i18n('optModelAddPrompt');
  row.appendChild(input);

  const okBtn = document.createElement('button');
  okBtn.className = 'add-row-btn add-row-ok';
  okBtn.textContent = 'OK';
  row.appendChild(okBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'add-row-btn add-row-cancel';
  cancelBtn.textContent = '\u2715';
  row.appendChild(cancelBtn);

  $modelList.appendChild(row);
  input.focus();
  // Scroll to bottom so the input is visible
  $modelList.scrollTop = $modelList.scrollHeight;

  function commit() {
    const id = input.value.trim();
    if (!id) { dismiss(); return; }
    if (models.some((m) => m.id === id)) {
      toast(i18n('optModelAddDuplicate'));
      input.focus();
      return;
    }
    models.push({ id });
    selectedModelId = id;
    dismiss();
    renderModelList();
    persistModels();
    fetchSingleModelInfo(id);
  }

  function dismiss() {
    row.remove();
    addRowActive = false;
  }

  okBtn.addEventListener('click', commit);
  cancelBtn.addEventListener('click', dismiss);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') dismiss();
  });
}

document.getElementById('addModelBtn').addEventListener('click', showAddRow);

// ---- Reusable confirm modal ----

let modalResolve = null;

function showConfirmModal(html, confirmLabel, isDanger) {
  const modal = document.getElementById('confirmModal');
  document.getElementById('confirmModalText').innerHTML = html;
  document.getElementById('confirmModalCancel').textContent = i18n('optCancel');
  const confirmBtn = document.getElementById('confirmModalConfirm');
  confirmBtn.textContent = confirmLabel;
  confirmBtn.className = isDanger !== false ? 'modal-confirm-btn' : 'modal-confirm-btn';
  modal.classList.add('visible');
  return new Promise((resolve) => { modalResolve = resolve; });
}

document.getElementById('confirmModalCancel').addEventListener('click', () => {
  document.getElementById('confirmModal').classList.remove('visible');
  if (modalResolve) { modalResolve(false); modalResolve = null; }
});

document.getElementById('confirmModalConfirm').addEventListener('click', () => {
  document.getElementById('confirmModal').classList.remove('visible');
  if (modalResolve) { modalResolve(true); modalResolve = null; }
});

document.getElementById('confirmModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.remove('visible');
    if (modalResolve) { modalResolve(false); modalResolve = null; }
  }
});

// ---- Delete model ----

document.getElementById('deleteModelBtn').addEventListener('click', async () => {
  if (!selectedModelId) {
    toast(i18n('optModelNoneSelected'));
    return;
  }
  const html = i18n('optModelDeleteConfirm') + '<br><span class="modal-model-name">' +
    selectedModelId.replace(/</g, '&lt;') + '</span>';
  const confirmed = await showConfirmModal(html, i18n('optModelDelete'));
  if (!confirmed) return;

  models = models.filter((m) => m.id !== selectedModelId);
  selectedModelId = models.length > 0 ? models[0].id : '';
  renderModelList();
  persistModels();
});

// ---- Clear all model info ----

document.getElementById('clearModelInfo').addEventListener('click', async () => {
  if (models.length === 0) return;
  const confirmed = await showConfirmModal(
    i18n('optModelClearInfoConfirm'),
    i18n('optModelClearInfo')
  );
  if (!confirmed) return;

  for (const m of models) {
    delete m.context_length;
    delete m.prompt_cost;
    delete m.completion_cost;
    delete m.org_icon;
  }
  // Clear local icon cache too
  iconCache = {};
  chrome.storage.local.set({ iconCache: {} });
  renderModelList();
  persistModels();
  toast(i18n('optModelInfoCleared'));
});

// ---- Bulk edit models ----

document.getElementById('bulkEditBtn').addEventListener('click', () => {
  const panel = document.getElementById('bulkEditPanel');
  const textarea = document.getElementById('bulkEditText');
  const isVisible = panel.classList.contains('visible');
  if (isVisible) {
    panel.classList.remove('visible');
    return;
  }
  textarea.value = models.map((m) => m.id).join('\n');
  panel.classList.add('visible');
  textarea.focus();
});

document.getElementById('bulkEditOk').addEventListener('click', () => {
  const textarea = document.getElementById('bulkEditText');
  const newIds = textarea.value.split('\n').map((s) => s.trim()).filter(Boolean);

  // Deduplicate while preserving order
  const seen = new Set();
  const uniqueIds = [];
  for (const id of newIds) {
    if (!seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }

  // Preserve existing model metadata for models that remain
  const oldMap = {};
  for (const m of models) oldMap[m.id] = m;

  models = uniqueIds.map((id) => oldMap[id] || { id });

  // Fix selected model
  if (!models.some((m) => m.id === selectedModelId)) {
    selectedModelId = models.length > 0 ? models[0].id : '';
  }

  document.getElementById('bulkEditPanel').classList.remove('visible');
  renderModelList();
  persistModels();
});

document.getElementById('bulkEditCancel').addEventListener('click', () => {
  document.getElementById('bulkEditPanel').classList.remove('visible');
});

// ---- Fetch model info (smart: unfetched + force selected) ----

document.getElementById('fetchModelInfo').addEventListener('click', () => {
  if (models.length === 0) {
    toast(i18n('optModelNoneSelected'));
    return;
  }
  smartFetchModelInfo();
});

function smartFetchModelInfo() {
  const fetchBtn = document.getElementById('fetchModelInfo');
  const errEl = document.getElementById('modelInfoError');

  // Collect: models without info + currently selected model (force refresh)
  const idsToFetch = models
    .filter((m) => !m.context_length || m.id === selectedModelId)
    .map((m) => m.id);

  if (idsToFetch.length === 0) {
    toast(i18n('optSaved'));
    return;
  }

  fetchBtn.disabled = true;
  fetchBtn.textContent = i18n('optModelInfoFetching');
  errEl.style.display = 'none';

  chrome.runtime.sendMessage({ action: 'batchFetchModelInfo', modelIds: idsToFetch }, (res) => {
    fetchBtn.disabled = false;
    fetchBtn.textContent = i18n('optModelInfoFetch');

    if (res?.error) {
      errEl.textContent = i18n('optModelInfoError') + ': ' + res.error;
      errEl.style.display = 'block';
      return;
    }

    const results = res.results || {};
    for (const m of models) {
      const info = results[m.id];
      if (!info) continue;
      m.org_icon = info.org_icon || m.org_icon;
      if (!info.notFound) {
        m.context_length = info.context_length || null;
        m.prompt_cost = info.prompt_cost || null;
        m.completion_cost = info.completion_cost || null;
      }
    }

    // Refresh icon cache from local storage (background may have updated it)
    chrome.storage.local.get({ iconCache: {} }, (d) => {
      iconCache = d.iconCache || {};
      renderModelList();
      persistModels();
      toast(i18n('optSaved'));
    });
  });
}

// Single model fetch (used when adding a new model)
function fetchSingleModelInfo(modelId) {
  const errEl = document.getElementById('modelInfoError');
  errEl.style.display = 'none';

  chrome.runtime.sendMessage({ action: 'fetchModelInfo', modelId }, (res) => {
    if (res?.error) {
      errEl.textContent = i18n('optModelInfoError') + ': ' + res.error;
      errEl.style.display = 'block';
    }

    const entry = models.find((m) => m.id === modelId);
    if (entry) {
      if (!res?.error) {
        entry.context_length = res.context_length || null;
        entry.prompt_cost = res.prompt_cost || null;
        entry.completion_cost = res.completion_cost || null;
      }
      entry.org_icon = res?.org_icon || entry.org_icon;
      // Refresh icon cache
      chrome.storage.local.get({ iconCache: {} }, (d) => {
        iconCache = d.iconCache || {};
        renderModelList();
        persistModels();
      });
    }
  });
}

// ---- Load ----

// Load icon cache from local storage first, then load settings
chrome.storage.local.get({ iconCache: {} }, (local) => {
  iconCache = local.iconCache || {};

  chrome.storage.sync.get({
    apiUrl: DEFAULT_API_URL,
    apiKey: '',
    model: PRESET_MODELS[0],
    models: null,
    prompt: DEFAULT_PROMPT,
    skipSites: []
  }, (s) => {
    $apiUrl.value = s.apiUrl;
    $apiKey.value = s.apiKey;
    $prompt.value = s.prompt;
    $skipSitesText.value = s.skipSites.join('\n');

    // Migrate: if no models array saved yet, create from presets
    if (s.models === null) {
      models = PRESET_MODELS.map((id) => ({ id }));
      if (!PRESET_MODELS.includes(s.model) && s.model) {
        models.push({ id: s.model });
      }
    } else {
      models = s.models;
    }

    selectedModelId = s.model;
    if (!models.some((m) => m.id === selectedModelId) && models.length > 0) {
      selectedModelId = models[0].id;
    }

    renderModelList();
  });
});

// ---- Save ----

function saveAllSettings() {
  if (!selectedModelId) {
    toast(i18n('optSpecifyModel'));
    return;
  }

  const skipSites = $skipSitesText.value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  chrome.storage.sync.set({
    apiUrl: $apiUrl.value.trim() || DEFAULT_API_URL,
    apiKey: $apiKey.value.trim(),
    model: selectedModelId,
    models: models,
    prompt: $prompt.value,
    skipSites: skipSites
  }, () => {
    toast(i18n('optSaved'));
  });
}

document.getElementById('save').addEventListener('click', saveAllSettings);
document.getElementById('headerSave').addEventListener('click', saveAllSettings);

// ---- Reset prompt ----

document.getElementById('resetPrompt').addEventListener('click', () => {
  $prompt.value = DEFAULT_PROMPT;
  toast(i18n('optPromptReset'));
});

// ---- API Test ----

document.getElementById('testApi').addEventListener('click', () => {
  const apiUrl = $apiUrl.value.trim() || DEFAULT_API_URL;
  const apiKey = $apiKey.value.trim();

  if (!apiKey) {
    toast(i18n('optTestNoKey'));
    return;
  }
  if (!selectedModelId) {
    toast(i18n('optSpecifyModel'));
    return;
  }

  const testBtn = document.getElementById('testApi');
  const resultEl = document.getElementById('testResult');
  testBtn.disabled = true;
  testBtn.textContent = i18n('optTestTesting');
  resultEl.textContent = '';
  resultEl.className = 'test-result';

  chrome.runtime.sendMessage({
    action: 'testApi',
    apiUrl,
    apiKey,
    model: selectedModelId
  }, (res) => {
    testBtn.disabled = false;
    testBtn.textContent = i18n('optTestApi');

    if (res?.success) {
      resultEl.textContent = i18n('optTestSuccess');
      resultEl.className = 'test-result success';
    } else {
      resultEl.textContent = res?.error || i18n('optTestFail');
      resultEl.className = 'test-result error';
    }
  });
});

// ---- Toast ----

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}
