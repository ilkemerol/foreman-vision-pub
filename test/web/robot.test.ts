import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cornerSpots } from '../../web/src/logic/corner.ts';
import { pathLen, pointAt } from '../../web/src/logic/fx.ts';
import { boardOf, cafeFoot, officeLayout, sofaParts, type Fit, type Layout, type Pt, type Rect } from '../../web/src/logic/layout.ts';
import { nearDoor } from '../../web/src/logic/motion.ts';
import { decorKeepOut, isoSignBoxes } from '../../web/src/logic/decor.ts';
import { TEXT } from '../../web/src/logic/i18n.ts';
import { isoProj, isoSign, isoView, signBox, toWorld } from '../../web/src/logic/iso.ts';
import { CHARGE_MS, chargeAt, chargeLit, chargerOf, dockOf, nextTour, ROBOT_EVERY, ROBOT_SPEED, robotAt, robotLane, robotLines, robotPhase, robotRoute } from '../../web/src/logic/robot.ts';

const fit = (w: number, h: number): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0 });
const LAYOUTS = [fit(1114, 589), fit(1146, 613), fit(1028, 714), fit(2308, 1372)].map(f => officeLayout(f));   // 34×18, 35×19, 34×22, 47×25
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const inside = (p: Pt, r: Rect) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
const robotBox = (p: Pt): Rect => ({ x0: p.x - 8, y0: p.y - 8, x1: p.x + 8, y1: p.y });   // drawRobot: 16×8 over its feet point
/** Every point along a path, 2 px apart. */
const samples = (r: Pt[]) => Array.from({ length: Math.floor(pathLen(r) / 2) + 1 }, (_, i) => pointAt(r, i * 2));
/** The furniture a floor robot must not cross (flat sprite boxes): desks, the foreman desk and its context box, the rack
 *  column, the Waiting room bench and sofa set, both coffee corners, the Done lounge's café tables and its board. */
function furniture(l: Layout): Rect[] {
  const sv = l.rooms.server, wr = l.rooms.wait, F = l.foreman;
  return [
    ...l.desks.map(d => ({ x0: d.cx - 24, y0: d.y, x1: d.cx + 24, y1: d.y + 32 })),
    { x0: F.cx - 24, y0: F.y, x1: F.cx + 24, y1: F.y + 32 }, cornerSpots(l).box,
    { x0: sv.x0 + 8, y0: sv.y0, x1: sv.x0 + 22, y1: sv.y1 },
    ...Object.values(sofaParts(l.sofa)), { x0: wr.x1 - 40, y0: wr.y0 + 4, x1: wr.x1 - 24, y1: wr.y0 + 20 },
    ...[l.stations.wait, l.stations.done].map(s => ({ x0: s.x, y0: s.y - 6, x1: s.x + 32, y1: s.y + 32 })),
    ...l.cafes.map(cafeFoot), boardOf(l),
  ];
}

test('robotRoute: from the dock through all five rooms and back, axis-aligned, upright only on the room doors\' columns (four sizes)', () => {
  for (const l of LAYOUTS) {
    const r = robotRoute(l), lanes = Object.values(l.lane);
    assert.deepEqual([r[0], r[r.length - 1]], [dockOf(l), dockOf(l)]);
    for (let i = 1; i < r.length; i++) {
      assert.ok(r[i].x === r[i - 1].x || r[i].y === r[i - 1].y, `${l.key} segment ${i} is diagonal`);
      if (r[i].x === r[i - 1].x && r[i].y !== r[i - 1].y) assert.ok(lanes.includes(r[i].x), `${l.key} upright at x ${r[i].x}`);
    }
    for (const id of ['main', 'server', 'library', 'wait', 'done'] as const) assert.ok(r.some(p => inside(p, l.rooms[id])), `${l.key} skips ${id}`);
  }
});

test('robotRoute: the robot\'s box meets no furniture anywhere on its tour (four sizes)', () => {
  for (const l of LAYOUTS) {
    const f = furniture(l);
    for (const p of samples(robotRoute(l))) assert.ok(!f.some(b => meet(robotBox(p), b)), `${l.key} at ${p.x},${p.y}`);
  }
});

