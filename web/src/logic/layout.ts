// The corridor office: from the measured box, each style's whole-device-pixel scale,
// the one tile grid both styles draw, and its rooms, walls, doors, desks and lounge places.
// Flat office px throughout; a tile is 16 px.
import { tripPath } from './coffee.ts';
import { robotLines } from './robot.ts';

export const TILE = 16, MIN_C = 34, MIN_R = 18, WAIT_FULL = 3, WAIT_MAX = 6;
export const MIN_W = { main: 12, server: 10, library: 9, wait: 9, done: 10 } as const, MIN_K = 7;

export type WorkRoom = 'main' | 'server' | 'library';
export type RoomId = WorkRoom | 'wait' | 'done' | 'hall';
export interface Pt { x: number; y: number }                 // flat office px, feet point
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface Door { id: 'in' | 'hall' | 'server' | 'library' | 'wait' | 'done'; x: number; y: number; side: -1 | 0 | 1 } // side: sign left/right of the door, 0 above it
/** A door's sign in the flat office (office px): x as the overlay anchors a sign of its side, y its top. */
export const flatSignAt = (d: Door): Pt => d.side === 0 ? { x: d.x + (d.x ? 8 : 12), y: d.y - (d.id === 'hall' ? 46 : 40) } : { x: d.side < 0 ? d.x - 2 : d.x + 18, y: d.y - 30 };
export interface Desk { cx: number; y: number; room: WorkRoom; seat: Pt; aisle: number }   // y: desk sprite top
export interface View { size(cols: number, rows: number): { w: number; h: number } }   // a style's canvas, office px, for a cols×rows grid
export type Style = 'flat' | 'iso';
// measured box (CSS px), desks needed, scrollbar thickness (CSS px); `frame`: the box is the page's office area, each
// style fitted with its margins and dashed frame (officeLayout), else the bare office's
export interface Fit { w: number; h: number; dpr: number; demand: number; sb: number; frame?: boolean }
// mx, my: the style's margin outside its frame (CSS px); frame: its dashed frame drawn
// k: text px per office px where it is not textScale(css) / css (iso's fit: rounded up to 1/8)
// line: the text ratio above which iso's balloons are one line, where it is not isoLine's own (a zoom: auto's)
export interface StyleScale { device: number; css: number; scroll: { x: boolean; y: boolean }; mx: number; my: number; frame: boolean; k?: number; line?: number }
export interface Layout {
  cols: number; rows: number; k: number; w: number; h: number; key: string;   // flat office px; key = `${cols}x${rows}`; k: the wall row between upper rooms and corridor
  views: Record<Style, StyleScale>;                                            // both styles draw this grid, each at its own scale
  widths: Record<'main' | 'server' | 'library' | 'wait' | 'done', number>;    // tiles
  rooms: Record<RoomId, Rect>; walls: Map<string, RoomId>;                     // "c,r" → whose wall colour
  doors: Door[]; desks: Desk[]; foreman: Desk;                                 // desks: main, then server, then library; row by row, left to right
  hallY: number; lane: Record<'main' | 'server' | 'library' | 'wait' | 'done', number>; // corridor walking line; each room's door column (x)
  stations: Record<'wait' | 'done', Pt>;                                       // coffee tables' top-left corners
  sofa: Pt; waits: Pt[];                                                       // the Waiting room's sofa set's top-left corner; its places, the sofa's first
  cafes: Pt[];                                                                 // the Done lounge's café tables: centre x, sitters' feet y
}

// The isometric projection's canvas: the flat grid seen as a 2:1 diamond.
export const WALL_H = 48, PAD = 8, T = 0.25;   // back wall height (px), canvas padding (px), wall thickness (tiles)
export interface IsoView { w: number; h: number; ox: number; oy: number; depth: number /* world rows */ }

/** PAD left and right (the medics walk in there); top and bottom the canvas ends at the back wall's top and the floor's
 *  front edge (no empty bands). */
export function isoView(cols: number, rows: number): IsoView {
  const depth = rows - 2, ox = Math.ceil((depth + T) * 16) + PAD, oy = WALL_H + T * 16;
  return { w: ox + Math.ceil((cols + T) * 16) + PAD, h: oy + (cols + depth) * 8 + 6, ox, oy, depth };
}

export const FLAT: View = { size: (c, r) => ({ w: c * TILE, h: r * TILE }) };
export const ISO: View = { size: (c, r) => { const v = isoView(c, r); return { w: v.w, h: v.h }; } };

const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const sprite = (p: Pt): Rect => ({ x0: p.x - 8, y0: p.y - 32, x1: p.x + 8, y1: p.y });

/** Tile by tile from 34×18: the axis further behind its minimum first (cols on a tie), else the other one. A step is
 *  taken when every dimension it grows still fits the box at `css` (one that already overflows and does not grow is no bar). */
export function grow(view: View, css: number, w: number, h: number): { cols: number; rows: number } {
  let cols = MIN_C, rows = MIN_R;
  const fits = (c: number, r: number) => {
    const a = view.size(cols, rows), b = view.size(c, r);
    return (b.w <= a.w || b.w * css <= w) && (b.h <= a.h || b.h * css <= h);
  };
  for (;;) {
    const steps = cols / MIN_C <= rows / MIN_R ? [[1, 0], [0, 1]] : [[0, 1], [1, 0]];
    const step = steps.find(([dc, dr]) => fits(cols + dc, rows + dr));
    if (!step) return { cols, rows };
    cols += step[0]; rows += step[1];
  }
}

