import { deleteCustomBackground, getCustomBackground, saveCustomBackground, validateBackgroundFile } from './appearance-store.js';
import { accentInkColor, DEFAULT_ACCENT_COLOR, normalizeAccentColor } from './src/lib/appearance-rules.js';
import { getUndoPresentation } from './src/lib/undo-presentation.js';
import { matchesWorkspaceQuery } from './src/lib/workspace-query.js';
import { createElement, createWorkspaceRow, sendMessage } from './shared-ui.js';

const APPEARANCE_KEY = 'appearance';
const list = document.querySelector('#workspace-list');
const status = document.querySelector('#status');
const count = document.querySelector('#workspace-count');
const searchInput = document.querySelector('#workspace-search');
const undoBar = document.querySelector('#undo-bar');
const undoText = document.querySelector('#undo-text');
const appearancePanel = document.querySelector('#appearance-panel');
const backgroundFile = document.querySelector('#background-file');
const backgroundDim = document.querySelector('#background-dim');
const backgroundRemove = document.querySelector('#background-remove');
const accentColor = document.querySelector('#accent-color');
const appearanceClose = document.querySelector('#appearance-close');
let state = { workspaces: [], undo: null };
let expandedId = null;
let editingId = null;
let query = '';
let timerId = null;
let backgroundUrl = null;
let appearance = { enabled: false, dim: 78, accent: DEFAULT_ACCENT_COLOR };
const selectedTabs = new Map();

function setStatus(message) {
  status.textContent = message;
}

function resultMessage(result) {
  if (result.restored) {
    const skipped = result.skippedDuplicateCount ? `，跳过 ${result.skippedDuplicateCount} 个已打开页面。` : '。';
    return `已在新窗口恢复 ${result.restoredCount} 个标签${skipped}`;
  }
  if (result.reason === 'already-open') return `没有新开标签，${result.skippedDuplicateCount} 个页面已在其他窗口打开。`;
  if (result.reason === 'no-recoverable-tabs') return '这条记录没有可恢复的网页。';
  return '这个工作区已不存在。';
}

function selectedFor(workspaceId) {
  if (!selectedTabs.has(workspaceId)) selectedTabs.set(workspaceId, new Set());
  return selectedTabs.get(workspaceId);
}

async function restore(workspaceId, tabIndexes) {
  const result = await sendMessage({ type: 'restore-workspace', workspaceId, tabIndexes });
  setStatus(resultMessage(result));
  if (result.restored) selectedTabs.delete(workspaceId);
  await refresh();
}

function createRow(workspace) {
  return createWorkspaceRow(workspace, {
    expanded: workspace.id === expandedId,
    editing: workspace.id === editingId,
    selectedTabIndexes: selectedFor(workspace.id),
    onToggle: () => {
      expandedId = expandedId === workspace.id ? null : workspace.id;
      render();
    },
    onSelectionChange: (tabIndex, checked) => {
      const selected = selectedFor(workspace.id);
      if (checked) selected.add(tabIndex);
      else selected.delete(tabIndex);
      render();
    },
    onRestore: () => restore(workspace.id),
    onRestoreSelected: () => restore(workspace.id, [...selectedFor(workspace.id)]),
    onDeleteSelected: async () => {
      const result = await sendMessage({
        type: 'delete-workspace-tabs',
        workspaceId: workspace.id,
        tabIndexes: [...selectedFor(workspace.id)],
      });
      if (!result.deleted) {
        setStatus('请先选择要删除的标签。');
        return;
      }
      selectedTabs.delete(workspace.id);
      if (result.workspaceDeleted) expandedId = null;
      setStatus(result.workspaceDeleted ? '工作区已删除。' : `已移除 ${result.removedTabCount} 个标签。`);
      await refresh();
    },
    onTogglePin: async () => {
      await sendMessage({ type: 'toggle-workspace-pin', workspaceId: workspace.id });
      await refresh();
    },
    onStartRename: () => {
      editingId = workspace.id;
      render();
    },
    onRename: async (title) => {
      const result = await sendMessage({ type: 'rename-workspace', workspaceId: workspace.id, title });
      editingId = null;
      setStatus(result.renamed ? '名称已更新。' : '名称不能为空，且最多 60 个字。');
      await refresh();
    },
    onCancelRename: () => {
      editingId = null;
      render();
    },
    onDelete: async () => {
      await sendMessage({ type: 'delete-workspace', workspaceId: workspace.id });
      selectedTabs.delete(workspace.id);
      if (expandedId === workspace.id) expandedId = null;
      if (editingId === workspace.id) editingId = null;
      setStatus('工作区已删除。');
      await refresh();
    },
  });
}

