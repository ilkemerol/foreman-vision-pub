import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coinCount, column, dropGlint, fall, hasSack, landed, onPile, pileAlpha, pileFlat, pileIso, pileShows, payHop, payTimeline, sackOn, stepCoins, tickCoins, type Piles } from '../../web/src/logic/coins.ts';
import { catHit, perchFloor } from '../../web/src/logic/cat.ts';
import { isoProj, toWorld } from '../../web/src/logic/iso.ts';
import { lampAt } from '../../web/src/logic/lights.ts';
import { isoView, officeLayout, type Fit, type Rect } from '../../web/src/logic/layout.ts';
import { advanceWalkers, PAY_WALK, syncWalkers, type Walker } from '../../web/src/logic/motion.ts';
import { officeScene } from '../../web/src/logic/scene.ts';
import type { AgentView } from '../../shared/types.ts';
import { agent } from './fake.ts';

const fit = (w: number, h: number): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0 });
// 34×18, 35×19, 47×25, 74×39
const LAYOUTS = [fit(1114, 589), fit(1146, 613), fit(2308, 1372), fit(3600, 2000)].map(f => officeLayout(f));
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

test('coinCount, hasSack, column: a coin a 10K, at most 15, columns of 5, the sack from 150K', () => {
  assert.deepEqual([0, 9_999, 10_000, 49_999, 50_000, 60_000, 149_999, 150_000, 1e6].map(coinCount), [0, 0, 1, 4, 5, 6, 14, 15, 15]);
  assert.deepEqual([149_999, 150_000, 1e6].map(hasSack), [false, true, true]);
  assert.deepEqual([0, 5, 6, 10, 11, 14, 15].map(n => [0, 1, 2].map(c => column(n, c))), [[0, 0, 0], [5, 0, 0], [5, 1, 0], [5, 5, 0], [5, 5, 1], [5, 5, 4], [5, 5, 5]]);
});

test('pileFlat: right of its desk, clear of the desk, its lamp, the flames, Smooth\'s perch (room by room) and every other desk, at four sizes', () => {
  for (const l of LAYOUTS) l.desks.forEach((d, i) => {
    const p = pileFlat(d), s = Math.round(p.sack.x - 5.5);
    assert.deepEqual(p, { cols: [0, 1, 2].map(c => ({ x: d.cx + 24 + 5 * c, y: d.y + 31 })), sack: { x: d.cx + 33, y: d.y + 38 } });
    const boxes: Rect[] = [...p.cols.map(c => ({ x0: c.x, y0: c.y - 12, x1: c.x + 6, y1: c.y + 1 })), { x0: s, y0: p.sack.y - 10, x1: s + 11, y1: p.sack.y + 1 }];   // 5-coin columns (13 px), the 11×11 sack
    const f = perchFloor(l, i).pt, lamp = lampAt(d);
    const keep: [string, Rect][] = [
      ['desk', { x0: d.cx - 24, y0: d.y, x1: d.cx + 24, y1: d.y + 32 }],
      ['lamp', { x0: lamp.x - 3, y0: lamp.y - 7, x1: lamp.x + 4, y1: lamp.y }],   // cx − 20 … cx − 13, y + 10 … y + 17
      ['flames', { x0: d.cx - 8, y0: d.y - 21, x1: d.cx + 8, y1: d.y - 1 }],
      ['cat sit', catHit('sit', f.x, f.y)], ['cat loaf', catHit('loaf', f.x, f.y)],   // main y + 50, upper rooms y + 44
      ...l.desks.filter(o => o !== d).map((o): [string, Rect] => [`desk ${o.cx},${o.y}`, { x0: o.cx - 24, y0: o.y, x1: o.cx + 24, y1: o.y + 32 }]),
    ];
    for (const b of boxes) for (const [why, k] of keep) assert.ok(!meet(b, k), `${l.key} desk ${i}: pile meets ${why}`);
  });
});

