import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentView } from '../../shared/types.ts';
import { armFire, BURN_MAX, crewX, FIRE, FIRE_COOLDOWN, FIRE_SOOT, fireAt, fireGeom, fireMemory, fireMet, fireTimes, hotCount, logFire, parseFireLog, serverRacks, SOOT_FADE, sootAt, stepFire, type FireGeom } from '../../web/src/logic/fire.ts';
import { failTimes, pathLen, teamSpeed } from '../../web/src/logic/fx.ts';
import { officeLayout, type Layout, type Pt } from '../../web/src/logic/layout.ts';
import { agent } from './fake.ts';

const MIN = 60_000, H = 3_600_000;
const hot = (id: string, min: number, o: Partial<AgentView> = {}) => agent({ id, startedAt: -min * MIN, stageSince: -min * MIN, ...o });

test('hotCount / fireMet: sub-agents 30+ minutes into their working stretch; five of them', () => {
  const five = [44, 39, 35, 32, 30].map((m, i) => hot('a' + i, m));
  assert.equal(hotCount(five, 0), 5);
  assert.ok(fireMet(five, 0));
  assert.ok(!fireMet(five.slice(0, 4), 0));
  assert.equal(hotCount([hot('x', 30)], -1000), 0, '29:59 is not 30');
  assert.equal(hotCount([hot('x', 29.99)], 0), 0);
  assert.equal(hotCount([hot('m', 60, { id: 'main', role: 'main' })], 0), 0, 'the main agent never counts');
  for (const stage of ['waiting', 'done', 'failed', 'abandoned'] as const) assert.equal(hotCount([hot('x', 40, { stage })], 0), 0, stage);
  // back from waiting 5 minutes ago: the stretch starts anew (stretchStart)
  assert.equal(hotCount([hot('x', 0, { startedAt: -40 * MIN, activeSince: -40 * MIN, stageSince: -5 * MIN })], 0), 0);
});

test('stepFire: fires when the condition forms while armed; never while it holds; again only after a break and 2 h', () => {
  const m = fireMemory();
  armFire(m, false);
  assert.equal(stepFire(m, false, 0), false);
  assert.equal(stepFire(m, true, 1000), true);
  assert.equal(m.last, 1000);
  assert.equal(stepFire(m, true, 2000), false, 'held: no second fire');
  assert.equal(stepFire(m, false, 3000), false);
  assert.equal(stepFire(m, true, 1000 + FIRE_COOLDOWN - 1), false, 'formed again within 2 h');
  assert.equal(stepFire(m, true, 1000 + 3 * H), false, 'that forming held past 2 h: still none');
  assert.equal(stepFire(m, false, 1000 + 3 * H + 1), false);
  assert.equal(stepFire(m, true, 1000 + 3 * H + 2), true, 'broke and formed again after 2 h');
});

test('armFire: a bind with the condition met never fires until it breaks; one unmet arms (load, tab return, floor change)', () => {
  const m = fireMemory();
  armFire(m, true);
  assert.equal(stepFire(m, true, 0), false);
  assert.equal(stepFire(m, false, 1), false);
  assert.equal(stepFire(m, true, 2), true);
  const n = fireMemory(5000);   // the last fire from the log
  armFire(n, false);
  assert.equal(stepFire(n, true, 5000 + FIRE_COOLDOWN - 1), false, 'the stored cooldown holds across a reload');
});

test('the fire log: bad JSON is empty, non-finite times drop, entries past the cooldown drop on a new fire', () => {
  for (const raw of [null, '', '{', '[]', '"x"', '3']) assert.deepEqual(parseFireLog(raw), {}, String(raw));
  assert.deepEqual(parseFireLog(JSON.stringify({ a: 5, b: 'x', c: null, d: 1e400 })), { a: 5 });
  assert.deepEqual(logFire({ old: 0, fresh: 2 * H - 10 }, 'new', 2 * H), { fresh: 2 * H - 10, new: 2 * H });
});

test('sootAt: full for 10 minutes after the fire, gone 3 s later; none without a fire', () => {
  assert.equal(sootAt(100, null), 0);
  assert.equal(sootAt(0, 100), 0);
  assert.equal(sootAt(100, 100), 1);
  assert.equal(sootAt(100 + FIRE_SOOT, 100), 1);
  assert.equal(sootAt(100 + FIRE_SOOT + SOOT_FADE / 2, 100), 0.5);
  assert.equal(sootAt(100 + FIRE_SOOT + SOOT_FADE, 100), 0);
});

