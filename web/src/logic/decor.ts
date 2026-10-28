// Decor: where the extra pieces stand and what they keep clear of. Pure; flat office px.
// The same pieces in both styles (one grid); placed once per layout, never per frame.
import { TEXT } from './i18n.ts';
import { cornerSpots } from './corner.ts';
import { tripPath } from './coffee.ts';
import { catSpots, perchFloor, type Perch } from './cat.ts';
import { courierSpots, LIFT, PASS } from './couriers.ts';
import { isoProj, isoSign, isoView, signBox, toWorld } from './iso.ts';
import { boardOf, cafeFoot, doneAisle, doneSeats, flatSignAt, queueSpot, sofaParts, textRatio, waitAisle, type Layout, type Pt, type Rect, type RoomId } from './layout.ts';
import { outside, route, type WalkBlocks } from './motion.ts';
import { dockOf, robotRoute } from './robot.ts';
import type { Spot } from './scene.ts';

// a medium density; more pieces (cabinet, UPS, globe, magazines, a Done lounge rug) are not built
export type DecorName = 'cooler' | 'printer' | 'pot' | 'extinguisher' | 'shelf' | 'armchair' | 'lamp' | 'sidetable' | 'lowtable' | 'rugWait';
/** Standing pieces stand on their box's bottom edge; floor pieces (rugs) lie under everything and are walked over. */
export const DECOR: Record<DecorName, { w: number; h: number; floor?: true }> = {
  cooler: { w: 12, h: 24 }, printer: { w: 20, h: 21 }, pot: { w: 10, h: 16 }, extinguisher: { w: 6, h: 13 },
  shelf: { w: 32, h: 32 }, armchair: { w: 18, h: 18 }, lamp: { w: 8, h: 28 }, sidetable: { w: 10, h: 12 }, lowtable: { w: 28, h: 14 },
  rugWait: { w: 0, h: 0, floor: true },
};
export interface Piece extends Rect { name: DecorName; room: RoomId; group: string }
export type Why = 'furniture' | 'agent' | 'walk' | 'courier' | 'robot' | 'cat' | 'door' | 'label' | 'balloon';
export type KeepOut = Rect & { why: Why };

/** Flat's largest text scale (overlay.ts textScale: 2 CSS px over flat's smallest office scale, 1.6): flat labels are
 *  boxed at it, so the decor never depends on the text scale or the style. */
export const K_FLAT = 1.25;
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const sprite = (p: Pt, h = 32, w = 16): Rect => ({ x0: p.x - w / 2, y0: p.y - h, x1: p.x + w / 2, y1: p.y });
const longest = (k: keyof typeof TEXT.en) => Math.max(TEXT.en[k].length, TEXT.tr[k].length);

