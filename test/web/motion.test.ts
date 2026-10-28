import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathLen, pointAt } from '../../web/src/logic/fx.ts';
import { doneAisle, doneSeats, officeLayout, queueSpot, waitSpots, type Fit, type Pt } from '../../web/src/logic/layout.ts';
import { coffeeRooms, stepRooms, tripGap } from '../../web/src/logic/coffee.ts';
import { DECOR, decorKeepOut, placeDecor, walkBlocks } from '../../web/src/logic/decor.ts';
import { advanceWalkers, AWAY_MS, awayGap, type DoorState, frameOf, nearDoor, outside, route, standIndex, stepBurns, stepDoor, syncWalkers, walksAt, type Walker } from '../../web/src/logic/motion.ts';
import { officeScene, type Place, type Spot } from '../../web/src/logic/scene.ts';
import { agent } from './fake.ts';

const fit = (w: number, h: number, o: Partial<Fit> = {}): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0, ...o });
const MIN = officeLayout(fit(1114, 589)), BIG = officeLayout(fit(2308, 1372));   // 34×18 and 47×25
const l = MIN;
const desk = (i: number): Spot => ({ room: MIN.desks[i].room, pt: MIN.desks[i].seat, aisle: MIN.desks[i].aisle });
const axisAligned = (p: Pt[]) => p.every((q, i) => i === 0 || q.x === p[i - 1].x || q.y === p[i - 1].y);

test('route: a main desk from the entrance walks the bottom aisle, the main lane, its own aisle', () => {
  assert.deepEqual(route(MIN, outside(MIN), { room: 'main', pt: { x: 154, y: 182 }, aisle: 182 }), [{ x: -10, y: 272 }, { x: 200, y: 272 }, { x: 200, y: 182 }, { x: 154, y: 182 }]);
});
test('route: Server room desk → Waiting room leaves by its door, takes the corridor, enters by the Waiting room door', () => {
  const server0 = MIN.desks.find(d => d.room === 'server')!;   // seat (280, 94)
  assert.deepEqual(route(MIN, { room: 'server', pt: server0.seat, aisle: server0.aisle }, { room: 'wait', pt: { x: 268, y: 212 }, aisle: 212 }),
    [{ x: 280, y: 94 }, { x: 376, y: 94 }, { x: 376, y: 144 }, { x: 360, y: 144 }, { x: 360, y: 212 }, { x: 268, y: 212 }]);
});
test('route: every path is axis-aligned and steps on no wall tile, in the smallest and the largest office', () => {
  for (const l of [MIN, BIG]) {
    const w = waitSpots(6, l), d = doneSeats(l);
    const spots: Spot[] = [outside(l), { room: 'main', pt: queueSpot(1, l), aisle: l.h - 16 }, ...l.desks.map(k => ({ room: k.room, pt: k.seat, aisle: k.aisle })),
      ...w.map(pt => ({ room: 'wait' as const, pt, aisle: pt.y })), ...d.map(pt => ({ room: 'done' as const, pt, aisle: pt.y }))];
    for (const a of spots) for (const b of spots) {
      const p = route(l, a, b);
      assert.ok(axisAligned(p));
      for (let s = 0; s <= pathLen(p); s += 2) { const q = pointAt(p, s); assert.ok(!l.walls.has(`${Math.floor(q.x / 16)},${Math.floor(q.y / 16)}`), `${l.key} ${q.x},${q.y}`); }
    }
  }
});
// route variety: 34×18, 35×19, 42×23, 47×25, 74×39
const GRIDS = [fit(1114, 589), fit(1146, 613), fit(1344, 736), fit(2308, 1372), fit(3600, 2000)].map(f => officeLayout(f));
const spotsOf = (l: typeof MIN): Spot[] => [outside(l), ...l.desks.map(k => ({ room: k.room, pt: k.seat, aisle: k.aisle })),
  ...waitSpots(6, l).map(pt => ({ room: 'wait' as const, pt, aisle: pt.y })), ...doneSeats(l).map(pt => ({ room: 'done' as const, pt, aisle: doneAisle(l, pt) }))];
