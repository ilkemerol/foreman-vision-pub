// Where the office's light comes from: window glass, desk lamps and the night
// overlay's flat cut-outs. Pure; flat office px. (No ceiling lights.)
import { mainWallDecor } from './corner.ts';
import { toWorld } from './iso.ts';
import { boardOf, type Layout, type Pt, type Rect, type RoomId } from './layout.ts';

/** Iso: the main office's left wall windows (iso.ts background draws them), as the world y span of each glass: one every
 *  4 tiles from y 2 while clear of the entrance. */
export function isoLeftGlass(l: Layout): [number, number][] {
  const ey = toWorld(l.doors[0]).y, out: [number, number][] = [];
  for (let a = 2; a + 1.6 < ey - 1; a += 4) out.push([a + 0.1, a + 1.5]);
  return out;
}

/** The library's top wall: a double bookshelf (x, 32 wide) or a leaded window (x, 12 wide) by turns, every third a
 *  window (sprites.ts topDecor draws it). */
export function libraryWallDecor(l: Layout): { name: 'DOUBLE_BOOKSHELF' | 'lead'; x: number }[] {
  const lib = l.rooms.library, out: { name: 'DOUBLE_BOOKSHELF' | 'lead'; x: number }[] = [];
  for (let x = lib.x0 + 4, i = 0; x + 32 <= lib.x1 - 2; i++) if (i % 3 === 2) { out.push({ name: 'lead', x: x + 2 }); x += 18; } else { out.push({ name: 'DOUBLE_BOOKSHELF', x }); x += 34; }
  return out;
}

/** Every window's glass on the top wall (sprites.ts win: frame x..x+w, y 5..25; glass 1 px in), lead: the library's
 *  leaded ones. Any 'win' the main office's decor holds (mainWallDecor) is a window here too. */
export interface Glass extends Rect { lead: boolean }
export function windowGlass(l: Layout, size: (name: string) => { w: number; h: number }): Glass[] {
  const main = mainWallDecor(l, size).filter(p => p.name === 'win').map(p => ({ x0: p.x + 1, y0: 6, x1: p.x + 21, y1: 24, lead: false }));
  const lib = libraryWallDecor(l).filter(p => p.name === 'lead').map(p => ({ x0: p.x + 1, y0: 6, x1: p.x + 11, y1: 24, lead: true }));
  return [...main, ...lib];
}

/** A work desk's lamp foot on its desk top, left of the monitor (the cat perches right of it, cx + 15). */
export const lampAt = (d: { cx: number; y: number }): Pt => ({ x: d.cx - 17, y: d.y + 17 });
export const LAMP_POOL = { dx: 2, dy: 2, rx: 20, ry: 10 } as const;
/** A pool of light on the floor: centre and half axes. */
export interface Pool { x: number; y: number; rx: number; ry: number }

/** The night overlay's flat cut-outs, in drawing order: lamp pools (partial, clipped to their room),
 *  then full holes. `screens`, `lamps`, `hot`: desk indices; `lamps` only while lamps are on. */
export type Light =
  | { kind: 'lamp'; pool: Pool; clip: Rect }
  | { kind: 'hole'; r: Rect }
  | { kind: 'screen'; r: Rect }
  | { kind: 'fire'; x: number; y: number; clip: Rect }
  // the lit board's screen; from LAMPS_AT its cool light on the floor (boardBands)
  | { kind: 'board'; screen: Rect; light: { bands: Pt[][]; floor: Rect } | null };
/** done-life-lamps: `boardLit` the board's screen is lit (board.ts boardLit); `evening` the lamps are on (phase().lamps);
 *  `floorLamps` the floor lamps' boxes (the Waiting room's: layout.ts sofaParts; the library nook's: decor.ts) and their rooms. */
export interface LightsIn { glass: Rect[]; screens: number[]; lamps: number[]; hot: number[]; burns: { pt: Pt; room: RoomId }[]; clock: Rect; gauge: Rect; racks: Rect[]; leds: Pt[]
  boardLit?: boolean; evening?: boolean; floorLamps?: { r: Rect; room: RoomId }[] }
