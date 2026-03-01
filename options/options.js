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
  'anthropic/claude-opus-4.6'
];

const $apiUrl = document.getElementById('apiUrl');
const $apiKey = document.getElementById('apiKey');
const $modelSelect = document.getElementById('modelSelect');
const $customModel = document.getElementById('customModel');
const $prompt = document.getElementById('prompt');

// ---- i18n: Apply labels ----

document.title = i18n('optTitle');
document.getElementById('headerTitle').textContent = i18n('optTitle');
document.getElementById('cardApiConfig').textContent = i18n('optApiConfig');
document.getElementById('labelApiUrl').textContent = i18n('optApiUrl');
document.getElementById('hintApiUrl').textContent = i18n('optApiUrlHint');
document.getElementById('labelApiKey').textContent = i18n('optApiKey');
document.getElementById('testApi').textContent = i18n('optTestApi');
document.getElementById('labelModel').textContent = i18n('optModel');
document.getElementById('optCustomModel').textContent = i18n('optModelCustom');
document.getElementById('modelInfoLabel').textContent = i18n('optModelInfo');
document.getElementById('fetchModelInfo').textContent = i18n('optModelInfoFetch');
document.getElementById('infoCtxLabel').textContent = i18n('optModelInfoContext');
document.getElementById('infoPromptLabel').textContent = i18n('optModelInfoPromptCost');
document.getElementById('infoCompLabel').textContent = i18n('optModelInfoCompletionCost');
document.getElementById('cardPrompt').textContent = i18n('optPromptTemplate');
document.getElementById('labelPrompt').textContent = i18n('optSystemPrompt');
document.getElementById('hintPrompt').textContent = i18n('optPromptHint');
document.getElementById('resetPrompt').textContent = i18n('optResetPrompt');
document.getElementById('save').textContent = i18n('optSave');

// ---- Model select toggle + auto-fetch ----

$modelSelect.addEventListener('change', () => {
  const isCustom = $modelSelect.value === 'custom';
  $customModel.style.display = isCustom ? 'block' : 'none';
  if (!isCustom) {
    fetchModelInfo($modelSelect.value);
  }
});

// ---- Load ----

chrome.storage.sync.get({
  apiUrl: DEFAULT_API_URL,
  apiKey: '',
  model: PRESET_MODELS[0],
  prompt: DEFAULT_PROMPT
}, (s) => {
  $apiUrl.value = s.apiUrl;
  $apiKey.value = s.apiKey;
  $prompt.value = s.prompt;

  if (PRESET_MODELS.includes(s.model)) {
    $modelSelect.value = s.model;
    fetchModelInfo(s.model);
  } else {
    $modelSelect.value = 'custom';
    $customModel.value = s.model;
    $customModel.style.display = 'block';
  }
});

// ---- Save ----

document.getElementById('save').addEventListener('click', () => {
  const model = $modelSelect.value === 'custom'
    ? $customModel.value.trim()
    : $modelSelect.value;

  if (!model) {
    toast(i18n('optSpecifyModel'));
    return;
  }

  chrome.storage.sync.set({
    apiUrl: $apiUrl.value.trim() || DEFAULT_API_URL,
    apiKey: $apiKey.value.trim(),
    model: model,
    prompt: $prompt.value
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
  const model = $modelSelect.value === 'custom'
    ? $customModel.value.trim()
    : $modelSelect.value;

  if (!apiKey) {
    toast(i18n('optTestNoKey'));
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
    model
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

// ---- Model info fetch ----

function fetchModelInfo(modelId) {
  if (!modelId || modelId === 'custom') return;

  const fetchBtn = document.getElementById('fetchModelInfo');
  const infoBody = document.getElementById('modelInfoBody');
  const errEl = document.getElementById('modelInfoError');

  fetchBtn.disabled = true;
  fetchBtn.textContent = i18n('optModelInfoFetching');
  errEl.style.display = 'none';
  infoBody.classList.remove('visible');

  chrome.runtime.sendMessage({ action: 'fetchModelInfo', modelId }, (res) => {
    fetchBtn.disabled = false;
    fetchBtn.textContent = i18n('optModelInfoFetch');

    if (res?.error) {
      errEl.textContent = i18n('optModelInfoError') + ': ' + res.error;
      errEl.style.display = 'block';
      return;
    }

    const perM = i18n('optModelInfoPerMTokens');

    document.getElementById('infoCtxValue').textContent =
      res.context_length ? res.context_length.toLocaleString() : '—';

    document.getElementById('infoPromptValue').textContent = res.prompt_cost
      ? '$' + (parseFloat(res.prompt_cost) * 1000000).toFixed(2) + ' ' + perM
      : '—';

    document.getElementById('infoCompValue').textContent = res.completion_cost
      ? '$' + (parseFloat(res.completion_cost) * 1000000).toFixed(2) + ' ' + perM
      : '—';

    infoBody.classList.add('visible');
  });
}

document.getElementById('fetchModelInfo').addEventListener('click', () => {
  const modelId = $modelSelect.value === 'custom'
    ? $customModel.value.trim()
    : $modelSelect.value;

  if (!modelId || modelId === 'custom') {
    toast(i18n('optSpecifyModel'));
    return;
  }
  fetchModelInfo(modelId);
});

// ---- Toast ----

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}