/** Extra columns go to the rooms in proportion to their minimum widths; 60 % of the extra rows go to the upper rooms. */
export function split(cols: number, rows: number): Layout['widths'] & { k: number } {
  const xc = cols - MIN_C, xr = rows - MIN_R, main = MIN_W.main + Math.round(xc * MIN_W.main / (MIN_C - 2)), U = cols - 3 - main;
  const server = Math.round(U * MIN_W.server / (MIN_W.server + MIN_W.library)), wait = Math.round(U * MIN_W.wait / (MIN_W.wait + MIN_W.done));
  return { main, server, library: U - server, wait, done: U - wait, k: MIN_K + Math.round(xr * 0.6) };
}

/** Whose floor tile (c, r) is. */
export function regionAt(l: Pick<Layout, 'widths' | 'k'>, c: number, r: number): RoomId {
  const mw = l.widths.main + 1, su = mw + l.widths.server + 1, sl = mw + l.widths.wait + 1;
  return c <= mw ? 'main' : r <= l.k ? (c <= su ? 'server' : 'library') : r <= l.k + 2 ? 'hall' : c <= sl ? 'wait' : 'done';
}

function build(cols: number, rows: number): Omit<Layout, 'views'> {
  const { k, ...widths } = split(cols, rows), W = cols * TILE, H = rows * TILE, lowTop = (k + 4) * TILE, upLim = (k - 1) * TILE;
  const mw = widths.main + 1, su = mw + widths.server + 1, sl = mw + widths.wait + 1;   // main's right wall; upper / lower split walls
  const room = (c0: number, c1: number, y0: number, y1: number): Rect => ({ x0: c0 * TILE, y0, x1: (c1 + 1) * TILE, y1 });
  const rooms: Record<RoomId, Rect> = {
    main: room(1, widths.main, 32, H), server: room(mw + 1, su - 1, 32, upLim), library: room(su + 1, cols - 1, 32, upLim),
    hall: { x0: (mw + 1) * TILE, y0: (k + 1) * TILE, x1: W, y1: lowTop },
    wait: room(mw + 1, sl - 1, lowTop, H), done: room(sl + 1, cols - 1, lowTop, H),
  };
  const region = (c: number, r: number) => regionAt({ widths, k }, c, r);

  // walls: door openings are missing cells
  const walls = new Map<string, RoomId>(), set = (c: number, r: number, id: RoomId) => walls.set(`${c},${r}`, id);
  const dc = { server: su - 1, library: cols - 1, wait: sl - 1, done: sl + 1 };   // door columns in the corridor walls
  for (let c = 0; c < cols; c++) set(c, 1, region(c, 1));
  for (let r = 2; r < rows - 2; r++) set(0, r, 'main');                            // the last two rows are the entrance
  for (let r = 2; r < rows; r++) if (r !== k + 1 && r !== k + 2) set(mw, r, 'main');
  for (let r = 2; r < k; r++) set(su, r, 'server');
  for (let r = k + 4; r < rows; r++) set(sl, r, 'wait');
  for (let c = mw + 1; c < cols; c++) {
    if (c !== dc.server && c !== dc.library) set(c, k, region(c, k));
    if (c !== dc.wait && c !== dc.done) set(c, k + 3, 'wait');
  }

  const hallY = (k + 2) * TILE;
  const doors: Door[] = [
    { id: 'in', x: 0, y: H - 16, side: 0 },
    { id: 'hall', x: mw * TILE, y: hallY, side: 0 },
    { id: 'server', x: dc.server * TILE, y: (k + 1) * TILE, side: -1 },
    { id: 'library', x: dc.library * TILE, y: (k + 1) * TILE, side: -1 },
    { id: 'wait', x: dc.wait * TILE, y: lowTop, side: -1 },
    { id: 'done', x: dc.done * TILE, y: lowTop, side: 1 },
  ];

  // desks: main starts below the foreman; upper rooms put their row right under the top wall; the server keeps a rack column
  const desks: Desk[] = [];
  for (const id of ['main', 'server', 'library'] as const) {
    const r = rooms[id], top = id === 'main' ? 124 : 48, maxY = id === 'main' ? H - 78 : r.y1 - 48;
    const x0 = r.x0 + (id === 'server' ? 32 : 0), d = Math.max(1, Math.floor((r.x1 - x0 - 64) / 64) + 1), off = Math.floor((r.x1 - x0 - 64 * d) / 2);
    const ys: number[] = [];
    for (let y = top; y <= maxY; y += 86) ys.push(y);
    // the server room's floor under its last row takes one more on the room's bottom line, 64 px or more under it (its
    // tag, d.y − 18, then starts under the feet above): where the rack island stood
    if (id === 'server' && maxY - ys[ys.length - 1] >= 64) ys.push(maxY);
    for (const y of ys) for (let j = 0; j < d; j++) {
      const cx = x0 + off + 24 + j * 64, seat = { x: cx, y: y + 46 };
      desks.push({ cx, y, room: id, seat, aisle: id === 'main' ? seat.y + 12 : seat.y });
    }
  }
  const row0 = desks.filter(d => d.room === 'main' && d.y === 124), fx = (row0[0].cx + row0[row0.length - 1].cx) / 2;

  const { wait, done } = rooms, so = { x: wait.x0 + 4, y: wait.y0 + 16 };
  const g = {
    cols, rows, k, w: W, h: H, key: `${cols}x${rows}`, widths, rooms, walls, doors, desks, hallY,
    foreman: { cx: fx, y: 44, room: 'main' as const, seat: { x: fx, y: 66 }, aisle: 92 },
    lane: { main: rooms.main.x1 - 8, server: rooms.server.x1 - 8, library: rooms.library.x1 - 8, wait: wait.x1 - 8, done: done.x0 + 8 },
    // the Waiting room's coffee corner stays at the bottom's middle where it clears the sofa set's
    // lowest walk (SOFA_SEATS: the side seat's line, 80 px under the set's top), else it moves right of the set, between
    // the top and bottom sofas' lines (34×18, 35×19)
    stations: { wait: H - 40 >= so.y + 82 ? { x: Math.round((wait.x0 + wait.x1) / 2) - 16, y: H - 34 } : { x: so.x + 84, y: so.y + 26 }, done: { x: done.x1 - 36, y: H - 70 } },
    sofa: so,
  };
  return { ...g, waits: waitPlaces(g), cafes: cafes(g) };
}

