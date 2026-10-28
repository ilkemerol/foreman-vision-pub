import type { AgentView } from '../../../shared/types.ts';
import { pathLen, pointAt } from './fx.ts';
import { regionAt, TILE, type Layout, type Pt } from './layout.ts';
import { hash } from './model.ts';
import { route, type Walker } from './motion.ts';
import type { Dir, Hit, Scene, Spot } from './scene.ts';

// Smooth, the office cat: where she rests, which desks she may jump on,
// one step of her day and her seed. Live random through `rng`; nothing about her is kept.
export const CAT = {
  walk: 0.045, run: 0.11, hop: 320, arc: 12, rest: [20_000, 45_000], desk: [40_000, 90_000], curl: 20_000,
  deskOdds: 0.6, meet: 30, rideOdds: 0.25, rideMax: 20_000, startle: 450, lift: 5,
  eat: [6000, 8000], drink: [3000, 4000], half: 0.6, refill: 3000,   // bowl visits (ms) and refills
} as const;

export type Rng = () => number;
export type Perch = number | 'foreman';
export interface Rest extends Spot { pose: 'sit' | 'loaf'; quiet: boolean }
export type Mode = 'rest' | 'walk' | 'run' | 'hop' | 'desk' | 'startle' | 'ride' | 'bowl';
export type End = Pt | Perch | 'robot';
/** Cat-bowls 5.3: her visit's step: walking there ('go'), eating, stepping across to the water ('step'), drinking. */
export type Visit = 'go' | 'eat' | 'step' | 'drink';
export interface Cat {
  mode: Mode; spot: Spot; pt: Pt; path: Pt[]; d: number; pose: 'sit' | 'loaf';   // spot: where she is, or where her walk ends
  goal: Perch | null; last: Perch | null; until: number; since: number;           // since: on the desk, or at a bowl, from
  hop: { from: End; to: End; t0: number; then: 'desk' | 'next' | 'ride' } | null;
  met: number; room: string | null; dir: Dir; side: 'left' | 'right';             // met: the robot tour she reacted to; room: the ride's
  bowl: Visit | null; meal: number; half: number; refill: number;                // meal: the last visit slot she is done with; the food bowl is half in [half, refill)
  back: boolean;                                                                  // a tab return owing a visit: her first rest runs out first
}
export interface Meet { pt: Pt; moving: boolean; tour: number }
/** The bowls' walk ends (decor.ts bowlsOf); `meal`: the latest visit slot due (mealSlot). Without them she never goes. */
export interface BowlEnds { eat: Spot; drink: Spot }
/** `noServer` (she runs away from the fire): the server room is off limits while its fire is on. */
export interface CatWorld { perched: Perch[]; waiting: boolean; robot: Meet; bowls?: BowlEnds; meal?: number; noServer?: boolean }
export type CatPose = 'walk' | 'run' | 'sit' | 'loaf' | 'startle';
export type CatDraw =
  | { at: 'floor'; pt: Pt; pose: CatPose; dir: Dir; side: 'left' | 'right'; resting: boolean }
  | { at: 'desk'; perch: Perch; pose: 'sit' | 'loaf' }
  | { at: 'hop'; from: Pt | Perch; to: Pt | Perch; u: number }
  | { at: 'ride'; pt: Pt }
  | { at: 'bowl'; which: 'eat' | 'drink'; pt: Pt; ms: number };   // ms: since she began this bowl

// Cat-bowls 5.1: her visits' clock, a pure function of the session and the server time like the robot's tours: slot k's
// visit is due at phase + k · slot + up to jitter, so two in a row are 240–420 s (4–7 min) apart; floors differ by sid.
export const MEAL = { slot: 330_000, jitter: 90_000 } as const;
const mealPhase = (sid: string): number => hash(sid + ':meal') % MEAL.slot;
export const mealDue = (sid: string, k: number): number => mealPhase(sid) + k * MEAL.slot + hash(`${sid}:meal:${k}`) % MEAL.jitter;
/** The latest slot whose visit is due at `now`. */
export function mealSlot(sid: string, now: number): number {
  const k = Math.floor((now - mealPhase(sid)) / MEAL.slot);
  return mealDue(sid, k) <= now ? k : k - 1;
}
/** Cat-bowls 5.4: the food bowl, half from 60 % of her meal till 3 s after she left the bowls; never empty. */
export const bowlFood = (c: Cat, now: number): 'full' | 'half' => now >= c.half && now < c.refill ? 'half' : 'full';

