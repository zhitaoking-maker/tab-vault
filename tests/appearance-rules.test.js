import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ACCENT_COLOR,
  MAX_BACKGROUND_BYTES,
  accentInkColor,
  normalizeAccentColor,
  validateBackgroundFile,
} from '../src/lib/appearance-rules.js';

test('accepts PNG, JPEG, and WebP backgrounds up to five megabytes', () => {
  assert.equal(validateBackgroundFile({ type: 'image/png', size: MAX_BACKGROUND_BYTES }), null);
  assert.equal(validateBackgroundFile({ type: 'image/jpeg', size: 1024 }), null);
  assert.equal(validateBackgroundFile({ type: 'image/webp', size: 1024 }), null);
});

test('rejects missing, unsupported, and oversized backgrounds', () => {
  assert.match(validateBackgroundFile(), /请选择/);
  assert.match(validateBackgroundFile({ type: 'image/gif', size: 1024 }), /仅支持/);
  assert.match(validateBackgroundFile({ type: 'image/png', size: MAX_BACKGROUND_BYTES + 1 }), /5 MB/);
});

test('normalizes only six-digit hexadecimal accent colors', () => {
  assert.equal(normalizeAccentColor('#3e7bfa'), '#3e7bfa');
  assert.equal(normalizeAccentColor('#C5E36B'), '#c5e36b');
  assert.equal(normalizeAccentColor('#fff'), DEFAULT_ACCENT_COLOR);
  assert.equal(normalizeAccentColor('green'), DEFAULT_ACCENT_COLOR);
});

test('chooses readable ink for bright and dark accent colors', () => {
  assert.equal(accentInkColor('#c5e36b'), '#19200e');
  assert.equal(accentInkColor('#173b35'), '#f5f4ee');
});