const flatMin = (dpr: number) => Math.max(1, Math.floor(2 * dpr));   // flat's lowest device scale: 2 CSS px, rounded down
export const MARGIN = 8;   // CSS px: the office's margin outside its frame (OfficeFloor's shell padding)
export const DASH = 2;     // office px: the frame's line thickness, dash and gap (square blocks)

/** The gaps (office px) between an n px office side and the frame's lines before and after it: 2 to 4 each (together
 *  4 + up to 3), so the frame's side (n + gaps + two lines) is an odd number of DASH blocks, a dash at both corners. */
export function frameGaps(n: number): [number, number] {
  const g = 4 + ((-2 - n) % 4 + 4) % 4;
  return [Math.floor(g / 2), Math.ceil(g / 2)];
}
const frameAdd = (n: number) => frameGaps(n)[0] + frameGaps(n)[1] + 2 * DASH;   // what the frame adds to an n px side

/** The pixel dashed frame around a w×h office (office px): its thickness per side (gap + line), its size, and its
 *  DASH blocks' top-left corners (corners shared by two sides). */
export function dashFrame(w: number, h: number): { l: number; r: number; t: number; b: number; w: number; h: number; blocks: Pt[] } {
  const [l, r] = frameGaps(w).map(g => g + DASH), [t, b] = frameGaps(h).map(g => g + DASH), W = w + l + r, H = h + t + b;
  const blocks: Pt[] = [];
  for (let x = 0; x < W; x += 2 * DASH) blocks.push({ x, y: 0 }, { x, y: H - DASH });
  for (let y = 2 * DASH; y < H - DASH; y += 2 * DASH) blocks.push({ x: 0, y }, { x: W - DASH, y });
  return { l, r, t, b, w: W, h: H, blocks };
}

/** The page's margins and frame at a style's scale unless officeLayout climbs it: the measured area minus an 8 px margin
 *  per side, and whether the dashed frame is drawn. Per axis the margin shrinks (whole px, down to 0) where
 *  only the margin would make the flat minimum office scroll; where the frame alone would (the bare minimum fits, framed
 *  it does not), the frame goes; an axis the bare minimum overflows anyway keeps 8 and the frame. */
export function frameBox(w: number, h: number, dpr: number): { w: number; h: number; mx: number; my: number; frame: boolean } {
  const css = flatMin(dpr) / dpr, min = FLAT.size(MIN_C, MIN_R);
  const scrolls = (a: number, n: number) => a >= n * css && a < (n + frameAdd(n)) * css;   // the frame alone would scroll it
  const frame = !scrolls(w, min.w) && !scrolls(h, min.h);
  const need = (n: number) => (frame ? n + frameAdd(n) : n) * css;
  const m = (a: number, need: number) => a - 2 * MARGIN >= need || a < need ? MARGIN : Math.floor((a - need) / 2);
  const mx = m(w, need(min.w)), my = m(h, need(min.h));
  return { w: w - 2 * mx, h: h - 2 * my, mx, my, frame };
}

const framed = (v: View, on: boolean): View => on ? { size: (c, r) => { const s = v.size(c, r); return { w: s.w + frameAdd(s.w), h: s.h + frameAdd(s.h) }; } } : v;
type Placed = Pick<StyleScale, 'device' | 'mx' | 'my' | 'frame'>;

/** Each style's scale (whole device px, bounds rounded down), the grid that fits both, then desk demand:
 *  both scales drop a step at a time, then desk rows are added past the box (it scrolls). With `frame` the box is the
 *  office area and each style its office with frameBox's margins and dashed frame. Iso then
 *  climbs above its scale on the grid flat's scale sets (never a smaller one), each style keeping its own margin and
 *  frame: iso's margin shrinks (whole px, per axis), its frame always kept, it never scrolls for it; where that needs
 *  flat's next scale, flat's margin shrinks for it. Where iso cannot climb, flat goes no higher than iso's step (flatLo
 *  + iso's steps above isoLo), so the grid stays the bigger one (1920×945 is flat 2×,
 *  iso 1× on 52×27 with 21 desks, not 34×18). A grid with too few desks falls back to the scales above. */