/** Rest spots on free floor, one or two a room. The corridor's sits on the robot's line (robot.ts robotLane, hallY − 4:
 *  in iso the lower corridor wall does not cover her); it is a 'main' spot whose aisle is that line, so route() takes it
 *  along the corridor to the main office's door column. The Waiting room's is quiet: only while nobody waits there. */
export function catSpots(l: Layout): Rest[] {
  const { main, server, library, wait, done } = l.rooms;
  const s = (room: Spot['room'], x: number, y: number, pose: Rest['pose'], quiet = false): Rest => ({ room, pt: { x, y }, aisle: y, pose, quiet });
  return [
    s('main', main.x0 + 34, l.foreman.aisle + 12, 'sit'), s('main', main.x0 + 120, l.h - 8, 'loaf'),
    s('server', server.x0 + 32, server.y1 - 3, 'loaf'),   // by the warm racks, right of their column
    s('library', library.x0 + 12, library.y1 - 3, 'sit'),
    s('main', main.x1 + 56, l.hallY - 4, 'loaf'),         // the corridor runner
    s('wait', wait.x0 + 70, wait.y0 + 26, 'sit', true), s('done', done.x1 - 14, l.h - 6, 'loaf'),
  ];
}

/** The floor she jumps up from: right of the chair; the foreman's, left of its desk under the context box. */
export function perchFloor(l: Layout, p: Perch): Spot {
  if (p === 'foreman') return { room: 'main', pt: { x: l.foreman.seat.x - 32, y: l.foreman.seat.y + 20 }, aisle: l.foreman.aisle };
  const d = l.desks[p];
  return { room: d.room, pt: { x: d.cx + 20, y: d.room === 'main' ? d.seat.y + 4 : d.seat.y - 2 }, aisle: d.aisle };
}

/** The desks of agents seated and running or verifying, and the foreman's while it runs. */
export function perches(scene: Scene, agents: Map<string, AgentView>, walkers: Map<string, Walker>): Perch[] {
  const out: Perch[] = [];
  for (const [id, p] of scene.places) {
    const a = agents.get(id), w = walkers.get(id);
    if (!a || !w || w.moving) continue;
    if (p.kind === 'desk' && p.desk !== null && (a.stage === 'running' || a.stage === 'verifying')) out.push(p.desk);
    else if (p.kind === 'foreman' && a.stage === 'running') out.push('foreman');
  }
  return out;
}

export const someoneWaits = (scene: Scene): boolean => [...scene.places.values()].some(p => p.kind === 'wait');

const pick = <T>(a: T[], rng: Rng): T | undefined => a[Math.floor(rng() * a.length)];
const span = (r: readonly [number, number], rng: Rng) => r[0] + rng() * (r[1] - r[0]);
const free = (l: Layout, waiting: boolean, noServer = false) => catSpots(l).filter(s => (!s.quiet || !waiting) && !(noServer && s.room === 'server'));
const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;
const dirOf = (dx: number, dy: number): Dir => Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
const regionOf = (l: Layout, p: Pt) => regionAt(l, Math.floor(p.x / TILE), Math.floor(p.y / TILE));
/** The spot she is on (a ride's or a startle's end): her region's room, the corridor as a 'main' spot along its line. A
 *  room's region holds its door and wall tiles (regionAt), where the robot leaves it: she steps in off them, inside the
 *  room's floor (8 px from its sides, 12 below its top, 3 above its bottom like catSpots), so she never rests in a door. */
