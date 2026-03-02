# Privacy Policy — AI Polish Chrome Extension

**Last updated:** March 2, 2026

## Overview

AI Polish is a browser extension that polishes text in input fields using AI. Your privacy is important to us. This policy explains what data is accessed, how it is used, and what is stored.

## Data Collection and Usage

### Data accessed by the extension

- **Text content from input fields**: When you click the "Polish" button, the extension reads the text from the currently focused input field and sends it to the AI API endpoint you have configured (default: OpenRouter). This text is **not** stored, logged, or transmitted anywhere other than the API endpoint you configure.

### Data stored locally

The following settings are stored in your browser's Chrome sync storage:

- **API URL** (the endpoint you configure)
- **API Key** (your personal API key for the AI service)
- **Model selection** (which AI model to use)
- **Custom prompt template** (your polishing instructions)

This data is stored **only on your device** (and synced across your Chrome browsers if Chrome Sync is enabled). It is never sent to the extension developer or any third party.

### Data NOT collected

AI Polish does **not** collect, store, or transmit:

- Personal identification information
- Browsing history or web activity
- Location data
- Analytics or telemetry data
- Cookies or tracking identifiers

## Third-Party Services

The text you polish is sent to the API endpoint you configure. By default, this is [OpenRouter](https://openrouter.ai). The handling of your data by these services is governed by their respective privacy policies:

- OpenRouter: https://openrouter.ai/privacy
- Or the privacy policy of whatever API provider you configure

The extension developer has no access to your API calls or the text you polish.

## Remote Code

AI Polish does **not** use any remote code. All JavaScript is bundled within the extension package. No external scripts are loaded or executed.

## Data Sharing

- We do **not** sell or transfer user data to third parties.
- We do **not** use user data for advertising or profiling.
- We do **not** use user data to determine creditworthiness.

## Permissions

- **storage**: To save your settings (API URL, API key, model, prompt) locally
- **activeTab**: To access the currently focused input field for text polishing
- **Host permissions (all URLs)**: The content script must run on all web pages to detect input fields and show the polish button. The background service worker needs network access to forward your text to the AI API endpoint you configure.

## Changes

If this privacy policy is updated, the changes will be posted to this page with an updated date.

## Contact

For privacy-related questions, please open an issue at:
https://github.com/yudshj/ai-polish-chrome/issues
