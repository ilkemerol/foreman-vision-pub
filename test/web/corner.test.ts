import { test } from 'node:test';
import assert from 'node:assert/strict';
import { band, canVisit, cornerSpots, ctxPct, DROP, freeSpot, GAP_MS, gaugeColor, gaugeText, mainWallDecor, RISE, seedGauge, stepGauge, visitMs, visitPath, visitPose, WORK, type Gauge } from '../../web/src/logic/corner.ts';
import { pathLen } from '../../web/src/logic/fx.ts';
import { officeLayout, queueSpot, type Fit, type Pt, type Rect } from '../../web/src/logic/layout.ts';
import { outside, route, SPEED, syncWalkers, type Walker } from '../../web/src/logic/motion.ts';
import { officeScene } from '../../web/src/logic/scene.ts';
import { agent } from './fake.ts';

const fit = (w: number, h: number): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0 });
const LAYOUTS = [fit(1114, 589), fit(1146, 613), fit(1700, 1036), fit(2308, 1372)].map(f => officeLayout(f));   // minimum; 1366, 1920, 2560 boxes
const MIN = LAYOUTS[0], BIG = LAYOUTS[3];
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const sprite = (p: Pt): Rect => ({ x0: p.x - 8, y0: p.y - 32, x1: p.x + 8, y1: p.y });
const path = visitPath(MIN), TOTAL = visitMs(path), ARRIVE = RISE + pathLen(path) / SPEED;
/** Frames every 20 ms over [t0, t1) with one target; returns the last one. */
const frames = (g: Gauge, target: number | null, canGo: boolean, t0: number, t1: number) => {
  let r = stepGauge(g, target, canGo, path, t0);
  for (let t = t0 + 20; t < t1; t += 20) r = stepGauge(g, target, canGo, path, t);
  return r;
};

test('ctxPct: 200k or 1M by the setting; past 200k a session counts as 1M for good; rounded, at most 100', () => {
  assert.equal(ctxPct(null, '200k'), null);
  assert.equal(ctxPct({ used: 100_000, peak: 100_000 }, '200k'), 50);
  assert.equal(ctxPct({ used: 100_000, peak: 100_000 }, '1M'), 10);
  assert.equal(ctxPct({ used: 150_000, peak: 250_000 }, '200k'), 15);   // peak > 200k
  assert.equal(ctxPct({ used: 40_000, peak: 250_000 }, '200k'), 4);     // after a compact: still 1M
  assert.equal(ctxPct({ used: 200_000, peak: 200_000 }, '200k'), 100);
  assert.equal(ctxPct({ used: 1_234, peak: 1_234 }, '200k'), 1);
  assert.equal(ctxPct({ used: 1_200_000, peak: 1_200_000 }, '1M'), 100);
  assert.equal(ctxPct({ used: 175_000, peak: 175_000 }, '1M'), 18);
});

test('band, colour and text: green ≤ 60 < amber ≤ 85 < red; "context NN%", "context —" when none', () => {
  assert.deepEqual([0, 60, 61, 85, 86, 100].map(band), [0, 0, 1, 1, 2, 2]);
  assert.deepEqual([60, 61, 86, null].map(gaugeColor), ['#39d353', '#f2a33a', '#ff5d5d', '#8b93a7']);
  assert.deepEqual([gaugeText(41.6), gaugeText(null)], ['context 42%', 'context —']);
});

test('cornerSpots and visitPath: the box left of the foreman desk, its sign above it, the clock behind the foreman', () => {
  assert.deepEqual(cornerSpots(MIN), { box: { x0: 48, y0: 46, x1: 64, y1: 78 }, sign: { x: 56, y: 35 }, clock: { x0: 92, y0: 8, x1: 117, y1: 19 } });
  assert.deepEqual(cornerSpots(MIN, 2).sign, { x: 56, y: 27 });
  assert.deepEqual(visitPath(MIN), [{ x: 104, y: 66 }, { x: 73, y: 66 }, { x: 73, y: 78 }]);
  assert.equal(cornerSpots(BIG).box.x0, 88);   // 2560×1440: a 17-tile main office, F.x 144
  assert.ok(Math.abs(TOTAL - (2 * RISE + 2 * 43 / SPEED + WORK)) < 1e-6 && TOTAL < 4300);
});