function here(l: Layout, p: Pt): Rest {
  const r = regionOf(l, p), b = l.rooms[r], clamp = (v: number, lo: number, hi: number) => Math.round(r === 'hall' ? v : Math.min(Math.max(v, lo), hi));
  const pt = { x: clamp(p.x, b.x0 + 8, b.x1 - 8), y: clamp(p.y, b.y0 + 12, b.y1 - 3) };
  return { room: r === 'hall' ? 'main' : r, pt, aisle: pt.y, pose: 'sit', quiet: false };
}

function rest(c: Cat, s: Spot, now: number, rng: Rng): void {
  Object.assign(c, { mode: 'rest', spot: s, pt: { ...s.pt }, path: [], d: 0, hop: null, back: false, pose: 'pose' in s ? (s as Rest).pose : 'sit', until: now + span(CAT.rest, rng) });
}
function go(c: Cat, l: Layout, to: Spot, run: boolean, goal: Perch | null = null): void {
  Object.assign(c, { path: route(l, c.spot, to), d: 0, spot: to, goal, mode: run ? 'run' : 'walk' });
}
function hop(c: Cat, from: End, to: End, now: number, then: NonNullable<Cat['hop']>['then']): void {
  Object.assign(c, { mode: 'hop', hop: { from, to, t0: now, then } });
}
/** Cat-bowls 5.1, 5.2: a visit slot came due since her last one (several missed: one visit). */
const due = (c: Cat, w: CatWorld): boolean => !!w.bowls && w.meal !== undefined && w.meal > c.meal;
/** A rest is over: the bowls when a visit is due (no draw), else a working desk at deskOdds (not the last one), else
 *  another rest spot. */
function next(c: Cat, l: Layout, w: CatWorld, rng: Rng): void {
  if (due(c, w)) { go(c, l, w.bowls!.eat, false); c.bowl = 'go'; return; }
  const desks = w.perched.filter(p => p !== c.last);
  if (desks.length && rng() < CAT.deskOdds) { const p = pick(desks, rng)!; c.last = p; go(c, l, perchFloor(l, p), false, p); return; }
  go(c, l, pick(free(l, w.waiting, w.noServer).filter(s => !same(s.pt, c.spot.pt)), rng) ?? c.spot, false);
}

const blank = (s: Rest): Cat => ({ mode: 'rest', spot: s, pt: { ...s.pt }, path: [], d: 0, pose: s.pose, goal: null, last: null, until: 0, since: 0, hop: null, met: -1, room: null, dir: 'down', side: 'right', bowl: null, meal: 0, half: 0, refill: 0, back: false });

/** Fresh (`c` null: a mount, a reload, a floor or view change, a new layout): resting at a random spot. A tab
 *  return: at the end of her step — on the desk she was heading for or sat on while its agent still works, else resting
 *  where her walk ends (a ride or a startle: where she is). `meal` (mealSlot now): fresh, nothing is due
 *  yet; a visit under way is over, she rests at a random spot; the food bowl is full; a visit missed meanwhile waits
 *  till her first rest is over. */
export function seedCat(c: Cat | null, l: Layout, perched: Perch[], waiting: boolean, now: number, rng: Rng, meal = 0): Cat {
  if (!c) { const s = pick(free(l, waiting), rng)!, n = blank(s); rest(n, s, now, rng); n.meal = meal; return n; }
  const n: Cat = { ...c, half: 0, refill: 0 };
  if (n.bowl !== null) { rest(n, pick(free(l, waiting), rng)!, now, rng); Object.assign(n, { bowl: null, goal: null, meal }); return n; }
  const upward = n.mode === 'walk' || n.mode === 'desk' || (n.mode === 'hop' && n.hop!.then === 'desk');   // a hop down lands on the floor
  if (n.goal !== null && perched.includes(n.goal) && upward) {
    Object.assign(n, { mode: 'desk', spot: perchFloor(l, n.goal), pt: perchFloor(l, n.goal).pt, path: [], hop: null, since: now, until: now + span(CAT.desk, rng) });
    return n;
  }
  rest(n, n.mode === 'ride' || n.mode === 'startle' ? here(l, n.pt) : n.spot, now, rng);
  Object.assign(n, { goal: null, back: meal > n.meal });
  return n;
}

