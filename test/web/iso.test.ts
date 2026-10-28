import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripPath } from '../../web/src/logic/coffee.ts';
import { isoK } from '../../web/src/logic/decor.ts';
import { TEXT } from '../../web/src/logic/i18n.ts';
import { clearFlames, IN_H, isoDepth, isoDeskBox, isoDeskTag, isoDoorBox, isoFlameBox, isoProj, isoRoomBox, isoSign, isoSofaCorner, isoView, isoWaitBalloons, shortHot, SIGN_GAP, signBox, T, toWorld, WALL_H } from '../../web/src/logic/iso.ts';
import { BUBBLE, doneSeats, ISO_TWO, isoFit, isoLine, LINE, officeLayout, queueSpot, sofaSeats, tailBox, tailX, WAIT_FULL, WAIT_MAX, waitAisle, waitBound, waitSpots, type Fit, type Layout, type Pt, type Rect } from '../../web/src/logic/layout.ts';
import { hitAt } from '../../web/src/logic/scene.ts';

const fit = (w: number, h: number, o: Partial<Fit> = {}): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0, ...o });
const MIN = officeLayout(fit(1114, 589));   // 34×18
const v = isoView(34, 18);

test('isoView: the 34×16 floor fits with padding left and right, none over the back wall or under the floor', () => {
  assert.deepEqual([v.depth, v.ox, v.oy], [16, 268, 52]);
  assert.deepEqual([v.w, v.h], [268 + 548 + 8, 52 + 50 * 8 + 6]);
  assert.equal(isoProj(v, -T, -T, WALL_H)[1], 0);   // the back wall's top corner (its thickness behind the floor)
});

test('isoProj: 2:1 diamond, z lifts straight up', () => {
  assert.deepEqual(isoProj(v, 0, 0, 0), [268, 52]);
  assert.deepEqual(isoProj(v, 1, 0, 0), [284, 60]);
  assert.deepEqual(isoProj(v, 0, 1, 0), [252, 60]);
  assert.deepEqual(isoProj(v, 0, 0, 10), [268, 42]);
});

test('toWorld: flat feet points map onto the iso floor', () => {
  assert.deepEqual(toWorld(MIN.desks[0].seat), { x: 2.5, y: 8.625 });
  assert.deepEqual(toWorld(MIN.doors[0]), { x: 0, y: 15 });
});

// the sofa against the Waiting room's left wall must not look sunk into it
test('isoSofaCorner: the Waiting room\'s side sofa stands off its left wall; every wall piece sorted after it that reaches its screen columns ends left of the corner drawn again over it, which spares its sitter', () => {
  for (const l of [MIN, ...[[1146, 613], [1312, 768], [1344, 736], [1504, 800], [2308, 1372], [3600, 1936]].map(([w, h]) => officeLayout(fit(w, h)))]) {
    const sc = isoSofaCorner(l), X = l.rooms.wait.x0 / 16, c = X - 1, D = isoDepth(sc.at.x, sc.at.y);
    assert.ok(sc.at.x - 0.45 - X >= 0.125, `${l.key}: its back ${((sc.at.x - 0.45 - X) * 16).toFixed(1)} px off the wall`);   // sofaSide's back at −0.45
    const s0 = sc.at.x - 0.5 - (sc.at.y + 1.05), s1 = sc.at.x + 0.5 - (sc.at.y - 1.05);   // its baked box's screen columns (x − y)
    let hits = 0;
    for (let r = 2; r < l.rows; r++) {
      const has = (q: number) => l.walls.has(`${c},${q}`);
      if (!has(r) || !(has(r - 1) || has(r + 1))) continue;   // a piece along y on the wall cell's right edge (iso.ts)
      const z = isoDepth(X, r - 2) + 0.5 - T / 2, p0 = X - T - (r - 1), p1 = X - (r - 2);
      if (z <= D || p1 <= s0 - 1 / 16 || p0 >= s1) continue;
      hits++;
      assert.ok(p1 <= sc.edge && sc.z > z, `${l.key}: the piece at row ${r} covers the sofa`);
    }
    assert.equal(hits, 1, l.key);
    const seat = toWorld(sofaSeats(l.sofa)[2]);
    assert.ok(seat.x - seat.y - 0.5 >= sc.edge, `${l.key}: the corner over its sitter`);
  }
});

