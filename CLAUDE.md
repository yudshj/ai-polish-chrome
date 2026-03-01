# Chrome Extension - AI Polish

## Project Overview
A Chrome extension that adds AI-powered text polishing to any text input field in the browser, similar to Grammarly's inline button approach.

## Core Features

### 1. Inline Button & Panel
- Detect all text input fields (`<input>`, `<textarea>`, `contenteditable`) on web pages
- Show a small floating button near the focused input field (bottom-right corner)
- On hover, display a panel with:
  - **Settings gear icon** (top-right of panel) - opens extension settings page
  - **Target language selector** - dropdown with options: Auto (detect input language), 中文, English, 日本語
  - **One-click polish button** - polishes the text in the input field
  - **Undo button** - appears after polishing, restores original text
- Panel must remain visible when mouse hovers over it (button → panel transition should be seamless)
- After polishing, replace the text in the input field with the polished version

### 2. AI Integration
- Use OpenRouter API (or any OpenAI-compatible API endpoint)
- Auto-detect the input language and output in the same language by default
- If a target language is selected, output in that language
- Default model: `qwen/qwen3.5-122b-a10b`
- **Streaming (SSE)**: Text appears gradually via typewriter animation
- **Typing cursor**: A spinning gradient ring follows the end of the generated text in real-time

### 3. Popup Window
- Show current API key status, model name, and API URL
- **Settings gear icon button** (no text) in the top-right corner to open the settings page
- "Open Settings" button at the bottom
- All text supports i18n

### 4. Settings Page (options)
- **API URL**: Default `https://openrouter.ai/api/v1/chat/completions`, editable for any OpenAI-compatible endpoint
- **API Key**: Secret key input (password field)
- **API Test Button**: Below API key, tests API connection (sends `max_tokens: 1` request to verify API URL + key + model work)
- **Model Selection**: Dropdown with preset models:
  - `qwen/qwen3.5-122b-a10b` (default)
  - `google/gemini-3.1-pro-preview`
  - `google/gemini-3-flash-preview`
  - `openai/gpt-5.2`
  - `anthropic/claude-opus-4.6`
  - Support custom model input
- **Model Info Widget**: Below model selection, auto-fetches model context length and cost from OpenRouter API when a preset model is selected. Also has a manual "Fetch Info" button.
- **Custom Prompt**: Textarea with built-in default prompt, editable
- **Reset to Default**: Button to restore the default prompt
- **GitHub Link**: Icon button in header linking to https://github.com/yudshj/ai-polish-chrome
- All text supports i18n

### 5. Internationalization (i18n)
- Use Chrome `chrome.i18n` API with `_locales/` directory
- Supported languages:
  - English (en) - default
  - Chinese Simplified (zh_CN)
  - Japanese (ja)
  - Arabic (ar)
  - German (de)
- All UI strings in popup, options page, and content script panel are translated

## Tech Stack
- Manifest V3
- Vanilla JS (no framework, keep it lightweight)
- Chrome Storage API for settings persistence
- Chrome i18n API for internationalization
- Content script for inline button injection
- Background service worker for API calls

## File Structure
```
chrome_extension_ai_polish/
├── CLAUDE.md
├── README.md
├── manifest.json
├── _locales/
│   ├── en/messages.json
│   ├── zh_CN/messages.json
│   ├── ja/messages.json
│   ├── ar/messages.json
│   └── de/messages.json
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── popup/
│   ├── popup.html
│   └── popup.js
├── content/
│   ├── content.js
│   └── content.css
├── background/
│   └── background.js
├── lib/
│   └── api.js
└── options/
    ├── options.html
    └── options.js
```

## Default Polish Prompt
```
You are a professional text polishing assistant. Your task is to improve the given text while preserving its original meaning and tone.

Rules:
1. Fix grammar, spelling, and punctuation errors
2. Improve clarity and readability
3. Maintain the original tone and style
4. Keep the same language as the input unless a target language is specified
5. If a target language is specified, translate and polish into that language
6. Only output the polished text, no explanations or additional content

Target language: {{targetLanguage}}

Text to polish:
{{text}}
```

## Development Notes
- Content script needs to handle dynamic DOM changes (MutationObserver)
- Use `chrome.storage.sync` for settings
- API calls go through background service worker to avoid CORS issues
- The floating button should not interfere with page layout
- Handle edge cases: empty input, very long text, API errors
- Panel hover: use mouseenter/mouseleave with a delay (250ms) to keep panel visible during button→panel mouse transition
- Panel gear icon opens settings via `chrome.runtime.sendMessage({ action: 'openOptions' })` → background calls `chrome.runtime.openOptionsPage()`
- Model info fetched from OpenRouter API: `GET https://openrouter.ai/api/v1/models` — filter by model ID to get context_length, pricing
- Model info auto-fetches when selecting a preset model from dropdown
- API test sends a minimal request (`max_tokens: 1`) to verify connectivity
- GitHub repo: https://github.com/yudshj/ai-polish-chrome

### Streaming Architecture
- **Port-based messaging**: Content script opens a long-lived port (`chrome.runtime.connect({ name: 'polish-stream' })`) to the background service worker
- **Background SSE parsing**: `response.body.getReader()` reads SSE chunks; each `data:` line's `delta.content` is sent via `port.postMessage({ action: 'chunk' })`
- **Anti-buffering**: `Accept-Encoding: identity` header prevents gzip compression that causes CDN/proxy buffering of SSE streams
- **Typewriter queue**: Content script accumulates chunks in a buffer; a 60fps `setInterval` gradually reveals characters with adaptive speed (`Math.ceil(buffered / 20)` chars per tick)
- **Typing cursor**: A spinning gradient ring (conic-gradient + CSS mask) follows the last displayed character. Positioning uses mirror-div technique for textarea/input, Range API for contentEditable
- **Port lifecycle**: Background never calls `port.disconnect()` — content script disconnects after receiving `done` or `error` to avoid race conditions