/** Every box a standing piece must stay clear of, each with its reason. */
export function decorKeepOut(l: Layout): KeepOut[] {
  const out: KeepOut[] = [], add = (r: Rect, why: Why) => out.push({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, why });
  const sweep = (path: Pt[], why: Why, half = 8, h = 32) => {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      add({ x0: Math.min(a.x, b.x) - half, y0: Math.min(a.y, b.y) - h, x1: Math.max(a.x, b.x) + half, y1: Math.max(a.y, b.y) + 1 }, why);
    }
  };
  const walk = (s: Spot, why: Why, half = 8, h = 32) => sweep(route(l, s, outside(l)), why, half, h);   // every route is two of these
  const F = l.foreman, sv = l.rooms.server, wr = l.rooms.wait;
  // furniture (robot.test.ts furniture() and the monitors, chairs, corner plant and bin; a desk's box holds its lamp and the cat's perch)
  for (const d of l.desks) add({ x0: d.cx - 24, y0: d.y - 2, x1: d.cx + 24, y1: d.y + 46 }, 'furniture');
  add({ x0: F.cx - 24, y0: F.y - 1, x1: F.cx + 24, y1: F.y + 32 }, 'furniture'); add(cornerSpots(l).box, 'furniture');
  add({ x0: sv.x0 + 8, y0: sv.y0, x1: sv.x0 + 22, y1: sv.y1 }, 'furniture');
  add({ x0: wr.x1 - 40, y0: wr.y0 + 4, x1: wr.x1 - 24, y1: wr.y0 + 20 }, 'furniture');
  for (const r of Object.values(sofaParts(l.sofa))) add(r, 'furniture');   // the Waiting room's sofa set (its sitters: below)
  for (const s of [l.stations.wait, l.stations.done]) add({ x0: s.x, y0: s.y - 6, x1: s.x + 32, y1: s.y + 32 }, 'furniture');
  for (const t of l.cafes) add(cafeFoot(t), 'furniture');   // a café table and its chairs' legs on the floor (their sitters: below)
  add(boardOf(l), 'furniture');
  add({ x0: l.rooms.main.x1 - 32, y0: 40, x1: l.rooms.main.x1, y1: 88 }, 'furniture'); add(BIN, 'furniture');
  // everyone at rest and their walks; a desk's walk also carries the 46 px stretcher and the medics beside it
  for (const d of l.desks) { add(sprite(d.seat), 'agent'); walk({ room: d.room, pt: d.seat, aisle: d.aisle }, 'walk', 24); }
  add(sprite({ x: F.seat.x, y: F.seat.y - 6 }), 'agent'); walk({ room: 'main', pt: F.seat, aisle: F.aisle }, 'walk');
  const waits = l.waits, seats = doneSeats(l);
  for (const p of waits) { const a = waitAisle(l, p); add(sprite(p), 'agent'); walk({ room: 'wait', pt: p, aisle: a }, 'walk'); sweep(tripPath(p, l.stations.wait, a), 'walk'); }
  for (const p of seats) { const a = doneAisle(l, p); add(sprite(p), 'agent'); walk({ room: 'done', pt: p, aisle: a }, 'walk'); sweep(tripPath(p, l.stations.done, a), 'walk'); }
  for (let k = 0; k < 12; k++) add(sprite(queueSpot(k, l)), 'agent');
  // couriers (35 px with the cap): the walk in, the leaver PASS down, the queue LIFT up, the hand-over
  const cs = courierSpots(l);
  sweep(cs.path, 'courier', 8, 35); sweep(cs.path.map(p => ({ x: p.x, y: p.y + PASS })), 'courier', 8, 35);
  for (const p of [{ x: cs.queuePt.x, y: cs.queuePt.y - LIFT }, cs.queuePt, cs.desk]) add(sprite(p, 35), 'courier');
  // the robot's whole tour and its dock; Smooth at her rest spots and beside each desk, and her walks
  sweep(robotRoute(l), 'robot', 8, 8); const dk = dockOf(l); add({ x0: dk.x - 10, y0: dk.y - 8, x1: dk.x + 10, y1: dk.y + 2 }, 'robot');
  for (const s of catSpots(l)) { add(sprite(s.pt, 11), 'cat'); walk(s, 'cat', 8, 11); }
  for (const p of [...l.desks.keys(), 'foreman'] as Perch[]) { const s = perchFloor(l, p); add(sprite(s.pt, 11), 'cat'); walk(s, 'cat', 8, 11); }
  // doors (their cell and a tile either side) and every sign, in either language, at flat's largest text scale
  for (const d of l.doors) {
    add(d.id === 'in' ? { x0: 0, y0: d.y - 32, x1: 48, y1: d.y + 16 } : { x0: d.x - 16, y0: d.y - 32, x1: d.x + 32, y1: d.y + 16 }, 'door');
    add(signBox({ ...flatSignAt(d), side: d.side }, 'x'.repeat(longest(`door.${d.id}`)), K_FLAT), 'label');
  }
  const c = cornerSpots(l, K_FLAT), gw = K_FLAT * ((longest('corner.gauge') + 1) * 3.2 + 6);   // '{n}' → up to 3 digits
  add({ x0: c.sign.x - gw / 2, y0: c.sign.y, x1: c.sign.x + gw / 2, y1: c.sign.y + 8 * K_FLAT }, 'label');
  for (const d of l.desks) add({ x0: d.cx - 40, y0: d.y - 19 - 19 * K_FLAT, x1: d.cx + 40, y1: d.y }, 'label');   // a hot tag rises over its flames
  // Waiting room balloons at their default boxes: a full one at k 1 (68×26), a one-line one at k 3 (160×27)
  for (const p of waits) for (const [w, h] of [[68, 26], [160, 27]]) {
    const x0 = Math.min(Math.max(p.x - w / 2, wr.x0), wr.x1 - w);
    add({ x0, y0: p.y - 36 - h, x1: x0 + w, y1: p.y - 36 }, 'balloon');
  }
  return out;
}