test('iso hit-test: of two overlapping characters the nearer one wins', () => {
  const near = toWorld({ x: 104, y: 256 }), far = toWorld({ x: 96, y: 248 }); // same screen x, far is one step deeper
  const box = (id: string, p: { x: number; y: number }) => { const [sx, sy] = isoProj(v, p.x, p.y, 0); return { id, x0: sx - 8, y0: sy - 32, x1: sx + 8, y1: sy, z: isoDepth(p.x, p.y) }; };
  const [sx, sy] = isoProj(v, near.x, near.y, 0);
  assert.equal(hitAt([box('far', far), box('near', near)], { x: sx, y: sy - 20 }), 'near');
});

// iso Waiting room balloons at the k real windows get: officeLayout over the office area at dpr 1, 1.25,
// 1.5 and 2, k = isoK (textScale(views.iso.css) / css); with the 125 % laptop (1366×768: k 2.5) and 1920×1080 at 150 % (k 3);
// and iso's fit (layout.ts isoFit, the largest zoom step that fits) at 1920×945, 1366×657,
// 1680×939 (k 1.625), 1280×630 at 150 % and 1536×756 at 125 % (k 2), the office areas of those CSS viewports
const SCALES = [...[...[[1114, 589], [1146, 613], [1028, 714], [2308, 1372]].flatMap(([w, h]) => [1, 1.25, 1.5, 2].map(dpr => [w, h, dpr])), [873, 482, 1.25], [1044, 566, 1.5]]
  .map(([w, h, dpr]) => officeLayout(fit(w, h, { dpr, sb: 15, frame: true }))),
  ...[[1700, 901, 1], [1146, 613, 1], [1460, 895, 1], [1060, 586, 1.5], [1316, 712, 1.25]].map(([w, h, dpr]) => isoFit(officeLayout(fit(w, h, { dpr, sb: 15, frame: true })), w, h, dpr))]
  .map(l => [l, isoK(l)] as const);
test('iso balloons: the windows reach every iso k, the 125 % and 150 % ones and the fitted ones included', () => {
  assert.deepEqual([...new Set(SCALES.map(([, k]) => k))].sort(), [1, 1.25, 1.625, 2, 2.5, 3]);
});
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
/** a meets b by more than float error (a sign moved just off a desk may touch it at 1e-13 px) */
const covers = (a: Rect, b: Rect) => meet(a, { x0: b.x0 + 1e-9, y0: b.y0 + 1e-9, x1: b.x1 - 1e-9, y1: b.y1 - 1e-9 });
/** The door signs' boxes as the office places them: in door order, each off the ones before it (logic/iso.ts isoSign). */
const placed = (l: Layout, k: number, lang: 'en' | 'tr') => l.doors.reduce<{ id: string; r: Rect }[]>((out, d) => {
  const text = TEXT[lang][`door.${d.id}`];
  return [...out, { id: d.id, r: signBox(isoSign(l, d, k, text, out.map(o => o.r)), text, k) }];
}, []);
/** Whether box b shows any of the corridor's floor: a pixel centre of b lands on the corridor floor (its 2 rows behind
 *  the Waiting room's back wall, x from the corridor's start) not hidden by that wall (24 px high, T in from the corridor's front). */
