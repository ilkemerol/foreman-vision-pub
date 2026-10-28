import type { Door, Layout, Pt, Rect, Style } from './layout.ts';
import type { Dir, Place, Pose, Spot } from './scene.ts';

// Walking in the office: axis-aligned routes through the room doors and
// the corridor, no A*.
export const SPEED = 0.056;   // office px per ms
export const PAY_RISE = 180, PAY_WALK = 2000;   // coins 7.2: ms from payAt

export const outside = (l: Layout): Spot => ({ room: 'out', pt: { x: -10, y: l.h - 16 }, aisle: l.h - 16 });

/** How a walk leaves or enters a room: along a line `a` px below its aisle, and with `g` up or down a column (g.x)
 *  between its room's desk columns to another line (g.y) before the room's door column. */
interface Way { a: number; g?: Pt }
const BASE: Way = { a: 0 };

/** Out of a place: along its aisle (`a` px below it, past its aisle point) to its room's door column (`g`: by way of
 *  g.x and g.y), down or up it to the corridor line (`c` px below it), along that to the main lane. */
function exitPath(l: Layout, { room, pt, aisle }: Spot, { a, g }: Way = BASE, c = 0): Pt[] {
  const x = room === 'out' ? l.lane.main : l.lane[room], y = aisle + a, h = l.hallY + c;
  return [pt, { x: pt.x, y: aisle }, { x: pt.x, y }, ...(g ? [{ x: g.x, y }, g, { x, y: g.y }] : [{ x, y }]), { x, y: h }, { x: l.lane.main, y: h }];
}

const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;

/** Out of `from`'s room to the main lane, then into `to`'s; straight runs collapse (so does a detour that turns back),
 *  but for `from`'s aisle point when it leaves along a line below it (a paid walker stands there: standIndex). */
function join(l: Layout, from: Spot, to: Spot, wf = BASE, wt = BASE, c = 0): Pt[] {
  const out: Pt[] = [];
  for (const p of [...exitPath(l, from, wf, c), ...exitPath(l, to, wt, c).reverse()]) {
    if (out.length && same(out[out.length - 1], p)) continue;
    const a = out[out.length - 2], b = out[out.length - 1];
    if (a && !(wf.a && out.length === 2) && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))) out.pop();
    if (!out.length || !same(out[out.length - 1], p)) out.push(p);
  }
  return out;
}

// Route variety: a seeded walk leaves and enters its rooms along a
// line LINES px below its aisle, or turns at a column beside a desk column onto another desk row's line (LINES px below
// it), and takes the corridor HALLS px below its line (< 12, so it still opens the hall door: nearDoor); at most DETOUR
// times the base route's length. Unseeded (decor, Smooth, couriers, medics) it is the base route.
const LINES = [0, 8, 16], HALLS = [0, 4, 8], DETOUR = 1.6;
const len = (p: Pt[]) => p.reduce((s, q, i) => i ? s + Math.abs(q.x - p[i - 1].x) + Math.abs(q.y - p[i - 1].y) : 0, 0);

/** Every way out of (or into) `s`: along its aisle or LINES below it (`fixed`: only along it), or by a column 32 px
 *  beside a desk of its room (clear of the door column; away from it only the one right beside `s`) onto a line LINES
 *  below one of the room's desk rows (main: and the foreman's). */
