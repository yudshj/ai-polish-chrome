const i18n = (key) => chrome.i18n.getMessage(key) || key;

document.addEventListener('DOMContentLoaded', () => {
  // i18n labels
  document.getElementById('labelApiKey').textContent = i18n('popupApiKey');
  document.getElementById('labelModel').textContent = i18n('popupModel');
  document.getElementById('labelApiUrl').textContent = i18n('popupApiUrl');
  document.getElementById('openSettings').textContent = i18n('popupOpenSettings');
  document.getElementById('settingsIcon').title = i18n('popupSettings');
  document.getElementById('keyStatus').textContent = i18n('popupNotSet');
  document.getElementById('permText').textContent = i18n('popupPermText');
  document.getElementById('permBtn').textContent = i18n('popupPermBtn');

  // Check host permission
  chrome.permissions.contains({ origins: ['*://*/*'] }, (granted) => {
    if (!granted) {
      document.getElementById('permBanner').style.display = 'block';
    }
  });

  document.getElementById('permBtn').addEventListener('click', () => {
    chrome.permissions.request({ origins: ['*://*/*'] }, (granted) => {
      if (granted) {
        document.getElementById('permBanner').style.display = 'none';
        chrome.runtime.sendMessage({ action: 'registerContentScripts' });
      }
    });
  });

  chrome.storage.sync.get({
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: '',
    model: 'google/gemini-3-flash-preview'
  }, (settings) => {
    const keyEl = document.getElementById('keyStatus');
    if (settings.apiKey) {
      keyEl.textContent = i18n('popupConfigured');
      keyEl.className = 'badge badge-ok';
    }
    document.getElementById('modelName').textContent = settings.model;
    const urlEl = document.getElementById('apiUrl');
    urlEl.textContent = settings.apiUrl;
    urlEl.title = settings.apiUrl;
  });

  // ---- Skip site toggle ----

  const skipRow = document.getElementById('skipRow');
  const skipHost = document.getElementById('skipHost');
  const skipToggle = document.getElementById('skipToggle');
  let currentHostname = '';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.url) return;
    try {
      const url = new URL(tabs[0].url);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      currentHostname = url.hostname;
      skipHost.textContent = currentHostname;
      skipRow.style.display = 'flex';
      loadSkipState();
    } catch {}
  });

  function loadSkipState() {
    chrome.storage.sync.get({ skipSites: [] }, (data) => {
      updateSkipUI(data.skipSites.includes(currentHostname));
    });
  }

  function updateSkipUI(isSkipped) {
    if (isSkipped) {
      skipToggle.textContent = i18n('popupSiteSkipped');
      skipToggle.className = 'skip-toggle skipped';
      skipToggle.title = i18n('popupUnskipSite');
    } else {
      skipToggle.textContent = i18n('popupSkipSite');
      skipToggle.className = 'skip-toggle';
      skipToggle.title = '';
    }
  }

  skipToggle.addEventListener('click', () => {
    if (!currentHostname) return;
    chrome.storage.sync.get({ skipSites: [] }, (data) => {
      const sites = data.skipSites;
      const idx = sites.indexOf(currentHostname);
      if (idx >= 0) {
        sites.splice(idx, 1);
      } else {
        sites.push(currentHostname);
      }
      chrome.storage.sync.set({ skipSites: sites }, () => {
        updateSkipUI(idx < 0);
      });
    });
  });

  const openOpts = () => chrome.runtime.openOptionsPage();
  document.getElementById('openSettings').addEventListener('click', openOpts);
  document.getElementById('settingsIcon').addEventListener('click', openOpts);
});