test('pileIso: on the desk\'s +x side; a room\'s last desk by its right wall keeps its sack ¼ tile in; clear of Smooth\'s perch on screen at four sizes', () => {
  for (const l of LAYOUTS) {
    const v = isoView(l.cols, l.rows), P = (x: number, y: number) => isoProj(v, x, y, 0);
    l.desks.forEach((d, i) => {
      const s = toWorld(d.seat), dw = { x: s.x, y: s.y - 1 }, p = pileIso(l, i), byWall = l.rooms[d.room].x1 - d.cx <= 40;
      assert.deepEqual(p, { cols: [0, 1, 2].map(c => ({ x: dw.x + 1.375, y: dw.y - 0.375 + 0.375 * c })), sack: { x: dw.x + (byWall ? 1.625 : 1.875), y: dw.y + 0.375 } });
      const boxes: Rect[] = p.cols.map(c => { const [x, y] = P(c.x, c.y); return { x0: Math.round(x) - 3, y0: Math.round(y) - 12, x1: Math.round(x) + 3, y1: Math.round(y) + 1 }; });
      const [kx, ky] = P(p.sack.x, p.sack.y), k0 = Math.round(kx - 5.5);
      boxes.push({ x0: k0, y0: Math.round(ky) - 10, x1: k0 + 11, y1: Math.round(ky) + 1 });
      const c = toWorld(perchFloor(l, i).pt), [cx, cy] = P(c.x, c.y);
      for (const b of boxes) for (const cat of [catHit('sit', cx, cy), catHit('loaf', cx, cy)]) assert.ok(!meet(b, cat), `${l.key} desk ${i}: pile meets the perch`);
    });
  }
});

const L = LAYOUTS[0];
const byId = (as: AgentView[]) => new Map(as.map(a => [a.id, a]));
/** A seeded floor; next(): a snapshot at `now` (server time = now), coins before walkers as OfficeFloor does. */
function world(agents: AgentView[]) {
  const piles: Piles = new Map(), walkers = new Map<string, Walker>(), sc = officeScene(agents, 0, L);
  syncWalkers(walkers, sc.places, L, true, 0);
  stepCoins(piles, sc, walkers, byId(agents), 0, { seed: true, calm: false });
  return { piles, walkers, next(as: AgentView[], now: number, calm = false) {
    const s = officeScene(as, now, L);
    stepCoins(piles, s, walkers, byId(as), now, { seed: false, calm });
    syncWalkers(walkers, s.places, L, false, now);
    return s;
  } };
}

test('payTimeline, payHop: top coin first, the sack last, every arrival by 1300 ms, the walk at 2000', () => {
  for (const [coins, sack] of [[1, false], [3, false], [9, false], [15, true]] as const) {
    const it = payTimeline(coins, sack), N = coins + (sack ? 1 : 0);
    assert.equal(it.length, N);
    assert.deepEqual([it[0].k, it[0].lift, it.at(-1)!.k, it.at(-1)!.land], [coins - 1, 300, sack ? 'sack' : 0, N === 1 ? 600 : 1300]);
    assert.ok(it.every((x, j) => x.land === x.lift + 300 && (j === 0 || x.lift > it[j - 1].lift)));
  }
  assert.equal(PAY_WALK, 2000);
  assert.deepEqual([1619, 1620, 1740, 1859, 1860].map(payHop), [0, 0, 3, 0, 0]);
});

test('stepCoins: a seed shows a working or waiting pile whole, no drop; a done, failed or abandoned one shows none', () => {
  for (const [a, n] of [[agent({ id: 'a', tokens: 52_000 }), 5], [agent({ id: 'a', stage: 'waiting', tokens: 20_000 }), 2]] as const) {
    const p = world([a]).piles.get('a')!;
    assert.deepEqual([landed(p, 0), fall(p, 0), onPile(p, 0, false), pileShows(p, 0, false)], [n, null, n, true]);
  }
  for (const a of [agent({ id: 'a', stage: 'done', tokens: 90_000 }), agent({ id: 'a', stage: 'failed', stageSince: 0, tokens: 40_000 }), agent({ id: 'a', stage: 'abandoned', tokens: 30_000 })]) {
    const p = world([a]).piles.get('a');   // a 'cut' record, or none where its place carries no desk
    assert.ok(!p || !pileShows(p, 0, false), a.stage);
  }
});