function overHall(l: Layout, b: Rect): boolean {
  const v = isoView(l.cols, l.rows), x0 = l.rooms.hall.x0 / 16, y0 = l.k - 1, y1 = l.k + 1 + T - 24 / 16;
  for (let sy = Math.floor(b.y0); sy < b.y1; sy++) for (let sx = Math.floor(b.x0); sx < b.x1; sx++) {
    const d = (sx + 0.5 - v.ox) / 16, s = (sy + 0.5 - v.oy) / 8, x = (s + d) / 2, y = (s - d) / 2;   // the floor point under it
    if (x >= x0 && x <= l.cols && y >= y0 && y < y1) return true;
  }
  return false;
}
/** n waiters at their spots (the ones in `out` away at their coffee table), every other agent seated; their balloons. */
function scene(l: Layout, k: number, n: number, out: number[] = []) {
  const v = isoView(l.cols, l.rows), scr = (p: Pt): Pt => { const w = toWorld(p), [x, y] = isoProj(v, w.x, w.y, 0); return { x, y }; };
  const sprite = (p: Pt): Rect => ({ x0: p.x - 8, y0: p.y - 37, x1: p.x + 8, y1: p.y });
  // a sofa sitter is drawn LIFT_SOFA (5 px) up (components/office/iso.ts)
  const sofa = sofaSeats(l.sofa), lift = (p: Pt, q: Pt): Pt => sofa.some(s => s.x === p.x && s.y === p.y) ? { x: q.x, y: q.y - 5 } : q;
  const waiters = waitSpots(n, l).map((home, i) => {
    const at = out.includes(i) ? tripPath(home, l.stations.wait, waitAisle(l, home)).at(-1)! : home;
    return { id: 'w' + i, home, at, feet: lift(at, scr(at)), out: out.includes(i) };
  });
  const sprites = [...waiters.map(w => w.feet), ...[...l.desks.map(d => d.seat), l.foreman.seat, ...doneSeats(l), ...[0, 1, 2].map(i => queueSpot(i, l))].map(scr)].map(sprite);
  return { waiters, sprites, ...isoWaitBalloons(waiters, sprites, l, k) };
}
function check(l: Layout, k: number, n: number, out: number[] = []) {
  const { waiters, sprites, boxes } = scene(l, k, n, out), tag = `${l.key} k=${k} n=${n} out=${out}`;
  for (const [i, w] of waiters.entries()) {
    const b = boxes.get(w.id);
    if (!b) continue;
    assert.ok(!overHall(l, b), `${tag} ${w.id} over the corridor`);
    // the tail (styles.css .tail: 7×3 text px under the box at tailX, over it when `up`) points at its own agent and
    // crosses no other; an `up` box is under its agent's feet
    const x = tailX(b, w.feet.x), tl = tailBox(b, x, k, b.up);
    assert.ok(!b.up || b.y0 >= w.feet.y, `${tag} ${w.id}'s up balloon is not under its feet`);
    sprites.forEach((r, j) => {
      assert.ok(!meet(b, r), `${tag} ${w.id} covers agent ${j}`);
      if (j !== i) assert.ok(!meet(tl, r), `${tag} ${w.id}'s tail crosses agent ${j}`);
    });
  }
  return boxes;
}

test('iso balloons: one to three waiters all get a balloon, over no agent and off the corridor, at every k', () => {
  for (const [l, k] of SCALES) {
    for (let n = 1; n <= WAIT_FULL; n++) {
      const boxes = check(l, k, n);
      for (let i = 0; i < n; i++) assert.ok(boxes.get('w' + i), `${l.key} k=${k} n=${n} w${i} has a balloon`);
    }
  }
});

test('iso balloons: one or two waiters\' tails point at them, over the head or up from under the feet (150 %)', () => {
  for (const [l, k] of SCALES) for (let n = 1; n <= 2; n++) {
    const { waiters, boxes } = scene(l, k, n);
    for (const w of waiters) { const b = boxes.get(w.id)!; assert.ok(b.up ? b.y0 >= w.feet.y : b.y1 <= w.feet.y - 32, `${l.key} k=${k} n=${n} ${w.id}: ${JSON.stringify(b)}`); }
  }
});

