import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coffeeRooms, coffeeState, renameCoffee, REST, stepCoffee, stepRooms, STAY, tripAt, tripGap, tripMs, tripPath, type Lounger, type Trip } from '../../web/src/logic/coffee.ts';
import { CAFE_DX, doneSeats, officeLayout, WAIT_FULL, waitBalloonBoxes, waitSpots, type Fit, type Pt, type Rect } from '../../web/src/logic/layout.ts';
import { advanceWalkers, SPEED, syncWalkers, type Walker } from '../../web/src/logic/motion.ts';
import { officeScene } from '../../web/src/logic/scene.ts';
import { agent } from './fake.ts';

const fit = (w: number, h: number): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0 });
const LAYOUTS = [fit(1114, 589), fit(1146, 613), fit(1028, 714), fit(2308, 1372)].map(f => officeLayout(f));   // 34×18, 35×19, 34×22, 47×25
const l = LAYOUTS[0], BIG = LAYOUTS[3], TICK = 40, GAP0 = 180_000, GAP1 = 240_000;
const inside = (p: Pt, r: Rect) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
const axisAligned = (p: Pt[]) => p.every((q, i) => i === 0 || q.x === p[i - 1].x || q.y === p[i - 1].y);
const sprite = (p: Pt): Rect => ({ x0: p.x - 8, y0: p.y - 32, x1: p.x + 8, y1: p.y });
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** One room's scheduler from a reset at 0 to `ms` in TICK steps. Every tick: whoever is out rested first and is in a
 *  valid trip state, and nobody's drawn point moves more than a walk step (no pop, back exactly home). The first trip
 *  starts 180–240 s after the reset, every next one 180–240 s after the last one ended (one tick late at most). One
 *  `out` per state: at most one out per room by construction. Returns the trips in order. */
function run(room: Lounger[], table: Pt, ms: number): { id: string; start: number; end: number }[] {
  const s = coffeeState('wait'), trips: { id: string; start: number; end: number }[] = [], last = new Map(room.map(r => [r.id, r.home]));
  for (let now = 0; now < ms; now += TICK) {
    const prev = s.out;
    assert.equal(stepCoffee(s, room, table, now), null);
    if (s.out && s.out !== prev) {
      const gap = now - (trips.length ? trips[trips.length - 1].end : 0);
      assert.ok(gap >= GAP0 && gap < GAP1 + TICK, `${s.out.id} goes ${gap} ms after the last trip`);
      trips.push({ id: s.out.id, start: now, end: now + tripMs(s.out.path) });
    }
    for (const r of room) {
      const t = s.out?.id === r.id ? tripAt(s.out, now) : null, pt = t?.pt ?? r.home, q = last.get(r.id)!;
      if (t) assert.ok(now >= r.since + REST && (t.stay === null ? t.moving : !t.moving && t.stay < STAY), `${r.id} at ${now}`);
      assert.ok(Math.abs(pt.x - q.x) + Math.abs(pt.y - q.y) <= SPEED * TICK + 1e-6, `${r.id} jumps at ${now}`);
      last.set(r.id, pt);
    }
  }
  return trips;
}

