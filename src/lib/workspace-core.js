export const STORAGE_KEYS = {
  workspaces: 'workspaces',
  undo: 'undo',
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
  return {
    ...workspace,
    pinned: Boolean(workspace.pinned),
    tabs: Array.isArray(workspace.tabs) ? workspace.tabs : [],
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
  return chromeApi.storage.local.set(values);
}

export async function getStoredState(chromeApi, now = Date.now()) {
  const state = await getLocal(chromeApi, [STORAGE_KEYS.workspaces, STORAGE_KEYS.undo]);
  const workspaces = Array.isArray(state.workspaces) ? state.workspaces : [];
  const undo = state.undo?.expiresAt > now ? state.undo : null;

  if (state.undo && !undo) await setLocal(chromeApi, { [STORAGE_KEYS.undo]: null });

  return {
    workspaces: sortWorkspaces(workspaces),
    undo,
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

  await setLocal(chromeApi, {
    [STORAGE_KEYS.workspaces]: [workspace, ...workspaces],
    [STORAGE_KEYS.undo]: undo,
  });
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
      skippedCount: skippedDuplicateCount + skippedUnsupportedCount,
      skippedDuplicateCount,
      skippedUnsupportedCount,
    };
  }

  let targetWindowId = windowId;
  const restored = new Map();
  const openingTab = restorableTabs.find((tab) => tab.active) ?? restorableTabs[0];

  if (targetWindowId) {
    restored.set(openingTab, await chromeApi.tabs.create({
      windowId: targetWindowId,
      url: openingTab.url,
      index: openingTab.index,
      active: true,
    }));
  } else {
    const createdWindow = await chromeApi.windows.create({ url: openingTab.url, focused: true });
    targetWindowId = createdWindow.id;
    restored.set(openingTab, createdWindow.tabs?.[0] ?? {
      id: undefined,
      windowId: targetWindowId,
      url: openingTab.url,
    });
  }

  for (const tab of restorableTabs) {
    if (tab === openingTab) continue;
    restored.set(tab, await chromeApi.tabs.create({ windowId: targetWindowId, url: tab.url, index: tab.index, active: false }));
  }

  for (const tab of restorableTabs) {
    if (tab.pinned) await chromeApi.tabs.update(restored.get(tab).id, { pinned: true });
  }

  await chromeApi.tabs.update(restored.get(openingTab).id, { active: true });

  await removeLandingTab(chromeApi, replaceTabId);
  return {
    restoredCount: restorableTabs.length,
    skippedCount: skippedDuplicateCount + skippedUnsupportedCount,
    skippedDuplicateCount,
    skippedUnsupportedCount,
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
