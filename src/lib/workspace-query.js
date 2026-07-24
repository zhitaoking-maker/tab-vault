function searchableText(workspace) {
  const tabText = (workspace.tabs ?? []).flatMap((tab) => [tab.title ?? '', tab.url ?? '']);
  return [workspace.title ?? '', ...tabText].join('\n').toLocaleLowerCase('zh-CN');
}

export function matchesWorkspaceQuery(workspace, query) {
  const normalizedQuery = String(query ?? '').trim().toLocaleLowerCase('zh-CN');
  return !normalizedQuery || searchableText(workspace).includes(normalizedQuery);
}
