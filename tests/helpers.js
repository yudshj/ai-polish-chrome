const path = require('path');
const fs = require('fs');
const os = require('os');
const puppeteer = require('puppeteer');

const EXTENSION_PATH = path.resolve(__dirname, '..');

/**
 * Copy the extension to a temp directory and modify the manifest
 * to make optional_host_permissions into required host_permissions.
 * This avoids needing to grant permissions via Chrome UI during tests.
 */
function prepareExtension() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aip-test-'));
  const exclude = [
    'node_modules', 'tests', 'package.json', 'package-lock.json',
    'jest.config.js', '.git', '.DS_Store', 'store_assets',
  ];
  copyDirSync(EXTENSION_PATH, tmpDir, exclude);

  // Modify manifest: move optional_host_permissions → host_permissions
  const manifestPath = path.join(tmpDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  if (manifest.optional_host_permissions) {
    manifest.host_permissions = [
      ...(manifest.host_permissions || []),
      ...manifest.optional_host_permissions,
    ];
    delete manifest.optional_host_permissions;
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return tmpDir;
}

function copyDirSync(src, dest, exclude = []) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, exclude);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function launchBrowser() {
  const extPath = prepareExtension();
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--disable-default-apps',
      '--disable-search-engine-choice-screen',
    ],
    pipe: true,
  });
  browser._extPath = extPath;
  return browser;
}

async function getServiceWorker(browser) {
  const target = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().includes('background'),
    { timeout: 10000 }
  );
  const worker = await target.worker();
  const extId = new URL(worker.url()).hostname;

  return { worker, extId, target };
}

async function ensureContentScriptsRegistered(worker) {
  await worker.evaluate(async () => {
    try {
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['aip-content'] });
      if (existing.length > 0) return;
      await chrome.scripting.registerContentScripts([{
        id: 'aip-content',
        matches: ['*://*/*'],
        js: ['content/content.js'],
        css: ['content/content.css'],
        runAt: 'document_idle',
        allFrames: true,
      }]);
    } catch (e) {
      // Already registered — ignore
    }
  });
}

async function openPopup(browser, extId) {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/popup/popup.html`, {
    waitUntil: 'domcontentloaded',
  });
  return page;
}

async function openOptionsPage(browser, extId) {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/options/options.html`, {
    waitUntil: 'domcontentloaded',
  });
  return page;
}

async function setStorage(worker, data) {
  await worker.evaluate(async (d) => {
    await chrome.storage.sync.set(d);
  }, data);
}

async function getStorage(worker, keys) {
  return worker.evaluate(async (k) => {
    return chrome.storage.sync.get(k);
  }, keys);
}

async function createTestPage(browser, mockServerUrl) {
  const page = await browser.newPage();
  await page.goto(`${mockServerUrl}/test-page`, { waitUntil: 'load' });
  return page;
}

/**
 * Wait for a new page (tab) to be created whose URL contains the given substring.
 * Must be called BEFORE the action that opens the page.
 */
async function waitForNewPage(browser, urlSubstring, timeout = 5000) {
  const existingPages = new Set();
  for (const p of await browser.pages()) {
    existingPages.add(p);
  }

  const start = Date.now();
  while (Date.now() - start < timeout) {
    const pages = await browser.pages();
    for (const p of pages) {
      if (!existingPages.has(p) && p.url().includes(urlSubstring)) {
        return p;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(`Timeout waiting for new page with "${urlSubstring}" in URL`);
}

async function cleanupBrowser(browser) {
  if (browser._extPath) {
    fs.rmSync(browser._extPath, { recursive: true, force: true });
  }
  await browser.close();
}

module.exports = {
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
};
