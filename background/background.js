importScripts('../lib/api.js');

// ---- One-off messages (openOptions, fetchModelInfo, testApi) ----

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  } else if (request.action === 'fetchModelInfo') {
    handleFetchModelInfo(request.modelId).then(sendResponse);
    return true;
  } else if (request.action === 'testApi') {
    handleTestApi(request.apiUrl, request.apiKey, request.model).then(sendResponse);
    return true;
  }
});

// ---- Streaming polish via port ----

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'polish-stream') return;

  port.onMessage.addListener((msg) => {
    if (msg.action === 'polish') {
      handlePolishStream(msg.text, msg.targetLanguage, port);
    }
  });
});

async function handlePolishStream(text, targetLanguage, port) {
  try {
    const settings = await getSettings();

    if (!settings.apiKey) {
      port.postMessage({ action: 'error', error: 'API Key not set. Please configure it in extension settings.' });
      return;
    }

    const userMessage = buildPrompt(settings.prompt, text, targetLanguage);

    const response = await fetch(settings.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
        'Accept': 'text/event-stream',
        'Accept-Encoding': 'identity',
        'HTTP-Referer': 'chrome-extension://ai-polish',
        'X-Title': 'AI Polish Extension'
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'user', content: userMessage }
        ],
        stream: true
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      port.postMessage({ action: 'error', error: `API error ${response.status}: ${errBody}` });
      return;
    }

    // Signal content script to clear the field
    port.postMessage({ action: 'start' });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            port.postMessage({ action: 'chunk', text: delta });
          }
        } catch {
          // skip malformed JSON
        }
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim();
        if (data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              port.postMessage({ action: 'chunk', text: delta });
            }
          } catch {}
        }
      }
    }

    port.postMessage({ action: 'done' });
  } catch (err) {
    try {
      port.postMessage({ action: 'error', error: err.message });
    } catch {
      // port may already be disconnected
    }
  }
}

async function handleFetchModelInfo(modelId) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const model = data.data?.find((m) => m.id === modelId);
    if (!model) {
      return { error: 'Model not found' };
    }
    return {
      id: model.id,
      name: model.name,
      context_length: model.context_length,
      prompt_cost: model.pricing?.prompt,
      completion_cost: model.pricing?.completion
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleTestApi(apiUrl, apiKey, model) {
  try {
    if (!apiKey) {
      return { error: 'API key is empty' };
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'chrome-extension://ai-polish',
        'X-Title': 'AI Polish Extension'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'user', content: 'Hi' }
        ],
        max_tokens: 1,
        stream: false
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      let detail = '';
      try {
        const parsed = JSON.parse(errBody);
        detail = parsed.error?.message || errBody;
      } catch {
        detail = errBody;
      }
      return { error: `HTTP ${response.status}: ${detail}` };
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      return { success: true };
    }
    return { error: 'Unexpected response format' };
  } catch (err) {
    return { error: err.message };
  }
}
