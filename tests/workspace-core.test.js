import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkspace,
  captureTabGroups,
  deleteWorkspaceTabs,
  normalizeWorkspace,
  renameWorkspace,
  restoreWorkspace,
  setWorkspacePins,
  sortWorkspaces,
  toggleWorkspacePin,
  getStoredState,
  isRestorableUrl,
  saveCurrentWindow,
  undoLastSave,
} from '../src/lib/workspace-core.js';

function createChromeMock({ tabs = [], storage = {}, failStorageSet = false } = {}) {
  const calls = {
    createdTabs: [],
    removedTabs: [],
    createdWindows: [],
    updatedTabs: [],
    groupedTabs: [],
    updatedGroups: [],
  };
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
      async group(details) {
        calls.groupedTabs.push(details);
        return 800 + calls.groupedTabs.length;
      },
    },
    tabGroups: {
      async get(groupId) {
        return {
          id: groupId,
          title: groupId === 12 ? '研究' : '资料',
          color: groupId === 12 ? 'blue' : 'grey',
          collapsed: groupId === 12,
        };
      },
      async update(groupId, changes) {
        calls.updatedGroups.push({ groupId, changes });
        return { id: groupId, ...changes };
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

test('captureTabGroups stores native group metadata and member indexes', async () => {
  const groupedTabs = [
    { ...sourceTabs[0], groupId: 12 },
    { ...sourceTabs[2], groupId: 12 },
    { index: 3, url: 'https://ungrouped.example/', groupId: -1 },
  ];
  const { api } = createChromeMock({ tabs: groupedTabs });

  const groups = await captureTabGroups(api, groupedTabs);

  assert.deepEqual(groups, [{ title: '研究', color: 'blue', collapsed: true, tabIndexes: [0, 2] }]);
});

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
  assert.deepEqual(normalizeWorkspace(legacy).groups, []);
  assert.deepEqual(sortWorkspaces([recent, pinned, legacy]).map((workspace) => workspace.id), [pinned.id, recent.id, legacy.id]);
});

