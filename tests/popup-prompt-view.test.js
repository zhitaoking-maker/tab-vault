import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { extractVariables, renderTemplate } from '../src/lib/prompt-core.js';

test('popup exposes compact workspace and prompt tabs with a prompt search panel', async () => {
  const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');

  assert.match(html, /id="tab-workspaces" class="popup-tab is-active"/);
  assert.match(html, /id="tab-prompts" class="popup-tab"/);
  assert.match(html, /id="popup-prompt-search" type="search" placeholder="搜索提示词\.\.\."/);
  assert.match(html, /id="popup-open-prompt-manager"/);
});

test('popup filters archived workspaces and routes prompt search through the shared core', async () => {
  const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ extractVariables, filterPrompts, renderTemplate \} from '\.\/src\/lib\/prompt-core\.js'/);
  assert.match(source, /const activeWorkspaces = state\.workspaces\.filter\(\(workspace\) => workspace\.status === 'active'\)/);
  assert.match(source, /filterPrompts\(prompts, \{ category: 'all', query: promptQuery \}\)/);
  assert.match(source, /prompt\.tags \|\| \[prompt\.category\]\)\.some\(\(tag\) => tag\.toLocaleLowerCase\(\)\.includes\(normalizedQuery\)\)/);
  assert.match(source, /dashboard\.html#prompts/);
});

test('popup renders every prompt tag as compact badges with a legacy category fallback', async () => {
  const [html, source] = await Promise.all([
    readFile(new URL('../popup.html', import.meta.url), 'utf8'),
    readFile(new URL('../popup.js', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /for \(const tag of prompt\.tags \|\| \[prompt\.category\]\)/);
  assert.match(source, /createElement\('span', 'popup-prompt-tag', tag\)/);
  assert.match(html, /id="popup-prompt-list" class="popup-prompt-list"/);
  assert.match(html, /id="popup-prompt-fill-panel"/);
});

test('popup renders template values in its inline fill flow and retains original-copy fallback', async () => {
  const [html, source] = await Promise.all([
    readFile(new URL('../popup.html', import.meta.url), 'utf8'),
    readFile(new URL('../popup.js', import.meta.url), 'utf8'),
  ]);
  const variables = extractVariables('Create {{topic}} with {{language:JavaScript}}.');

  assert.deepEqual(variables, [
    { name: 'topic', defaultValue: '' },
    { name: 'language', defaultValue: 'JavaScript' },
  ]);
  assert.equal(renderTemplate('Create {{topic}} with {{language:JavaScript}}.', { topic: 'tests' }), 'Create tests with JavaScript.');
  assert.match(source, /const variables = extractVariables\(prompt\.content\)/);
  assert.match(source, /const rendered = renderTemplate\(fillingPrompt\.content, values\)/);
  assert.match(source, /promptFillPanel\.addEventListener\('keydown'/);
  assert.match(html, /id="popup-prompt-copy-original"/);
  assert.match(html, /id="popup-prompt-fill-cancel"/);
});
