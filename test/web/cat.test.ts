import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bowlFood, CAT, CAT_HIT, catDraw, catHit, catSpots, HEART, heartsAt, MEAL, mealDue, mealSlot, perchFloor, perches, pet, seedCat, someoneWaits, stepCat, type Cat, type CatWorld, type Perch } from '../../web/src/logic/cat.ts';
import { bowlsOf } from '../../web/src/logic/decor.ts';
import { cornerSpots } from '../../web/src/logic/corner.ts';
import { pathLen, pointAt } from '../../web/src/logic/fx.ts';
import { boardOf, cafeFoot, doneSeats, officeLayout, sofaParts, queueSpot, regionAt, TILE, waitSpots, type Fit, type Layout, type Pt, type Rect } from '../../web/src/logic/layout.ts';
import { syncWalkers, type Walker } from '../../web/src/logic/motion.ts';
import { robotRoute } from '../../web/src/logic/robot.ts';
import { hitAt, officeScene, type Hit } from '../../web/src/logic/scene.ts';
import { agent } from './fake.ts';

// rng: `seq(...)` hands out its values in turn and wraps. Where a test depends on more than one draw, the comment
// names them in order. The draws: a fresh seed picks a spot, then a rest length; a rest's end draws deskOdds (only
// when a desk is free), then picks a desk or a spot; a hop up draws the desk length; a meeting draws rideOdds; a
// startle's end picks a spot. `seq(0)`: the first of everything and the shortest times.
const fit = (w: number, h: number): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0 });
const LAYOUTS = [fit(1114, 589), fit(1146, 613), fit(1028, 714), fit(2308, 1372)].map(f => officeLayout(f));
const l = LAYOUTS[0];
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const inside = (p: Pt, r: Rect) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
const catBox = (p: Pt): Rect => ({ x0: p.x - 8, y0: p.y - 11, x1: p.x + 8, y1: p.y });   // drawCat: at most 16×11 over its feet
const person = (p: Pt): Rect => ({ x0: p.x - 8, y0: p.y - 32, x1: p.x + 8, y1: p.y });
const far: Meet = { pt: { x: -999, y: -999 }, moving: false, tour: 0 };
type Meet = CatWorld['robot'];
const world = (o: Partial<CatWorld> = {}): CatWorld => ({ perched: [], waiting: false, robot: far, ...o });
const SEEDS = [0, 0.2, 0.4, 0.6, 0.8, 0.99];
/** Run her until `ms`, 40 ms a frame. */
const run = (c: Cat, w: CatWorld, from: number, ms: number, rng = seq(0.5)) => { for (let t = from; t <= from + ms; t += 40) stepCat(c, l, w, t, 40, rng); };
/** Step her until `done`; the frame it happened. */
function stepUntil(c: Cat, w: CatWorld, from: number, done: (c: Cat) => boolean, rng = seq(0.5)): number {
  for (let t = from; t <= from + 120_000; t += 40) { stepCat(c, l, w, t, 40, rng); if (done(c)) return t; }
  return assert.fail('never happened');
}
/** Resting at spot 0, then off to desk 0 (deskOdds 0.1 < 0.6, then the first desk). */
function toDesk(): Cat {
  const c = seedCat(null, l, [], false, 0, seq(0));
  stepCat(c, l, world({ perched: [0] }), c.until, 40, seq(0.1, 0));
  return c;
}
/** Riding the moving robot (tour 7) she met 20 px from spot 0 (rideOdds 0.1 < 0.25), from frame 100 + CAT.hop. */
function rider(): { c: Cat; robot: Meet } {
  const c = seedCat(null, l, [], false, 0, seq(0)), robot = { pt: { x: c.pt.x + 20, y: c.pt.y }, moving: true, tour: 7 };
  stepCat(c, l, world({ robot }), 100, 40, seq(0.1));
  stepCat(c, l, world({ robot }), 100 + CAT.hop, 40, seq(0.5));
  assert.equal(c.mode, 'ride');
  return { c, robot };
}

/** A floor with running agents at desks 0 and 1 and a verifying one at desk 2, everyone at rest (a seed). */
function floor(extra = [] as ReturnType<typeof agent>[]) {
  const agents = [agent({ id: 'a', startedAt: 1 }), agent({ id: 'b', startedAt: 2 }), agent({ id: 'c', startedAt: 3, stage: 'verifying' }),
    agent({ id: 'main', role: 'foreman', parentId: null, stage: 'running' }), ...extra];
  const scene = officeScene(agents, 10_000, l), walkers = new Map<string, Walker>();
  syncWalkers(walkers, scene.places, l, true, 0);
  return { scene, walkers, agents: new Map(agents.map(a => [a.id, a])) };
}