test('buildWorkspace keeps valid tab groups and discards missing members', () => {
  const workspace = buildWorkspace(sourceTabs, new Date('2026-07-23T08:30:00Z'), [
    { title: '研究', color: 'blue', collapsed: true, tabIndexes: [0, 2, 99] },
  ]);

  assert.deepEqual(workspace.groups, [
    { title: '研究', color: 'blue', collapsed: true, tabIndexes: [0, 2] },
  ]);
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

test('sets the pin state for multiple selected workspaces', () => {
  const first = buildWorkspace(sourceTabs);
  const second = buildWorkspace([]);
  const third = buildWorkspace([]);
  third.pinned = true;

  const pinned = setWorkspacePins([first, second, third], [first.id, second.id], true);
  const unpinned = setWorkspacePins(pinned.workspaces, [second.id, third.id], false);

  assert.equal(pinned.ok, true);
  assert.equal(pinned.updatedCount, 2);
  assert.deepEqual(
    new Set(pinned.workspaces.filter((workspace) => workspace.pinned).map((workspace) => workspace.id)),
    new Set([first.id, second.id, third.id]),
  );
  assert.equal(unpinned.updatedCount, 2);
  assert.deepEqual(unpinned.workspaces.filter((workspace) => workspace.pinned).map((workspace) => workspace.id), [first.id]);
  assert.equal(setWorkspacePins([first], [], true).ok, false);
});

test('deletes selected tabs from a workspace and deletes the workspace when it becomes empty', () => {
  const workspace = buildWorkspace(sourceTabs, new Date(), [
    { title: '研究', color: 'blue', collapsed: false, tabIndexes: [0, 2] },
  ]);

  const partial = deleteWorkspaceTabs([workspace], workspace.id, [0]);
  const emptied = deleteWorkspaceTabs(partial.workspaces, workspace.id, [1, 2]);

  assert.equal(partial.ok, true);
  assert.equal(partial.removedTabCount, 1);
  assert.equal(partial.workspaceDeleted, false);
  assert.deepEqual(partial.workspaces[0].tabs.map((tab) => tab.index), [1, 2]);
  assert.deepEqual(partial.workspaces[0].groups[0].tabIndexes, [2]);
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

test('saveCurrentWindow captures native tab groups before closing source tabs', async () => {
  const groupedTabs = [
    { ...sourceTabs[0], groupId: 12 },
    { ...sourceTabs[2], groupId: 12 },
  ];
  const { api, storage } = createChromeMock({ tabs: groupedTabs });

  const result = await saveCurrentWindow(api, 7, {
    placeholderUrl: 'chrome-extension://tab-vault/dashboard.html',
  });

  assert.equal(result.saved, true);
  assert.deepEqual(storage.workspaces[0].groups, [
    { title: '研究', color: 'blue', collapsed: true, tabIndexes: [0, 2] },
  ]);
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
      groupRestoredCount: 0,
      groupFailedCount: 0,
      restoredGroups: [],
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

test('restoreWorkspace recreates native tab groups after restoring their members', async () => {
  const { api, calls } = createChromeMock();
  const workspace = buildWorkspace([
    { index: 0, url: 'https://first.example/', title: 'First', active: true },
    { index: 1, url: 'https://second.example/', title: 'Second' },
    { index: 2, url: 'https://third.example/', title: 'Third' },
  ], new Date(), [
    { title: '研究', color: 'blue', collapsed: true, tabIndexes: [0, 2] },
  ]);

  const result = await restoreWorkspace(api, workspace);

  assert.equal(result.groupRestoredCount, 1);
  assert.equal(result.groupFailedCount, 0);
  assert.equal(calls.groupedTabs.length, 1);
  assert.equal(calls.groupedTabs[0].tabIds.length, 2);
  assert.deepEqual(calls.updatedGroups[0].changes, { title: '研究', color: 'blue', collapsed: true });
});

test('restoreWorkspace reports incremental progress without stopping on failures', async () => {
  const { api } = createChromeMock();
  const workspace = buildWorkspace([
    { index: 0, url: 'https://first.example/', title: 'First', active: true },
    { index: 1, url: 'https://broken.example/', title: 'Broken' },
    { index: 2, url: 'https://last.example/', title: 'Last' },
  ]);
  const originalCreate = api.tabs.create;
  api.tabs.create = async (details) => {
    if (details.url === 'https://broken.example/') throw new Error('Blocked');
    return originalCreate(details);
  };
  const progress = [];

  const result = await restoreWorkspace(api, workspace, { onProgress: (event) => progress.push(event) });

  assert.equal(result.restoredCount, 2);
  assert.equal(progress[0].phase, 'tabs');
  assert.deepEqual(progress.at(-1), {
    phase: 'complete',
    processedCount: 3,
    totalCount: 3,
    restoredCount: 2,
    failedCount: 1,
    groupCompletedCount: 0,
    groupTotalCount: 0,
  });
});

test('retrying a failed grouped tab adds it back to the group created by the first restore', async () => {
  const { api, calls } = createChromeMock();
  const workspace = buildWorkspace([
    { index: 0, url: 'https://first.example/', title: 'First', active: true },
    { index: 1, url: 'https://broken.example/', title: 'Broken' },
  ], new Date(), [
    { title: '研究', color: 'blue', collapsed: false, tabIndexes: [0, 1] },
  ]);
  const originalCreate = api.tabs.create;
  let shouldFail = true;
  api.tabs.create = async (details) => {
    if (details.url === 'https://broken.example/' && shouldFail) throw new Error('Blocked');
    return originalCreate(details);
  };

  const first = await restoreWorkspace(api, workspace);
  shouldFail = false;
  const retry = await restoreWorkspace(api, workspace, {
    windowId: first.windowId,
    tabIndexes: [1],
    existingGroupIds: first.restoredGroups,
  });

  assert.equal(first.restoredGroups[0].snapshotIndex, 0);
  assert.equal(retry.restoredCount, 1);
  assert.equal(calls.groupedTabs[1].groupId, first.restoredGroups[0].groupId);
  assert.equal('createProperties' in calls.groupedTabs[1], false);
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
