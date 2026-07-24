import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesWorkspaceQuery } from '../src/lib/workspace-query.js';

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
