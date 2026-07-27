import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DATA_VERSION,
  EXPORT_SCHEMA_VERSION,
  STORAGE_QUOTA_BYTES,
  createExportPayload,
  getStorageHealth,
  measureStorageBytes,
  mergeImportedWorkspaces,
  moveWorkspaceToTrash,
  moveWorkspacesToTrash,
  parseImportPayload,
  permanentlyDeleteTrash,
  pruneTrash,
  restoreTrashWorkspace,
} from '../src/lib/backup-core.js';
import { buildWorkspace } from '../src/lib/workspace-core.js';

function workspace(title = '研究现场', createdAt = '2026-07-25T08:00:00.000Z') {
  return {
    ...buildWorkspace([
      { index: 0, url: 'https://example.com/', title: 'Example', pinned: true, active: true },
    ], new Date(createdAt)),
    title,
  };
}

test('creates a versioned portable export without unrelated extension settings', () => {
  const item = workspace();
  const payload = createExportPayload([item], {
    exportedAt: new Date('2026-07-26T08:00:00.000Z'),
    extensionVersion: '0.2.0',
  });

  assert.equal(payload.schemaVersion, EXPORT_SCHEMA_VERSION);
  assert.equal(payload.exportedAt, '2026-07-26T08:00:00.000Z');
  assert.equal(payload.extensionVersion, '0.2.0');
  assert.deepEqual(payload.workspaces, [item]);
  assert.equal('appearance' in payload, false);
});

test('rejects corrupt and future backup formats without returning partial data', () => {
  assert.throws(() => parseImportPayload('{broken'), /invalid-json/);
  assert.throws(() => parseImportPayload(JSON.stringify({ schemaVersion: 99, workspaces: [] })), /unsupported-version/);
  assert.throws(() => parseImportPayload(JSON.stringify({ schemaVersion: 1, workspaces: 'nope' })), /invalid-backup/);
});

test('previews valid workspaces and counts invalid records', () => {
  const item = workspace();
  const parsed = parseImportPayload(JSON.stringify({
    schemaVersion: 1,
    exportedAt: '2026-07-26T08:00:00.000Z',
    extensionVersion: '0.2.0',
    workspaces: [item, { id: 'bad', title: 'Broken', tabs: 'nope' }],
  }));

  assert.equal(parsed.validWorkspaces.length, 1);
  assert.equal(parsed.invalidWorkspaceCount, 1);
  assert.equal(parsed.tabCount, 1);
});

test('merges imports without overwriting and preserves conflicting snapshots as copies', () => {
  const original = workspace();
  const exactCopy = structuredClone(original);
  const conflict = { ...structuredClone(original), title: '远端版本' };
  const fresh = workspace('新工作区', '2026-07-26T09:00:00.000Z');
  let id = 0;

  const result = mergeImportedWorkspaces([original], [exactCopy, conflict, fresh], {
    makeId: () => `imported-${++id}`,
  });

  assert.equal(result.importedCount, 2);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.conflictCount, 1);
  assert.equal(result.workspaces.length, 3);
  assert.equal(result.workspaces.find((item) => item.id === 'imported-1').title, '远端版本（导入副本）');
  assert.ok(result.workspaces.some((item) => item.id === fresh.id));
});

test('moves deleted workspaces to trash, restores them, and permanently removes trash entries', () => {
  const item = workspace();
  const deletedAt = new Date('2026-07-26T08:00:00.000Z');
  const moved = moveWorkspaceToTrash([item], [], item.id, deletedAt);

  assert.equal(moved.ok, true);
  assert.deepEqual(moved.workspaces, []);
  assert.equal(moved.trash[0].deletedAt, deletedAt.toISOString());

  const restored = restoreTrashWorkspace(moved.workspaces, moved.trash, item.id);
  assert.equal(restored.ok, true);
  assert.equal(restored.workspaces[0].id, item.id);
  assert.deepEqual(restored.trash, []);

  const removed = permanentlyDeleteTrash([], moved.trash, item.id);
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.trash, []);
});

test('moves multiple selected workspaces to trash in one atomic result', () => {
  const first = workspace('First');
  const second = workspace('Second', '2026-07-26T09:00:00.000Z');
  const third = workspace('Third', '2026-07-27T09:00:00.000Z');

  const result = moveWorkspacesToTrash([first, second, third], [], [first.id, third.id], new Date('2026-07-28T08:00:00.000Z'));

  assert.equal(result.movedCount, 2);
  assert.deepEqual(result.workspaces.map((item) => item.id), [second.id]);
  assert.deepEqual(new Set(result.trash.map((item) => item.id)), new Set([first.id, third.id]));
});

test('prunes trash after 30 days and reports the 10 MB storage warning threshold', () => {
  const item = workspace();
  const now = new Date('2026-07-31T00:00:00.000Z');
  const recent = { ...item, id: 'recent', deletedAt: '2026-07-02T00:00:01.000Z' };
  const expired = { ...item, id: 'expired', deletedAt: '2026-07-01T00:00:00.000Z' };

  assert.deepEqual(pruneTrash([recent, expired], now).map((entry) => entry.id), ['recent']);
  assert.deepEqual(getStorageHealth(STORAGE_QUOTA_BYTES * 0.8), {
    bytesInUse: STORAGE_QUOTA_BYTES * 0.8,
    quotaBytes: STORAGE_QUOTA_BYTES,
    ratio: 0.8,
    warning: true,
  });
  assert.equal(DATA_VERSION, 1);
});

test('handles missing trash targets, restore ID collisions, and undefined storage values', () => {
  const item = workspace();
  const trashEntry = { ...item, deletedAt: '2026-07-26T08:00:00.000Z' };
  const missingMove = moveWorkspaceToTrash([item], [], 'missing');
  const missingBatch = moveWorkspacesToTrash([item], [], []);
  const restored = restoreTrashWorkspace([item], [trashEntry], item.id, { makeId: () => 'restored-copy' });
  const missingDelete = permanentlyDeleteTrash([item], [], 'missing');

  assert.equal(missingMove.ok, false);
  assert.equal(missingBatch.ok, false);
  assert.equal(restored.workspaces[0].id, 'restored-copy');
  assert.match(restored.workspaces[0].title, /恢复副本/);
  assert.equal(missingDelete.ok, false);
  assert.equal(measureStorageBytes({ kept: 'yes', ignored: undefined }), measureStorageBytes({ kept: 'yes' }));
});