const blocks = new Map<string, WalkBlocks>();
/** What a varied walk's feet keep clear of (motion.ts route), per grid: the furniture, the standing decor, the robot's
 *  dock, and everyone's resting feet (desks, the foreman, the Waiting room, the Done lounge, the queue). */
export function walkBlocks(l: Layout): WalkBlocks {
  let b = blocks.get(decorKey(l));
  if (!b) {
    const ko = decorKeepOut(l), dk = dockOf(l), seen = new Set<string>();
    const feet = [l.foreman.seat, ...l.desks.map(d => d.seat), ...l.waits, ...doneSeats(l), ...Array.from({ length: 12 }, (_, k) => queueSpot(k, l))];
    b = {
      boxes: [...ko.filter(k => k.why === 'furniture'), ...placeDecor(l, ko).filter(p => !DECOR[p.name].floor), { x0: dk.x - 10, y0: dk.y - 8, x1: dk.x + 10, y1: dk.y + 2 }, bowlsOf(l).box],
      feet: feet.filter(p => !seen.has(`${p.x},${p.y}`) && !!seen.add(`${p.x},${p.y}`)),
    };
    if (blocks.size >= 4) blocks.delete(blocks.keys().next().value!);
    blocks.set(decorKey(l), b);
  }
  return b;
}

/** Iso's text scale on this layout (layout.ts textRatio: textScale(css) / css, a fit's rounded up to 1/8; 1 to 3). */
export const isoK = (l: Layout): number => textRatio(l.views.iso);
/** A per-layout cache key for what depends on the decor: the grid and iso's text scale. */
export const decorKey = (l: Layout): string => `${l.key}@${isoK(l)}`;
/** Iso: the door signs' screen boxes in either language, at the text scale this layout draws them (isoK; a
 *  larger one moves a sign elsewhere, at 52×27 k 3 the Done lounge's over the Library's reading nook).
 *  They stand still, so no standing piece may sit under one; desk tags move with their agents and may cover a piece. */
