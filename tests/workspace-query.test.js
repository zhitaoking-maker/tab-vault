import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesWorkspaceQuery } from '../src/lib/workspace-query.js';
import {
  STORAGE_KEYS,
  archiveWorkspace,
  normalizeWorkspace,
  unarchiveWorkspace,
} from '../src/lib/workspace-core.js';

const workspace = {
  title: '七月产品研究',
  tabs: [
    { title: 'Tab Vault on GitHub', url: 'https://github.com/example/tab-vault' },
    { title: '设计参考', url: 'https://www.bilibili.com/video/BV1' },
  ],
};

test('matches a workspace name, tab title, or hostname case-insensitively', () => {
  assert.equal(matchesWorkspaceQuery(workspace, '产品'), true);
  assert.equal(matchesWorkspaceQuery(workspace, 'github'), true);
  assert.equal(matchesWorkspaceQuery(workspace, 'BILIBILI'), true);
  assert.equal(matchesWorkspaceQuery(workspace, 'notion'), false);
});

test('keeps all workspaces visible for an empty search query', () => {
  assert.equal(matchesWorkspaceQuery(workspace, '   '), true);
});

test('normalizes legacy workspace status and preserves archived workspace metadata', () => {
  assert.deepEqual(normalizeWorkspace({ ...workspace, id: 'legacy', createdAt: '2026-09-10T00:00:00.000Z' }).status, 'active');
  assert.deepEqual(normalizeWorkspace({
    ...workspace,
    id: 'archived',
    createdAt: '2026-09-10T00:00:00.000Z',
    status: 'archived',
    archivedAt: '2026-09-09T00:00:00.000Z',
  }).archivedAt, '2026-09-09T00:00:00.000Z');
  assert.equal(STORAGE_KEYS.prompts, 'prompts');
});

test('archives and unarchives a workspace without mutating other entries', () => {
  const original = [
    { ...workspace, id: 'one', createdAt: '2026-09-10T00:00:00.000Z' },
    { ...workspace, id: 'two', createdAt: '2026-09-09T00:00:00.000Z' },
  ];
  const archived = archiveWorkspace(original, 'one');
  assert.notEqual(archived, original);
  assert.equal(archived[0].status, 'archived');
  assert.match(archived[0].archivedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(archived[1], original[1]);

  const restored = unarchiveWorkspace(archived, 'one');
  assert.equal(restored[0].status, 'active');
  assert.equal(restored[0].archivedAt, null);
  assert.equal(archiveWorkspace(original, 'missing'), original);
  assert.equal(unarchiveWorkspace(original, 'missing'), original);
});