/** The foreman's banker lamp's foot, on its desk's free left end (Smooth sits in front of it). */
export const foremanLampAt = (l: Pick<Layout, 'foreman'>): Pt => ({ x: l.foreman.seat.x - 20, y: l.foreman.y + 17 });
/** A floor lamp's (decor.ts drawPiece 'lamp', 8×28 from its box's top left) shade, and its pool from the
 *  box's left and bottom. */
export const floorLampShade = (r: Rect): Rect => ({ x0: r.x0 + 1, y0: r.y0 + 2, x1: r.x0 + 7, y1: r.y0 + 7 });
export const FLOOR_POOL = { dx: 4, dy: -2, rx: 24, ry: 10 } as const;
/** On the floor only, no wall halo; from both sides of the board, soft: the
 *  board's light on the Done lounge's floor, four trapezoids outer first (top left, top right, bottom right, bottom left), each
 *  drawn over the last. The outer one from the floor's edge under the board, 4 px past either side of it, widening to
 *  60 px either side 70 px into the room: over the café table in front of the board and the near halves of the ones
 *  beside that. Each next one 5 px in at the top, 13 px in at the bottom and 16 px shorter, so every edge but the top
 *  fades in steps. */
export function boardBands(l: Pick<Layout, 'rooms'>): Pt[][] {
  const b = boardOf(l), y = l.rooms.done.y0, cx = Math.round((b.x0 + b.x1) / 2), hw = (b.x1 - b.x0) / 2;
  return [0, 1, 2, 3].map(i => {
    const t = hw + 4 - 5 * i, w = 60 - 13 * i, d = 70 - 16 * i;
    return [{ x: cx - t, y }, { x: cx + t, y }, { x: cx + w, y: y + d }, { x: cx - w, y: y + d }];
  });
}
export function flatLights(l: Layout, o: LightsIn): Light[] {
  const out: Light[] = [];
  for (const i of o.lamps) {
    const d = l.desks[i], f = lampAt(d);
    out.push({ kind: 'lamp', pool: { x: f.x + LAMP_POOL.dx, y: f.y + LAMP_POOL.dy, rx: LAMP_POOL.rx, ry: LAMP_POOL.ry }, clip: l.rooms[d.room] });
  }
  if (o.evening) {   // the foreman's lamp and the floor lamps, whoever is there
    const f = foremanLampAt(l);
    out.push({ kind: 'lamp', pool: { x: f.x + LAMP_POOL.dx, y: f.y + LAMP_POOL.dy, rx: LAMP_POOL.rx, ry: LAMP_POOL.ry }, clip: l.rooms.main });
    for (const { r, room } of o.floorLamps ?? []) out.push({ kind: 'lamp', pool: { x: r.x0 + FLOOR_POOL.dx, y: r.y1 + FLOOR_POOL.dy, rx: FLOOR_POOL.rx, ry: FLOOR_POOL.ry }, clip: l.rooms[room] }, { kind: 'hole', r: floorLampShade(r) });
  }
  for (const r of [...o.glass, o.clock, o.gauge, ...o.racks]) out.push({ kind: 'hole', r: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 } });
  for (const p of o.leds) out.push({ kind: 'hole', r: { x0: p.x, y0: p.y, x1: p.x + 1, y1: p.y + 1 } });
  for (const i of o.screens) { const d = l.desks[i]; out.push({ kind: 'screen', r: { x0: d.cx - 5, y0: d.y + 3, x1: d.cx + 5, y1: d.y + 8 } }); }
  for (const i of o.hot) { const d = l.desks[i]; out.push({ kind: 'fire', x: d.cx, y: d.y + 32, clip: l.rooms[d.room] }); }   // flat.ts fireGlow's spot
  for (const b of o.burns) out.push({ kind: 'fire', x: b.pt.x, y: b.pt.y + 4, clip: l.rooms[b.room] });                       // burn.ts glow under the pile
  if (o.boardLit) {   // the screen from dusk, its light from LAMPS_AT
    const b = boardOf(l);
    out.push({ kind: 'board', screen: { x0: b.x0 + 2, y0: b.y0 + 2, x1: b.x1 - 2, y1: b.y0 + 18 }, light: o.evening ? { bands: boardBands(l), floor: l.rooms.done } : null });
  }
  return out;
}
