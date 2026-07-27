function restorableTabs(workspace) {
  return (workspace.tabs ?? []).filter((tab) => tab.restorable && typeof tab.url === 'string');
}

function escapeMarkdownTitle(title) {
  return String(title || '未命名标签').replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
}

export function formatWorkspaceClipboard(workspace, format = 'plain') {
  const tabs = restorableTabs(workspace);
  if (format === 'markdown') {
    return tabs.map((tab) => `- [${escapeMarkdownTitle(tab.title)}](<${tab.url}>)`).join('\n');
  }
  return tabs.map((tab) => tab.url).join('\n');
}