test('stepCoins, tickCoins: new coins fall one by one, 380 ms apart; fewer tokens drop the pile at once', () => {
  const f = world([agent({ id: 'a', tokens: 9_000 })]), p = f.piles.get('a')!;
  tickCoins(f.piles, f.next([agent({ id: 'a', tokens: 42_000 })], 1000), f.walkers, 1000, false);
  assert.deepEqual([1000, 1379, 1380, 2140, 2520, 4000].map(t => landed(p, t)), [0, 0, 1, 3, 4, 4]);
  assert.deepEqual([fall(p, 1000), fall(p, 1190), fall(p, 2520)], [22, 17, null]);
  f.next([agent({ id: 'a', tokens: 20_000 })], 5000);
  assert.deepEqual([landed(p, 5000), p.dropAt], [2, null]);
});

test('dropGlint: coins already on the pile never sparkle; a falling coin sparkles 420 ms from its landing', () => {
  const f = world([agent({ id: 'a', tokens: 20_000 })]), p = f.piles.get('a')!;
  tickCoins(f.piles, f.next([agent({ id: 'a', tokens: 40_000 })], 1000), f.walkers, 1000, false);   // shown 2, drop from 1000
  assert.deepEqual([0, 1].flatMap(k => [1000, 1040, 1300].map(t => dropGlint(p, k, t))), [-1, -1, -1, -1, -1, -1]);
  assert.deepEqual([1379, 1380, 1590, 1800].map(t => dropGlint(p, 2, t)), [-1, 0, 0.5, -1]);
});

test('dropGlint: a same-token snapshot does not cut the landing sparkle', () => {
  const f = world([agent({ id: 'a', tokens: 20_000 })]), p = f.piles.get('a')!;
  tickCoins(f.piles, f.next([agent({ id: 'a', tokens: 30_000 })], 1000), f.walkers, 1000, false);   // coin 2 lands at 1380
  f.next([agent({ id: 'a', tokens: 30_000 })], 1450);   // another snapshot, the same tokens
  assert.ok(dropGlint(p, 2, 1500) > 0);
});

test('tickCoins: the record folds once the last glint ends: shown = target, dropAt null', () => {
  const f = world([agent({ id: 'a', tokens: 20_000 })]), p = f.piles.get('a')!, s = f.next([agent({ id: 'a', tokens: 30_000 })], 1000);
  tickCoins(f.piles, s, f.walkers, 1000, false);   // coin 2 lands at 1380, glints to 1800
  tickCoins(f.piles, s, f.walkers, 1799, false);
  assert.deepEqual([p.shown, p.dropAt], [2, 1000]);
  tickCoins(f.piles, s, f.walkers, 1800, false);
  assert.deepEqual([p.shown, p.target, p.dropAt], [3, 3, null]);
});

test('sackOn: with 15 coins and the sack; not while fewer are on the pile; payday flies it last, a fade keeps it, a cut drops it', () => {
  assert.equal(sackOn(world([agent({ id: 'a', tokens: 160_000 })]).piles.get('a')!, 0, false), true);
  const f = world([agent({ id: 'a', tokens: 0 })]), p = f.piles.get('a')!;
  tickCoins(f.piles, f.next([agent({ id: 'a', tokens: 160_000 })], 1000), f.walkers, 1000, false);   // the 15th coin lands at 6700
  assert.deepEqual([sackOn(p, 6699, false), sackOn(p, 6700, false), sackOn(p, 1000, true)], [false, true, true]);
  const g = world([agent({ id: 'a', tokens: 160_000 })]), q = g.piles.get('a')!;
  g.next([agent({ id: 'a', stage: 'done', stageSince: 2000, tokens: 160_000 })], 2000);   // 16 items, the sack lifts at 2000 + 1000
  assert.deepEqual([q.end?.how, sackOn(q, 2999, false), sackOn(q, 3000, false)], ['pay', true, false]);
  const h = world([agent({ id: 'a', tokens: 160_000 })]), r = h.piles.get('a')!;
  h.next([agent({ id: 'a', stage: 'failed', stageSince: 2000, tokens: 160_000 })], 2000);
  assert.deepEqual([r.end?.how, sackOn(r, 2500, false)], ['fade', true]);
  const k = world([agent({ id: 'a', tokens: 160_000 })]), c = k.piles.get('a')!;
  k.next([agent({ id: 'a', stage: 'done', stageSince: 2000, tokens: 160_000 })], 2000, true);
  assert.deepEqual([c.end?.how, sackOn(c, 2000, false)], ['cut', false]);
});

