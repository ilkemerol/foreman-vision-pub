import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BIN, BOWLS, bowlsOf, DECOR, decorKeepOut, decorKey, deskProps, foremanMug, isoK, isoPieceBox, isoSignBoxes, placeDecor, walkBlocks, wallSpots, type Piece } from '../../web/src/logic/decor.ts';
import { isoProj, isoSign, isoView, signBox, toWorld } from '../../web/src/logic/iso.ts';
import { TEXT } from '../../web/src/logic/i18n.ts';
import { isoFit, officeLayout, type Fit, type Layout, type Rect } from '../../web/src/logic/layout.ts';

const fit = (w: number, h: number): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0 });
// 34×18 (minimum), 35×19 (1366×657), 35×18 (1920×1080), 34×22 (narrow, tall), 47×25 (2560×1440), 74×39 (4K)
const LAYOUTS = [fit(1114, 589), fit(1146, 613), fit(1700, 1036), fit(1028, 714), fit(2308, 1372), fit(3600, 2000)].map(f => officeLayout(f));
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const grow = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d });
const at = (l: Layout) => l.key;

test('placeDecor: every piece inside its room, clear of every keep-out box by 2 px (a rug: of the doors), at six sizes', () => {
  for (const l of LAYOUTS) {
    const ko = decorKeepOut(l);
    for (const p of placeDecor(l)) {
      const r = l.rooms[p.room], floor = !!DECOR[p.name].floor;
      assert.ok(p.x0 >= r.x0 && p.x1 <= r.x1 && p.y1 <= r.y1 && p.y0 >= r.y0 - (floor ? 0 : 8), `${at(l)} ${p.name} leaves ${p.room}`);
      for (const k of ko) if (!floor || k.why === 'door') assert.ok(!meet(grow(p, 2), k), `${at(l)} ${p.name} at ${p.x0},${p.y0} meets ${k.why} ${JSON.stringify(k)}`);
    }
  }
});

test('placeDecor: pieces of a kind never meet; groups come whole; the same layout gives the same decor', () => {
  for (const l of LAYOUTS) {
    const d = placeDecor(l);
    for (const [i, a] of d.entries()) for (const b of d.slice(i + 1)) if (!!DECOR[a.name].floor === !!DECOR[b.name].floor) assert.ok(!meet(a, b), `${at(l)} ${a.name} meets ${b.name}`);
    const nook = d.filter(p => p.group === 'library-nook').map(p => p.name);
    assert.ok(nook.length === 0 || nook.join() === 'shelf,armchair,lamp,sidetable', `${at(l)} nook ${nook}`);
    assert.deepEqual(placeDecor(l), d);
  }
});

test('placeDecor: narrow offices get decor too; 2560 gets the room corners', () => {
  const names = (l: Layout) => placeDecor(l).map(p => p.name);
  for (const l of LAYOUTS.slice(0, 3)) assert.ok(names(l).includes('cooler'), `${at(l)}: ${names(l)}`);
  const wide = names(LAYOUTS[4]);
  for (const n of ['cooler', 'printer', 'extinguisher', 'shelf', 'armchair', 'lamp', 'sidetable', 'rugWait'] as const) assert.ok(wide.includes(n), `47x25 lacks ${n}: ${wide}`);
  // the sofa set's walks cross 47×25's rug, its low table comes on a larger one
  assert.ok(names(LAYOUTS[5]).includes('lowtable'), `${at(LAYOUTS[5])}: ${names(LAYOUTS[5])}`);
});

test('deskProps: on the desk top, clear of the monitor, the ambient lamp (lampAt) and Smooth\'s perch; the foreman\'s mug clear of the cat and the letter', () => {
  for (const l of LAYOUTS) {
    for (const d of l.desks) {
      const { papers, mug } = deskProps(d), top = { x0: d.cx - 22, y0: d.y + 11, x1: d.cx + 22, y1: d.y + 25 };
      const lamp = { x0: d.cx - 20, y0: d.y + 10, x1: d.cx - 13, y1: d.y + 17 }, pc = { x0: d.cx - 8, y0: d.y - 2, x1: d.cx + 8, y1: d.y + 21 };
      const cat = { x0: d.cx + 7, y0: d.y + 6, x1: d.cx + 23, y1: d.y + 17 };   // flat.ts top(): drawCat at (cx + 15, y + 17), 16×11
      for (const r of [papers, mug]) { assert.ok(r.x0 >= top.x0 && r.x1 <= top.x1 && r.y0 >= top.y0 && r.y1 <= top.y1); for (const o of [lamp, pc, cat]) assert.ok(!meet(r, o)); }
    }
    const F = l.foreman.seat, m = foremanMug(l);
    assert.ok(!meet(m, { x0: F.x - 23, y0: l.foreman.y + 6, x1: F.x - 7, y1: l.foreman.y + 17 }));   // the cat, left of the monitor
    assert.ok(!meet(m, { x0: F.x + 3, y0: l.foreman.y - 1, x1: F.x + 19, y1: l.foreman.y + 31 }));   // PC_BACK
    assert.ok(m.x0 >= F.x - 6);                                                                     // the courier's letter lands at F.x − 14 … F.x − 6
  }
});