export function isoSignBoxes(l: Layout, k = isoK(l)): Rect[] {
  const out: Rect[] = [];
  for (const d of l.doors) { const text = 'x'.repeat(longest(`door.${d.id}`)); out.push(signBox(isoSign(l, d, k, text, out), text, k)); }
  return out;
}
/** A standing piece's iso screen box: its base line's two ends on the floor and, 0.6 tiles back, at its height. */
export function isoPieceBox(l: Layout, p: Rect): Rect {
  const v = isoView(l.cols, l.rows), pts = [p.x0, p.x1].flatMap(x => { const w = toWorld({ x, y: p.y1 }); return [isoProj(v, w.x, w.y, 0), isoProj(v, w.x, w.y - 0.6, p.y1 - p.y0)]; });
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const range = (a: number, b: number, step = 2): number[] => { const out: number[] = []; for (let v = a; step > 0 ? v <= b : v >= b; v += step) out.push(v); return out; };
/** Where a w × h standing piece may stand along a room's walls, in this order: the top wall's foot (left to
 *  right), the left wall, the right wall (top to bottom), the bottom wall; top-left corners, 2 px steps. */
export function wallSpots(r: Rect, w: number, h: number): Pt[] {
  const top = r.y0 + 16, xs = range(r.x0 + 2, r.x1 - w - 2), bases = range(r.y0 + h, r.y1 - 2);
  return [...xs.map(x => ({ x, y: top - h })), ...bases.map(b => ({ x: r.x0 + 2, y: b - h })), ...bases.map(b => ({ x: r.x1 - w - 2, y: b - h })), ...xs.map(x => ({ x, y: r.y1 - 2 - h }))];
}

type Try = [DecorName, number, number, number?, number?][];
interface Group { id: string; room: RoomId; tries: Try[] }
/** The groups (medium density, the reading nook, the printer): in priority order,
 *  each placed at its first try that fits. */
function groups(l: Layout): Group[] {
  const { main, server: sv, library: lib, wait: wr, done: dn } = l.rooms, cs = courierSpots(l);
  const band = (r: Rect) => r.y1 - 16;   // under the desk row, over the robot's bottom line and Smooth's rest spot
  const st = (n: DecorName, x: number, base: number): Try[number] => [n, x, base - DECOR[n].h];
  const one = (n: DecorName, ps: Pt[]): Try[] => ps.map((p): Try => [[n, p.x, p.y]]);
  const top = (n: DecorName) => range(cs.queuePt.x + 12, main.x1 - DECOR[n].w - 2).map((x): Try => [st(n, x, 54)]);
  const walls = (n: DecorName, r: Rect = main) => one(n, wallSpots(r, DECOR[n].w, DECOR[n].h));
  const up = wr.y0 + 36, rb = Math.min(wr.y1 - 40, l.stations.wait.y - 8), tb = Math.round((up + rb) / 2) + 7;
  const G: Group[] = [
    { id: 'main-cooler', room: 'main', tries: [...top('cooler'), ...walls('cooler')] },
    { id: 'main-printer', room: 'main', tries: [...top('printer'), ...walls('printer')] },
    { id: 'main-pot', room: 'main', tries: walls('pot') },
    { id: 'server-ext', room: 'server', tries: [...range(sv.x1 - 44, sv.x0 + 30, -2).map((x): Try => [st('extinguisher', x, band(sv))]), ...walls('extinguisher', { ...sv, x0: sv.x0 + 22 })] },
    { id: 'library-nook', room: 'library', tries: range(lib.x0 + 8, lib.x1 - 100).map((x): Try => [st('shelf', x, band(lib)), st('armchair', x + 40, band(lib)), st('lamp', x + 60, band(lib)), st('sidetable', x + 72, band(lib))]) },
    { id: 'library-pot', room: 'library', tries: walls('pot', lib) },
  ];
  // the rug right of the sofa set, its low table at its middle, else as near it as is off the
  // sofa sitters' walks, else none
  const rx = l.sofa.x + 68, rm = Math.round((rx + wr.x1 - 28) / 2);
  const at = range(up + 24, rb - 2).flatMap(b => range(rx + 4, wr.x1 - 60).map(x => ({ x, b })))
    .sort((p, q) => Math.abs(p.x + 14 - rm) + Math.abs(p.b - tb) - Math.abs(q.x + 14 - rm) - Math.abs(q.b - tb) || p.b - q.b || p.x - q.x);
  const rug: Try[number] = ['rugWait', rx, up + 8, wr.x1 - 28 - rx, rb - up - 8];
  if (rb - up - 8 >= 40 && wr.x1 - 28 - rx >= 60) G.push({ id: 'wait-rug', room: 'wait', tries: [...at.map(({ x, b }): Try => [rug, st('lowtable', x, b)]), [rug]] });
  G.push({ id: 'wait-pot', room: 'wait', tries: walls('pot', wr) }, { id: 'done-pot', room: 'done', tries: walls('pot', dn) });
  return G;
}

/** A working desk's props on the desk top's front strip (y + 19 … y + 24): the papers under the desk
 *  lamp (lampAt: cx − 20 … cx − 13, y + 10 … y + 17), the mug (outline included) under Smooth's perch
 *  (cx + 7 … cx + 23, … y + 17); the foreman's mug in front of its monitor, its lamp left of the letter (lights.ts foremanLampAt), Smooth in front of the lamp. */
export const deskProps = (d: { cx: number; y: number }): { papers: Rect; mug: Rect } =>
  ({ papers: { x0: d.cx - 21, y0: d.y + 19, x1: d.cx - 13, y1: d.y + 24 }, mug: { x0: d.cx + 11, y0: d.y + 18, x1: d.cx + 17, y1: d.y + 24 } });
export const foremanMug = (l: Layout): Rect => ({ x0: l.foreman.seat.x - 4, y0: l.foreman.y + 12, x1: l.foreman.seat.x + 2, y1: l.foreman.y + 18 });

/** The decor of a layout, at every size. Deterministic. A group goes to its first try whose pieces all stay
 *  inside the room (a standing one may rise 8 px over its top edge, at the wall's foot) and, 2 px apart, meet no
 *  keep-out box (a rug: only the doors) and no piece of its kind placed before; in iso no standing piece under a sign. */
export function placeDecor(l: Layout, ko: KeepOut[] = decorKeepOut(l)): Piece[] {
  const out: Piece[] = [], doors = ko.filter(b => b.why === 'door'), signs = isoSignBoxes(l);
  for (const g of groups(l)) {
    const r = l.rooms[g.room];
    const ok = (p: Piece) => {
      const floor = !!DECOR[p.name].floor, m = { x0: p.x0 - 2, y0: p.y0 - 2, x1: p.x1 + 2, y1: p.y1 + 2 };
      const inside = p.x0 >= r.x0 && p.x1 <= r.x1 && p.y1 <= r.y1 && p.y0 >= r.y0 - (floor ? 0 : 8);
      return inside && !(floor ? doors : ko).some(k => meet(m, k)) && !out.some(o => !!DECOR[o.name].floor === floor && meet(m, o))
        && (floor || !signs.some(s => meet(isoPieceBox(l, p), s)));
    };
    for (const t of g.tries) {
      const ps = t.map(([name, x, y, w, h]): Piece => ({ name, room: g.room, group: g.id, x0: x, y0: y, x1: x + (w ?? DECOR[name].w), y1: y + (h ?? DECOR[name].h) }));
      if (ps.every(ok)) { out.push(...ps); break; }
    }
  }
  return out;
}

/** Smooth's mat and bowls. `box`: the group (the 26×6 mat at its bottom, her crouch behind the
 *  bowls); `food`, `water`: each bowl's feet point (its sprite's bottom centre); `eat`, `drink`: her feet behind each, as
 *  walk ends along the main office line nearest them. */
export interface Bowls { box: Rect; food: Pt; water: Pt; eat: Spot; drink: Spot }
export const BOWLS = { w: 26, h: 16 } as const;
/** A desk's hot tag (decorKeepOut): over a desk burning past OVERWORK_MIN only, so it may cover the bowls. */
const hotTag = (l: Layout, k: KeepOut): boolean => k.why === 'label' && l.desks.some(d => k.x0 === d.cx - 40 && k.y1 === d.y);
const bowlCache = new Map<string, Bowls>();
/** The waste bin in the main office's top-left corner (iso.ts puts it at the same spot), a plant beside it. */
export const BIN: Rect = { x0: 20, y0: 36, x1: 36, y1: 52 };
/** Under the main office's top-left bin and the
 *  plant beside it, the row 2 px under their feet, from the left wall rightwards while the box still starts under the
 *  plant. Where that plant stands elsewhere, or nothing in the row fits: the wall spot nearest the entrance (0, h − 16)
 *  on the left wall. A spot stays in the room and meets (2 px apart) no keep-out box but a desk's hot tag, no
 *  decor piece and in iso no door sign: placeDecor's rules for a standing piece (decor.test.ts: the 199-grid sweep). */
export function bowlsOf(l: Layout): Bowls {
  let b = bowlCache.get(decorKey(l));
  if (b) return b;
  const ko = decorKeepOut(l).filter(k => !hotTag(l, k)), dec = placeDecor(l), signs = isoSignBoxes(l), m = l.rooms.main;
  const ok = (p: Rect) => {
    const g = { x0: p.x0 - 2, y0: p.y0 - 2, x1: p.x1 + 2, y1: p.y1 + 2 };
    return p.x0 >= m.x0 && p.x1 <= m.x1 && p.y1 <= m.y1 && p.y0 >= m.y0 - 8
      && !ko.some(k => meet(g, k)) && !dec.some(o => meet(g, o)) && !signs.some(s => meet(isoPieceBox(l, p), s));
  };
  const rect = (x: number, y: number): Rect => ({ x0: x, y0: y, x1: x + BOWLS.w, y1: y + BOWLS.h });
  const pot = dec.find(p => p.room === 'main' && p.name === 'pot' && p.y1 === m.y0 + 16 && p.x0 === BIN.x1 + 2);
  const far = (p: Rect) => Math.hypot(p.x0 + BOWLS.w / 2, p.y1 - (l.h - 16));
  const box = (pot && range(m.x0 + 2, pot.x1 - 1).map(x => rect(x, Math.max(BIN.y1, pot.y1) + 2)).find(ok))
    ?? wallSpots(m, BOWLS.w, BOWLS.h).map(p => rect(p.x, p.y)).sort((p, q) => far(p) - far(q)).find(ok)!;
  const food = { x: box.x0 + 7, y: box.y1 - 2 }, water = { x: box.x0 + 19, y: box.y1 - 2 }, feet = box.y1 - 5;
  const aisle = [l.foreman.aisle, ...l.desks.filter(d => d.room === 'main').map(d => d.aisle)].reduce((a, c) => Math.abs(c - feet) < Math.abs(a - feet) ? c : a);
  const at = (p: Pt): Spot => ({ room: 'main', pt: { x: p.x, y: p.y - 3 }, aisle });
  b = { box, food, water, eat: at(food), drink: at(water) };
  if (bowlCache.size >= 4) bowlCache.delete(bowlCache.keys().next().value!);
  bowlCache.set(decorKey(l), b);
  return b;
}
