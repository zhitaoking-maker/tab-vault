import {
  STORAGE_KEYS,
  deleteWorkspaceTabs,
  getStoredState,
  renameWorkspace,
  restoreWorkspace,
  saveCurrentWindow,
  setStoredValues,
  sortWorkspaces,
  toggleWorkspacePin,
  undoLastSave,
} from './lib/workspace-core.js';
import {
  DATA_VERSION,
  STORAGE_QUOTA_BYTES,
  createExportPayload,
  measureStorageBytes,
  mergeImportedWorkspaces,
  moveWorkspaceToTrash,
  moveWorkspacesToTrash,
  parseImportPayload,
  permanentlyDeleteTrash,
  restoreTrashWorkspace,
} from './lib/backup-core.js';

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

function parseBackup(text) {
  try {
    return { parsed: parseImportPayload(text) };
  } catch (error) {
    return { error: error.message };
  }
}

function normalizeImported(workspaces) {
  return workspaces.map((workspace) => ({
    ...workspace,
    pinned: Boolean(workspace.pinned),
    lastRestoredAt: workspace.lastRestoredAt ?? null,
    tabCount: workspace.tabs.length,
    tabs: workspace.tabs.map((tab) => ({
      ...tab,
      favIconUrl: tab.favIconUrl || '',
      pinned: Boolean(tab.pinned),
      active: Boolean(tab.active),
    })),
  }));
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

      let targetWindowId;
      if (Number.isInteger(message.windowId)) {
        try {
          await chromeApi.windows.get(message.windowId);
          targetWindowId = message.windowId;
        } catch {
          targetWindowId = undefined;
        }
      }

      const result = await restoreWorkspace(chromeApi, workspace, {
        tabIndexes: message.tabIndexes,
        windowId: targetWindowId,
      });
      if (result.restoredCount === 0) {
        return {
          restored: false,
          reason: result.failedCount ? 'restore-failed' : 'no-recoverable-tabs',
          ...result,
        };
      }
      const state = await chromeApi.storage.local.get('workspaces');
      const workspaces = (state.workspaces ?? []).map((item) => (
        item.id === workspace.id ? { ...item, lastRestoredAt: new Date().toISOString() } : item
      ));
      await setStoredValues(chromeApi, { dataVersion: DATA_VERSION, workspaces });
      return { restored: true, ...result };
    }

    case 'export-workspaces': {
      const { workspaces } = await getStoredState(chromeApi);
      const selectedIds = Array.isArray(message.workspaceIds) ? new Set(message.workspaceIds) : null;
      const selected = selectedIds ? workspaces.filter((workspace) => selectedIds.has(workspace.id)) : workspaces;
      if (!selected.length) return { exported: false, reason: 'no-workspaces' };
      return {
        exported: true,
        payload: createExportPayload(selected, {
          extensionVersion: chromeApi.runtime.getManifest?.().version ?? '0.2.0',
        }),
      };
    }

    case 'preview-import': {
      const backup = parseBackup(message.text);
      if (backup.error) return { valid: false, reason: backup.error };
      const { workspaces } = await getStoredState(chromeApi);
      const imported = normalizeImported(backup.parsed.validWorkspaces);
      let previewId = 0;
      const merged = mergeImportedWorkspaces(workspaces, imported, { makeId: () => `preview-${++previewId}` });
      const currentStorage = await chromeApi.storage.local.get(null);
      const estimatedBytesAfterImport = measureStorageBytes({
        ...currentStorage,
        dataVersion: DATA_VERSION,
        workspaces: sortWorkspaces(merged.workspaces),
      });
      return {
        valid: true,
        workspaceCount: imported.length,
        tabCount: backup.parsed.tabCount,
        invalidWorkspaceCount: backup.parsed.invalidWorkspaceCount,
        importedCount: merged.importedCount,
        duplicateCount: merged.duplicateCount,
        conflictCount: merged.conflictCount,
        estimatedBytesAfterImport,
        quotaBytes: STORAGE_QUOTA_BYTES,
        willFit: estimatedBytesAfterImport <= STORAGE_QUOTA_BYTES,
      };
    }

    case 'import-workspaces': {
      const backup = parseBackup(message.text);
      if (backup.error) return { imported: false, reason: backup.error };
      const state = await getStoredState(chromeApi);
      const imported = normalizeImported(backup.parsed.validWorkspaces);
      const merged = mergeImportedWorkspaces(state.workspaces, imported);
      try {
        await setStoredValues(chromeApi, {
          [STORAGE_KEYS.dataVersion]: DATA_VERSION,
          [STORAGE_KEYS.workspaces]: sortWorkspaces(merged.workspaces),
        });
      } catch (error) {
        return { imported: false, reason: /storage-full|quota/i.test(error.message) ? 'storage-full' : 'storage-error' };
      }
      return {
        imported: true,
        importedCount: merged.importedCount,
        duplicateCount: merged.duplicateCount,
        conflictCount: merged.conflictCount,
        invalidWorkspaceCount: backup.parsed.invalidWorkspaceCount,
      };
    }

    case 'rename-workspace': {
      const state = await chromeApi.storage.local.get('workspaces');
      const result = renameWorkspace(state.workspaces ?? [], message.workspaceId, message.title);
      if (!result.ok) return { renamed: false, reason: 'invalid-title' };
      await setStoredValues(chromeApi, { dataVersion: DATA_VERSION, workspaces: result.workspaces });
      return { renamed: true };
    }

    case 'toggle-workspace-pin': {
      const state = await chromeApi.storage.local.get('workspaces');
      const result = toggleWorkspacePin(state.workspaces ?? [], message.workspaceId);
      if (!result.ok) return { pinned: false, reason: 'missing' };
      await setStoredValues(chromeApi, { dataVersion: DATA_VERSION, workspaces: result.workspaces });
      return { pinned: true };
    }

    case 'delete-workspace': {
      const state = await getStoredState(chromeApi);
      const result = moveWorkspaceToTrash(state.workspaces, state.trash, message.workspaceId);
      if (!result.ok) return { deleted: false, reason: 'missing' };
      await setStoredValues(chromeApi, {
        dataVersion: DATA_VERSION,
        workspaces: result.workspaces,
        trash: result.trash,
      });
      return { deleted: true };
    }

    case 'delete-workspaces': {
      const state = await getStoredState(chromeApi);
      const result = moveWorkspacesToTrash(state.workspaces, state.trash, message.workspaceIds);
      if (!result.ok) return { deleted: false, reason: 'no-selected-workspaces' };
      await setStoredValues(chromeApi, {
        dataVersion: DATA_VERSION,
        workspaces: result.workspaces,
        trash: result.trash,
      });
      return { deleted: true, deletedCount: result.movedCount };
    }

    case 'restore-trash-workspace': {
      const state = await getStoredState(chromeApi);
      const result = restoreTrashWorkspace(state.workspaces, state.trash, message.workspaceId);
      if (!result.ok) return { restored: false, reason: 'missing' };
      await setStoredValues(chromeApi, {
        dataVersion: DATA_VERSION,
        workspaces: result.workspaces,
        trash: result.trash,
      });
      return { restored: true };
    }

    case 'permanently-delete-trash': {
      const state = await getStoredState(chromeApi);
      const result = permanentlyDeleteTrash(state.workspaces, state.trash, message.workspaceId);
      if (!result.ok) return { deleted: false, reason: 'missing' };
      await setStoredValues(chromeApi, { dataVersion: DATA_VERSION, trash: result.trash });
      return { deleted: true };
    }

    case 'empty-trash': {
      await setStoredValues(chromeApi, { dataVersion: DATA_VERSION, trash: [] });
      return { deleted: true };
    }

    case 'delete-workspace-tabs': {
      const state = await getStoredState(chromeApi);
      const result = deleteWorkspaceTabs(state.workspaces, message.workspaceId, message.tabIndexes);
      if (!result.ok) return { deleted: false, reason: 'no-selected-tabs' };
      if (result.workspaceDeleted) {
        const moved = moveWorkspaceToTrash(state.workspaces, state.trash, message.workspaceId);
        await setStoredValues(chromeApi, {
          dataVersion: DATA_VERSION,
          workspaces: moved.workspaces,
          trash: moved.trash,
        });
      } else {
        await setStoredValues(chromeApi, { dataVersion: DATA_VERSION, workspaces: result.workspaces });
      }
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
