import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatStorageUsage,
  importFailureMessage,
  importPreviewMessage,
  restoreResultMessage,
} from '../src/lib/v02-presentation.js';

test('describes partial restore failures and metadata loss clearly', () => {
  assert.equal(restoreResultMessage({
    restored: true,
    restoredCount: 3,
    failedCount: 1,
    unsupportedCount: 2,
    pinFailedCount: 1,
  }, true), '已恢复 3 个，1 个失败，2 个不支持，1 个固定状态未恢复。');
  assert.equal(restoreResultMessage({ restored: false, reason: 'restore-failed', failedCount: 2 }, true), '2 个标签恢复失败，可以重试。');
});

test('summarizes import previews and actionable failures', () => {
  assert.equal(importPreviewMessage({
    workspaceCount: 4,
    tabCount: 18,
    duplicateCount: 1,
    conflictCount: 1,
    invalidWorkspaceCount: 1,
  }), '4 个工作区，18 个标签；1 个重复，1 个冲突将保留副本，1 个无效。');
  assert.equal(importFailureMessage('unsupported-version'), '备份来自更新的数据版本，请先更新 Tab Vault。');
  assert.equal(importFailureMessage('storage-full'), '本地空间不足，未导入任何数据。');
});

test('formats storage usage as a compact capacity label', () => {
  assert.equal(formatStorageUsage({ bytesInUse: 1024 * 1024 * 2.5, quotaBytes: 1024 * 1024 * 10 }), '2.5 MB / 10 MB');
});

test('covers empty restore states and every import failure category', () => {
  assert.equal(restoreResultMessage({ restored: false, reason: 'no-recoverable-tabs' }), '这条记录没有可恢复的网页。');
  assert.equal(restoreResultMessage({ restored: false, reason: 'missing' }), '这个工作区已不存在。');
  assert.equal(restoreResultMessage({ restored: false, reason: 'other' }), '恢复没有完成，请再试一次。');
  assert.equal(importFailureMessage('invalid-json'), '文件不是有效的 JSON 备份。');
  assert.equal(importFailureMessage('invalid-backup'), '文件不是有效的 Tab Vault 备份。');
  assert.equal(importFailureMessage('storage-error'), '导入失败，现有数据没有变化。');
  assert.equal(importPreviewMessage({ workspaceCount: 1, tabCount: 2 }), '1 个工作区，2 个标签。');
});
