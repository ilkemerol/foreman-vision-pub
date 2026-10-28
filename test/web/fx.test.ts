import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentView } from '../../shared/types.ts';
import { DESK_LIGHT, failFx, failTimes, flameCols, glowHalf, medicAt, medicPath, medicPts, overworkMin, pathLen, pointAt, smokeLevel } from '../../web/src/logic/fx.ts';
import { officeLayout, type Fit, type Pt } from '../../web/src/logic/layout.ts';
import { SPEED, syncWalkers, type Walker } from '../../web/src/logic/motion.ts';
import { FAIL_RELEASE_MS, officeScene } from '../../web/src/logic/scene.ts';
import { agent } from './fake.ts';

const fit = (w: number, h: number, o: Partial<Fit> = {}): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0, ...o });
const MIN = officeLayout(fit(1114, 589)), BIG = officeLayout(fit(2308, 1372));   // 34×18 and 47×25
const axisAligned = (p: Pt[]) => p.every((q, i) => i === 0 || q.x === p[i - 1].x || q.y === p[i - 1].y);

const MINUTE = 60_000;
test('overworkMin: sub-agents past 10 minutes while working; never main, never after work', () => {
  const at = (o: Partial<AgentView>) => overworkMin(agent({ startedAt: 0, stageSince: 0, ...o }), 12 * MINUTE + 5000);
  assert.equal(at({}), 12);
  assert.equal(overworkMin(agent({ startedAt: 0, stageSince: 0 }), 10 * MINUTE - 1), null);
  assert.equal(overworkMin(agent({ startedAt: 0, stageSince: 0 }), 10 * MINUTE), 10);
  assert.equal(at({ stage: 'verifying' }), 12);
  assert.equal(at({ stage: 'spawning' }), 12);
  for (const stage of ['waiting', 'done', 'failed', 'abandoned'] as const) assert.equal(at({ stage }), null, stage);
  assert.equal(at({ id: 'main', role: 'foreman' }), null);
  assert.equal(at({ id: 'main', role: 'main' }), null);
  assert.equal(at({ role: 'placeholder' }), null);
});
test('overworkMin: counts the current working stretch, not the whole life (resumed agent showed 🔥 28 dk at once)', () => {
  // the live snapshot: resumed via SendMessage 27.8 min after its start, first sight of the resume
  const T0 = 1792989018768, resumed = agent({
    stage: 'running', startedAt: T0, endedAt: null, activeSince: 1792990685524, stageSince: 1792990685925,
    breaks: [[1792990142433, 1792990142433], [1792990420290, 1792990685524]],
  });
  assert.equal(overworkMin(resumed, 1792990685925 + MINUTE), null);
  assert.equal(overworkMin(resumed, 1792990685925 + 11 * MINUTE), 11);
  // a server restart: stageSince falls back to startedAt, activeSince survives
  assert.equal(overworkMin({ ...resumed, stageSince: T0 }, 1792990685925 + MINUTE), null);
  // back from the waiting room (board waiting → running): stageSince moves, activeSince does not
  assert.equal(overworkMin(agent({ startedAt: 0, activeSince: 0, stageSince: 20 * MINUTE }), 22 * MINUTE), null);
  // resumed, stopped again and under the master's check: the stretch began at the resume
  assert.equal(overworkMin(agent({ stage: 'verifying', startedAt: 0, activeSince: 27 * MINUTE, endedAt: 28 * MINUTE,
    stageSince: 28 * MINUTE, breaks: [[5 * MINUTE, 27 * MINUTE]] }), 29 * MINUTE), null);
  // stopped under the master's check after a 12-minute stretch: the flame stays, its count stops at the stop (as the hover)
  const stopped = agent({ stage: 'verifying', startedAt: 0, activeSince: 0, endedAt: 12 * MINUTE, stageSince: 12 * MINUTE });
  assert.equal(overworkMin(stopped, 13 * MINUTE), 12);
  assert.equal(overworkMin(stopped, 40 * MINUTE), 12);
  assert.equal(overworkMin({ ...stopped, endedAt: 9 * MINUTE }, 40 * MINUTE), null);
  // never resumed: the stretch is the whole life
  assert.equal(overworkMin(agent({ startedAt: 0, activeSince: 2000, stageSince: 0 }), 15 * MINUTE), 14);
  assert.equal(overworkMin(agent({ stage: 'spawning', startedAt: 0 }), 15 * MINUTE), 15);
});
test('glowHalf: the light ellipse in 2 px steps — rows in pairs, even half widths, narrowing outward, none past b', () => {
  for (const [a, b] of [[29, 14], [30, 15], [21, 10], [12, 6], [12, 7]]) {
    const ws = Array.from({ length: 2 * b + 1 }, (_, i) => glowHalf(a, b, i - b));
    assert.ok(ws.every(w => Number.isInteger(w) && w % 2 === 0 && w >= 0), `${a}×${b}: ${ws}`);
    for (let y = 1; y <= b; y++) assert.ok(glowHalf(a, b, y) <= glowHalf(a, b, y - 1), `${a}×${b} narrows at ${y}`);
    for (let y = -1; y + 1 <= b; y += 2) assert.equal(glowHalf(a, b, y), glowHalf(a, b, y + 1), `${a}×${b} pairs ${y}, ${y + 1}`);
    assert.equal(glowHalf(a, b, 0), Math.round(a / 2) * 2);
  }
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(y => glowHalf(12, 7, y)), [12, 12, 12, 10, 10, 6, 6, 0]);
});
test('flameCols: five pointed tongues, layers nested inside, inner layers off the row ends', () => {
  const fr = [8, 12, 16, 11, 7];
  for (const [n, hk] of [[15, 1.2], [13, 0.8]]) {
    const cols = flameCols(fr, n, hk);
    assert.equal(cols.length, n);
    for (const c of cols) for (let L = 1; L < 4; L++) assert.ok(c[L] <= c[L - 1], `${n}: ${c}`);
    assert.ok(cols.every(c => c.every(h => Number.isInteger(h) && h >= 0)));
    assert.deepEqual([cols[0][2], cols[n - 1][2], cols[2][3], cols[n - 3][3]], [0, 0, 0, 0]);
    const tallest = cols.reduce((m, c, u) => (c[0] > cols[m][0] ? u : m), 0);
    assert.equal(Math.min(4, Math.floor(tallest * 5 / n)), 2);   // the 16 px tongue
    assert.ok(Math.abs(cols[tallest][0] - 16 * hk) <= 1, `peak ${cols[tallest][0]}`);   // its tip
  }
});
test('DESK_LIGHT: three bands, nested, round the monitor and inside the desk top', () => {
  assert.equal(DESK_LIGHT.length, 3);
  DESK_LIGHT.forEach(([x0, x1, y0, y1], i) => {
    assert.ok(x0 >= -1 && x1 <= 1 && y0 >= -0.45 && y1 <= 0.45);
    assert.ok(x0 <= -0.4 && x1 >= 0.4 && y0 <= -0.36 && y1 >= -0.24);
    if (i) { const [a0, a1, , b1] = DESK_LIGHT[i - 1]; assert.ok(x0 >= a0 && x1 <= a1 && y1 <= b1); }
  });
});
test('failTimes: smoke → stand → faint → medics ~2 s later, all inside FAIL_RELEASE_MS', () => {
  for (const len of [100, 300, 800, 3000]) {
    const f = failTimes(len);
    assert.ok(f.stand < f.fall && f.medStart === f.fall + 2000 && f.arrive < f.leave && f.leave < f.end);
    assert.ok(f.end <= FAIL_RELEASE_MS - 500, `len ${len}`);   // budget 13 500 ms of walking ends at 19 200
    assert.ok(f.speed >= SPEED);
  }
  assert.equal(failTimes(100).speed, SPEED);
});
test('smokeLevel: ramps in, holds, fades out', () => {
  const f = failTimes(300);
  assert.equal(smokeLevel(-1, f), 0);
  assert.equal(smokeLevel(500, f), 0.5);
  assert.equal(smokeLevel(5000, f), 1);
  assert.equal(smokeLevel(f.smokeEnd, f), 0);
});
test('medicPath: a main desk — in at the Entrance, up the main lane, along its aisle', () => {
  const p = medicPath(MIN.desks[2], MIN);   // seat (168, 170), aisle 182
  assert.deepEqual(p, [{ x: -10, y: 272 }, { x: 200, y: 272 }, { x: 200, y: 182 }, { x: 154, y: 182 }]);
  assert.equal(pathLen(p), 346);
});
test('medicPath: every desk of the largest layout — through the corridor and the room door, and the sequence ends inside FAIL_RELEASE_MS', () => {
  for (const d of BIG.desks) {
    const p = medicPath(d, BIG);
    assert.deepEqual(p[0], { x: -10, y: BIG.h - 16 });
    assert.ok(axisAligned(p));
    if (d.room !== 'main') assert.ok(p.some(q => q.y === BIG.hallY) && p.some(q => q.x === BIG.lane[d.room]));
    assert.ok(failTimes(pathLen(p)).end <= FAIL_RELEASE_MS - 500);
  }
});
test('pointAt: walks the path by length, straight on past either end', () => {
  const p = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -20 }];
  assert.deepEqual(pointAt(p, 5), { x: 5, y: 0 });
  assert.deepEqual(pointAt(p, 15), { x: 10, y: -5 });
  assert.deepEqual(pointAt(p, -7), { x: -7, y: 0 });
  assert.deepEqual(pointAt(p, 34), { x: 10, y: -24 });
});
test('medicAt: in along the path, a LOAD at the desk, back out 60 px past the start; null outside', () => {
  const len = 300, f = failTimes(len);
  assert.equal(medicAt(f.medStart - 1, f, len), null);
  assert.equal(medicAt(f.medStart, f, len), 0);
  assert.equal(medicAt(f.arrive, f, len), len);
  assert.equal(medicAt(f.leave - 1, f, len), len);
  assert.ok(Math.abs(medicAt(f.end - 1, f, len)! + 60) < 1);
  assert.equal(medicAt(f.end, f, len), null);
});
test('failFx/medicPts: only a fail place with a started sequence; two medics 40 px apart while in', () => {
  const sc = officeScene([agent({ id: 'f', stage: 'failed', stageSince: 0 }), agent({ id: 'r', startedAt: 2000 }), agent({ id: 'g', stage: 'failed', stageSince: 0, startedAt: 3000 })], 0, MIN);
  const walkers = new Map<string, Walker>();
  syncWalkers(walkers, officeScene([agent({ id: 'f' }), agent({ id: 'r', startedAt: 2000 })], 0, MIN).places, sc.layout, true, 0);
  syncWalkers(walkers, sc.places, sc.layout, false, 100);   // 'g' failed before it was ever seen: no walker, no sequence
  const at = (now: number) => failFx(sc, walkers, now);
  assert.deepEqual([...at(100).keys()], ['f']);
  const x = at(100 + at(100).get('f')!.f.leave - 1).get('f')!;
  assert.deepEqual(x.desk, sc.layout.desks[sc.places.get('f')!.desk!]);
  const [a, b] = medicPts(x);
  assert.deepEqual([a, b], [pointAt(x.path, x.len + 20), pointAt(x.path, x.len - 20)]);
  assert.deepEqual(medicPts(at(100).get('f')!), []);
});
