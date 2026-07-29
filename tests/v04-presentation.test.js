import assert from 'node:assert/strict';
import test from 'node:test';

import { clipboardSuccessMessage, formatWorkspaceClipboard } from '../src/lib/v04-presentation.js';

const workspace = {
  title: '研究现场',
  tabs: [
    { title: 'OpenAI [Docs]', url: 'https://example.com/docs', restorable: true },
    { title: '内部页面', url: 'chrome://settings/', restorable: false },
    { title: '  GitHub\n Issue  ', url: 'https://github.com/example/repo/issues/1', restorable: true },
  ],
};

test('copies a readable workspace list by default', () => {
  assert.equal(formatWorkspaceClipboard(workspace), [
    '研究现场',
    '',
    '1. OpenAI [Docs]',
    '   https://example.com/docs',
    '',
    '2. GitHub Issue',
    '   https://github.com/example/repo/issues/1',
  ].join('\n'));
});

test('copies restorable workspace URLs for bulk import', () => {
  assert.equal(formatWorkspaceClipboard(workspace, 'urls'), [
    'https://example.com/docs',
    'https://github.com/example/repo/issues/1',
  ].join('\n'));
});

test('copies titles and URLs as safe Markdown list items', () => {
  assert.equal(formatWorkspaceClipboard(workspace, 'markdown'), [
    '- [OpenAI \\[Docs\\]](<https://example.com/docs>)',
    '- [GitHub Issue](<https://github.com/example/repo/issues/1>)',
  ].join('\n'));
});

test('returns an empty string when a workspace has no restorable links', () => {
  assert.equal(formatWorkspaceClipboard({ tabs: [] }), '');
});

test('describes where each copied format is useful', () => {
  assert.equal(clipboardSuccessMessage('list', 2), '已复制 2 个网页，适合直接粘贴到聊天或笔记。');
  assert.equal(clipboardSuccessMessage('urls', 2), '已复制 2 个 URL，适合批量导入其他工具。');
  assert.equal(clipboardSuccessMessage('markdown', 2), '已复制 2 个 Markdown 链接，适合粘贴到 Obsidian 或 GitHub。');
});
