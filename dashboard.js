import { deleteCustomBackground, getCustomBackground, saveCustomBackground, validateBackgroundFile } from './appearance-store.js';
import { accentInkColor, DEFAULT_ACCENT_COLOR, normalizeAccentColor } from './src/lib/appearance-rules.js';
import { getUndoPresentation } from './src/lib/undo-presentation.js';
import { matchesWorkspaceQuery } from './src/lib/workspace-query.js';
import {
  formatStorageUsage,
  importFailureMessage,
  importPreviewMessage,
  restoreResultMessage,
} from './src/lib/v02-presentation.js';
import {
  DEFAULT_WORKSPACE_RENDER_LIMIT,
  getWorkspaceRenderSlice,
  restoreProgressMessage,
} from './src/lib/v03-presentation.js';
import { clipboardSuccessMessage, formatWorkspaceClipboard } from './src/lib/v04-presentation.js';
import { copyText, createElement, createWorkspaceRow, formatTime, sendMessage } from './shared-ui.js';

const APPEARANCE_KEY = 'appearance';
const list = document.querySelector('#workspace-list');
const status = document.querySelector('#status');
const count = document.querySelector('#workspace-count');
const searchInput = document.querySelector('#workspace-search');
const undoBar = document.querySelector('#undo-bar');
const undoText = document.querySelector('#undo-text');
const appearancePanel = document.querySelector('#appearance-panel');
const backupPanel = document.querySelector('#backup-panel');
const trashPanel = document.querySelector('#trash-panel');
const trashList = document.querySelector('#trash-list');
const trashCount = document.querySelector('#trash-count');
const emptyTrash = document.querySelector('#empty-trash');
const storageWarning = document.querySelector('#storage-warning');
const storageLabel = document.querySelector('#storage-label');
const storageMeter = document.querySelector('#storage-meter');
const backupSelectionCount = document.querySelector('#backup-selection-count');
const exportSelected = document.querySelector('#export-selected');
const pinSelected = document.querySelector('#pin-selected');
const unpinSelected = document.querySelector('#unpin-selected');
const trashSelected = document.querySelector('#trash-selected');
const importFile = document.querySelector('#import-file');
const importPreview = document.querySelector('#import-preview');
const importPreviewText = document.querySelector('#import-preview-text');
const importConfirm = document.querySelector('#import-confirm');
const restoreReport = document.querySelector('#restore-report');
const restoreReportText = document.querySelector('#restore-report-text');
const retryRestore = document.querySelector('#retry-restore');
const restoreProgress = document.querySelector('#restore-progress');
const restoreProgressText = document.querySelector('#restore-progress-text');
const restoreProgressCount = document.querySelector('#restore-progress-count');
const restoreProgressMeter = document.querySelector('#restore-progress-meter');
const loadMore = document.querySelector('#load-more');
const backgroundFile = document.querySelector('#background-file');
const backgroundDim = document.querySelector('#background-dim');
const backgroundRemove = document.querySelector('#background-remove');
const accentColor = document.querySelector('#accent-color');

let state = { workspaces: [], undo: null, trash: [], storageHealth: null };
let expandedId = null;
let editingId = null;
let query = '';
let timerId = null;
let backgroundUrl = null;
let pendingImportText = null;
let lastRetry = null;
let activeRestoreJob = null;
let currentRestoreProgress = null;
let renderLimit = DEFAULT_WORKSPACE_RENDER_LIMIT;
let appearance = { enabled: false, dim: 78, accent: DEFAULT_ACCENT_COLOR };
const selectedTabs = new Map();
const selectedWorkspaces = new Set();

function setStatus(message) {
  status.textContent = message;
}

function selectedFor(workspaceId) {
  if (!selectedTabs.has(workspaceId)) selectedTabs.set(workspaceId, new Set());
  return selectedTabs.get(workspaceId);
}

function setPanel(panel, open) {
  for (const candidate of [backupPanel, trashPanel, appearancePanel]) {
    candidate.hidden = candidate !== panel || !open;
  }
  if (!open || panel !== backupPanel) selectedWorkspaces.clear();
  renderBackupSelection();
  render();
}

