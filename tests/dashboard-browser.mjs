import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(path.join(os.tmpdir(), 'tab-vault-dashboard-'));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${pathname}`, (response) => {
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
    await new Promise((resolve) => setTimeout(resolve, 60));
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

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'dashboard.html' : pathname.slice(1);
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Forbidden');
    const body = await readFile(target);
    response.writeHead(200, { 'content-type': contentTypes[path.extname(target)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

let browser;
let cdp;
try {
  const webPort = await getFreePort();
  const debugPort = await getFreePort();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(webPort, '127.0.0.1', resolve);
  });

  browser = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-breakpad',
    '--disable-crash-reporter',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  await waitFor(() => getJson(debugPort, '/json/version'), 'Chrome remote debugging');
  const targets = await getJson(debugPort, '/json/list');
  const pageTarget = targets.find((target) => target.type === 'page');
  cdp = await createConnection(pageTarget.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const runtimeListeners = [];
      const storageListeners = [];
      const workspaces = Array.from({ length: 95 }, (_, index) => ({
        id: 'workspace-' + index,
        createdAt: new Date(Date.UTC(2026, 6, 27, 8, 0, 0) - index * 60000).toISOString(),
        lastRestoredAt: null,
        title: index === 0 ? '研究现场' : '工作区 ' + (index + 1),
        pinned: index < 2,
        tabCount: 2,
        tabs: [
          { index: 0, url: 'https://example.com/' + index, title: '资料 ' + index, favIconUrl: '', pinned: false, active: true, restorable: true },
          { index: 1, url: 'https://news.example.com/' + index, title: '新闻 ' + index, favIconUrl: '', pinned: false, active: false, restorable: true },
        ],
        groups: index === 0 ? [{ title: '研究', color: 'blue', collapsed: false, tabIndexes: [0, 1] }] : [],
      }));
      const state = {
        dataVersion: 2,
        workspaces,
        undo: null,
        trash: [],
        storageHealth: { bytesInUse: 1024 * 700, quotaBytes: 1024 * 1024 * 10, ratio: 0.07, warning: false },
      };
      globalThis.__tabVaultMessages = [];
      globalThis.__tabVaultClipboard = '';
      globalThis.confirm = () => true;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { async writeText(text) { globalThis.__tabVaultClipboard = text; } },
      });
      globalThis.chrome = {
        runtime: {
          onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
          async sendMessage(message) {
            globalThis.__tabVaultMessages.push(message);
            if (message.type === 'get-state') return structuredClone(state);
            if (message.type === 'set-workspaces-pin') {
              const ids = new Set(message.workspaceIds);
              for (const workspace of state.workspaces) if (ids.has(workspace.id)) workspace.pinned = Boolean(message.pinned);
              return { pinned: true, updatedCount: ids.size };
            }
            if (message.type === 'restore-workspace') {
              runtimeListeners.forEach((listener) => listener({
                type: 'restore-progress', restoreJobId: message.restoreJobId, phase: 'tabs',
                processedCount: 1, totalCount: 2, restoredCount: 1, failedCount: 0,
                groupCompletedCount: 0, groupTotalCount: 1,
              }));
              await new Promise((resolve) => setTimeout(resolve, 220));
              runtimeListeners.forEach((listener) => listener({
                type: 'restore-progress', restoreJobId: message.restoreJobId, phase: 'groups',
                processedCount: 2, totalCount: 2, restoredCount: 2, failedCount: 0,
                groupCompletedCount: 1, groupTotalCount: 1,
              }));
              return { restored: true, restoredCount: 2, failedCount: 0, unsupportedCount: 0, pinFailedCount: 0, groupFailedCount: 0 };
            }
            if (message.type === 'save-current-group') {
              return { saved: true, workspace: { tabCount: 2 } };
            }
            if (message.type === 'save-all-windows') {
              return { saved: true, workspaceCount: 2, tabCount: 4 };
            }
            return { deleted: true, renamed: true, exported: false };
          },
        },
        tabs: {
          async query() { return [{ id: 501, windowId: 1, groupId: 7, active: true }]; },
          async create() {},
        },
        storage: {
          local: {
            async get(keys) {
              const values = { appearance: { enabled: false, dim: 78, accent: '#c5e36b' } };
              if (keys == null) return values;
              if (typeof keys === 'string') return { [keys]: values[keys] };
              return Object.fromEntries(keys.map((key) => [key, values[key]]));
            },
            async set() {},
          },
          onChanged: { addListener(listener) { storageListeners.push(listener); } },
        },
      };
    })();`,
  });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${webPort}/dashboard.html` });

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };

  await waitFor(() => evaluate("document.querySelectorAll('.workspace-row').length === 40"), 'initial lazy list');
  assert.equal(await evaluate("document.querySelectorAll('.workspace-row').length"), 40);
  assert.equal(await evaluate("document.querySelector('#load-more').hidden"), false);

  await evaluate("document.querySelector('.workspace-title').click()");
  await waitFor(() => evaluate("Boolean(document.querySelector('.tab-group-badge'))"), 'tab group badge');
  assert.equal(await evaluate("document.querySelector('.tab-group-badge').textContent"), '研究');
  await evaluate("document.querySelector('.button-copy-list').click()");
  await waitFor(() => evaluate("globalThis.__tabVaultClipboard.includes('研究现场\\n\\n1. 资料 0\\n   https://example.com/0')"), 'readable clipboard copy');
  await evaluate("document.querySelector('.copy-format-menu').open = true; document.querySelector('[data-format=\"markdown\"]').click()");
  await waitFor(() => evaluate("globalThis.__tabVaultClipboard.includes('- [资料 0]')"), 'Markdown clipboard copy');
  assert.equal(await evaluate("document.querySelector('.copy-format-menu').open"), false);

  await evaluate("document.querySelector('#load-more').click()");
  await waitFor(() => evaluate("document.querySelectorAll('.workspace-row').length === 80"), 'second lazy list page');

  await evaluate("document.querySelector('#backup-toggle').click()");
  await waitFor(() => evaluate("document.querySelectorAll('.workspace-select').length === 80"), 'batch controls');
  await evaluate(`(() => {
    const boxes = [...document.querySelectorAll('.workspace-select')].slice(0, 2);
    for (const box of boxes) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
    document.querySelector('#pin-selected').click();
  })()`);
  await waitFor(() => evaluate("document.querySelector('#status').textContent.includes('已置顶 2 个工作区')"), 'batch pin result');

  await evaluate("document.querySelector('#backup-close').click(); document.querySelector('.workspace-row .button-restore').click()");
  await waitFor(() => evaluate("!document.querySelector('#restore-progress').hidden"), 'visible restore progress');
  assert.match(await evaluate("document.querySelector('#restore-progress-text').textContent"), /正在恢复标签/);
  await waitFor(() => evaluate("document.querySelector('#restore-progress').hidden && document.querySelector('#status').textContent.includes('已恢复 2 个')"), 'restore completion');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 760, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${webPort}/popup.html` });
  await waitFor(() => evaluate("Boolean(document.querySelector('#save-current-group'))"), 'popup advanced actions');
  assert.equal(await evaluate("document.querySelector('#save-current-group').disabled"), false);
  await evaluate("document.querySelector('#save-current-group').click()");
  await waitFor(() => evaluate("globalThis.__tabVaultMessages.some((message) => message.type === 'save-current-group' && message.groupId === 7)"), 'group save action');
  await evaluate("document.querySelector('#save-all-windows').click()");
  await waitFor(() => evaluate("globalThis.__tabVaultMessages.some((message) => message.type === 'save-all-windows')"), 'all-window save action');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  console.log('Browser UI test passed: dashboard workflows, popup advanced saves, clipboard copy, and narrow layouts.');
} finally {
  cdp?.close();
  if (browser && !browser.killed) {
    const exited = once(browser, 'exit');
    browser.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
