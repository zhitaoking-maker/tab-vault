import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkspace,
  deleteWorkspaceTabs,
  normalizeWorkspace,
  renameWorkspace,
  restoreWorkspace,
  sortWorkspaces,
  toggleWorkspacePin,
  getStoredState,
  isRestorableUrl,
  saveCurrentWindow,
  undoLastSave,
} from '../src/lib/workspace-core.js';

function createChromeMock({ tabs = [], storage = {}, failStorageSet = false } = {}) {
  const calls = { createdTabs: [], removedTabs: [], createdWindows: [], updatedTabs: [] };
  let nextTabId = 100;
  let nextWindowId = 20;

  const api = {
    tabs: {
      async query() {
        return tabs;
      },
      async create(details) {
        const tab = {
          id: nextTabId++,
          windowId: details.windowId ?? nextWindowId,
          index: details.index ?? 0,
          url: details.url,
          pinned: Boolean(details.pinned),
          active: details.active ?? false,
        };
        calls.createdTabs.push(tab);
        return tab;
      },
      async remove(ids) {
        calls.removedTabs.push(...(Array.isArray(ids) ? ids : [ids]));
      },
      async update(id, changes) {
        calls.updatedTabs.push({ id, changes });
        return { id, ...changes };
      },
      async get(id) {
        return calls.createdTabs.find((tab) => tab.id === id) ?? { id, url: 'about:blank' };
      },
    },
    windows: {
      async create(details) {
        const windowId = nextWindowId++;
        const tab = {
          id: nextTabId++,
          windowId,
          index: 0,
          url: details.url,
          pinned: false,
          active: true,
        };
        calls.createdWindows.push({ details, windowId, tab });
        calls.createdTabs.push(tab);
        return { id: windowId, tabs: [tab] };
      },
    },
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return { ...storage };
          if (typeof keys === 'string') return { [keys]: storage[keys] };
          return Object.fromEntries(keys.map((key) => [key, storage[key]]));
        },
        async set(values) {
          if (failStorageSet) throw new Error('QUOTA_BYTES exceeded');
          Object.assign(storage, values);
        },
        async getBytesInUse() {
          return new TextEncoder().encode(JSON.stringify(storage)).byteLength;
        },
      },
    },
  };

  return { api, calls, storage };
}

const sourceTabs = [
  { id: 1, windowId: 7, index: 0, url: 'https://example.com/', title: 'Example', favIconUrl: 'https://example.com/favicon.ico', pinned: true, active: false },
  { id: 2, windowId: 7, index: 1, url: 'chrome://settings/', title: 'Settings', favIconUrl: '', pinned: false, active: false },
  { id: 3, windowId: 7, index: 2, url: 'https://news.example.com/', title: 'News', favIconUrl: '', pinned: false, active: true },
];

test('buildWorkspace preserves source order and marks unsupported tabs', () => {
  const workspace = buildWorkspace(sourceTabs, new Date('2026-07-23T08:30:00Z'));

  assert.equal(workspace.tabs.length, 3);
  assert.deepEqual(workspace.tabs.map((tab) => tab.index), [0, 1, 2]);
  assert.equal(workspace.tabs[0].pinned, true);
  assert.equal(workspace.tabs[1].restorable, false);
  assert.equal(workspace.tabs[2].active, true);
  assert.equal(workspace.title, '7月23日 · 3 个标签');
  assert.equal(workspace.pinned, false);
});

test('normalizes legacy workspaces and sorts pinned entries before the time line', () => {
  const legacy = { ...buildWorkspace([], new Date('2026-07-22T08:00:00Z')) };
  delete legacy.pinned;
  const recent = { ...buildWorkspace([], new Date('2026-07-23T08:00:00Z')), pinned: false };
  const pinned = { ...buildWorkspace([], new Date('2026-07-21T08:00:00Z')), pinned: true };

  assert.equal(normalizeWorkspace(legacy).pinned, false);
  assert.deepEqual(sortWorkspaces([recent, pinned, legacy]).map((workspace) => workspace.id), [pinned.id, recent.id, legacy.id]);
});

test('renames a workspace with trimmed text and rejects an empty or oversized name', () => {
  const workspace = buildWorkspace([]);

  const renamed = renameWorkspace([workspace], workspace.id, '  研究选题  ');

  assert.equal(renamed.ok, true);
  assert.equal(renamed.workspaces[0].title, '研究选题');
  assert.equal(renameWorkspace([workspace], workspace.id, ' ').ok, false);
  assert.equal(renameWorkspace([workspace], workspace.id, 'a'.repeat(61)).ok, false);
});

