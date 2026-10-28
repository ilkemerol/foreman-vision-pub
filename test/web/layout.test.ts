import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripAt, tripMs, tripPath } from '../../web/src/logic/coffee.ts';
import { decorKeepOut, isoPieceBox, isoSignBoxes, K_FLAT, placeDecor, walkBlocks } from '../../web/src/logic/decor.ts';
import { TEXT } from '../../web/src/logic/i18n.ts';
import { isoDoneBoxes, isoSign, signBox } from '../../web/src/logic/iso.ts';
import { footBox, outside, route } from '../../web/src/logic/motion.ts';
import { balloonBox, boardOf, CAFE_DX, CAFE_PX, CAFE_PY, cafeBox, cafeFoot, cafeSide, dashFrame, doneAisle, doneSeats, FLAT, flatSignAt, sofaParts, sofaSeats, frameBox, frameGaps, grow, ISO, isoFit, isoLine, ISO_TWO, isoView, officeLayout, placeBalloons, PLATE, platePos, SNAP, split, tailBox, tailX, textRatio, WAIT_FULL, WAIT_MAX, waitBalloonBoxes, waitBalloons, waitAisle, waitBound, waitSpots, zoomLayout, type Fit, type Layout, type Pt, type Rect } from '../../web/src/logic/layout.ts';
import { shown, ZOOM_STEPS } from '../../web/src/logic/zoom.ts';

const fit = (w: number, h: number, o: Partial<Fit> = {}): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0, ...o });
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const within = (a: Rect, b: Rect) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;
const sprite = (p: Pt): Rect => ({ x0: p.x - 8, y0: p.y - 32, x1: p.x + 8, y1: p.y });
const none = { x: false, y: false };
const LAYOUTS = [fit(1114, 589), fit(1146, 613), fit(1028, 714), fit(2308, 1372)].map(f => officeLayout(f));   // 34×18, 35×19, 34×22, 47×25
/** The balloon tests' layouts and k as the four windows really get them: officeLayout over the office area at dpr 1, 1.25, 1.5
 *  and 2, k = textScale(views.flat.css) / css (OfficeFloor; overlay.ts textScale = max(css, 2)); and the 47×25 office at k 1. */
const BALLOONS = [...[[1114, 589], [1146, 613], [1028, 714], [2308, 1372]].flatMap(([w, h]) => [1, 1.25, 1.5, 2].map(dpr => {
  const l = officeLayout(fit(w, h, { dpr, sb: 15, frame: true })), css = l.views.flat.css;
  return { l, k: Math.max(css, 2) / css };
})), { l: LAYOUTS[3], k: 1 }];