test('server room: no rack island; a desk row where it stood; the extinguisher by the wall, clear of the desks', () => {
  const l = LAYOUTS[4], sv = l.rooms.server;   // 47×25: the island stood under the one desk row
  assert.deepEqual([...new Set(l.desks.filter(d => d.room === 'server').map(d => d.y))], [48, sv.y1 - 48]);
  const e = placeDecor(l).filter(p => p.room === 'server');
  assert.deepEqual(e.map(p => [p.name, p.x0 - sv.x0, p.y0 - sv.y0]), [['extinguisher', 24, 18]]);   // the top wall's foot, right of the rack column
  for (const d of l.desks) assert.ok(!meet(grow(e[0], 2), { x0: d.cx - 24, y0: d.y - 2, x1: d.cx + 24, y1: d.y + 46 }));
});

test('wallSpots: along the top wall\'s foot, then the left, right and bottom walls, inside the room', () => {
  const r = { x0: 16, y0: 32, x1: 80, y1: 96 }, s = wallSpots(r, 10, 16);
  assert.deepEqual(s[0], { x: 18, y: 32 });
  assert.ok(s.every(p => p.x >= r.x0 + 2 && p.x + 10 <= r.x1 - 2 && p.y + 16 <= r.y1 - 2 && p.y >= r.y0));
});

// Iso desk tags at k 3 are up to ~260 px wide (iso.ts labelBox) and move with their agents: a tag may cover a piece (the
// DOM is over the canvas, the name stays readable); door signs stand still and must not.
/** A window's office area as OfficeFloor fits it (viewport − sidebar 220 × header 44 CSS px, a 15 px scrollbar). */
const page = (vw: number, vh: number, dpr = 1) => officeLayout({ w: Math.round(vw / dpr) - 220, h: Math.round(vh / dpr) - 44, dpr, demand: 0, sb: 15, frame: true });
// windows at iso text scales 2 (dpr 1, iso 1×), 2.5 (125 %), 3 (150 %) and 1.5, 1.25, 1
const WINDOWS = [[1920, 900], [1920, 930], [1920, 945], [1366, 657], [1920, 1080], [2560, 1270], [2560, 1440], [1920, 945, 1.25], [1920, 1080, 1.25],
  [1920, 1080, 1.5], [2560, 1440, 1.25], [2560, 1440, 1.5]].map(([w, h, dpr]) => page(w, h, dpr));
test('placeDecor: in iso no standing piece stands under a door sign at the text scale the layout draws it (1 to 3)', () => {
  assert.deepEqual([...new Set([...LAYOUTS, ...WINDOWS].map(isoK))].sort(), [1, 1.25, 1.5, 2, 2.5, 3]);
  for (const l of [...LAYOUTS, ...WINDOWS]) {
    const v = isoView(l.cols, l.rows), k = isoK(l), labels: Rect[] = [];
    for (const d of l.doors) { const text = TEXT.en[`door.${d.id}`].length > TEXT.tr[`door.${d.id}`].length ? TEXT.en[`door.${d.id}`] : TEXT.tr[`door.${d.id}`]; labels.push(signBox(isoSign(l, d, k, text, labels), text, k)); }
    const box = (p: Piece): Rect => {   // the piece's screen box: its footprint's corners and its top
      const pts = [[p.x0, p.y1], [p.x1, p.y1]].flatMap(([x, y]) => { const w = toWorld({ x, y }); return [isoProj(v, w.x, w.y, 0), isoProj(v, w.x, w.y - 0.6, p.y1 - p.y0)]; });
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    };
    for (const p of placeDecor(l)) if (!DECOR[p.name].floor) for (const b of labels) assert.ok(!meet(box(p), b), `${at(l)} k ${k} ${p.name} under a door sign`);
  }
});
test('placeDecor: the Library reading nook at 1920 × 900–975 (52×25–52×27, iso k 2: the Done lounge sign by its door) and where it was', () => {
  const nook = (l: Layout) => placeDecor(l).some(p => p.group === 'library-nook');
  assert.deepEqual(WINDOWS.filter(nook).map(l => `${l.key} k${isoK(l)}`),
    ['52x25 k2', '52x26 k2', '52x27 k2', '45x24 k1', '47x25 k1', '50x26 k2.5', '46x24 k1.25', '44x24 k1.5']);
});

// a sweep of every grid from 34×18 to 4K (199 grids)
const GRIDS = (() => {
  const seen = new Map<string, Layout>();
  for (let w = 1088; w <= 3840; w += 48) for (let h = 576; h <= 2160; h += 48) for (const frame of [false, true]) {
    const l = officeLayout({ ...fit(w, h), frame });
    if (!seen.has(l.key)) seen.set(l.key, l);
  }
  return [...seen.values()];
})();

