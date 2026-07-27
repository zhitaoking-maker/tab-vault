import {
  DATA_VERSION,
  STORAGE_QUOTA_BYTES,
  getStorageHealth,
  measureStorageBytes,
  pruneTrash,
} from './backup-core.js';

export const STORAGE_KEYS = {
  dataVersion: 'dataVersion',
  workspaces: 'workspaces',
  undo: 'undo',
  trash: 'trash',
};

const UNDO_DURATION_MS = 10_000;
const PLACEHOLDER_URL = 'about:blank';

export function isRestorableUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function normalizeWorkspace(workspace) {
  const tabs = Array.isArray(workspace.tabs) ? workspace.tabs.map(normalizeTab) : [];
  return {
    ...workspace,
    pinned: Boolean(workspace.pinned),
    tabCount: tabs.length,
    tabs,
  };
}

export function sortWorkspaces(workspaces) {
  return [...workspaces]
    .map(normalizeWorkspace)
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return right.createdAt.localeCompare(left.createdAt);
    });
}

function updateWorkspaceList(workspaces, workspaceId, update) {
  const index = workspaces.findIndex((workspace) => workspace.id === workspaceId);
  if (index < 0) return { ok: false, workspaces };
  const updated = [...workspaces];
  updated[index] = update(normalizeWorkspace(updated[index]));
  return { ok: true, workspaces: sortWorkspaces(updated) };
}

export function renameWorkspace(workspaces, workspaceId, title) {
  const nextTitle = typeof title === 'string' ? title.trim() : '';
  if (!nextTitle || nextTitle.length > 60) return { ok: false, workspaces };
  return updateWorkspaceList(workspaces, workspaceId, (workspace) => ({ ...workspace, title: nextTitle }));
}

export function toggleWorkspacePin(workspaces, workspaceId) {
  return updateWorkspaceList(workspaces, workspaceId, (workspace) => ({ ...workspace, pinned: !workspace.pinned }));
}

export function deleteWorkspaceTabs(workspaces, workspaceId, tabIndexes) {
  const selectedIndexes = new Set(Array.isArray(tabIndexes) ? tabIndexes.filter(Number.isInteger) : []);
  if (selectedIndexes.size === 0) return { ok: false, workspaces, removedTabCount: 0, workspaceDeleted: false };

  const workspaceIndex = workspaces.findIndex((workspace) => workspace.id === workspaceId);
  if (workspaceIndex < 0) return { ok: false, workspaces, removedTabCount: 0, workspaceDeleted: false };

  const workspace = normalizeWorkspace(workspaces[workspaceIndex]);
  const tabs = workspace.tabs.filter((tab) => !selectedIndexes.has(tab.index));
  const removedTabCount = workspace.tabs.length - tabs.length;
  if (removedTabCount === 0) return { ok: false, workspaces, removedTabCount: 0, workspaceDeleted: false };

  if (tabs.length === 0) {
    return {
      ok: true,
      workspaces: workspaces.filter((item) => item.id !== workspaceId),
      removedTabCount,
      workspaceDeleted: true,
    };
  }

  const updated = [...workspaces];
  updated[workspaceIndex] = { ...workspace, tabs, tabCount: tabs.length };
  return {
    ok: true,
    workspaces: sortWorkspaces(updated),
    removedTabCount,
    workspaceDeleted: false,
  };
}

function makeId() {
  return globalThis.crypto.randomUUID();
}