export function officeLayout(fit: Fit): Layout {
  const { w, h, dpr, demand, sb } = fit;
  const base = fit.frame ? frameBox(w, h, dpr) : { mx: 0, my: 0, frame: false }, cap = fit.frame ? MARGIN : 0;
  const flatLo = flatMin(dpr), flatHi = Math.max(flatLo, Math.floor(3 * dpr));
  const isoLo = Math.max(1, Math.floor(dpr)), isoHi = Math.max(isoLo, Math.floor(2 * dpr));
  const floor = (device: number): Placed => ({ device, mx: base.mx, my: base.my, frame: base.frame });
  /** `v` at `device` on a c×r office with frameBox's frame, its margins shrinking from `cap`; null where it does not fit. */
  const place = (v: View, device: number, c: number, r: number): Placed | null => {
    const css = device / dpr, s = framed(v, base.frame).size(c, r);
    const mx = Math.min(cap, Math.floor((w - s.w * css) / 2)), my = Math.min(cap, Math.floor((h - s.h * css) / 2));
    return mx >= 0 && my >= 0 ? { device, mx, my, frame: base.frame } : null;
  };
  /** The largest scale whose minimum office fits with frameBox's margins (`shrink`: margins down to 0). */
  const pick = (v: View, lo: number, hi: number, shrink: boolean): Placed => {
    for (let d = hi; d > lo; d--) {
      const p = place(v, d, MIN_C, MIN_R);
      if (p && shrink) return p;
      if (p && p.mx >= base.mx && p.my >= base.my) return floor(d);
    }
    return floor(lo);
  };
  let flat = pick(FLAT, flatLo, flatHi, false), iso = pick(ISO, isoLo, isoHi, false);
  const grown = (v: View, p: Placed) => grow(framed(v, p.frame), p.device / dpr, w - 2 * p.mx, h - 2 * p.my);
  const climb = (): [Placed, Placed, Omit<Layout, 'views'>] | null => {
    for (const f of [flat, pick(FLAT, flatLo, flatHi, true)]) {
      const F = grown(FLAT, f);
      for (let d = isoHi; d > iso.device; d--) {
        const i = place(ISO, d, F.cols, F.rows), g = i && build(F.cols, F.rows);
        if (g && g.desks.length >= demand) return [f, i!, g];
      }
    }
    return null;
  };
  let g: Omit<Layout, 'views'>;
  const up = climb();
  if (up) [flat, iso, g] = up;
  // iso did not climb: flat no higher than iso's step, so it never shrinks the grid for nothing
  else for (flat = floor(Math.min(flat.device, flatLo + iso.device - isoLo)); ;) {
    const f = grown(FLAT, flat), i = grown(ISO, iso);
    g = build(Math.min(f.cols, i.cols), Math.min(f.rows, i.rows));
    if (g.desks.length >= demand || (flat.device === flatLo && iso.device === isoLo)) break;
    if (flat.device > flatLo) flat = floor(flat.device - 1);
    if (iso.device > isoLo) iso = floor(iso.device - 1);
  }
  while (g.desks.length < demand) g = build(g.cols, g.rows + 1);
  const scale = (v: View, p: Placed): StyleScale => {
    const s = framed(v, p.frame).size(g.cols, g.rows), css = p.device / dpr;
    return { ...p, css, scroll: { x: s.w * css > w - 2 * p.mx, y: s.h * css > h - 2 * p.my } };
  };
  const views = { flat: scale(FLAT, flat), iso: scale(ISO, iso) }, sx = views.flat.scroll.x || views.iso.scroll.x, sy = views.flat.scroll.y || views.iso.scroll.y;
  if (sb > 0 && (sx || sy)) return officeLayout({ ...fit, w: sy ? w - sb : w, h: sx ? h - sb : h, sb: 0 });
  return { ...g, views };
}

/** A fit at most this much above a whole device scale takes that scale. */
export const SNAP = 0.03;
/** With no zoom stored, iso fills the area (CSS px, MARGIN each side; a fractional pane first
 *  floored, as shown does) on the grid officeLayout picked, never under its whole-px scale; a fit within SNAP above a
 *  whole device scale takes that scale (2K, F11: as before). A fractional fit's text ratio is rounded up to 1/8 (text
 *  ≥ 2 CSS px), so decorKey, and with it the decor, the signs and the bowls, holds still while the window resizes
 *  within a band. The grid, the desks and flat stay; where the fit is not above auto, `l` itself. The
 *  largest zoom step that fits, so the pixels keep a regular rhythm (1920×945: 1.25, not 1.298). */
export function isoFit(l: Layout, aw: number, ah: number, dpr: number): Layout {
  const w = Math.floor(aw), h = Math.floor(ah), v = l.views.iso, s = framed(ISO, v.frame).size(l.cols, l.rows);
  const z = Math.min((w - 2 * MARGIN) / s.w, (h - 2 * MARGIN) / s.h);
  const step = [1, 1.25, 1.5, 1.75, 2, 2.5, 3].filter(t => t <= z + 1e-9).pop() ?? z;   // zoom.ts ZOOM_STEPS (zoom.ts imports this file)
  const d = step * dpr, n = Math.floor(d + 1e-9), css = n >= 1 && d <= n * (1 + SNAP) ? n / dpr : step;
  if (css <= v.css + 1e-9) return l;
  const whole = Math.abs(css * dpr - Math.round(css * dpr)) < 1e-9;
  const iso: StyleScale = { device: Math.max(1, Math.floor(css * dpr + 1e-9)), css, frame: v.frame, scroll: { x: false, y: false },
    mx: Math.min(MARGIN, Math.floor((w - s.w * css) / 2)), my: Math.min(MARGIN, Math.floor((h - s.h * css) / 2)),
    ...(whole ? {} : { k: Math.ceil(8 * Math.max(css, 2) / css - 1e-9) / 8 }) };
  return { ...l, views: { ...l.views, iso } };
}

/** Iso's own office at the zoom step `z` (CSS px per office px), as if the office area
 *  were a smaller or bigger window: the biggest grid whose iso office, framed as auto's, fits at z with MARGIN each
 *  side (grow from 34×18, isoFit's box; shown sets the margins drawn), rows past it while desks fall short (it
 *  scrolls); the backing scale whole device px, at most iso's auto ceiling (2·dpr); auto's text ratio, raised so text
 *  stays at 2 CSS px (1/8 rounded up); auto's balloon line rule. `auto`: isoFit(officeLayout(fit)), returned as it is
 *  at its own scale. Flat never draws this layout: its flat view is auto's. */
