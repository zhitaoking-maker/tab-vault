import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('v0.3 manifest requests native tab group access', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.3.0');
  assert.ok(manifest.permissions.includes('tabGroups'));
});