test('iso balloons: inside the Waiting room while they fit there (one or two waiters), over the main office only when not', () => {
  for (const [l, k] of SCALES) {
    const room = isoRoomBox(isoView(l.cols, l.rows), waitBound(l), IN_H);
    for (let n = 1; n <= 2; n++) for (const [id, b] of scene(l, k, n).boxes) assert.ok(b!.x0 >= room.x0, `${l.key} k=${k} n=${n} ${id} left of the Waiting room`);
  }
});

test('iso balloons: a one-line balloon is as wide as its full text where that fits, 2·LINE.w at least (150 %: not ~10 chars)', () => {
  for (const [l, k] of SCALES) {
    if (!isoLine(l.views.iso, k)) continue;   // two lines up to ISO_TWO under the fit
    for (let n = 1; n <= WAIT_FULL; n++) for (const [id, b] of scene(l, k, n).boxes) assert.ok(b!.x1 - b!.x0 >= Math.min(LINE.w * k, 2 * LINE.w), `${l.key} k=${k} n=${n} ${id}`);
    const [b] = scene(l, k, 1).boxes.values();
    assert.equal(b!.x1 - b!.x0, LINE.w * k, `${l.key} k=${k}: one waiter's balloon holds LINE.chars`);
  }
});

test('iso balloons: four to six waiters, compact where it fits, every shown balloon over no agent and off the corridor', () => {
  for (const [l, k] of SCALES) {
    for (let n = WAIT_FULL + 1; n <= WAIT_MAX; n++) check(l, k, n);
  }
  const l = officeLayout(fit(1700, 1036));   // iso 2×, k 1
  assert.ok([4, 5, 6].some(n => scene(l, 1, n).compact), 'compact fits at 2× for some of four to six');
});

test('iso balloons: four to six go compact, all with a box, everywhere they did before balloons went under the feet (34×20 k 2: four, as the Done lounge\'s café tables crowd it)', () => {
  // C: four, five, six compact. Before the tails up: 34x20 k2 C--, 43x22 k2.5 C--, k 1 and 1.25 CCC; the rest ---. The
  // Done lounge seating only its sofa and café tables (34x20 k2 CC-), then all café tables,
  // more sitters by the Waiting room's balloons: C--. Then the sofa set in the Waiting room, its first five waiters seated close together:
  // 34x18 k2.5 and 34x20 k3 C--, 34x18 k3 CC-; 42x21 and 43x22 k2.5 ---
  const want: Record<string, string> = { '34x18 2': 'C--', '42x21 2.5': '---', '34x18 3': 'CC-', '43x22 2.5': '---', '34x20 2': 'C--', '38x26 2.5': '---',
    '34x20 3': 'C--', '46x25 1': 'CCC', '58x31 1.25': 'CCC', '34x18 2.5': 'C--',
    // iso's fit, two lines up to k 1.75 (1920×945: 52×27 k 1.625), one above (125 %: 50×26 k 2)
    '52x27 1.625': 'CCC', '34x18 1.625': 'CCC', '44x26 1.625': 'CCC', '50x26 2': 'CCC' };
  for (const [l, k] of SCALES) {
    const got = [4, 5, 6].map(n => {
      const { compact, boxes } = scene(l, k, n);
      assert.equal(boxes.size, compact ? n : WAIT_FULL, `${l.key} k=${k} n=${n}`);
      if (compact) assert.ok([...boxes.values()].every(Boolean), `${l.key} k=${k} n=${n}: compact but one has no box`);
      return compact ? 'C' : '-';
    }).join('');
    assert.equal(got, want[`${l.key} ${k}`], `${l.key} k=${k}`);
  }
});

