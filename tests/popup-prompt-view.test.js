import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('popup exposes compact workspace and prompt tabs with a prompt search panel', async () => {
  const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');

  assert.match(html, /id="tab-workspaces" class="popup-tab is-active"/);
  assert.match(html, /id="tab-prompts" class="popup-tab"/);
  assert.match(html, /id="popup-prompt-search" type="search" placeholder="搜索提示词\.\.\."/);
  assert.match(html, /id="popup-open-prompt-manager"/);
});

test('popup filters archived workspaces and routes prompt search through the shared core', async () => {
  const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ filterPrompts \} from '\.\/src\/lib\/prompt-core\.js'/);
  assert.match(source, /const activeWorkspaces = state\.workspaces\.filter\(\(workspace\) => workspace\.status === 'active'\)/);
  assert.match(source, /filterPrompts\(prompts, \{ category: 'all', query: promptQuery \}\)/);
  assert.match(source, /navigator\.clipboard\.writeText\(prompt\.content\)/);
  assert.match(source, /dashboard\.html#prompts/);
});