test('toggles a workspace pin without changing its other snapshot data', () => {
  const workspace = buildWorkspace(sourceTabs);

  const result = toggleWorkspacePin([workspace], workspace.id);

  assert.equal(result.ok, true);
  assert.equal(result.workspaces[0].pinned, true);
  assert.equal(result.workspaces[0].tabs[0].url, sourceTabs[0].url);
});

test('deletes selected tabs from a workspace and deletes the workspace when it becomes empty', () => {
  const workspace = buildWorkspace(sourceTabs);

  const partial = deleteWorkspaceTabs([workspace], workspace.id, [0]);
  const emptied = deleteWorkspaceTabs(partial.workspaces, workspace.id, [1, 2]);

  assert.equal(partial.ok, true);
  assert.equal(partial.removedTabCount, 1);
  assert.equal(partial.workspaceDeleted, false);
  assert.deepEqual(partial.workspaces[0].tabs.map((tab) => tab.index), [1, 2]);
  assert.equal(partial.workspaces[0].tabCount, 2);
  assert.equal(emptied.ok, true);
  assert.equal(emptied.workspaceDeleted, true);
  assert.deepEqual(emptied.workspaces, []);
});

test('recognizes URLs Chrome can restore', () => {
  assert.equal(isRestorableUrl('https://example.com'), true);
  assert.equal(isRestorableUrl('http://localhost:3000'), true);
  assert.equal(isRestorableUrl('file:///C:/note.html'), false);
  assert.equal(isRestorableUrl('chrome://settings'), false);
  assert.equal(isRestorableUrl(''), false);
});

test('saveCurrentWindow stores only recoverable webpages and lands on the dashboard', async () => {
  const { api, calls, storage } = createChromeMock({ tabs: sourceTabs });
  const result = await saveCurrentWindow(api, 7, {
    now: new Date('2026-07-23T08:30:00Z'),
    placeholderUrl: 'chrome-extension://tab-vault/dashboard.html',
  });

  assert.equal(storage.workspaces.length, 1);
  assert.equal(storage.workspaces[0].tabs.length, 2);
  assert.equal(storage.workspaces[0].tabs[0].title, 'Example');
  assert.deepEqual(calls.removedTabs, [1, 3]);
  assert.equal(calls.createdTabs[0].url, 'chrome-extension://tab-vault/dashboard.html');
  assert.equal(storage.undo.workspaceId, result.workspace.id);
  assert.equal(storage.undo.windowId, 7);
});

test('saveCurrentWindow reloads an existing dashboard tab before removing source tabs', async () => {
  const dashboardUrl = 'chrome-extension://tab-vault/dashboard.html';
  const { api, calls } = createChromeMock({
    tabs: [...sourceTabs, { id: 4, windowId: 7, index: 3, url: dashboardUrl, title: 'Tab Vault' }],
  });

  await saveCurrentWindow(api, 7, { placeholderUrl: dashboardUrl });

  assert.equal(calls.createdTabs.length, 0);
  assert.deepEqual(calls.updatedTabs[0], { id: 4, changes: { url: dashboardUrl, active: true } });
});

test('saveCurrentWindow does nothing for an empty window', async () => {
  const { api, calls, storage } = createChromeMock();
  const result = await saveCurrentWindow(api, 7);

  assert.deepEqual(result, { saved: false, reason: 'empty-window' });
  assert.equal(calls.createdTabs.length, 0);
  assert.deepEqual(storage, {});
});

test('saveCurrentWindow refuses to create a dead workspace from browser and extension pages', async () => {
  const utilityTabs = [
    { id: 1, windowId: 7, index: 0, url: 'about:blank', title: 'about:blank' },
    { id: 2, windowId: 7, index: 1, url: 'chrome-extension://tab-vault/dashboard.html', title: 'Tab Vault' },
  ];
  const { api, calls, storage } = createChromeMock({ tabs: utilityTabs });

  const result = await saveCurrentWindow(api, 7);

  assert.deepEqual(result, { saved: false, reason: 'no-recoverable-tabs' });
  assert.deepEqual(calls.removedTabs, []);
  assert.equal(calls.createdTabs.length, 0);
  assert.deepEqual(storage, {});
});

