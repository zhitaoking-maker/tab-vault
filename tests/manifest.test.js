import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('v0.4 manifest keeps tab group access and registers the save shortcut', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.4.0');
  assert.ok(manifest.permissions.includes('tabGroups'));
  assert.equal(manifest.commands['save-current-window'].suggested_key.default, 'Alt+Shift+V');
});
