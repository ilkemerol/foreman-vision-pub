import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatMem, cloudAt, cloudBox, cloudLook, fullTables, LIFE, stepChat, STEP, talkCount, talkGap, talkMs } from '../../web/src/logic/chat.ts';
import { isoProj, toWorld } from '../../web/src/logic/iso.ts';
import { boardOf, CAFE_DX, isoView, officeLayout, type Fit, type Layout, type Pt, type Rect } from '../../web/src/logic/layout.ts';
import type { Walker } from '../../web/src/logic/motion.ts';
import type { Place } from '../../web/src/logic/scene.ts';

const fit = (w: number, h: number): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0 });
const LAYOUTS = [[1114, 589], [1146, 613], [2308, 1372], [3000, 1700], [3600, 2000]].map(([w, h]) => officeLayout(fit(w, h)));   // 34×18, 35×19, 47×25, 61×33, 74×39
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const TICK = 40;

const place = (pt: Pt, kind: Place['kind'] = 'done'): Place => ({ spot: { room: 'done', pt, aisle: pt.y }, kind, pose: 'read', face: 'down', alpha: 1, desk: null, bubble: null, label: '', sprite: 0 });
const walker = (pt: Pt, moving = false): Walker => ({ pt, path: [], spot: { room: 'done', pt, aisle: pt.y }, face: 'down', dir: 'down', moving, bornAt: 0, failAt: null, burnAt: null, payAt: null, label: '', restAt: 0 });
/** Table i of l with both seats taken (ids `${i}a`, `${i}b`). */
function seat(l: Layout, i: number, places = new Map<string, Place>(), walkers = new Map<string, Walker>()) {
  const t = l.cafes[i];
  for (const [id, x] of [[`${i}a`, t.x - CAFE_DX], [`${i}b`, t.x + CAFE_DX]] as const) { const pt = { x, y: t.y }; places.set(id, place(pt)); walkers.set(id, walker(pt)); }
  return { places, walkers };
}

test('talkGap, talkCount, talkMs: 30–60 s, 3 or 4 clouds, 4.0 or 5.4 s; the same key gives the same clock', () => {
  for (let i = 0; i < 400; i++) {
    const key = `${i % 7}:a${i}|b${i}`, n = i % 5;
    assert.ok(talkGap(key, n) >= 30_000 && talkGap(key, n) < 60_000);
    assert.ok([3, 4].includes(talkCount(key, n)));
    assert.ok([4000, 5400].includes(talkMs(key, n)));
    assert.equal(talkGap(key, n), talkGap(key, n));
  }
});

test('fullTables: both seats at rest; a walker, one out for coffee, a burning one, one off its seat or a lone sitter does not fill a table', () => {
  const l = LAYOUTS[2], { places, walkers } = seat(l, 0); seat(l, 1, places, walkers);
  assert.deepEqual([...fullTables(l, places, walkers, new Set()).entries()], [[0, ['0a', '0b']], [1, ['1a', '1b']]]);
  assert.deepEqual([...fullTables(l, places, walkers, new Set(['1b'])).keys()], [0]);
  walkers.get('0a')!.moving = true;
  assert.deepEqual([...fullTables(l, places, walkers, new Set()).keys()], [1]);
  walkers.get('0a')!.moving = false; places.set('1a', { ...places.get('1a')!, kind: 'burn' });
  assert.deepEqual([...fullTables(l, places, walkers, new Set()).keys()], [0]);
  walkers.get('0b')!.pt = { x: 10, y: 10 };
  assert.deepEqual([...fullTables(l, places, walkers, new Set()).keys()], []);
  places.delete('0b'); walkers.delete('0b');
  assert.deepEqual([...fullTables(l, places, walkers, new Set()).keys()], []);
});

/** Ten minutes of one full table in TICK steps from `from`: each cloud's start and side. */
function run(m = chatMem(), from = 0, ms = 600_000, full = new Map([[3, ['x', 'y'] as [string, string]]])) {
  const clouds: { at: number; side: 0 | 1 }[] = [];
  let prev: { side: 0 | 1; u: number } | null = null;
  for (let now = from; now < from + ms; now += TICK) {
    stepChat(m, full, now);
    const c = cloudAt(m.talks.get(3)!, now);
    if (c && (!prev || c.u < prev.u || c.side !== prev.side)) clouds.push({ at: now - c.u, side: c.side });
    prev = c;
  }
  return clouds;
}