test('calm switched on mid-animation: from that frame the pile shows its target, an ended pile vanishes', () => {
  const f = world([agent({ id: 'a', tokens: 0 })]), p = f.piles.get('a')!, s = f.next([agent({ id: 'a', tokens: 40_000 })], 1000);
  tickCoins(f.piles, s, f.walkers, 1000, false);   // mid-drop at 1500: one coin landed
  assert.deepEqual([onPile(p, 1500, false), onPile(p, 1500, true), pileShows(p, 1500, true)], [1, 4, true]);
  tickCoins(f.piles, s, f.walkers, 1500, true);
  assert.equal(onPile(p, 1500, true), 4);
  for (const stage of ['done', 'failed'] as const) {   // mid-payday, mid-fade
    const g = world([agent({ id: 'a', tokens: 30_000 })]), q = g.piles.get('a')!;
    g.next([agent({ id: 'a', stage, stageSince: 2000, tokens: 30_000 })], 2000);
    assert.deepEqual([pileShows(q, 2500, false), pileShows(q, 2500, true), onPile(q, 2500, true), sackOn(q, 2500, true)], [true, false, 0, false], stage);
  }
});

test('tickCoins: a newcomer\'s coins fall only once it sits', () => {
  const f = world([]), s = f.next([agent({ id: 'n', tokens: 20_000 })], 1000), w = f.walkers.get('n')!;
  for (let t = 1016; w.moving; t += 16) {
    advanceWalkers(f.walkers, 16, t); tickCoins(f.piles, s, f.walkers, t, false);
    if (w.moving) assert.equal(pileShows(f.piles.get('n')!, t, false), false);
  }
  const p = f.piles.get('n')!;
  assert.deepEqual([landed(p, w.restAt), landed(p, w.restAt + 380), landed(p, w.restAt + 760)], [0, 1, 2]);
});

test('stepCoins: a waiting agent\'s pile stays at its desk and grows; back at work it carries on', () => {
  const f = world([agent({ id: 'a', tokens: 20_000 })]), p = f.piles.get('a')!;
  const s = f.next([agent({ id: 'a', stage: 'waiting', stageSince: 2000, tokens: 30_000 })], 2000);
  tickCoins(f.piles, s, f.walkers, 2000, false);
  assert.deepEqual([p.desk, p.end, pileShows(p, 2000, false), landed(p, 2380)], [s.places.get('a')!.desk, null, true, 3]);
  f.next([agent({ id: 'a', stage: 'running', stageSince: 3000, tokens: 40_000 })], 3000);
  assert.equal(landed(p, 3000), 3);   // not reset
});

test('stepCoins: done while seated pays out: drops still due end, the pile sits at the target, its walker waits', () => {
  const f = world([agent({ id: 'a', tokens: 30_000 })]), p = f.piles.get('a')!, w = f.walkers.get('a')!;
  f.next([agent({ id: 'a', stage: 'done', stageSince: 2000, tokens: 52_000 })], 2000);   // shown 3, coinCount 5
  assert.deepEqual([p.end?.how, p.target, p.shown, p.dropAt, p.end?.items.length, w.payAt], ['pay', 5, 5, null, 5, 2000]);
  assert.deepEqual([onPile(p, 2299, false), onPile(p, 2300, false), onPile(p, 3000, false)], [5, 4, 0]);
  const g = world([agent({ id: 'a', tokens: 9_999 })]);
  g.next([agent({ id: 'a', stage: 'done', stageSince: 2000, tokens: 10_000 })], 2000);   // shown 0, target 1: payday too
  assert.deepEqual([g.piles.get('a')!.end?.how, g.walkers.get('a')!.payAt], ['pay', 2000]);
  const h = world([agent({ id: 'a', tokens: 9_999 })]);
  h.next([agent({ id: 'a', stage: 'done', stageSince: 2000, tokens: 9_999 })], 2000);    // under 10K: no payday, it walks at once
  assert.deepEqual([h.piles.get('a')!.end?.how, h.walkers.get('a')!.payAt], ['cut', null]);
});