test('saveCurrentWindow never closes source tabs when storage rejects the snapshot', async () => {
  const { api, calls } = createChromeMock({ tabs: sourceTabs, failStorageSet: true });

  const result = await saveCurrentWindow(api, 7, {
    placeholderUrl: 'chrome-extension://tab-vault/dashboard.html',
  });

  assert.equal(result.saved, false);
  assert.equal(result.reason, 'storage-full');
  assert.deepEqual(calls.removedTabs.filter((id) => [1, 2, 3].includes(id)), []);
});

test('getStoredState sorts workspaces and clears an expired undo record', async () => {
  const older = buildWorkspace([], new Date('2026-07-22T08:00:00Z'));
  const newer = buildWorkspace([], new Date('2026-07-23T08:00:00Z'));
  const { api, storage } = createChromeMock({
    storage: { workspaces: [older, newer], undo: { expiresAt: 1 } },
  });

  const state = await getStoredState(api, 2);

  assert.deepEqual(state.workspaces.map((workspace) => workspace.id), [newer.id, older.id]);
  assert.equal(state.undo, null);
  assert.equal(storage.undo, null);
});

test('restoreWorkspace opens the snapshot active tab first and skips unsupported tabs', async () => {
  const { api, calls } = createChromeMock();
  const workspace = buildWorkspace(sourceTabs, new Date('2026-07-23T08:30:00Z'));
  await restoreWorkspace(api, workspace);

  assert.equal(calls.createdWindows.length, 1);
  assert.equal(calls.createdWindows[0].details.url, 'https://news.example.com/');
  assert.equal(calls.createdTabs.filter((tab) => tab.url === 'https://news.example.com/').length, 1);
  assert.deepEqual(calls.updatedTabs.map((entry) => entry.changes), [{ pinned: true }, { active: true }]);
});

test('restoreWorkspace restores selected tabs even when matching URLs are open elsewhere', async () => {
  const { api, calls } = createChromeMock();
  const workspace = buildWorkspace(sourceTabs, new Date('2026-07-23T08:30:00Z'));

  const result = await restoreWorkspace(api, workspace, {
    tabIndexes: [0, 2],
    openUrls: ['https://example.com/'],
  });

  assert.equal(result.restoredCount, 2);
  assert.equal(result.skippedDuplicateCount, 0);
  assert.equal(result.skippedUnsupportedCount, 0);
  assert.equal(calls.createdWindows[0].details.url, 'https://news.example.com/');
  assert.equal(calls.createdTabs.filter((tab) => tab.url === 'https://example.com/').length, 1);
});

test('restoreWorkspace preserves duplicate URLs within the same snapshot', async () => {
  const { api, calls } = createChromeMock();
  const workspace = buildWorkspace([
    { ...sourceTabs[0], index: 0, pinned: false },
    { ...sourceTabs[0], index: 1, pinned: false, active: true },
  ]);

  const result = await restoreWorkspace(api, workspace, { openUrls: [] });

  assert.equal(result.restoredCount, 2);
  assert.equal(calls.createdTabs.filter((tab) => tab.url === 'https://example.com/').length, 2);
});

test('restoreWorkspace reports a workspace with no recoverable tabs without creating a window', async () => {
  const { api, calls } = createChromeMock();
  const workspace = buildWorkspace([{ ...sourceTabs[1] }]);

  const result = await restoreWorkspace(api, workspace);

  assert.deepEqual(result, {
    restoredCount: 0,
    failedCount: 0,
    failedTabs: [],
    skippedCount: 1,
    skippedDuplicateCount: 0,
    skippedUnsupportedCount: 1,
    unsupportedCount: 1,
    pinFailedCount: 0,
  });
  assert.equal(calls.createdWindows.length, 0);
});

test('restoreWorkspace continues after one tab fails and returns retryable tab indexes', async () => {
  const { api, calls } = createChromeMock();
  const workspace = buildWorkspace([
    { index: 0, url: 'https://first.example/', title: 'First', active: true },
    { index: 1, url: 'https://broken.example/', title: 'Broken' },
    { index: 2, url: 'https://last.example/', title: 'Last' },
  ]);
  const originalCreate = api.tabs.create;
  api.tabs.create = async (details) => {
    if (details.url === 'https://broken.example/') throw new Error('Blocked by browser');
    return originalCreate(details);
  };

  const result = await restoreWorkspace(api, workspace);

  assert.equal(result.restoredCount, 2);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.failedTabs.map((tab) => tab.index), [1]);
  assert.ok(calls.createdTabs.some((tab) => tab.url === 'https://last.example/'));
});