function createDisplayTitle(date, tabCount) {
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${tabCount} 个标签`;
}

function normalizeTab(tab) {
  return {
    url: tab.url ?? '',
    title: tab.title || tab.url || '未命名标签',
    favIconUrl: tab.favIconUrl || '',
    index: Number.isInteger(tab.index) ? tab.index : 0,
    pinned: Boolean(tab.pinned),
    active: Boolean(tab.active),
    restorable: isRestorableUrl(tab.url),
  };
}

export function buildWorkspace(tabs, now = new Date()) {
  const orderedTabs = [...tabs]
    .sort((left, right) => left.index - right.index)
    .map(normalizeTab);

  return {
    id: makeId(),
    createdAt: now.toISOString(),
    lastRestoredAt: null,
    title: createDisplayTitle(now, orderedTabs.length),
    pinned: false,
    tabCount: orderedTabs.length,
    tabs: orderedTabs,
  };
}

async function getLocal(chromeApi, keys) {
  return chromeApi.storage.local.get(keys);
}

async function setLocal(chromeApi, values) {
  const current = await getLocal(chromeApi, null);
  const next = { ...current, ...values };
  if (measureStorageBytes(next) > STORAGE_QUOTA_BYTES) throw new Error('storage-full');
  return chromeApi.storage.local.set(values);
}

export function setStoredValues(chromeApi, values) {
  return setLocal(chromeApi, values);
}

export async function getStoredState(chromeApi, now = Date.now()) {
  const state = await getLocal(chromeApi, [
    STORAGE_KEYS.dataVersion,
    STORAGE_KEYS.workspaces,
    STORAGE_KEYS.undo,
    STORAGE_KEYS.trash,
  ]);
  const workspaces = Array.isArray(state.workspaces) ? state.workspaces : [];
  const undo = state.undo?.expiresAt > now ? state.undo : null;
  const originalTrash = Array.isArray(state.trash) ? state.trash : [];
  const trash = pruneTrash(originalTrash, new Date(now));

  const updates = {};
  if (state.dataVersion !== DATA_VERSION) updates[STORAGE_KEYS.dataVersion] = DATA_VERSION;
  if (state.undo && !undo) updates[STORAGE_KEYS.undo] = null;
  if (trash.length !== originalTrash.length) updates[STORAGE_KEYS.trash] = trash;
  if (Object.keys(updates).length) await setLocal(chromeApi, updates);

  const bytesInUse = chromeApi.storage.local.getBytesInUse
    ? await chromeApi.storage.local.getBytesInUse(null)
    : measureStorageBytes({ ...state, ...updates });

  return {
    dataVersion: DATA_VERSION,
    workspaces: sortWorkspaces(workspaces),
    undo,
    trash: trash.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt)),
    storageHealth: getStorageHealth(bytesInUse),
  };
}

export async function saveCurrentWindow(chromeApi, windowId, { now = new Date(), placeholderUrl = PLACEHOLDER_URL } = {}) {
  const tabs = await chromeApi.tabs.query({ windowId });
  if (tabs.length === 0) return { saved: false, reason: 'empty-window' };

  const recoverableTabs = tabs.filter((tab) => isRestorableUrl(tab.url));
  if (recoverableTabs.length === 0) return { saved: false, reason: 'no-recoverable-tabs' };

  const workspace = buildWorkspace(recoverableTabs, now);
  const previous = await getLocal(chromeApi, [STORAGE_KEYS.workspaces]);
  const workspaces = Array.isArray(previous.workspaces) ? previous.workspaces : [];
  const existingLanding = tabs.find((tab) => tab.url === placeholderUrl);
  const landingTab = existingLanding
    ? await chromeApi.tabs.update(existingLanding.id, { url: placeholderUrl, active: true })
    : await chromeApi.tabs.create({ windowId, url: placeholderUrl, active: true });
  const undo = {
    workspaceId: workspace.id,
    workspace,
    windowId,
    placeholderTabId: landingTab.id,
    expiresAt: now.getTime() + UNDO_DURATION_MS,
  };

  try {
    await setLocal(chromeApi, {
      [STORAGE_KEYS.dataVersion]: DATA_VERSION,
      [STORAGE_KEYS.workspaces]: [workspace, ...workspaces],
      [STORAGE_KEYS.undo]: undo,
    });
    const stored = await getLocal(chromeApi, STORAGE_KEYS.workspaces);
    if (!stored.workspaces?.some((item) => item.id === workspace.id)) throw new Error('storage-verification-failed');
  } catch (error) {
    if (!existingLanding) await removeLandingTab(chromeApi, landingTab.id);
    const reason = error.message === 'storage-full' || /quota/i.test(error.message) ? 'storage-full' : 'storage-error';
    return { saved: false, reason };
  }
  await chromeApi.tabs.remove(recoverableTabs.map((tab) => tab.id));

  return { saved: true, workspace, undo };
}

async function removeLandingTab(chromeApi, tabId) {
  if (!tabId) return;
  try {
    await chromeApi.tabs.remove(tabId);
  } catch {
    // The user might have already closed the landing tab.
  }
}

function getRestorationPlan(workspace, { tabIndexes } = {}) {
  const selectedIndexes = Array.isArray(tabIndexes) ? new Set(tabIndexes.filter(Number.isInteger)) : null;
  const selectedTabs = workspace.tabs
    .filter((tab) => !selectedIndexes || selectedIndexes.has(tab.index))
    .sort((left, right) => left.index - right.index);
  const recoverableTabs = selectedTabs.filter((tab) => tab.restorable && isRestorableUrl(tab.url));

  return {
    restorableTabs: recoverableTabs,
    skippedDuplicateCount: 0,
    skippedUnsupportedCount: selectedTabs.length - recoverableTabs.length,
  };
}

export async function restoreWorkspace(chromeApi, workspace, { windowId, replaceTabId, tabIndexes } = {}) {
  const { restorableTabs, skippedDuplicateCount, skippedUnsupportedCount } = getRestorationPlan(workspace, {
    tabIndexes,
  });

  if (restorableTabs.length === 0) {
    return {
      restoredCount: 0,
      failedCount: 0,
      failedTabs: [],
      skippedCount: skippedDuplicateCount + skippedUnsupportedCount,
      skippedDuplicateCount,
      skippedUnsupportedCount,
      unsupportedCount: skippedUnsupportedCount,
      pinFailedCount: 0,
    };
  }

  let targetWindowId = windowId;
  const restored = new Map();
  const openingTab = restorableTabs.find((tab) => tab.active) ?? restorableTabs[0];
  let createdOpeningTab = null;

  if (targetWindowId) {
    createdOpeningTab = openingTab;
  } else {
    const candidates = [openingTab, ...restorableTabs.filter((tab) => tab !== openingTab)];
    for (const candidate of candidates) {
      try {
        const createdWindow = await chromeApi.windows.create({ url: candidate.url, focused: true });
        targetWindowId = createdWindow.id;
        createdOpeningTab = candidate;
        restored.set(candidate.index, createdWindow.tabs?.[0] ?? {
          id: undefined,
          windowId: targetWindowId,
          url: candidate.url,
        });
        break;
      } catch {
        // Try another URL before reporting the entire restore as failed.
      }
    }
  }

  const failedTabs = [];
  if (!targetWindowId) {
    for (const tab of restorableTabs) failedTabs.push({ index: tab.index, url: tab.url, title: tab.title, reason: 'window-create-failed' });
    return {
      restoredCount: 0,
      failedCount: failedTabs.length,
      failedTabs,
      skippedCount: skippedUnsupportedCount,
      skippedDuplicateCount,
      skippedUnsupportedCount,
      unsupportedCount: skippedUnsupportedCount,
      pinFailedCount: 0,
    };
  }

  for (const tab of restorableTabs) {
    if (tab === createdOpeningTab && restored.has(tab.index)) continue;
    try {
      restored.set(tab.index, await chromeApi.tabs.create({
        windowId: targetWindowId,
        url: tab.url,
        index: tab.index,
        active: false,
      }));
    } catch (error) {
      failedTabs.push({ index: tab.index, url: tab.url, title: tab.title, reason: error.message || 'tab-create-failed' });
    }
  }

  let pinFailedCount = 0;
  for (const tab of restorableTabs) {
    const restoredTab = restored.get(tab.index);
    if (!tab.pinned || !restoredTab?.id) continue;
    try {
      await chromeApi.tabs.update(restoredTab.id, { pinned: true });
    } catch {
      pinFailedCount += 1;
    }
  }

  const activeTab = restored.get(openingTab.index) ?? restored.get(createdOpeningTab?.index);
  if (activeTab?.id) {
    try {
      await chromeApi.tabs.update(activeTab.id, { active: true });
    } catch {
      // The window still contains the restored tabs even if focus changed meanwhile.
    }
  }

  await removeLandingTab(chromeApi, replaceTabId);
  return {
    restoredCount: restored.size,
    failedCount: failedTabs.length,
    failedTabs,
    skippedCount: skippedDuplicateCount + skippedUnsupportedCount,
    skippedDuplicateCount,
    skippedUnsupportedCount,
    unsupportedCount: skippedUnsupportedCount,
    pinFailedCount,
    windowId: targetWindowId,
  };
}

export async function undoLastSave(chromeApi, now = Date.now()) {
  const state = await getLocal(chromeApi, STORAGE_KEYS.undo);
  const undo = state.undo;
  if (!undo || !undo.workspace) return { undone: false, reason: 'missing' };
  if (undo.expiresAt <= now) {
    await setLocal(chromeApi, { [STORAGE_KEYS.undo]: null });
    return { undone: false, reason: 'expired' };
  }

  const restored = await restoreWorkspace(chromeApi, undo.workspace, {
    windowId: undo.windowId,
    replaceTabId: undo.placeholderTabId,
  });
  await setLocal(chromeApi, { [STORAGE_KEYS.undo]: null });
  return { undone: true, ...restored };
}
