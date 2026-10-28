import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockAt, collapseBlocks, COLLAPSE_MS, CRACK_MS, dustAt, newlyHidden, nextFloor, shakeAt, visibleSessions } from '../../web/src/logic/collapse.ts';
import { session } from './fake.ts';

test('collapseBlocks: covers the bitmap once, edge blocks cut short, top rows fall first, all gone by the end', () => {
  for (const rand of [() => 0, () => 0.999]) {
    const bs = collapseBlocks(50, 30, 12, rand);
    assert.equal(bs.length, 5 * 3);
    assert.equal(bs.reduce((n, b) => n + b.w * b.h, 0), 50 * 30);
    assert.deepEqual(bs.at(-1), { ...bs.at(-1)!, x: 48, y: 24, w: 2, h: 6 });
    for (const b of bs) {
      assert.ok(b.delay >= CRACK_MS && Number.isInteger(b.delay) && Number.isInteger(b.drift));
      const end = blockAt(b, COLLAPSE_MS, 30);
      assert.ok(b.y + end.dy >= 30, 'off the floor by the end');
    }
    const rowDelay = (y: number) => bs.filter(b => b.y === y).map(b => b.delay);
    assert.ok(Math.max(...rowDelay(0)) <= Math.min(...rowDelay(24)));
  }
});

test('blockAt: still before its delay, then whole pixels that fall faster and faster', () => {
  const b = { x: 0, y: 0, w: 8, h: 8, delay: 300, drift: -3 };
  assert.deepEqual(blockAt(b, 0, 100), { dx: 0, dy: 0, p: 0 });
  const ys = [400, 500, 600, 700, 800].map(t => blockAt(b, t, 100).dy);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] > (ys[i - 1] - (ys[i - 2] ?? 0)) - 1 && ys[i] > ys[i - 1]);
  assert.deepEqual(blockAt(b, 2000, 100), { dx: -3, dy: 100, p: 1 });
});

test('shakeAt and dustAt: whole pixels, still at the end; dust only near a block\'s exit, at the bottom edge', () => {
  for (let t = 0; t <= COLLAPSE_MS; t += 10) {
    const s = shakeAt(t);
    assert.ok(Number.isInteger(s.x) && Number.isInteger(s.y) && Math.abs(s.x) <= 2 && Math.abs(s.y) <= 1);
  }
  assert.deepEqual(shakeAt(COLLAPSE_MS - 1), { x: 0, y: 0 });
  const bs = collapseBlocks(24, 24, 12, () => 0.5);
  assert.deepEqual(dustAt(bs, 24, 0), []);
  let seen = 0;
  for (let t = 0; t <= COLLAPSE_MS + 500; t += 20) for (const p of dustAt(bs, 24, t)) {
    seen++;
    assert.ok(p.s >= 1 && p.y + p.s <= 24 && p.y >= 24 - 15 && Number.isInteger(p.x));
  }
  assert.ok(seen > 0);
});

test('visibleSessions: hidden floors go, unless still collapsing', () => {
  const ss = [session({ sid: 'a' }), session({ sid: 'b', hiddenAt: 5 }), session({ sid: 'c', hiddenAt: 6 })];
  assert.deepEqual(visibleSessions(ss, new Set(['c'])).map(s => s.sid), ['a', 'c']);
});

test('newlyHidden: a fresh hide collapses once; a reload or an old hide does not; shown again, a new hide collapses again', () => {
  const hid = (at: number | null) => [session({ sid: 'a', hiddenAt: at }), session({ sid: 'b' })];
  assert.deepEqual(newlyHidden(null, hid(1000), 1100), { seen: new Set(['a']), collapse: [] });   // first snapshot after a load
  let r = newlyHidden(new Set(), hid(1000), 1100);
  assert.deepEqual(r.collapse, ['a']);
  assert.deepEqual(newlyHidden(r.seen, hid(1000), 1300).collapse, []);   // once
  assert.deepEqual(newlyHidden(new Set(), hid(1000), 1000 + COLLAPSE_MS).collapse, []);   // too old: just gone
  r = newlyHidden(r.seen, hid(null), 2000);
  assert.deepEqual(r.seen, new Set());
  assert.deepEqual(newlyHidden(r.seen, hid(3000), 3200).collapse, ['a']);
});

test('nextFloor: the card under it in the sidebar (F down), else the one above, else none', () => {
  const ss = ['a', 'b', 'c'].map(sid => session({ sid }));
  assert.equal(nextFloor(ss, 'b'), 'a');
  assert.equal(nextFloor(ss, 'a'), 'b');
  assert.equal(nextFloor([session({ sid: 'a' })], 'a'), null);
});