function showRestoreResult(result, workspaceId) {
  const message = restoreResultMessage(result, true);
  setStatus(message);
  const hasDetails = Boolean(
    result.failedCount || result.unsupportedCount || result.pinFailedCount || result.groupFailedCount,
  );
  restoreReport.hidden = !hasDetails;
  restoreReportText.textContent = message;
  retryRestore.hidden = !result.failedCount;
  lastRetry = result.failedCount ? {
    workspaceId,
    tabIndexes: result.failedTabs.map((tab) => tab.index),
    windowId: result.windowId,
    existingGroupIds: result.restoredGroups,
  } : null;
}

async function restore(workspaceId, tabIndexes, windowId, existingGroupIds) {
  if (activeRestoreJob) return;
  const restoreJobId = crypto.randomUUID();
  activeRestoreJob = restoreJobId;
  currentRestoreProgress = {
    phase: 'tabs', processedCount: 0, totalCount: 0, restoredCount: 0, failedCount: 0,
    groupCompletedCount: 0, groupTotalCount: 0,
  };
  renderRestoreProgress();
  render();
  try {
    const result = await sendMessage({
      type: 'restore-workspace', workspaceId, tabIndexes, windowId, restoreJobId, existingGroupIds,
    });
    showRestoreResult(result, workspaceId);
    if (result.restored) selectedTabs.delete(workspaceId);
  } catch {
    setStatus('恢复没有完成，请再试一次。');
  } finally {
    activeRestoreJob = null;
    currentRestoreProgress = null;
    renderRestoreProgress();
    await refresh();
  }
}

async function copyWorkspace(workspace, format) {
  const copied = await copyText(formatWorkspaceClipboard(workspace, format));
  const count = workspace.tabs.filter((tab) => tab.restorable && typeof tab.url === 'string').length;
  setStatus(copied ? clipboardSuccessMessage(format, count) : '这个工作区没有可复制的网页。');
}

function createRow(workspace) {
  return createWorkspaceRow(workspace, {
    expanded: workspace.id === expandedId,
    editing: workspace.id === editingId,
    selectable: !backupPanel.hidden,
    selected: selectedWorkspaces.has(workspace.id),
    selectedTabIndexes: selectedFor(workspace.id),
    restoring: Boolean(activeRestoreJob),
    onWorkspaceSelectionChange: (checked) => {
      if (checked) selectedWorkspaces.add(workspace.id);
      else selectedWorkspaces.delete(workspace.id);
      renderBackupSelection();
    },
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
      setStatus(result.workspaceDeleted ? '工作区已移入回收站。' : `已移除 ${result.removedTabCount} 个标签。`);
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
      const result = await sendMessage({ type: 'delete-workspace', workspaceId: workspace.id });
      selectedTabs.delete(workspace.id);
      selectedWorkspaces.delete(workspace.id);
      if (expandedId === workspace.id) expandedId = null;
      if (editingId === workspace.id) editingId = null;
      setStatus(result.deleted ? '工作区已移入回收站。' : '工作区已不存在。');
      await refresh();
    },
    onCopyList: () => copyWorkspace(workspace, 'list'),
    onCopyUrls: () => copyWorkspace(workspace, 'urls'),
    onCopyMarkdown: () => copyWorkspace(workspace, 'markdown'),
  });
}

function appendGroup(label, workspaces) {
  if (!workspaces.length) return;
  const group = createElement('section', 'workspace-group');
  group.append(createElement('h3', 'workspace-group-label', label));
  for (const workspace of workspaces) group.append(createRow(workspace));
  list.append(group);
}

function renderBackupSelection() {
  const selectedCount = selectedWorkspaces.size;
  backupSelectionCount.textContent = selectedCount ? `已选 ${selectedCount} 个工作区` : '未选择工作区';
  exportSelected.disabled = selectedCount === 0;
  pinSelected.disabled = selectedCount === 0;
  unpinSelected.disabled = selectedCount === 0;
  trashSelected.disabled = selectedCount === 0;
}

function renderRestoreProgress() {
  restoreProgress.hidden = !currentRestoreProgress;
  if (!currentRestoreProgress) return;
  const progress = currentRestoreProgress;
  const totalSteps = progress.totalCount + progress.groupTotalCount;
  const completedSteps = progress.processedCount + progress.groupCompletedCount;
  restoreProgressText.textContent = restoreProgressMessage(progress);
  restoreProgressCount.textContent = totalSteps ? `${completedSteps} / ${totalSteps}` : '准备中';
  restoreProgressMeter.value = totalSteps ? completedSteps / totalSteps : 0;
}