export function zoomLayout(fit: Fit, z: number, auto: Layout): Layout {
  const a = auto.views.iso;
  if (Math.abs(z - a.css) < 1e-6) return auto;
  const { w, h, dpr, demand, sb } = fit, v = framed(ISO, a.frame), m = 2 * MARGIN;
  const lay = (bw: number, bh: number) => {
    const { cols, rows } = grow(v, z, bw - m, bh - m);
    let g = build(cols, rows);
    while (g.desks.length < demand) g = build(g.cols, g.rows + 1);
    const s = v.size(g.cols, g.rows);
    return { g, scroll: { x: s.w * z > bw - m, y: s.h * z > bh - m } };
  };
  let { g, scroll } = lay(w, h);
  if (sb > 0 && (scroll.x || scroll.y)) ({ g, scroll } = lay(scroll.y ? w - sb : w, scroll.x ? h - sb : h));   // officeLayout's pass: a scrollbar narrows the other axis
  const iso: StyleScale = { device: Math.max(1, Math.min(Math.floor(z * dpr + 1e-9), Math.floor(2 * dpr + 1e-9))), css: z, frame: a.frame, mx: MARGIN, my: MARGIN, scroll,
    k: Math.max(textRatio(a), Math.ceil(16 / z - 1e-9) / 8), line: a.line ?? (a.k === undefined ? 1 : ISO_TWO) };
  return { ...g, views: { flat: auto.views.flat, iso } };
}

/** Text px per office px: overlay.ts textScale(css) / css, or a fitted iso's own (isoFit). */
export const textRatio = (v: StyleScale): number => v.k ?? Math.max(v.css, 2) / v.css;

// CSS px (styles.css .plate): the floor plate's spot from its corner, its height, a glyph's width at most, its clearance
export const PLATE = { x: 14, y: 12, h: 40, ch: 24, gap: 4 };

/** The floor plate's top-left (CSS px, from this style's shell in OfficeFloor) in a w×h pane, `n` glyphs long: its spot
 *  in the pane's top-left corner where that keeps PLATE.gap off the frame (or the bare office); else iso's same spot
 *  inside its frame, over the empty corner behind the left wall; null where neither is free (flat), it is not drawn.
 *  `v`: the view as drawn (zoom.ts shown); the plate keeps its size at every zoom step. */
export function platePos(l: Layout, st: Style, w: number, h: number, sb: number, n: number, v: StyleScale = l.views[st]): Pt | null {
  const s = (st === 'flat' ? FLAT : ISO).size(l.cols, l.rows), f = v.frame ? dashFrame(s.w, s.h) : { ...s, l: 0, t: 0 };
  // the frame's corner in the pane: the shell is centred (flex margin: auto) in what the scrollbars leave
  const x = Math.max(0, (w - (v.scroll.y ? sb : 0) - f.w * v.css - 2 * v.mx) / 2) + v.mx, y = Math.max(0, (h - (v.scroll.x ? sb : 0) - f.h * v.css - 2 * v.my) / 2) + v.my;
  const P = PLATE, pw = n * PLATE.ch;
  if (P.x + pw + P.gap <= x || P.y + P.h + P.gap <= y) return { x: P.x - x + v.mx, y: P.y - y + v.my };
  if (st !== 'iso') return null;
  // office px from the office's corner: the plate's far corner stays over the left wall's top edge, 4 + (ox − x) / 2 down
  const o = isoView(l.cols, l.rows), X = (P.x + pw - f.l * v.css) / v.css, Y = (P.y + P.h + P.gap - f.t * v.css) / v.css;
  return Y <= T * 16 + (o.ox - T * 16 - X) / 2 ? { x: v.mx + P.x, y: v.my + P.y } : null;
}

/** The queue line by the entrance. */
export const queueSpot = (k: number, l: Layout): Pt => ({ x: 28 + 14 * k, y: l.h - 16 });

/** The Waiting room's sofa set, 56×74 px from its top-left corner
 *  `so`, mirrored so it opens right, toward the door's lane: the side sofa against the left (its back on the left), the
 *  top sofa (facing the viewer) and the bottom one (its back to the viewer) right of it with the coffee table between.
 *  Flat boxes; `lamp`: its floor lamp (decor.ts DECOR.lamp, 8×28) in the 8 px between the side
 *  and the top sofa, at the set's back corner. */
export const sofaParts = (so: Pt): Record<'side' | 'top' | 'table' | 'bottom' | 'lamp', Rect> => ({
  side: { x0: so.x, y0: so.y + 22, x1: so.x + 16, y1: so.y + 54 }, top: { x0: so.x + 24, y0: so.y, x1: so.x + 56, y1: so.y + 16 },
  table: { x0: so.x + 24, y0: so.y + 22, x1: so.x + 56, y1: so.y + 54 }, bottom: { x0: so.x + 24, y0: so.y + 58, x1: so.x + 56, y1: so.y + 74 },
  lamp: { x0: so.x + 16, y0: so.y - 12, x1: so.x + 24, y1: so.y + 16 },
});
/** Its seats [x, y, aisle] from `so` in the order waiters take them: the bottom sofa's (right, left), the side one's,
 *  the top one's (left, right). Of all orders this one gives the first three their balloons, over their heads, on every
 *  tested office and text scale (layout.test.ts). A sitter slides along its own sofa out of the set's open side: the top
 *  and bottom ones along a line 2 px under their feet, the side one down its sofa and along a line under the set. */
const SOFA_SEATS = [[48, 70, 72], [32, 70, 72], [8, 38, 80], [32, 14, 16], [48, 14, 16]] as const;
export const sofaSeats = (so: Pt): Pt[] => SOFA_SEATS.map(([x, y]) => ({ x: so.x + x, y: so.y + y }));
/** The line a Waiting room place leaves along (its Spot's aisle): a sofa seat's (SOFA_SEATS), a standing spot's own y. */
export function waitAisle(l: Pick<Layout, 'sofa'>, p: Pt): number {
  const i = sofaSeats(l.sofa).findIndex(s => s.x === p.x && s.y === p.y);
  return i < 0 ? p.y : l.sofa.y + SOFA_SEATS[i][2];
}

