import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { filterPrompts } from '../src/lib/prompt-core.js';

const prompts = [
  { id: 'pm_code', title: 'Review patch', category: '代码', content: 'Check the error path.', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z' },
  { id: 'pm_write', title: 'Story seed', category: '写作', content: 'Describe a quiet city.', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z' },
];

test('dashboard keeps archived workspaces out of the active timeline render path', async () => {
  const source = await readFile(new URL('../dashboard.js', import.meta.url), 'utf8');

  assert.match(source, /const activeWorkspaces = state\.workspaces\.filter\(\(workspace\) => workspace\.status === 'active'\)/);
  assert.match(source, /const archivedWorkspaces = state\.workspaces\.filter\(\(workspace\) => workspace\.status === 'archived'\)/);
  assert.match(source, /const visible = activeWorkspaces\.filter\(\(workspace\) => matchesWorkspaceQuery\(workspace, query\)\)/);
});

test('dashboard archive drawer is collapsed by default and restores through the archive core operation', async () => {
  const [html, source] = await Promise.all([
    readFile(new URL('../dashboard.html', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard.js', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /<details id="archive-drawer" class="archive-drawer">/);
  assert.match(html, /已归档工作区 <span id="archived-count">\(0\)<\/span>/);
  assert.match(source, /import \{ archiveWorkspace, unarchiveWorkspace \} from '\.\/src\/lib\/workspace-core\.js'/);
  assert.match(source, /chrome\.storage\.local\.set\(\{ workspaces: updated \}\)/);
  assert.match(source, /unarchiveWorkspaceById\(workspace\.id\)/);
});

test('prompt board passes category and text query through the shared prompt filtering data flow', async () => {
  const source = await readFile(new URL('../dashboard.js', import.meta.url), 'utf8');

  assert.deepEqual(filterPrompts(prompts, { category: '代码', query: 'ERROR' }).map((prompt) => prompt.id), ['pm_code']);
  assert.deepEqual(filterPrompts(prompts, { category: '写作', query: 'city' }).map((prompt) => prompt.id), ['pm_write']);
  assert.match(source, /filterPrompts\(prompts, \{ category: activePromptCategory, query: promptQuery \}\)/);
  assert.match(source, /promptSearch\.addEventListener\('input'/);
  assert.match(source, /promptCategories\.addEventListener\('click'/);
});

test('dashboard routes prompt links by hash and keeps header copy synchronized with the active view', async () => {
  const [html, source] = await Promise.all([
    readFile(new URL('../dashboard.html', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard.js', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /<h1 id="dashboard-title">工作区<\/h1>/);
  assert.match(html, /<p id="dashboard-subtitle" class="subtitle">这里放着你暂时离开的网页现场。<\/p>/);
  assert.match(source, /window\.location\.hash === '#prompts' \? 'prompts' : 'workspaces'/);
  assert.match(source, /window\.addEventListener\('hashchange', syncViewWithHash\)/);
  assert.match(source, /history\.replaceState\(null, '', view === 'prompts' \? '#prompts' : '#workspaces'\)/);
  assert.match(html, /id="workspace-tab"[^>]*>工作区<\/button>/);
  assert.match(html, /id="prompt-tab"[^>]*>提示词<\/button>/);
  assert.doesNotMatch(html, /📁|⚡/);
  assert.match(source, /showingPrompts \? '提示词' : '工作区'/);
});

test('workspace header panels return from prompts before opening backup or trash', async () => {
  const [html, source] = await Promise.all([
    readFile(new URL('../dashboard.html', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard.js', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /<\/header>\s*<form id="appearance-panel" class="appearance-panel" hidden>/);
  assert.match(source, /function openWorkspacePanel\(panel\) \{\s*if \(activeView === 'prompts'\) selectView\('workspaces'\);\s*setPanel\(panel, panel\.hidden\);\s*\}/s);
  assert.match(source, /backup-toggle'\)\.addEventListener\('click', \(\) => openWorkspacePanel\(backupPanel\)\)/);
  assert.match(source, /trash-toggle'\)\.addEventListener\('click', \(\) => openWorkspacePanel\(trashPanel\)\)/);
});
