import { createElement, createWorkspaceRow, sendMessage } from './shared-ui.js';
import { getUndoPresentation } from './src/lib/undo-presentation.js';

const list = document.querySelector('#workspace-list');
const status = document.querySelector('#status');
const undoBar = document.querySelector('#undo-bar');
const undoText = document.querySelector('#undo-text');
const count = document.querySelector('#workspace-count');
let state = { workspaces: [], undo: null };
let expandedId = null;
let editingId = null;
let timerId = null;
const selectedTabs = new Map();

function setStatus(message) {
  status.textContent = message;
}

function saveFailureMessage(reason) {
  if (reason === 'incognito-window') return '隐身窗口不会保存到普通工作区。';
  if (reason === 'no-recoverable-tabs') return '当前窗口没有可压缩的网页。';
  return '当前窗口没有可保存的标签。';
}

function resultMessage(result) {
  if (result.restored) return `已恢复 ${result.restoredCount} 个标签${result.skippedDuplicateCount ? `，跳过 ${result.skippedDuplicateCount} 个已打开页面。` : '。'}`;
  if (result.reason === 'already-open') return `没有新开标签，${result.skippedDuplicateCount} 个页面已打开。`;
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
  await refresh();
}

function render() {
  list.replaceChildren();
  count.textContent = state.workspaces.length ? `${state.workspaces.length} 条` : '';
  if (state.workspaces.length === 0) {
    list.append(createElement('p', 'empty-state', '这里会保存你暂时离开的工作现场。'));
  } else {
    for (const workspace of state.workspaces) {
      list.append(createWorkspaceRow(workspace, {
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
      }));
    }
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
  undoText.textContent = `已压缩，可在 ${undo.remainingSeconds} 秒内撤销`;
  timerId = setTimeout(renderUndo, Math.min(250, undo.remainingMs));
}

async function refresh() {
  state = await sendMessage({ type: 'get-state' });
  render();
}

document.querySelector('#save-current').addEventListener('click', async () => {
  const button = document.querySelector('#save-current');
  button.disabled = true;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await sendMessage({ type: 'save-current', windowId: activeTab?.windowId });
    setStatus(result.saved ? `已保存 ${result.workspace.tabCount} 个标签，已打开总览。` : saveFailureMessage(result.reason));
    await refresh();
  } catch {
    setStatus('保存失败，请再试一次。');
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#undo-save').addEventListener('click', async () => {
  const result = await sendMessage({ type: 'undo-save' });
  setStatus(result.undone ? `已恢复 ${result.restoredCount} 个标签。` : '撤销时间已过。');
  await refresh();
});

document.querySelector('#open-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.undo) return;
  state = { ...state, undo: changes.undo.newValue ?? null };
  renderUndo();
});

refresh();