/** Every Waiting room place, in the order waiters take them: the sofa's five seats, then of the standing spots (upper line
 *  left of centre, the two lower corners, the upper line's ends and its middle-right) those clear of the sofa set and the
 *  coffee corner, off every sofa sitter's walk (out and to the coffee), and whose own way out crosses neither. */
function waitPlaces(l: Omit<Layout, 'views' | 'cafes' | 'waits'>): Pt[] {
  const { x0, y0, x1, y1 } = l.rooms.wait, up = y0 + 36, st = l.stations.wait, lane = l.lane.wait, so = l.sofa;
  const spots = [{ x: x0 + 44, y: up }, { x: x0 + 30, y: y1 - 6 }, { x: x1 - 30, y: y1 - 6 }, { x: x1 - 24, y: up }, { x: x0 + 16, y: up }, { x: x1 - 52, y: up }];
  const seats = sofaSeats(so), solid = [{ x0: so.x, y0: so.y, x1: so.x + 56, y1: so.y + 74 }, { x0: st.x, y0: st.y - 6, x1: st.x + 32, y1: st.y + 32 }];
  const out = (p: Pt, a: number) => feet([p, { x: p.x, y: a }, { x: lane, y: a }, { x: lane, y: l.hallY }]);
  const walks = seats.flatMap(s => { const a = waitAisle(l, s); return [...out(s, a), ...feet(tripPath(s, st, a))]; });
  const box = (p: Pt): Rect => ({ x0: p.x - 6, y0: p.y - 4, x1: p.x + 6, y1: p.y + 1 });
  return [...seats, ...spots.filter(p => !solid.some(r => meet(sprite(p), r)) && !walks.some(w => meet(box(p), w)) && !out(p, p.y).some(w => solid.some(r => meet(w, r))))];
}

/** The places of `n` waiters (l.waits in order); past them the rest share the last place. */
export function waitSpots(n: number, l: Pick<Layout, 'waits'>): Pt[] {
  // ponytail: past the places (six on 34×18) the rest stand balloon-less at the last one; spread them out if a floor ever holds that many
  return Array.from({ length: n }, (_, i) => l.waits[Math.min(i, l.waits.length - 1)]);
}

/** The Waiting room balloons' bound: the room's floor and its back wall's face up to the corridor line. */
export const waitBound = (l: Layout): Rect => ({ x0: l.rooms.wait.x0, y0: l.hallY, x1: l.rooms.wait.x1, y1: l.rooms.wait.y1 });

/** A waiting balloon's outer box (1 px border included), office px; the overlay CSS sizes `.bub` to match. */
export const BUBBLE = { w: 68, full: 26, compact: 19, chars: 16 } as const;
/** The one-line balloon, text px. */
export const LINE = { w: 80, h: 9, chars: 17 } as const;
/** `k`: office px per text px; `line` (by default above 1) the balloon is the one-line LINE, scaled, `w` office px wide
 *  (by default never wider than at k 2, 2·LINE.w office px; its text then ends in an ellipsis): at fractional dpr iso's
 *  k reaches 2.5–3, where three full ones do not fit the Waiting room (iso's Waiting room widens it where they do: iso.ts
 *  isoWaitBalloons); else BUBBLE's two lines, scaled by k. styles.css `.bub.line` caps its width the same way. `tail`:
 *  k, the text scale of the tail under the box (.tail). */
export const balloonBox = (k: number, compact: boolean, w = Math.min(LINE.w * k, 2 * LINE.w), line = k > 1): { w: number; h: number; tail: number } =>
  line ? { w, h: LINE.h * k, tail: k } : { w: BUBBLE.w * k, h: (compact ? BUBBLE.compact : BUBBLE.full) * k, tail: k };
/** Under the fit (isoLine) iso's balloons are BUBBLE's two lines, scaled by k, up to this text ratio (flat's: 1); above it
 *  the one-line LINE. Three two-line ones fit the Waiting room up to 1.75 on every grid the fit or a zoom step draws (iso.test.ts). */
export const ISO_TWO = 1.75;
/** Whether iso's balloons are one line at text ratio `k`: above ISO_TWO under the fit (isoFit set `v.k`), else, a
 *  whole-px scale (2560×1440 at 125 % too), above 1 as before. */
export const isoLine = (v: StyleScale, k: number): boolean => k > (v.line ?? (v.k === undefined ? 1 : ISO_TWO));

/** A balloon tail's box: styles.css .tail is 7×4 text px at `x`, its top row on the box's 1 px border, so 3 under it;
 *  `up` (.tail.up), mirrored: 3 over the box's top. */
export const tailBox = (b: Rect, x: number, k: number, up = false): Rect =>
  up ? { x0: x - 3.5 * k, y0: b.y0 - 3 * k, x1: x + 3.5 * k, y1: b.y0 } : { x0: x - 3.5 * k, y0: b.y1, x1: x + 3.5 * k, y1: b.y1 + 3 * k };

/** A placed balloon: `up` when it sits under its agent's feet, its tail on its top pointing up at it. */
export type Balloon = Rect & { up?: true };

/** Balloons over their agents' heads (bottom at feet.y − 36), the lowest agent's first. One that meets an agent or an
 *  earlier balloon, or whose tail (`tail`: its text scale; tailBox at tailX) meets anyone but its own agent, rises
 *  above it; one pushed past the bound's top takes the free box (4 px grid) nearest its head position instead: one
 *  whose bottom is above the head (feet.y − 32) when any is free, else one under its feet (`up`: its tail on its top,
 *  pointing up at its agent), else any, or null when none exists. Returned in input order. Where that leaves one out
 *  but placing them without the under-the-feet boxes (`up` false) gives everyone one, that wins:
 *  whether all fit, and so the compact choice, never turns on a tail pointing up. */
