import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASH, BONE, burnPhase, clockLeft, clockPixels, clockRing, PILE, SITTER, sitterRows } from '../../web/src/logic/burn.ts';

const b = (t: number) => burnPhase(t)!;

test('burn maps: the sitting skeleton is rows 6–31 of 16 px, the pile 16×8, the ash 12×3; the back view has no K in rows 11–16', () => {
  assert.deepEqual([SITTER.length, PILE.length, ASH.length], [26, 8, 3]);
  assert.ok(SITTER.every(r => r.length === 16 && /^[BSK.]+$/.test(r)) && PILE.every(r => r.length === 16 && /^[BSK.]+$/.test(r)));
  assert.ok(ASH.every(r => r.length === 12 && /^[Aa.]+$/.test(r)));
  assert.deepEqual([SITTER[0], SITTER[25], PILE[7], ASH[0]], ['....SBBBBBS.....', '...BBB....BBB...', '..BBBBBBBBBBBB..', '....AAAA....']);
  const back = sitterRows(true);
  assert.ok(back.slice(5, 11).every(r => !r.includes('K')) && SITTER.slice(5, 11).some(r => r.includes('K')));
  assert.deepEqual(back.map(r => r.replace(/[^.]/g, '#')), SITTER.map(r => r.replace(/[^.]/g, '#')));
  assert.deepEqual(BONE.map(t => t[0]), ['#ece6d2', '#a08a6a', '#5a4636']);
});

test('burnPhase: bones top down in 500 ms, a shake from 650, the fall 800–950 (squared); nothing before 0 or from 5000', () => {
  assert.deepEqual([0, 250, 499, 500, 949, 950].map(t => b(t).bones), [6, 19, 31, 32, 32, 0]);
  assert.deepEqual([649, 650, 710, 770, 800].map(t => b(t).shake), [0, 1, -1, 1, 0]);
  assert.deepEqual([799, 800, 875, 949, 950].map(t => +b(t).fall.toFixed(4)), [0, 0, 0.25, 0.9867, 0]);
  assert.deepEqual([burnPhase(-1), burnPhase(5000)], [null, null]);
  assert.deepEqual([b(799).label, b(800).label], [true, false]);
});

test('burnPhase: the pile lands at 950 with a 1 px bounce and dust, darkens at 1867 and 2333, turns to ash at 3000; the ash loses a row at 4250, 4500, 4750', () => {
  assert.deepEqual([949, 950, 1866, 1867, 2333, 2999, 3000].map(t => b(t).pile), [null, 0, 0, 1, 2, 2, null]);
  assert.deepEqual([950, 999, 1000].map(t => b(t).bounce), [1, 1, 0]);
  assert.deepEqual([b(950).dust, b(1025).dust, b(1100).dust], [{ d: 0, a: 1 }, { d: 2, a: 0.5 }, null]);
  assert.deepEqual([2999, 3000, 4249, 4250, 4500, 4749, 4750].map(t => b(t).ash), [0, 3, 3, 2, 1, 1, 0]);
});

test('burnPhase: the flame grows 0.25 per 75 ms from 1100, holds until 2800, drops 0.25 per 100 ms to 0 at 3200; smoke rises, halves, fades; embers blink', () => {
  assert.deepEqual([1099, 1100, 1175, 1250, 1325, 2799, 2800, 2900, 3000, 3100, 3200].map(t => b(t).flame), [0, 0.25, 0.5, 0.75, 1, 1, 1, 0.75, 0.5, 0.25, 0]);
  assert.deepEqual([2799, 2800, 3000, 3200, 3600, 4000, 4500].map(t => b(t).smoke), [0, 0, 0.5, 1, 0.75, 0.5, 0.25]);
  assert.deepEqual([3199, 3200, 3399, 3400, 3599, 3600].map(t => b(t).ember), [false, true, true, false, false, false]);
});

test('burnPhase: eight motes 60 ms apart drift 16 px right and 8 px up over 600 ms, fading', () => {
  assert.equal(b(3999).motes.length, 0);
  assert.deepEqual(b(4000).motes, [{ x: -2, y: 0, a: 1, dark: false }]);
  const m = b(4300).motes;
  assert.deepEqual([m.length, m[0].x, m[0].y, m[0].a], [6, 6, -4, 0.5]);
  assert.equal(b(4999).motes.length, 1);
});

test('done clock: full while it stays or a whole grace is left, 12 steps down to the last one, held past leaveAt', () => {
  assert.equal(clockLeft(null, 5000), 1);
  assert.equal(clockLeft(10_000 + 90_000, 10_000), 1);   // more than the grace (clock skew): full
  assert.equal(clockLeft(60_000, 0), 1);
  assert.equal(clockLeft(60_000, 1), 1);                  // a step shows until it is all gone
  assert.equal(clockLeft(60_000, 5000), 11 / 12);
  assert.equal(clockLeft(60_000, 30_000), 0.5);
  assert.equal(clockLeft(60_000, 59_999), 1 / 12);
  assert.equal(clockLeft(60_000, 60_000), 1 / 12);        // no dot-less gap before the burn takes over
  assert.equal(clockLeft(60_000, 70_000), 1 / 12);
});

test('done clock: the ten-minute stay (leaveAt = since + 10 min) counts on a 10-minute face; a grace leave keeps the 60 s one', () => {
  const since = 3000, at = since + 600_000;
  assert.equal(clockLeft(at, since), 1);
  assert.equal(clockLeft(at, since, since), 1);
  assert.equal(clockLeft(at, since + 50_000, since), 11 / 12);
  assert.equal(clockLeft(at, since + 300_000, since), 0.5);
  assert.equal(clockLeft(at, at, since), 1 / 12);
  assert.equal(clockLeft(since + 200_000, since + 170_000, since), 0.5);   // pruned at 140 s: its 60 s grace
});

test('done clock pixels: a 7 px disc that empties clockwise from 12 o’clock, its centre last; a 16 px ring', () => {
  const on = (left: number) => new Set(clockPixels(7, left).map(([x, y]) => `${x},${y}`));
  const rows = (s: Set<string>) => [0, 1, 2, 3, 4, 5, 6].map(y => [0, 1, 2, 3, 4, 5, 6].map(x => s.has(`${x},${y}`) ? '#' : '.').join(''));
  assert.deepEqual(rows(on(1)), ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..']);
  assert.equal(on(0).size, 0);
  assert.deepEqual(rows(on(11 / 12)), ['..#....', '.##..#.', '###.###', '#######', '#######', '.#####.', '..###..']);   // the hand left 12
  assert.deepEqual(rows(on(0.5)), ['..#....', '.##....', '###....', '####...', '####...', '.###...', '..##...']);
  assert.deepEqual(rows(on(0.25)), ['..#....', '.##....', '###....', '####...', '.......', '.......', '.......']);
  assert.deepEqual(rows(on(1 / 12)), ['..#....', '..#....', '.......', '...#...', '.......', '.......', '.......']);
  for (const [a, b] of [[1, 0.75], [0.75, 0.5], [0.5, 0.25], [0.25, 1 / 12], [1 / 12, 0]]) assert.ok([...on(b)].every(k => on(a).has(k)));
  assert.deepEqual(rows(new Set(clockRing(7).map(([x, y]) => `${x},${y}`))), ['..###..', '.#...#.', '#.....#', '#.....#', '#.....#', '.#...#.', '..###..']);
});
