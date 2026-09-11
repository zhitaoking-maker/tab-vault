import { copyText, createElement, createWorkspaceRow, sendMessage } from './shared-ui.js';
import { getUndoPresentation } from './src/lib/undo-presentation.js';
import { restoreResultMessage } from './src/lib/v02-presentation.js';
import { clipboardSuccessMessage, formatWorkspaceClipboard } from './src/lib/v04-presentation.js';
import { extractVariables, filterPrompts, renderTemplate } from './src/lib/prompt-core.js';

const list = document.querySelector('#workspace-list');
const status = document.querySelector('#status');
const undoBar = document.querySelector('#undo-bar');
const undoText = document.querySelector('#undo-text');
const count = document.querySelector('#workspace-count');
const saveCurrent = document.querySelector('#save-current');
const saveCurrentGroup = document.querySelector('#save-current-group');
const saveAllWindows = document.querySelector('#save-all-windows');
const workspacePanel = document.querySelector('#popup-workspace-panel');
const promptPanel = document.querySelector('#popup-prompt-panel');
const workspaceTab = document.querySelector('#tab-workspaces');
const promptTab = document.querySelector('#tab-prompts');
const promptSearch = document.querySelector('#popup-prompt-search');
const promptList = document.querySelector('#popup-prompt-list');
const promptStatus = document.querySelector('#popup-prompt-status');
const promptFillPanel = document.querySelector('#popup-prompt-fill-panel');
const promptFillForm = document.querySelector('#popup-prompt-fill-form');
const promptFillTitle = document.querySelector('#popup-prompt-fill-title');
const promptFillCount = document.querySelector('#popup-prompt-fill-count');
const promptFillFields = document.querySelector('#popup-prompt-fill-fields');
let state = { workspaces: [], undo: null };
let prompts = [];
let expandedId = null;
let editingId = null;
let timerId = null;
let promptQuery = '';
let fillingPrompt = null;
const selectedTabs = new Map();
let activeContext = null;

function setStatus(message) {
  status.textContent = message;
  promptStatus.textContent = message;
}

function setActiveView(view) {
  const showingPrompts = view === 'prompts';
  if (!showingPrompts) closePromptFillPanel();
  workspacePanel.hidden = showingPrompts;
  promptPanel.hidden = !showingPrompts;
  workspaceTab.classList.toggle('is-active', !showingPrompts);
  workspaceTab.setAttribute('aria-selected', String(!showingPrompts));
  promptTab.classList.toggle('is-active', showingPrompts);
  promptTab.setAttribute('aria-selected', String(showingPrompts));
  if (showingPrompts) {
    void refreshPrompts();
    queueMicrotask(() => promptSearch.focus());
  }
}

function saveFailureMessage(reason) {
  if (reason === 'incognito-window') return '隐身窗口不会保存到普通工作区。';
  if (reason === 'no-recoverable-tabs') return '当前窗口没有可压缩的网页。';
  if (reason === 'storage-full') return '本地空间不足，原标签没有关闭。';
  if (reason === 'storage-error') return '工作区未能安全写入，原标签没有关闭。';
  if (reason === 'missing-tab-group') return '当前标签不在标签组中。';
  return '当前窗口没有可保存的标签。';
}

async function refreshActiveContext() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeContext = activeTab ?? null;
  saveCurrentGroup.disabled = !Number.isInteger(activeTab?.groupId) || activeTab.groupId < 0;
}

async function copyWorkspace(workspace, format) {
  const text = formatWorkspaceClipboard(workspace, format);
  const copied = await copyText(text);
  const count = workspace.tabs.filter((tab) => tab.restorable && typeof tab.url === 'string').length;
  setStatus(copied ? clipboardSuccessMessage(format, count) : '这个工作区没有可复制的网页。');
}

function selectedFor(workspaceId) {
  if (!selectedTabs.has(workspaceId)) selectedTabs.set(workspaceId, new Set());
  return selectedTabs.get(workspaceId);
}

async function restore(workspaceId, tabIndexes) {
  const result = await sendMessage({ type: 'restore-workspace', workspaceId, tabIndexes });
  setStatus(restoreResultMessage(result));
  await refresh();
}

