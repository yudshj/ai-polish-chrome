importScripts('../lib/api.js');

// ---- Dynamic content script registration ----

const CONTENT_SCRIPT_ID = 'aip-content';

async function registerContentScripts() {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  if (existing.length > 0) return;

  await chrome.scripting.registerContentScripts([{
    id: CONTENT_SCRIPT_ID,
    matches: ['*://*/*'],
    js: ['content/content.js'],
    css: ['content/content.css'],
    runAt: 'document_idle',
    allFrames: true
  }]);
}

async function unregisterContentScripts() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  } catch {}
}

async function ensureContentScripts() {
  const granted = await chrome.permissions.contains({ origins: ['*://*/*'] });
  if (granted) {
    await registerContentScripts();
  }
}

// Register on install/update and startup
chrome.runtime.onInstalled.addListener(ensureContentScripts);
chrome.runtime.onStartup.addListener(ensureContentScripts);

// React to permission changes
chrome.permissions.onAdded.addListener((perms) => {
  if (perms.origins?.length) registerContentScripts();
});
chrome.permissions.onRemoved.addListener((perms) => {
  if (perms.origins?.length) unregisterContentScripts();
});

// ---- One-off messages (openOptions, fetchModelInfo, testApi) ----

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  } else if (request.action === 'registerContentScripts') {
    registerContentScripts().then(() => sendResponse({ ok: true }));
    return true;
  } else if (request.action === 'fetchModelInfo') {
    handleFetchModelInfo(request.modelId).then(sendResponse);
    return true;
  } else if (request.action === 'batchFetchModelInfo') {
    handleBatchFetchModelInfo(request.modelIds).then(sendResponse);
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
      handlePolishStream(msg.text, msg.targetLanguage, port, msg.chatMode);
    }
  });
});

async function handlePolishStream(text, targetLanguage, port, chatMode) {
  try {
    const settings = await getSettings();

    if (!settings.apiKey) {
      port.postMessage({ action: 'error', error: 'API Key not set. Please configure it in extension settings.' });
      return;
    }

    const userMessage = chatMode ? text : buildPrompt(settings.prompt, text, targetLanguage);

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

function generateFallbackIcon(orgName) {
  const colors = ['#4285F4','#EA4335','#34A853','#FBBC04','#8B5CF6','#EC4899','#06B6D4','#F97316','#6366F1','#14B8A6'];
  let hash = 0;
  for (let i = 0; i < orgName.length; i++) {
    hash = ((hash << 5) - hash) + orgName.charCodeAt(i);
    hash = hash & hash;
  }
  const color = colors[Math.abs(hash) % colors.length];
  const letter = orgName.charAt(0).toUpperCase();
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" rx="6" fill="${color}"/><text x="12" y="16.5" text-anchor="middle" font-size="13" font-family="system-ui,sans-serif" fill="#fff" font-weight="700">${letter}</text></svg>`)}`;
}

// Icon cache: orgSlug -> { url, dataUrl }
// Memory cache (service worker lifetime)
const orgIconCache = {};

async function fetchIconAsDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || '';
  // Reject HTML responses (some CDN 404s return HTML with 200)
  if (ct.includes('text/html')) return null;
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const mime = ct.split(';')[0].trim() || 'image/png';
  return `data:${mime};base64,${base64}`;
}

async function loadIconCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ iconCache: {} }, (d) => resolve(d.iconCache));
  });
}

async function saveIconCache(cache) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ iconCache: cache }, resolve);
  });
}

async function resolveOrgIcon(orgSlug) {
  // 1. Memory cache hit
  if (orgIconCache[orgSlug]) return orgIconCache[orgSlug];

  // 2. Local storage cache hit
  const stored = await loadIconCache();
  if (stored[orgSlug]) {
    orgIconCache[orgSlug] = stored[orgSlug];
    return stored[orgSlug];
  }

  // 3. Scrape org page to find icon URL
  let iconUrl = null;
  try {
    const pageRes = await fetch(`https://openrouter.ai/${encodeURIComponent(orgSlug)}`);
    if (pageRes.ok) {
      const html = await pageRes.text();
      const match = html.match(/\/images\/icons\/([^"'\s]+\.(?:svg|png))/);
      if (match) {
        iconUrl = `https://openrouter.ai${match[0]}`;
      }
    }
  } catch {}

  // 4. Download icon and convert to data URL
  let result;
  if (iconUrl) {
    try {
      const dataUrl = await fetchIconAsDataUrl(iconUrl);
      result = dataUrl || iconUrl; // fallback to remote URL if conversion fails
    } catch {
      result = iconUrl;
    }
  } else {
    result = generateFallbackIcon(orgSlug);
  }

  // 5. Persist to memory + local storage
  orgIconCache[orgSlug] = result;
  stored[orgSlug] = result;
  await saveIconCache(stored);

  return result;
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
    const orgSlug = modelId.split('/')[0] || modelId;
    await resolveOrgIcon(orgSlug); // pre-cache icon to local storage
    return {
      id: model.id,
      name: model.name,
      context_length: model.context_length,
      prompt_cost: model.pricing?.prompt,
      completion_cost: model.pricing?.completion,
      org_icon: orgSlug // store slug, not URL — options page resolves from local cache
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleBatchFetchModelInfo(modelIds) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const allModels = data.data || [];

    const results = {};
    for (const modelId of modelIds) {
      const model = allModels.find((m) => m.id === modelId);
      const orgSlug = modelId.split('/')[0] || modelId;
      await resolveOrgIcon(orgSlug); // pre-cache icon
      if (model) {
        results[modelId] = {
          context_length: model.context_length,
          prompt_cost: model.pricing?.prompt,
          completion_cost: model.pricing?.completion,
          org_icon: orgSlug
        };
      } else {
        results[modelId] = { org_icon: orgSlug, notFound: true };
      }
    }
    return { results };
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
        max_tokens: 5,
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