const page = (vw: number, vh: number) => officeLayout({ w: vw - 220, h: vh - 44, dpr: 1, demand: 0, sb: 15, frame: true });
const L52 = page(1920, 945), L45 = page(2560, 1270);   // a 1920×1080 and a 2K screen
const GRIDS = (() => {   // decor.test.ts's sweep: 199 grids
  const m = new Map<string, Layout>();
  for (let w = 1088; w <= 3840; w += 48) for (let h = 576; h <= 2160; h += 48) for (const frame of [false, true]) {
    const l = officeLayout({ w, h, dpr: 1, demand: 0, sb: 0, frame }); if (!m.has(l.key)) m.set(l.key, l);
  }
  return [...m.values()];
})();

test('teamSpeed: the medics\' formula, unchanged (failTimes)', () => {
  for (const len of [0, 400, 1200, 1816]) assert.equal(failTimes(len).speed, teamSpeed(len));
});

test('fireGeom: the top min(3, n) racks burn, one firefighter each, the leader to the top one; on every grid', () => {
  let two = 0;
  for (const l of GRIDS) {
    const g = fireGeom(l), n = serverRacks(l).length;
    assert.ok(crewX(l) >= l.rooms.server.x0 + 28 && crewX(l) <= l.rooms.server.x0 + 34);
    assert.ok(n >= 2, l.key);
    if (n === 2) two++;
    assert.equal(g.burn.length, Math.min(BURN_MAX, n), l.key);
    assert.deepEqual(g.burn.map(r => r.i), g.burn.map((_, i) => i));
    assert.equal(g.crew.length, g.burn.length);
    g.crew.forEach((c, i) => {
      const end = c.path.at(-1)!;
      assert.deepEqual(end, { x: crewX(l), y: c.rack.y + 28 }, `${l.key} crew ${i}`);
      assert.ok(c.path.every((q, k) => k === 0 || q.x === c.path[k - 1].x || q.y === c.path[k - 1].y), 'axis-aligned');
      if (i) assert.ok(c.len < g.crew[i - 1].len, 'the leader walks farthest');
      assert.ok(end.x - 6 >= c.rack.x + 14, `${l.key}: its feet clear of the rack column`);
      for (const d of l.desks.filter(d => d.room === 'server')) assert.ok(end.x + 6 <= d.cx - 24 + 2, `${l.key}: its feet off desk ${d.cx}`);
    });
    assert.ok(g.ext && g.grab >= 0, l.key);
  }
  assert.equal(two, 27);
});

test('fireGeom: who takes the extinguisher: on the shared bottom line the last; at the top wall the leader', () => {
  const at = (l: Layout) => { const g = fireGeom(l); return `${l.key} ${g.grab}/${g.crew.length} ${g.sExt === g.crew[g.grab].len ? 'end' : 'way'}`; };
  assert.equal(at(L52), '52x27 2/3 way');
  assert.equal(at(L45), '45x24 0/3 end');
});

const times = (g: FireGeom) => fireTimes(g);
test('fireTimes: the brigade walks in at the medics\' speed, single file; the grabber stops 800 ms', () => {
  for (const l of [L52, L45]) {
    const g = fireGeom(l), ft = times(g), max = Math.max(...g.crew.map(c => c.len));
    assert.equal(ft.speed, teamSpeed(max));
    g.crew.forEach((c, i) => {
      const stops = l === L52 ? i === 2 : i === 0;
      assert.equal(ft.arrive[i], FIRE.walk + (c.len + i * FIRE.gap) / ft.speed + (stops ? FIRE.pick : 0), `${l.key} ${i}`);
      assert.equal(ft.out[i], ft.arrive[i] + FIRE.turn + FIRE.spray);
    });
    assert.equal(ft.leave, Math.max(...ft.out) + FIRE.tail + FIRE.leave);
    assert.ok(Math.abs(ft.end - ft.leave - (max + FIRE.exit) / ft.speed) < 1e-6);
    assert.ok(ft.arrive.every(a => a > 13_000 && a < 16_500), `${l.key}: ${ft.arrive}`);   // about 14.4–15.3 s
  }
  for (const l of GRIDS) { const ft = times(fireGeom(l)); assert.ok(ft.end < 40_000, `${l.key} ${ft.end}`); }
});

