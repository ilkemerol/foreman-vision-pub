import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answers, blank, draft, keep, other, pick, recommended } from '../../web/src/logic/answer.ts';

const Q1 = { question: 'Which color?', header: 'Color', options: [{ label: 'Blue (Recommended)' }, { label: 'Red' }], multiSelect: false };
const Q2 = { question: 'Which ones?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], multiSelect: true };
const qs = [Q1, Q2];

test('answers: none until every question has one; single-select its option or Other; multi the options in their order, Other last', () => {
  let p = blank(qs);
  assert.equal(answers(qs, p), null);
  p = pick(qs, p, 0, 'Red');
  assert.equal(answers(qs, p), null);
  p = pick(qs, pick(qs, p, 1, 'C'), 1, 'A');
  assert.deepEqual(answers(qs, p), { 'Which color?': 'Red', 'Which ones?': 'A, C' });
  p = other(qs, p, 1, '  D too  ');
  assert.equal(answers(qs, p)!['Which ones?'], 'A, C, D too');
  p = other(qs, p, 0, 'Purple, a dark one');
  assert.deepEqual([answers(qs, p)!['Which color?'], p[0].labels], ['Purple, a dark one', []]);
  p = pick(qs, p, 0, 'Blue (Recommended)');
  assert.deepEqual([answers(qs, p)!['Which color?'], p[0].other], ['Blue (Recommended)', '']);
});
test('pick: multi-select toggles, single-select replaces', () => {
  let p = pick(qs, blank(qs), 1, 'B');
  p = pick(qs, p, 1, 'B');
  assert.deepEqual(p[1].labels, []);
  assert.deepEqual(pick(qs, pick(qs, blank(qs), 0, 'Red'), 0, 'Blue (Recommended)')[0].labels, ['Blue (Recommended)']);
  assert.deepEqual(answers(qs, other(qs, pick(qs, blank(qs), 0, 'Red'), 1, '   ')), null);   // blank Other is no answer
});
test('draft: a question\'s picks outlive the form until sent; the oldest of more than 20 goes', () => {
  assert.deepEqual(draft('d1', qs), blank(qs));
  const p = other(qs, pick(qs, blank(qs), 1, 'B'), 0, 'Purple');
  keep('d1', p);
  assert.equal(draft('d1', qs), p);
  keep('d1', null);
  assert.deepEqual(draft('d1', qs), blank(qs));
  for (let i = 0; i < 21; i++) keep('k' + i, p);
  assert.deepEqual([draft('k0', qs), draft('k1', qs)], [blank(qs), p]);
});
test('recommended: a label ending in (Recommended), any case', () => {
  assert.deepEqual(['Keep the list (Recommended)', 'Keep it (recommended)', 'Recommended not', 'Card only'].map(recommended), [true, true, false, false]);
});
