import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPrompt,
  deletePrompt,
  extractVariables,
  exportPromptsPayload,
  filterPrompts,
  getAllTags,
  importPromptsPayload,
  renderTemplate,
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

test('creates a front-inserted tagged prompt and rejects empty prompt fields', () => {
  const created = createPrompt(prompts, {
    title: '  Plan  ',
    tags: [' code ', 'work', 'code', ''],
    content: ' Draft milestones. ',
  });
  assert.equal(created.length, 3);
  assert.match(created[0].id, /^pm_\d+_[a-z0-9]+$/);
  assert.deepEqual(created[0], {
    id: created[0].id,
    title: 'Plan',
    tags: ['code', 'work'],
    category: 'code',
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

test('imports legacy category-only prompts as tagged prompts without dropping fields', () => {
  const legacyPrompt = { ...prompts[0], id: 'pm_legacy', note: 'retain me' };
  const result = importPromptsPayload([], JSON.stringify({ version: 1, prompts: [legacyPrompt] }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.prompts, [{ ...legacyPrompt, tags: ['work'], category: 'work' }]);
});

test('ranks all tags by descending occurrence frequency', () => {
  const ranked = getAllTags([
    { ...prompts[0], tags: ['work', 'code'] },
    { ...prompts[1], tags: ['writing', 'code'] },
    { ...prompts[1], id: 'pm_other', tags: ['work'] },
  ]);
  assert.deepEqual(ranked, [
    { name: 'work', count: 2 },
    { name: 'code', count: 2 },
    { name: 'writing', count: 1 },
  ]);
});

test('filters prompts by any matching tag while preserving category filtering', () => {
  const taggedPrompts = [
    { ...prompts[0], tags: ['work', 'code'] },
    { ...prompts[1], tags: ['writing', 'code'] },
  ];
  assert.deepEqual(filterPrompts(taggedPrompts, { tag: 'code' }).map((prompt) => prompt.id), ['pm_product', 'pm_ideas']);
  assert.deepEqual(filterPrompts(taggedPrompts, { tag: 'code', category: 'work' }).map((prompt) => prompt.id), ['pm_product']);
});

test('extracts unique variables with trimmed names and default values', () => {
  assert.deepEqual(extractVariables('Write {{ topic }} in {{lang: Python }}. Repeat {{topic:ignored}}.'), [
    { name: 'topic', defaultValue: '' },
    { name: 'lang', defaultValue: 'Python' },
  ]);
});

test('extractVariables returns an empty array when content has no variables', () => {
  assert.deepEqual(extractVariables('No template fields here.'), []);
});

test('renderTemplate uses supplied values and declared defaults', () => {
  assert.equal(renderTemplate('{{topic}} in {{lang:Python}}', { topic: 'Testing' }), 'Testing in Python');
});

test('renderTemplate falls back to empty strings and safely preserves replacement characters', () => {
  assert.equal(renderTemplate('{{missing}}'), '');
  assert.equal(renderTemplate('{{value:default}}', { value: '$& $1' }), '$& $1');
});

test('exports a versioned payload and imports deduplicated merge data', () => {
  const payload = exportPromptsPayload([prompts[1]]);
  assert.deepEqual(JSON.parse(payload), {
    version: 1,
    prompts: [{ ...prompts[1], tags: ['writing'] }],
  });

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
