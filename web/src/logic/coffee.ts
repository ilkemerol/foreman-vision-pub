import { pathLen, pointAt } from './fx.ts';
import type { Layout, Pt } from './layout.ts';
import { hash } from './model.ts';
import { SPEED, type Walker } from './motion.ts';
import type { Dir, Place } from './scene.ts';

// Coffee trips in the Waiting room and the Done lounge: one agent of a room
// walks home → coffee table, stays, walks back. A per-room scheduler sends one at a time, 3–4 min after the last trip
// ended, the one due longest first, so everyone goes in turn.
export const STAY = 3200, POUR = 900;   // ms at the table; the first POUR of it pouring, back turned
export const REST = 8000;   // ms a member rests at home before it may go
/** The room's gap from the end of its trip `n` (0: a reset) to the start of the next: 180–240 s, seeded. */
export const tripGap = (room: string, n: number): number => 180_000 + hash(room + 'coffee' + n) % 60_000;

export interface Lounger { id: string; home: Pt; since: number; aisle?: number }   // since: when it came to rest at home (Walker.restAt); aisle: its Spot's
export interface Trip { pt: Pt; dir: Dir; moving: boolean; stay: number | null }   // stay: ms at the table, null while walking
export interface Out { id: string; start: number; path: Pt[] }
/** A room's coffee: who is out (since `start`, along `path`), when each member is due to go next (the earliest goes
 *  first), how many trips it started (`n`), and when the next may start (`next`; null until the first step). */
export interface CoffeeState { room: string; out: Out | null; due: Map<string, number>; n: number; next: number | null }
export type CoffeeRooms = Record<'wait' | 'done', CoffeeState>;
export const coffeeState = (room: string): CoffeeState => ({ room, out: null, due: new Map(), n: 0, next: null });
export const coffeeRooms = (): CoffeeRooms => ({ wait: coffeeState('wait'), done: coffeeState('done') });

/** Axis-aligned home → (home.x, v.y) → v: v is the table's left side for a home (its line) in front of it, else behind
 *  it. A home that leaves along another line than its own (`aisle`: a Done lounge chair's or a Waiting room sofa seat's, layout.ts
 *  doneAisle, waitAisle) walks it to v's column. */
export function tripPath(home: Pt, table: Pt, aisle = home.y): Pt[] {
  const v = aisle >= table.y + 16 ? { x: table.x - 10, y: table.y + 28 } : { x: table.x + 16, y: table.y - 2 };
  const via = aisle === home.y ? [{ x: home.x, y: v.y }] : [{ x: home.x, y: aisle }, { x: v.x, y: aisle }];
  return [home, ...via, v].filter((p, i, a) => !i || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
}

/** A whole trip: there, STAY, back. */
export const tripMs = (path: Pt[]): number => 2 * pathLen(path) / SPEED + STAY;

const dirOf = (a: Pt, b: Pt): Dir => Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (b.x > a.x ? 'right' : 'left') : (b.y > a.y ? 'down' : 'up');

/** How far from home along its path the one out is at `now`. */
function along(o: Out, now: number): number {
  const len = pathLen(o.path), walk = len / SPEED, ph = now - o.start;
  return ph < walk ? ph * SPEED : ph < walk + STAY ? len : Math.max(0, len - (ph - walk - STAY) * SPEED);
}

/** Where the one out is at `now` (start ≤ now < start + tripMs): a pure function of the trip and the clock. */
export function tripAt(o: Out, now: number): Trip {
  const walk = pathLen(o.path) / SPEED, ph = now - o.start, s = along(o, now), pt = pointAt(o.path, s);
  if (ph >= walk && ph < walk + STAY) return { pt, dir: 'up', moving: false, stay: ph - walk };
  return { pt, dir: dirOf(pt, pointAt(o.path, ph < walk ? s + 1 : s - 1)), moving: true, stay: null };
}

/** One step of a room: members join due REST after their rest began, leave the schedule when they stop being
 *  members; one back home is due again from its trip's end. The first step (a reset) and every trip's end, or cut,
 *  set the next start a tripGap later; from then, with nobody out, the earliest due (ties by id) goes. Returns the
 *  trip cut short when the one out stopped being a member: its point now and its way back home from there. */
export function stepCoffee(s: CoffeeState, members: Lounger[], table: Pt, now: number): { id: string; pt: Pt; way: Pt[] } | null {
  const ids = new Set(members.map(m => m.id));
  for (const id of s.due.keys()) if (!ids.has(id)) s.due.delete(id);
  for (const m of members) if (!s.due.has(m.id)) s.due.set(m.id, Math.max(m.since, now) + REST);
  s.next ??= now + tripGap(s.room, s.n);
  const o = s.out;
  let cut = null;
  if (o && !ids.has(o.id)) {
    const at = along(o, now), way: Pt[] = [];
    for (let i = 1, d = 0; i < o.path.length; i++) if ((d += pathLen([o.path[i - 1], o.path[i]])) < at) way.unshift(o.path[i]);
    cut = { id: o.id, pt: tripAt(o, now).pt, way: [...way, o.path[0]] };
    s.out = null;
    s.next = now + tripGap(s.room, s.n);
  } else if (o && now >= o.start + tripMs(o.path)) {
    const end = o.start + tripMs(o.path);
    s.due.set(o.id, end);
    s.out = null;
    s.next = end + tripGap(s.room, s.n);
  }
  if (!s.out && now >= s.next) {
    let next: Lounger | null = null;
    for (const m of members) {
      const d = s.due.get(m.id)!, nd = next ? s.due.get(next.id)! : Infinity;
      if (d <= now && (d < nd || (d === nd && m.id < next!.id))) next = m;
    }
    if (next) { s.out = { id: next.id, start: now, path: tripPath(next.home, table, next.aisle) }; s.n++; }
  }
  return cut;
}

/** A pending → bound hand-over: the new id takes over the old one's schedule and trip. */
export function renameCoffee(s: CoffeeState, from: string, to: string): void {
  if (s.out?.id === from) s.out.id = to;
  const d = s.due.get(from);
  if (d !== undefined) { s.due.delete(from); s.due.set(to, d); }
}

/** One frame of both rooms: members are the wait / done walkers resting at their place. One cut short walks on from
 *  the point it was drawn at, back along its trip to its home and on along its own path. Returns everyone out now. */
export function stepRooms(rooms: CoffeeRooms, places: Map<string, Place>, walkers: Map<string, Walker>, l: Layout, now: number): Map<string, Trip> {
  const trips = new Map<string, Trip>();
  for (const kind of ['wait', 'done'] as const) {
    const s = rooms[kind], members = [...places].filter(([id, p]) => p.kind === kind && walkers.get(id)?.moving === false)
      .map(([id]) => ({ id, home: walkers.get(id)!.pt, since: walkers.get(id)!.restAt, aisle: walkers.get(id)!.spot.aisle }));
    const cut = stepCoffee(s, members, l.stations[kind], now), w = cut && walkers.get(cut.id);
    if (cut && w) Object.assign(w, { pt: cut.pt, path: [...cut.way, ...w.path], moving: true });
    if (s.out) trips.set(s.out.id, tripAt(s.out, now));
  }
  return trips;
}
