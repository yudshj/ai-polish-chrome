const i18n = (key) => chrome.i18n.getMessage(key) || key;

document.addEventListener('DOMContentLoaded', () => {
  // i18n labels
  document.getElementById('labelApiKey').textContent = i18n('popupApiKey');
  document.getElementById('labelModel').textContent = i18n('popupModel');
  document.getElementById('labelApiUrl').textContent = i18n('popupApiUrl');
  document.getElementById('openSettings').textContent = i18n('popupOpenSettings');
  document.getElementById('settingsIcon').title = i18n('popupSettings');
  document.getElementById('keyStatus').textContent = i18n('popupNotSet');

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

  const openOpts = () => chrome.runtime.openOptionsPage();
  document.getElementById('openSettings').addEventListener('click', openOpts);
  document.getElementById('settingsIcon').addEventListener('click', openOpts);
});