test('grow + split: the flat growth alone matches the reference table', () => {
  // the boxes: window − sidebar 220 − 32, window − header 44 − 24
  for (const [w, h, s, want] of [[772, 572, 2, '34,18,12,10,9,9,10,7'], [1028, 732, 2, '34,22,12,10,9,9,10,9'],
    [1114, 589, 2, '34,18,12,10,9,9,10,7'], [1668, 1012, 3, '34,21,12,10,9,9,10,9'], [2308, 1372, 3, '48,28,17,15,13,13,15,13']] as const) {
    const g = grow(FLAT, s, w, h), r = split(g.cols, g.rows);
    assert.equal([g.cols, g.rows, r.main, r.server, r.library, r.wait, r.done, r.k].join(), want, `${w}×${h}`);
  }
});
test('officeLayout: one grid for both styles — the largest that fits flat at its scale and iso at its own', () => {
  const g = (w: number, h: number) => { const l = officeLayout(fit(w, h)); return [l.cols, l.rows, l.views.flat.css, l.views.iso.css, l.views.flat.scroll, l.views.iso.scroll]; };
  assert.deepEqual(ISO.size(34, 18), { w: 824, h: 458 });
  assert.deepEqual(g(1146, 613), [35, 19, 2, 1, none, none]);      // 1366×657
  assert.deepEqual(g(1700, 1036), [35, 18, 3, 2, none, none]);     // 1920×1080: flat alone would take 35×21
  assert.deepEqual(g(2340, 1396), [48, 25, 3, 2, none, none]);     // 2560×1440
});
test('officeLayout: the minimum office — 34×18 tiles, 10 desks, six doors in the walls, rooms apart', () => {
  const l = LAYOUTS[0];
  assert.deepEqual([l.w, l.h, l.k, l.hallY, l.key], [544, 288, 7, 144, '34x18']);
  assert.deepEqual(l.rooms, {
    main: { x0: 16, y0: 32, x1: 208, y1: 288 }, server: { x0: 224, y0: 32, x1: 384, y1: 96 }, library: { x0: 400, y0: 32, x1: 544, y1: 96 },
    hall: { x0: 224, y0: 128, x1: 544, y1: 176 }, wait: { x0: 224, y0: 176, x1: 368, y1: 288 }, done: { x0: 384, y0: 176, x1: 544, y1: 288 } });
  assert.deepEqual(['main', 'server', 'library'].map(r => l.desks.filter(d => d.room === r).length), [6, 2, 2]);
  assert.deepEqual(l.doors.map(d => [d.id, d.x, d.y]), [['in', 0, 272], ['hall', 208, 144], ['server', 368, 128], ['library', 528, 128], ['wait', 352, 176], ['done', 384, 176]]);
  for (const c of ['0,16', '0,17', '13,8', '13,9', '23,7', '33,7', '22,10', '24,10']) assert.ok(!l.walls.has(c), `door ${c}`);
  for (const c of ['13,7', '13,10', '24,5', '22,7', '23,10', '0,15', '33,1']) assert.ok(l.walls.has(c), `wall ${c}`);
  assert.deepEqual([l.desks[0].seat, l.desks[0].aisle, l.foreman.seat], [{ x: 40, y: 170 }, 182, { x: 104, y: 66 }]);
  for (const d of l.desks) assert.ok(within(sprite(d.seat), { ...l.rooms[d.room], y0: 0 }), `desk ${d.cx},${d.y}`);
});
test('officeLayout: the server room adds a row on its bottom line, 64 px or more under its last 86 px row', () => {
  const rows = (l: Layout) => [...new Set(l.desks.filter(d => d.room === 'server').map(d => d.y))];
  assert.deepEqual(LAYOUTS.map(rows), [[48], [48], [48], [48, 112]]);   // 34×22: 80 px under its row, too little
  assert.deepEqual(rows(officeLayout(fit(3600, 2000))), [48, 134, 220]);  // 74×39: 84 px under its last row
  for (const l of [...LAYOUTS, ...[[1600, 1000], [2200, 1300], [3000, 1700], [3600, 2100]].map(([w, h]) => officeLayout(fit(w, h)))]) {
    const ys = rows(l), sv = l.rooms.server;
    ys.slice(1).forEach((y, i) => assert.ok(y - ys[i] === 86 || (y - ys[i] >= 64 && y === sv.y1 - 48 && i === ys.length - 2), `${l.key} ${ys}`));
    assert.ok(sv.y1 - 48 - ys[ys.length - 1] < 64, `${l.key}: room for one more row`);
  }
});
test('officeLayout: iso takes the largest whole device scale from its floor up to 2 CSS px that fits, 2 device px at 150 %', () => {
  // the measured panes of 1366×768 and 1707×960 at 150 % (Chromium), as OfficeFloor fits them
  const at = (w: number, h: number) => { const l = officeLayout(fit(w, h, { dpr: 1.5, sb: 15, frame: true })); return [l.views.iso.device, l.views.flat.device, l.key, l.views.iso.scroll, l.views.flat.scroll]; };
  assert.deepEqual(at(1146, 724), [2, 3, '34x18', none, none]);
  assert.deepEqual(at(1487, 916), [2, 3, '44x24', none, none]);
  assert.deepEqual(officeLayout(fit(1300, 750, { dpr: 2 })).views.iso.device, 3);   // dpr 2: between its floor 2 and 4
});
test('officeLayout: whole device pixels; flat 2–3 CSS px rounded down per dpr, iso 2× only when the minimum fits', () => {
  const v = (w: number, h: number, dpr = 1) => { const l = officeLayout(fit(w, h, { dpr })); return [l.views.flat.device, l.views.flat.css, l.views.iso.device, l.views.iso.css]; };
  assert.deepEqual(v(1114, 589), [2, 2, 1, 1]);
  assert.deepEqual(v(1114, 589, 2), [4, 2, 2, 1]);
  assert.deepEqual(v(1114, 589, 1.25), [2, 1.6, 1, 0.8]);
  assert.deepEqual(v(1114, 589, 1.5), [3, 2, 1, 1 / 1.5]);   // iso 2 device px would be 611 px tall: it never scrolls to climb
  assert.deepEqual(v(1700, 1036), [3, 3, 2, 2]);
  assert.deepEqual(v(2308, 1372), [3, 3, 2, 2]);                 // flat 4 would fit: capped at 3
  assert.deepEqual(v(600, 400), [2, 2, 1, 1]);                   // never below the floor: it scrolls
  const laptop125 = officeLayout(fit(873, 482, { dpr: 1.25 }));  // 1366×657 at 125 %: CSS 1093×526 − sidebar − header
  assert.deepEqual([laptop125.cols, laptop125.rows, laptop125.views.flat.scroll, laptop125.views.iso.scroll], [34, 18, none, none]);
});
test('officeLayout: scrolls only on the axis that does not fit; a scrollbar takes its room first', () => {
  const a = officeLayout(fit(1028, 714)), b = officeLayout(fit(1028, 714, { sb: 15 }));
  assert.deepEqual([a.rows, a.views.flat.scroll], [22, { x: true, y: false }]);
  assert.deepEqual([b.rows, b.views.flat.scroll, b.views.iso.scroll], [21, { x: true, y: false }, none]);
  assert.deepEqual(officeLayout(fit(772, 572, { sb: 15 })).views.flat.scroll, { x: true, y: true });
});
test('frameBox: 8 px margin + the dashed frame; the margin shrinks, then the frame goes, only where they alone would make the minimum scroll', () => {
  const at = (w: number, h: number, dpr: number) => {
    const l = officeLayout(fit(w, h, { dpr, sb: 15, frame: true }));
    const f = l.views.flat;
    return [f.mx, f.my, f.frame, l.key, f.scroll, l.views.iso.scroll];
  };
  assert.deepEqual(at(873, 482, 1.25), [1, 8, false, '34x18', none, none]);                 // 1093×526 @125 %: 870.4 px wide at 2 device px, no room for the frame
  assert.deepEqual(at(1146, 613, 1), [8, 8, true, '34x18', none, none]);                    // 1366×657: the frame takes 10 office px per axis
  assert.deepEqual(at(1060, 756, 1), [8, 8, true, '34x22', { x: true, y: false }, none]);   // 1280×800: 1088 px never fits, x scrolls
  assert.deepEqual(frameBox(1146, 613, 1), { w: 1130, h: 597, mx: 8, my: 8, frame: true });
  assert.deepEqual(at(1146, 600, 1), [8, 2, true, '34x18', none, none]);                    // (288 + 10) × 2 = 596: the margin gives way first
});
/** A window's office area (viewport − sidebar 220 × header 44, CSS px) as OfficeFloor fits it, a 15 px scrollbar. */
const page = (vw: number, vh: number, dpr = 1, demand = 0) => officeLayout(fit(Math.round(vw / dpr) - 220, Math.round(vh / dpr) - 44, { dpr, sb: 15, frame: true, demand }));
/** A style as drawn at the layout's one grid: device scale, frame, margins, and how far it runs past the area (CSS px). */
function drawn(l: Layout, st: 'flat' | 'iso', vw: number, vh: number, dpr = 1) {
  const v = l.views[st], s = (st === 'flat' ? FLAT : ISO).size(l.cols, l.rows), f = v.frame ? dashFrame(s.w, s.h) : { w: s.w, h: s.h };
  const out = (n: number, m: number, a: number) => Math.max(0, Math.ceil(n * v.css + 2 * m - a));
  return [v.device, v.frame, v.mx, v.my, out(f.w, v.mx, Math.round(vw / dpr) - 220 - (v.scroll.y ? 15 : 0)), out(f.h, v.my, Math.round(vh / dpr) - 44)];
}
test('officeLayout: iso climbs on the grid flat sets — its margin shrinks, its frame always kept, never a scroll; else flat keeps to the step of iso on the bigger grid', () => {
  // [viewport, grid, flat, iso]: [device, frame, mx, my, past the area x, y]; one grid, so a style switch moves nobody
  const want: [number[], string, unknown[], unknown[]][] = [
    [[1920, 945], '52x27', [2, true, 8, 8, 0, 0], [1, true, 8, 8, 0, 0]],      // iso 2× would scroll: the bigger grid, 21 desks
    [[1920, 950], '52x27', [2, true, 8, 8, 0, 0], [1, true, 8, 8, 0, 0]],
    [[1920, 980], '34x18', [3, true, 8, 8, 0, 0], [2, true, 8, 2, 0, 0]],      // iso's margin shrinks for 2×
    [[1920, 1000], '34x18', [3, true, 8, 8, 0, 0], [2, true, 8, 8, 0, 0]],      // was iso 1× (834×486 in 1700×956)
    [[1920, 1080], '34x18', [3, true, 8, 8, 0, 0], [2, true, 8, 8, 0, 0]],
    [[1366, 657], '34x18', [2, true, 8, 8, 0, 0], [1, true, 8, 8, 0, 0]],
    [[2560, 1270], '45x24', [3, true, 8, 8, 0, 0], [2, true, 8, 8, 0, 0]],      // was 43×23: iso's trimmed bands let it grow
    [[2560, 1440], '47x25', [3, true, 8, 8, 0, 0], [2, true, 8, 8, 0, 0]],
    [[1920, 1080, 1.25], '50x30', [2, true, 8, 8, 0, 0], [1, true, 8, 8, 0, 0]],
    [[1920, 1080, 1.5], '34x19', [3, true, 8, 8, 64, 0], [1, true, 8, 8, 0, 0]], // 1280 CSS px wide: flat scrolls x
  ];
  for (const [[vw, vh, dpr = 1], key, f, i] of want) {
    const l = page(vw, vh, dpr);
    assert.deepEqual([l.key, drawn(l, 'flat', vw, vh, dpr), drawn(l, 'iso', vw, vh, dpr)], [key, f, i], `${vw}×${vh} @${dpr}`);
  }
  // 1920 wide, by height: iso 2× framed with 8 px down to 992, then its margin shrinks down to 976; under it flat 2× and
  // iso 1× on the bigger grid (52×27 from 944 to 975, 52×26 under it), never flat 3× forcing 34×18 on iso 1×
  const iso = (vh: number) => { const l = page(1920, vh); return [l.key, l.views.flat.device, ...drawn(l, 'iso', 1920, vh)]; };
  assert.deepEqual([992, 991, 976, 975, 944, 943].map(iso), [
    ['34x18', 3, 2, true, 8, 8, 0, 0], ['34x18', 3, 2, true, 8, 7, 0, 0], ['34x18', 3, 2, true, 8, 0, 0, 0],
    ['52x27', 2, 1, true, 8, 8, 0, 0], ['52x27', 2, 1, true, 8, 8, 0, 0], ['52x26', 2, 1, true, 8, 8, 0, 0]]);
  for (let vh = 900; vh <= 1100; vh++) {   // never a scroll, never frameless, flat 3× only with iso 2×
    const l = page(1920, vh), [f, i] = [drawn(l, 'flat', 1920, vh), drawn(l, 'iso', 1920, vh)];
    assert.ok(f[1] && i[1] && f[4] === 0 && i[4] === 0 && f[5] === 0 && i[5] === 0 && (f[0] === 2) === (i[0] === 1), `1920×${vh}: ${f} | ${i}`);
  }
});
test('platePos: the floor plate never meets the frame or the office — the pane corner, else inside iso\'s empty corner, else not drawn', () => {
  const where: Record<string, string> = {};
  for (const [vw, vh, dpr = 1] of [[1920, 945], [1920, 1000], [1920, 1080], [2560, 1270], [2560, 1440], [1366, 657], [1920, 1080, 1.25], [1920, 1080, 1.5]])
    for (const st of ['flat', 'iso'] as const) for (const n of [2, 3]) {
      const w = Math.round(vw / dpr) - 220, h = Math.round(vh / dpr) - 44, l = page(vw, vh, dpr), v = l.views[st], p = platePos(l, st, w, h, 15, n), tag = `${vw}×${vh}@${dpr} ${st} ${n}`;
      const s = (st === 'flat' ? FLAT : ISO).size(l.cols, l.rows), f = v.frame ? dashFrame(s.w, s.h) : { ...s, l: 0, t: 0 };
      const frame = { x0: v.mx, y0: v.my, x1: v.mx + f.w * v.css, y1: v.my + f.h * v.css };   // shell px
      if (n === 2) where[`${vw}x${vh}@${dpr} ${st}`] = !p ? 'none' : p.x === v.mx + PLATE.x && p.y === v.my + PLATE.y ? 'inside' : 'corner';
      if (!p) { assert.equal(st, 'flat', tag); continue; }
      const r = { x0: p.x, y0: p.y, x1: p.x + n * PLATE.ch, y1: p.y + PLATE.h }, g = PLATE.gap;
      if (!meet({ x0: r.x0 - g, y0: r.y0 - g, x1: r.x1 + g, y1: r.y1 + g }, frame)) continue;
      // inside iso's frame: past its lines, and in office px over the left wall's top edge (4 + (ox − 4 − x) / 2 down)
      const o = isoView(l.cols, l.rows), X = (r.x1 - v.mx) / v.css - f.l, Y = (r.y1 + g - v.my) / v.css - f.t;
      assert.ok(st === 'iso' && r.x0 >= frame.x0 + 2 * v.css + g && r.y0 >= frame.y0 + 2 * v.css + g && Y <= 4 + (o.ox - 4 - X) / 2, tag);
    }
  assert.deepEqual(where, {
    '1920x945@1 flat': 'none', '1920x945@1 iso': 'corner', '1920x1000@1 flat': 'none', '1920x1000@1 iso': 'inside', '1920x1080@1 flat': 'corner', '1920x1080@1 iso': 'inside',
    '2560x1270@1 flat': 'corner', '2560x1270@1 iso': 'inside', '2560x1440@1 flat': 'corner', '2560x1440@1 iso': 'corner', '1366x657@1 flat': 'none', '1366x657@1 iso': 'corner',
    '1920x1080@1.25 flat': 'none', '1920x1080@1.25 iso': 'corner', '1920x1080@1.5 flat': 'none', '1920x1080@1.5 iso': 'corner' });
});
test('platePos under the iso zoom: on each step\'s own layout the plate keeps its size and never meets the frame', () => {
  for (const [vw, vh, dpr = 1] of [[1920, 945], [2560, 1270], [1366, 657], [1920, 945, 1.25]]) {
    const w = Math.round(vw / dpr) - 220, h = Math.round(vh / dpr) - 44, f = fit(w, h, { dpr, sb: 15, frame: true }), auto = isoFit(officeLayout(f), w, h, dpr);
    for (const z of ZOOM_STEPS) for (const n of [2, 3]) {
      const l = zoomLayout(f, z, auto), s = shown(l, 'iso', w, h, dpr, 15), p = platePos(l, 'iso', w, h, 15, n, s), tag = `${vw}×${vh}@${dpr} ${z} ${n}`;
      assert.ok(p, tag);
      // the shell's corner in the pane; 1 px slack: the zoomed frame is whole px, platePos's centring is not
      const at = s.at ?? { x: Math.max(0, (w - s.fw - 2 * s.mx) / 2), y: Math.max(0, (h - s.fh - 2 * s.my) / 2) }, g = PLATE.gap - 1;
      const frame = { x0: at.x + s.mx, y0: at.y + s.my, x1: at.x + s.mx + s.fw, y1: at.y + s.my + s.fh };
      const r = { x0: at.x + p!.x - g, y0: at.y + p!.y - g, x1: at.x + p!.x + n * PLATE.ch + g, y1: at.y + p!.y + PLATE.h + g };
      assert.ok(!meet(r, frame) || (p!.x === s.mx + PLATE.x && p!.y === s.my + PLATE.y), tag);   // else iso's spot inside the frame
    }
  }
});
test('officeLayout: a climb whose grid has too few desks falls back to the scales without it', () => {
  const l = page(1920, 980, 1, 11);
  assert.deepEqual([l.key, l.desks.length, drawn(l, 'flat', 1920, 980), drawn(l, 'iso', 1920, 980)], ['52x28', 24, [2, true, 8, 8, 0, 0], [1, true, 8, 8, 0, 0]]);
  assert.equal(page(1920, 980, 1, 10).key, '34x18');
});
test('dashFrame: square 2 px blocks, a whole one at every corner, gaps of 2–4 px around the office', () => {
  for (const [w, h] of [[544, 288], [824, 478], [825, 487], [826, 485], [827, 486]]) {
    const f = dashFrame(w, h), at = new Set(f.blocks.map(p => `${p.x},${p.y}`));
    assert.deepEqual([f.w, f.h], [w + f.l + f.r, h + f.t + f.b]);
    for (const g of [f.l, f.r, f.t, f.b]) assert.ok(g >= 4 && g <= 6, `${w}×${h}: side ${g}`);   // gap 2–4 + the 2 px line
    assert.ok(Math.abs(f.l - f.r) <= 1 && Math.abs(f.t - f.b) <= 1);
    assert.equal((f.w / 2) % 2, 1); assert.equal((f.h / 2) % 2, 1);                             // odd block counts: dash, gap, …, dash
    for (const c of [`0,0`, `${f.w - 2},0`, `0,${f.h - 2}`, `${f.w - 2},${f.h - 2}`]) assert.ok(at.has(c), `${w}×${h}: corner ${c}`);
    assert.equal(at.size, f.blocks.length);                                                     // no block twice
    assert.equal(f.blocks.length, (f.w / 2 + 1) + (f.h / 2 + 1) - 4);                           // every other block of the ring
  }
  assert.deepEqual(frameGaps(544), [3, 3]);   // flat: 16 px tiles, always 3 + 3
});
test('officeLayout: more working agents than desks drop both scales, then add desk rows and scroll', () => {
  const at = (demand: number) => officeLayout(fit(1668, 1012, { demand }));
  assert.deepEqual([at(10).views.flat.css, at(10).views.iso.css, at(10).desks.length], [3, 2, 10]);
  const two = at(11);
  assert.deepEqual([two.views.flat.css, two.views.iso.css, two.cols, two.rows, two.views.flat.scroll.y], [2, 1, 52, 31, false]);
  assert.ok(two.desks.length >= 11);
  const many = at(two.desks.length + 1);
  assert.deepEqual([many.views.flat.css, many.cols, many.views.flat.scroll.y], [2, 52, true]);
  assert.ok(many.desks.length > two.desks.length && many.rows > two.rows);
});
test('waitSpots + waitBalloons: inside the Waiting room, apart, off the coffee table; three waiters always get a balloon, more only when all fit compact; none covers a waiter', () => {
  assert.deepEqual([...new Set(BALLOONS.map(b => b.k))].sort(), [1, 1.25]);   // flat's k at any dpr
  for (const { l, k } of BALLOONS) for (let n = 1; n <= WAIT_MAX; n++) {
    const pts = waitSpots(n, l), at = `${l.key} k=${k} n=${n}`, st = l.stations.wait;
    assert.equal(new Set(pts.map(p => `${p.x},${p.y}`)).size, n, `${at} distinct`);
    for (const p of pts) {
      assert.ok(within(sprite(p), { ...l.rooms.wait, y0: l.hallY }), `${at} ${p.x},${p.y} in the room`);
      assert.ok(!meet(sprite(p), { x0: st.x, y0: st.y - 6, x1: st.x + 32, y1: st.y + 32 }), `${at} on the coffee table`);
    }
    const { compact, shown } = waitBalloons(pts, waitBound(l), k);
    assert.equal(shown, n <= WAIT_FULL ? n : compact ? n : WAIT_FULL, at);
    const bs = placeBalloons(pts.slice(0, shown).map(feet => ({ feet, ...balloonBox(k, compact) })), waitBound(l), pts.map(sprite));
    bs.forEach((b, i) => {
      assert.ok(b, `${at}: balloon #${i} is missing`);
      assert.ok(within(b!, waitBound(l)), `${at} #${i} leaves the room`);
      pts.forEach((p, j) => assert.ok(!meet(b!, sprite(p)), `${at} #${i} covers waiter ${j}`));
      bs.slice(i + 1).forEach((o, j) => assert.ok(!meet(b!, o!), `${at} #${i} meets #${i + 1 + j}`));
    });
  }
  const big = LAYOUTS[3];   // 13×10-tile Waiting room: four and five waiters all get a compact balloon
  for (const n of [4, 5]) assert.deepEqual(waitBalloons(waitSpots(n, big), waitBound(big), 1), { compact: true, shown: n });
});
test('waitSpots: past six the extra ones share the sixth spot', () => {
  const pts = waitSpots(8, LAYOUTS[0]);
  assert.deepEqual([pts[6], pts[7]], [pts[5], pts[5]]);
});
test('placeBalloons: over the head, pushed up past what it meets, else the nearest free box; hidden only when none exists', () => {
  const bound = { x0: 0, y0: 0, x1: 200, y1: 200 };
  assert.deepEqual(placeBalloons([{ feet: { x: 100, y: 150 }, w: 68, h: 26 }], bound, []), [{ x0: 66, y0: 88, x1: 134, y1: 114 }]);
  const [low, high] = placeBalloons([{ feet: { x: 100, y: 150 }, w: 68, h: 26 }, { feet: { x: 110, y: 140 }, w: 68, h: 26 }], bound, []);
  assert.ok(low && high && high.y1 <= low.y0 - 2);
  const head = { x0: 92, y0: 8, x1: 108, y1: 40 }, [low2] = placeBalloons([{ feet: { x: 100, y: 40 }, w: 68, h: 26 }], { ...bound, y0: 10 }, [head]);
  assert.ok(low2 && within(low2, { ...bound, y0: 10 }) && !meet(low2, head));   // no room above: it goes elsewhere
  assert.deepEqual(placeBalloons([{ feet: { x: 35, y: 60 }, w: 68, h: 26 }], { x0: 0, y0: 0, x1: 70, y1: 30 }, [{ x0: 0, y0: 0, x1: 70, y1: 30 }]), [null]);
});
test('placeBalloons: a crowded fallback takes a box above the head over a nearer one below it', () => {
  // a pillar over the head blocks the spot and the push-up; just below the waiter is nearer than beside the pillar
  const bound = { x0: 0, y0: 0, x1: 300, y1: 200 }, feet = { x: 100, y: 100 }, pillar = { x0: 60, y0: 0, x1: 140, y1: 64 };
  const [b] = placeBalloons([{ feet, w: 68, h: 26 }], bound, [pillar, sprite(feet)]);
  assert.ok(b && b.y1 <= feet.y - 32 && !meet(b, pillar) && within(b, bound), JSON.stringify(b));
  // with no room above the head it still takes the nearest free box below
  const [low] = placeBalloons([{ feet, w: 68, h: 26 }], bound, [{ x0: 0, y0: 0, x1: 300, y1: 68 }, sprite(feet)]);
  assert.ok(low && low.y0 >= 68 && !meet(low, sprite(feet)) && within(low, bound), JSON.stringify(low));
});
test('placeBalloons: with no room above the head, a box under the feet with its tail up at its agent; one beside only when none is', () => {
  const bound = { x0: 0, y0: 0, x1: 300, y1: 200 }, feet = { x: 100, y: 100 }, roof = { x0: 0, y0: 0, x1: 300, y1: 68 }, k = 2;
  const [b] = placeBalloons([{ feet, w: 68, h: 18, tail: k }], bound, [roof, sprite(feet)]);
  const tip = tailBox(b!, tailX(b!, feet.x), k, true);
  assert.ok(b?.up && b.y0 >= feet.y && within(b, bound), JSON.stringify(b));
  assert.deepEqual(tip, { x0: tailX(b!, feet.x) - 7, y0: b!.y0 - 6, x1: tailX(b!, feet.x) + 7, y1: b!.y0 });   // 3 text px over the top
  assert.ok(tip.x0 < feet.x && feet.x < tip.x1, 'the tail points at its agent');
  // another agent standing under it: neither the box nor its tail covers that one
  const other = sprite({ x: 100, y: 140 }), [c] = placeBalloons([{ feet, w: 68, h: 18, tail: k }], bound, [roof, sprite(feet), other]);
  assert.ok(c?.up && !meet(c, other) && !meet(tailBox(c, tailX(c, feet.x), k, true), other), JSON.stringify(c));
  // no room under the feet either: beside it, its tail down as before
  const [d] = placeBalloons([{ feet, w: 68, h: 18, tail: k }], { ...bound, y1: 104 }, [roof, sprite(feet)]);
  assert.ok(d && !d.up && !meet(d, sprite(feet)), JSON.stringify(d));
  // with room above nothing changes: no up
  assert.equal(placeBalloons([{ feet, w: 68, h: 18, tail: k }], bound, [sprite(feet)])[0]?.up, undefined);
});
test('placeBalloons: where the boxes under the feet would leave one out but all fit without them, all get one (five waiters in the iso Waiting room at k 2.5)', () => {
  const feet = [[436, 344], [304, 396], [404, 446], [528, 390], [408, 330]].map(([x, y]) => ({ x, y }));
  const items = feet.map(f => ({ feet: f, w: 190, h: 22.5, tail: 2.5 })), bound = { x0: 268, y0: 264, x1: 620, y1: 464 }, agents = feet.map(sprite);
  const got = placeBalloons(items, bound, agents);
  assert.ok(got.every(Boolean), JSON.stringify(got));
  assert.deepEqual(got, placeBalloons(items, bound, agents, false));
});
/** placeBalloons before its grid search stopped allocating a box per cell: the reference for the test below. */
function placeBalloonsRef(items: { feet: Pt; w: number; h: number; tail?: number }[], bound: Rect, agents: Rect[]): ((Rect & { up?: true }) | null)[] {
  type Balloon = Rect & { up?: true };
  const out: (Balloon | null)[] = items.map(() => null), taken = [...agents];
  const order = items.map((_, i) => i).sort((a, b) => items[b].feet.y - items[a].feet.y || a - b);
  for (const i of order) {
    const { feet, w, h, tail = 0 } = items[i], x0 = Math.min(Math.max(feet.x - w / 2, bound.x0), bound.x1 - w), y0 = feet.y - 36 - h;
    const box = (x: number, y: number): Balloon => ({ x0: x, y0: y, x1: x + w, y1: y + h });
    const own = (t: Rect) => t.x0 === feet.x - 8 && t.x1 === feet.x + 8 && t.y1 === feet.y;
    const tl = (b: Balloon) => tailBox(b, tailX(b, feet.x), tail, b.up);
    const hit = (b: Balloon) => { const c = tail > 0 ? tl(b) : null; return taken.find(t => meet(b, t) || (c !== null && meet(c, t) && !own(t))); };
    let b: Balloon | null = box(x0, y0);
    for (let t; (t = hit(b!));) b = box(x0, t.y0 - h - 2 - (meet(b!, t) ? 0 : 3 * tail));
    if (b.y0 < bound.y0) {
      let best = Infinity;
      b = null;
      for (let y = bound.y0; y + h <= bound.y1; y += 4) for (let x = bound.x0; x + w <= bound.x1; x += 4) {
        const c = box(x, y), d = (x - x0) ** 2 + (y - y0) ** 2;
        const tries: [Balloon, number][] = y + h <= feet.y - 32 ? [[c, d]] : [...(y >= feet.y ? [[{ ...c, up: true }, d + 1e12] as [Balloon, number]] : []), [c, d + 2e12]];
        const t = tries.find(([e, s]) => s < best && !hit(e));
        if (t) [b, best] = t;
      }
    }
    if (b) { taken.push(b); if (tail > 0) taken.push(tl(b)); out[i] = b; }
  }
  return out;
}
test('placeBalloons: the same boxes as before the grid search stopped allocating, in a full Waiting room and on random crowded floors', () => {
  let seed = 7, ups = 0;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return Math.floor(seed / 2 ** 31 * n); };
  const cases: Parameters<typeof placeBalloons>[] = [];
  for (const { l, k } of BALLOONS) for (let n = 1; n <= WAIT_MAX; n++) for (const compact of [false, true]) for (const tail of [0, k]) {
    const pts = waitSpots(n, l);
    cases.push([pts.map(feet => ({ feet, ...balloonBox(k, compact), tail })), waitBound(l), pts.map(sprite)]);
  }
  for (let i = 0; i < 300; i++) {
    const bound = { x0: 0, y0: 0, x1: 300, y1: 200 }, feet = Array.from({ length: 1 + rnd(4) }, () => ({ x: 20 + rnd(260), y: 40 + rnd(160) }));
    const roof = { x0: 0, y0: 0, x1: 300, y1: 40 + rnd(60) };
    cases.push([feet.map(f => ({ feet: f, w: 40 + rnd(40), h: 12 + rnd(20), tail: rnd(2) * 2 })), bound, [roof, ...feet.map(sprite)]]);
  }
  for (const [items, bound, agents] of cases) {
    const got = placeBalloons(items, bound, agents);
    assert.deepEqual(got, placeBalloonsRef(items, bound, agents), JSON.stringify(items));
    ups += got.filter(b => b?.up).length;
  }
  assert.ok(ups > 0, 'the grid search ran, its under-the-feet boxes too');
});
test('tailX: the tail stays under its box, 3 px in from either side', () => {
  const b = { x0: 40, y0: 0, x1: 108, y1: 26 };
  assert.deepEqual([tailX(b, 70), tailX(b, 10), tailX(b, 200), tailX(b, 43), tailX(b, 105)], [70, 43, 105, 43, 105]);
});
test('waitBalloonBoxes: a waiter out for coffee has no balloon, which costs none home theirs; no balloon ever covers an agent', () => {
  for (const { l, k } of BALLOONS) for (const n of [3, 4, 5, 6]) {
    const pts = waitSpots(n, l), { compact, shown } = waitBalloons(pts, waitBound(l), k);   // decided at home
    if (l === LAYOUTS[3] && k === 1 && n > 3) assert.ok(compact && shown === n, `${n} waiters fit compact on the big office`);
    for (let i = 0; i < n; i++) {
      const o = { id: `w-${i}`, start: 0, path: tripPath(pts[i], l.stations.wait) };
      for (let now = 0; now < tripMs(o.path); now += 100) {
        const ws = pts.map((home, j) => ({ id: `w-${j}`, home, at: j === i ? tripAt(o, now).pt : home, out: j === i }));
        const r = waitBalloonBoxes(ws, l, k, []), along = waitBalloonBoxes(ws.map(w => ({ ...w, out: false })), l, k, []);   // as if its balloon went along
        assert.ok(r.compact === compact && !r.boxes.has(o.id), `${l.key} ${n} ${now}: ${o.id} out for coffee has a balloon`);
        // with the walker still home everyone else gets one; later one loses it only where the walker's body leaves no free box
        ws.slice(0, shown).forEach((w, j) => assert.ok(j === i || r.boxes.get(w.id) || (now > 0 && !along.boxes.get(w.id)), `${l.key} ${n} ${now}: ${w.id} home has no balloon`));
        for (const [id, b] of r.boxes) ws.forEach(w => assert.ok(!b || !meet(b, sprite(w.at)), `${l.key} ${n} ${now}: ${id}'s balloon covers ${w.id}`));
      }
    }
  }
});
// café tables (two chairs facing each other), a smart board on the back wall, and the Done lounge seats no more than
// its seats; the room all café tables; 45×24 is a 2K window (2560×1270), 52×27 a 1920×945 one
const GRIDS = [...[[1000, 560], [1120, 608], [1312, 768], [1344, 736], [1504, 800], [3504, 1884], [3600, 1936]].map(([w, h]) => officeLayout(fit(w, h))), page(2560, 1270), page(1920, 945)];
const steps = (path: Pt[]): Pt[] => path.slice(1).flatMap((b, i) => {   // every point of a walk, 2 px apart
  const a = path[i], n = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  return Array.from({ length: n / 2 + 1 }, (_, s) => ({ x: a.x + Math.sign(b.x - a.x) * 2 * s, y: a.y + Math.sign(b.y - a.y) * 2 * s }));
});
const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;
const tableOf = (l: Layout, p: Pt) => l.cafes.find(t => t.y === p.y && Math.abs(t.x - p.x) === CAFE_DX)!;
const doorSign = (l: Layout) => {
  const door = l.doors.find(o => o.id === 'done')!, len = Math.max(TEXT.en['door.done'].length, TEXT.tr['door.done'].length);
  return signBox({ ...flatSignAt(door), side: door.side }, 'x'.repeat(len), K_FLAT);
};
test('doneSeats: each café table\'s left and right seat, the tables nearest the door first, as many as fit; distinct, inside the Done lounge, off its lane', () => {
  assert.deepEqual(GRIDS.map(l => `${l.key}:${l.cafes.length}:${doneSeats(l).length}`), ['34x18:3:6', '35x19:3:6', '41x24:5:10', '42x23:6:12', '47x25:7:14', '72x38:21:42', '74x39:21:42', '45x24:6:12', '52x27:10:20']);
  for (const l of [...GRIDS, ...LAYOUTS]) {
    const seats = doneSeats(l), st = l.stations.done, lane = l.lane.done, near = (t: Pt) => (t.x - lane) ** 2 + (t.y - l.rooms.done.y0) ** 2;
    assert.deepEqual(seats, l.cafes.flatMap(t => [{ x: t.x - CAFE_DX, y: t.y }, { x: t.x + CAFE_DX, y: t.y }]));
    assert.deepEqual(l.cafes, [...l.cafes].sort((p, q) => near(p) - near(q)), `${l.key}: tables nearest the door first`);
    assert.equal(new Set(seats.map(s => `${s.x},${s.y}`)).size, seats.length);
    seats.forEach((s, i) => assert.deepEqual([cafeSide(l, s), doneAisle(l, s)], [i % 2 ? 'r' : 'l', s.y + 10]));
    for (const s of seats) {
      assert.ok(within(sprite(s), { ...l.rooms.done, y0: l.hallY }), `${l.key} seat ${s.x},${s.y}`);
      assert.ok(!meet(sprite(s), { x0: st.x, y0: st.y - 6, x1: st.x + 32, y1: st.y + 32 }), `${l.key} seat on the coffee table`);
      assert.ok(s.x - 8 >= l.lane.done + 8, `${l.key} seat ${s.x},${s.y} on the Done lounge lane`);   // a walker there never covers a seated one
    }
  }
});
test('cafes: one table by the board against the back wall, the others on the floor 12 px apart; clear of the door, the signs (flat and iso), the robot, Smooth, the furniture and the decor; the coffee corner at home', () => {
  for (const l of GRIDS) {
    const d = l.rooms.done, sign = doorSign(l), b = boardOf(l), st = l.stations.done;
    assert.deepEqual(l.stations.done, { x: d.x1 - 36, y: l.h - 70 }, l.key);
    const wall = l.cafes.filter(t => t.y === d.y0 + 10);
    // on the grid's first column 4 px or more right of the board, else (none fits the room) 4 px right of it
    const first = l.lane.done + 38 + Math.ceil((b.x1 + 26 - l.lane.done - 38) / CAFE_PX) * CAFE_PX;
    assert.deepEqual(wall, [{ x: first <= d.x1 - 24 ? first : b.x1 + 4 + CAFE_DX + 8, y: d.y0 + 10 }], l.key);
    assert.ok(wall[0].x - CAFE_DX - 5 >= sign.x1, `${l.key}: the left sitter's ✓ under the sign`);
    const ko = decorKeepOut(l), floor = ko.filter(k => k.why === 'robot' || k.why === 'cat'), over = ko.filter(k => k.why === 'door' || k.why === 'label');
    const solid = [{ x0: st.x, y0: st.y - 6, x1: st.x + 32, y1: st.y + 32 }, b, ...placeDecor(l)];
    for (const t of l.cafes) {
      const box = cafeBox(t), foot = cafeFoot(t);
      assert.ok(box.x0 >= l.lane.done + 16 && box.x1 <= d.x1 - 2 && t.y + 15 <= d.y1, `${l.key} table ${t.x},${t.y} outside the Done lounge or on its lane`);
      for (const k of floor) assert.ok(!meet(foot, k), `${l.key} table ${t.x},${t.y} on a ${k.why} box`);
      for (const k of over) assert.ok(!meet(box, k), `${l.key} table ${t.x},${t.y} under a ${k.why} box`);
      for (const r of solid) assert.ok(!meet(box, r), `${l.key} table ${t.x},${t.y} on ${JSON.stringify(r)}`);
      for (const o of l.cafes) if (o !== t) assert.ok(!meet(box, { x0: o.x - 34, y0: o.y - 44, x1: o.x + 34, y1: o.y + 13 }), `${l.key}: tables ${t.x},${t.y} and ${o.x},${o.y} closer than 12 px`);
    }
  }
});
// the Done lounge's tables in order, every one on a line across and down
test('cafes: the floor tables on one grid, CAFE_PX apart across from the first column off the lane and CAFE_PY down from the wall table\'s line; the wall table on a column but where none right of the board fits the room (34×18, 35×19)', () => {
  const rows = (l: Layout) => [...new Set(l.cafes.map(t => t.y - l.rooms.done.y0))].sort((a, b) => a - b);
  const cols = (l: Layout) => [...new Set(l.cafes.filter(t => t.y > l.rooms.done.y0 + 10).map(t => t.x - l.rooms.done.x0))].sort((a, b) => a - b);
  for (const l of GRIDS) {
    const d = l.rooms.done, x0 = l.lane.done + 38, wall = l.cafes.find(t => t.y === d.y0 + 10)!;
    for (const t of l.cafes) {
      assert.equal((t.y - d.y0 - 10) % CAFE_PY, 0, `${l.key}: table ${t.x},${t.y} off the rows`);
      if (t !== wall || !['34x18', '35x19'].includes(l.key)) assert.equal((t.x - x0) % CAFE_PX, 0, `${l.key}: table ${t.x},${t.y} off the columns`);
    }
  }
  assert.deepEqual(GRIDS.map(l => `${l.key} ${cols(l)} / ${rows(l)}`), ['34x18 46,102 / 10,55', '35x19 46,102 / 10,55', '41x24 46,102 / 10,55,100', '42x23 46,102,158 / 10,55,100',
    '47x25 46,102,158 / 10,55,100', '72x38 46,102,158,214,270 / 10,55,100,145,190', '74x39 46,102,158,214,270 / 10,55,100,145,190', '45x24 46,102,158 / 10,55,100', '52x27 46,102,158 / 10,55,100,145']);
});
test('cafes: a sitter walks out and to the coffee clear of the furniture and every other table, out past nobody\'s feet; no other Done lounge walk, the robot or Smooth crosses a table', () => {
  for (const l of GRIDS) {
    const { boxes, feet } = walkBlocks(l), st = l.stations.done, corner = { x0: st.x, y0: st.y - 6, x1: st.x + 32, y1: st.y + 32 }, d = l.rooms.done;
    const is = (b: Rect) => (r: Rect) => r.x0 === b.x0 && r.y0 === b.y0 && r.x1 === b.x1 && r.y1 === b.y1;
    const seats = doneSeats(l);
    for (const p of seats) {
      const a = doneAisle(l, p), out = route(l, { room: 'done', pt: p, aisle: a }, outside(l)), trip = tripPath(p, st, a), own = cafeFoot(tableOf(l, p));
      const solid = boxes.filter(b => !is(own)(b));
      for (const q of steps(out)) {
        assert.ok(!solid.some(b => meet(footBox(q), b)), `${l.key} ${p.x},${p.y}: its way out meets furniture at ${q.x},${q.y}`);
        if (q.x >= d.x0 && q.y >= d.y0) assert.ok(!feet.some(f => !same(f, p) && meet(footBox(q), footBox(f))), `${l.key} ${p.x},${p.y}: its way out steps on feet at ${q.x},${q.y}`);
      }
      for (const q of steps(trip)) assert.ok(!solid.some(b => !is(corner)(b) && meet(footBox(q), b)), `${l.key} ${p.x},${p.y}: its coffee walk meets furniture at ${q.x},${q.y}`);
    }
    for (const s of seats) for (const path of [route(l, { room: 'done', pt: s, aisle: doneAisle(l, s) }, outside(l)), tripPath(s, st, doneAisle(l, s))])
      for (const q of steps(path)) for (const t of l.cafes) if (!same(tableOf(l, s), t)) assert.ok(!meet(footBox(q), cafeFoot(t)), `${l.key} the walk from ${s.x},${s.y} crosses the table ${t.x},${t.y} at ${q.x},${q.y}`);
  }
});
test('boardOf: on the Done lounge\'s back wall right of the door\'s sign, its legs over the robot\'s line, 28 to 40 px wide, clear of the door, the flat signs, the tables, Smooth and every Done lounge walk', () => {
  for (const l of GRIDS) {
    const d = l.rooms.done, b = boardOf(l), sign = doorSign(l), legs = { ...b, y0: b.y1 - 10 };
    assert.ok(b.x0 >= sign.x1 + 2 && b.x1 - b.x0 >= 28 && b.x1 - b.x0 <= 40 && b.y1 === d.y0 + 11, `${l.key}: ${JSON.stringify(b)}`);
    for (const k of decorKeepOut(l).filter(k => ['robot', 'cat', 'door', 'label'].includes(k.why))) assert.ok(!meet(k.why === 'label' || k.why === 'door' ? b : legs, k), `${l.key}: the board on a ${k.why} box`);
    for (const t of l.cafes) assert.ok(!meet(b, { ...cafeBox(t), x0: cafeBox(t).x0 - 4 }), `${l.key}: the board at a table`);
    for (const s of doneSeats(l)) for (const path of [route(l, { room: 'done', pt: s, aisle: doneAisle(l, s) }, outside(l)), tripPath(s, l.stations.done, doneAisle(l, s))])
      for (const q of steps(path)) assert.ok(!meet(footBox(q), legs), `${l.key}: the walk from ${s.x},${s.y} crosses the board at ${q.x},${q.y}`);
  }
});
test('isoSign: the door signs keep off the Done lounge\'s board, café tables and sitters at every text scale, either language (but the Turkish Library sign at k 3 on 34×18, with no free place: it covers the board\'s top right)', () => {
  for (const l of GRIDS) for (const k of [1, 2, 3]) for (const lang of ['en', 'tr'] as const) {
    const placed: Rect[] = [];
    for (const d of l.doors) {
      const text = TEXT[lang][`door.${d.id}`], b = signBox(isoSign(l, d, k, text, placed), text, k);
      placed.push(b);
      if (l.key === '34x18' && k === 3 && lang === 'tr' && d.id === 'library') continue;
      for (const r of isoDoneBoxes(l)) assert.ok(!meet(b, r), `${l.key} k ${k} ${lang}: the ${d.id} sign on ${JSON.stringify(r)}`);
    }
  }
});