function renderStorageHealth() {
  if (!state.storageHealth) return;
  storageLabel.textContent = formatStorageUsage(state.storageHealth);
  storageMeter.value = Math.min(1, state.storageHealth.ratio);
  storageMeter.classList.toggle('is-warning', state.storageHealth.warning);
  storageWarning.hidden = !state.storageHealth.warning;
}

function renderTrash() {
  trashList.replaceChildren();
  trashCount.textContent = state.trash.length ? String(state.trash.length) : '';
  emptyTrash.disabled = state.trash.length === 0;
  if (!state.trash.length) {
    trashList.append(createElement('p', 'empty-state', '回收站为空。'));
    return;
  }
  for (const workspace of state.trash) {
    const row = createElement('article', 'trash-row');
    const summary = createElement('div', 'trash-summary');
    summary.append(
      createElement('span', 'trash-title', workspace.title),
      createElement('span', 'trash-meta', `${formatTime(workspace.deletedAt)} · ${workspace.tabCount} 个标签`),
    );
    const actions = createElement('div', 'trash-actions');
    const recover = createElement('button', 'button button-restore', '恢复');
    recover.type = 'button';
    recover.addEventListener('click', async () => {
      const result = await sendMessage({ type: 'restore-trash-workspace', workspaceId: workspace.id });
      setStatus(result.restored ? '工作区已从回收站恢复。' : '这条记录已不存在。');
      await refresh();
    });
    const remove = createElement('button', 'button button-danger', '永久删除');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!globalThis.confirm(`永久删除「${workspace.title}」？`)) return;
      await sendMessage({ type: 'permanently-delete-trash', workspaceId: workspace.id });
      setStatus('已永久删除。');
      await refresh();
    });
    actions.append(recover, remove);
    row.append(summary, actions);
    trashList.append(row);
  }
}