// under the fit (isoFit's text ratio) two lines up to ISO_TWO; a whole-px window (no fit ratio, as at
// 2560×1440 at 125 %) keeps today's rule, one line above k 1
test('iso balloons: two lines up to k 1.75 under the fit, a whole-px window one line above k 1', () => {
  const fitted = (w: number, h: number, dpr: number) => isoFit(officeLayout(fit(w, h, { dpr, sb: 15, frame: true })), w, h, dpr);
  const whole = (w: number, h: number, dpr: number) => officeLayout(fit(w, h, { dpr, sb: 15, frame: true }));
  const cases: [Layout, string][] = [[fitted(1700, 901, 1), 'fit 52x27 1.625 two'], [fitted(1700, 901, 1.5), 'fit 38x20 1.375 two'], [fitted(1060, 586, 1.5), 'fit 34x18 2 line'],
    [fitted(1316, 712, 1.25), 'fit 50x26 2 line'], [whole(2308, 1372, 1), 'whole 46x25 1 two'], [whole(2308, 1372, 1.25), 'whole 58x31 1.25 line'], [whole(1460, 895, 1.5), 'whole 44x23 1.5 line']];
  for (const [l, want] of cases) {
    const k = isoK(l), form = (n: number, compact: boolean) => [...scene(l, k, n).boxes.values()].map(b => b!.y1 - b!.y0 === LINE.h * k ? 'line' : b!.y1 - b!.y0 === (compact ? BUBBLE.compact : BUBBLE.full) * k ? 'two' : '?');
    assert.equal(`${l.views.iso.k === undefined ? 'whole' : 'fit'} ${l.key} ${k} ${form(1, false)}`, want);
    for (let n = 1; n <= WAIT_MAX; n++) { check(l, k, n); assert.ok(form(n, scene(l, k, n).compact).every(f => f === want.split(' ')[3]), `${want} n=${n}`); }
  }
  assert.equal(ISO_TWO, 1.75);
});

test('isoDeskTag + shortHot: with every desk hot the crowded tags drop their tool line, end 2 px over the flame, and desks a row apart then keep apart (150 %: k 3)', () => {
  for (const [l, k] of SCALES) {
    const tag = `${l.key} k=${k}`, w = k * (11 * 3.6 + 34);   // "test runner 🔥" (iso.ts labelBox)
    const box = (seat: Pt, h: number): Rect => { const [x, y] = isoDeskTag(l, seat, k, h); return { x0: x - w / 2, y0: y, x1: x + w / 2, y1: y + h * k }; };
    const short = shortHot(l.desks.map(d => box(d.seat, 19)), []), boxes = l.desks.map((d, i) => box(d.seat, short[i] ? 10 : 19));
    l.desks.forEach((d, i) => {
      const flame = isoDeskTag(l, d.seat, k)[1] + 18;   // the flame's base, 18 px under a cool tag's top
      assert.equal(boxes[i].y1, flame - 22, `${tag} desk ${i} ends 22 px over its flame base`);
      assert.equal(isoDeskTag(l, d.seat, k, 19)[1] + 19 * k, flame - 22);
    });
    if (k === 1 || k >= 2) assert.equal(short.some(Boolean), k >= 2, `${tag}: crowded only where text is scaled up (k ≥ 2)`);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (short[i] && short[j] && Math.abs(a.y1 - b.y1) >= 32) assert.ok(!meet(a, b), `${tag}: desks ${i} and ${j} a row apart meet`);
    }
  }
});

test('clearFlames: a hot tag over another hot desk\'s flame moves sideways, else up, off flames, tags and labels; else stays', () => {
  const r = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 }), W = 400;
  const own = r(140, 52, 160, 80), next = r(80, 30, 100, 58);   // its desk's flame, a hot neighbour's up-left of it
  assert.deepEqual(clearFlames([r(60, 20, 180, 50)], [own], [], W, 64), [{ dx: 0, dy: 0 }]);                  // covers none: stays
  assert.deepEqual(clearFlames([r(60, 20, 180, 50), r(0, 0, 10, 10)], [own, next], [], W, 64)[0], { dx: 40, dy: 0 });   // right, off it
  // the right blocked by a sign in its row: up over the sign, then right off the flame
  assert.deepEqual(clearFlames([r(60, 40, 180, 50), r(0, 0, 10, 10)], [own, r(80, 30, 100, 45)], [r(130, 35, 400, 50)], W, 64)[0], { dx: 40, dy: -15 });
  assert.deepEqual(clearFlames([r(60, 40, 180, 50), r(0, 0, 10, 10)], [own, r(80, 30, 100, 45)], [r(40, 0, 400, 50)], W, 64)[0], { dx: 0, dy: 0 });    // nowhere under the top: stays
  assert.deepEqual(clearFlames([r(60, 40, 180, 50), r(0, 0, 10, 10)], [own, r(80, 30, 100, 45)], [r(130, 35, 400, 50)], W, 8)[0], { dx: 0, dy: 0 });    // lift capped
});

