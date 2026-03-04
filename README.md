# AI Polish - Chrome Extension

AI-powered text polishing for any input field in your browser. Like Grammarly, but with your choice of LLM.

## Features

- **Inline polish button** — appears next to any text input, textarea, or contenteditable field
- **One-click polishing** — hover to open the panel, click to polish
- **Streaming output** — text appears gradually with a typewriter animation and a spinning gradient cursor
- **Language options** — Auto-detect, Chinese, English, Japanese
- **Undo support** — instantly revert to original text
- **Skip sites** — disable on specific websites from the popup; manage the list in settings
- **Settings access** — gear icon in both the floating panel and popup
- **API test** — verify your API key and endpoint work before polishing
- **Model info** — auto-fetches context length and pricing from OpenRouter
- **Custom prompts** — built-in default prompt with full customization
- **i18n** — English, Chinese, Japanese, Arabic, German

## Supported Models

| Model | ID |
|-------|-----|
| Gemini 3 Flash (default) | `google/gemini-3-flash-preview` |
| Gemini 3.1 Pro | `google/gemini-3.1-pro-preview` |
| Qwen 3.5 | `qwen/qwen3.5-122b-a10b` |
| GPT-5.2 | `openai/gpt-5.2` |
| Claude Opus 4.6 | `anthropic/claude-opus-4.6` |
| Custom | Any OpenAI-compatible model ID |

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked** and select the `chrome_extension_ai_polish` folder
5. Click the extension icon → **Open Settings**
6. Enter your API key and select a model

## Configuration

### API Endpoint

Default: `https://openrouter.ai/api/v1/chat/completions`

Any OpenAI-compatible endpoint works — just change the API URL in settings.

### API Key

Get an API key from [OpenRouter](https://openrouter.ai/keys) or your preferred provider.

Use the **Test API** button in settings to verify your configuration.

## How It Works

1. Focus on any text input field on a web page
2. A purple sparkle button appears at the bottom-right corner of the field
3. Hover over the button to reveal the polish panel
4. Select a target language (or leave on Auto)
5. Click **Polish** — text streams in character by character with a spinning gradient cursor
6. Click **Undo** to revert if needed

### Skip Sites

Don't want AI Polish on a particular website?

- Click the extension icon → **Skip this site** (takes effect immediately, no reload needed)
- Or manage the full skip list in **Settings → Skipped Sites** (one hostname per line)

## Tech Stack

- Chrome Manifest V3
- Vanilla JavaScript (no frameworks)
- Chrome Storage API for settings
- Chrome i18n API for internationalization
- Background service worker for API calls (avoids CORS)

## Project Structure

```
├── manifest.json          # Extension manifest (MV3)
├── _locales/              # i18n translations (en, zh_CN, ja, ar, de)
├── icons/                 # Extension icons (16, 48, 128px)
├── popup/                 # Toolbar popup (status + settings link)
├── options/               # Settings page (API config, model, prompt)
├── content/               # Content script (floating button + panel)
├── background/            # Service worker (API calls, model info)
└── lib/                   # Shared utilities (defaults, prompt builder)
```

## License

MIT

## Links

- [GitHub](https://github.com/yudshj/ai-polish-chrome)
- [OpenRouter](https://openrouter.ai)