test('cornerSpots: the box meets no desk, desk tag, chair, bin, plant, queue spot or walking route (1366, 1920, 2560 and the minimum)', () => {
  for (const l of LAYOUTS) {
    const { box } = cornerSpots(l), F = l.foreman.seat;
    const solid: Rect[] = [
      { x0: 20, y0: 36, x1: 36, y1: 52 },                                   // bin
      { x0: l.rooms.main.x1 - 32, y0: 40, x1: l.rooms.main.x1, y1: 88 },    // large plant
      { x0: F.x - 24, y0: F.y - 40, x1: F.x + 24, y1: l.foreman.y + 32 },  // foreman chair and desk
      ...l.desks.map(d => ({ x0: d.cx - 28, y0: d.y - 36, x1: d.cx + 28, y1: d.y + 54 })),   // desk, chair, a hot tag
      ...[0, 1, 2].map(k => sprite(queueSpot(k, l))),
    ];
    solid.forEach((r, i) => assert.ok(!meet(box, r), `${l.key}: the box meets #${i}`));
    const spots = [{ room: 'main' as const, pt: F, aisle: l.foreman.aisle }, ...l.desks.map(d => ({ room: d.room, pt: d.seat, aisle: d.aisle })),
      ...[0, 1, 2].map(k => ({ room: 'main' as const, pt: queueSpot(k, l), aisle: l.h - 16 }))];
    for (const s of spots) {
      const p = route(l, s, outside(l));
      p.slice(1).forEach((q, i) => {
        const a = p[i], seg = { x0: Math.min(a.x, q.x) - 8, y0: Math.min(a.y, q.y), x1: Math.max(a.x, q.x) + 8, y1: Math.max(a.y, q.y) };
        assert.ok(!meet(box, seg), `${l.key}: a route from ${s.pt.x},${s.pt.y} crosses the box`);
      });
    }
  }
});

test('visitPose: stands up, walks the path, types at the box facing it, walks back, sits down; nothing outside', () => {
  const at = (t: number) => visitPose(1000, path, 1000 + t);
  assert.equal(visitPose(1000, path, 999), null);
  assert.equal(at(TOTAL), null);
  assert.deepEqual(at(0), { pt: path[0], dir: 'down', pose: 'still', seated: 1 });
  assert.deepEqual(at(RISE / 2), { pt: path[0], dir: 'down', pose: 'still', seated: 0.5 });
  const out = at(RISE + 10 / SPEED)!;
  assert.deepEqual([out.pose, out.dir, out.pt.y, out.seated], ['walk', 'left', 66, 0]);
  assert.deepEqual(at(ARRIVE + 1000), { pt: path[2], dir: 'left', pose: 'type', seated: 0 });
  assert.deepEqual([at(ARRIVE + WORK + 5 / SPEED)!.pose, at(ARRIVE + WORK + 5 / SPEED)!.dir], ['walk', 'up']);
  assert.ok(at(TOTAL - 1)!.seated > 0.99);
  for (let t = 0; t < TOTAL; t += 7) {   // always on the path: axis-aligned, behind the desk, down to the box
    const p = at(t)!.pt;
    assert.ok(p.y === 66 ? p.x >= 73 && p.x <= 104 : p.x === 73 && p.y > 66 && p.y <= 78, `${t}: ${p.x},${p.y}`);
  }
});

test('seedGauge: the latest value at once, no visit; an empty gauge fills with a visit, even below 5 points', () => {
  assert.deepEqual(stepGauge(seedGauge(42), 42, true, path, 0), { value: 42, visit: null });
  const e = seedGauge(null);
  assert.deepEqual(stepGauge(e, null, true, path, 0), { value: null, visit: null });
  const r = stepGauge(e, 3, true, path, 20);
  assert.deepEqual([r.value, r.visit?.seated], [null, 1]);   // shown counts as 0 for the flow; the first value always goes
  frames(e, 3, true, 40, 20 + TOTAL);
  assert.deepEqual(stepGauge(e, 3, true, path, 20 + TOTAL + 20), { value: 3, visit: null });
});

test('stepGauge: under 5 points nothing happens; a calm change waits 2 min from the last visit\'s start', () => {
  const g = seedGauge(40);
  assert.equal(stepGauge(g, 44, true, path, 0).visit, null);
  assert.equal(stepGauge(g, 36, true, path, 0).visit, null);
  assert.ok(stepGauge(g, 45, true, path, 1000).visit);        // lastStart −∞ after a seed: the first change goes at once
  frames(g, 45, true, 1020, 1000 + TOTAL + 20);
  assert.equal(g.shown, 45);
  assert.equal(stepGauge(g, 52, true, path, 1000 + TOTAL + 40).visit, null);
  assert.equal(stepGauge(g, 52, true, path, 1000 + GAP_MS - 20).visit, null);
  assert.ok(stepGauge(g, 52, true, path, 1000 + GAP_MS).visit);
});