// the sofa set stands in the Waiting room, its seats the waiters' first; on 34×18 and 35×19
// (the 1920×945 and 1366×657 windows) the coffee corner moves right of it, elsewhere it stays at the bottom's middle
const WAITS = [...GRIDS, ...LAYOUTS, page(1920, 945), page(1366, 657)];
const setBox = (l: Layout): Rect => ({ x0: l.sofa.x, y0: l.sofa.y, x1: l.sofa.x + 56, y1: l.sofa.y + 74 });
test('sofa set: in the Waiting room 4 px off its left wall and 16 px under its back wall; the coffee corner moves right of it only where the set\'s lowest walk would cross it', () => {
  assert.deepEqual(GRIDS.map(l => `${l.key}:${l.waits.length}:${l.stations.wait.y === l.h - 34 ? 'bottom' : 'right'}`),
    ['34x18:6:right', '35x19:6:right', '41x24:6:bottom', '42x23:6:bottom', '47x25:6:bottom', '72x38:6:bottom', '74x39:6:bottom', '45x24:6:bottom', '52x27:6:bottom']);
  assert.deepEqual([page(1920, 945).key, page(1366, 657).key], ['52x27', '34x18']);
  for (const l of WAITS) {
    const r = l.rooms.wait, st = l.stations.wait, corner = { x0: st.x, y0: st.y - 6, x1: st.x + 32, y1: st.y + 32 }, set = setBox(l);
    assert.deepEqual(l.sofa, { x: r.x0 + 4, y: r.y0 + 16 }, l.key);
    assert.ok(within(set, r) && within(corner, r) && !meet(set, corner) && corner.x1 <= l.lane.wait - 6, `${l.key}: the set or the coffee corner out of place`);
    const ko = decorKeepOut(l);
    for (const k of ko.filter(k => ['door', 'label', 'robot', 'cat', 'courier'].includes(k.why))) assert.ok(!meet(set, k), `${l.key}: the set on a ${k.why} box ${JSON.stringify(k)}`);
    for (const p of placeDecor(l).filter(p => !DECOR_FLOOR.has(p.name))) assert.ok(!meet(set, p), `${l.key}: the set on the ${p.name}`);
    const rug = placeDecor(l).find(p => p.name === 'rugWait');
    if (rug) assert.ok(!meet(rug, set) && rug.x1 - rug.x0 >= 60, `${l.key}: the rug under the set`);
  }
});
const DECOR_FLOOR = new Set(['rugWait']);
test('waitSpots: the sofa\'s five seats first, then of the standing spots those clear of the set, the coffee corner and every sofa walk; distinct, inside the Waiting room; nobody moves as others arrive', () => {
  for (const l of WAITS) {
    const seats = sofaSeats(l.sofa), r = l.rooms.wait, st = l.stations.wait, corner = { x0: st.x, y0: st.y - 6, x1: st.x + 32, y1: st.y + 32 };
    assert.deepEqual(l.waits.slice(0, 5), seats);
    assert.deepEqual(seats.map(s => [s.x - l.sofa.x, s.y - l.sofa.y, waitAisle(l, s) - l.sofa.y]), [[48, 70, 72], [32, 70, 72], [8, 38, 80], [32, 14, 16], [48, 14, 16]]);
    assert.equal(new Set(l.waits.map(p => `${p.x},${p.y}`)).size, l.waits.length);
    for (const p of l.waits.slice(5)) {
      assert.ok(within(sprite(p), { ...r, y0: l.hallY }) && !meet(sprite(p), setBox(l)) && !meet(sprite(p), corner), `${l.key} spot ${p.x},${p.y}`);
      assert.equal(waitAisle(l, p), p.y);
    }
    for (let n = 1; n <= 8; n++) assert.deepEqual(waitSpots(n, l).slice(0, n - 1), waitSpots(n - 1, l), `${l.key}: someone moved at ${n}`);
    assert.deepEqual(waitSpots(9, l).slice(l.waits.length), Array(9 - l.waits.length).fill(l.waits.at(-1)));
  }
});
test('waitSpots: every waiter walks out and to the coffee clear of the furniture (a sofa sitter slides only along its own sofa) and past nobody\'s feet in the Waiting room; others\' varied walks keep off the set', () => {
  for (const l of WAITS) {
    const { boxes, feet } = walkBlocks(l), st = l.stations.wait, corner = { x0: st.x, y0: st.y - 6, x1: st.x + 32, y1: st.y + 32 }, r = l.rooms.wait;
    const parts = sofaParts(l.sofa), mine = (p: Pt) => p.y > l.sofa.y + 60 ? parts.bottom : p.y < l.sofa.y + 20 ? parts.top : parts.side;
    const is = (b: Rect) => (q: Rect) => q.x0 === b.x0 && q.y0 === b.y0 && q.x1 === b.x1 && q.y1 === b.y1;
    for (const part of Object.values(parts)) assert.ok(boxes.some(is(part)), `${l.key}: the sofa set is no furniture to a varied walk`);
    for (const p of l.waits) {
      const a = waitAisle(l, p), own = l.waits.slice(0, 5).some(s => same(s, p)) ? mine(p) : null;
      // along its sofa it passes its neighbour there
      const by = (f: Pt) => !same(f, p) && !(own && l.waits.slice(0, 5).some(s => same(s, f)) && is(own)(mine(f)));
      const solid = boxes.filter(b => !own || !is(own)(b)), out = route(l, { room: 'wait', pt: p, aisle: a }, outside(l)), trip = tripPath(p, st, a);
      for (const q of steps(out)) {
        assert.ok(!solid.some(b => meet(footBox(q), b)), `${l.key} ${p.x},${p.y}: its way out meets furniture at ${q.x},${q.y}`);
        if (q.y >= r.y0 && q.x >= r.x0 && q.x <= r.x1) assert.ok(!feet.some(f => by(f) && meet(footBox(q), footBox(f))), `${l.key} ${p.x},${p.y}: its way out steps on feet at ${q.x},${q.y}`);
      }
      for (const q of steps(trip)) {
        assert.ok(!solid.some(b => !is(corner)(b) && meet(footBox(q), b)), `${l.key} ${p.x},${p.y}: its coffee walk meets furniture at ${q.x},${q.y}`);
        assert.ok(!feet.some(f => by(f) && meet(footBox(q), footBox(f))), `${l.key} ${p.x},${p.y}: its coffee walk steps on feet at ${q.x},${q.y}`);
      }
    }
  }
});
test('waitBalloonBoxes: with the sofa the first three always get a balloon, the first two over their heads (or up from under their feet), none over an agent', () => {
  for (const { l, k } of [...BALLOONS, ...[page(1920, 945), page(1366, 657), page(2560, 1270)].map(l => ({ l, k: 1 }))]) for (let n = 1; n <= WAIT_MAX; n++) {
    const pts = waitSpots(n, l), r = waitBalloonBoxes(pts.map((home, i) => ({ id: `w-${i}`, home, at: home })), l, k, []);
    pts.forEach((p, i) => {
      const b = r.boxes.get(`w-${i}`);
      if (i < WAIT_FULL) assert.ok(b, `${l.key} k ${k} n ${n}: w-${i} has no balloon`);
      if (b && n <= 2) assert.ok(b.up ? b.y0 >= p.y : b.y1 <= p.y - 32, `${l.key} k ${k} n ${n}: w-${i}'s balloon beside its head`);
      for (const o of pts) assert.ok(!b || !meet(b, sprite(o)), `${l.key} k ${k} n ${n}: w-${i}'s balloon covers ${o.x},${o.y}`);
    });
  }
});

