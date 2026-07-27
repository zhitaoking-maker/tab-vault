import assert from 'node:assert/strict';
import test from 'node:test';

import { expireUndo, handleMessage, scheduleUndoExpiry, UNDO_EXPIRY_ALARM } from '../src/background.js';
import { buildWorkspace } from '../src/lib/workspace-core.js';

function createChromeMock({ incognitoWindowIds = [] } = {}) {
  const storage = {};
  const removedTabs = [];
  const createdTabs = [];
  const createdWindows = [];
  const alarmCreates = [];
  const tabs = [
    { id: 101, windowId: 1, index: 0, url: 'https://first.example/', title: 'First', active: true },
    { id: 201, windowId: 2, index: 0, url: 'https://second.example/', title: 'Second', active: true },
  ];
  let getCurrentCalls = 0;
  let nextWindowId = 10;
  let nextTabId = 1000;

  return {
    api: {
      runtime: { getURL: (path) => `chrome-extension://tab-vault/${path}` },
      alarms: {
        async create(name, info) {
          alarmCreates.push({ name, info });
        },
        async clear() {},
      },
      windows: {
        async getCurrent() {
          getCurrentCalls += 1;
          return { id: 1, incognito: false };
        },
        async get(windowId) {
          return { id: windowId, incognito: incognitoWindowIds.includes(windowId) };
        },
        async create(details) {
          const windowId = nextWindowId++;
          const tab = { id: nextTabId++, windowId, index: 0, url: details.url, active: true };
          createdTabs.push(tab);
          createdWindows.push({ details, windowId, tab });
          return { id: windowId, tabs: [tab] };
        },
      },
      tabs: {
        async query(query) {
          return query.windowId ? tabs.filter((tab) => tab.windowId === query.windowId) : tabs;
        },
        async create(details) {
          const tab = { id: nextTabId++, ...details };
          createdTabs.push(tab);
          return tab;
        },
        async update(id, changes) {
          return { id, ...changes };
        },
        async remove(ids) {
          removedTabs.push(...(Array.isArray(ids) ? ids : [ids]));
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
            Object.assign(storage, values);
          },
          async getBytesInUse() {
            return new TextEncoder().encode(JSON.stringify(storage)).byteLength;
          },
        },
      },
    },
    createdTabs,
    createdWindows,
    alarmCreates,
    getCurrentCalls: () => getCurrentCalls,
    removedTabs,
    storage,
  };
}

test('save-current uses the window explicitly supplied by the popup', async () => {
  const mock = createChromeMock();

  const result = await handleMessage({ type: 'save-current', windowId: 2 }, mock.api);

  assert.equal(result.saved, true);
  assert.equal(mock.storage.workspaces[0].tabs[0].url, 'https://second.example/');
  assert.deepEqual(mock.removedTabs, [201]);
  assert.equal(mock.createdTabs[0].windowId, 2);
  assert.deepEqual(mock.alarmCreates, [{ name: UNDO_EXPIRY_ALARM, info: { when: result.undo.expiresAt } }]);
  assert.equal(mock.getCurrentCalls(), 0);
});

test('save-current keeps a backward-compatible fallback for callers without a window id', async () => {
  const mock = createChromeMock();

  const result = await handleMessage({ type: 'save-current' }, mock.api);

  assert.equal(result.saved, true);
  assert.equal(mock.storage.workspaces[0].tabs[0].url, 'https://first.example/');
  assert.equal(mock.getCurrentCalls(), 1);
});

test('save-current refuses an explicitly targeted incognito window', async () => {
  const mock = createChromeMock({ incognitoWindowIds: [2] });

  const result = await handleMessage({ type: 'save-current', windowId: 2 }, mock.api);

  assert.deepEqual(result, { saved: false, reason: 'incognito-window' });
  assert.deepEqual(mock.removedTabs, []);
});

test('background message handler reads state and restores an existing workspace', async () => {
  const mock = createChromeMock();
  const workspace = buildWorkspace([
    { index: 0, url: 'https://restore.example/', title: 'Restore', active: true },
  ]);
  mock.storage.workspaces = [workspace];

  const state = await handleMessage({ type: 'get-state' }, mock.api);
  const result = await handleMessage({ type: 'restore-workspace', workspaceId: workspace.id }, mock.api);

  assert.equal(state.workspaces[0].id, workspace.id);
  assert.equal(result.restored, true);
  assert.equal(mock.createdWindows.length, 1);
  assert.ok(mock.storage.workspaces[0].lastRestoredAt);
});

