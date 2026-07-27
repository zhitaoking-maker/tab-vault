export const DATA_VERSION = 1;
export const EXPORT_SCHEMA_VERSION = 1;
export const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024;
export const STORAGE_WARNING_RATIO = 0.8;
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validTab(tab) {
  return isObject(tab)
    && typeof tab.url === 'string'
    && typeof tab.title === 'string'
    && Number.isInteger(tab.index);
}

export function validWorkspace(workspace) {
  return isObject(workspace)
    && typeof workspace.id === 'string'
    && workspace.id.length > 0
    && typeof workspace.title === 'string'
    && workspace.title.trim().length > 0
    && validDate(workspace.createdAt)
    && Array.isArray(workspace.tabs)
    && workspace.tabs.every(validTab);
}

export function createExportPayload(workspaces, {
  exportedAt = new Date(),
  extensionVersion = '',
} = {}) {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    extensionVersion,
    workspaces: clone(workspaces),
  };
}

export function parseImportPayload(input) {
  let payload;
  try {
    payload = typeof input === 'string' ? JSON.parse(input) : clone(input);
  } catch {
    throw new Error('invalid-json');
  }
  if (!isObject(payload) || !Number.isInteger(payload.schemaVersion) || !Array.isArray(payload.workspaces)) {
    throw new Error('invalid-backup');
  }
  if (payload.schemaVersion !== EXPORT_SCHEMA_VERSION) throw new Error('unsupported-version');

  const validWorkspaces = payload.workspaces.filter(validWorkspace).map(clone);
  return {
    schemaVersion: payload.schemaVersion,
    exportedAt: payload.exportedAt ?? null,
    extensionVersion: payload.extensionVersion ?? '',
    validWorkspaces,
    invalidWorkspaceCount: payload.workspaces.length - validWorkspaces.length,
    tabCount: validWorkspaces.reduce((total, workspace) => total + workspace.tabs.length, 0),
  };
}

function workspaceFingerprint(workspace) {
  return JSON.stringify({
    createdAt: workspace.createdAt,
    title: workspace.title,
    pinned: Boolean(workspace.pinned),
    tabs: workspace.tabs.map((tab) => ({
      url: tab.url,
      title: tab.title,
      index: tab.index,
      pinned: Boolean(tab.pinned),
      active: Boolean(tab.active),
    })),
  });
}

export function mergeImportedWorkspaces(existing, imported, { makeId = () => crypto.randomUUID() } = {}) {
  const workspaces = existing.map(clone);
  let importedCount = 0;
  let duplicateCount = 0;
  let conflictCount = 0;

  for (const candidate of imported) {
    const matchingId = workspaces.find((workspace) => workspace.id === candidate.id);
    if (matchingId && workspaceFingerprint(matchingId) === workspaceFingerprint(candidate)) {
      duplicateCount += 1;
      continue;
    }

    const next = clone(candidate);
    if (matchingId) {
      next.id = makeId();
      next.title = `${next.title}（导入副本）`.slice(0, 60);
      conflictCount += 1;
    }
    workspaces.push(next);
    importedCount += 1;
  }

  return { workspaces, importedCount, duplicateCount, conflictCount };
}

export function moveWorkspaceToTrash(workspaces, trash, workspaceId, deletedAt = new Date()) {
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return { ok: false, workspaces, trash };
  return {
    ok: true,
    workspaces: workspaces.filter((item) => item.id !== workspaceId),
    trash: [
      { ...clone(workspace), deletedAt: deletedAt.toISOString() },
      ...trash.filter((item) => item.id !== workspaceId),
    ],
  };
}

export function moveWorkspacesToTrash(workspaces, trash, workspaceIds, deletedAt = new Date()) {
  const selectedIds = new Set(Array.isArray(workspaceIds) ? workspaceIds : []);
  const selected = workspaces.filter((workspace) => selectedIds.has(workspace.id));
  if (!selected.length) return { ok: false, movedCount: 0, workspaces, trash };
  return {
    ok: true,
    movedCount: selected.length,
    workspaces: workspaces.filter((workspace) => !selectedIds.has(workspace.id)),
    trash: [
      ...selected.map((workspace) => ({ ...clone(workspace), deletedAt: deletedAt.toISOString() })),
      ...trash.filter((entry) => !selectedIds.has(entry.id)),
    ],
  };
}

export function restoreTrashWorkspace(workspaces, trash, workspaceId, { makeId = () => crypto.randomUUID() } = {}) {
  const entry = trash.find((item) => item.id === workspaceId);
  if (!entry) return { ok: false, workspaces, trash };
  const restored = clone(entry);
  delete restored.deletedAt;
  if (workspaces.some((item) => item.id === restored.id)) {
    restored.id = makeId();
    restored.title = `${restored.title}（恢复副本）`.slice(0, 60);
  }
  return {
    ok: true,
    workspaces: [restored, ...workspaces],
    trash: trash.filter((item) => item.id !== workspaceId),
  };
}

export function permanentlyDeleteTrash(workspaces, trash, workspaceId) {
  if (!trash.some((item) => item.id === workspaceId)) return { ok: false, workspaces, trash };
  return { ok: true, workspaces, trash: trash.filter((item) => item.id !== workspaceId) };
}

export function pruneTrash(trash, now = new Date()) {
  const cutoff = now.getTime() - TRASH_RETENTION_MS;
  return trash.filter((entry) => {
    const deletedAt = Date.parse(entry.deletedAt);
    return Number.isFinite(deletedAt) && deletedAt > cutoff;
  });
}

export function measureStorageBytes(values) {
  const encoder = new TextEncoder();
  return Object.entries(values).reduce((total, [key, value]) => {
    if (value === undefined) return total;
    return total + encoder.encode(key).byteLength + encoder.encode(JSON.stringify(value)).byteLength;
  }, 0);
}

export function getStorageHealth(bytesInUse) {
  const ratio = bytesInUse / STORAGE_QUOTA_BYTES;
  return {
    bytesInUse,
    quotaBytes: STORAGE_QUOTA_BYTES,
    ratio,
    warning: ratio >= STORAGE_WARNING_RATIO,
  };
}
