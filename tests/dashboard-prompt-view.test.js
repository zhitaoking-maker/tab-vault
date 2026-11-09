import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  extractVariables,
  filterPrompts,
  getAllTags,
  renderTemplate,
} from '../src/lib/prompt-core.js';

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

test('dashboard prompt board filters by tag and query through the shared core flow', async () => {
  const source = await readFile(new URL('../dashboard.js', import.meta.url), 'utf8');
  const taggedPrompts = [
    { ...prompts[0], tags: ['代码', '审查'] },
    { ...prompts[1], tags: ['写作', '审查'] },
  ];

  assert.deepEqual(filterPrompts(taggedPrompts, { tag: '审查', query: 'ERROR' }).map((prompt) => prompt.id), ['pm_code']);
  assert.deepEqual(filterPrompts(taggedPrompts, { tag: '审查', query: 'city' }).map((prompt) => prompt.id), ['pm_write']);
  assert.match(source, /filterPrompts\(prompts, \{ tag: activePromptTag, query: promptQuery \}\)/);
  assert.match(source, /getAllTags\(prompts\)/);
  assert.match(source, /promptSearch\.addEventListener\('input'/);
});

test('dashboard keeps eight ranked tags visible and moves lower-frequency tags into details', async () => {
  const source = await readFile(new URL('../dashboard.js', import.meta.url), 'utf8');
  const tagPrompts = Array.from({ length: 9 }, (_, index) => ({
    ...prompts[0], id: `pm_${index}`, tags: [`标签${index}`],
  }));
  const rankedTags = getAllTags(tagPrompts);

  assert.equal(rankedTags.slice(0, 8).length, 8);
  assert.equal(rankedTags.slice(8).length, 1);
  assert.match(source, /const TOP_TAG_LIMIT = 8/);
  assert.match(source, /rankedTags\.slice\(0, TOP_TAG_LIMIT\)/);
  assert.match(source, /createElement\('details', 'more-tags-dropdown'\)/);
});

test('dashboard editor accepts comma or space separated tags and exposes ten history suggestions', async () => {
  const [html, source] = await Promise.all([
    readFile(new URL('../dashboard.html', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard.js', import.meta.url), 'utf8'),
  ]);
  const parsedTags = '代码, 审查  JavaScript'.split(/[\s,]+/).filter(Boolean);

  assert.deepEqual(parsedTags, ['代码', '审查', 'JavaScript']);
  assert.match(html, /id="prompt-tag-input"/);
  assert.match(html, /id="prompt-tag-suggestions"/);
  assert.match(source, /getAllTags\(prompts\)\.slice\(0, 10\)/);
  assert.match(source, /promptTagInput\.value\.split\(\/\[\\s,\]\+\//);
});

test('dashboard opens a parameter fill path and renders template values through the shared core', async () => {
  const [html, source] = await Promise.all([
    readFile(new URL('../dashboard.html', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard.js', import.meta.url), 'utf8'),
  ]);
  const variables = extractVariables('Write {{topic}} in {{lang:Python}}.');

  assert.deepEqual(variables, [
    { name: 'topic', defaultValue: '' },
    { name: 'lang', defaultValue: 'Python' },
  ]);
  assert.equal(renderTemplate('Write {{topic}} in {{lang:Python}}.', { topic: 'tests', lang: 'JavaScript' }), 'Write tests in JavaScript.');
  assert.match(source, /const variables = extractVariables\(prompt\.content\)/);
  assert.match(source, /const rendered = renderTemplate\(fillingPrompt\.content, values\)/);
  assert.match(source, /promptFillForm\.addEventListener\('submit'/);
  assert.match(html, /<dialog id="prompt-fill-modal"/);
  assert.match(html, /id="prompt-copy-original"/);
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