// a CSS viewport's office area (sidebar 220, header 44), officeLayout then isoFit, as OfficeFloor
const fitted = (vw: number, vh: number, dpr = 1) => { const w = vw - 220, h = vh - 44, l = officeLayout(fit(w, h, { dpr, sb: 15, frame: true })); return { l, f: isoFit(l, w, h, dpr), w, h }; };

test('isoFit: iso fills the office area on the grid officeLayout picked at the largest zoom step that fits; within 3 % above a whole device scale it takes that scale', () => {
  const row = (vw: number, vh: number, dpr = 1) => { const { l, f } = fitted(vw, vh, dpr), v = f.views.iso; return [f.key, +v.css.toFixed(4), v.device, v.mx, v.my, v.k ?? null, f === l]; };
  assert.deepEqual([[1920, 945], [1366, 657], [1600, 789], [1920, 1080], [2560, 1306], [2560, 1440], [1536, 756, 1.25], [2048, 1062, 1.25], [1280, 630, 1.5]].map(([w, h, d]) => row(w, h, d)), [
    ['52x27', 1.25, 1, 8, 8, 1.625, false],       // a 1920×1080 screen: the fit 1.298, the step 1.25 (88.2 % of the area)
    ['34x18', 1.25, 1, 8, 8, 1.625, false],
    ['42x22', 1.25, 1, 8, 8, 1.625, false],
    ['34x18', 2, 2, 8, 8, null, true],            // F11: 2.019, snapped to 2× (today's)
    ['46x25', 2, 2, 8, 8, null, true],            // a 2K window: 2.016, snapped
    ['47x25', 2, 2, 8, 8, null, true],
    ['50x26', 1, 1, 8, 8, 2, false],              // Windows 125 %: 1.25 device px, one-line balloons (k 2)
    ['46x24', 1.6, 2, 8, 8, null, true],          // 2.019 device px, snapped to 2
    ['34x18', 1, 1, 8, 8, 2, false]]);            // 150 %: 1.5 device px
});