test('background message handler reports missing workspaces and undo records', async () => {
  const mock = createChromeMock();

  const restored = await handleMessage({ type: 'restore-workspace', workspaceId: 'missing' }, mock.api);
  const undone = await handleMessage({ type: 'undo-save' }, mock.api);
  const unknown = await handleMessage({ type: 'not-a-message' }, mock.api);

  assert.deepEqual(restored, { restored: false, reason: 'missing' });
  assert.deepEqual(undone, { undone: false, reason: 'missing' });
  assert.deepEqual(unknown, { error: 'Unknown message type' });
});

test('background message handler renames, pins, and moves deleted workspaces to trash', async () => {
  const mock = createChromeMock();
  const workspace = buildWorkspace([]);
  mock.storage.workspaces = [workspace];

  const invalidRename = await handleMessage({ type: 'rename-workspace', workspaceId: workspace.id, title: ' ' }, mock.api);
  const renamed = await handleMessage({ type: 'rename-workspace', workspaceId: workspace.id, title: '收尾' }, mock.api);
  const pinned = await handleMessage({ type: 'toggle-workspace-pin', workspaceId: workspace.id }, mock.api);
  const missingPin = await handleMessage({ type: 'toggle-workspace-pin', workspaceId: 'missing' }, mock.api);
  const updatedWorkspace = mock.storage.workspaces[0];
  const deleted = await handleMessage({ type: 'delete-workspace', workspaceId: workspace.id }, mock.api);

  assert.equal(invalidRename.renamed, false);
  assert.equal(renamed.renamed, true);
  assert.equal(updatedWorkspace.title, '收尾');
  assert.equal(pinned.pinned, true);
  assert.deepEqual(missingPin, { pinned: false, reason: 'missing' });
  assert.deepEqual(deleted, { deleted: true });
  assert.deepEqual(mock.storage.workspaces, []);
  assert.equal(mock.storage.trash[0].id, workspace.id);
});

test('background exports, previews, and non-destructively imports workspaces', async () => {
  const mock = createChromeMock();
  const workspace = buildWorkspace([{ index: 0, url: 'https://backup.example/', title: 'Backup' }]);
  mock.storage.workspaces = [workspace];

  const exported = await handleMessage({ type: 'export-workspaces' }, mock.api);
  const text = JSON.stringify(exported.payload);
  const preview = await handleMessage({ type: 'preview-import', text }, mock.api);
  const imported = await handleMessage({ type: 'import-workspaces', text }, mock.api);

  assert.equal(exported.exported, true);
  assert.equal(exported.payload.schemaVersion, 1);
  assert.equal(preview.valid, true);
  assert.equal(preview.workspaceCount, 1);
  assert.equal(preview.duplicateCount, 1);
  assert.equal(preview.willFit, true);
  assert.ok(preview.estimatedBytesAfterImport > 0);
  assert.equal(imported.imported, true);
  assert.equal(imported.importedCount, 0);
  assert.equal(mock.storage.workspaces.length, 1);
});

test('background batch deletion moves every selected workspace to trash', async () => {
  const mock = createChromeMock();
  const first = buildWorkspace([]);
  const second = buildWorkspace([]);
  const third = buildWorkspace([]);
  mock.storage.workspaces = [first, second, third];

  const result = await handleMessage({
    type: 'delete-workspaces',
    workspaceIds: [first.id, third.id],
  }, mock.api);

  assert.equal(result.deleted, true);
  assert.equal(result.deletedCount, 2);
  assert.deepEqual(mock.storage.workspaces.map((item) => item.id), [second.id]);
  assert.deepEqual(new Set(mock.storage.trash.map((item) => item.id)), new Set([first.id, third.id]));
});

