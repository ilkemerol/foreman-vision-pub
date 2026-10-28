import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agoText, boardFill, boardMarks, boardRows, hasTerminal, INK } from '../../web/src/logic/board.ts';
import { setLang } from '../../web/src/logic/i18n.ts';
import { shownLabels } from '../../web/src/logic/labels.ts';
import { agent } from './fake.ts';

// The Done lounge's smart board
test('boardMarks: one line per agent, oldest first, 2 px apart, inside the screen; a second column on a wide screen; the same keys give the same writing', () => {
  const keys = Array.from({ length: 14 }, (_, i) => `toolu_${i}`);
  for (const [w, h, cols] of [[22, 11, 1], [34, 11, 2]] as const) {
    const rows = 6, marks = boardMarks(keys, w, h), lines = new Set(marks.map(m => `${m.x < w / 2 || cols === 1 ? 0 : 1},${m.y}`));
    assert.equal(lines.size, Math.min(keys.length, rows * cols), `${w}: one line per agent up to the screen's`);
    for (const m of marks) assert.ok(m.x >= 0 && m.x + m.w <= w && m.y >= 0 && m.y < h && m.y % 2 === 0 && INK.includes(m.c), JSON.stringify(m));
    assert.deepEqual(boardMarks(keys, w, h), marks);
    for (let n = 0; n <= 3; n++) assert.equal(new Set(boardMarks(keys.slice(0, n), w, h).map(m => m.y)).size, n);   // fuller with each agent
    assert.deepEqual(boardMarks(keys.slice(0, 3), w, h), marks.filter(m => m.y < 6 && (cols === 1 || m.x < w / 2)));   // one more leaves the lines before it as they were
  }
  assert.notDeepEqual(boardMarks(['a'], 34, 11), boardMarks(['b'], 34, 11));
});
test('boardFill: the share of the Done lounge\'s seats taken', () => {
  assert.deepEqual([boardFill(0, 9), boardFill(3, 9), boardFill(9, 9), boardFill(12, 9), boardFill(1, 0)], [0, 1 / 3, 1, 1, 0]);
});
test('boardRows: the Done lounge\'s agents newest first (stageSince, then id), numbered, long text cut with …, the rest as +N; finished as relative time', () => {
  setLang('en');
  const now = 10_000_000, ag = Array.from({ length: 12 }, (_, i) => agent({ id: 'a' + String(i).padStart(2, '0'), stage: 'done', stageSince: now - i * 60_000, label: 'job ' + i, type: 'general-purpose', note: i === 2 ? 'x'.repeat(60) : null }));
  const { rows, more } = boardRows([...ag].reverse(), now);
  assert.deepEqual(rows.map(r => [r.n, r.id]), ag.slice(0, 10).map((a, i) => [i + 1, a.id]));
  assert.equal(more, 2);
  assert.deepEqual([rows[0].ago, rows[1].ago, rows[2].note.length, rows[2].note.at(-1), rows[0].note], ['just now', '1 min ago', 40, '…', '—']);
  assert.equal(boardRows([agent({ id: 'b' }), agent({ id: 'a' })], 0).rows[0].id, 'a');   // a tie by id
  assert.equal(boardRows([agent({ label: 'y'.repeat(50) })], 0).rows[0].name.length, 28);
  setLang('tr');
  assert.deepEqual([agoText(30_000), agoText(3 * 60_000), agoText(125 * 60_000)], ['az önce', '3 dk önce', '2 sa önce']);
  setLang('en');
});
test('shownLabels: a Done lounge agent\'s name and Smooth\'s tag only while hovered; every other label always', () => {
  const ls = [{ kind: 'done', key: 'done-a' }, { kind: 'done', key: 'done-b' }, { kind: 'tag', key: 'cat' }, { kind: 'tag', key: 'tag-c' }, { kind: 'sign', key: 'door-done' }];
  assert.deepEqual(shownLabels(ls, null).map(l => l.key), ['tag-c', 'door-done']);
  assert.deepEqual(shownLabels(ls, 'a').map(l => l.key), ['done-a', 'tag-c', 'door-done']);
  assert.deepEqual(shownLabels(ls, 'cat').map(l => l.key), ['cat', 'tag-c', 'door-done']);
  assert.deepEqual(shownLabels(ls, 'board').map(l => l.key), ['tag-c', 'door-done']);
});
test('hasTerminal: an agent in the Done lounge gets no hover terminal, any other place does', () => {
  assert.deepEqual([hasTerminal({ kind: 'done' }), hasTerminal({ kind: 'desk' }), hasTerminal(undefined)], [false, true, true]);
});