test('catSpots: each rest spot is on its room\'s floor, clear of desks, the foreman corner, racks, benches, coffee corners, the Waiting room sofa set, the café tables, the board, the Done lounge seats, waiting spots and the queue (four sizes)', () => {
  for (const L of LAYOUTS) {
    const sv = L.rooms.server, wr = L.rooms.wait;
    const blocked: Rect[] = [
      ...L.desks.flatMap(d => [{ x0: d.cx - 24, y0: d.y, x1: d.cx + 24, y1: d.y + 32 }, person(d.seat)]), person(L.foreman.seat), cornerSpots(L).box,
      { x0: sv.x0 + 8, y0: sv.y0, x1: sv.x0 + 22, y1: sv.y1 }, ...Object.values(sofaParts(L.sofa)), { x0: wr.x1 - 40, y0: wr.y0 + 4, x1: wr.x1 - 24, y1: wr.y0 + 20 },
      ...[L.stations.wait, L.stations.done].map(s => ({ x0: s.x, y0: s.y - 6, x1: s.x + 32, y1: s.y + 32 })),
      ...L.cafes.map(cafeFoot), boardOf(L), ...doneSeats(L).map(person), ...L.waits.map(person), ...[0, 1, 2, 3].map(k => person(queueSpot(k, L))),
    ];
    for (const s of catSpots(L)) {
      assert.ok(!blocked.some(b => meet(catBox(s.pt), b)), `${L.key} ${s.room} ${s.pt.x},${s.pt.y}`);
      const hall = s.pt.y === L.hallY - 4;
      assert.ok(hall || inside(s.pt, L.rooms[s.room as 'main']), `${L.key} ${s.room} spot outside its room`);
    }
    assert.equal(catSpots(L).filter(s => s.pt.y === L.hallY - 4).length, 1);   // the corridor runner, on the robot's line
    assert.deepEqual(catSpots(L).filter(s => s.quiet).map(s => s.room), ['wait']);
  }
});

test('perchFloor: beside each desk\'s chair and left of the foreman\'s desk, in its room, clear of every seated agent (four sizes)', () => {
  for (const L of LAYOUTS) {
    const people = [...L.desks.map(d => person(d.seat)), person(L.foreman.seat)];
    for (const p of [...L.desks.keys(), 'foreman' as const]) {
      const s = perchFloor(L, p);
      assert.ok(inside(s.pt, L.rooms[s.room as 'main']), `${L.key} ${p} outside its room`);
      assert.ok(!people.some(b => meet(catBox(s.pt), b)), `${L.key} ${p} ${s.pt.x},${s.pt.y}`);
    }
  }
});

test('perches: the desks of seated running and verifying agents and the running foreman\'s; not a waiting, stale-board, failed or walking one', () => {
  const { scene, walkers, agents } = floor([agent({ id: 'w', startedAt: 4, stage: 'waiting' }), agent({ id: 's', startedAt: 5, stage: 'done', badges: ['stale-board'] }),
    agent({ id: 'f', startedAt: 6, stage: 'failed', stageSince: 9_000 })]);
  const got = perches(scene, agents, walkers);
  assert.deepEqual(got.filter(p => p !== 'foreman').sort(), ['a', 'b', 'c'].map(id => scene.places.get(id)!.desk).sort());
  assert.ok(got.includes('foreman'));
  walkers.get('a')!.moving = true;
  assert.ok(!perches(scene, agents, walkers).includes(scene.places.get('a')!.desk!));
  assert.equal(someoneWaits(scene), true);
});

test('seedCat fresh: she rests at a rest spot, never walking; with someone waiting never at the Waiting room spot', () => {
  for (const r of SEEDS) {
    const c = seedCat(null, l, [], true, 1000, seq(r));
    assert.equal(c.mode, 'rest');
    assert.deepEqual(c.path, []);
    assert.ok(catSpots(l).some(s => s.pt.x === c.pt.x && s.pt.y === c.pt.y && !s.quiet));
    assert.ok(c.until >= 1000 + CAT.rest[0] && c.until <= 1000 + CAT.rest[1]);
  }
});

test('stepCat: after her rest, with someone working she goes to a working desk at odds 0.6, hops up beside the chair and sits on it', () => {
  const c = toDesk(), p: Perch = 0;
  assert.equal(c.mode, 'walk');
  assert.deepEqual(c.path[c.path.length - 1], perchFloor(l, p).pt);
  run(c, world({ perched: [p] }), c.until, 60_000);
  assert.equal(c.mode, 'desk');
  assert.deepEqual(catDraw(c, c.since + 1, { x: 0, y: 0 }), { at: 'desk', perch: 0, pose: 'sit' });
  assert.deepEqual(catDraw(c, c.since + CAT.curl + 1, { x: 0, y: 0 }), { at: 'desk', perch: 0, pose: 'loaf' });   // sits, then curls
});