test('robotRoute: it stays inside the walls, crossing them only through a door\'s column (four sizes)', () => {
  for (const l of LAYOUTS) {
    const gaps = l.doors.map(d => ({ x0: d.x, y0: d.y - 32, x1: d.x + 16, y1: d.y + 32 }));   // the door cell, two tiles either side
    const open = [...Object.values(l.rooms), ...gaps];
    for (const p of samples(robotRoute(l))) assert.ok(open.some(r => inside(p, r)), `${l.key} in a wall at ${p.x},${p.y}`);
  }
});

test('robotLines: a work room without desks still gets its bottom line; the 14 px check is against the lowest row', () => {
  const l = LAYOUTS[0], bare = { ...l, desks: l.desks.filter(d => d.room !== 'server') };   // officeLayout always gives every room a desk row
  assert.deepEqual(robotLines(bare).server, [[l.rooms.server.y1 - 3, l.rooms.server.x0 + 30]]);
  const shuffled = { ...l, desks: [...l.desks].reverse() };
  assert.deepEqual(robotLines(shuffled), robotLines(l));
});

test('robotLane: in the corridor the robot drives 4 px behind the walking line and opens no upper door passing by', () => {
  for (const l of LAYOUTS) {
    const up = l.doors.filter(d => d.id === 'server' || d.id === 'library'), y = robotLane(l);
    assert.equal(y, l.hallY - 4);
    for (const p of samples(robotRoute(l)).filter(p => p.y === y)) assert.ok(!up.some(d => nearDoor(d, [p])), `${l.key} opens a door at ${p.x}`);
  }
});

test('robotRoute: every door it goes through opens for it, the lower ones too (four sizes)', () => {
  for (const l of LAYOUTS) {
    const pts = samples(robotRoute(l));
    for (const d of l.doors.filter(d => d.id !== 'in')) assert.ok(nearDoor(d, pts), `${l.key} ${d.id} stays shut`);
  }
});

test('robotAt: docked before its tour, along the route during it, docked after; the same inputs give the same answer; the phase comes from the sid', () => {
  const l = LAYOUTS[0], r = robotRoute(l), p = robotPhase('sim-pixel-a'), dur = pathLen(r) / ROBOT_SPEED, t0 = 5 * ROBOT_EVERY + p;
  assert.ok(p >= 0 && p < ROBOT_EVERY);
  assert.notEqual(robotPhase('sim-pixel-a'), robotPhase('sim-pixel-b'));
  assert.deepEqual(robotAt(r, 'sim-pixel-a', t0 - 1), { pt: dockOf(l), moving: false, tour: 4, d: 0 });
  const mid = robotAt(r, 'sim-pixel-a', t0 + 30_000);
  assert.deepEqual(mid, { pt: pointAt(r, 30_000 * ROBOT_SPEED), moving: true, tour: 5, d: 30_000 * ROBOT_SPEED });
  assert.deepEqual(robotAt(r, 'sim-pixel-a', t0 + 30_000), mid);
  assert.equal(robotAt(r, 'sim-pixel-a', t0 + dur + 1).moving, false);
  assert.ok(dur > 60_000 && dur < 180_000, `the smallest office's tour takes ${dur} ms`);   // about 2 min
});

test('robotAt: before the sid\'s first phase the clock counts tour -1 (another size, another sid)', () => {
  const l = LAYOUTS[3], r = robotRoute(l), p = robotPhase('sim-pixel-d');
  assert.deepEqual(robotAt(r, 'sim-pixel-d', p - 1), { pt: dockOf(l), moving: false, tour: -1, d: 0 });
  const d = 30_000 * ROBOT_SPEED;
  assert.deepEqual(robotAt(r, 'sim-pixel-d', p - ROBOT_EVERY + 30_000), { pt: pointAt(r, d), moving: true, tour: -1, d });
});

test('robotAt: a tour lasts at most half the gap, however long its route', () => {
  const long = [{ x: 0, y: 0 }, { x: 40_000, y: 0 }, { x: 0, y: 0 }];
  assert.equal(robotAt(long, 's', robotPhase('s') + ROBOT_EVERY / 2 + 1).moving, false);
  assert.equal(robotAt(long, 's', robotPhase('s') + ROBOT_EVERY / 2 - 1).moving, true);
});