test('clearFlames: a burning rack flame is one more flame to keep clear of, owned by no tag', () => {
  const r = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 }), W = 400, own = r(140, 52, 160, 80);
  assert.deepEqual(clearFlames([r(60, 20, 180, 50)], [own], [], W, 64, [r(80, 30, 100, 58)]), [{ dx: 40, dy: 0 }]);
  assert.deepEqual(clearFlames([r(60, 20, 180, 50)], [own], [], W, 64, []), [{ dx: 0, dy: 0 }]);
});

test('clearFlames: with a row of desks hot every flame shows, each tag within half its width and 64 px of its spot, no two meeting (every k)', () => {
  for (const [l, k] of SCALES) for (const row of [[0, 1, 2], [3, 4, 5]]) {
    const tag = `${l.key} k=${k} desks ${row}`, w = k * (11 * 3.6 + 34), desks = row.map(i => l.desks[i]);
    const box = (seat: Pt, h: number): Rect => { const [x, y] = isoDeskTag(l, seat, k, h); return { x0: x - w / 2, y0: y, x1: x + w / 2, y1: y + h * k }; };
    const short = shortHot(desks.map(d => box(d.seat, 19)), []), boxes = desks.map((d, i) => box(d.seat, short[i] ? 10 : 19));
    const flames = desks.map(d => isoFlameBox(l, d.seat)), moves = clearFlames(boxes, flames, [], isoView(l.cols, l.rows).w, 64);
    const at = boxes.map((b, i) => ({ x0: b.x0 + moves[i].dx, y0: b.y0 + moves[i].dy, x1: b.x1 + moves[i].dx, y1: b.y1 + moves[i].dy }));
    at.forEach((b, i) => {
      flames.forEach((f, j) => assert.ok(!meet(b, f), `${tag}: desk ${row[i]}'s tag covers desk ${row[j]}'s flame`));
      assert.ok(Math.abs(moves[i].dx) <= w / 2 + 1 && moves[i].dy <= 0 && moves[i].dy >= -64, `${tag}: desk ${row[i]} moved far`);
      at.forEach((o, j) => assert.ok(j === i || !meet(b, o), `${tag}: desks ${row[i]} and ${row[j]} meet`));
    });
  }
});

test('iso door signs: none comes within SIGN_GAP of another sign or a closed door, at every k, in both languages', () => {
  for (const [l, k] of [...SCALES, [officeLayout(fit(2560, 1440)), 1] as const, [officeLayout(fit(3840, 2160)), 1] as const]) {
    const e = SIGN_GAP * k / 2, grow = (r: Rect): Rect => ({ x0: r.x0 - e, y0: r.y0 - e, x1: r.x1 + e, y1: r.y1 + e });   // every box by half the gap
    const doors = l.doors.map(d => ({ id: d.id, r: grow(isoDoorBox(l, d)) }));
    for (const lang of ['en', 'tr'] as const) {
      const signs = placed(l, k, lang).map(({ id, r }) => ({ id, r: grow(r) }));
      const tag = `${l.key} k=${k} ${lang}`;
      signs.forEach((a, i) => signs.slice(i + 1).forEach(b => assert.ok(!meet(a.r, b.r), `${tag}: ${a.id} sign meets ${b.id} sign`)));
      for (const s of signs) for (const d of doors) assert.ok(!meet(s.r, d.r), `${tag}: ${s.id} sign meets ${d.id} door`);
    }
  }
});

