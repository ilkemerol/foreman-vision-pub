import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officeLayout, type Fit } from '../../web/src/logic/layout.ts';
import { blockFree, blockOrder, deskCells, teamOf } from '../../web/src/logic/team.ts';

const fit = (w: number, h: number): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0 });
const MIN = officeLayout(fit(1114, 589)), BIG = officeLayout(fit(2308, 1372));   // 34×18 (library: one row) and 47×25 (main: 3 rows × 4 cols)
const cells = deskCells(BIG);
const at = (room: string, row: number, col: number) => BIG.desks.findIndex((d, i) => d.room === room && cells[i].row === row && cells[i].col === col);
const rc = (l: typeof BIG, order: number[]) => { const c = deskCells(l); return order.map(i => [c[i].row, c[i].col]); };

test('teamOf: the prefix before the first colon, else the whole type; the solo types and only those are teamless', () => {
  assert.equal(teamOf('marketing:seo'), 'marketing');
  assert.equal(teamOf('caveman:cavecrew-builder'), 'caveman');
  assert.equal(teamOf('a:b:c'), 'a');
  assert.equal(teamOf('Explore'), 'Explore');
  assert.equal(teamOf('Plan'), 'Plan');
  for (const t of ['general-purpose', 'claude', 'unknown', 'workflow-subagent']) assert.equal(teamOf(t), null);
  assert.equal(teamOf('General-Purpose'), 'General-Purpose');   // case-sensitive
});

test('deskCells: rows by y, columns by cx, each within its room, from 0', () => {
  assert.equal(BIG.key, '47x25');
  assert.equal(cells.length, BIG.desks.length);
  assert.deepEqual(cells[BIG.desks.findIndex(d => d.room === 'main')], { row: 0, col: 0 });
  BIG.desks.forEach((d, i) => BIG.desks.forEach((e, j) => { if (d.room === e.room && d.y === e.y) assert.equal(cells[i].row, cells[j].row); }));
  for (const room of ['main', 'server', 'library']) {
    const cols = [...new Set(cells.filter((_, i) => BIG.desks[i].room === room).map(c => c.col))].sort((a, b) => a - b);
    assert.deepEqual(cols, cols.map((_, k) => k));
  }
});
test('deskCells: cached per desks array, so a layout copy gets the same cells; another grid its own', () => {
  assert.equal(deskCells(BIG), cells);
  assert.equal(deskCells({ ...BIG }), cells);
  assert.equal(deskCells(MIN).length, MIN.desks.length);
});

test('blockOrder: the anchor, its right neighbour, then the two behind them (the row above)', () => {
  assert.deepEqual(rc(BIG, blockOrder(BIG, at('main', 1, 1), 7).slice(0, 4)), [[1, 1], [1, 2], [0, 1], [0, 2]]);
});
test('blockOrder: on the front row the back row is the one below', () => {
  assert.deepEqual(rc(BIG, blockOrder(BIG, at('main', 0, 1), 7).slice(0, 4)), [[0, 1], [0, 2], [1, 1], [1, 2]]);
});
test('blockOrder: at the right edge it takes the anchor column, then the one on its left', () => {
  assert.deepEqual(rc(BIG, blockOrder(BIG, at('main', 1, 3), 7).slice(0, 4)), [[1, 3], [0, 3], [1, 2], [0, 2]]);
});
test('blockOrder: every desk of the room exactly once; the same seed gives the same order', () => {
  const room = BIG.desks.map((d, i) => d.room === 'main' ? i : -1).filter(i => i >= 0);
  for (const a of room) {
    const o = blockOrder(BIG, a, 3);
    assert.deepEqual([...o].sort((x, y) => x - y), room);
    assert.deepEqual(blockOrder(BIG, a, 3), o);
  }
});
test('blockOrder: a one-row room keeps to its row, right of the anchor then left', () => {
  const lib = MIN.desks.map((d, i) => d.room === 'library' ? i : -1).filter(i => i >= 0);
  assert.ok(lib.length >= 2 && lib.every(i => MIN.desks[i].y === MIN.desks[lib[0]].y));
  assert.deepEqual(blockOrder(MIN, lib[0], 1), lib);
  assert.deepEqual(blockOrder(MIN, lib[lib.length - 1], 1), [...lib].reverse());
  assert.deepEqual(rc(BIG, blockOrder(BIG, at('library', 0, 1), 1)), [[0, 1], [0, 2], [0, 0]]);   // 47×25's library: one row of 3
});

test('blockFree: the free desks among the first four of the block', () => {
  const a = at('main', 1, 1), first = blockOrder(BIG, a, 0).slice(0, 4);
  assert.equal(blockFree(BIG, a, () => true), 4);
  assert.equal(blockFree(BIG, a, () => false), 0);
  assert.equal(blockFree(BIG, a, i => i !== first[3]), 3);
  assert.equal(blockFree(BIG, a, i => !first.includes(i)), 0);
});
