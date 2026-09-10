import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPrompt,
  deletePrompt,
  exportPromptsPayload,
  filterPrompts,
  importPromptsPayload,
  updatePrompt,
} from '../src/lib/prompt-core.js';

const prompts = [
  {
    id: 'pm_product',
    title: 'Release note',
    category: 'work',
    content: 'Summarize the product release.',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'pm_ideas',
    title: 'Story seed',
    category: 'writing',
    content: 'Develop a distant city setting.',
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  },
];

test('creates a front-inserted prompt and rejects empty prompt fields', () => {
  const created = createPrompt(prompts, { title: '  Plan  ', category: ' work ', content: ' Draft milestones. ' });
  assert.equal(created.length, 3);
  assert.match(created[0].id, /^pm_\d+_[a-z0-9]+$/);
  assert.deepEqual(created[0], {
    id: created[0].id,
    title: 'Plan',
    category: 'work',
    content: 'Draft milestones.',
    createdAt: created[0].createdAt,
    updatedAt: created[0].updatedAt,
  });
  assert.equal(created[0].createdAt, created[0].updatedAt);
  assert.equal(createPrompt(prompts, { title: '', category: 'work', content: 'x' }), prompts);
});

test('updates and deletes prompts immutably', () => {
  const updated = updatePrompt(prompts, 'pm_product', { content: 'Summarize risks too.' });
  assert.notEqual(updated, prompts);
  assert.equal(updated[0].content, 'Summarize risks too.');
  assert.notEqual(updated[0].updatedAt, undefined);
  assert.equal(updated[0].createdAt, prompts[0].createdAt);
  assert.equal(updated[1], prompts[1]);
  assert.equal(updatePrompt(prompts, 'missing', { title: 'Nope' }), prompts);
  assert.equal(updatePrompt(prompts, 'pm_product', { title: '   ' }), prompts);

  const deleted = deletePrompt(updated, 'pm_product');
  assert.deepEqual(deleted.map((prompt) => prompt.id), ['pm_ideas']);
  assert.notEqual(deleted, updated);
});

test('filters prompts by category and case-insensitive text across title and content', () => {
  assert.deepEqual(filterPrompts(prompts, { category: 'all', query: 'CITY' }).map((prompt) => prompt.id), ['pm_ideas']);
  assert.deepEqual(filterPrompts(prompts, { category: 'work', query: 'release' }).map((prompt) => prompt.id), ['pm_product']);
  assert.deepEqual(filterPrompts(prompts, { category: 'writing', query: 'release' }), []);
  assert.deepEqual(filterPrompts(prompts, {}).map((prompt) => prompt.id), ['pm_product', 'pm_ideas']);
});

test('exports a versioned payload and imports deduplicated merge data', () => {
  const payload = exportPromptsPayload([prompts[1]]);
  assert.deepEqual(JSON.parse(payload), { version: 1, prompts: [prompts[1]] });

  const defaultMerged = importPromptsPayload(prompts, payload);
  assert.deepEqual(defaultMerged.prompts.map((prompt) => prompt.id), ['pm_product', 'pm_ideas']);

  const merged = importPromptsPayload(prompts, exportPromptsPayload([
    prompts[0],
    { ...prompts[1], id: 'pm_imported' },
  ]), { mode: 'merge' });
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.prompts.map((prompt) => prompt.id), ['pm_product', 'pm_ideas', 'pm_imported']);
});

test('returns failure objects for malformed prompt imports without changing current data', () => {
  assert.deepEqual(importPromptsPayload(prompts, '{'), {
    ok: false,
    reason: 'invalid-json',
    prompts,
  });
  assert.deepEqual(importPromptsPayload(prompts, JSON.stringify({ version: 99, prompts: [] })), {
    ok: false,
    reason: 'invalid-payload',
    prompts,
  });
  assert.deepEqual(importPromptsPayload(prompts, JSON.stringify({ version: 1, prompts: [{ id: 'bad' }] })), {
    ok: false,
    reason: 'invalid-prompt',
    prompts,
  });
  assert.deepEqual(importPromptsPayload(prompts, exportPromptsPayload([]), { mode: 'replace' }), {
    ok: false,
    reason: 'invalid-mode',
    prompts,
  });
});