export function stepCat(c: Cat, l: Layout, w: CatWorld, now: number, dt: number, rng: Rng): void {
  // resting, walking or riding in the server room (or walking or running there) while it burns, she
  // startles where she is and runs to another room; a run out of it is her escape. The caller leaves its desks out of
  // `perched`, so one up there hops down
  if (w.noServer && (c.mode === 'run' ? c.spot.room === 'server'
    : (c.mode === 'rest' || c.mode === 'walk' || c.mode === 'ride') && (c.spot.room === 'server' || regionOf(l, c.pt) === 'server'))) {
    Object.assign(c, { mode: 'startle', spot: here(l, c.pt), path: [], d: 0, goal: null, bowl: null, until: now + CAT.startle });
    return;
  }
  const working = c.goal !== null && w.perched.includes(c.goal);
  switch (c.mode) {
    case 'walk': case 'run': {
      c.d += dt * (c.mode === 'run' ? CAT.run : CAT.walk);
      if (c.d < pathLen(c.path)) {
        const a = pointAt(c.path, c.d), b = pointAt(c.path, c.d + 1);
        c.pt = a; c.dir = dirOf(b.x - a.x, b.y - a.y);
        if (c.dir === 'left' || c.dir === 'right') c.side = c.dir;
        return;
      }
      c.pt = { ...c.spot.pt };
      if (c.bowl === 'go' || c.bowl === 'step') {   // at a bowl, facing it
        const eat = c.bowl === 'go';
        Object.assign(c, { mode: 'bowl', bowl: eat ? 'eat' : 'drink', path: [], since: now, until: now + span(eat ? CAT.eat : CAT.drink, rng) });
        if (eat) Object.assign(c, { half: now + CAT.half * (c.until - now), refill: Infinity });
        return;
      }
      if (c.goal !== null && working) hop(c, c.pt, c.goal, now, 'desk');
      else { rest(c, c.spot, now, rng); c.goal = null; }
      return;
    }
    case 'hop': {
      if (now < c.hop!.t0 + CAT.hop) return;
      const then = c.hop!.then;
      c.hop = null;
      if (then === 'desk') Object.assign(c, { mode: 'desk', since: now, until: now + span(CAT.desk, rng) });
      else if (then === 'ride') Object.assign(c, { mode: 'ride', pt: { ...w.robot.pt }, until: now + CAT.rideMax });
      else { c.goal = null; next(c, l, w, rng); }
      return;
    }
    case 'bowl': {   // eaten, she steps across to the water; drunk, back to her day; no robot reaction here
      if (now < c.until) return;
      if (c.bowl === 'eat') { Object.assign(c, { mode: 'walk', bowl: 'step', path: [c.pt, w.bowls!.drink.pt], d: 0, spot: w.bowls!.drink }); return; }
      Object.assign(c, { bowl: null, meal: w.meal!, refill: now + CAT.refill });
      go(c, l, pick(free(l, w.waiting, w.noServer), rng)!, false);
      return;
    }
    case 'desk': if (!working || now >= c.until) hop(c, c.goal!, perchFloor(l, c.goal!).pt, now, 'next'); return;
    case 'startle':
      if (now >= c.until) go(c, l, pick(free(l, w.waiting, w.noServer).filter(s => s.room !== c.spot.room), rng) ?? c.spot, true);
      return;
    case 'ride': {
      const r = w.robot;
      if (r.moving && regionOf(l, r.pt) === c.room && now < c.until) { c.pt = { ...r.pt }; return; }
      rest(c, here(l, c.pt), now, rng);   // she steps off where she is
      return;
    }
    case 'rest': {
      const r = w.robot;
      if (r.moving && c.met !== r.tour && Math.hypot(r.pt.x - c.pt.x, r.pt.y - c.pt.y) < CAT.meet) {
        c.met = r.tour;
        if (rng() < CAT.rideOdds) { c.room = regionOf(l, r.pt); hop(c, c.pt, 'robot', now, 'ride'); }
        else Object.assign(c, { mode: 'startle', until: now + CAT.startle });
      } else if ((due(c, w) && !c.back) || now >= c.until || (w.waiting && (c.spot as Partial<Rest>).quiet)) next(c, l, w, rng);   // the Waiting room's spot: only while nobody waits
      return;
    }
  }
}