function render() {
  list.replaceChildren();
  const activeWorkspaces = state.workspaces.filter((workspace) => workspace.status === 'active');
  count.textContent = activeWorkspaces.length ? `${activeWorkspaces.length} 条` : '';
  if (activeWorkspaces.length === 0) {
    list.append(createElement('p', 'empty-state', '这里会保存你暂时离开的工作现场。'));
  } else {
    for (const workspace of activeWorkspaces) {
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
          await sendMessage({ type: 'delete-workspace', workspaceId: workspace.id });
          selectedTabs.delete(workspace.id);
          if (expandedId === workspace.id) expandedId = null;
          if (editingId === workspace.id) editingId = null;
          setStatus('工作区已移入回收站。');
          await refresh();
        },
        onCopyList: () => copyWorkspace(workspace, 'list'),
        onCopyUrls: () => copyWorkspace(workspace, 'urls'),
        onCopyMarkdown: () => copyWorkspace(workspace, 'markdown'),
      }));
    }
  }
  renderUndo();
}

function renderPrompts() {
  promptList.replaceChildren();
  const coreMatches = filterPrompts(prompts, { category: 'all', query: promptQuery });
  const normalizedQuery = promptQuery.trim().toLocaleLowerCase();
  const coreMatchIds = new Set(coreMatches.map((prompt) => prompt.id));
  const visiblePrompts = !normalizedQuery ? coreMatches : prompts.filter((prompt) => (
    coreMatchIds.has(prompt.id)
    || (prompt.tags || [prompt.category]).some((tag) => tag.toLocaleLowerCase().includes(normalizedQuery))
  ));
  if (!visiblePrompts.length) {
    promptList.append(createElement('p', 'empty-state', prompts.length ? '没有匹配的提示词。' : '提示词看板还没有内容。'));
    return;
  }
  for (const prompt of visiblePrompts) {
    const row = createElement('article', 'popup-prompt-row');
    const main = createElement('div', 'popup-prompt-main');
    const titleLine = createElement('div', 'popup-prompt-title-line');
    const tags = createElement('span', 'popup-prompt-tags');
    for (const tag of prompt.tags || [prompt.category]) {
      if (tag) tags.append(createElement('span', 'popup-prompt-tag', tag));
    }
    titleLine.append(createElement('strong', 'popup-prompt-title', prompt.title), tags);
    main.append(titleLine, createElement('p', 'popup-prompt-preview', prompt.content));
    const copy = createElement('button', 'button button-restore', '复制');
    copy.type = 'button';
    copy.addEventListener('click', () => copyPrompt(prompt));
    row.append(main, copy);
    promptList.append(row);
  }
}

async function writePromptText(content, successMessage) {
  try {
    await navigator.clipboard.writeText(content);
    setStatus(successMessage);
    return true;
  } catch {
    setStatus('无法访问剪贴板，请检查浏览器权限。');
    return false;
  }
}

function closePromptFillPanel() {
  fillingPrompt = null;
  promptFillPanel.hidden = true;
  promptList.hidden = false;
}

function openPromptFillPanel(prompt, variables) {
  fillingPrompt = prompt;
  promptFillTitle.textContent = prompt.title;
  promptFillCount.textContent = `${variables.length} 个待填参数`;
  promptFillFields.replaceChildren();
  const inputs = variables.map(({ name, defaultValue }) => {
    const label = createElement('label', '', name);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = defaultValue;
    input.dataset.variableName = name;
    input.setAttribute('aria-label', name);
    label.append(input);
    promptFillFields.append(label);
    return input;
  });
  promptList.hidden = true;
  promptFillPanel.hidden = false;
  queueMicrotask(() => inputs[0]?.focus());
}

async function copyPrompt(prompt) {
  const variables = extractVariables(prompt.content);
  if (!variables.length) {
    await writePromptText(prompt.content, '已复制到剪贴板');
    return;
  }
  openPromptFillPanel(prompt, variables);
}

