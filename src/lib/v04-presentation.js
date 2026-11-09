function restorableTabs(workspace) {
  return (workspace.tabs ?? []).filter((tab) => tab.restorable && typeof tab.url === 'string');
}

function cleanTitle(title, fallback) {
  return String(title || fallback).replace(/\s+/g, ' ').trim() || fallback;
}

function escapeMarkdownTitle(title) {
  return cleanTitle(title, '未命名标签').replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
}

export function formatWorkspaceClipboard(workspace, format = 'list') {
  const tabs = restorableTabs(workspace);
  if (!tabs.length) return '';
  if (format === 'markdown') {
    return tabs.map((tab) => `- [${escapeMarkdownTitle(tab.title)}](<${tab.url}>)`).join('\n');
  }
  if (format === 'urls' || format === 'plain') return tabs.map((tab) => tab.url).join('\n');

  const title = cleanTitle(workspace.title, '未命名工作区');
  const items = tabs.map((tab, index) => [
    `${index + 1}. ${cleanTitle(tab.title, '未命名标签')}`,
    `   ${tab.url}`,
  ].join('\n'));
  return `${title}\n\n${items.join('\n\n')}`;
}

export function clipboardSuccessMessage(format, count) {
  if (format === 'urls' || format === 'plain') return `已复制 ${count} 个 URL，适合批量导入其他工具。`;
  if (format === 'markdown') return `已复制 ${count} 个 Markdown 链接，适合粘贴到 Obsidian 或 GitHub。`;
  return `已复制 ${count} 个网页，适合直接粘贴到聊天或笔记。`;
}
