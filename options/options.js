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
let models = [];
let selectedModelId = '';

// ---- i18n: Apply labels ----

document.title = i18n('optTitle');
document.getElementById('headerTitle').textContent = i18n('optTitle');
document.getElementById('cardApiConfig').textContent = i18n('optApiConfig');
document.getElementById('labelApiUrl').textContent = i18n('optApiUrl');
document.getElementById('hintApiUrl').textContent = i18n('optApiUrlHint');
document.getElementById('labelApiKey').textContent = i18n('optApiKey');
document.getElementById('testApi').textContent = i18n('optTestApi');
document.getElementById('labelModel').textContent = i18n('optModel');
document.getElementById('addModelBtn').textContent = i18n('optModelAdd');
document.getElementById('deleteModelBtn').textContent = i18n('optModelDelete');
document.getElementById('fetchModelInfo').textContent = i18n('optModelInfoFetch');
document.getElementById('cardPrompt').textContent = i18n('optPromptTemplate');
document.getElementById('labelPrompt').textContent = i18n('optSystemPrompt');
document.getElementById('hintPrompt').textContent = i18n('optPromptHint');
document.getElementById('resetPrompt').textContent = i18n('optResetPrompt');
document.getElementById('cardSkipSites').textContent = i18n('optSkipSites');
document.getElementById('hintSkipSites').textContent = i18n('optSkipSitesHint');
document.getElementById('save').textContent = i18n('optSave');

// ---- Persist models to storage ----

function persistModels() {
  chrome.storage.sync.set({ models, model: selectedModelId });
}

// ---- Model list rendering ----

function renderModelList() {
  $modelList.innerHTML = '';

  models.forEach((m) => {
    const item = document.createElement('div');
    item.className = 'model-item' + (m.id === selectedModelId ? ' selected' : '');

    // Org icon
    if (m.org_icon) {
      const icon = document.createElement('img');
      icon.className = 'model-item-icon';
      icon.src = m.org_icon;
      item.appendChild(icon);
    }

    const name = document.createElement('span');
    name.className = 'model-item-name';
    name.textContent = m.id;
    item.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'model-item-meta';

    if (m.context_length) {
      const ctx = document.createElement('span');
      ctx.textContent = i18n('optModelCtx') + ': ' + (m.context_length / 1000) + 'k';
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
      selectedModelId = m.id;
      renderModelList();
    });

    $modelList.appendChild(item);
  });
}

// ---- Add model ----

document.getElementById('addModelBtn').addEventListener('click', () => {
  const modelId = prompt(i18n('optModelAddPrompt'));
  if (!modelId || !modelId.trim()) return;
  const id = modelId.trim();

  if (models.some((m) => m.id === id)) {
    toast(i18n('optModelAddDuplicate'));
    return;
  }

  models.push({ id });
  selectedModelId = id;
  renderModelList();
  // Auto-fetch info for the new model (single)
  fetchSingleModelInfo(id);
});

// ---- Delete model ----

document.getElementById('deleteModelBtn').addEventListener('click', () => {
  if (!selectedModelId) {
    toast(i18n('optModelNoneSelected'));
    return;
  }
  if (!confirm(i18n('optModelDeleteConfirm'))) return;

  models = models.filter((m) => m.id !== selectedModelId);
  selectedModelId = models.length > 0 ? models[0].id : '';
  renderModelList();
  persistModels();
});

// ---- Fetch model info (batch for all models) ----

document.getElementById('fetchModelInfo').addEventListener('click', () => {
  if (models.length === 0) {
    toast(i18n('optModelNoneSelected'));
    return;
  }
  batchFetchModelInfo();
});

function batchFetchModelInfo() {
  const fetchBtn = document.getElementById('fetchModelInfo');
  const errEl = document.getElementById('modelInfoError');

  fetchBtn.disabled = true;
  fetchBtn.textContent = i18n('optModelInfoFetching');
  errEl.style.display = 'none';

  const modelIds = models.map((m) => m.id);

  chrome.runtime.sendMessage({ action: 'batchFetchModelInfo', modelIds }, (res) => {
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

    renderModelList();
    persistModels();
    toast(i18n('optSaved'));
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
      renderModelList();
      persistModels();
    }
  });
}

// ---- Load ----

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

// ---- Save ----

document.getElementById('save').addEventListener('click', () => {
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
});

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
