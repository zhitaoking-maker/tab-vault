export const DEFAULT_WORKSPACE_RENDER_LIMIT = 40;

export function getWorkspaceRenderSlice(workspaces, limit = DEFAULT_WORKSPACE_RENDER_LIMIT) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_WORKSPACE_RENDER_LIMIT;
  const items = workspaces.slice(0, safeLimit);
  const remainingCount = Math.max(0, workspaces.length - items.length);
  return { items, remainingCount, hasMore: remainingCount > 0 };
}

export function restoreProgressMessage(progress) {
  if (progress.phase === 'groups') {
    return `标签已完成，正在恢复标签组 ${progress.groupCompletedCount ?? 0} / ${progress.groupTotalCount ?? 0}`;
  }
  const failure = progress.failedCount ? `，${progress.failedCount} 个失败` : '';
  return `正在恢复标签 ${progress.processedCount ?? 0} / ${progress.totalCount ?? 0}${failure}`;
}