test('isoFit: never under auto, never a scroll; whole CSS px; the grid, the desks and flat as officeLayout has them; a zoom step or a whole device scale; a fractional fit\'s text ratio is 1/8 rounded up', () => {
  for (const dpr of [1, 1.25, 1.5, 2]) for (let vw = 1000; vw <= 3000; vw += 97) for (let vh = 500; vh <= 1500; vh += 53) {
    const { l, f, w, h } = fitted(vw, vh, dpr), a = l.views.iso, v = f.views.iso, tag = `${vw}x${vh}@${dpr} ${l.key}`;
    assert.ok(f.key === l.key && f.desks === l.desks && f.views.flat === l.views.flat, tag);
    assert.ok(v.css >= a.css - 1e-9, tag);
    if (f === l) continue;
    const d = v.css * dpr, whole = Math.abs(d - Math.round(d)) < 1e-9;
    assert.ok(whole || d > Math.floor(d) * (1 + SNAP), `${tag}: ${d} not snapped`);
    assert.ok(whole || v.css < 1 || ZOOM_STEPS.some(t => Math.abs(t - v.css) < 1e-9), `${tag}: ${v.css} not a zoom step`);   // under the first step, the fit
    assert.ok(whole ? v.k === undefined : Number.isInteger(v.k! * 8) && v.k! >= Math.max(v.css, 2) / v.css - 1e-9 && v.k! * v.css >= 2 - 1e-9, `${tag}: k ${v.k}`);
    const s = shown(f, 'iso', w, h, dpr, 15);
    assert.ok(!s.scroll.x && !s.scroll.y && s.fw + 2 * s.mx <= w && s.fh + 2 * s.my <= h, `${tag}: scrolls at ${v.css}`);
    if (!whole) for (const n of [s.W, s.H, s.fw, s.fh, s.mx, s.my, s.at!.x, s.at!.y]) assert.ok(Number.isInteger(n) && n >= 0, `${tag}: ${n}`);
    assert.ok(Math.abs(s.textK - textRatio(v)) < 1e-12 && Math.abs(s.text - textRatio(v) * v.css) < 1e-9, tag);
  }
});