export function placeBalloons(items: { feet: Pt; w: number; h: number; tail?: number }[], bound: Rect, agents: Rect[], up = true): (Balloon | null)[] {
  const out: (Balloon | null)[] = items.map(() => null), taken = [...agents];
  const order = items.map((_, i) => i).sort((a, b) => items[b].feet.y - items[a].feet.y || a - b);
  for (const i of order) {
    const { feet, w, h, tail = 0 } = items[i], x0 = Math.min(Math.max(feet.x - w / 2, bound.x0), bound.x1 - w), y0 = feet.y - 36 - h;
    const box = (x: number, y: number): Balloon => ({ x0: x, y0: y, x1: x + w, y1: y + h });
    const own = (t: Rect) => t.x0 === feet.x - 8 && t.x1 === feet.x + 8 && t.y1 === feet.y;   // its sprite (a sofa neighbour's may hold its head)
    const tl = (b: Balloon) => tailBox(b, tailX(b, feet.x), tail, b.up);
    const hit = (b: Balloon) => { const c = tail > 0 ? tl(b) : null; return taken.find(t => meet(b, t) || (c !== null && meet(c, t) && !own(t))); };
    let b: Balloon | null = box(x0, y0);
    for (let t; (t = hit(b!));) b = box(x0, t.y0 - h - 2 - (meet(b!, t) ? 0 : 3 * tail));
    if (b.y0 < bound.y0) {
      let best = Infinity;
      b = null;
      for (let y = bound.y0; y + h <= bound.y1; y += 4) for (let x = bound.x0; x + w <= bound.x1; x += 4) {
        // below the head only when no box above it is free: under the feet with its tail up at its agent first, any
        // with its tail down last (it points at nothing). A box is built only when its score beats the best (every frame
        // while the Waiting room is full)
        const d = (x - x0) ** 2 + (y - y0) ** 2, above = y + h <= feet.y - 32;
        if (up && !above && y >= feet.y && d + 1e12 < best) {
          const u: Balloon = { x0: x, y0: y, x1: x + w, y1: y + h, up: true };
          if (!hit(u)) { b = u; best = d + 1e12; continue; }
        }
        const s = above ? d : d + 2e12;
        if (s < best) { const c = box(x, y); if (!hit(c)) { b = c; best = s; } }
      }
    }
    if (b) { taken.push(b); if (tail > 0) taken.push(tl(b)); out[i] = b; }
  }
  if (!up || out.every(Boolean)) return out;
  const down = placeBalloons(items, bound, agents, false);
  return down.every(Boolean) ? down : out;
}

/** A balloon's tail x: under the box, at most 3 px in from its sides, else at the agent's x. */
export const tailX = (b: Rect, x: number): number => Math.min(Math.max(x, b.x0 + 3), b.x1 - 3);

/** Three waiters always get a full balloon; four to six get a compact one only when all of them fit (`w`: a
 *  one-line balloon's width, balloonBox; `line`: as balloonBox). */
export function waitBalloons(feet: Pt[], bound: Rect, k: number, w?: number, line = k > 1): { compact: boolean; shown: number } {
  const n = Math.min(feet.length, WAIT_MAX);
  if (n <= WAIT_FULL) return { compact: false, shown: n };
  const all = placeBalloons(feet.slice(0, n).map(f => ({ feet: f, ...balloonBox(k, true, w, line) })), bound, feet.map(sprite)).every(Boolean);
  return all ? { compact: true, shown: n } : { compact: false, shown: WAIT_FULL };
}

/** The Waiting room balloons by id. Waiters come in the scene's order with their spot (`home`) and where they
 *  are drawn (`at`: home, out for coffee, or walking); each one inside the room gets its balloon there, so it goes along
 *  on a walk to a new spot; one `out` for coffee gets none. Compact or not and how many are decided
 *  from the homes; no balloon covers a waiter or any other agent drawn (`agents`: feet, e.g. one walking out). */
export function waitBalloonBoxes(waiters: { id: string; home: Pt; at: Pt; out?: boolean }[], l: Layout, k: number, agents: Pt[]): { compact: boolean; boxes: Map<string, Balloon | null> } {
  const r = l.rooms.wait, inRoom = waiters.filter(({ at }) => at.x >= r.x0 && at.x <= r.x1 && at.y >= r.y0 && at.y <= r.y1);
  const { compact, shown } = waitBalloons(inRoom.map(w => w.home), waitBound(l), k), size = balloonBox(k, compact), list = inRoom.slice(0, shown).filter(w => !w.out);
  const placed = placeBalloons(list.map(w => ({ feet: w.at, ...size })), waitBound(l), [...waiters.map(w => w.at), ...agents].map(sprite));
  return { compact, boxes: new Map(list.map((w, i) => [w.id, placed[i]])) };
}

/** The Done lounge's café tables: a small round table, a chair either side, its two sitters facing
 *  each other CAFE_DX px left and right of its centre, on its feet line. A sitter leaves along CAFE_AISLE px under it. */
export const CAFE_DX = 14, CAFE_AISLE = 10;
/** The Done lounge's table grid (every table on one line across and down): cafeBox's size plus 12 px. */
export const CAFE_PX = 56, CAFE_PY = 45;
/** A table's sprites with its sitters' (flat px), and what of it stands on the floor (the table, the chairs' legs). */
export const cafeBox = (t: Pt): Rect => ({ x0: t.x - CAFE_DX - 8, y0: t.y - 32, x1: t.x + CAFE_DX + 8, y1: t.y + 1 });
export const cafeFoot = (t: Pt): Rect => ({ x0: t.x - CAFE_DX - 6, y0: t.y - 6, x1: t.x + CAFE_DX + 6, y1: t.y + 1 });
const cafeSeats = (t: Pt): Pt[] => [{ x: t.x - CAFE_DX, y: t.y }, { x: t.x + CAFE_DX, y: t.y }];

