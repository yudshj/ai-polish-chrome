const DEFAULT_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const DEFAULT_MODELS = [
  'qwen/qwen3.5-122b-a10b',
  'google/gemini-3.1-pro-preview',
  'google/gemini-3-flash-preview',
  'openai/gpt-5.2',
  'anthropic/claude-opus-4.6'
];

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

function buildPrompt(template, text, targetLanguage) {
  const langLabel = targetLanguage === 'auto'
    ? 'Auto-detect (keep the same language as input)'
    : targetLanguage;
  return template
    .replace('{{targetLanguage}}', langLabel)
    .replace('{{text}}', text);
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({
      apiUrl: DEFAULT_API_URL,
      apiKey: '',
      model: DEFAULT_MODELS[0],
      prompt: DEFAULT_PROMPT
    }, resolve);
  });
}
