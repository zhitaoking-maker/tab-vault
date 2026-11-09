import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWorkspaceRenderSlice,
  restoreProgressMessage,
} from '../src/lib/v03-presentation.js';

test('renders workspace lists in bounded slices', () => {
  const workspaces = Array.from({ length: 95 }, (_, index) => ({ id: String(index) }));

  assert.deepEqual(getWorkspaceRenderSlice(workspaces, 40), {
    items: workspaces.slice(0, 40),
    remainingCount: 55,
    hasMore: true,
  });
  assert.deepEqual(getWorkspaceRenderSlice(workspaces, 120), {
    items: workspaces,
    remainingCount: 0,
    hasMore: false,
  });
});

test('describes tab and group restore progress compactly', () => {
  assert.equal(restoreProgressMessage({
    phase: 'tabs', processedCount: 18, totalCount: 60, restoredCount: 17, failedCount: 1,
  }), '正在恢复标签 18 / 60，1 个失败');
  assert.equal(restoreProgressMessage({
    phase: 'groups', processedCount: 60, totalCount: 60, groupCompletedCount: 2, groupTotalCount: 5,
  }), '标签已完成，正在恢复标签组 2 / 5');
});