test('stepCat: the foreman\'s desk is a perch like any other: she walks to its floor, hops up and sits on it', () => {
  const c = seedCat(null, l, [], false, 0, seq(0));
  stepCat(c, l, world({ perched: ['foreman'] }), c.until, 40, seq(0.1, 0));   // deskOdds 0.1 < 0.6, then the first desk
  assert.deepEqual(c.path[c.path.length - 1], perchFloor(l, 'foreman').pt);
  stepUntil(c, world({ perched: ['foreman'] }), c.until, c => c.mode === 'desk');
  assert.deepEqual(catDraw(c, c.since + 1, { x: 0, y: 0 }), { at: 'desk', perch: 'foreman', pose: 'sit' });
});

test('stepCat: she stays on a desk 40–90 s, and rests 20–45 s where her walk ends after hopping down', () => {
  for (const r of SEEDS) {
    const c = toDesk();
    const up = stepUntil(c, world({ perched: [0] }), c.until, c => c.mode === 'desk', seq(r));
    assert.equal(c.since, up);
    assert.ok(c.until - up >= CAT.desk[0] && c.until - up <= CAT.desk[1], `desk ${c.until - up}`);
    const down = stepUntil(c, world(), up + 40, c => c.mode === 'rest', seq(r));   // her agent stopped: down, off, rest
    assert.ok(c.until - down >= CAT.rest[0] && c.until - down <= CAT.rest[1], `rest ${c.until - down}`);
  }
});

test('stepCat: with nobody working, or at odds ≥ 0.6, she goes to another rest spot', () => {
  for (const [perched, r] of [[[], 0.1], [[0], 0.7]] as const) {
    const c = seedCat(null, l, [], false, 0, seq(0));
    stepCat(c, l, world({ perched: [...perched] }), c.until, 40, seq(r, 0.5));   // deskOdds r (drawn only with a desk), then a spot
    assert.equal(c.goal, null);
    assert.ok(catSpots(l).some(s => s.pt.x === c.spot.pt.x && s.pt.y === c.spot.pt.y));
  }
});

test('stepCat: while someone waits she never walks or runs to the Waiting room spot', () => {
  const quiet = (c: Cat) => catSpots(l).some(s => s.quiet && s.pt.x === c.spot.pt.x && s.pt.y === c.spot.pt.y);
  for (const r of SEEDS) {
    const c = seedCat(null, l, [], false, 0, seq(0));
    stepCat(c, l, world({ waiting: true }), c.until, 40, seq(r));   // a rest's end: a spot
    assert.equal(c.mode, 'walk');
    assert.ok(!quiet(c), `walk, rng ${r}`);
    const d = seedCat(null, l, [], false, 0, seq(0)), robot = { pt: { x: d.pt.x + 20, y: d.pt.y }, moving: true, tour: 1 };
    stepCat(d, l, world({ waiting: true, robot }), 100, 40, seq(0.5));   // rideOdds 0.5 ≥ 0.25: a startle
    stepCat(d, l, world({ waiting: true, robot }), 100 + CAT.startle, 40, seq(r));   // its end: a spot
    assert.equal(d.mode, 'run');
    assert.ok(!quiet(d), `run, rng ${r}`);
  }
});

test('stepCat: resting at the Waiting room spot, she leaves as soon as someone waits there', () => {
  const at = catSpots(l).findIndex(s => s.quiet), n = catSpots(l).length;
  const c = seedCat(null, l, [], false, 0, seq((at + 0.5) / n));   // picks the Waiting room spot
  assert.equal(c.spot.room, 'wait');
  stepCat(c, l, world({ waiting: true }), 100, 40, seq(0.5));   // long before her rest ends
  assert.equal(c.mode, 'walk');
  assert.notEqual(c.spot.room, 'wait');
});

test('stepCat: she hops down at once when her agent stops working, and then goes on; she never picks the same desk twice in a row', () => {
  const c = seedCat(null, l, [], false, 0, seq(0));
  stepCat(c, l, world({ perched: [0, 1] }), c.until, 40, seq(0.1, 0));   // deskOdds 0.1 < 0.6, then desk 0
  run(c, world({ perched: [0, 1] }), c.until, 60_000);
  assert.equal(c.mode, 'desk');
  stepCat(c, l, world({ perched: [1] }), c.since + 1000, 40, seq(0.5));   // desk 0's agent stopped
  assert.equal(c.mode, 'hop');
  run(c, world({ perched: [0, 1] }), c.since + 1000, 400, seq(0.1, 0));   // lands, picks again: desk 0 is her last, so desk 1
  assert.equal(c.goal, 1);
});