test('background rejects invalid imports, empty exports, and empty batch selections', async () => {
  const mock = createChromeMock();

  const exported = await handleMessage({ type: 'export-workspaces' }, mock.api);
  const preview = await handleMessage({ type: 'preview-import', text: '{broken' }, mock.api);
  const imported = await handleMessage({ type: 'import-workspaces', text: '{broken' }, mock.api);
  const deleted = await handleMessage({ type: 'delete-workspaces', workspaceIds: [] }, mock.api);

  assert.deepEqual(exported, { exported: false, reason: 'no-workspaces' });
  assert.deepEqual(preview, { valid: false, reason: 'invalid-json' });
  assert.deepEqual(imported, { imported: false, reason: 'invalid-json' });
  assert.deepEqual(deleted, { deleted: false, reason: 'no-selected-workspaces' });
});

test('background reports missing trash targets and can empty the trash', async () => {
  const mock = createChromeMock();
  mock.storage.trash = [];

  const restored = await handleMessage({ type: 'restore-trash-workspace', workspaceId: 'missing' }, mock.api);
  const removed = await handleMessage({ type: 'permanently-delete-trash', workspaceId: 'missing' }, mock.api);
  const emptied = await handleMessage({ type: 'empty-trash' }, mock.api);

  assert.deepEqual(restored, { restored: false, reason: 'missing' });
  assert.deepEqual(removed, { deleted: false, reason: 'missing' });
  assert.deepEqual(emptied, { deleted: true });
});

test('deleting every selected tab moves the complete workspace snapshot to trash', async () => {
  const mock = createChromeMock();
  const workspace = buildWorkspace([
    { index: 0, url: 'https://first.example/', title: 'First' },
    { index: 1, url: 'https://second.example/', title: 'Second' },
  ]);
  mock.storage.workspaces = [workspace];

  const result = await handleMessage({
    type: 'delete-workspace-tabs',
    workspaceId: workspace.id,
    tabIndexes: [0, 1],
  }, mock.api);

  assert.equal(result.workspaceDeleted, true);
  assert.equal(mock.storage.trash[0].tabs.length, 2);
});

test('background restores and permanently deletes trash entries', async () => {
  const mock = createChromeMock();
  const workspace = buildWorkspace([]);
  mock.storage.workspaces = [workspace];

  await handleMessage({ type: 'delete-workspace', workspaceId: workspace.id }, mock.api);
  const restored = await handleMessage({ type: 'restore-trash-workspace', workspaceId: workspace.id }, mock.api);
  await handleMessage({ type: 'delete-workspace', workspaceId: workspace.id }, mock.api);
  const removed = await handleMessage({ type: 'permanently-delete-trash', workspaceId: workspace.id }, mock.api);

  assert.equal(restored.restored, true);
  assert.equal(mock.storage.workspaces.length, 0);
  assert.equal(removed.deleted, true);
  assert.deepEqual(mock.storage.trash, []);
});

test('background message handler deletes only selected workspace tabs', async () => {
  const mock = createChromeMock();
  const workspace = buildWorkspace([
    { index: 0, url: 'https://first.example/', title: 'First' },
    { index: 1, url: 'https://second.example/', title: 'Second' },
  ]);
  mock.storage.workspaces = [workspace];

  const result = await handleMessage({ type: 'delete-workspace-tabs', workspaceId: workspace.id, tabIndexes: [0] }, mock.api);

  assert.deepEqual(result, { deleted: true, workspaceDeleted: false, removedTabCount: 1 });
  assert.deepEqual(mock.storage.workspaces[0].tabs.map((tab) => tab.index), [1]);
});

test('expireUndo clears an expired undo record', async () => {
  const mock = createChromeMock();
  mock.storage.undo = { expiresAt: 1_000 };

  const expired = await expireUndo(mock.api, 1_000);

  assert.equal(expired, true);
  assert.equal(mock.storage.undo, null);
});

test('scheduleUndoExpiry clears undo at its exact deadline without a page refresh', async () => {
  const mock = createChromeMock();
  mock.storage.undo = { expiresAt: 1_010 };
  let scheduled;

  scheduleUndoExpiry(mock.api, 1_010, {
    now: 1_000,
    setTimer(callback, delay) {
      scheduled = { callback, delay };
      return { unref() {} };
    },
  });
  await scheduled.callback();

  assert.equal(scheduled.delay, 10);
  assert.equal(mock.storage.undo, null);
});