test('iso server sign: covers no desk nor the agent at it, still over its door, on the 34×18, 35×19, 35×18 and 47×25 grids at dpr 1, 1.5 (k 3) and 2', () => {
  const keys: string[] = [];
  for (const [w, h] of [[1114, 589], [1044, 566], [1146, 613], [1700, 1036], [2308, 1372]]) for (const dpr of [1, 1.5, 2]) {
    const l = officeLayout(fit(w, h, { dpr })), k = isoK(l), door = isoDoorBox(l, l.doors.find(o => o.id === 'server')!);
    keys.push(`${l.key} k${k}`);
    for (const lang of ['en', 'tr'] as const) {
      const s = placed(l, k, lang).find(o => o.id === 'server')!.r, tag = `${l.key} k=${k} ${lang}`;
      for (const x of l.desks) assert.ok(!covers(s, isoDeskBox(l, x.seat)), `${tag}: the sign covers the ${x.room} desk at ${x.cx},${x.y}`);
      assert.ok(s.y1 <= door.y0 && s.x0 - (s.x1 - s.x0) < door.x1 && door.x0 < s.x1 + (s.x1 - s.x0), `${tag}: the sign left its door`);
    }
  }
  assert.ok(keys.includes('34x18 k3'), keys.join());
});

test('iso door signs: none covers a desk or the agent at it, each by its door, at every k (1366: 34×18 at k 2; 150 %: at k 3)', () => {
  assert.ok(['34x18 k2', '34x18 k3'].every(x => SCALES.some(([l, k]) => `${l.key} k${k}` === x)));
  for (const [l, k] of SCALES) for (const lang of ['en', 'tr'] as const) for (const { id, r } of placed(l, k, lang)) {
    const tag = `${l.key} k=${k} ${lang} ${id}`, door = isoDoorBox(l, l.doors.find(o => o.id === id)!), w = r.x1 - r.x0;
    for (const x of l.desks) assert.ok(!covers(r, isoDeskBox(l, x.seat)), `${tag}: the sign covers the ${x.room} desk at ${x.cx},${x.y}`);
    assert.ok(r.y0 < door.y1 && r.x0 - w < door.x1 && door.x0 < r.x1 + w, `${tag}: the sign left its door`);
  }
});

test('iso balloons: a waiter out for coffee has none, the others keep theirs, off the corridor', () => {
  for (const [l, k] of SCALES) {
    for (const out of [0, 1, 2]) {
      const boxes = check(l, k, WAIT_FULL, [out]);
      assert.ok(!boxes.get('w' + out), `${l.key} k=${k} w${out} out has no balloon`);
      for (let i = 0; i < WAIT_FULL; i++) if (i !== out) assert.ok(boxes.get('w' + i), `${l.key} k=${k} out=${out} w${i} keeps its balloon`);
    }
  }
});

test('isoSign: from its first spot too a sign keeps SIGN_GAP off the signs before it (52×27, 46×25, 45×24 at k 1.5–2.5: the Waiting room\'s under the server sign)', () => {
  for (const [w, h] of [[1700, 901], [2340, 1262], [2340, 1226]]) for (const k of [1.5, 1.625, 1.75, 2, 2.5]) {
    const l = officeLayout(fit(w, h, { sb: 15, frame: true })), e = SIGN_GAP * k / 2, grow = (r: Rect): Rect => ({ x0: r.x0 - e, y0: r.y0 - e, x1: r.x1 + e, y1: r.y1 + e });
    for (const lang of ['en', 'tr'] as const) {
      const signs = placed(l, k, lang);
      signs.forEach((a, i) => signs.slice(i + 1).forEach(b => assert.ok(!covers(grow(a.r), grow(b.r)), `${l.key} k=${k} ${lang}: ${a.id} sign meets ${b.id} sign`)));
    }
  }
});