test('stepCat: when her agent stops while she walks to its desk, she rests beside the chair', () => {
  const c = toDesk();
  stepUntil(c, world(), c.until, c => c.mode !== 'walk');
  assert.equal(c.mode, 'rest');
  assert.deepEqual(c.pt, perchFloor(l, 0).pt);
  assert.equal(c.goal, null);
});

test('stepCat: the moving robot within 30 px of her at rest: a startle then a run to another room (rng ≥ 0.25), or a ride (rng < 0.25); once a tour; the ride ends when the robot leaves the room', () => {
  const c = seedCat(null, l, [], false, 0, seq(0)), at = c.pt, room = c.spot.room;
  const robot = { pt: { x: at.x + 20, y: at.y }, moving: true, tour: 7 };
  stepCat(c, l, world({ robot }), 100, 40, seq(0.5));   // rideOdds 0.5 ≥ 0.25: a startle
  assert.equal(c.mode, 'startle');
  stepCat(c, l, world({ robot }), 100 + CAT.startle, 40, seq(0));   // its end: the first spot in another room
  assert.equal(c.mode, 'run');
  assert.notEqual(c.spot.room, room);

  const { c: d, robot: r } = rider();
  assert.deepEqual(catDraw(d, 500, r.pt), { at: 'ride', pt: r.pt });
  stepCat(d, l, world({ robot: { ...r, pt: { x: l.rooms.wait.x0 + 20, y: l.rooms.wait.y0 + 20 } } }), 600, 40, seq(0.5));   // into the Waiting room
  assert.equal(d.mode, 'rest');
  stepCat(d, l, world({ robot: { ...r, pt: d.pt } }), 700, 40, seq(0.1));
  assert.equal(d.mode, 'rest');   // tour 7 met her already
});

test('stepCat: a ride ends after 20 s, or when the robot stops, where she is', () => {
  const a = rider(), t0 = 100 + CAT.hop;
  stepCat(a.c, l, world({ robot: a.robot }), t0 + CAT.rideMax - 40, 40, seq(0.5));
  assert.equal(a.c.mode, 'ride');
  stepCat(a.c, l, world({ robot: a.robot }), t0 + CAT.rideMax, 40, seq(0.5));
  assert.deepEqual([a.c.mode, a.c.pt], ['rest', a.robot.pt]);
  const b = rider();
  stepCat(b.c, l, world({ robot: { ...b.robot, moving: false } }), t0 + 40, 40, seq(0.5));
  assert.deepEqual([b.c.mode, b.c.pt], ['rest', b.robot.pt]);
});

test('stepCat: a ride ending on a room\'s door or wall tile (as the robot leaves it) rests her inside the room\'s floor, not in the doorway (four sizes)', () => {
  for (const L of LAYOUTS) {
    const tour = robotRoute(L), regionOf = (p: Pt) => regionAt(L, Math.floor(p.x / TILE), Math.floor(p.y / TILE));
    let doors = 0;
    for (let s = 0; s < pathLen(tour); s += 4) {
      const pt = pointAt(tour, s), room = regionOf(pt);
      if (room === 'hall') continue;
      if (!inside(pt, L.rooms[room])) doors++;
      const c: Cat = { ...seedCat(null, L, [], false, 0, seq(0)), mode: 'ride', pt, room, until: 1e9 };
      stepCat(c, L, world({ robot: { pt: { x: L.lane.main + 40, y: L.hallY - 4 }, moving: true, tour: 0 } }), 0, 40, seq(0.5));   // it is in the corridor now
      const r = L.rooms[room], at = `${L.key} ${room} ${pt.x},${pt.y} → ${c.pt.x},${c.pt.y}`;
      assert.equal(c.mode, 'rest', at);
      assert.ok(c.pt.x > r.x0 && c.pt.x < r.x1 && c.pt.y > r.y0 && c.pt.y < r.y1 && regionOf(c.pt) === room, at);
    }
    assert.ok(doors > 0, `${L.key}: the tour crosses door tiles`);
  }
});

