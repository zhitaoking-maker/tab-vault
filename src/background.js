import {
  deleteWorkspaceTabs,
  getStoredState,
  renameWorkspace,
  restoreWorkspace,
  saveCurrentWindow,
  toggleWorkspacePin,
  undoLastSave,
} from './lib/workspace-core.js';

export const UNDO_EXPIRY_ALARM = 'tab-vault-undo-expiry';

export function scheduleUndoExpiry(chromeApi, expiresAt, {
  now = Date.now(),
  setTimer = globalThis.setTimeout,
} = {}) {
  const timer = setTimer(
    () => expireUndo(chromeApi, expiresAt).catch(() => {}),
    Math.max(0, expiresAt - now),
  );
  timer?.unref?.();
  const alarm = chromeApi.alarms?.create?.(UNDO_EXPIRY_ALARM, { when: expiresAt });
  alarm?.catch?.(() => {});
  return timer;
}

async function clearUndoExpiry(chromeApi) {
  if (chromeApi.alarms?.clear) await chromeApi.alarms.clear(UNDO_EXPIRY_ALARM);
}

export async function expireUndo(chromeApi, now = Date.now()) {
  const state = await chromeApi.storage.local.get('undo');
  if (!state.undo || state.undo.expiresAt > now) return false;
  await chromeApi.storage.local.set({ undo: null });
  return true;
}

async function findWorkspace(chromeApi, workspaceId) {
  const { workspaces } = await getStoredState(chromeApi);
  return workspaces.find((workspace) => workspace.id === workspaceId);
}

export async function handleMessage(message, chromeApi = chrome) {
  switch (message.type) {
    case 'get-state':
      return getStoredState(chromeApi);

    case 'save-current': {
      const targetWindow = Number.isInteger(message.windowId)
        ? await chromeApi.windows.get(message.windowId)
        : await chromeApi.windows.getCurrent();
      if (targetWindow.incognito) return { saved: false, reason: 'incognito-window' };
      const result = await saveCurrentWindow(chromeApi, targetWindow.id, {
        placeholderUrl: chromeApi.runtime.getURL('dashboard.html'),
      });
      if (result.saved) scheduleUndoExpiry(chromeApi, result.undo.expiresAt);
      return result;
    }

    case 'undo-save': {
      const result = await undoLastSave(chromeApi);
      if (result.undone || result.reason === 'expired') await clearUndoExpiry(chromeApi);
      return result;
    }

    case 'restore-workspace': {
      const workspace = await findWorkspace(chromeApi, message.workspaceId);
      if (!workspace) return { restored: false, reason: 'missing' };

      const result = await restoreWorkspace(chromeApi, workspace, {
        tabIndexes: message.tabIndexes,
      });
      if (result.restoredCount === 0) {
        return {
          restored: false,
          reason: result.skippedDuplicateCount ? 'already-open' : 'no-recoverable-tabs',
          ...result,
        };
      }
      const state = await chromeApi.storage.local.get('workspaces');
      const workspaces = (state.workspaces ?? []).map((item) => (
        item.id === workspace.id ? { ...item, lastRestoredAt: new Date().toISOString() } : item
      ));
      await chromeApi.storage.local.set({ workspaces });
      return { restored: true, ...result };
    }

    case 'rename-workspace': {
      const state = await chromeApi.storage.local.get('workspaces');
      const result = renameWorkspace(state.workspaces ?? [], message.workspaceId, message.title);
      if (!result.ok) return { renamed: false, reason: 'invalid-title' };
      await chromeApi.storage.local.set({ workspaces: result.workspaces });
      return { renamed: true };
    }

    case 'toggle-workspace-pin': {
      const state = await chromeApi.storage.local.get('workspaces');
      const result = toggleWorkspacePin(state.workspaces ?? [], message.workspaceId);
      if (!result.ok) return { pinned: false, reason: 'missing' };
      await chromeApi.storage.local.set({ workspaces: result.workspaces });
      return { pinned: true };
    }

    case 'delete-workspace': {
      const state = await chromeApi.storage.local.get('workspaces');
      const workspaces = (state.workspaces ?? []).filter((workspace) => workspace.id !== message.workspaceId);
      await chromeApi.storage.local.set({ workspaces });
      return { deleted: true };
    }

    case 'delete-workspace-tabs': {
      const state = await chromeApi.storage.local.get('workspaces');
      const result = deleteWorkspaceTabs(state.workspaces ?? [], message.workspaceId, message.tabIndexes);
      if (!result.ok) return { deleted: false, reason: 'no-selected-tabs' };
      await chromeApi.storage.local.set({ workspaces: result.workspaces });
      return {
        deleted: true,
        workspaceDeleted: result.workspaceDeleted,
        removedTabCount: result.removedTabCount,
      };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  });
}

if (globalThis.chrome?.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === UNDO_EXPIRY_ALARM) expireUndo(chrome).catch(() => {});
  });
}