function appendGroup(label, workspaces) {
  if (!workspaces.length) return;
  const group = createElement('section', 'workspace-group');
  group.append(createElement('h3', 'workspace-group-label', label));
  for (const workspace of workspaces) group.append(createRow(workspace));
  list.append(group);
}

function render() {
  list.replaceChildren();
  const visible = state.workspaces.filter((workspace) => matchesWorkspaceQuery(workspace, query));
  count.textContent = query ? `${visible.length} / ${state.workspaces.length} 条记录` : `${state.workspaces.length} 条记录`;
  if (visible.length === 0) {
    list.append(createElement('p', 'empty-state', query ? '没有匹配的工作区。' : '还没有存下任何工作区。'));
  } else {
    appendGroup('置顶', visible.filter((workspace) => workspace.pinned));
    appendGroup('时间线', visible.filter((workspace) => !workspace.pinned));
  }
  renderUndo();
}

function renderUndo() {
  clearTimeout(timerId);
  const undo = getUndoPresentation(state.undo);
  if (!undo.active) {
    undoBar.hidden = true;
    if (state.undo) {
      state = { ...state, undo: null };
      void refresh();
    }
    return;
  }
  undoBar.hidden = false;
  undoText.textContent = `刚刚压缩，可在 ${undo.remainingSeconds} 秒内撤销`;
  timerId = setTimeout(renderUndo, Math.min(250, undo.remainingMs));
}

async function refresh() {
  state = await sendMessage({ type: 'get-state' });
  render();
}

async function saveAppearance() {
  await chrome.storage.local.set({ [APPEARANCE_KEY]: appearance });
}

async function applyAppearance() {
  if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
  backgroundUrl = null;
  const blob = appearance.enabled ? await getCustomBackground() : null;
  if (blob) backgroundUrl = URL.createObjectURL(blob);
  document.documentElement.style.setProperty('--custom-background-image', backgroundUrl ? `url("${backgroundUrl}")` : 'none');
  document.documentElement.style.setProperty('--background-dim', String(appearance.dim / 100));
  applyAccentColor();
  backgroundRemove.disabled = !blob;
}

function applyAccentColor() {
  appearance.accent = normalizeAccentColor(appearance.accent);
  document.documentElement.style.setProperty('--accent', appearance.accent);
  document.documentElement.style.setProperty('--accent-ink', accentInkColor(appearance.accent));
}

async function loadAppearance() {
  const stored = await chrome.storage.local.get(APPEARANCE_KEY);
  const saved = stored[APPEARANCE_KEY] ?? {};
  appearance = {
    enabled: Boolean(saved.enabled),
    dim: Number.isFinite(saved.dim) ? Math.min(92, Math.max(45, saved.dim)) : 78,
    accent: normalizeAccentColor(saved.accent),
  };
  backgroundDim.value = String(appearance.dim);
  accentColor.value = appearance.accent;
  await applyAppearance();
}

document.querySelector('#undo-save').addEventListener('click', async () => {
  const result = await sendMessage({ type: 'undo-save' });
  setStatus(result.undone ? `已恢复 ${result.restoredCount} 个标签。` : '撤销时间已过。');
  await refresh();
});

searchInput.addEventListener('input', () => {
  query = searchInput.value;
  render();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refresh();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.undo) return;
  state = { ...state, undo: changes.undo.newValue ?? null };
  renderUndo();
});

document.querySelector('#appearance-toggle').addEventListener('click', () => {
  appearancePanel.hidden = !appearancePanel.hidden;
});

appearanceClose.addEventListener('click', () => {
  appearancePanel.hidden = true;
  document.querySelector('#appearance-toggle').focus();
});

backgroundFile.addEventListener('change', async () => {
  const file = backgroundFile.files?.[0];
  const validationError = validateBackgroundFile(file);
  if (validationError) {
    setStatus(validationError);
    return;
  }
  await saveCustomBackground(file);
  appearance.enabled = true;
  await saveAppearance();
  await applyAppearance();
  setStatus('自定义背景已更新。');
});

backgroundDim.addEventListener('input', () => {
  appearance.dim = Number(backgroundDim.value);
  document.documentElement.style.setProperty('--background-dim', String(appearance.dim / 100));
});

backgroundDim.addEventListener('change', saveAppearance);

accentColor.addEventListener('input', () => {
  appearance.accent = normalizeAccentColor(accentColor.value);
  applyAccentColor();
});

accentColor.addEventListener('change', saveAppearance);

backgroundRemove.addEventListener('click', async () => {
  await deleteCustomBackground();
  appearance.enabled = false;
  backgroundFile.value = '';
  await saveAppearance();
  await applyAppearance();
  setStatus('已移除自定义背景。');
});

Promise.all([refresh(), loadAppearance()]);
