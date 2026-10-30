import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffCount, lineDiff } from '../../web/src/logic/diff.ts';

const ops = (a: string, b: string) => lineDiff(a, b).map(d => d.op + d.text);
test('lineDiff: unchanged lines are context, a change is its removed then its added lines, CRLF reads as LF, \'\' is no line', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nX\nc'), [{ op: ' ', text: 'a' }, { op: '-', text: 'b' }, { op: '+', text: 'X' }, { op: ' ', text: 'c' }]);
  assert.deepEqual(ops('a\r\nb', 'a\nb\nc'), [' a', ' b', '+c']);
  assert.deepEqual(ops('a\nb\nc', 'c'), ['-a', '-b', ' c']);
  assert.deepEqual(ops('', 'x\ny'), ['+x', '+y']);   // Write
  assert.deepEqual(ops('x', ''), ['-x']);
});
test('lineDiff: a middle past 250 000 cells is all removed then all added, the common ends kept', () => {
  const side = (p: string) => ['h', ...Array.from({ length: 600 }, (_, i) => p + i), 't'].join('\n');
  const d = lineDiff(side('a'), side('b'));
  assert.deepEqual([d[0], d.at(-1), d[1].op, d[600].op, d[601].op, diffCount(d)], [{ op: ' ', text: 'h' }, { op: ' ', text: 't' }, '-', '-', '+', { add: 600, del: 600 }]);
});
test('diffCount: added and removed lines', () => {
  assert.deepEqual(diffCount(lineDiff('a\nb\nc', 'a\nB\nc\nd')), { add: 2, del: 1 });
});
