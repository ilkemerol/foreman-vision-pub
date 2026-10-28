import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cornerSpots } from '../../web/src/logic/corner.ts';
import { toWorld } from '../../web/src/logic/iso.ts';
import { flatLights, isoLeftGlass, lampAt, libraryWallDecor, windowGlass } from '../../web/src/logic/lights.ts';
import { doneSeats, officeLayout, type Fit, type Rect } from '../../web/src/logic/layout.ts';

const fit = (w: number, h: number): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0 });
const LAYOUTS = [fit(1114, 589), fit(1146, 613), fit(1700, 1036), fit(2308, 1372)].map(f => officeLayout(f));   // minimum; 1366, 1920, 2560 boxes
const SIZE: Record<string, { w: number; h: number }> = {   // web/public/pixel-agents PNG sizes
  BOOKSHELF: { w: 32, h: 16 }, WHITEBOARD: { w: 32, h: 32 }, SMALL_PAINTING: { w: 16, h: 32 }, LARGE_PAINTING: { w: 32, h: 32 },
  HANGING_PLANT: { w: 16, h: 32 }, DOUBLE_BOOKSHELF: { w: 32, h: 32 },
};
const within = (a: Rect, b: Rect) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

test('libraryWallDecor: every third piece a leaded window, inside the library\'s wall', () => {
  for (const l of LAYOUTS) {
    const d = libraryWallDecor(l), lib = l.rooms.library;
    d.forEach((p, i) => assert.equal(p.name, i % 3 === 2 ? 'lead' : 'DOUBLE_BOOKSHELF'));
    for (const p of d) assert.ok(p.x >= lib.x0 && p.x + (p.name === 'lead' ? 12 : 32) <= lib.x1 - 2);
  }
});

test('windowGlass: the library\'s leaded windows and every main office window, on the top wall, never on the clock', () => {
  for (const l of LAYOUTS) {
    const g = windowGlass(l, n => SIZE[n]), clock = cornerSpots(l).clock;
    assert.ok(g.filter(w => w.lead).length >= 1);
    for (const w of g) {
      assert.equal(w.y0, 6); assert.equal(w.y1, 24); assert.equal(w.x1 - w.x0, w.lead ? 10 : 20);
      assert.ok(!meet(w, clock));
    }
  }
  assert.equal(windowGlass(LAYOUTS[0], n => SIZE[n]).filter(w => !w.lead).length, 1);   // the smallest main office has one window
  assert.ok(windowGlass(officeLayout(fit(3000, 1700)), n => SIZE[n]).filter(w => !w.lead).length >= 1);   // 61 columns: the first main office window
});

test('isoLeftGlass: at least one left wall window, every glass 1.4 tiles, clear of the entrance', () => {
  for (const l of LAYOUTS) {
    const g = isoLeftGlass(l), ey = toWorld(l.doors[0]).y;
    assert.ok(g.length >= 1);
    for (const [a, b] of g) { assert.ok(Math.abs(b - a - 1.4) < 1e-9); assert.ok(b < ey - 1); }
  }
});

test('lampAt: on its desk top, left of the monitor, clear of the cat\'s perch (cx + 15)', () => {
  for (const d of LAYOUTS[0].desks) {
    const p = lampAt(d), box = { x0: p.x - 3, y0: p.y - 7, x1: p.x + 4, y1: p.y };
    assert.ok(within(box, { x0: d.cx - 22, y0: d.y + 8, x1: d.cx + 22, y1: d.y + 26 }));
    assert.ok(box.x1 <= d.cx - 8);   // PC_FRONT: cx − 8 .. cx + 8
    assert.ok(box.x1 <= d.cx + 15 - 8);
  }
});

test('flatLights: one lamp pool per lit lamp, inside its desk\'s room; no lamps, no pools; holes inside the office', () => {
  const l = LAYOUTS[2], c = cornerSpots(l), all = { x0: 0, y0: 0, x1: l.w, y1: l.h };
  const o = { glass: windowGlass(l, n => SIZE[n]), screens: [0, 1], lamps: [0, 1], hot: [1], burns: [{ pt: doneSeats(l)[0], room: 'done' as const }], clock: c.clock, gauge: c.box, racks: [], leds: [] };
  const lights = flatLights(l, o);
  assert.equal(lights.filter(x => x.kind === 'lamp').length, 2);
  assert.deepEqual(flatLights(l, { ...o, lamps: [] }).filter(x => x.kind === 'lamp'), []);
  for (const x of lights) {
    if (x.kind === 'lamp') assert.ok(x.pool.x >= x.clip.x0 && x.pool.x <= x.clip.x1 && x.pool.y >= x.clip.y0 && x.pool.y <= x.clip.y1);
    if (x.kind === 'hole' || x.kind === 'screen') assert.ok(within(x.r, all));
  }
});