test('tripGap: 180–240 s, fixed per room and trip, the rooms out of step', () => {
  for (const room of ['wait', 'done']) for (let n = 0; n < 20; n++) { const g = tripGap(room, n); assert.ok(g >= GAP0 && g < GAP1 && g === tripGap(room, n)); }
  assert.notEqual(tripGap('wait', 0), tripGap('done', 0));
});
test('tripPath: axis-aligned, inside the room, ends beside the coffee table — every layout', () => {
  for (const L of LAYOUTS) for (const [home, room, table] of [...waitSpots(6, L).map(p => [p, L.rooms.wait, L.stations.wait] as const), ...doneSeats(L).map(p => [p, L.rooms.done, L.stations.done] as const)]) {
    const p = tripPath(home, table), end = p[p.length - 1];
    assert.ok(axisAligned(p));
    assert.ok(p.every(q => inside(q, room)), `${L.key} ${home.x},${home.y}`);
    assert.ok(Math.abs(end.x - (table.x + 16)) <= 32 && Math.abs(end.y - (table.y + 16)) <= 24);
  }
});
test('stepCoffee: one out at a time, 3–4 min apart; nobody leaves before it rested; no jumps; everyone goes and comes back home', () => {
  const pts = waitSpots(3, l), room = ['a-hook', 'a-config', 'board:9'].map((id, i) => ({ id, home: pts[i], since: i === 2 ? 200_000 : -Infinity }));
  const trips = run(room, l.stations.wait, 4 * 250_000);
  for (const r of room) assert.ok(trips.some(t => t.id === r.id), `${r.id} never went`);
});
test('stepCoffee: nobody starves — 6 in the Waiting room, 12 in the Done lounge, small and big office: everyone goes in turn', () => {
  for (const L of [l, BIG]) for (const [pts, table] of [[waitSpots(6, L), L.stations.wait], [doneSeats(L), L.stations.done]] as const) {
    const room = pts.map((home, i) => ({ id: `agent-${i}`, home, since: -Infinity })), n = room.length;
    const trips = run(room, table, (n + 1) * (GAP1 + 10_000));
    assert.equal(new Set(trips.slice(0, n).map(t => t.id)).size, n, `${L.key} ${n}: ${trips.map(t => t.id)}`);
  }
});
test('stepRooms: after a reset nobody goes for coffee for 180 s', () => {
  const sc = officeScene([agent({ id: 'w', stage: 'waiting' }), agent({ id: 'd', stage: 'done' })], 0, l), w = new Map<string, Walker>(), r = coffeeRooms();
  syncWalkers(w, sc.places, l, true, 50_000);
  for (let now = 50_000; now < 50_000 + GAP0; now += TICK) assert.equal(stepRooms(r, sc.places, w, l, now).size, 0);
  assert.deepEqual([r.wait.out, r.done.out], [null, null]);
});
test('stepRooms: one at a Done lounge café table walks to the coffee along the line in front of its table, not through it', () => {
  const sc = officeScene([agent({ id: 'd5', stage: 'done', stageSince: 5 })], 10, l), w = new Map<string, Walker>(), r = coffeeRooms();
  const chair = sc.places.get('d5')!.spot;
  assert.deepEqual(chair.pt, { x: l.cafes[0].x - CAFE_DX, y: l.cafes[0].y });
  syncWalkers(w, new Map([['d5', sc.places.get('d5')!]]), l, true, 0);
  let now = 0;
  while (!r.done.out) stepRooms(r, new Map([['d5', sc.places.get('d5')!]]), w, l, now += TICK);
  assert.deepEqual(r.done.out.path, tripPath(chair.pt, l.stations.done, chair.aisle));
  // the grid's first table stands under the coffee table's line: along its line to the coffee table's front left
  assert.deepEqual(r.done.out.path.slice(0, 3), [chair.pt, { x: chair.pt.x, y: chair.pt.y + 10 }, { x: l.stations.done.x - 10, y: chair.pt.y + 10 }]);
});
test('stepRooms: a member that leaves mid-trip walks on from where it was drawn, no pop home', () => {
  const sc = officeScene([agent({ id: 'w', stage: 'waiting' })], 0, l), w = new Map<string, Walker>(), r = coffeeRooms();
  syncWalkers(w, sc.places, l, true, 0);
  let now = 0;
  while (!r.wait.out) stepRooms(r, sc.places, w, l, now += TICK);
  now += 600;   // well on its way to the table
  const t: Trip = stepRooms(r, sc.places, w, l, now).get('w')!, home = w.get('w')!.pt;
  assert.ok(t.moving && (t.pt.x !== home.x || t.pt.y !== home.y));
  const work = officeScene([agent({ id: 'w' })], 0, l);   // back to work
  syncWalkers(w, work.places, l, false, now);
  assert.equal(stepRooms(r, work.places, w, l, now).has('w'), false);
  const x = w.get('w')!;
  assert.deepEqual([r.wait.out, x.pt, x.moving], [null, t.pt, true]);
  assert.ok(axisAligned([x.pt, ...x.path]) && x.path.some(p => p.x === home.x && p.y === home.y));
});
test('waitBalloonBoxes: a waiter out for coffee has no balloon the whole trip, the ones home keep theirs; one still in the corridor has none', () => {
  const pts = waitSpots(3, l), room = pts.map((home, i) => ({ id: `w-${i}`, home, since: -Infinity })), s = coffeeState('wait');
  let now = 0;
  while (!s.out) stepCoffee(s, room, l.stations.wait, now += TICK);
  for (const o = s.out, end = o.start + tripMs(o.path); now < end; now += TICK) {
    const { boxes } = waitBalloonBoxes(room.map(r => ({ id: r.id, home: r.home, at: r.id === o.id ? tripAt(o, now).pt : r.home, out: r.id === o.id })), l, 1, []);
    for (const r of room) assert.equal(!!boxes.get(r.id), r.id !== o.id, `${r.id} at ${now}`);
  }
  assert.equal(waitBalloonBoxes([{ id: 'x', home: pts[0], at: { x: l.lane.wait, y: l.hallY } }], l, 1, []).boxes.has('x'), false);
});
test('waitBalloonBoxes: waiters re-spotting inside the Waiting room (one left; a coffee trip cut short) keep their balloons, never over an agent, nor over the one walking out', () => {
  const ag = (id: string, since: number) => agent({ id, label: id, stage: 'waiting', stageSince: since, reasons: [{ kind: 'note', text: 'needs-info: which file?' }] });
  const L48 = officeLayout(fit(2340, 1396)), many = (n: number) => Array.from({ length: n }, (_, i) => ag(`w-${i}`, 8000 + i * 1000));
  // [layout, waiters, the one going back to work]: the oldest (the others re-spot), or the newest on a big office (compact)
  const cases = [[l, [ag('a-hook', 8000), ag('a-config', 12_000), ag('decision', 12_000)], 'a-hook'], [BIG, many(5), 'w-4'], [BIG, many(6), 'w-5'], [L48, many(5), 'w-4'], [L48, many(6), 'w-5']] as const;
  for (const [L, all, gone] of cases) {
    const w = new Map<string, Walker>(), r = coffeeRooms();
    const before = officeScene([...all], 0, L), after = officeScene(all.map(a => a.id === gone ? agent({ id: gone }) : a), 0, L);
    syncWalkers(w, before.places, L, true, 0);
    let now = 0;
    while (!r.wait.out || r.wait.out.id === gone) stepRooms(r, before.places, w, L, now += TICK);   // someone staying is out for coffee
    syncWalkers(w, after.places, L, false, now += 600);   // `gone` goes back to work and walks out; with the oldest gone the others re-spot
    assert.ok(w.get(gone)!.moving);
    for (let walked = 0; [...after.places.keys()].some(id => w.get(id)!.moving); now += TICK, walked++) {
      const trips = stepRooms(r, after.places, w, L, now);
      advanceWalkers(w, TICK, now);
      const at = (id: string) => trips.get(id)?.pt ?? w.get(id)!.pt, agents = [...after.places.keys()].map(at);
      const waiters = [...after.places].filter(([, p]) => p.kind === 'wait').map(([id, p]) => ({ id, home: p.spot.pt, at: at(id), out: trips.has(id) }));
      const { boxes } = waitBalloonBoxes(waiters, L, 1, agents);
      for (const x of waiters) {
        const b = boxes.get(x.id);
        if (waiters.length <= WAIT_FULL || boxes.has(x.id)) assert.ok(b, `${L.key} ${x.id} loses its balloon at ${x.at.x},${x.at.y}`);
        if (b) for (const id of after.places.keys()) assert.ok(!meet(b, sprite(at(id))), `${L.key} ${x.id}'s balloon covers ${id} at ${at(id).x},${at(id).y}`);
      }
      assert.ok(walked < 1000);
    }
  }
});
test('renameCoffee: a pending → bound hand-over keeps the room schedule and the trip under way', () => {
  const s = coffeeState('wait'), home = waitSpots(1, l)[0], table = l.stations.wait;
  stepCoffee(s, [{ id: 'pending:T2', home, since: -Infinity }], table, 0);
  const next = s.next!;
  stepCoffee(s, [{ id: 'pending:T2', home, since: -Infinity }], table, next);
  const start = s.out!.start;
  renameCoffee(s, 'pending:T2', 'A2');
  assert.equal(stepCoffee(s, [{ id: 'A2', home, since: -Infinity }], table, next + 500), null);
  assert.deepEqual([s.out?.id, s.out?.start, s.due.has('pending:T2')], ['A2', start, false]);
});