async function copyFilledPrompt() {
  if (!fillingPrompt) return;
  const values = Object.fromEntries([...promptFillFields.querySelectorAll('input')]
    .map((input) => [input.dataset.variableName, input.value]));
  const rendered = renderTemplate(fillingPrompt.content, values);
  if (await writePromptText(rendered, '已填入并复制')) closePromptFillPanel();
}

async function copyPromptOriginal() {
  if (!fillingPrompt) return;
  if (await writePromptText(fillingPrompt.content, '已复制到剪贴板')) closePromptFillPanel();
}

async function refreshPrompts() {
  const stored = await chrome.storage.local.get('prompts');
  prompts = Array.isArray(stored.prompts) ? stored.prompts : [];
  renderPrompts();
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
  const nextState = await sendMessage({ type: 'get-state' });
  state = {
    ...nextState,
    workspaces: (Array.isArray(nextState.workspaces) ? nextState.workspaces : []).map((workspace) => ({
      ...workspace,
      status: workspace.status === 'archived' ? 'archived' : 'active',
    })),
  };
  render();
}

saveCurrent.addEventListener('click', async () => {
  const button = saveCurrent;
  button.disabled = true;
  try {
    if (!activeContext) await refreshActiveContext();
    const result = await sendMessage({ type: 'save-current', windowId: activeContext?.windowId });
    setStatus(result.saved ? `已保存 ${result.workspace.tabCount} 个标签，已打开总览。` : saveFailureMessage(result.reason));
    await refresh();
  } catch {
    setStatus('保存失败，请再试一次。');
  } finally {
    button.disabled = false;
  }
});

saveCurrentGroup.addEventListener('click', async () => {
  saveCurrentGroup.disabled = true;
  try {
    if (!activeContext) await refreshActiveContext();
    const result = await sendMessage({
      type: 'save-current-group',
      windowId: activeContext?.windowId,
      groupId: activeContext?.groupId,
    });
    setStatus(result.saved ? `已压缩标签组中的 ${result.workspace.tabCount} 个网页。` : saveFailureMessage(result.reason));
    await refresh();
  } catch {
    setStatus('标签组保存失败，请再试一次。');
  } finally {
    await refreshActiveContext().catch(() => {});
  }
});

saveAllWindows.addEventListener('click', async () => {
  if (!globalThis.confirm('保存并关闭全部普通窗口中的网页？隐身窗口不会处理。')) return;
  saveAllWindows.disabled = true;
  try {
    const result = await sendMessage({ type: 'save-all-windows' });
    setStatus(result.saved
      ? `已保存 ${result.workspaceCount} 个窗口，共 ${result.tabCount} 个标签。`
      : saveFailureMessage(result.reason));
    await refresh();
  } catch {
    setStatus('全部窗口保存失败，原标签会尽量保持不变。');
  } finally {
    saveAllWindows.disabled = false;
  }
});

document.querySelector('#undo-save').addEventListener('click', async () => {
  const result = await sendMessage({ type: 'undo-save' });
  setStatus(result.undone ? restoreResultMessage({ restored: true, ...result }) : '撤销时间已过。');
  await refresh();
});

document.querySelector('#open-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

workspaceTab.addEventListener('click', () => setActiveView('workspaces'));
promptTab.addEventListener('click', () => setActiveView('prompts'));

promptSearch.addEventListener('input', () => {
  promptQuery = promptSearch.value;
  renderPrompts();
});

promptFillForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await copyFilledPrompt();
});

promptFillPanel.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  closePromptFillPanel();
  promptSearch.focus();
});

document.querySelector('#popup-prompt-copy-original').addEventListener('click', copyPromptOriginal);
document.querySelector('#popup-prompt-fill-cancel').addEventListener('click', () => {
  closePromptFillPanel();
  promptSearch.focus();
});

document.querySelector('#popup-open-prompt-manager').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#prompts') });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.undo) {
    state = { ...state, undo: changes.undo.newValue ?? null };
    renderUndo();
  }
  if (changes.prompts) {
    prompts = Array.isArray(changes.prompts.newValue) ? changes.prompts.newValue : [];
    renderPrompts();
  }
});

Promise.all([refresh(), refreshPrompts(), refreshActiveContext()]);
