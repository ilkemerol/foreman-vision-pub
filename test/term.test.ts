import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './helpers.ts';
import { termLines, termPage } from '../src/term.ts';

const j = (o: object) => JSON.stringify(o);
const assistant = (...content: object[]) => j({ type: 'assistant', message: { id: 'm1', content } });
const user = (content: unknown, extra: object = {}) => j({ type: 'user', message: { role: 'user', content }, ...extra });

test('termLines: assistant text and tool calls, the input in short; thinking is left out', () => {
  assert.deepEqual(termLines([
    assistant({ type: 'thinking', thinking: '', signature: 'x' }),
    assistant({ type: 'text', text: '  Running the tests.\n' }),
    assistant({ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm   test\n  && echo ok', description: 'run tests' } }),
    assistant({ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/w/a.ts' } }),
    assistant({ type: 'tool_use', id: 't3', name: 'TodoWrite', input: { todos: [] } }),
  ]), [
    { kind: 'text', text: 'Running the tests.' },
    { kind: 'tool', name: 'Bash', text: 'npm test && echo ok' },
    { kind: 'tool', name: 'Read', text: '/w/a.ts' },
    { kind: 'tool', name: 'TodoWrite', text: '' },
  ]);
});

test('termLines: a tool result, string or blocks, shows its first 15 lines, images counted, an error marked', () => {
  const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n';
  const [cut, blocks, err, image] = termLines([
    user([{ type: 'tool_result', tool_use_id: 't1', content: long }]),
    user([{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'a' }, { type: 'image', source: {} }, { type: 'text', text: 'b' }] }]),
    user([{ type: 'tool_result', tool_use_id: 't3', content: 'Exit code 1', is_error: true }]),
    user([{ type: 'tool_result', tool_use_id: 't4', content: [{ type: 'image', source: {} }] }]),
  ]);
  assert.equal(cut.kind, 'out');
  assert.equal(cut.text.split('\n').length, 15);
  assert.equal(cut.text.split('\n')[14], 'line 14');
  assert.equal(cut.more, 25);
  assert.deepEqual(blocks, { kind: 'out', text: 'a\nb', images: 1 });
  assert.deepEqual(err, { kind: 'err', text: 'Exit code 1' });
  assert.deepEqual(image, { kind: 'out', text: '', images: 1 });
});

test('termLines: a very long text is cut', () => {
  const [line] = termLines([assistant({ type: 'text', text: 'x'.repeat(10_000) })]);
  assert.equal(line.text.length, 4001);
  assert.ok(line.text.endsWith('…'));
});

test('termLines: the prompt and queued messages with their origin; meta, other attachments, api-request* and bad lines are skipped', () => {
  assert.deepEqual(termLines([
    user('Do this job'),
    user('<system-reminder>classified</system-reminder>', { isMeta: true }),
    user([{ type: 'text', text: 'prompt with image' }, { type: 'image', source: {} }]),
    j({ type: 'attachment', attachment: { type: 'queued_command', prompt: 'the master says', origin: { kind: 'coordinator' } } }),
    j({ type: 'attachment', attachment: { type: 'queued_command', prompt: [{ type: 'text', text: 'blocks' }] } }),
    j({ type: 'attachment', attachment: { type: 'hook_additional_context', content: ['contract'] } }),
    j({ type: 'api-request', body: { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'copy' }] }] } }),
    '{"type":"api-request-blob","data":"' + 'A'.repeat(100),
    'not json at all',
    '"text":"x"}]}}',
  ]), [
    { kind: 'user', from: 'prompt', text: 'Do this job' },
    { kind: 'user', from: 'prompt', text: 'prompt with image' },
    { kind: 'user', from: 'coordinator', text: 'the master says' },
    { kind: 'user', from: 'queued', text: 'blocks' },
  ]);
});

test('termPage: a chunk with no newline (one huge line) is a "big" marker, not lost silently; a missing file is empty', () => {
  const dir = tempDir('fv-term-');
  const path = join(dir, 'agent-a.jsonl');
  writeFileSync(path, '{"type":"user","message":{"content":"' + 'x'.repeat(500) + '"}}\n');
  assert.deepEqual(termPage(path, 0, 100), { lines: [{ kind: 'big', text: '' }], cursor: 100 });
  assert.deepEqual(termPage(join(dir, 'missing.jsonl'), null), { lines: [], cursor: 0 });
});