test('stepChat / cloudAt: the first talk 30–60 s after the table fills; 3–4 clouds 1.4 s apart taking turns; 30–60 s between talks', () => {
  const clouds = run();
  assert.ok(clouds[0].at >= 30_000 && clouds[0].at < 60_000 + TICK, `first at ${clouds[0].at}`);
  const talks: { at: number; side: 0 | 1 }[][] = [];
  for (const c of clouds) { const t = talks[talks.length - 1]; if (t && c.at - t[t.length - 1].at <= STEP + TICK) t.push(c); else talks.push([c]); }
  assert.ok(talks.length >= 8, `${talks.length} talks in 10 min`);
  for (const t of talks) {
    assert.ok(t.length === 3 || t.length === 4, `${t.length} clouds`);
    t.forEach((c, k) => { if (k) { assert.notEqual(c.side, t[k - 1].side); assert.ok(Math.abs(c.at - t[k - 1].at - STEP) <= TICK); } });
  }
  for (let i = 1; i < talks.length; i++) {
    const a = talks[i - 1], gap = talks[i][0].at - (a[a.length - 1].at + LIFE);
    assert.ok(gap >= 30_000 - TICK && gap < 60_000 + TICK, `gap ${gap}`);
  }
});

test('stepChat: a table that empties loses its cloud at once and starts over when full again; a new pair and a reseed (frame gap) start over too', () => {
  const m = chatMem(), full = new Map([[3, ['x', 'y'] as [string, string]]]);
  for (let now = 0; now <= 61_000; now += TICK) stepChat(m, full, now);   // into the first talk at the latest
  stepChat(m, new Map(), 61_040);
  assert.equal(m.talks.size, 0);
  stepChat(m, full, 61_080);
  assert.ok(m.talks.get(3)!.at >= 61_080 + 30_000);
  stepChat(m, new Map([[3, ['x', 'z']]]), 61_120);
  assert.ok(m.talks.get(3)!.at >= 61_120 + 30_000 && m.talks.get(3)!.pair === 'x|z');
  stepChat(m, new Map([[3, ['x', 'z']]]), 200_000);   // back to the tab after 139 s: no burst
  assert.ok(m.talks.get(3)!.at >= 230_000);
});

test('cloudLook: puff, a 1 px pop, typing 1-2-3, a three-step fade rising 1 px; reduced motion: still, all three dots', () => {
  assert.deepEqual([0, 69, 70, 149, 150, 370, 590, 810, 949, 950, 1034, 1118, 1199].map(u => { const c = cloudLook(u, false); return [+c.puff, c.lift, c.alpha, c.dots]; }),
    [[1, 0, 1, 0], [1, 0, 1, 0], [0, 1, 1, 1], [0, 1, 1, 1], [0, 0, 1, 1], [0, 0, 1, 2], [0, 0, 1, 3], [0, 0, 1, 1], [0, 0, 1, 1], [0, 1, 0.7, 3], [0, 1, 0.45, 3], [0, 1, 0.2, 3], [0, 1, 0.2, 3]]);
  for (const u of [0, 100, 600, 1100]) assert.deepEqual(cloudLook(u, true), { puff: false, lift: 0, alpha: 1, dots: 3 });
});

test('cloudBox: clear of the ✓, of the partner and every other sitter, of the board, inside the office, at rest and lifted 1 px; flat and iso on every grid', () => {
  for (const l of LAYOUTS) {
    const v = isoView(l.cols, l.rows), board = boardOf(l);
    const seats = l.cafes.flatMap(t => [{ x: t.x - CAFE_DX, y: t.y }, { x: t.x + CAFE_DX, y: t.y }]);
    const iso = (p: Pt): Pt => { const w = toWorld(p), [x, y] = isoProj(v, w.x, w.y, 0); return { x: Math.round(x), y: Math.round(y) - 3 }; };   // LIFT_SIT
    for (const [style, at, W, H, top] of [['flat', (p: Pt) => p, l.w, l.h, 32], ['iso', iso, v.w, v.h, 37]] as const) {
      const sprites = seats.map(p => { const q = at(p); return { p, r: { x0: q.x - 8, y0: q.y - top, x1: q.x + 8, y1: q.y } }; });
      for (const [i, p] of seats.entries()) {
        const q = at(p), b = cloudBox(q.x, q.y, (i % 2) as 0 | 1);
        for (const lift of [0, 1]) {   // at rest and in the pop's and the fade's 1 px rise (cloudLook)
          const c = { ...b, y0: b.y0 - lift, y1: b.y1 - lift }, what = `${l.key} ${style} seat ${p.x},${p.y} lift ${lift}`;
          assert.ok(c.x0 >= 0 && c.y0 >= 0 && c.x1 <= W && c.y1 <= H, `${what}: inside`);
          assert.ok(!meet(c, { x0: q.x - 5, y0: q.y - 36, x1: q.x + 5, y1: q.y - 26 }), `${what}: its ✓`);
          for (const s of sprites) if (s.p !== p) assert.ok(!meet(c, s.r), `${what}: meets the sitter at ${s.p.x},${s.p.y}`);
          if (style === 'flat') assert.ok(!meet(c, board), `${what}: the board`);
        }
      }
    }
  }
});
