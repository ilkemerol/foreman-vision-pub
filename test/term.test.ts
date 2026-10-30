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
    assistant({ type: 'tool_use', id: 't4', name: 'AskUserQuestion', input: { questions: [{ question: 'Which color?', options: [] }] } }),
  ]), [
    { kind: 'text', text: 'Running the tests.' },
    { kind: 'tool', name: 'Bash', id: 't1', text: 'npm test && echo ok' },
    { kind: 'tool', name: 'Read', id: 't2', text: '/w/a.ts' },
    { kind: 'tool', name: 'TodoWrite', id: 't3', text: '' },
    { kind: 'tool', name: 'AskUserQuestion', id: 't4', text: 'Which color?', questions: [{ question: 'Which color?', options: [], multiSelect: false }] },
  ]);
});

test('termLines: AskUserQuestion carries every question with its options for the terminal\'s list; long texts cut, malformed parts left out', () => {
  const long = 'd'.repeat(300);
  const [l, none] = termLines([
    assistant({ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [
      { question: 'Which color?', header: 'Color', options: [{ label: 'Blue (Recommended)', description: 'Calm' }, { label: 'Red', description: long }, { description: 'no label' }], multiSelect: false },
      { question: 'Which ones?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true },
      { header: 'no question' }, 'x',
    ] } }),
    assistant({ type: 'tool_use', id: 'q2', name: 'AskUserQuestion', input: { questions: 'x' } }),
  ]);
  assert.deepEqual(l.questions, [
    { question: 'Which color?', header: 'Color', options: [{ label: 'Blue (Recommended)', description: 'Calm' }, { label: 'Red', description: 'd'.repeat(200) + '…' }], multiSelect: false },
    { question: 'Which ones?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true },
  ]);
  assert.equal(none.questions, undefined);
});

test('termLines: a tool result, string or blocks, shows its first 400 lines and the last line, images counted, an error marked', () => {
  const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n') + '\n';
  const [cut, blocks, err, image] = termLines([
    user([{ type: 'tool_result', tool_use_id: 't1', content: long }]),
    user([{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'a' }, { type: 'image', source: {} }, { type: 'text', text: 'b' }] }]),
    user([{ type: 'tool_result', tool_use_id: 't3', content: 'Exit code 1', is_error: true }]),
    user([{ type: 'tool_result', tool_use_id: 't4', content: [{ type: 'image', source: {} }] }]),
  ]);
  assert.equal(cut.kind, 'out');
  assert.equal(cut.text.split('\n').length, 400);
  assert.equal(cut.text.split('\n')[399], 'line 399');
  assert.deepEqual([cut.id, cut.more, cut.last], ['t1', 100, 'line 499']);
  assert.deepEqual(blocks, { kind: 'out', id: 't2', text: 'a\nb', images: 1 });
  assert.deepEqual(err, { kind: 'err', id: 't3', text: 'Exit code 1' });
  assert.deepEqual(image, { kind: 'out', id: 't4', text: '', images: 1 });
});

test('termLines: a very long text is cut', () => {
  const [line] = termLines([assistant({ type: 'text', text: 'x'.repeat(30_000) })]);
  assert.equal(line.text.length, 20_001);
  assert.ok(line.text.endsWith('…'));
});

test('termLines: a result cut by the character cap, not the line count, still carries its last line', () => {
  const [line] = termLines([user([{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(30_000) + '\nlast line\n' }])]);
  assert.equal(line.text.length, 20_001);
  assert.deepEqual([line.more, line.last], [undefined, 'last line']);
});

test('termLines: Edit, MultiEdit and Write carry their input for the pop-up\'s diff; Write keeps its first 400 lines', () => {
  const [e, m, w, r] = termLines([
    assistant({ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: '/w/a.ts', old_string: 'a\nb', new_string: 'a\nc' } }),
    assistant({ type: 'tool_use', id: 'm1', name: 'MultiEdit', input: { file_path: '/w/a.ts', edits: [{ old_string: 'x', new_string: 'y' }, { old_string: 'p', new_string: 'q', replace_all: true }] } }),
    assistant({ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: '/w/b.md', content: Array.from({ length: 450 }, (_, i) => `l${i}`).join('\n') } }),
    user([{ type: 'tool_result', tool_use_id: 'e1', content: 'The file /w/a.ts has been updated successfully.' }]),
  ]);
  assert.deepEqual(e, { kind: 'tool', name: 'Edit', id: 'e1', text: '/w/a.ts', edits: [{ old: 'a\nb', new: 'a\nc' }] });
  assert.deepEqual(m.edits, [{ old: 'x', new: 'y' }, { old: 'p', new: 'q' }]);
  assert.deepEqual([w.edits![0].old, w.edits![0].new.split('\n').length, w.edits![0].new.split('\n')[399], w.more], ['', 400, 'l399', 50]);
  assert.deepEqual(r, { kind: 'out', id: 'e1', text: 'The file /w/a.ts has been updated successfully.' });
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

test('termLines: the last line a cut result carries is capped like a tool input', () => {
  const [line] = termLines([user([{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(24_000) }])]);
  assert.equal(line.text.length, 20_001);
  assert.equal(line.last!.length, 201);
});