test('restoreWorkspace falls back to another opener when the active URL cannot create a window', async () => {
  const { api, calls } = createChromeMock();
  const workspace = buildWorkspace([
    { index: 0, url: 'https://broken.example/', title: 'Broken', active: true },
    { index: 1, url: 'https://working.example/', title: 'Working' },
  ]);
  const originalWindowCreate = api.windows.create;
  api.windows.create = async (details) => {
    if (details.url === 'https://broken.example/') throw new Error('Cannot open');
    return originalWindowCreate(details);
  };

  const result = await restoreWorkspace(api, workspace);

  assert.equal(result.restoredCount, 2);
  assert.equal(result.failedCount, 0);
  assert.equal(calls.createdWindows[0].details.url, 'https://working.example/');
  assert.ok(calls.createdTabs.some((tab) => tab.url === 'https://broken.example/'));
});

test('restoreWorkspace reports all tabs when no URL can create a window', async () => {
  const { api } = createChromeMock();
  const workspace = buildWorkspace([
    { index: 0, url: 'https://first.example/', title: 'First', active: true },
    { index: 1, url: 'https://second.example/', title: 'Second' },
  ]);
  api.windows.create = async () => { throw new Error('Cannot create window'); };

  const result = await restoreWorkspace(api, workspace);

  assert.equal(result.restoredCount, 0);
  assert.equal(result.failedCount, 2);
  assert.deepEqual(result.failedTabs.map((tab) => tab.index), [0, 1]);
});

test('restoreWorkspace reports pin failures without treating opened tabs as missing', async () => {
  const { api } = createChromeMock();
  const workspace = buildWorkspace([{ ...sourceTabs[0], active: true }]);
  api.tabs.update = async (_id, changes) => {
    if (changes.pinned) throw new Error('Cannot pin');
    throw new Error('Focus changed');
  };

  const result = await restoreWorkspace(api, workspace);

  assert.equal(result.restoredCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(result.pinFailedCount, 1);
});

test('getStoredState prunes expired trash and falls back when byte usage API is unavailable', async () => {
  const item = buildWorkspace([]);
  const { api, storage } = createChromeMock({
    storage: { trash: [{ ...item, deletedAt: '2026-01-01T00:00:00.000Z' }] },
  });
  delete api.storage.local.getBytesInUse;

  const result = await getStoredState(api, Date.parse('2026-07-26T00:00:00.000Z'));

  assert.deepEqual(result.trash, []);
  assert.deepEqual(storage.trash, []);
  assert.ok(result.storageHealth.bytesInUse > 0);
});

test('restoring succeeds when the dashboard landing tab was already closed', async () => {
  const { api, calls } = createChromeMock();
  api.tabs.remove = async (ids) => {
    const tabIds = Array.isArray(ids) ? ids : [ids];
    if (tabIds.includes(99)) throw new Error('No tab with id: 99');
    calls.removedTabs.push(...tabIds);
  };
  const workspace = buildWorkspace([sourceTabs[0]]);

  await restoreWorkspace(api, workspace, { windowId: 7, replaceTabId: 99 });

  assert.ok(calls.createdTabs.some((tab) => tab.url === 'https://example.com/'));
});

test('undoLastSave restores into the original window and removes the dashboard landing tab', async () => {
  const workspace = buildWorkspace(sourceTabs, new Date('2026-07-23T08:30:00Z'));
  const undo = { workspaceId: workspace.id, workspace, windowId: 7, placeholderTabId: 99, expiresAt: Date.now() + 10_000 };
  const { api, calls, storage } = createChromeMock({ storage: { undo } });
  api.tabs.get = async () => ({ id: 99, url: 'chrome-extension://tab-vault/dashboard.html' });

  const result = await undoLastSave(api);

  assert.equal(result.undone, true);
  assert.equal(calls.createdWindows.length, 0);
  assert.ok(calls.createdTabs.some((tab) => tab.windowId === 7 && tab.url === 'https://example.com/'));
  assert.ok(calls.removedTabs.includes(99));
  assert.equal(storage.undo, null);
});

test('undoLastSave expires without opening tabs', async () => {
  const { api, calls, storage } = createChromeMock({
    storage: { undo: { workspace: buildWorkspace(sourceTabs), expiresAt: Date.now() - 1 } },
  });

  const result = await undoLastSave(api);

  assert.deepEqual(result, { undone: false, reason: 'expired' });
  assert.equal(calls.createdTabs.length, 0);
  assert.equal(storage.undo, null);
});

test('undoLastSave reports a missing undo record', async () => {
  const { api } = createChromeMock();

  const result = await undoLastSave(api);

  assert.deepEqual(result, { undone: false, reason: 'missing' });
});
