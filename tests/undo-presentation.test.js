import assert from 'node:assert/strict';
import test from 'node:test';

import { getUndoPresentation } from '../src/lib/undo-presentation.js';

test('hides the undo action when there is no record or it has expired', () => {
  assert.deepEqual(getUndoPresentation(null, 1_000), { active: false, remainingMs: 0, remainingSeconds: 0 });
  assert.deepEqual(getUndoPresentation({ expiresAt: 1_000 }, 1_000), { active: false, remainingMs: 0, remainingSeconds: 0 });
});

test('keeps the undo action visible only while exact time remains', () => {
  assert.deepEqual(getUndoPresentation({ expiresAt: 1_001 }, 1_000), {
    active: true,
    remainingMs: 1,
    remainingSeconds: 1,
  });
  assert.deepEqual(getUndoPresentation({ expiresAt: 2_000 }, 1_000), {
    active: true,
    remainingMs: 1_000,
    remainingSeconds: 1,
  });
});