// a CSS viewport's office area (sidebar 220, header 44), auto as OfficeFloor has it, then a step's own layout
const zoomed = (vw: number, vh: number, dpr = 1, demand = 3) => {
  const f = fit(vw - 220, vh - 44, { dpr, sb: 15, frame: true, demand }), auto = isoFit(officeLayout(f), f.w, f.h, dpr);
  return { f, auto, at: (z: number) => zoomLayout(f, z, auto) };
};

test('zoomLayout: a step lays iso out anew on the biggest grid it fits at that scale, rows past the area for the desks; auto\'s own step is auto', () => {
  const row = (vw: number, vh: number, dpr = 1, demand = 3) => {
    const { auto, at } = zoomed(vw, vh, dpr, demand);
    return ZOOM_STEPS.map(z => { const l = at(z); return l === auto ? 'auto' : `${l.key} ${l.desks.length} ${doneSeats(l).length} ${l.views.iso.device}`; });
  };
  assert.deepEqual(row(1920, 945), ['68x36 54 40 1', 'auto', '44x23 13 12 1', '36x20 10 10 1', '34x18 10 6 2', '34x18 10 6 2', '34x18 10 6 2']);       // auto 52×27 @1.25
  assert.deepEqual(row(2560, 1270), ['95x50 108 86 1', '74x40 66 52 1', '61x33 36 34 1', '52x28 24 20 1', 'auto', '35x19 10 6 2', '34x18 10 6 2']);  // auto 45×24 @2
  assert.deepEqual(row(1536, 756, 1.25), ['auto', '41x22 10 10 1', '34x18 10 6 1', '34x18 10 6 2', '34x18 10 6 2', '34x18 10 6 2', '34x18 10 6 2']);   // Windows 125 %: auto 50×26 @1
  assert.deepEqual(row(1920, 945, 1, 15), ['68x36 54 40 1', 'auto', '44x24 19 12 1', '36x24 15 10 1', '34x24 15 8 2', '34x24 15 8 2', '34x24 15 8 2']);
  for (const z of ZOOM_STEPS) assert.ok(zoomed(1920, 945, 1, 30).at(z).desks.length >= 30, `${z}`);
});

