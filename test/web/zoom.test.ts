import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashFrame, FLAT, ISO, isoFit, officeLayout, textRatio, zoomLayout, type Fit, type Style } from '../../web/src/logic/layout.ts';
import { isStep, shown, ZOOM_STEPS, zoomCentre, zoomIn, zoomOut, zoomScroll } from '../../web/src/logic/zoom.ts';

test('zoomIn / zoomOut: the next step up or down from a stored step or from auto off the list; null past the ends', () => {
  const from = [1, 2, 0.8, 1.6, 3, 1.25, 1.25 - 1e-9];
  assert.deepEqual(from.map(zoomIn), [1.25, 2.5, 1, 1.75, null, 1.5, 1.5]);
  assert.deepEqual(from.map(zoomOut), [null, 1.75, null, 1.5, 2.5, 1, 1]);
});

test('isStep: only the seven steps', () => {
  assert.deepEqual([1, 1.25, 3, 1.3, 0.8, 3.5, '2', null, NaN, undefined].map(isStep), [true, true, true, false, false, false, false, false, false, false]);
});

test('zoomScroll / zoomCentre: the office point at the visible centre stays there across steps; the scroll is whole and clamped', () => {
  const o = 16, client = 1685, max = (z: number) => Math.round(1266 * z) + 2 * o - client;   // 52×27's framed iso, 8 px margins
  for (const c of [200, 628, 1100]) for (const z of [1.5, 1.75, 2, 2.5, 3]) {
    const s = zoomScroll(c, z, o, client, max(z));
    assert.ok(Number.isInteger(s) && s >= 0 && s <= max(z));
    if (s > 0 && s < max(z)) assert.ok(Math.abs(zoomCentre(s, z, o, client) - c) <= 0.5 / z + 1e-9, `c ${c} z ${z}`);
  }
  assert.equal(zoomScroll(0, 2, o, client, max(2)), 0);
  assert.equal(zoomScroll(1266, 2, o, client, max(2)), max(2));
  assert.equal(zoomScroll(628, 1, o, client, -100), 0);   // nothing to scroll
});

const fit = (vw: number, vh: number, dpr = 1): Fit => ({ w: Math.round(vw / dpr) - 220, h: Math.round(vh / dpr) - 44, dpr, demand: 0, sb: 15, frame: true });
const PAGES = [fit(1920, 945), fit(2560, 1270), fit(1366, 657), fit(1920, 945, 1.25), fit(1366, 657, 1.25)];   // 52×27, 45×24, 34×18, 50×26 (auto iso 0.8), 34×18 unframed (auto iso 0.8)

test('shown: flat and a whole device px iso are today\'s numbers exactly', () => {
  for (const p of PAGES) for (const st of ['flat', 'iso'] as Style[]) {
    const l = officeLayout(p), v = l.views[st], s = (st === 'flat' ? FLAT : ISO).size(l.cols, l.rows), f = v.frame ? dashFrame(s.w, s.h) : { w: 0, h: 0, t: 0, r: 0, b: 0, l: 0 }, c = v.css;
    const today = { ...v, text: Math.max(c, 2), textK: Math.max(c, 2) / c, W: s.w * c, H: s.h * c, fw: f.w * c, fh: f.h * c, at: null,
      pad: { t: f.t * c + v.my, r: f.r * c + v.mx, b: f.b * c + v.my, l: f.l * c + v.mx } };   // OfficeFloor's shell before the zoom
    assert.deepEqual(shown(l, st, p.w, p.h, p.dpr, 15), today, `${l.key} ${st}`);
  }
});

// auto as OfficeFloor has it, then a step's own layout
const stepped = (p: Fit) => { const auto = isoFit(officeLayout(p), p.w, p.h, p.dpr); return { auto, at: (z: number) => zoomLayout(p, z, auto) }; };

test('shown: each step\'s own layout is drawn as expected: 1920×945, 2560×1270, Windows 125 %', () => {
  const row = (p: Fit) => { const { at } = stepped(p); return ZOOM_STEPS.map(z => { const s = shown(at(z), 'iso', p.w, p.h, p.dpr, 15); return `${s.fw}x${s.fh}${s.scroll.x ? ' x' : ''}${s.scroll.y ? ' y' : ''}`; }); };
  assert.deepEqual(row(PAGES[0]), ['1666x882', '1583x853', '1611x879', '1572x872', '1668x932 y', '2085x1165 x y', '2502x1398 x y']);
  assert.deepEqual(row(PAGES[1]), ['2322x1210', '2283x1203', '2259x1203', '2244x1208', '2212x1204', '2165x1205', '2502x1398 x y']);
  assert.deepEqual(row(PAGES[3]), ['1218x658', '1263x693', '1251x699', '1460x816 x y', '1668x932 x y', '2085x1165 x y', '2502x1398 x y']);
});

test('shown: a zoom step\'s layout is whole CSS px from the pane\'s corner (the centre rule runs), the shell adds up, the text is the layout\'s ratio, the frame auto\'s; auto is untouched', () => {
  for (const p of PAGES) {
    const { auto, at } = stepped(p), before = JSON.stringify(auto.views);
    for (const z of ZOOM_STEPS) {
      const l = at(z), s = shown(l, 'iso', p.w, p.h, p.dpr, 15), tag = `${l.key}@${p.dpr} ${z}`;
      if (l === auto) continue;
      assert.ok(s.at, tag);
      for (const n of [s.W, s.H, s.fw, s.fh, s.mx, s.my, s.pad.t, s.pad.r, s.pad.b, s.pad.l, s.at.x, s.at.y]) assert.ok(Number.isInteger(n) && n >= 0, `${tag}: ${n}`);
      assert.equal(s.pad.l + s.W + s.pad.r, (s.fw || s.W) + 2 * s.mx, tag);
      assert.equal(s.pad.t + s.H + s.pad.b, (s.fh || s.H) + 2 * s.my, tag);
      assert.ok(s.textK === textRatio(l.views.iso) && Math.abs(s.text - s.textK * z) < 1e-9 && s.text >= 2 - 1e-9, tag);
      assert.ok(s.css === z && s.device === l.views.iso.device && s.frame === auto.views.iso.frame, tag);
    }
    assert.equal(JSON.stringify(auto.views), before);
  }
});

test('shown: iso\'s fit (1920×945: the step 1.25) is drawn the whole-px way, no scroll, text ratio 1.625; −/+ go to 1/1.5, the text 1.625·z but never under 2', () => {
  const p = PAGES[0], l = isoFit(officeLayout(p), p.w, p.h, 1), a = l.views.iso.css;
  const auto = shown(l, 'iso', p.w, p.h, 1, 15);
  assert.deepEqual([a, auto.device, auto.W, auto.H, auto.fw, auto.fh, auto.mx, auto.my, auto.scroll.x, auto.scroll.y, auto.at!.x, auto.at!.y, auto.textK],
    [1.25, 1, 1570, 843, 1583, 853, 8, 8, false, false, 50, 16, 1.625]);
  assert.ok(Math.abs(auto.text - 1.625 * a) < 1e-9 && auto.text >= 2);
  assert.deepEqual([zoomIn(a), zoomOut(a)], [1.5, 1]);
  for (const z of ZOOM_STEPS) { const s = shown(zoomLayout(p, z, l), 'iso', p.w, p.h, 1, 15); assert.ok(Math.abs(s.text - Math.max(2, 1.625 * z)) < 1e-9 && s.device === (z >= 2 ? 2 : 1), `${z}`); }
});