test('bowlsOf: under the top-left bin and plant wherever the plant stands beside the bin (158 grids), else on the main office\'s left wall above the entrance; 2 px clear of every keep-out box but a desk\'s hot tag, of the decor and (iso) of the door signs', () => {
  assert.equal(GRIDS.length, 199);
  let corner = 0;
  for (const l of GRIDS) {
    const b = bowlsOf(l), m = l.rooms.main, g = grow(b.box, 2);
    const hot = (k: Rect) => l.desks.some(d => k.x0 === d.cx - 40 && k.y1 === d.y);
    const pot = placeDecor(l).find(p => p.room === 'main' && p.name === 'pot' && p.y1 === m.y0 + 16 && p.x0 === BIN.x1 + 2);
    if (pot) {
      corner++;
      assert.equal(b.box.y0, Math.max(BIN.y1, pot.y1) + 2, `${at(l)} not under the bin and plant`);
      assert.ok(b.box.x0 >= m.x0 + 2 && b.box.x0 < pot.x1, `${at(l)} not under the plant`);
    } else {
      assert.equal(b.box.x0, m.x0 + 2, `${at(l)} not on the left wall`);
      assert.ok(b.box.y0 >= m.y0 - 8 && b.box.y1 <= l.h - 16, `${at(l)} not above the entrance line`);
    }
    assert.equal(b.box.x1 - b.box.x0, BOWLS.w); assert.equal(b.box.y1 - b.box.y0, BOWLS.h);
    for (const k of decorKeepOut(l)) if (!(k.why === 'label' && hot(k))) assert.ok(!meet(g, k), `${at(l)} bowls meet ${k.why} ${JSON.stringify(k)}`);
    for (const p of placeDecor(l)) assert.ok(!meet(g, p), `${at(l)} bowls meet ${p.name}`);
    for (const s of isoSignBoxes(l)) assert.ok(!meet(isoPieceBox(l, b.box), s), `${at(l)} bowls under a door sign`);
    for (const s of [b.eat, b.drink]) assert.ok(s.pt.x > m.x0 && s.pt.x < m.x1 && s.pt.y > m.y0 && s.pt.y < b.box.y1, `${at(l)} ${JSON.stringify(s.pt)}`);
    assert.deepEqual([b.food, b.water, b.eat.pt, b.drink.pt], [{ x: b.box.x0 + 7, y: b.box.y1 - 2 }, { x: b.box.x0 + 19, y: b.box.y1 - 2 }, { x: b.box.x0 + 7, y: b.box.y1 - 5 }, { x: b.box.x0 + 19, y: b.box.y1 - 5 }]);
    assert.ok(walkBlocks(l).boxes.includes(b.box), `${at(l)} not a walk block`);
  }
  assert.equal(corner, 158);
});

test('bowlsOf: the expected mats (34×18 on the left wall; 45×24 right of the printer under the bin, 52×27, 58×28, 74×39 under the bin and plant); the walk leaves along the nearest main office line', () => {
  const mat = (l: Layout) => { const { box: b, eat } = bowlsOf(l); return [l.key, b.x0, b.x1, b.y1 - 7, b.y1 - 1, eat.aisle]; };
  assert.deepEqual([fit(1088, 576), fit(2192, 1200), fit(1664, 864), { ...fit(1920, 945), frame: true }, { ...fit(3636, 1924), frame: true }].map(f => mat(officeLayout(f))),
    [['34x18', 18, 44, 199, 205, 182], ['45x24', 40, 66, 63, 69, 92], ['52x27', 18, 44, 63, 69, 92], ['58x28', 18, 44, 63, 69, 92], ['74x39', 18, 44, 63, 69, 92]]);
});

// iso's fit (layout.ts isoFit) of a CSS viewport's office area, as OfficeFloor draws it
const fitPage = (vw: number, vh: number, dpr = 1) => { const w = vw - 220, h = vh - 44; return isoFit(officeLayout({ w, h, dpr, demand: 0, sb: 15, frame: true }), w, h, dpr); };
test('isoFit: the decor, the signs and Smooth\'s bowls hold still while 1920×(915–975) resizes within a grid; at 1920×945 the decor and the nook are as before', () => {
  const byKey = new Map<string, Set<string>>();
  for (let vh = 915; vh <= 975; vh++) { const l = fitPage(1920, vh); (byKey.get(l.key) ?? byKey.set(l.key, new Set()).get(l.key)!).add(decorKey(l)); }
  for (const [key, keys] of byKey) assert.equal(keys.size, 1, `${key}: ${[...keys]}`);
  const before = page(1920, 945), now = fitPage(1920, 945);
  assert.deepEqual([isoK(before), isoK(now)], [2, 1.625]);
  assert.deepEqual(placeDecor(now), placeDecor(before));
  assert.ok(placeDecor(now).some(p => p.group === 'library-nook'));
  assert.deepEqual(bowlsOf(now), bowlsOf(before));
});