test('zoomLayout: text keeps auto\'s ratio on +, stays at 2 CSS px on − (1/8 rounded up); the balloons keep auto\'s line rule', () => {
  const ks = (vw: number, vh: number, dpr = 1) => { const { at } = zoomed(vw, vh, dpr); return ZOOM_STEPS.map(z => { const v = at(z).views.iso, k = textRatio(v); return [k, isoLine(v, k)]; }); };
  assert.deepEqual(ks(1920, 945), [[2, true], [1.625, false], [1.625, false], [1.625, false], [1.625, false], [1.625, false], [1.625, false]]);
  assert.deepEqual(ks(2560, 1270), [[2, true], [1.625, true], [1.375, true], [1.25, true], [1, false], [1, false], [1, false]]);   // auto whole px: one line above 1
  // 2048×1062 at 125 %: auto 1.6 is whole device px, ratio 1.25, one-line balloons; zoomed they stay one line (not ISO_TWO's two)
  const { auto, at } = zoomed(2048, 1062, 1.25), v = at(2).views.iso;
  assert.deepEqual([auto.views.iso.css, auto.views.iso.k, textRatio(v), isoLine(auto.views.iso, 1.25), isoLine(v, 1.25)], [1.6, undefined, 1.25, true, true]);
});

test('zoomLayout: over a window sweep the grid never grows with the step and fills the area without a scroll until 34×18; backing ≤ z·dpr and 2·dpr; text ≥ 2 CSS px; frame, flat and line rule auto\'s', () => {
  for (const dpr of [1, 1.25, 1.5, 2]) for (let vw = 1000; vw <= 3000; vw += 193) for (let vh = 500; vh <= 1500; vh += 107) {
    const { f, auto, at } = zoomed(Math.round(vw / dpr), Math.round(vh / dpr), dpr, 0), a = auto.views.iso, ka = textRatio(a);
    const m = ISO.size(34, 18), mf = a.frame ? dashFrame(m.w, m.h) : m;   // the smallest office, framed as auto's
    let prev: Layout | null = null;
    for (const z of ZOOM_STEPS) {
      const l = at(z), v = l.views.iso, k = textRatio(v), tag = `${vw}x${vh}@${dpr} ${z} ${l.key}`;
      if (l === auto) { assert.ok(Math.abs(z - a.css) < 1e-6, tag); continue; }
      if (prev) assert.ok(l.cols <= prev.cols && l.rows <= prev.rows, `${tag} after ${prev.key}`);
      prev = l;
      if (mf.w * z <= f.w - 16 && mf.h * z <= f.h - 16) assert.ok(!v.scroll.x && !v.scroll.y, `${tag}: scrolls`);
      assert.ok(v.device >= 1 && v.device <= Math.max(1, Math.floor(z * dpr + 1e-9)) && v.device <= Math.floor(2 * dpr + 1e-9), `${tag}: b ${v.device}`);
      assert.ok(k >= ka - 1e-12 && k * z >= 2 - 1e-9 && (z > a.css ? k === ka : Number.isInteger(k * 8) || k === ka), `${tag}: k ${k}`);
      assert.ok(v.css === z && v.frame === a.frame && v.line === (a.k === undefined ? 1 : ISO_TWO) && l.views.flat === auto.views.flat, tag);
    }
  }
});
