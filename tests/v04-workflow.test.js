import assert from 'node:assert/strict';
import test from 'node:test';

import {
  saveAllWindows,
  saveCurrentTabGroup,
  undoLastSave,
} from '../src/lib/workspace-core.js';

function createChromeMock({ windows = [], storage = {}, failStorageSet = false } = {}) {
  const calls = { removedTabs: [], createdTabs: [], updatedTabs: [], createdWindows: [] };
  let nextTabId = 1000;
  let nextWindowId = 100;

  const findWindow = (windowId) => windows.find((window) => window.id === windowId);
  const api = {
    tabs: {
      async query({ windowId } = {}) {
        if (Number.isInteger(windowId)) return findWindow(windowId)?.tabs ?? [];
        return windows.flatMap((window) => window.tabs ?? []);
      },
      async create(details) {
        const tab = {
          id: nextTabId++,
          windowId: details.windowId,
          index: details.index ?? findWindow(details.windowId)?.tabs?.length ?? 0,
          url: details.url,
          active: Boolean(details.active),
          pinned: false,
          groupId: -1,
        };
        calls.createdTabs.push(tab);
        findWindow(details.windowId)?.tabs?.push(tab);
        return tab;
      },
      async update(id, changes) {
        calls.updatedTabs.push({ id, changes });
        const tab = windows.flatMap((window) => window.tabs ?? []).find((item) => item.id === id);
        if (tab) Object.assign(tab, changes);
        return { id, ...changes };
      },
      async remove(ids) {
        calls.removedTabs.push(...(Array.isArray(ids) ? ids : [ids]));
      },
      async group() {
        return 900;
      },
    },
    tabGroups: {
      async get(groupId) {
        return { id: groupId, title: groupId === 7 ? '研究' : '资料', color: 'blue', collapsed: false };
      },
      async update(groupId, changes) {
        return { id: groupId, ...changes };
      },
    },
    windows: {
      async getAll() {
        return windows;
      },
      async getLastFocused() {
        return windows.find((window) => window.focused) ?? windows[0];
      },
      async get(windowId) {
        const window = findWindow(windowId);
        if (!window) throw new Error('No window');
        return window;
      },
      async create(details) {
        const window = { id: nextWindowId++, incognito: false, type: 'normal', tabs: [] };
        windows.push(window);
        const tab = await api.tabs.create({ windowId: window.id, url: details.url, active: true, index: 0 });
        calls.createdWindows.push({ details, windowId: window.id, tab });
        return { id: window.id, tabs: [tab] };
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
      },
    },
  };

  return { api, calls, storage, windows };
}

test('saveCurrentTabGroup stores and closes only the active native group', async () => {
  const windows = [{
    id: 1,
    focused: true,
    incognito: false,
    type: 'normal',
    tabs: [
      { id: 1, windowId: 1, index: 0, url: 'https://group.example/a', title: 'A', active: true, groupId: 7 },
      { id: 2, windowId: 1, index: 1, url: 'https://group.example/b', title: 'B', active: false, groupId: 7 },
      { id: 3, windowId: 1, index: 2, url: 'https://outside.example/', title: 'Outside', active: false, groupId: -1 },
    ],
  }];
  const { api, calls, storage } = createChromeMock({ windows });

  const result = await saveCurrentTabGroup(api, 1, 7, {
    placeholderUrl: 'chrome-extension://tab-vault/dashboard.html',
  });

  assert.equal(result.saved, true);
  assert.equal(storage.workspaces[0].tabs.length, 2);
  assert.equal(storage.workspaces[0].groups[0].title, '研究');
  assert.deepEqual(calls.removedTabs, [1, 2]);
  assert.equal(calls.createdTabs.length, 0);
  assert.equal(storage.undo.workspace.groups.length, 1);
});

test('saveCurrentTabGroup reports a missing or unsupported group without closing tabs', async () => {
  const windows = [{
    id: 1,
    focused: true,
    incognito: false,
    type: 'normal',
    tabs: [{ id: 1, windowId: 1, index: 0, url: 'https://example.com/', groupId: -1 }],
  }];
  const { api, calls } = createChromeMock({ windows });

  const result = await saveCurrentTabGroup(api, 1, 7);

  assert.deepEqual(result, { saved: false, reason: 'missing-tab-group' });
  assert.deepEqual(calls.removedTabs, []);
});

test('saveCurrentTabGroup keeps the window alive when the group contains every tab', async () => {
  const windows = [{
    id: 1,
    focused: true,
    incognito: false,
    type: 'normal',
    tabs: [{ id: 1, windowId: 1, index: 0, url: 'https://group.example/', title: 'Group', groupId: 7 }],
  }];
  const { api, calls, storage } = createChromeMock({ windows });

  const result = await saveCurrentTabGroup(api, 1, 7, {
    placeholderUrl: 'chrome-extension://tab-vault/dashboard.html',
  });

  assert.equal(result.saved, true);
  assert.equal(calls.createdTabs[0].url, 'chrome-extension://tab-vault/dashboard.html');
  assert.equal(storage.undo.placeholderTabId, calls.createdTabs[0].id);
});