test('stepCat: stepping off the robot anywhere on its tour (the corridor, a door column, a room\'s line), she walks on along the door columns to a rest spot (four sizes)', () => {
  for (const L of LAYOUTS) {
    const tour = robotRoute(L), lanes = new Set(Object.values(L.lane));
    for (let s = 0; s < pathLen(tour); s += 8) {
      const pt = pointAt(tour, s);
      for (const r of SEEDS) {
        const c = seedCat({ ...seedCat(null, L, [], false, 0, seq(0)), mode: 'ride', pt }, L, [], false, 0, seq(0));   // off where she is
        stepCat(c, L, world(), c.until, 40, seq(r));   // her rest's end: a spot
        const p = c.path, at = `${L.key} ${pt.x},${pt.y} rng ${r}`;
        if (!p.length) continue;   // the spot she is on
        assert.deepEqual([p[0], p[p.length - 1]], [c.pt, c.spot.pt], at);
        for (let i = 1; i < p.length; i++) {
          const a = p[i - 1], b = p[i];
          assert.ok(a.x === b.x || a.y === b.y, `${at}: diagonal`);
          if (a.x === b.x && i > 1 && i < p.length - 1) assert.ok(lanes.has(a.x), `${at}: up or down off a door column at x ${a.x}`);
        }
      }
    }
  }
});

test('seedCat on a tab return: a walk ends resting at its spot; a walk to a still working desk ends on the desk; a ride or a startle ends where she is', () => {
  const c = seedCat(null, l, [], false, 0, seq(0));
  stepCat(c, l, world({ perched: [0] }), c.until, 40, seq(0.7, 0));   // deskOdds 0.7 ≥ 0.6: a rest spot (the first)
  const s = seedCat(c, l, [0], false, c.until + 500, seq(0.5));   // a new Cat; c stays as it was
  assert.deepEqual([s.mode, s.pt], ['rest', c.spot.pt]);
  stepCat(s, l, world({ perched: [0] }), s.until, 40, seq(0.1, 0));   // deskOdds 0.1 < 0.6, then desk 0
  const t = seedCat(s, l, [0], false, s.until + 500, seq(0.5));
  assert.equal(t.mode, 'desk');
  assert.equal(seedCat(s, l, [], false, s.until + 500, seq(0.5)).mode, 'rest');   // its agent stopped meanwhile
  const r = { ...s, mode: 'ride' as const, pt: { x: l.lane.main, y: l.hallY - 4 } };
  const off = seedCat(r, l, [], false, 0, seq(0.5));
  assert.deepEqual([off.mode, off.pt], ['rest', r.pt]);
});

test('seedCat on a tab return: hopping down off a desk whose agent still works, she ends on the floor beside the chair, not back on the desk', () => {
  const c = toDesk();
  const up = stepUntil(c, world({ perched: [0] }), c.until, c => c.mode === 'desk', seq(0));   // the shortest stay
  stepUntil(c, world({ perched: [0] }), up + 40, c => c.mode === 'hop');   // her time is up: down
  const s = seedCat(c, l, [0], false, c.hop!.t0 + 100, seq(0.5));
  assert.deepEqual([s.mode, s.pt, s.goal], ['rest', perchFloor(l, 0).pt, null]);
});

test('petting: her sprite box wins over the agent behind her, a click beside her is still the agent', () => {
  // as pets.ts blit draws her: the sprite with its outline, bottom centre on the feet point; a startle 3 px up
  assert.deepEqual(catHit('walk', 100.4, 50), { id: CAT_HIT, x0: 92, y0: 40, x1: 108, y1: 51, z: Infinity });
  assert.deepEqual(catHit('sit', 100, 50), { id: CAT_HIT, x0: 95, y0: 39, x1: 106, y1: 51, z: Infinity });
  assert.deepEqual(catHit('loaf', 100, 50), { id: CAT_HIT, x0: 93, y0: 43, x1: 107, y1: 51, z: Infinity });
  assert.equal(catHit('startle', 100, 50).y0, 36);
  // on a working agent's desk: the agent (front-most of the agents) is behind her box
  const agentBox: Hit = { id: 'a1', x0: 92, y0: 20, x1: 108, y1: 52, z: 1e6 }, hits = [agentBox, catHit('sit', 100, 50)];
  assert.equal(hitAt(hits, { x: 100, y: 45 }), CAT_HIT);
  assert.equal(hitAt(hits, { x: 100, y: 25 }), 'a1');
  assert.equal(hitAt(hits, { x: 300, y: 25 }), null);
});

