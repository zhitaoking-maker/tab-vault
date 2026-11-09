export function restoreResultMessage(result, dashboard = false) {
  if (result.restored) {
    const parts = [`已恢复 ${result.restoredCount} 个`];
    if (result.failedCount) parts.push(`${result.failedCount} 个失败`);
    if (result.unsupportedCount) parts.push(`${result.unsupportedCount} 个不支持`);
    if (result.pinFailedCount) parts.push(`${result.pinFailedCount} 个固定状态未恢复`);
    if (result.groupFailedCount) parts.push(`${result.groupFailedCount} 个标签组未完整恢复`);
    return `${parts.join('，')}。`;
  }
  if (result.reason === 'restore-failed') return `${result.failedCount || 0} 个标签恢复失败${dashboard ? '，可以重试' : ''}。`;
  if (result.reason === 'no-recoverable-tabs') return '这条记录没有可恢复的网页。';
  if (result.reason === 'missing') return '这个工作区已不存在。';
  return '恢复没有完成，请再试一次。';
}

export function importPreviewMessage(preview) {
  const details = [];
  if (preview.duplicateCount) details.push(`${preview.duplicateCount} 个重复`);
  if (preview.conflictCount) details.push(`${preview.conflictCount} 个冲突将保留副本`);
  if (preview.invalidWorkspaceCount) details.push(`${preview.invalidWorkspaceCount} 个无效`);
  const suffix = details.length ? `；${details.join('，')}` : '';
  return `${preview.workspaceCount} 个工作区，${preview.tabCount} 个标签${suffix}。`;
}

export function importFailureMessage(reason) {
  if (reason === 'invalid-json') return '文件不是有效的 JSON 备份。';
  if (reason === 'unsupported-version') return '备份来自更新的数据版本，请先更新 Tab Vault。';
  if (reason === 'storage-full') return '本地空间不足，未导入任何数据。';
  if (reason === 'invalid-backup') return '文件不是有效的 Tab Vault 备份。';
  return '导入失败，现有数据没有变化。';
}

export function formatStorageUsage(health) {
  const megabytes = health.bytesInUse / (1024 * 1024);
  const quotaMegabytes = health.quotaBytes / (1024 * 1024);
  return `${Number(megabytes.toFixed(1))} MB / ${Number(quotaMegabytes.toFixed(1))} MB`;
}