test('chargeAt: out while it tours, charging its first CHARGE_MS back, then full until the next tour (two sizes)', () => {
  for (const l of [LAYOUTS[0], LAYOUTS[3]]) {
    const r = robotRoute(l), t0 = nextTour('sim-pixel-a', 0) + 5 * ROBOT_EVERY, back = t0 + pathLen(r) / Math.max(ROBOT_SPEED, pathLen(r) / (ROBOT_EVERY / 2));
    for (const t of [t0, t0 + 30_000, back - 1]) assert.equal(chargeAt(r, 'sim-pixel-a', t), 'out', `${l.key} at ${t - t0}`);
    for (const t of [back - 1, back, back + 1, back + CHARGE_MS - 1, back + CHARGE_MS + 1, t0 + ROBOT_EVERY - 1, t0 + ROBOT_EVERY])
      assert.equal(chargeAt(r, 'sim-pixel-a', t) === 'out', robotAt(r, 'sim-pixel-a', t).moving, `${l.key} at ${t - t0}: out iff moving`);
    assert.equal(chargeAt(r, 'sim-pixel-a', back + 1), 'charging');
    assert.equal(chargeAt(r, 'sim-pixel-a', back + CHARGE_MS - 1), 'charging');
    assert.equal(chargeAt(r, 'sim-pixel-a', back + CHARGE_MS + 1), 'full');
    assert.equal(chargeAt(r, 'sim-pixel-a', t0 - 1), 'full');   // the tour before ended long ago
  }
});

/** In iso the Library sign hangs over the wall right above the dock at every text scale; 20 px left the unit clears it
 *  at the largest (3) and every sign, in either language, up to k 2 (a CSS scale of 1). Above that, in the narrowest
 *  offices the Done lounge's sign reaches over this stretch of the corridor's back wall wherever the unit hangs. */
test('chargerOf: the wall unit clears the labels and door signs, flat and iso, on the library\'s doorless wall (four sizes)', () => {
  for (const l of LAYOUTS) {
    const c = chargerOf(l), d = dockOf(l), v = isoView(l.cols, l.rows), wy = toWorld(d).y - 0.75;
    const flat: Rect = { x0: c.x - 6, y0: c.y - 11, x1: c.x + 6, y1: c.y + 1 };
    assert.ok(flat.y0 >= l.hallY - 2 * 16 && flat.y1 <= d.y - 12, `${l.key} off the wall face`);
    assert.ok(flat.x0 > l.rooms.library.x0 + 16 && flat.x1 < l.doors.find(o => o.id === 'library')!.x, `${l.key} off the library's wall`);
    for (const k of decorKeepOut(l).filter(k => k.why === 'label')) assert.ok(!meet(flat, k), `${l.key} flat under a label at ${k.x0},${k.y0}`);
    const [a, b] = [isoProj(v, flat.x0 / 16, wy, c.z + 1), isoProj(v, flat.x1 / 16, wy, c.z - 12)], iso: Rect = { x0: a[0], y0: a[1], x1: b[0], y1: b[1] };
    assert.ok(!meet(iso, isoSignBoxes(l, 3)[l.doors.findIndex(o => o.id === 'library')]), `${l.key} iso under the Library sign at k 3`);
    for (const k of [1, 2]) for (const o of l.doors) for (const text of [TEXT.en[`door.${o.id}`], TEXT.tr[`door.${o.id}`]])
      assert.ok(!meet(iso, signBox(isoSign(l, o, k, text), text, k)), `${l.key} iso under the ${o.id} sign at k ${k}`);
  }
});

test('chargeLit: a slow blink while charging, steady when full or calm', () => {
  assert.deepEqual([0, 900, 1800, 2700].map(t => chargeLit('charging', t, false)), [false, true, false, true]);
  for (const t of [0, 900]) { assert.ok(chargeLit('full', t, false)); assert.ok(chargeLit('charging', t, true)); }
});

test('nextTour: the next start at or after now, on the sid\'s phase', () => {
  const p = robotPhase('s');
  assert.equal(nextTour('s', p + 3 * ROBOT_EVERY), p + 3 * ROBOT_EVERY);
  assert.equal(nextTour('s', p + 3 * ROBOT_EVERY + 1), p + 4 * ROBOT_EVERY);
});