function ways(l: Layout, s: Spot, fixed: boolean): Way[] {
  const room = s.room === 'out' ? 'main' : s.room, r = l.rooms[room], lane = l.lane[room], { x: px } = s.pt;
  const desks = room === 'main' ? [...l.desks, l.foreman] : l.desks;
  const xs = new Set<number>(), ys = new Set<number>();
  for (const d of desks) if (d.room === room) {
    for (const x of [d.cx - 32, d.cx + 32]) if (x > r.x0 && x < r.x1 && Math.abs(x - lane) >= 16 && x !== px && ((x - px) * (lane - px) > 0 || Math.abs(x - px) <= 32)) xs.add(x);
    for (const a of LINES) if (d.aisle + a !== s.aisle) ys.add(d.aisle + a);
  }
  return [...(fixed ? [0] : LINES).map(a => ({ a })), ...[...xs].flatMap(x => [...ys].map(y => ({ a: 0, g: { x, y } })))];
}
/** What a walker's feet keep clear of (decor.ts walkBlocks): solid boxes, and everyone's resting feet. */
export interface WalkBlocks { boxes: Rect[]; feet: Pt[] }
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
export const footBox = (p: Pt): Rect => ({ x0: p.x - 6, y0: p.y - 4, x1: p.x + 6, y1: p.y + 1 });
const between = (v: number, a: number, b: number) => (v - a) * (v - b) <= 0;
/** model.ts hash, copied: this module imports no values (model → i18n → labels → couriers reads SPEED at load). */
const hash = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};
const onPath = (p: Pt, path: Pt[]): boolean =>
  path.some((b, i) => { const a = path[i - 1]; return !!a && (a.x === b.x ? p.x === a.x && between(p.y, a.y, b.y) : p.y === a.y && between(p.x, a.x, b.x)); });

/** Whether every point of `path` (each 2 px) off `base` stands on a room's floor (no wall tile) with its feet clear of
 *  every block (the path's two ends' own resting feet excepted). */
export function clearWalk(l: Layout, path: Pt[], base: Pt[], { boxes, feet }: WalkBlocks): boolean {
  const ends = [path[0], path[path.length - 1]], rooms = Object.values(l.rooms), tile = l.w / l.cols;
  const xs = path.map(p => p.x), ys = path.map(p => p.y), near = { x0: Math.min(...xs) - 8, y0: Math.min(...ys) - 8, x1: Math.max(...xs) + 8, y1: Math.max(...ys) + 8 };
  const solid = [...boxes, ...feet.filter(q => !ends.some(e => same(e, q))).map(footBox)].filter(r => meet(r, near));
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (let s = 0; s <= n; s += 2) {
      const p = { x: a.x + Math.sign(b.x - a.x) * s, y: a.y + Math.sign(b.y - a.y) * s }, f = footBox(p);
      if (onPath(p, base)) continue;
      if (!rooms.some(r => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) || l.walls.has(`${Math.floor(p.x / tile)},${Math.floor(p.y / tile)}`)) return false;
      if (solid.some(r => meet(f, r))) return false;
    }
  }
  return true;
}

/** Out of `from`'s room, through the corridor, into `to`'s. Varied (`vary`: a walk's seed and the layout's blocks) the
 *  walk leaves (along its aisle only from an upper room's desk, whose paid walker stands in place, or the entrance) and
 *  enters by one of its rooms' ways (ways), and takes the corridor 0/4/8 px below its line: the way out first, then the
 *  way in, then the corridor line, each the first in an order seeded by the seed and both ends whose route is clear
 *  (clearWalk) and at most DETOUR times the base route; the base route always is. */
export function route(l: Layout, from: Spot, to: Spot, vary?: { seed: string; blocks: WalkBlocks }): Pt[] {
  const base = join(l, from, to);
  if (!vary) return base;
  const key = `${vary.seed}:${from.pt.x},${from.pt.y}>${to.pt.x},${to.pt.y}`, max = DETOUR * len(base);
  const order = <T>(xs: T[], side: string): T[] => xs.map((x, i) => ({ x, k: hash(`${key}:${side}${i}`) })).sort((a, b) => a.k - b.k).map(o => o.x);
  const ok = (p: Pt[]) => len(p) <= max && clearWalk(l, p, base, vary.blocks);
  const fixed = from.room === 'out' || from.room === 'server' || from.room === 'library';
  const wf = order(ways(l, from, fixed), 'f').find(w => ok(join(l, from, to, w))) ?? BASE;
  const wt = order(ways(l, to, to.room === 'out'), 't').find(w => ok(join(l, from, to, wf, w))) ?? BASE;
  const c = order(HALLS, 'c').find(c => ok(join(l, from, to, wf, wt, c))) ?? 0;
  return join(l, from, to, wf, wt, c);
}