test('petting: 1–2 hearts a click, at most 3 alive, each rises 14 px and fades over 1.2 s', () => {
  const one = pet([], 1000, seq(0, 0));   // one heart, 5 px left
  assert.deepEqual(one, [{ t0: 1000, dx: -5 }]);
  const two = pet([], 1000, seq(0.99, 0.5, 0.5));   // two, the second a beat later
  assert.deepEqual(two, [{ t0: 1000, dx: 0 }, { t0: 1000 + HEART.gap, dx: 0 }]);
  assert.deepEqual(heartsAt(two, 1000), [{ dx: 0, up: 0, alpha: 1 }]);   // the second not yet
  assert.deepEqual(heartsAt(one, 1600), [{ dx: -5, up: 7, alpha: 0.5 }]);
  assert.deepEqual(heartsAt(one, 1000 + HEART.life), []);
  // repeated clicks add hearts, the oldest go past three; the faded ones are dropped first
  const many = pet(pet(two, 1100, seq(0.99, 0.5, 0.5)), 1200, seq(0, 0.5));
  assert.equal(many.length, HEART.max);
  assert.deepEqual(many.map(h => h.t0), [1100, 1100 + HEART.gap, 1200]);
  assert.deepEqual(pet(one, 1000 + HEART.life, seq(0, 0.5)), [{ t0: 1000 + HEART.life, dx: 0 }]);
});

// the bowl visits
const B = bowlsOf(l), fed = (o: Partial<CatWorld> = {}) => world({ bowls: B, meal: 1, ...o });   // slot 1 due, she is done with 0
const never = () => assert.fail('no rng draw expected');

test('mealDue / mealSlot: pure; two visits in a row 240–420 s apart; the slot due at a time; floors set out at different times', () => {
  for (const sid of ['a', 'sim-pixel-b', 'x'.repeat(40)]) {
    for (let k = 0; k < 200; k++) {
      const gap = mealDue(sid, k + 1) - mealDue(sid, k);
      assert.ok(gap >= MEAL.slot - MEAL.jitter && gap <= MEAL.slot + MEAL.jitter, `${sid} ${k}: ${gap}`);
      assert.equal(mealSlot(sid, mealDue(sid, k)), k); assert.equal(mealSlot(sid, mealDue(sid, k) - 1), k - 1);
    }
    assert.equal(mealDue(sid, 5), mealDue(sid, 5));
  }
  assert.notEqual(mealDue('a', 3), mealDue('b', 3));
});

test('stepCat: resting with a visit due she walks to the bowls at once, before her rest is over and with no draw; not when none is due', () => {
  const c = seedCat(null, l, [], false, 0, seq(0));
  stepCat(c, l, fed({ meal: 0 }), 40, 40, never);
  assert.equal(c.mode, 'rest');
  stepCat(c, l, fed(), 80, 40, never);
  assert.deepEqual([c.mode, c.bowl, c.spot], ['walk', 'go', B.eat]);
  assert.deepEqual(c.path[c.path.length - 1], B.eat.pt);
});

test('stepCat: eats 6–8 s, steps across, drinks 3–4 s, then walks to a rest spot; the food bowl half from 60 % of the meal till 3 s after she left, never empty', () => {
  const c = seedCat(null, l, [], false, 0, seq(0));
  const ate = stepUntil(c, fed(), 40, c => c.mode === 'bowl');
  assert.deepEqual([c.bowl, c.pt], ['eat', B.eat.pt]);
  assert.ok(c.until - ate >= 6000 && c.until - ate <= 8000);
  assert.deepEqual(catDraw(c, ate + 360, { x: 0, y: 0 }), { at: 'bowl', which: 'eat', pt: B.eat.pt, ms: 360 });
  const eatEnd = c.until, half = ate + 0.6 * (eatEnd - ate);
  assert.deepEqual([bowlFood(c, half - 1), bowlFood(c, half)], ['full', 'half']);
  stepUntil(c, fed(), ate, c => c.bowl === 'drink');
  assert.deepEqual([c.mode, c.pt], ['bowl', B.drink.pt]);
  assert.ok(c.until - c.since >= 3000 && c.until - c.since <= 4000);
  const left = stepUntil(c, fed(), c.since, c => c.bowl === null);
  assert.deepEqual([c.mode, c.meal], ['walk', 1]);
  assert.ok(catSpots(l).some(s => s.pt.x === c.spot.pt.x && s.pt.y === c.spot.pt.y));
  assert.deepEqual([bowlFood(c, left + CAT.refill - 1), bowlFood(c, left + CAT.refill)], ['half', 'full']);
  const back = stepUntil(c, fed(), left, c => c.mode === 'rest');
  stepCat(c, l, fed(), back + 40, 40, seq(0.7));   // slot 1 done: no second visit
  assert.notEqual(c.bowl, 'go');
});