/** What to draw now; `robot`: the robot's point (a hop onto it lands where it is). */
export function catDraw(c: Cat, now: number, robot: Pt): CatDraw {
  if (c.mode === 'desk') return { at: 'desk', perch: c.goal!, pose: now - c.since < CAT.curl ? 'sit' : 'loaf' };   // sits, then curls
  if (c.mode === 'ride') return { at: 'ride', pt: c.pt };
  if (c.mode === 'bowl') return { at: 'bowl', which: c.bowl === 'drink' ? 'drink' : 'eat', pt: c.pt, ms: now - c.since };
  if (c.mode === 'hop') {
    const h = c.hop!, end = (e: End) => (e === 'robot' ? robot : e);
    return { at: 'hop', from: end(h.from), to: end(h.to), u: Math.min(1, (now - h.t0) / CAT.hop) };
  }
  const moving = c.mode === 'walk' || c.mode === 'run';
  return { at: 'floor', pt: c.pt, pose: moving ? c.mode as CatPose : c.mode === 'startle' ? 'startle' : c.pose, dir: c.dir, side: c.side, resting: !moving };
}

// Petting: a click on her box is hers, never the agent's behind; hearts float up and fade.
// Client only, never kept: a reseed drops them, a style switch keeps them. Nothing about her changes.
export const CAT_HIT = 'cat';
/** Her sprites' sizes with their 1 px outline (pets.ts CAT grids + 2; 'eat': at a bowl). */
const SIZE: Record<CatPose | 'eat', [number, number]> = { walk: [16, 11], run: [16, 11], sit: [11, 12], startle: [11, 12], loaf: [14, 8], eat: [13, 11] };
/** Her sprite's box (office px) at her feet point, as pets.ts blit draws it; z Infinity: in front of everyone. */
export function catHit(pose: CatPose | 'eat', x: number, y: number): Hit {
  const [w, h] = SIZE[pose], x0 = Math.round(x - w / 2), y0 = Math.round(y - h + 1) - (pose === 'startle' ? 3 : 0);
  return { id: CAT_HIT, x0, y0, x1: x0 + w, y1: y0 + h, z: Infinity };
}

export const HEART = { life: 1200, rise: 14, max: 3, gap: 150 } as const;
export interface Heart { t0: number; dx: number }
export interface HeartDraw { dx: number; up: number; alpha: number }   // off her head top's centre, office px
/** One pet: 1–2 hearts (the second a beat later), at most HEART.max alive: the oldest go. */
export function pet(hearts: Heart[], now: number, rng: Rng): Heart[] {
  const add = Array.from({ length: 1 + Math.floor(rng() * 2) }, (_, i) => ({ t0: now + i * HEART.gap, dx: Math.round(rng() * 10) - 5 }));
  return [...hearts.filter(h => now - h.t0 < HEART.life), ...add].slice(-HEART.max);
}
/** The hearts showing now: each rises HEART.rise px and fades out over HEART.life. */
export const heartsAt = (hearts: Heart[], now: number): HeartDraw[] => hearts.filter(h => now >= h.t0 && now - h.t0 < HEART.life)
  .map(h => { const u = (now - h.t0) / HEART.life; return { dx: h.dx, up: Math.round(u * HEART.rise), alpha: 1 - u }; });