/** The Done lounge's smart board: a screen on two legs against the back wall, right of the door's
 *  sign (flat's largest text, either language, ends at x0 + 79), its legs on the floor 10 px under the wall like the
 *  first café table's sitters, so it stays over the robot's line (y0 + 20, its box 8 px up). Up to 40 px wide: what the
 *  wall leaves beside that table. Flat px; the panel is its top 20 px. */
export function boardOf(l: Pick<Layout, 'rooms'>): Rect {
  const d = l.rooms.done, x0 = d.x0 + 82;
  return { x0, y0: d.y0 - 22, x1: x0 + Math.min(40, d.x1 - d.x0 - 132), y1: d.y0 + 11 };
}

/** The feet along a walk, a box per leg. */
const feet = (path: Pt[]): Rect[] => path.slice(1).map((b, i) => {
  const a = path[i];
  return { x0: Math.min(a.x, b.x) - 6, y0: Math.min(a.y, b.y) - 4, x1: Math.max(a.x, b.x) + 6, y1: Math.max(a.y, b.y) + 1 };
});

/** The Done lounge's café tables, nearest the door first (the room is all café tables): one against the
 *  back wall right of the board, then on the floor a grid (all on one line across and down),
 *  each of its cells nearest the door first taken when free; a blocked cell stays empty.
 *  Free: the table and its sitters inside the room, off the door's lane, clear of the coffee corner, the board, the
 *  door, Smooth's spot and (12 px) the other tables; what stands on the floor clear of the robot's line, Smooth's bottom
 *  strip and every walk (out and to the coffee) of the other tables; its sitters' own walks clear of the board and the
 *  other tables. */
function cafes(l: Omit<Layout, 'views' | 'cafes' | 'waits'>): Pt[] {
  const d = l.rooms.done, st = l.stations.done, lane = l.lane.done, b = boardOf(l), [[ry]] = robotLines(l).done;
  const walks = (t: Pt): Rect[] => cafeSeats(t).flatMap(s => {
    const a = t.y + CAFE_AISLE;
    return [...feet([s, { x: s.x, y: a }, { x: lane, y: a }, { x: lane, y: l.hallY }]), ...feet(tripPath(s, st, a))];
  });
  const corner = { x0: st.x, y0: st.y - 6, x1: st.x + 32, y1: st.y + 32 };
  const solid = [b, corner, { x0: d.x1 - 22, y0: l.h - 17, x1: d.x1 - 6, y1: l.h - 6 }, { x0: d.x0 - 16, y0: d.y0 - 32, x1: d.x0 + 32, y1: d.y0 + 16 }];
  const lines = [{ x0: d.x0, y0: ry - 8, x1: d.x1, y1: ry + 2 }, { x0: d.x0, y0: l.h - 17, x1: d.x1, y1: l.h }];
  const gap = (r: Rect): Rect => ({ x0: r.x0 - 12, y0: r.y0 - 12, x1: r.x1 + 12, y1: r.y1 + 12 });
  const out: Pt[] = [], block = [b];
  const add = (t: Pt) => { out.push(t); solid.push(gap(cafeBox(t))); lines.push(...walks(t)); block.push(cafeFoot(t)); };
  // the grid: columns CAFE_PX apart from the first off the lane (lane + 38), the wall table on the first one 4 px or
  // more right of the board, else (34×18, 35×19: none fits the room) 4 px right of it; rows CAFE_PY apart from its line
  const x0 = lane + 38, xMax = d.x1 - 24, first = x0 + Math.ceil(Math.max(0, b.x1 + 26 - x0) / CAFE_PX) * CAFE_PX;
  const wall = { x: first <= xMax ? first : b.x1 + 26, y: d.y0 + 10 };
  add(wall);
  const free = (t: Pt) => {
    const box = cafeBox(t), foot = cafeFoot(t);
    if (box.x0 < lane + 16 || box.x1 > d.x1 - 2 || t.y + CAFE_AISLE + 5 > d.y1) return false;
    if (solid.some(r => meet(box, r)) || lines.some(r => meet(foot, r))) return false;
    return !walks(t).some(w => block.some(r => meet(w, r)));
  };
  const door = (t: Pt) => (t.x - lane) ** 2 + (t.y - d.y0) ** 2;
  const cells: Pt[] = [];
  for (let y = wall.y + CAFE_PY; y + CAFE_AISLE + 5 <= d.y1; y += CAFE_PY)
    for (let x = x0; x <= xMax; x += CAFE_PX) cells.push({ x, y });
  // nearest the door first, each cell taken when free (a blocked one stays empty: no table leaves the grid)
  for (const t of cells.sort((p, q) => door(p) - door(q))) if (free(t)) add(t);
  return out.sort((p, q) => door(p) - door(q));
}

/** The Done lounge's seats: each café table's (left, right), the tables nearest the door first. Their number is the room's cap
 *  (scene.ts doneSeating; nobody sits on the floor). */
export const doneSeats = (l: Pick<Layout, 'cafes'>): Pt[] => l.cafes.flatMap(cafeSeats);

/** A café sitter's side of its table: 'l' faces right, 'r' faces left; null off a café seat. */
export function cafeSide(l: Pick<Layout, 'cafes'>, p: Pt): 'l' | 'r' | null {
  const t = l.cafes.find(t => t.y === p.y && Math.abs(t.x - p.x) === CAFE_DX);
  return t ? (p.x < t.x ? 'l' : 'r') : null;
}

/** The line a Done lounge seat leaves along (its Spot's aisle): a café sitter steps down in front of its table. */
export const doneAisle = (l: Pick<Layout, 'cafes'>, p: Pt): number => cafeSide(l, p) ? p.y + CAFE_AISLE : p.y;