test('stepGauge: crossing 60 or 85 either way, or a drop of 20+ (a compact, or the 1M setting saved), goes at once', () => {
  const goes = (shown: number, target: number) => { const g = seedGauge(shown); g.lastStart = 0; return stepGauge(g, target, true, path, 1000).visit !== null; };
  for (const [a, b] of [[57, 62], [62, 57], [83, 88], [88, 83], [50, 50 - DROP], [88, 18]]) assert.ok(goes(a, b), `${a} → ${b}`);
  for (const [a, b] of [[50, 31], [70, 76], [20, 26]]) assert.ok(!goes(a, b), `${a} → ${b} waits`);
});

test('stepGauge: a waiting foreman does not go; it goes once the wait ends; a wait starting mid-visit lets the visit finish', () => {
  const g = seedGauge(20);
  assert.deepEqual(stepGauge(g, 70, false, path, 0), { value: 20, visit: null });
  assert.equal(frames(g, 70, false, 20, 60_000).visit, null);
  assert.ok(stepGauge(g, 70, true, path, 60_000).visit);
  assert.ok(frames(g, 70, false, 60_020, 60_000 + TOTAL).visit);   // waiting right after it left: still out
  assert.deepEqual(stepGauge(g, 70, false, path, 60_000 + TOTAL + 20), { value: 70, visit: null });
});

test('stepGauge: the target is read on arrival at the box; one coming later waits for the next check (urgent: right after)', () => {
  const g = seedGauge(20);
  assert.ok(stepGauge(g, 30, true, path, 0).visit);
  frames(g, 40, true, 20, ARRIVE + 40);           // changed on the way: this visit's
  frames(g, 90, true, ARRIVE + 40, TOTAL);        // after arrival: not this visit's
  const r = stepGauge(g, 90, true, path, TOTAL + 20);
  assert.deepEqual([r.value, r.visit?.seated], [40, 1]);   // 40 → 90 crosses both bands: the next visit starts at once
  const c = seedGauge(20);
  stepGauge(c, 30, true, path, 0);
  frames(c, 30, true, 20, ARRIVE + 40);
  frames(c, 36, true, ARRIVE + 40, GAP_MS);       // calm: waits the 2 min from this visit's start
  assert.equal(c.shown, 30);
  assert.ok(stepGauge(c, 36, true, path, GAP_MS).visit);
});

test('stepGauge: the value moves only while it types at the box, eased between 400 and 1800 ms of the work', () => {
  const g = seedGauge(20);
  stepGauge(g, 80, true, path, 0);
  const v = (t: number) => stepGauge(g, 80, true, path, t).value!;
  const seen = [ARRIVE - 1, ARRIVE + 1, ARRIVE + 400, ARRIVE + 1100, ARRIVE + 1800, TOTAL - 1].map(v);
  assert.deepEqual([seen[0], seen[1], seen[2]], [20, 20, 20]);
  assert.ok(Math.abs(seen[3] - 50) < 0.01, String(seen[3]));
  assert.deepEqual([seen[4], seen[5]], [80, 80]);
});

test('canVisit: only a foreman seated at its desk and not waiting goes; none on the floor, one walking in or a waiting one stays', () => {
  const at = (stage: 'running' | 'waiting' | null, seed: boolean) => {
    const as = stage ? [agent({ id: 'f', role: 'foreman', stage })] : [agent({ id: 'x' })];
    const sc = officeScene(as, 0, MIN), w = new Map<string, Walker>();
    syncWalkers(w, sc.places, MIN, seed, 0);
    return canVisit(sc, new Map(as.map(a => [a.id, a])), w);
  };
  assert.equal(at('running', true), true);
  assert.equal(at('running', false), false);   // walking in from the entrance
  assert.equal(at('waiting', true), false);
  assert.equal(at(null, true), false);         // no foreman on the floor
  assert.equal(canVisit(officeScene([agent({ id: 'f', role: 'foreman' })], 0, MIN), new Map(), new Map()), false);   // not placed yet
});

