const { startServer } = require('./mock-server');
const {
  launchBrowser,
  getServiceWorker,
  ensureContentScriptsRegistered,
  openPopup,
  openOptionsPage,
  setStorage,
  getStorage,
  setLocalStorage,
  getLocalStorage,
  createTestPage,
  waitForNewPage,
  cleanupBrowser,
} = require('./helpers');

let browser, worker, extId, swTarget, mockServer;

beforeAll(async () => {
  mockServer = await startServer();
  browser = await launchBrowser();
  const sw = await getServiceWorker(browser);
  worker = sw.worker;
  extId = sw.extId;
  swTarget = sw.target;
  await ensureContentScriptsRegistered(worker);
}, 30000);

afterAll(async () => {
  if (browser) await cleanupBrowser(browser);
  if (mockServer) await mockServer.stop();
});

// ---------------------------------------------------------------------------
// Suite 1: Extension loads correctly
// ---------------------------------------------------------------------------

describe('Extension loads correctly', () => {
  test('Service worker starts', async () => {
    expect(worker).toBeDefined();
    const url = worker.url();
    expect(url).toContain('background/background.js');
  });

  test('Content script injects on test page', async () => {
    const page = await createTestPage(browser, mockServer.url);
    await page.click('#testTextarea');
    const btn = await page.waitForSelector('.aip-btn', { visible: true, timeout: 5000 });
    expect(btn).not.toBeNull();
    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Content script — button & panel
// ---------------------------------------------------------------------------

describe('Content script — button & panel', () => {
  let page;

  beforeAll(async () => {
    page = await createTestPage(browser, mockServer.url);
  });

  afterAll(async () => {
    await page.close();
  });

  test('Button appears on textarea focus', async () => {
    await page.click('#testTextarea');
    const btn = await page.waitForSelector('.aip-btn', { visible: true, timeout: 5000 });
    expect(btn).not.toBeNull();
  });

  test('Button appears on input focus', async () => {
    await page.click('#testInput');
    await page.waitForSelector('.aip-btn', { visible: true, timeout: 3000 });
  });

  test('Button appears on contenteditable focus', async () => {
    await page.click('#testContentEditable');
    await page.waitForSelector('.aip-btn', { visible: true, timeout: 3000 });
  });

  test('Button hides on blur', async () => {
    await page.click('#testTextarea');
    await page.waitForSelector('.aip-btn', { visible: true, timeout: 3000 });
    // Blur by removing focus from the textarea
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForSelector('.aip-btn', { hidden: true, timeout: 3000 });
  });

  test('Panel shows on button hover', async () => {
    await page.click('#testTextarea');
    await page.waitForSelector('.aip-btn', { visible: true, timeout: 3000 });
    await page.hover('.aip-btn');
    await page.waitForSelector('.aip-panel.aip-visible', { timeout: 3000 });
  });

  test('Panel has correct elements', async () => {
    // Panel should still be visible from previous hover (or re-trigger)
    await page.click('#testTextarea');
    await page.waitForSelector('.aip-btn', { visible: true, timeout: 3000 });
    await page.hover('.aip-btn');
    await page.waitForSelector('.aip-panel.aip-visible', { timeout: 3000 });

    // Language selector with 4 options
    const options = await page.$$eval(
      '.aip-lang-select option',
      (opts) => opts.map((o) => o.value)
    );
    expect(options).toEqual(['auto', '中文', 'English', '日本語']);

    // Polish button exists
    const polishBtn = await page.$('.aip-polish-btn');
    expect(polishBtn).not.toBeNull();

    // Gear icon exists
    const gear = await page.$('.aip-panel-gear');
    expect(gear).not.toBeNull();
  });

  test('Gear icon opens options page', async () => {
    // Ensure panel is visible
    await page.click('#testTextarea');
    await page.waitForSelector('.aip-btn', { visible: true, timeout: 3000 });
    await page.hover('.aip-btn');
    await page.waitForSelector('.aip-panel.aip-visible', { timeout: 3000 });

    // Close any existing options pages
    for (const p of await browser.pages()) {
      if (p.url().includes('options/options.html') && p !== page) await p.close();
    }

    // Hover gear to keep panel visible, start page watcher, then click
    await page.hover('.aip-panel-gear');
    const newPagePromise = waitForNewPage(browser, 'options');
    await page.click('.aip-panel-gear');
    const newPage = await newPagePromise;
    expect(newPage.url()).toContain('options/options.html');
    await newPage.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Content script — polish flow (with mock server)
// ---------------------------------------------------------------------------

describe('Content script — polish flow', () => {
  let page;

  beforeEach(async () => {
    await setStorage(worker, {
      apiUrl: `${mockServer.url}/chat/completions`,
      apiKey: 'test-key-123',
      model: 'test-model',
    });
    page = await createTestPage(browser, mockServer.url);
  });

  afterEach(async () => {
    if (page && !page.isClosed()) await page.close();
  });

  async function openPanelAndClickPolish(pg) {
    await pg.waitForSelector('.aip-btn', { visible: true, timeout: 5000 });
    await pg.hover('.aip-btn');
    await pg.waitForSelector('.aip-panel.aip-visible', { timeout: 3000 });
    await pg.hover('.aip-polish-btn');
    await pg.click('.aip-polish-btn');
  }

  test('Polish replaces text', async () => {
    await page.click('#testTextarea');
    await page.type('#testTextarea', 'Hello world this is a test');
    await openPanelAndClickPolish(page);

    // Wait for polish to complete (undo button appears)
    await page.waitForSelector('.aip-undo-btn', { visible: true, timeout: 15000 });

    const text = await page.$eval('#testTextarea', (el) => el.value);
    expect(text).toBe('This is the polished text.');
  });

  test('Undo restores original text', async () => {
    const originalText = 'Original text for undo test';
    await page.click('#testTextarea');
    await page.type('#testTextarea', originalText);
    await openPanelAndClickPolish(page);

    await page.waitForSelector('.aip-undo-btn', { visible: true, timeout: 15000 });

    // Click undo
    await page.click('.aip-undo-btn');

    const text = await page.$eval('#testTextarea', (el) => el.value);
    expect(text).toBe(originalText);
  });

  test('Empty text shows error', async () => {
    await page.click('#testTextarea');
    // Don't type anything — textarea is empty
    await page.waitForSelector('.aip-btn', { visible: true, timeout: 5000 });
    await page.hover('.aip-btn');
    await page.waitForSelector('.aip-panel.aip-visible', { timeout: 3000 });
    await page.hover('.aip-polish-btn');
    await page.click('.aip-polish-btn');

    // Status message should appear (not success — just a message)
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.aip-status');
        return el && el.style.display !== 'none' && el.textContent.trim().length > 0;
      },
      { timeout: 5000 }
    );

    const hasSuccess = await page.$eval('.aip-status', (el) =>
      el.classList.contains('aip-success')
    );
    expect(hasSuccess).toBe(false);
  });

  test('API error shows message', async () => {
    // Change storage to invalid API URL (background reads settings at polish time)
    await setStorage(worker, {
      apiUrl: 'http://127.0.0.1:1/invalid',
      apiKey: 'test-key-123',
      model: 'test-model',
    });

    await page.click('#testTextarea');
    await page.type('#testTextarea', 'Some text to polish');
    await openPanelAndClickPolish(page);

    // Wait for error status (not success)
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.aip-status');
        return (
          el &&
          el.style.display !== 'none' &&
          !el.classList.contains('aip-success') &&
          el.textContent.trim().length > 0
        );
      },
      { timeout: 15000 }
    );

    const statusText = await page.$eval('.aip-status', (el) => el.textContent);
    expect(statusText).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Suite 3b: Content script — skip sites
// ---------------------------------------------------------------------------

describe('Content script — skip sites', () => {
  afterEach(async () => {
    await setStorage(worker, { skipSites: [] });
  });

  test('Button does not appear when site is skipped', async () => {
    await setStorage(worker, { skipSites: ['127.0.0.1'] });
    const page = await createTestPage(browser, mockServer.url);

    await page.click('#testTextarea');

    let appeared = true;
    try {
      await page.waitForSelector('.aip-btn', { visible: true, timeout: 2000 });
    } catch {
      appeared = false;
    }
    expect(appeared).toBe(false);

    await page.close();
  });

  test('Button hides when site is added to skip list (no reload)', async () => {
    const page = await createTestPage(browser, mockServer.url);

    await page.click('#testTextarea');
    await page.waitForSelector('.aip-btn', { visible: true, timeout: 5000 });

    // Add site to skip list — no page reload
    await setStorage(worker, { skipSites: ['127.0.0.1'] });

    // Button should hide via storage.onChanged
    await page.waitForSelector('.aip-btn', { hidden: true, timeout: 5000 });

    await page.close();
  });

  test('Button reappears after removing site from skip list (no reload)', async () => {
    await setStorage(worker, { skipSites: ['127.0.0.1'] });
    const page = await createTestPage(browser, mockServer.url);

    // Confirm button does not appear
    await page.click('#testTextarea');
    let appeared = true;
    try {
      await page.waitForSelector('.aip-btn', { visible: true, timeout: 2000 });
    } catch {
      appeared = false;
    }
    expect(appeared).toBe(false);

    // Remove site — no page reload
    await setStorage(worker, { skipSites: [] });

    // Wait for storage change propagation, then re-trigger focus
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => document.activeElement.blur());
    await new Promise((r) => setTimeout(r, 200));
    await page.click('#testTextarea');

    await page.waitForSelector('.aip-btn', { visible: true, timeout: 5000 });

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Popup
// ---------------------------------------------------------------------------

describe('Popup', () => {
  test('Shows API key status', async () => {
    // Set API key → should show "Configured" with badge-ok
    await setStorage(worker, { apiKey: 'my-secret-key' });
    let page = await openPopup(browser, extId);

    const keyStatus = await page.$eval('#keyStatus', (el) => ({
      text: el.textContent,
      className: el.className,
    }));
    expect(keyStatus.className).toContain('badge-ok');
    await page.close();

    // Clear API key → should show "Not Set" with badge-warn
    await setStorage(worker, { apiKey: '' });
    page = await openPopup(browser, extId);
    const keyStatus2 = await page.$eval('#keyStatus', (el) => el.className);
    expect(keyStatus2).toContain('badge-warn');
    await page.close();
  });

  test('Shows model name', async () => {
    await setStorage(worker, { model: 'test-model-xyz' });
    const page = await openPopup(browser, extId);
    const modelText = await page.$eval('#modelName', (el) => el.textContent);
    expect(modelText).toBe('test-model-xyz');
    await page.close();
  });

  test('Settings button opens options page', async () => {
    const page = await openPopup(browser, extId);

    // Close any existing options pages
    for (const p of await browser.pages()) {
      if (p.url().includes('options/options.html') && p !== page) await p.close();
    }

    const optionsPromise = waitForNewPage(browser, 'options');
    await page.click('#settingsIcon');
    const optionsPage = await optionsPromise;
    expect(optionsPage.url()).toContain('options/options.html');
    await optionsPage.close();
    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Options page
// ---------------------------------------------------------------------------

describe('Options page', () => {
  test('Loads saved settings', async () => {
    await setStorage(worker, {
      apiUrl: 'https://custom.api/v1/chat',
      apiKey: 'my-key-123',
      model: 'openai/gpt-5.2',
      models: [{ id: 'openai/gpt-5.2' }, { id: 'test-model' }],
      prompt: 'Custom prompt here',
    });

    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('#apiUrl');

    const apiUrl = await page.$eval('#apiUrl', (el) => el.value);
    const apiKey = await page.$eval('#apiKey', (el) => el.value);
    const prompt = await page.$eval('#prompt', (el) => el.value);

    expect(apiUrl).toBe('https://custom.api/v1/chat');
    expect(apiKey).toBe('my-key-123');
    expect(prompt).toBe('Custom prompt here');

    // Selected model should be highlighted in the list
    const selectedModel = await page.$eval('.model-item.selected .model-item-name', (el) => el.textContent);
    expect(selectedModel).toBe('openai/gpt-5.2');
    await page.close();
  });

  test('Save button persists settings', async () => {
    await setStorage(worker, {
      models: [{ id: 'anthropic/claude-opus-4.6' }, { id: 'test-model' }],
      model: 'anthropic/claude-opus-4.6',
    });
    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('#apiUrl');

    // Set new values via evaluate (form reads .value directly on save)
    await page.evaluate(() => {
      document.getElementById('apiUrl').value = 'https://new-api.example/v1/chat';
      document.getElementById('apiKey').value = 'new-key-456';
      document.getElementById('prompt').value = 'New custom prompt';
    });

    await page.click('#save');
    await page.waitForSelector('.toast.show', { timeout: 5000 });

    const stored = await getStorage(worker, ['apiUrl', 'apiKey', 'model', 'prompt']);
    expect(stored.apiUrl).toBe('https://new-api.example/v1/chat');
    expect(stored.apiKey).toBe('new-key-456');
    expect(stored.model).toBe('anthropic/claude-opus-4.6');
    expect(stored.prompt).toBe('New custom prompt');
    await page.close();
  });

  test('Reset prompt button restores default', async () => {
    await setStorage(worker, { prompt: 'Modified prompt' });
    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('#prompt');

    // Verify modified prompt loaded
    const before = await page.$eval('#prompt', (el) => el.value);
    expect(before).toBe('Modified prompt');

    // Click reset
    await page.click('#resetPrompt');

    const after = await page.$eval('#prompt', (el) => el.value);
    expect(after).toContain('professional text polishing assistant');
    await page.close();
  });

  test('API test button — success', async () => {
    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('#apiUrl');

    // Fill form with mock server URL and a key
    await page.evaluate(
      (url) => {
        document.getElementById('apiUrl').value = url;
        document.getElementById('apiKey').value = 'test-key';
      },
      `${mockServer.url}/chat/completions`
    );

    await page.click('#testApi');
    await page.waitForSelector('.test-result.success', { timeout: 10000 });

    const text = await page.$eval('#testResult', (el) => el.textContent);
    expect(text).toBeTruthy();
    await page.close();
  });

  test('API test button — failure', async () => {
    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('#apiUrl');

    await page.evaluate(() => {
      document.getElementById('apiUrl').value = 'http://127.0.0.1:1/invalid';
      document.getElementById('apiKey').value = 'test-key';
    });

    await page.click('#testApi');
    await page.waitForSelector('.test-result.error', { timeout: 10000 });

    const text = await page.$eval('#testResult', (el) => el.textContent);
    expect(text).toBeTruthy();
    await page.close();
  });

  test('Skip sites textarea loads and saves', async () => {
    await setStorage(worker, { skipSites: ['example.com', 'test.org'] });
    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('#skipSitesText');

    const text = await page.$eval('#skipSitesText', (el) => el.value);
    expect(text).toBe('example.com\ntest.org');

    // Modify and save
    await page.evaluate(() => {
      document.getElementById('skipSitesText').value = 'new-site.com\nanother.org';
    });
    await page.click('#save');
    await page.waitForSelector('.toast.show', { timeout: 5000 });

    const stored = await getStorage(worker, ['skipSites']);
    expect(stored.skipSites).toEqual(['new-site.com', 'another.org']);

    await page.close();
    await setStorage(worker, { skipSites: [] });
  });

  test('Model list renders with correct models', async () => {
    await setStorage(worker, {
      models: [
        { id: 'google/gemini-3-flash-preview', context_length: 1000000 },
        { id: 'openai/gpt-5.2' },
      ],
      model: 'google/gemini-3-flash-preview',
    });

    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('.model-item');

    const modelNames = await page.$$eval('.model-item-name', (els) =>
      els.map((el) => el.textContent)
    );
    expect(modelNames).toContain('google/gemini-3-flash-preview');
    expect(modelNames).toContain('openai/gpt-5.2');

    // First model should have context info rendered
    const meta = await page.$eval('.model-item.selected .model-item-meta', (el) => el.textContent);
    expect(meta).toContain('1M');

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: i18n
// ---------------------------------------------------------------------------

describe('i18n', () => {
  test('i18n strings are resolved (no raw __MSG_ keys)', async () => {
    const page = await openPopup(browser, extId);
    const text = await page.evaluate(() => document.body.innerText);

    // Should not contain raw __MSG_ keys (all i18n strings should be resolved)
    expect(text).not.toContain('__MSG_');

    // Page should have meaningful content (not empty)
    expect(text.trim().length).toBeGreaterThan(10);

    // Key UI elements should have text content
    const keyStatus = await page.$eval('#keyStatus', (el) => el.textContent);
    expect(keyStatus.trim().length).toBeGreaterThan(0);

    const openSettings = await page.$eval('#openSettings', (el) => el.textContent);
    expect(openSettings.trim().length).toBeGreaterThan(0);
    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 7: Chat mode
// ---------------------------------------------------------------------------

describe('Content script — chat mode', () => {
  let page;

  beforeEach(async () => {
    await setStorage(worker, {
      apiUrl: `${mockServer.url}/chat/completions`,
      apiKey: 'test-key-123',
      model: 'test-model',
    });
    page = await createTestPage(browser, mockServer.url);
  });

  afterEach(async () => {
    if (page && !page.isClosed()) await page.close();
  });

  test('Chat mode checkbox exists in panel', async () => {
    await page.click('#testTextarea');
    await page.waitForSelector('.aip-btn', { visible: true, timeout: 5000 });
    await page.hover('.aip-btn');
    await page.waitForSelector('.aip-panel.aip-visible', { timeout: 3000 });

    const checkbox = await page.$('.aip-chat-checkbox');
    expect(checkbox).not.toBeNull();

    // Default unchecked
    const checked = await page.$eval('.aip-chat-checkbox', (el) => el.checked);
    expect(checked).toBe(false);
  });

  test('Chat mode sends text as-is (no polish prompt wrapping)', async () => {
    const rawText = 'What is 2+2?';
    await page.click('#testTextarea');
    await page.type('#testTextarea', rawText);

    await page.waitForSelector('.aip-btn', { visible: true, timeout: 5000 });
    await page.hover('.aip-btn');
    await page.waitForSelector('.aip-panel.aip-visible', { timeout: 3000 });

    // Enable chat mode
    await page.click('.aip-chat-checkbox');
    const checked = await page.$eval('.aip-chat-checkbox', (el) => el.checked);
    expect(checked).toBe(true);

    // Click polish
    await page.hover('.aip-polish-btn');
    await page.click('.aip-polish-btn');

    // Wait for completion
    await page.waitForSelector('.aip-undo-btn', { visible: true, timeout: 15000 });

    // Check what the mock server received
    const res = await fetch(`${mockServer.url}/last-request`);
    const lastReq = await res.json();

    // In chat mode, the user message should be the raw text (no "professional text polishing" wrapper)
    const userMsg = lastReq.messages?.[0]?.content;
    expect(userMsg).toBe(rawText);
  });

  test('Normal mode wraps text in polish prompt', async () => {
    // Ensure default prompt is used
    await setStorage(worker, {
      apiUrl: `${mockServer.url}/chat/completions`,
      apiKey: 'test-key-123',
      model: 'test-model',
      prompt: `You are a professional text polishing assistant.\n\nTarget language: {{targetLanguage}}\n\nText to polish:\n{{text}}`,
    });
    // Re-create page to pick up fresh settings
    if (page && !page.isClosed()) await page.close();
    page = await createTestPage(browser, mockServer.url);

    const rawText = 'Hello world test';
    await page.click('#testTextarea');
    await page.type('#testTextarea', rawText);

    await page.waitForSelector('.aip-btn', { visible: true, timeout: 5000 });
    await page.hover('.aip-btn');
    await page.waitForSelector('.aip-panel.aip-visible', { timeout: 3000 });

    // Ensure chat mode is OFF
    const checked = await page.$eval('.aip-chat-checkbox', (el) => el.checked);
    expect(checked).toBe(false);

    await page.hover('.aip-polish-btn');
    await page.click('.aip-polish-btn');
    await page.waitForSelector('.aip-undo-btn', { visible: true, timeout: 15000 });

    const res = await fetch(`${mockServer.url}/last-request`);
    const lastReq = await res.json();
    const userMsg = lastReq.messages?.[0]?.content;

    // Should contain the polish prompt template text
    expect(userMsg).toContain('professional text polishing');
    expect(userMsg).toContain(rawText);
  });
});

// ---------------------------------------------------------------------------
// Suite 8: Panel positioning (above/below)
// ---------------------------------------------------------------------------

describe('Content script — panel positioning', () => {
  test('Panel appears above when textarea is at bottom of viewport', async () => {
    const page = await browser.newPage();
    await page.goto(`${mockServer.url}/test-page-bottom`, { waitUntil: 'load' });

    await page.click('#bottomTextarea');
    await page.waitForSelector('.aip-btn', { visible: true, timeout: 5000 });
    await page.hover('.aip-btn');
    await page.waitForSelector('.aip-panel.aip-visible', { timeout: 3000 });

    // Panel should have the aip-above class
    const hasAbove = await page.$eval('.aip-panel', (el) => el.classList.contains('aip-above'));
    expect(hasAbove).toBe(true);

    // Panel top should be above the button top
    const positions = await page.evaluate(() => {
      const panel = document.querySelector('.aip-panel');
      const btn = document.querySelector('.aip-btn');
      return {
        panelBottom: panel.getBoundingClientRect().bottom,
        btnTop: btn.getBoundingClientRect().top,
      };
    });
    expect(positions.panelBottom).toBeLessThanOrEqual(positions.btnTop + 2); // allow small rounding

    await page.close();
  });

  test('Panel appears below when textarea is at top of viewport', async () => {
    const page = await createTestPage(browser, mockServer.url);

    await page.click('#testTextarea');
    await page.waitForSelector('.aip-btn', { visible: true, timeout: 5000 });
    await page.hover('.aip-btn');
    await page.waitForSelector('.aip-panel.aip-visible', { timeout: 3000 });

    // Panel should NOT have the aip-above class
    const hasAbove = await page.$eval('.aip-panel', (el) => el.classList.contains('aip-above'));
    expect(hasAbove).toBe(false);

    // Panel top should be below the button bottom
    const positions = await page.evaluate(() => {
      const panel = document.querySelector('.aip-panel');
      const btn = document.querySelector('.aip-btn');
      return {
        panelTop: panel.getBoundingClientRect().top,
        btnBottom: btn.getBoundingClientRect().bottom,
      };
    });
    expect(positions.panelTop).toBeGreaterThanOrEqual(positions.btnBottom - 2);

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 9: Model drag-to-reorder
// ---------------------------------------------------------------------------

describe('Options page — model drag-to-reorder', () => {
  test('Model items have drag handles', async () => {
    await setStorage(worker, {
      models: [{ id: 'model-a' }, { id: 'model-b' }],
      model: 'model-a',
    });
    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('.model-item');

    const handles = await page.$$('.model-item-handle');
    expect(handles.length).toBe(2);

    // Items should be draggable
    const draggable = await page.$$eval('.model-item', (items) =>
      items.map((el) => el.draggable)
    );
    expect(draggable).toEqual([true, true]);

    await page.close();
  });

  test('Drag reorder persists new order', async () => {
    await setStorage(worker, {
      models: [{ id: 'first-model' }, { id: 'second-model' }, { id: 'third-model' }],
      model: 'first-model',
    });
    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('.model-item');

    // Simulate drag: move third-model (index 2) to index 0
    // Use evaluate to directly manipulate the models array via the drag/drop logic
    await page.evaluate(() => {
      // Simulate the effect of a drag: reorder the models array
      const items = document.querySelectorAll('.model-item');
      // Trigger dragstart on item 2
      const dragStartEvent = new DragEvent('dragstart', {
        bubbles: true,
        dataTransfer: new DataTransfer(),
      });
      items[2].dispatchEvent(dragStartEvent);

      // Trigger drop on item 0
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        dataTransfer: new DataTransfer(),
      });
      dropEvent.preventDefault = () => {};
      items[0].dispatchEvent(dropEvent);
    });

    // Wait a moment for persistence
    await new Promise((r) => setTimeout(r, 500));

    const stored = await getStorage(worker, ['models']);
    const ids = stored.models.map((m) => m.id);
    // After dragging item[2] onto item[0], the order should be: third, first, second
    expect(ids).toEqual(['third-model', 'first-model', 'second-model']);

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 10: Model add/delete (inline UI)
// ---------------------------------------------------------------------------

describe('Options page — model add/delete', () => {
  test('Add model via inline row', async () => {
    await setStorage(worker, {
      models: [{ id: 'existing-model' }],
      model: 'existing-model',
    });
    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('.model-item');

    // Click Add button
    await page.click('#addModelBtn');
    await page.waitForSelector('.model-add-row input', { timeout: 3000 });

    // Type new model ID and press Enter
    await page.type('.model-add-row input', 'new-org/new-model');
    await page.keyboard.press('Enter');

    // Wait for new model to appear in list
    await page.waitForFunction(
      () => {
        const names = [...document.querySelectorAll('.model-item-name')].map((el) => el.textContent);
        return names.includes('new-org/new-model');
      },
      { timeout: 5000 }
    );

    // Wait for storage to be updated
    await new Promise((r) => setTimeout(r, 500));
    const stored = await getStorage(worker, ['models']);
    const ids = stored.models.map((m) => m.id);
    expect(ids).toContain('new-org/new-model');

    await page.close();
  });

  test('Add duplicate model shows toast', async () => {
    await setStorage(worker, {
      models: [{ id: 'dup-model' }],
      model: 'dup-model',
    });
    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('.model-item');

    await page.click('#addModelBtn');
    await page.waitForSelector('.model-add-row input', { timeout: 3000 });
    await page.type('.model-add-row input', 'dup-model');
    await page.keyboard.press('Enter');

    // Toast should appear
    await page.waitForSelector('.toast.show', { timeout: 3000 });

    // Add row should still be present (not dismissed)
    const addRow = await page.$('.model-add-row');
    expect(addRow).not.toBeNull();

    await page.close();
  });

  test('Delete model with confirm modal', async () => {
    await setStorage(worker, {
      models: [{ id: 'keep-me' }, { id: 'delete-me' }],
      model: 'delete-me',
    });
    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('.model-item');

    // 'delete-me' should be selected
    const selected = await page.$eval('.model-item.selected .model-item-name', (el) => el.textContent);
    expect(selected).toBe('delete-me');

    // Click delete
    await page.click('#deleteModelBtn');
    await page.waitForSelector('.modal-overlay.visible', { timeout: 3000 });

    // Confirm deletion
    await page.click('#confirmModalConfirm');

    // Wait for model to be removed
    await page.waitForFunction(
      () => {
        const names = [...document.querySelectorAll('.model-item-name')].map((el) => el.textContent);
        return !names.includes('delete-me');
      },
      { timeout: 5000 }
    );

    const stored = await getStorage(worker, ['models']);
    const ids = stored.models.map((m) => m.id);
    expect(ids).not.toContain('delete-me');
    expect(ids).toContain('keep-me');

    await page.close();
  });

  test('Cancel delete does not remove model', async () => {
    await setStorage(worker, {
      models: [{ id: 'safe-model' }],
      model: 'safe-model',
    });
    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('.model-item');

    await page.click('#deleteModelBtn');
    await page.waitForSelector('.modal-overlay.visible', { timeout: 3000 });

    // Cancel
    await page.click('#confirmModalCancel');

    // Model should still be there
    await new Promise((r) => setTimeout(r, 300));
    const names = await page.$$eval('.model-item-name', (els) => els.map((el) => el.textContent));
    expect(names).toContain('safe-model');

    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 11: Icon caching (local storage)
// ---------------------------------------------------------------------------

describe('Options page — icon caching', () => {
  test('Clear info also clears icon cache', async () => {
    // Pre-populate icon cache
    await setLocalStorage(worker, {
      iconCache: { google: 'data:image/svg+xml,test', openai: 'data:image/svg+xml,test2' },
    });
    await setStorage(worker, {
      models: [
        { id: 'google/gemini', context_length: 100000, org_icon: 'google' },
      ],
      model: 'google/gemini',
    });

    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('.model-item');

    // Click clear info
    await page.click('#clearModelInfo');
    await page.waitForSelector('.modal-overlay.visible', { timeout: 3000 });
    await page.click('#confirmModalConfirm');

    await page.waitForSelector('.toast.show', { timeout: 5000 });

    // Icon cache should be empty
    const local = await getLocalStorage(worker, ['iconCache']);
    expect(local.iconCache).toEqual({});

    // Model context_length should be cleared
    const stored = await getStorage(worker, ['models']);
    expect(stored.models[0].context_length).toBeUndefined();

    await page.close();
  });

  test('Icons render from local cache', async () => {
    const fakeSvgDataUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect fill="red" width="24" height="24"/></svg>');
    await setLocalStorage(worker, {
      iconCache: { testorg: fakeSvgDataUrl },
    });
    await setStorage(worker, {
      models: [{ id: 'testorg/some-model', org_icon: 'testorg' }],
      model: 'testorg/some-model',
    });

    // Ensure storage writes propagate
    await new Promise((r) => setTimeout(r, 200));

    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('.model-item');

    // Wait for icon to be rendered (local storage load is async)
    await page.waitForFunction(
      () => {
        const icon = document.querySelector('.model-item-icon');
        return icon && icon.src && icon.src.includes('data:image');
      },
      { timeout: 5000 }
    );

    const iconSrc = await page.$eval('.model-item-icon', (el) => el.src);
    expect(iconSrc).toContain('data:image/svg+xml');

    // Icon should be visible (not display:none)
    const display = await page.$eval('.model-item-icon', (el) => getComputedStyle(el).display);
    expect(display).not.toBe('none');

    await page.close();
  });
});
