import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('popup exposes group, all-window, and shortcut controls without replacing the primary action', async () => {
  const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');

  assert.match(html, /id="save-current"[^>]*>压缩当前窗口/);
  assert.match(html, /id="save-current-group"[^>]*>压缩当前标签组/);
  assert.match(html, /id="save-all-windows"[^>]*>保存全部窗口/);
  assert.match(html, /Alt \+ Shift \+ V/);
});