export interface Walker { pt: Pt; path: Pt[]; spot: Spot; face: Dir; dir: Dir; moving: boolean; bornAt: number; failAt: number | null; burnAt: number | null; payAt: number | null; label: string; restAt: number }   // restAt: when its path last emptied (−Infinity when seeded or entering); burnAt: performance.now() of its burn's start (null: not burning); payAt (coins 7.2): performance.now() of its payday; it stands by its desk until payAt + PAY_WALK

/** coins 7.2: where a paid walker stands — the first point of its path off its seat (path[0]) when straight below or
 *  above it, else its seat (index 0). */
export function standIndex(path: Pt[]): number {
  const i = path.findIndex(p => !same(p, path[0]));
  return i > 0 && path[i].x === path[0].x ? i : 0;
}

/** Follow a new snapshot. `seed` (the first snapshot) puts everyone straight at their place. Returns the
 *  hand-overs made ([old id, new id]). With `blocks` (decor.ts walkBlocks) each walk varies (route) by its walker's id
 *  and its agent's stageSince (`since`, from the snapshot: the same after a reload, new on its next walk). */
export function syncWalkers(walkers: Map<string, Walker>, places: Map<string, Place>, l: Layout, seed: boolean, now: number, blocks?: WalkBlocks, since?: (id: string) => number | undefined): [string, string][] {
  if (seed) {
    walkers.clear();
    for (const [id, p] of places) if (p.kind !== 'fail' && p.kind !== 'burn')   // a seed never makes a burn
      walkers.set(id, { pt: p.spot.pt, path: [], spot: p.spot, face: p.face, dir: p.face, moving: false, bornAt: -Infinity, failAt: null, burnAt: null, payAt: null, label: p.label, restAt: -Infinity });
    return [];
  }
  const gone: [string, Walker][] = [], handed: [string, string][] = [];
  for (const [id, w] of walkers) if (!places.has(id)) { gone.push([id, w]); walkers.delete(id); }
  for (const [id, p] of places) {
    let w = walkers.get(id);
    if (!w) {
      if (p.kind === 'fail' || p.kind === 'burn') continue;
      // ponytail: several vanished walkers with one label hand over in map order; match on more than the label if that misleads
      const k = gone.findIndex(([, g]) => g.burnAt === null && g.label === p.label);   // a burning one hands over to nobody
      if (k >= 0) { const [old, g] = gone.splice(k, 1)[0]; w = g; handed.push([old, id]); }
      // a queued or waiting newcomer (a placeholder row) has nowhere to walk from; its alert shows at once
      else if (p.kind === 'queue' || p.kind === 'wait') w = { pt: p.spot.pt, path: [], spot: p.spot, face: p.face, dir: p.face, moving: false, bornAt: now, failAt: null, burnAt: null, payAt: null, label: p.label, restAt: now };
      else { const o = outside(l); w = { pt: o.pt, path: [], spot: o, face: p.face, dir: p.face, moving: false, bornAt: now, failAt: null, burnAt: null, payAt: null, label: p.label, restAt: -Infinity }; }
      walkers.set(id, w);
    }
    w.failAt = p.kind === 'fail' ? w.failAt ?? now : null;   // a same-label successor never inherits a sequence
    w.burnAt = p.kind === 'burn' ? w.burnAt : null;
    if (!same(w.spot.pt, p.spot.pt)) w.path = [...(w.path.length ? w.path : [w.pt]), ...route(l, w.spot, p.spot, blocks && { seed: `${id}@${since?.(id) ?? ''}`, blocks }).slice(1)];
    Object.assign(w, { spot: p.spot, face: p.face, label: p.label, moving: w.path.length > 0 });
    if (!w.moving) w.dir = w.face;
  }
  return handed;
}

