import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TermLine } from '../../shared/types.ts';
import { brief, outcome, shortPath, termItems } from '../../web/src/logic/blocks.ts';
import { inLang } from './fake.ts';

const tool = (name: string, text: string, id: string, o: Partial<TermLine> = {}): TermLine => ({ kind: 'tool', name, text, id, ...o });
const out = (text: string, id: string, o: Partial<TermLine> = {}): TermLine => ({ kind: 'out', text, id, ...o });
const edit = tool('Edit', 'a.ts', 'e', { edits: [{ old: 'a\nb\nc', new: 'a\nB\nc\nd' }] });

test('termItems: a call and its result are one block by id, parallel calls each get theirs; a result with no call stands alone; keys stay as lines are added', () => {
  const l: TermLine[] = [{ kind: 'user', from: 'prompt', text: 'run' }, tool('Bash', 'npm test', 't1'), tool('Read', 'a.ts', 't2'),
    out('ok', 't2'), out('ℹ pass 3', 't1'), out('orphan', 'gone'), { kind: 'text', text: 'done' }, { kind: 'out', text: 'no id' }];
  assert.deepEqual(termItems(l), [{ line: l[0] }, { key: 't1', tool: l[1], out: l[4] }, { key: 't2', tool: l[2], out: l[3] },
    { key: 'gone', tool: null, out: l[5] }, { line: l[6] }, { key: '#7', tool: null, out: l[7] }]);
  const grown = termItems([...l.slice(0, 3), out('ok', 't2'), tool('Grep', 'x', 't3')]);
  assert.deepEqual(grown.map(i => ('key' in i ? i.key : '-')), ['-', 't1', 't2', 't3']);   // t1 still running
});
test('brief: Bash and others show their first 3 lines and +N for the rest (the server\'s cut too); an error the same; CRLF, images and no output', () => {
  const t = tool('Bash', 'npm test', 't1');
  assert.deepEqual(brief(t, out('a\nb\nc\nd\ne', 't1', { more: 10 })), { text: 'a\nb\nc', more: 12, open: true });
  assert.deepEqual(brief(t, out('a\r\nb\r\nc\r\nd', 't1')), { text: 'a\nb\nc', more: 1, open: true });
  assert.deepEqual(brief(t, out('a\nb', 't1')), { text: 'a\nb', more: 0, open: false });
  assert.deepEqual(brief(t, { kind: 'err', id: 't1', text: 'Exit code 1\nx\ny\nz' }), { text: 'Exit code 1\nx\ny', more: 1, open: true });
  assert.deepEqual(brief(t, out('', 't1')), { text: '(no output)', more: 0, open: false });
  assert.deepEqual(brief(tool('Read', 'p.png', 'i'), out('', 'i', { images: 1 })), { text: '[image]', more: 0, open: false });
  assert.equal(brief(t, null), null);
});
test('brief: Read N lines read, Edit/MultiEdit +a −d from the input, Write N lines written with the cut ones, Grep/Glob N results', () => {
  const read = Array.from({ length: 140 }, (_, i) => `${i + 1}\tx`).join('\n') + '\n<system-reminder>\nnot code\n</system-reminder>';
  assert.deepEqual(brief(tool('Read', 'a.ts', 'r'), out(read, 'r')), { text: '140 lines read', more: 0, open: true });
  assert.equal(inLang('tr', () => brief(tool('Read', 'a.ts', 'r'), out(read, 'r'))!.text), '140 satır okundu');
  assert.deepEqual(brief(edit, out('The file a.ts has been updated successfully.', 'e')), { text: '+2 −1', more: 0, open: true });
  assert.equal(brief(tool('MultiEdit', 'a.ts', 'm', { edits: [{ old: 'x', new: 'y' }, { old: '', new: 'z' }] }), out('ok', 'm'))!.text, '+2 −1');
  assert.equal(brief(tool('Write', 'w.md', 'w', { edits: [{ old: '', new: 'a\nb\nc' }], more: 7 }), out('File created successfully at: w.md', 'w'))!.text, '10 lines written');
  assert.equal(brief(tool('Grep', 'x', 'g'), out('Found 3 files\na\nb\nc', 'g'))!.text, '3 results');
  assert.equal(brief(tool('Glob', '*.ts', 'G'), out('a.ts\nb.ts', 'G'))!.text, '2 results');
  assert.deepEqual(brief(tool('Glob', '*.ts', 'G'), out('No files found', 'G')), { text: '0 results', more: 0, open: false });
  assert.deepEqual(brief(edit, { kind: 'err', id: 'e', text: 'String to replace not found' }), { text: 'String to replace not found', more: 0, open: false });
});
test('outcome: Bash its last line (the server\'s when cut), an error its first line, Read/Edit/Write/Grep/Glob as brief, others their first line; none while running', () => {
  assert.equal(outcome(tool('Bash', 'npm test', 'b'), out('ℹ tests 551\nℹ pass 551\n', 'b')), 'ℹ pass 551');
  assert.equal(outcome(tool('Bash', 'npm test', 'b'), out('a\nb', 'b', { more: 600, last: 'ℹ fail 0' })), 'ℹ fail 0');
  assert.equal(outcome(tool('Bash', 'git push', 'b'), { kind: 'err', id: 'b', text: 'Exit code 1\nrejected' }), 'Exit code 1');
  assert.equal(outcome(edit, out('ok', 'e')), '+2 −1');
  assert.equal(outcome(tool('Skill', 'x', 's'), out('Launching skill: x\nmore', 's')), 'Launching skill: x');
  assert.equal(outcome(tool('Bash', 'npm test', 'b'), null), null);
});
test('shortPath: the session folder dropped, either slash, any case; anything else as it is', () => {
  assert.equal(shortPath('C:\\W\\fv\\web\\a.ts', 'c:\\w\\fv'), 'web/a.ts');
  assert.equal(shortPath('/w/fv/src/x.ts', '/w/fv/'), 'src/x.ts');
  assert.equal(shortPath('npm test', '/w/fv'), 'npm test');
  assert.equal(shortPath('/w/fvx/a.ts', '/w/fv'), '/w/fvx/a.ts');
  assert.equal(shortPath('/w/fv/a.ts', null), '/w/fv/a.ts');
  assert.equal(shortPath('grep "a\\|b"', '/w'), 'grep "a\\|b"');   // a Bash command keeps its backslashes
});

test('brief: a long one-line result shows 300 chars and opens; fewer than 3 lines with the server\'s cut count only that cut', () => {
  const t = tool('Bash', 'cat big.json', 'b');
  const b = brief(t, out('x'.repeat(20_001), 'b'))!;
  assert.deepEqual([b.text.length, b.text.endsWith('…'), b.more, b.open], [301, true, 0, true]);
  assert.deepEqual(brief(t, out('a', 'b', { more: 5 })), { text: 'a', more: 5, open: true });
});

test('outcome: one line of at most 200 chars plus the ellipsis', () => {
  const o = outcome(tool('Bash', 'cat big.json', 'b'), out('x'.repeat(20_001), 'b', { last: 'y'.repeat(201) }))!;
  assert.deepEqual([o.length, o.endsWith('…')], [201, true]);
  assert.equal(outcome(tool('Skill', 'x', 's'), out('z'.repeat(5000), 's'))!.length, 201);
});