function render() {
  list.replaceChildren();
  const visible = state.workspaces.filter((workspace) => matchesWorkspaceQuery(workspace, query));
  const page = getWorkspaceRenderSlice(visible, renderLimit);
  count.textContent = query ? `${visible.length} / ${state.workspaces.length} 条记录` : `${state.workspaces.length} 条记录`;
  if (visible.length === 0) {
    list.append(createElement('p', 'empty-state', query ? '没有匹配的工作区。' : '还没有存下任何工作区。'));
  } else {
    appendGroup('置顶', page.items.filter((workspace) => workspace.pinned));
    appendGroup('时间线', page.items.filter((workspace) => !workspace.pinned));
  }
  loadMore.hidden = !page.hasMore;
  loadMore.textContent = page.hasMore ? `再显示 ${Math.min(DEFAULT_WORKSPACE_RENDER_LIMIT, page.remainingCount)} 条` : '';
  renderUndo();
  renderBackupSelection();
  renderStorageHealth();
  renderTrash();
  renderRestoreProgress();
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

async function downloadBackup(workspaceIds) {
  const result = await sendMessage({ type: 'export-workspaces', workspaceIds });
  if (!result.exported) {
    setStatus('没有可导出的工作区。');
    return;
  }
  const blob = new Blob([JSON.stringify(result.payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tab-vault-${new Date().toISOString().slice(0, 10)}.tabvault.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus(`已导出 ${result.payload.workspaces.length} 个工作区。`);
}

function clearImportPreview() {
  pendingImportText = null;
  importPreview.hidden = true;
  importPreviewText.textContent = '';
  importFile.value = '';
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
  setStatus(result.undone ? restoreResultMessage({ restored: true, ...result }, true) : '撤销时间已过。');
  await refresh();
});

searchInput.addEventListener('input', () => {
  query = searchInput.value;
  renderLimit = DEFAULT_WORKSPACE_RENDER_LIMIT;
  render();
});

loadMore.addEventListener('click', () => {
  renderLimit += DEFAULT_WORKSPACE_RENDER_LIMIT;
  render();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'restore-progress' || message.restoreJobId !== activeRestoreJob) return;
  currentRestoreProgress = message;
  renderRestoreProgress();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refresh();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.workspaces || changes.trash) {
    void refresh();
    return;
  }
  if (changes.undo) {
    state = { ...state, undo: changes.undo.newValue ?? null };
    renderUndo();
  }
});

document.querySelector('#backup-toggle').addEventListener('click', () => setPanel(backupPanel, backupPanel.hidden));
document.querySelector('#backup-close').addEventListener('click', () => setPanel(backupPanel, false));
document.querySelector('#trash-toggle').addEventListener('click', () => setPanel(trashPanel, trashPanel.hidden));
document.querySelector('#trash-close').addEventListener('click', () => setPanel(trashPanel, false));
document.querySelector('#appearance-toggle').addEventListener('click', () => setPanel(appearancePanel, appearancePanel.hidden));
document.querySelector('#appearance-close').addEventListener('click', () => setPanel(appearancePanel, false));

document.querySelector('#export-all').addEventListener('click', () => downloadBackup());
exportSelected.addEventListener('click', () => downloadBackup([...selectedWorkspaces]));

async function setSelectedPinState(pinned) {
  if (!selectedWorkspaces.size) return;
  const result = await sendMessage({
    type: 'set-workspaces-pin',
    workspaceIds: [...selectedWorkspaces],
    pinned,
  });
  setStatus(result.pinned
    ? `已${pinned ? '置顶' : '取消置顶'} ${result.updatedCount} 个工作区。`
    : '请先选择工作区。');
  selectedWorkspaces.clear();
  await refresh();
}

pinSelected.addEventListener('click', () => setSelectedPinState(true));
unpinSelected.addEventListener('click', () => setSelectedPinState(false));

importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    setStatus('备份文件过大，未读取。');
    clearImportPreview();
    return;
  }
  pendingImportText = await file.text();
  const preview = await sendMessage({ type: 'preview-import', text: pendingImportText });
  if (!preview.valid) {
    setStatus(importFailureMessage(preview.reason));
    clearImportPreview();
    return;
  }
  importPreviewText.textContent = importPreviewMessage(preview);
  importPreviewText.textContent += ` 预计占用 ${formatStorageUsage({
    bytesInUse: preview.estimatedBytesAfterImport,
    quotaBytes: preview.quotaBytes,
  })}。`;
  importConfirm.disabled = preview.importedCount === 0;
  if (!preview.willFit) {
    importConfirm.disabled = true;
    setStatus('导入后会超过本地空间上限。');
  }
  importPreview.hidden = false;
});

importConfirm.addEventListener('click', async () => {
  if (!pendingImportText) return;
  const result = await sendMessage({ type: 'import-workspaces', text: pendingImportText });
  if (!result.imported) {
    setStatus(importFailureMessage(result.reason));
    return;
  }
  setStatus(`已导入 ${result.importedCount} 个工作区，跳过 ${result.duplicateCount} 个重复。`);
  clearImportPreview();
  selectedWorkspaces.clear();
  await refresh();
});

document.querySelector('#import-cancel').addEventListener('click', clearImportPreview);

trashSelected.addEventListener('click', async () => {
  if (!selectedWorkspaces.size || !globalThis.confirm(`将选中的 ${selectedWorkspaces.size} 个工作区移入回收站？`)) return;
  const result = await sendMessage({ type: 'delete-workspaces', workspaceIds: [...selectedWorkspaces] });
  setStatus(result.deleted ? `已将 ${result.deletedCount} 个工作区移入回收站。` : '请先选择工作区。');
  selectedWorkspaces.clear();
  await refresh();
});

emptyTrash.addEventListener('click', async () => {
  if (!state.trash.length || !globalThis.confirm('永久清空回收站？')) return;
  await sendMessage({ type: 'empty-trash' });
  setStatus('回收站已清空。');
  await refresh();
});

retryRestore.addEventListener('click', () => {
  if (lastRetry) void restore(
    lastRetry.workspaceId,
    lastRetry.tabIndexes,
    lastRetry.windowId,
    lastRetry.existingGroupIds,
  );
});

document.querySelector('#dismiss-restore-report').addEventListener('click', () => {
  restoreReport.hidden = true;
  lastRetry = null;
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