/** Move every walker SPEED·dt along its path, never past a waypoint's end; one that arrives rests from `now`. */
export function advanceWalkers(walkers: Map<string, Walker>, dt: number, now: number): void {
  for (const w of walkers.values()) {
    // coins 7.2: up to its route's first point in PAY_RISE (facing down), there until PAY_WALK, then on along its path from that point
    if (w.payAt !== null) {
      const t = now - w.payAt, i = standIndex(w.path), a = w.path[0], b = w.path[i];
      if (a && t < PAY_WALK) { const u = Math.min(1, t / PAY_RISE); w.pt = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }; w.dir = 'down'; continue; }
      if (a) { w.pt = b; w.path.splice(0, i + 1); }
      w.payAt = null;
    }
    let step = SPEED * dt;
    while (w.path.length && step > 0) {
      const t = w.path[0], dx = t.x - w.pt.x, dy = t.y - w.pt.y, d = Math.hypot(dx, dy);
      if (d) w.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      if (d <= step) { w.pt = t; w.path.shift(); step -= d; }
      else { w.pt = { x: w.pt.x + dx / d * step, y: w.pt.y + dy / d * step }; step = 0; }
    }
    if (!w.path.length) { if (w.moving) w.restAt = now; w.moving = false; w.dir = w.face; }
  }
}

/** Whether `w` is really on the move at `now`: a paid walker (coins 7.2) has its path from payday on but stands by its
 *  desk until payAt + PAY_WALK, so no door opens for it before then. */
export const walksAt = (w: Walker, now: number): boolean => w.moving && (w.payAt === null || now - w.payAt >= PAY_WALK);

export const AWAY_MS = 500;   // a frame gap this long means the browser throttled us; a visible tab draws every ~16 ms
/** Whether the gap before this frame means the tab was away (OfficeFloor then reseeds everyone). `styles`: the style of
 *  this frame and the frames before it, newest first. A gap across a style switch never counts: it spans the switch's
 *  re-render (this frame the first in the new style) or the new style's first draw (the frame before it was), and a
 *  style change never moves anyone. */
export const awayGap = (gap: number, styles: Style[]): boolean => gap > AWAY_MS && styles.slice(0, 3).every(s => s === styles[0]);

/** A walker at rest on its burn place starts burning this frame. Call once per frame after stepRooms and
 *  advanceWalkers (one cut short of its coffee walks home first), never straight after syncWalkers. */
export function stepBurns(places: Map<string, Place>, walkers: Map<string, Walker>, now: number): void {
  for (const [id, p] of places) {
    const w = p.kind === 'burn' ? walkers.get(id) : undefined;
    if (w && !w.moving && w.burnAt === null) w.burnAt = now;
  }
}

export interface DoorState { k: 0 | 1 | 2; last: number }   // k: closed, half, open

export const nearDoor = (d: Door, pts: Pt[]): boolean => pts.some(p => Math.abs(p.x - (d.x + 8)) < 24 && Math.abs(p.y - d.y) < 12);   // < 12: a corridor walker passing an upper door does not open it

/** One frame toward open (someone near) or closed, at most every 120 ms. */
export function stepDoor(s: DoorState, near: boolean, now: number): void {
  const to = near ? 2 : 0;
  if (s.k === to || now - s.last < 120) return;
  s.k = (s.k + (to > s.k ? 1 : -1)) as DoorState['k'];
  s.last = now;
}

const ROW: Record<Dir, number> = { down: 0, up: 1, right: 2, left: 2 };

/** Character sheet cell: walk 0-1-2-1, type 3-4, read 5-6, still 1; left is right mirrored. */
export function frameOf(pose: Pose | 'walk', dir: Dir, ms: number): { col: number; row: number; flip: boolean } {
  const col = pose === 'walk' ? [0, 1, 2, 1][Math.floor(ms / 150) % 4]
    : pose === 'type' ? 3 + Math.floor(ms / 300) % 2
    : pose === 'read' ? 5 + Math.floor(ms / 900) % 2 : 1;
  return { col, row: ROW[dir], flip: dir === 'left' };
}