test('stepCat: on a desk she stays till she hops down, then goes; startled, she runs first; at the bowls the robot does not move her', () => {
  const d = toDesk(), w = fed({ perched: [0] });
  stepUntil(d, w, d.until, c => c.mode === 'desk');
  const on = d.until;
  stepCat(d, l, w, on - 40, 40, never);
  assert.equal(d.mode, 'desk');
  stepUntil(d, w, on, c => c.mode !== 'desk' && c.mode !== 'hop');
  assert.deepEqual([d.mode, d.bowl], ['walk', 'go']);

  const c = seedCat(null, l, [], false, 0, seq(0)), robot = { pt: { x: c.pt.x + 20, y: c.pt.y }, moving: true, tour: 3 };
  stepCat(c, l, fed({ robot }), 40, 40, seq(0.5));   // the robot first: rideOdds 0.5 ≥ 0.25, a startle
  assert.equal(c.mode, 'startle');
  const rested = stepUntil(c, fed({ robot: far }), 80, c => {   // the startle, then the run to another room: no visit yet
    assert.deepEqual([c.mode === 'startle' || c.mode === 'run' || c.mode === 'rest', c.bowl], [true, null]);
    return c.mode === 'rest';
  });
  stepCat(c, l, fed({ robot: far }), rested + 40, 40, never);   // at rest: off to the bowls
  assert.deepEqual([c.mode, c.bowl], ['walk', 'go']);

  const { c: r, robot: ro } = rider();   // never during a ride
  stepCat(r, l, fed({ robot: ro }), 100 + CAT.hop + 40, 40, never);
  assert.deepEqual([r.mode, r.bowl], ['ride', null]);
  const stopped = { ...ro, moving: false };
  stepCat(r, l, fed({ robot: stopped }), 100 + CAT.hop + 80, 40, seq(0.5));   // the robot stops: she steps off and rests
  assert.deepEqual([r.mode, r.bowl], ['rest', null]);
  stepCat(r, l, fed({ robot: stopped }), 100 + CAT.hop + 120, 40, never);   // at rest: off to the bowls
  assert.deepEqual([r.mode, r.bowl], ['walk', 'go']);

  const e = seedCat(null, l, [], false, 0, seq(0));
  stepUntil(e, fed(), 40, c => c.mode === 'bowl');
  stepCat(e, l, fed({ robot: { pt: e.pt, moving: true, tour: 9 } }), e.since + 40, 40, never);
  assert.deepEqual([e.mode, e.bowl], ['bowl', 'eat']);
});

test('seedCat: fresh, the slot due now is not owed; on a tab return a visit under way is over, she rests, the bowl is full; missed slots: one visit', () => {
  const f = seedCat(null, l, [], false, 0, seq(0), 4);
  stepCat(f, l, fed({ meal: 4 }), 40, 40, never);
  assert.equal(f.mode, 'rest');

  const c = seedCat(null, l, [], false, 0, seq(0));
  stepUntil(c, fed(), 40, c => c.mode === 'bowl');
  const s = seedCat(c, l, [], false, c.until - 100, seq(0), 1);
  assert.deepEqual([s.mode, s.bowl, s.meal, bowlFood(s, c.until - 100)], ['rest', null, 1, 'full']);
  assert.ok(catSpots(l).some(r => r.pt.x === s.pt.x && r.pt.y === s.pt.y));

  const m = seedCat(null, l, [], false, 0, seq(0));
  const done = stepUntil(m, fed({ meal: 3 }), 40, c => c.bowl === null && c.meal === 3);
  const back = stepUntil(m, fed({ meal: 3 }), done, c => c.mode === 'rest');
  stepCat(m, l, fed({ meal: 3 }), back + 40, 40, seq(0.7));
  assert.notEqual(m.bowl, 'go');
});

test('seedCat: on a tab return with missed slots she rests out her first rest, then goes once', () => {
  const c = seedCat(null, l, [], false, 0, seq(0));
  const s = seedCat(c, l, [], false, 1000, seq(0), 3), until = s.until;   // back at 1 s, slots 1–3 missed; a 20 s rest
  const went = stepUntil(s, fed({ meal: 3 }), 1000, c => c.mode !== 'rest', never);
  assert.deepEqual([went, s.mode, s.bowl], [until, 'walk', 'go']);
  const done = stepUntil(s, fed({ meal: 3 }), went, c => c.bowl === null && c.meal === 3);
  const back = stepUntil(s, fed({ meal: 3 }), done, c => c.mode === 'rest');
  stepCat(s, l, fed({ meal: 3 }), back + 40, 40, seq(0.7));
  assert.notEqual(s.bowl, 'go');
});

test('catHit at a bowl: the 13×11 eating sprite\'s box', () => {
  assert.deepEqual(catHit('eat', 50, 100), { id: CAT_HIT, x0: 44, y0: 90, x1: 57, y1: 101, z: Infinity });
});