test('fireAt: smoke, then flame, the spray puts it out; soot stays; nothing after the end', () => {
  const g = fireGeom(L52), ft = times(g), at = (t: number) => fireAt(g, ft, t, false)!;
  assert.equal(fireAt(g, ft, -1, false), null);
  assert.equal(fireAt(g, ft, ft.end + FIRE.engineTail, false), null);
  const r0 = (t: number) => at(t).racks[0];
  assert.deepEqual([r0(0).flame, r0(600).smoke, r0(1200).smoke, r0(0).alarm], [0, 0.5, 1, true]);
  assert.equal(at(1600).racks[1].smoke > 0, true);
  assert.equal(at(1400).racks[1].smoke, 0, 'the second rack starts 1.5 s later');
  assert.deepEqual([r0(3400).flame, r0(3800).flame, at(3000).alarm, at(2999).alarm], [0.5, 1, true, false]);
  const mid = (ft.spray[0] + ft.out[0]) / 2;
  assert.ok(Math.abs(r0(mid).flame - 0.5) < 1e-9);
  assert.deepEqual([r0(ft.out[0]).flame, r0(ft.out[0]).soot, r0(ft.out[0] + FIRE.smokeOut).smoke], [0, 1, 0]);
  assert.equal(r0(ft.out[0] + FIRE.alarmTail).alarm, false);
  assert.deepEqual([at(5999).engine, at(6000).engine, at(ft.end + FIRE.engineTail - 1).engine], [false, true, true]);
});

test('fireAt: the crew walks in single file, the grabber picks the extinguisher up and puts it back in passing', () => {
  const g = fireGeom(L52), ft = times(g), at = (t: number) => fireAt(g, ft, t, false)!;
  assert.equal(at(FIRE.walk - 1).crew.length, 0);
  const t1 = FIRE.walk + 2000, c = at(t1).crew;
  assert.equal(c.length, 3);
  const dist = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  assert.ok(Math.abs(dist(c[0].pt, c[1].pt) - FIRE.gap) < 1e-6 && c.every(x => x.moving));
  const reach = FIRE.walk + (g.sExt + 2 * FIRE.gap) / ft.speed;   // the grabber at the extinguisher
  const p = at(reach + FIRE.pick / 4).crew[2];
  assert.deepEqual([p.moving, p.ext, at(reach + FIRE.pick / 4).extTaken], [false, false, false]);
  assert.deepEqual([at(reach + FIRE.pick * 0.75).crew[2].ext, at(reach + FIRE.pick * 0.75).extTaken], [true, true]);
  const sp = at(ft.spray[2] + 10).crew[2];
  assert.deepEqual([sp.moving, sp.spraying, sp.dir, sp.ext], [false, true, 'left', true]);
  assert.deepEqual(sp.pt, g.crew[2].path.at(-1));
  const back = (s: number) => ft.leave + (g.crew[2].len - s) / ft.speed;
  assert.equal(at(back(g.sExt) - 50).extTaken, true);
  assert.equal(at(back(g.sExt) + 50).extTaken, false);
  assert.equal(at(ft.end - 1).crew.length > 0, true);
  assert.equal(at(ft.end).crew.length, 0);
});

test('fireAt calm: thirds of a flame, the crew only stands at its racks', () => {
  const g = fireGeom(L52), ft = times(g), at = (t: number) => fireAt(g, ft, t, true)!;
  for (let t = 0; t < ft.end; t += 97) for (const r of at(t).racks) assert.ok([0, 1 / 3, 2 / 3, 1].some(v => Math.abs(v - r.flame) < 1e-9), `${t}: ${r.flame}`);
  g.crew.forEach((_, i) => assert.ok(!at(ft.arrive[i] - 1).crew.some(c => c.i === i), `crew ${i} appears on arrival`));
  const c = at(ft.arrive[0] + 1).crew.find(c => c.i === 0)!;
  assert.deepEqual([c.moving, c.pt], [false, g.crew[0].path.at(-1)]);
  assert.equal(at(ft.leave).crew.length, 0);
});

test('fireGeom is cheap enough to build once per grid', () => {
  const t0 = performance.now();
  for (const l of GRIDS.slice(0, 20)) fireGeom(l);
  assert.ok((performance.now() - t0) / 20 < 50);
  assert.ok(pathLen(fireGeom(L52).crew[0].path) > 0);
});
