export function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

export function formatTime(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

export function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url || '无法恢复';
  }
}

export function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createWorkspaceRow(workspace, {
  onRestore,
  onRestoreSelected,
  onDelete,
  onDeleteSelected,
  onTogglePin,
  onStartRename,
  onRename,
  onCancelRename,
  onSelectionChange,
  selectable = false,
  selected = false,
  onWorkspaceSelectionChange,
  expanded = false,
  editing = false,
  selectedTabIndexes = new Set(),
  onToggle,
  restoring = false,
}) {
  const row = createElement('article', 'workspace-row');
  const main = createElement('div', 'workspace-main');
  if (selectable) {
    const selector = document.createElement('input');
    selector.type = 'checkbox';
    selector.className = 'workspace-select';
    selector.checked = selected;
    selector.setAttribute('aria-label', `选择工作区 ${workspace.title}`);
    selector.addEventListener('change', () => onWorkspaceSelectionChange(selector.checked));
    row.append(selector);
  }
  if (editing) {
    const input = document.createElement('input');
    input.className = 'workspace-title-input';
    input.value = workspace.title;
    input.maxLength = 60;
    input.setAttribute('aria-label', '工作区名称');
    let settled = false;
    const commit = () => {
      if (settled) return;
      settled = true;
      onRename(input.value);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
      if (event.key === 'Escape') {
        settled = true;
        onCancelRename();
      }
    });
    input.addEventListener('blur', commit);
    main.append(input);
    queueMicrotask(() => input.select());
  } else {
    const title = createElement('button', 'workspace-title');
    title.type = 'button';
    title.setAttribute('aria-expanded', String(expanded));
    title.addEventListener('click', onToggle);
    title.append(
      createElement('span', 'workspace-title-text', workspace.title),
      createElement('span', 'workspace-chevron'),
    );
    main.append(title);
  }

  const metadata = createElement('div', 'workspace-meta');
  metadata.append(
    createElement('span', '', formatTime(workspace.createdAt)),
    createElement('span', '', `${workspace.tabCount} 个标签`),
  );
  if (workspace.groups?.length) metadata.append(createElement('span', '', `${workspace.groups.length} 个标签组`));
  main.append(metadata);
  row.append(main);

  const controls = createElement('div', 'workspace-controls');
  const pin = createElement('button', `button button-pin${workspace.pinned ? ' is-pinned' : ''}`, workspace.pinned ? '取消置顶' : '置顶');
  pin.type = 'button';
  pin.addEventListener('click', onTogglePin);
  const rename = createElement('button', 'button', '改名');
  rename.type = 'button';
  rename.addEventListener('click', onStartRename);
  const recoverableCount = workspace.tabs.filter((tab) => tab.restorable).length;
  const restore = createElement('button', 'button button-restore', recoverableCount ? '恢复' : '无法恢复');
  restore.type = 'button';
  restore.disabled = recoverableCount === 0 || restoring;
  if (recoverableCount) restore.addEventListener('click', onRestore);
  const remove = createElement('button', 'button button-danger', '删除');
  remove.type = 'button';
  remove.addEventListener('click', onDelete);
  controls.append(pin, rename, restore, remove);
  row.append(controls);

  if (expanded) {
    const list = createElement('ol', 'tab-preview');
    const groupByTabIndex = new Map();
    for (const group of workspace.groups ?? []) {
      for (const tabIndex of group.tabIndexes) groupByTabIndex.set(tabIndex, group);
    }
    for (const tab of workspace.tabs) {
      const item = createElement('li', tab.restorable ? '' : 'unrestorable');
      if (tab.restorable) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'tab-select';
        checkbox.checked = selectedTabIndexes.has(tab.index);
        checkbox.setAttribute('aria-label', `选择 ${tab.title}`);
        checkbox.addEventListener('change', () => onSelectionChange(tab.index, checkbox.checked));
        item.append(checkbox);
      }
      const icon = tab.favIconUrl ? document.createElement('img') : createElement('span', 'site-mark', tab.pinned ? 'P' : '·');
      if (tab.favIconUrl) {
        icon.className = 'site-icon';
        icon.src = tab.favIconUrl;
        icon.alt = '';
      }
      const text = createElement('div', 'tab-text');
      const titleLine = createElement('span', 'tab-title-line');
      titleLine.append(createElement('span', 'tab-title', tab.title));
      const group = groupByTabIndex.get(tab.index);
      if (group) {
        const badge = createElement('span', 'tab-group-badge', group.title || '未命名组');
        badge.dataset.color = group.color;
        titleLine.append(badge);
      }
      text.append(titleLine);
      text.append(createElement('span', 'tab-host', tab.restorable ? hostname(tab.url) : '无法恢复的浏览器内部页面'));
      item.append(icon, text);
      list.append(item);
    }
    row.append(list);
    const selectedCount = selectedTabIndexes.size;
    const selectedRestore = createElement('button', 'button button-selected-restore', `恢复选中${selectedCount ? ` (${selectedCount})` : ''}`);
    selectedRestore.type = 'button';
    selectedRestore.disabled = selectedCount === 0 || restoring;
    selectedRestore.addEventListener('click', onRestoreSelected);
    const selectedDelete = createElement('button', 'button button-danger', `删除选中${selectedCount ? ` (${selectedCount})` : ''}`);
    selectedDelete.type = 'button';
    selectedDelete.disabled = selectedCount === 0;
    selectedDelete.addEventListener('click', onDeleteSelected);
    const previewActions = createElement('div', 'preview-actions');
    previewActions.append(selectedRestore, selectedDelete);
    row.append(previewActions);
  }
  return row;
}