test('route: a varied walk differs between agents from one desk to one Waiting room spot, and is the same for the same agent and ends', () => {
  const vary = (seed: string) => ({ seed, blocks: walkBlocks(MIN) }), to: Spot = { room: 'wait', pt: waitSpots(1, MIN)[0], aisle: waitSpots(1, MIN)[0].y };
  const ways = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(k => JSON.stringify(route(MIN, desk(0), to, vary(k))));
  assert.ok(new Set(ways).size >= 3, `${new Set(ways).size} routes`);
  assert.deepEqual(route(MIN, desk(0), to, vary('a')), route(MIN, desk(0), to, vary('a')));
  assert.notDeepEqual(route(MIN, desk(0), to, vary('a')), route(MIN, desk(0), to));
});
test('route: in a room of several desk rows varied walks reach the door column along other rows\' aisles, turning left and right of the desk columns', () => {
  const l = GRIDS[3], blocks = walkBlocks(l), main = l.desks.filter(d => d.room === 'main'), row0 = main.filter(d => d.y === main[0].y);
  assert.equal(l.key, '47x25');
  const d = row0[Math.floor(row0.length / 2)], from: Spot = { room: 'main', pt: d.seat, aisle: d.aisle }, w = waitSpots(1, l)[0], to: Spot = { room: 'wait', pt: w, aisle: w.y };
  const aisles = [l.foreman.aisle, ...new Set(main.map(k => k.aisle))], rows = new Set<number>(), sides = new Set<number>();
  for (let k = 0; k < 40; k++) {
    const p = route(l, from, to, { seed: `a@${k}`, blocks }), y = p.find(q => q.x === l.lane.main)!.y;
    rows.add(aisles.findIndex(a => y >= a && y <= a + 16));
    for (const q of p.slice(2)) if (q.x !== d.seat.x && q.x !== l.lane.main && q.y !== l.hallY && q.x < l.rooms.main.x1) sides.add(Math.sign(q.x - d.seat.x));
  }
  assert.ok(rows.size >= 2 && !rows.has(-1), `rows ${[...rows]}`);
  assert.deepEqual([...sides].sort(), [-1, 1]);
});
test('route: every varied walk stays on the floor, off walls, furniture and standing decor, its paid walker standing where the base one does, at most 1.6 times the base route, at the 5 standard grids', () => {
  for (const l of GRIDS) {
    const blocks = walkBlocks(l), solid = [...decorKeepOut(l).filter(k => k.why === 'furniture'), ...placeDecor(l).filter(p => !DECOR[p.name].floor)], spots = spotsOf(l);
    let varied = 0, n = 0;
    for (const a of spots) for (const b of spots) {
      if (a === b) continue;
      const seed = `s${n++}`;
      const p = route(l, a, b, { seed, blocks }), base = route(l, a, b);
      assert.ok(axisAligned(p));
      assert.deepEqual([p[0], p.at(-1)], [a.pt, b.pt]);
      assert.ok(pathLen(p) <= 1.6 * pathLen(base), `${l.key} ${seed} long`);
      if (a.room !== 'wait' && a.room !== 'done') assert.deepEqual(p[standIndex(p)], base[standIndex(base)], `${l.key} stand`);
      if (JSON.stringify(p) === JSON.stringify(base)) continue;
      varied++;
      const onBase = (q: Pt) => base.some((v, i) => i > 0 && Math.min(v.x, base[i - 1].x) <= q.x && q.x <= Math.max(v.x, base[i - 1].x) && Math.min(v.y, base[i - 1].y) <= q.y && q.y <= Math.max(v.y, base[i - 1].y));
      for (let s = 0; s <= pathLen(p); s += 2) {
        const q = pointAt(p, s);
        if (onBase(q)) continue;
        assert.ok(!l.walls.has(`${Math.floor(q.x / 16)},${Math.floor(q.y / 16)}`), `${l.key} wall ${q.x},${q.y}`);
        assert.ok(!solid.some(r => q.x > r.x0 && q.x < r.x1 && q.y > r.y0 && q.y < r.y1), `${l.key} ${seed} ${JSON.stringify(a.pt)}→${JSON.stringify(b.pt)} ${q.x},${q.y}`);
        const hall = l.rooms.hall;   // in the corridor: off the upper doors' reach, in the hall door's (nearDoor)
        if (q.x > hall.x0 && q.y > hall.y0 && q.y < hall.y1) assert.ok(q.y >= l.hallY - 4 && q.y < l.hallY + 12, `${l.key} corridor ${q.x},${q.y}`);
      }
    }
    assert.ok(varied > 100, `${l.key}: ${varied} varied`);
  }
});
test('syncWalkers: with the layout\'s blocks two agents walking the same way take their own routes', () => {
  const w = new Map<string, Walker>(), sc = officeScene([agent({ id: 'a' }), agent({ id: 'b' })], 0, MIN);
  syncWalkers(w, sc.places, MIN, true, 0);
  const pa = sc.places.get('a')!.spot, pb = sc.places.get('b')!.spot, to = waitSpots(1, MIN)[0];
  const at = (s: Spot) => new Map<string, Place>([['a', { ...sc.places.get('a')!, spot: s }], ['b', { ...sc.places.get('b')!, spot: s }]]);
  syncWalkers(w, at({ room: 'wait', pt: to, aisle: to.y }), MIN, false, 100, walkBlocks(MIN), id => id === 'a' ? 7 : 9);
  assert.deepEqual(w.get('a')!.path, route(MIN, pa, { room: 'wait', pt: to, aisle: to.y }, { seed: 'a@7', blocks: walkBlocks(MIN) }));
  assert.deepEqual(w.get('b')!.path, route(MIN, pb, { room: 'wait', pt: to, aisle: to.y }, { seed: 'b@9', blocks: walkBlocks(MIN) }));
});
test('syncWalkers: one agent walking the same way again (a new stageSince) may take another route; the same snapshot data gives the same one', () => {
  const sc = officeScene([agent({ id: 'a' })], 0, MIN), home = sc.places.get('a')!, to = waitSpots(1, MIN)[0];
  const walk = (since: number) => {
    const w = new Map<string, Walker>();
    syncWalkers(w, sc.places, MIN, true, 0);
    syncWalkers(w, new Map([['a', { ...home, spot: { room: 'wait', pt: to, aisle: to.y } }]]), MIN, false, 100, walkBlocks(MIN), () => since);
    return JSON.stringify(w.get('a')!.path);
  };
  assert.ok(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(walk)).size >= 3);
  assert.equal(walk(3), walk(3));
});
test('syncWalkers: seeding a new layout puts everyone at their place in it, nobody walks', () => {
  const ag = [agent({ id: 'a-hot' }), agent({ id: 'w', stage: 'waiting' })], w = new Map<string, Walker>();
  syncWalkers(w, officeScene(ag, 0, MIN).places, MIN, true, 0);
  const big = officeScene(ag, 0, BIG);
  syncWalkers(w, big.places, BIG, true, 100);
  for (const a of ag) assert.deepEqual([w.get(a.id)!.pt, w.get(a.id)!.path], [big.places.get(a.id)!.spot.pt, []]);
});
test('syncWalkers: the first snapshot is already known — everyone sits, nobody walks, failed agents are not drawn', () => {
  const { layout, places } = officeScene([agent({ id: 'r' }), agent({ id: 'd', stage: 'done' }), agent({ id: 'f', stage: 'failed' })], 0, MIN);
  const w = new Map<string, Walker>();
  syncWalkers(w, places, layout, true, 5000);
  assert.deepEqual(w.get('r')!.pt, places.get('r')!.spot.pt);
  assert.deepEqual([w.get('r')!.path, w.get('d')!.path], [[], []]);
  assert.equal(w.has('f'), false);
});
test('syncWalkers: a newcomer enters at the door, a stage change walks, a vanished agent goes', () => {
  const w = new Map<string, Walker>();
  syncWalkers(w, officeScene([agent({ id: 'a' })], 0, MIN).places, l, true, 0);
  const next = officeScene([{ ...agent({ id: 'a' }), stage: 'waiting' }, agent({ id: 'b', startedAt: 2000 })], 0, MIN);
  syncWalkers(w, next.places, next.layout, false, 100);
  assert.deepEqual(w.get('b')!.pt, outside(l).pt);
  assert.equal(w.get('b')!.bornAt, 100);
  assert.ok(w.get('a')!.path.some(p => p.y === MIN.hallY));
  syncWalkers(w, officeScene([agent({ id: 'b', startedAt: 2000 })], 0, MIN).places, l, false, 200);
  assert.equal(w.has('a'), false);
});
test('syncWalkers: a waiting newcomer (a placeholder row) shows at its Waiting room spot at once, fading in', () => {
  const w = new Map<string, Walker>();
  syncWalkers(w, officeScene([agent({ id: 'a' })], 0, MIN).places, l, true, 0);
  const next = officeScene([agent({ id: 'a' }), agent({ id: 'p', role: 'placeholder', label: 'decision', stage: 'waiting', alert: true, reasons: [{ kind: 'note', text: 'needs-decision: which approach?' }] })], 0, MIN);
  syncWalkers(w, next.places, next.layout, false, 100);
  assert.deepEqual([w.get('p')!.pt, w.get('p')!.moving, w.get('p')!.bornAt], [next.places.get('p')!.spot.pt, false, 100]);
});
test('syncWalkers: pending → bound hands the walker over at its desk (same spawn key), nobody walks', () => {
  const w = new Map<string, Walker>();   // pending:T2 and A2 hash to other rooms; their key T2 holds one desk
  syncWalkers(w, officeScene([agent({ id: 'pending:T2', key: 'T2', stage: 'spawning', label: 'read' })], 0, MIN).places, l, true, 0);
  const at = w.get('pending:T2')!.pt;
  const bound = officeScene([agent({ id: 'A2', key: 'T2', label: 'read' })], 0, MIN);
  syncWalkers(w, bound.places, l, false, 100);
  assert.deepEqual([w.has('pending:T2'), w.get('A2')!.pt, w.get('A2')!.path, w.get('A2')!.moving], [false, at, [], false]);
  assert.deepEqual(at, bound.places.get('A2')!.spot.pt);
});
test('syncWalkers: a pending → bound hand-over is reported and keeps restAt (its coffee schedule goes along)', () => {
  const w = new Map<string, Walker>();
  syncWalkers(w, officeScene([agent({ id: 'a' })], 0, MIN).places, l, true, 0);
  syncWalkers(w, officeScene([agent({ id: 'a' }), agent({ id: 'pending:T2', key: 'T2', stage: 'spawning', label: 'read', startedAt: 1000 })], 0, MIN).places, l, false, 100);
  advanceWalkers(w, 100_000, 3000);
  assert.equal(w.get('pending:T2')!.restAt, 3000);
  const handed = syncWalkers(w, officeScene([agent({ id: 'a' }), agent({ id: 'A2', key: 'T2', label: 'read', startedAt: 1000 })], 0, MIN).places, l, false, 4000);
  assert.deepEqual([handed, w.get('A2')!.restAt], [[['pending:T2', 'A2']], 3000]);
});
test('syncWalkers: failing after the first snapshot starts the sequence', () => {
  const w = new Map<string, Walker>();
  syncWalkers(w, officeScene([agent({ id: 'a' })], 0, MIN).places, l, true, 0);
  syncWalkers(w, officeScene([agent({ id: 'a', stage: 'failed', stageSince: 0 })], 0, MIN).places, l, false, 700);
  assert.equal(w.get('a')!.failAt, 700);
});
test('syncWalkers: failAt lives only while the place is a fail — a same-label successor does not inherit it', () => {
  const w = new Map<string, Walker>();
  syncWalkers(w, officeScene([agent({ id: 'a', label: 'read' })], 0, MIN).places, l, true, 0);
  syncWalkers(w, officeScene([agent({ id: 'a', label: 'read', stage: 'failed', stageSince: 0 })], 0, MIN).places, l, false, 700);
  syncWalkers(w, officeScene([agent({ id: 'b', label: 'read', startedAt: 30_000 })], 30_000, MIN).places, l, false, 900);
  assert.equal(w.get('b')!.failAt, null);
});
test('advanceWalkers: SPEED px per ms, never overshoots, then faces its place', () => {
  const w = new Map<string, Walker>([['a', { pt: { x: 0, y: 0 }, path: [{ x: 56, y: 0 }, { x: 56, y: 10 }], spot: desk(0), face: 'up', dir: 'down', moving: true, bornAt: 0, failAt: null, burnAt: null, payAt: null, label: 'a', restAt: -Infinity }]]);
  advanceWalkers(w, 500, 500);
  assert.deepEqual([w.get('a')!.pt, w.get('a')!.dir], [{ x: 28, y: 0 }, 'right']);
  advanceWalkers(w, 10_000, 10_500);
  assert.deepEqual([w.get('a')!.pt, w.get('a')!.moving, w.get('a')!.dir], [{ x: 56, y: 10 }, false, 'up']);
});
test('advanceWalkers: restAt stamps the arrival; seeded walkers rest since −Infinity', () => {
  const w = new Map<string, Walker>();
  syncWalkers(w, officeScene([agent({ id: 'a' })], 0, MIN).places, MIN, true, 0);
  assert.equal(w.get('a')!.restAt, -Infinity);
  syncWalkers(w, officeScene([agent({ id: 'a', stage: 'waiting' })], 0, MIN).places, MIN, false, 100);
  advanceWalkers(w, 100_000, 5000);
  assert.deepEqual([w.get('a')!.moving, w.get('a')!.restAt], [false, 5000]);
});
test('advanceWalkers: a paid walker stands up to its route\'s first point in 180 ms, stays there to 2000 ms, then walks on from it (coins 7.2)', () => {
  for (const room of ['main', 'server'] as const) {
    const i = MIN.desks.findIndex(d => d.room === room), d = MIN.desks[i], seat = d.seat, done = doneSeats(MIN)[0];
    const stand = room === 'main' ? { x: seat.x, y: seat.y + 12 } : seat;   // main: aisle seat.y + 12; upper rooms: aisle seat.y, it stands where it sat
    const at = (kind: Place['kind'], spot: Spot) => new Map<string, Place>([['a', { spot, kind, pose: 'still', face: 'up', alpha: 1, desk: i, bubble: null, label: 'a', sprite: 0 }]]);
    const w = new Map<string, Walker>();
    syncWalkers(w, at('desk', { room, pt: seat, aisle: d.aisle }), MIN, true, 0);
    const a = w.get('a')!;
    a.payAt = 1000;
    syncWalkers(w, at('done', { room: 'done', pt: done, aisle: doneAisle(MIN, done) }), MIN, false, 1000);
    for (let t = 1016; t < 3000; t += 16) {
      advanceWalkers(w, 16, t);
      assert.equal(a.dir, 'down');
      if (t >= 1180) assert.deepEqual(a.pt, stand, `${room} at ${t}`);
    }
    advanceWalkers(w, 16, 3000); advanceWalkers(w, 16, 3016);
    assert.equal(a.payAt, null);
    assert.ok(a.pt.y === stand.y && a.pt.x > stand.x, `${room}: walks on along its aisle to the lane`);
    assert.ok(!a.path.some(p => p.x === seat.x && p.y === seat.y), `${room}: never back to its seat`);
    assert.deepEqual(a.path.at(-1), done);
  }
});
test('walksAt: a paid walker opens no door while it stands (to payAt + 2000 ms); a plain mover does', () => {
  const w: Walker = { pt: { x: 0, y: 0 }, path: [{ x: 56, y: 0 }], spot: desk(0), face: 'up', dir: 'down', moving: true, bornAt: 0, failAt: null, burnAt: null, payAt: 1000, label: 'a', restAt: -Infinity };
  assert.deepEqual([walksAt(w, 1000), walksAt(w, 2999), walksAt(w, 3000)], [false, false, true]);
  assert.equal(walksAt({ ...w, payAt: null }, 1000), true);
  assert.equal(walksAt({ ...w, payAt: null, moving: false }, 1000), false);
});
test('stepDoor: closed → half → open one frame per 120 ms, open while near, then closes', () => {
  const s: DoorState = { k: 0, last: 0 };
  stepDoor(s, true, 100); assert.equal(s.k, 0);
  stepDoor(s, true, 121); assert.equal(s.k, 1);
  stepDoor(s, true, 300); assert.equal(s.k, 2);
  stepDoor(s, true, 900); assert.equal(s.k, 2);
  stepDoor(s, false, 1100); assert.equal(s.k, 1);
  stepDoor(s, false, 1300); assert.equal(s.k, 0);
});
test('nearDoor: someone at an upper room door opens it; a corridor walker passing below does not', () => {
  assert.equal(nearDoor(MIN.doors[2], [{ x: 376, y: 120 }]), true);
  assert.equal(nearDoor(MIN.doors[2], [{ x: 376, y: 144 }]), false);
});
test('frameOf: sheet columns, rows by direction, left mirrored, read every 900 ms', () => {
  assert.deepEqual(frameOf('walk', 'left', 0), { col: 0, row: 2, flip: true });
  assert.deepEqual(frameOf('type', 'up', 300), { col: 4, row: 1, flip: false });
  assert.equal(frameOf('read', 'down', 900).col, 6);
  assert.equal(frameOf('still', 'down', 999).col, 1);
});
test('syncWalkers: a seed and a newcomer whose first place is a burn get no walker', () => {
  const burning = agent({ id: 'b', stage: 'done', stageSince: 0, leaveAt: 1000 }), sc = officeScene([agent({ id: 'r' }), burning], 2000, MIN);
  assert.equal(sc.places.get('b')!.kind, 'burn');
  const seeded = new Map<string, Walker>();
  syncWalkers(seeded, sc.places, MIN, true, 0);
  const live = new Map<string, Walker>();
  syncWalkers(live, officeScene([agent({ id: 'r' })], 0, MIN).places, MIN, true, 0);
  syncWalkers(live, sc.places, MIN, false, 100);
  assert.deepEqual([seeded.has('b'), live.has('b'), seeded.has('r')], [false, false, true]);
});
test('stepBurns: a walker at rest on its burn place burns from that frame, once; one still walking waits; leaving the burn clears burnAt', () => {
  const d = agent({ id: 'd', stage: 'done', stageSince: 0 }), w = new Map<string, Walker>();
  syncWalkers(w, officeScene([agent({ id: 'd', startedAt: 0 })], 0, MIN).places, MIN, true, 0);   // at its desk
  const burn = officeScene([{ ...d, leaveAt: 100 }], 200, MIN).places;
  syncWalkers(w, burn, MIN, false, 200);
  stepBurns(burn, w, 200);
  assert.deepEqual([w.get('d')!.moving, w.get('d')!.burnAt], [true, null]);
  advanceWalkers(w, 100_000, 5000);
  stepBurns(burn, w, 5000);
  stepBurns(burn, w, 6000);
  assert.equal(w.get('d')!.burnAt, 5000);
  syncWalkers(w, officeScene([{ ...d, stage: 'running', leaveAt: null }], 7000, MIN).places, MIN, false, 7000);
  assert.equal(w.get('d')!.burnAt, null);
});
test('stepBurns: one out for coffee when its place turns to a burn walks home first and burns on arrival', () => {
  const d = agent({ id: 'd', stage: 'done', stageSince: 0 }), w = new Map<string, Walker>(), rooms = coffeeRooms();
  const s0 = officeScene([d], 0, MIN), go = tripGap('done', 0), T = go + 2000;
  syncWalkers(w, s0.places, MIN, true, 0);
  stepRooms(rooms, s0.places, w, MIN, 0);
  stepRooms(rooms, s0.places, w, MIN, go);
  assert.equal(rooms.done.out?.id, 'd');
  const s1 = officeScene([{ ...d, leaveAt: T }], T, MIN).places;
  syncWalkers(w, s1, MIN, false, T);
  stepRooms(rooms, s1, w, MIN, T);   // the trip is cut: it walks home
  advanceWalkers(w, 16, T);
  stepBurns(s1, w, T);
  assert.equal(w.get('d')!.burnAt, null);
  advanceWalkers(w, 100_000, T + 20_000);
  stepBurns(s1, w, T + 20_000);
  assert.equal(w.get('d')!.burnAt, T + 20_000);
});
test('syncWalkers: a burning walker that vanishes hands over to nobody; a same-label newcomer walks in from the Entrance', () => {
  const d = agent({ id: 'd', label: 'read', stage: 'done', stageSince: 0 }), w = new Map<string, Walker>();
  syncWalkers(w, officeScene([d], 0, MIN).places, MIN, true, 0);
  const burn = officeScene([{ ...d, leaveAt: 100 }], 200, MIN).places;
  syncWalkers(w, burn, MIN, false, 200);
  stepBurns(burn, w, 200);
  syncWalkers(w, officeScene([{ ...d, leaveAt: 100 }, agent({ id: 'n', label: 'read', startedAt: 20_000 })], 20_000, MIN).places, MIN, false, 20_000);
  assert.deepEqual([w.has('d'), w.get('n')!.pt, w.get('n')!.bornAt], [false, outside(MIN).pt, 20_000]);
});
test('awayGap: a long gap reseeds, but never across a style switch (its re-render and first frame may run long)', () => {
  assert.deepEqual([awayGap(AWAY_MS, ['flat']), awayGap(AWAY_MS + 1, ['flat']), awayGap(900, ['iso', 'iso', 'iso', 'flat'])], [false, true, true]);
  assert.equal(awayGap(900, ['iso', 'flat', 'flat']), false);   // the first frame in the new style: the gap spans the re-render
  assert.equal(awayGap(900, ['iso', 'iso', 'flat']), false);    // the next: the gap spans the new style's first draw
});