test('stepCat (she runs away from the fire): in the server room while it burns she startles and runs to another room; walking there she turns back; she never picks it till it is over', () => {
  const sv = catSpots(l).findIndex(s => s.room === 'server'), at = sv / catSpots(l).length + 1e-6;
  const c = seedCat(null, l, [], false, 0, seq(at, 0));   // resting at the server room's spot
  assert.equal(c.spot.room, 'server');
  stepCat(c, l, world(), 40, 40, seq(0.5));
  assert.equal(c.mode, 'rest', 'no fire: nothing changes');
  stepCat(c, l, world({ noServer: true }), 80, 40, seq(0.5));
  assert.equal(c.mode, 'startle');
  const t = stepUntil(c, world({ noServer: true }), 120, c => c.mode === 'rest', seq(0, 0.3, 0.6, 0.9));
  assert.notEqual(c.spot.room, 'server', `rests in ${c.spot.room} at ${t}`);
  const others = catSpots(l).slice(1), to = others.findIndex(s => s.room === 'server') / others.length + 1e-6;
  for (const r of SEEDS) {   // walking from spot 0 to the server room's spot: she startles where she is, then runs elsewhere
    const d = seedCat(null, l, [], false, 0, seq(0, 0));
    d.until = 0;
    stepCat(d, l, world(), 40, 40, seq(to));   // no desk: no deskOdds draw; the server spot among the others
    assert.deepEqual([d.mode, d.spot.room], ['walk', 'server']);
    run(d, world(), 80, 1000);
    stepCat(d, l, world({ noServer: true }), 1200, 40, seq(r));
    assert.equal(d.mode, 'startle');
    stepUntil(d, world({ noServer: true }), 1240, c => c.mode === 'rest', seq(r));
    assert.notEqual(d.spot.room, 'server');
  }
  const e = seedCat(null, l, [], false, 0, seq(0, 0));   // her rests while it burns: never the server room
  for (let k = 0; k < 40; k++) { stepUntil(e, world({ noServer: true }), k * 200_000, c => c.mode === 'rest' && c.path.length === 0, seq(k / 40, 0.5)); assert.notEqual(e.spot.room, 'server'); e.until = 0; }
});

test('stepCat (she runs away from the fire): walking or running to the server room when it catches fire, she turns away outside it and never sets foot in it', () => {
  const regionOf = (p: Pt) => regionAt(l, Math.floor(p.x / TILE), Math.floor(p.y / TILE));
  const others = catSpots(l).slice(1), to = others.findIndex(s => s.room === 'server') / others.length + 1e-6;
  const elsewhere = catSpots(l).filter(s => s.room !== 'main'), sv = elsewhere.findIndex(s => s.room === 'server') / elsewhere.length + 1e-6;
  const walker = () => {   // from spot 0, walking to the server room's spot (no desk: no deskOdds draw)
    const d = seedCat(null, l, [], false, 0, seq(0, 0));
    d.until = 0;
    stepCat(d, l, world(), 40, 40, seq(to));
    return d;
  };
  const runner = () => {   // from spot 0, startled by the passing robot (rideOdds 0.5: no ride), then running to the server room
    const d = seedCat(null, l, [], false, 0, seq(0, 0)), robot = { pt: { x: d.pt.x + 20, y: d.pt.y }, moving: true, tour: 7 };
    stepCat(d, l, world({ robot }), 40, 40, seq(0.5));
    stepCat(d, l, world(), 40 + CAT.startle, 40, seq(sv));
    return d;
  };
  for (const [mode, make] of [['walk', walker], ['run', runner]] as const) for (const ms of [0, 200, 400]) for (const r of SEEDS) {
    const d = make(), t0 = 1000;
    assert.deepEqual([d.mode, d.spot.room], [mode, 'server']);
    run(d, world(), t0 - ms, ms - 40);
    assert.equal(d.mode, mode);
    assert.notEqual(regionOf(d.pt), 'server', `${mode} ${ms} ms: already in it before the fire`);
    stepCat(d, l, world({ noServer: true }), t0, 40, seq(r));
    assert.equal(d.mode, 'startle', `${mode} ${ms} ms`);
    for (let t = t0 + 40; d.mode !== 'rest'; t += 40) {
      assert.ok(t < t0 + 120_000, 'never rests');
      stepCat(d, l, world({ noServer: true }), t, 40, seq(r));
      assert.notEqual(regionOf(d.pt), 'server', `${mode} ${ms} ms, rng ${r}: in the server room at ${t}`);
    }
    assert.notEqual(d.spot.room, 'server');
  }
});
