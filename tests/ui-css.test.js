import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the undo bar cannot override its hidden state with flex layout', async () => {
  const css = await readFile(new URL('../ui.css', import.meta.url), 'utf8');

  assert.match(css, /\.undo-bar\[hidden\]\s*\{[^}]*display:\s*none;?[^}]*\}/s);
});

test('v0.2 tool panels and restore reports honor their hidden state', async () => {
  const css = await readFile(new URL('../ui.css', import.meta.url), 'utf8');

  assert.match(css, /\.tool-panel\[hidden\]\s*\{[^}]*display:\s*none;?[^}]*\}/s);
  assert.match(css, /\.restore-report\[hidden\]\s*\{[^}]*display:\s*none;?[^}]*\}/s);
});