const SIZE: Record<string, { w: number; h: number }> = {   // web/public/pixel-agents PNG sizes
  BOOKSHELF: { w: 32, h: 16 }, WHITEBOARD: { w: 32, h: 32 }, SMALL_PAINTING: { w: 16, h: 32 }, LARGE_PAINTING: { w: 32, h: 32 },
  HANGING_PLANT: { w: 16, h: 32 }, DOUBLE_BOOKSHELF: { w: 32, h: 32 },
};
test('mainWallDecor: the minimum office shows the default wall; no piece comes within 2 px of the clock for a main office of 12–20 tiles', () => {
  // a window in the gap between the two paintings
  assert.deepEqual(mainWallDecor(MIN, n => SIZE[n]).map(p => [p.name, p.x]), [['BOOKSHELF', 24], ['WHITEBOARD', 56], ['LARGE_PAINTING', 120], ['SMALL_PAINTING', 176], ['win', 153]]);
  const mains = new Set<number>();
  for (let s = 1; s <= 2.5; s += 0.01) {
    const l = officeLayout(fit(Math.round(1114 * s), Math.round(589 * s))), c = cornerSpots(l).clock;
    const near = { x0: c.x0 - 2, y0: c.y0 - 2, x1: c.x1 + 2, y1: c.y1 + 2 };
    mains.add(l.widths.main);
    for (const p of mainWallDecor(l, n => SIZE[n])) {
      const r = p.name === 'win' ? { x0: p.x - 1, y0: 5, x1: p.x + 23, y1: 27 } : { x0: p.x, y0: p.y, x1: p.x + SIZE[p.name].w, y1: p.y + SIZE[p.name].h };
      assert.ok(!meet(r, near), `${l.key}: ${p.name} at ${p.x} touches the clock`);
      assert.ok(r.x1 <= l.rooms.main.x1, `${l.key}: ${p.name} at ${p.x} leaves the main office`);
    }
  }
  for (let m = 12; m <= 20; m++) assert.ok(mains.has(m), `no layout with a ${m}-tile main office`);
});

test('mainWallDecor: windows only in the gaps, never over another piece; every main office from the minimum up has one', () => {
  for (let s = 1; s <= 3.3; s += 0.01) {
    const l = officeLayout(fit(Math.round(1114 * s), Math.round(589 * s))), d = mainWallDecor(l, n => SIZE[n]);
    const box = (p: { name: string; x: number; y: number }) => p.name === 'win' ? { x0: p.x - 1, y0: 5, x1: p.x + 23, y1: 27 } : { x0: p.x, y0: p.y, x1: p.x + SIZE[p.name].w, y1: p.y + SIZE[p.name].h };
    assert.ok(d.some(p => p.name === 'win'), `${l.key}: no window`);
    for (const [i, a] of d.entries()) for (const b of d.slice(i + 1)) {
      if (a.name !== 'win' && b.name !== 'win') continue;   // the default wall's own pieces overlap (DOUBLE_BOOKSHELF and a plant)
      assert.ok(!meet(box(a), box(b)), `${l.key}: ${a.name}@${a.x} meets ${b.name}@${b.x}`);
    }
    for (const p of d.filter(p => p.name === 'win')) assert.ok(p.x - 1 >= l.rooms.main.x0, `${l.key}: window off the main office`);
  }
});

test('freeSpot: the first spot whose label box meets nothing, checked where the overlay keeps it; the first when none is free', () => {
  const spots = [{ x: 50, y: 10 }, { x: 150, y: 10 }, { x: 250, y: 10 }], at = (x: number): Rect => ({ x0: x - 5, y0: 12, x1: x + 5, y1: 14 });
  assert.equal(freeSpot(spots, 40, 8, [], 300, 100), 0);
  assert.equal(freeSpot(spots, 40, 8, [at(50)], 300, 100), 1);
  assert.equal(freeSpot(spots, 40, 8, [at(50), at(150)], 300, 100), 2);
  assert.equal(freeSpot(spots, 40, 8, [at(50), at(150), at(250)], 300, 100), 0);
  assert.equal(freeSpot(spots, 40, 8, [{ x0: 70, y0: 0, x1: 75, y1: 100 }], 300, 100), 0, 'boxes only touching');
  // one past the right edge is checked where keepInside puts it (x 280..300), meeting what stands there
  assert.equal(freeSpot([{ x: 310, y: 10 }, spots[1]], 40, 8, [{ x0: 285, y0: 0, x1: 290, y1: 100 }], 300, 100), 1);
});

test('freeSpot: the previous spot holds while it is free, though an earlier one has come free; once met, the first free one', () => {
  const spots = [{ x: 50, y: 10 }, { x: 150, y: 10 }, { x: 250, y: 10 }], at = (x: number): Rect => ({ x0: x - 5, y0: 12, x1: x + 5, y1: 14 });
  assert.equal(freeSpot(spots, 40, 8, [], 300, 100, 2), 2);
  assert.equal(freeSpot(spots, 40, 8, [at(250)], 300, 100, 2), 0);
  assert.equal(freeSpot(spots, 40, 8, [at(50), at(250)], 300, 100, 2), 1);
  assert.equal(freeSpot(spots, 40, 8, [at(50), at(150), at(250)], 300, 100, 2), 0, 'none free: the first');
  assert.equal(freeSpot(spots, 40, 8, [], 300, 100, 7), 0, 'a previous index past the list is ignored');
});