test('saveCurrentTabGroup removes a temporary landing and closes no source tab after storage failure', async () => {
  const windows = [{
    id: 1,
    focused: true,
    incognito: false,
    type: 'normal',
    tabs: [{ id: 1, windowId: 1, index: 0, url: 'https://group.example/', title: 'Group', groupId: 7 }],
  }];
  const { api, calls } = createChromeMock({ windows, failStorageSet: true });

  const result = await saveCurrentTabGroup(api, 1, 7, {
    placeholderUrl: 'chrome-extension://tab-vault/dashboard.html',
  });

  assert.equal(result.saved, false);
  assert.equal(result.reason, 'storage-full');
  assert.equal(calls.removedTabs.includes(1), false);
  assert.equal(calls.removedTabs.includes(calls.createdTabs[0].id), true);
});

test('saveAllWindows atomically stores every ordinary window and keeps one dashboard landing tab', async () => {
  const windows = [
    {
      id: 1, focused: true, incognito: false, type: 'normal', tabs: [
        { id: 1, windowId: 1, index: 0, url: 'https://first.example/', title: 'First', active: true, groupId: -1 },
      ],
    },
    {
      id: 2, focused: false, incognito: false, type: 'normal', tabs: [
        { id: 2, windowId: 2, index: 0, url: 'https://second.example/', title: 'Second', active: true, groupId: -1 },
      ],
    },
    {
      id: 3, focused: false, incognito: true, type: 'normal', tabs: [
        { id: 3, windowId: 3, index: 0, url: 'https://secret.example/', title: 'Secret', active: true, groupId: -1 },
      ],
    },
    { id: 4, focused: false, incognito: false, type: 'popup', tabs: [] },
  ];
  const { api, calls, storage } = createChromeMock({ windows });

  const result = await saveAllWindows(api, {
    placeholderUrl: 'chrome-extension://tab-vault/dashboard.html',
  });

  assert.equal(result.saved, true);
  assert.equal(result.workspaceCount, 2);
  assert.equal(result.tabCount, 2);
  assert.equal(storage.workspaces.length, 2);
  assert.deepEqual(new Set(calls.removedTabs), new Set([1, 2]));
  assert.equal(calls.createdTabs.filter((tab) => tab.url.includes('dashboard.html')).length, 1);
  assert.equal(storage.undo.entries.length, 2);
});

test('saveAllWindows closes nothing when the combined snapshot cannot be stored', async () => {
  const windows = [{
    id: 1,
    focused: true,
    incognito: false,
    type: 'normal',
    tabs: [{ id: 1, windowId: 1, index: 0, url: 'https://first.example/', title: 'First', groupId: -1 }],
  }];
  const { api, calls } = createChromeMock({ windows, failStorageSet: true });

  const result = await saveAllWindows(api, {
    placeholderUrl: 'chrome-extension://tab-vault/dashboard.html',
  });

  assert.equal(result.saved, false);
  assert.equal(result.reason, 'storage-full');
  assert.deepEqual(calls.removedTabs.filter((id) => id === 1), []);
});

test('saveAllWindows ignores incognito, popup, and windows without recoverable webpages', async () => {
  const windows = [
    { id: 1, focused: true, incognito: false, type: 'normal', tabs: [{ id: 1, windowId: 1, url: 'chrome://settings/' }] },
    { id: 2, incognito: true, type: 'normal', tabs: [{ id: 2, windowId: 2, url: 'https://secret.example/' }] },
    { id: 3, incognito: false, type: 'popup', tabs: [{ id: 3, windowId: 3, url: 'https://popup.example/' }] },
  ];
  const { api, calls } = createChromeMock({ windows });

  const result = await saveAllWindows(api);

  assert.deepEqual(result, { saved: false, reason: 'no-recoverable-tabs' });
  assert.deepEqual(calls.removedTabs, []);
});

test('undoLastSave restores every workspace from a multi-window save', async () => {
  const windows = [{ id: 1, focused: true, incognito: false, type: 'normal', tabs: [] }];
  const { api, storage, calls } = createChromeMock({ windows });
  storage.undo = {
    expiresAt: Date.now() + 10_000,
    entries: [
      {
        windowId: 1,
        placeholderTabId: null,
        workspace: {
          id: 'first', createdAt: new Date().toISOString(), title: 'First', pinned: false,
          tabs: [{ index: 0, url: 'https://first.example/', title: 'First', active: true, restorable: true }], groups: [],
        },
      },
      {
        windowId: 99,
        placeholderTabId: null,
        workspace: {
          id: 'second', createdAt: new Date().toISOString(), title: 'Second', pinned: false,
          tabs: [{ index: 0, url: 'https://second.example/', title: 'Second', active: true, restorable: true }], groups: [],
        },
      },
    ],
  };

  const result = await undoLastSave(api);

  assert.equal(result.undone, true);
  assert.equal(result.restoredCount, 2);
  assert.equal(calls.createdWindows.length, 1);
  assert.equal(storage.undo, null);
});