test('stepCoins: done away from its desk glints in place; the walker never waits', () => {
  const f = world([agent({ id: 'a', stage: 'waiting', tokens: 30_000 })]);
  f.next([agent({ id: 'a', stage: 'done', stageSince: 2000, tokens: 30_000 })], 2000);
  assert.deepEqual([f.piles.get('a')!.end?.how, f.walkers.get('a')!.payAt], ['glint', null]);
});

test('stepCoins: failed and abandoned fade out over 1 s', () => {
  for (const stage of ['failed', 'abandoned'] as const) {
    const f = world([agent({ id: 'a', tokens: 30_000 })]), p = f.piles.get('a')!;
    f.next([agent({ id: 'a', stage, stageSince: 2000, tokens: 30_000 })], 2000);
    assert.deepEqual([p.end?.how, pileAlpha(p, 2500, false), pileAlpha(p, 3000, false), pileShows(p, 3000, false)], ['fade', 0.5, 0, false], stage);
  }
});

test('stepCoins: calm: no drop, no payday, gone at once', () => {
  const f = world([agent({ id: 'a', tokens: 0 })]), p = f.piles.get('a')!;
  tickCoins(f.piles, f.next([agent({ id: 'a', tokens: 40_000 })], 1000, true), f.walkers, 1000, true);
  assert.deepEqual([landed(p, 1000), fall(p, 1000)], [4, null]);
  f.next([agent({ id: 'a', stage: 'done', stageSince: 2000, tokens: 40_000 })], 2000, true);
  assert.deepEqual([p.end?.how, f.walkers.get('a')!.payAt, pileShows(p, 2000, true)], ['cut', null, false]);
});

test('stepCoins: back to work after done or abandoned, the pile shows whole on its return, no drop', () => {
  for (const stage of ['done', 'abandoned'] as const) {
    const f = world([agent({ id: 'a', tokens: 30_000 })]);
    f.next([agent({ id: 'a', stage, stageSince: 2000, tokens: 30_000 })], 2000);
    f.next([agent({ id: 'a', stage: 'running', stageSince: 9000, tokens: 40_000 })], 9000);
    const p = f.piles.get('a')!;
    assert.deepEqual([p.end, p.shown, p.target, p.dropAt], [null, 4, 4, null], stage);
  }
});

test('stepCoins: a reseed mid-payday or mid-drop ends it; a record goes with its place; main, foreman and placeholders never get one', () => {
  const f = world([agent({ id: 'a', tokens: 30_000 })]);
  f.next([agent({ id: 'a', stage: 'done', stageSince: 2000, tokens: 30_000 })], 2000);
  const s = officeScene([agent({ id: 'a', stage: 'done', stageSince: 2000, tokens: 30_000 })], 2500, L);
  syncWalkers(f.walkers, s.places, L, true, 2500);
  stepCoins(f.piles, s, f.walkers, byId([agent({ id: 'a', stage: 'done', stageSince: 2000, tokens: 30_000 })]), 2500, { seed: true, calm: false });
  assert.deepEqual([pileShows(f.piles.get('a')!, 2500, false), f.walkers.get('a')!.payAt], [false, null]);
  f.next([], 3000);
  assert.equal(f.piles.has('a'), false);
  const big = [agent({ id: 'main', role: 'main', tokens: 5e5 }), agent({ id: 'fm', role: 'foreman', tokens: 5e5 }), agent({ id: 'q', role: 'placeholder', stage: 'queued', tokens: 5e5 })];
  const g = world(big);
  g.next(big, 1000);
  assert.equal(g.piles.size, 0);
});
