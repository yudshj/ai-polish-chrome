const { startServer } = require('./mock-server');
const {
  launchBrowser,
  getServiceWorker,
  ensureContentScriptsRegistered,
  openPopup,
  openOptionsPage,
  setStorage,
  getStorage,
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
      prompt: 'Custom prompt here',
    });

    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('#apiUrl');

    const apiUrl = await page.$eval('#apiUrl', (el) => el.value);
    const apiKey = await page.$eval('#apiKey', (el) => el.value);
    const model = await page.$eval('#modelSelect', (el) => el.value);
    const prompt = await page.$eval('#prompt', (el) => el.value);

    expect(apiUrl).toBe('https://custom.api/v1/chat');
    expect(apiKey).toBe('my-key-123');
    expect(model).toBe('openai/gpt-5.2');
    expect(prompt).toBe('Custom prompt here');
    await page.close();
  });

  test('Save button persists settings', async () => {
    const page = await openOptionsPage(browser, extId);
    await page.waitForSelector('#apiUrl');

    // Set new values via evaluate (form reads .value directly on save)
    await page.evaluate(() => {
      document.getElementById('apiUrl').value = 'https://new-api.example/v1/chat';
      document.getElementById('apiKey').value = 'new-key-456';
      document.getElementById('modelSelect').value = 'anthropic/claude-opus-4.6';
      document.getElementById('prompt').value = 'New custom prompt';
    });

    await page.click('#save');
    // Wait for toast to appear (indicates save completed)
    await page.waitForSelector('.toast.show', { timeout: 5000 });

    // Verify storage was updated
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

  test('Model info fetch', async () => {
    // Use CDP Fetch domain to intercept the hardcoded OpenRouter API request
    const cdp = await swTarget.createCDPSession();

    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: '*openrouter.ai/api/v1/models*' }],
    });

    cdp.on('Fetch.requestPaused', async (event) => {
      try {
        if (event.request.url.includes('openrouter.ai/api/v1/models')) {
          await cdp.send('Fetch.fulfillRequest', {
            requestId: event.requestId,
            responseCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: 'application/json' },
            ],
            body: Buffer.from(
              JSON.stringify({
                data: [
                  {
                    id: 'google/gemini-3-flash-preview',
                    name: 'Gemini 3 Flash Preview',
                    context_length: 1000000,
                    pricing: { prompt: '0.000001', completion: '0.000004' },
                  },
                ],
              })
            ).toString('base64'),
          });
        } else {
          await cdp.send('Fetch.continueRequest', {
            requestId: event.requestId,
          });
        }
      } catch {
        // Session may have been detached
      }
    });

    // Set a preset model so auto-fetch triggers on page load
    await setStorage(worker, { model: 'google/gemini-3-flash-preview' });
    const page = await openOptionsPage(browser, extId);

    // Wait for model info body to become visible
    await page.waitForSelector('.model-info-body.visible', { timeout: 10000 });

    const ctxValue = await page.$eval('#infoCtxValue', (el) => el.textContent);
    expect(ctxValue).toContain('1,000,000');

    // Clean up CDP session
    try {
      await cdp.send('Fetch.disable');
      await cdp.detach();
    } catch {
      // Ignore detach errors
    }
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
