import assert from 'node:assert/strict';
import test from 'node:test';

import { formatWorkspaceClipboard } from '../src/lib/v04-presentation.js';

const workspace = {
  title: '研究现场',
  tabs: [
    { title: 'OpenAI [Docs]', url: 'https://example.com/docs', restorable: true },
    { title: '内部页面', url: 'chrome://settings/', restorable: false },
    { title: 'Issue', url: 'https://github.com/example/repo/issues/1', restorable: true },
  ],
};

test('copies restorable workspace URLs as plain links', () => {
  assert.equal(formatWorkspaceClipboard(workspace, 'plain'), [
    'https://example.com/docs',
    'https://github.com/example/repo/issues/1',
  ].join('\n'));
});

test('copies titles and URLs as safe Markdown list items', () => {
  assert.equal(formatWorkspaceClipboard(workspace, 'markdown'), [
    '- [OpenAI \\[Docs\\]](<https://example.com/docs>)',
    '- [Issue](<https://github.com/example/repo/issues/1>)',
  ].join('\n'));
});

test('returns an empty string when a workspace has no restorable links', () => {
  assert.equal(formatWorkspaceClipboard({ tabs: [] }, 'plain'), '');
});
