import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = process.env.CHROMIUM_PATH;
const debugPort = 9229;
const profile = await mkdtemp(path.join(os.tmpdir(), 'tab-vault-chrome-'));

if (!chromePath) {
  console.log('Extension smoke test skipped: set CHROMIUM_PATH to a Chromium build that permits --load-extension.');
  await rm(profile, { recursive: true, force: true });
  process.exit(0);
}

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${debugPort}${pathname}`, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function waitFor(getValue, description, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await getValue();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${description} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

function createConnection(url) {
  const socket = new WebSocket(url);
  let messageId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const response = JSON.parse(event.data);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.error) request.reject(new Error(response.error.message));
    else request.resolve(response.result);
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const id = ++messageId;
        return new Promise((resolveRequest, rejectRequest) => {
          pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { socket.close(); },
    }));
    socket.addEventListener('error', reject, { once: true });
  });
}

let browser;
try {
  browser = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-breakpad',
    '--disable-crash-reporter',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  const version = await waitFor(() => getJson('/json/version'), 'Chrome remote debugging');
  const browserCdp = await createConnection(version.webSocketDebuggerUrl);
  const extensionId = 'nhgdlcffpejehikdfnncjcccoahonkpc';
  await browserCdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/dashboard.html` });

  const dashboardTarget = await waitFor(async () => {
    const pages = await getJson('/json/list');
    return pages.find((page) => page.url === `chrome-extension://${extensionId}/dashboard.html`);
  }, 'dashboard page');
  const pageCdp = await createConnection(dashboardTarget.webSocketDebuggerUrl);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const pageState = await pageCdp.send('Runtime.evaluate', {
    expression: '({ url: location.href, text: document.body.innerText })',
    returnByValue: true,
    awaitPromise: true,
  });
  const { url, text: bodyText } = pageState.result.value;

  assert.match(url, /dashboard\.html$/);
  assert.match(bodyText, /工作区时间线/);
  assert.match(bodyText, /还没有存下任何工作区/);
  const screenshot = await pageCdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(profile, 'dashboard.png'), screenshot.data, 'base64');
  pageCdp.close();
  browserCdp.close();
  console.log('Extension smoke test passed: manifest, service worker, and dashboard loaded.');
} finally {
  if (browser && !browser.killed) {
    const exited = once(browser, 'exit');
    browser.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
