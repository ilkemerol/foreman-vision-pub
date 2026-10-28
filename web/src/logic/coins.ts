// Office coins: a sub-agent's gold by its desk, by AgentView.tokens (its context as the CLI shows it). Pure; flat office px, iso tiles.
import type { AgentView } from '../../../shared/types.ts';
import { toWorld } from './iso.ts';
import type { Desk, Layout, Pt } from './layout.ts';
import { PAY_WALK, type Walker } from './motion.ts';
import { atWork, type Scene } from './scene.ts';

export const COIN_TOKENS = 10_000, MAX_COINS = 15, SACK_TOKENS = 150_000;

export function coinCount(tokens: number): number { return Math.min(MAX_COINS, Math.floor(tokens / COIN_TOKENS)); }
export function hasSack(tokens: number): boolean { return tokens >= SACK_TOKENS; }
// coins in column c (0..2) of a pile of n
export function column(n: number, c: number): number { return Math.min(Math.max(n - 5 * c, 0), 5); }

export interface FlatPile { cols: Pt[]; sack: Pt }   // cols: each column sprite's left x and bottom row; sack: its feet
export function pileFlat(d: Desk): FlatPile {
  return { cols: [0, 1, 2].map(c => ({ x: d.cx + 24 + 5 * c, y: d.y + 31 })), sack: { x: d.cx + 33, y: d.y + 38 } };
}

/** World tiles on the desk's +x side, the columns back to front along y; dw the desk centre (iso.ts deskW).
 *  By a room's right inner wall (x1 − cx ≤ 40) the sack stands ¼ tile in, so the wall hides at most its outline's corner */
export function pileIso(l: Layout, i: number): { cols: { x: number; y: number }[]; sack: { x: number; y: number } } {
  const d = l.desks[i], s = toWorld(d.seat), dw = { x: s.x, y: s.y - 1 }, byWall = l.rooms[d.room].x1 - d.cx <= 40;
  return { cols: [0, 1, 2].map(c => ({ x: dw.x + 1.375, y: dw.y - 0.375 + 0.375 * c })), sack: { x: dw.x + (byWall ? 1.625 : 1.875), y: dw.y + 0.375 } };
}

// The coin memory: written per snapshot (stepCoins) and when an animation starts or ends (tickCoins);
// the readers below are pure functions of the frame clock (performance.now()) and allocate nothing.
export const DROP = { ms: 380, h: 22, glint: 420 } as const, FADE_MS = 1000;
export const PAY = { lift: 300, span: 700, fly: 300, glint: 300, hop: 1620, hopMs: 240 } as const;   // ms from payAt

export interface PayItem { k: number | 'sack'; lift: number; land: number }   // k: the coin (0 the bottom one); ms from end.at
export interface PileEnd { how: 'pay' | 'glint' | 'fade' | 'cut'; at: number; items: PayItem[] }
export interface Pile { desk: number; target: number; sack: boolean; shown: number; dropAt: number | null; sat: boolean; end: PileEnd | null }
export type Piles = Map<string, Pile>;   // by AgentView.id

/** The top coin lifts first, the sack last, spread over PAY.span. */
export function payTimeline(coins: number, sack: boolean): PayItem[] {
  const N = coins + (sack ? 1 : 0);
  return Array.from({ length: N }, (_, j) => {
    const lift = PAY.lift + (N > 1 ? j * PAY.span / (N - 1) : 0);   // j·span first: the last lift lands on span exactly
    return { k: j < coins ? coins - 1 - j : 'sack', lift, land: lift + PAY.fly };
  });
}

/** px up at t ms from payAt: the 3 px hop of joy. */
export function payHop(t: number): number {
  return t >= PAY.hop && t < PAY.hop + PAY.hopMs ? Math.round(3 * Math.sin(Math.PI * (t - PAY.hop) / PAY.hopMs)) : 0;
}

/** Coins landed by now. */
export function landed(p: Pile, now: number): number {
  return p.dropAt === null ? p.shown : Math.min(p.target, p.shown + Math.floor((now - p.dropAt) / DROP.ms));
}

/** The falling coin's px over its landing, or none. */
export function fall(p: Pile, now: number): number | null {
  if (p.dropAt === null || landed(p, now) >= p.target) return null;
  const u = ((now - p.dropAt) % DROP.ms) / DROP.ms;
  return Math.round(DROP.h * (1 - u * u));
}

/** Coin k's landing glint, u in [0, 1), else −1. */
export function dropGlint(p: Pile, k: number, now: number): number {
  if (p.dropAt === null || k < p.shown || k >= p.target) return -1;   // only a coin of this drop sparkles, at its landing
  const t = now - (p.dropAt + (k - p.shown + 1) * DROP.ms);
  return t >= 0 && t < DROP.glint ? t / DROP.glint : -1;
}

export function onPile(p: Pile, now: number, calm: boolean): number {
  const e = p.end;
  if (!e) return calm ? p.target : landed(p, now);
  if (calm || e.how === 'cut') return 0;
  if (e.how === 'fade') return p.target;
  let n = p.target;
  for (let j = 0; j < e.items.length; j++) if (e.items[j].k !== 'sack' && now >= e.at + e.items[j].lift) n--;
  return n;
}

export function sackOn(p: Pile, now: number, calm: boolean): boolean {
  const e = p.end;
  if (!e) return p.sack && onPile(p, now, calm) === MAX_COINS;
  if (calm || e.how === 'cut') return false;
  if (e.how === 'fade') return p.sack;
  return p.sack && now < e.at + e.items[e.items.length - 1].lift;   // the sack is the last item
}

export function pileAlpha(p: Pile, now: number, calm: boolean): number {
  return p.end?.how === 'fade' ? Math.max(0, 1 - (now - p.end.at) / FADE_MS) : 1;
}

export function pileShows(p: Pile, now: number, calm: boolean): boolean {
  const e = p.end;
  if (!p.sat) return false;
  if (!e) return true;
  if (calm) return false;
  return e.how === 'fade' ? now - e.at < FADE_MS : e.how !== 'cut' && now - e.at < PAY_WALK;
}

/** Fold the coins landed by now into `shown` (a falling one keeps falling), then take the new target; a lower one
 *  drops the pile at once. */
function settle(p: Pile, now: number, target: number): void {
  const n = landed(p, now);
  p.dropAt = p.dropAt !== null && n < p.target ? p.dropAt + (n - p.shown) * DROP.ms : null;
  p.shown = n;
  p.target = target;
  if (target < n) { p.shown = target; p.dropAt = null; }
}

const cut = (now: number): PileEnd => ({ how: 'cut', at: now, items: [] });

/** Per snapshot, before syncWalkers (it reads the old walker for payday). `now`: the frame clock. */
export function stepCoins(piles: Piles, scene: Scene, walkers: Map<string, Walker>, agents: Map<string, AgentView>, now: number, o: { seed: boolean; calm: boolean }): void {
  const { seed, calm } = o;
  if (seed) piles.clear();
  for (const id of piles.keys()) if (!scene.places.has(id)) piles.delete(id);
  for (const [id, place] of scene.places) {
    const a = agents.get(id);
    if (a?.role !== 'agent') continue;
    const old = piles.get(id), p = old && !old.end ? old : undefined;
    const target = coinCount(a.tokens), sack = hasSack(a.tokens);
    if ((place.kind === 'desk' && atWork(a)) || place.kind === 'wait') {
      if (p) {
        if (target !== p.target) settle(p, now, target);   // a same-token snapshot leaves a landing sparkle be
        p.desk = place.desk ?? p.desk;
        p.sack = sack;
        if (calm) { p.shown = target; p.dropAt = null; }
      } else if (place.desk !== null)
        piles.set(id, { desk: place.desk, target, sack, shown: seed || old ? target : 0, dropAt: null, sat: seed, end: null });
    } else if (!p) {
      if (seed && place.desk !== null) piles.set(id, { desk: place.desk, target, sack, shown: target, dropAt: null, sat: true, end: cut(now) });
    } else if (place.kind === 'done') {
      // pending arrivals cancel, the pile snaps to the target and payday flies all of it
      p.shown = p.target = target;
      p.sack = sack;
      p.dropAt = null;
      if (calm || target === 0 || !p.sat) { p.end = cut(now); continue; }
      const w = walkers.get(id), seat = scene.layout.desks[p.desk].seat;
      const pay = !!w && !w.moving && w.pt.x === seat.x && w.pt.y === seat.y;
      p.end = { how: pay ? 'pay' : 'glint', at: now, items: payTimeline(target, sack) };
      if (pay) w.payAt = now;
    } else if (place.kind === 'fail' || (place.kind === 'desk' && a.stage === 'abandoned')) {
      settle(p, now, p.target);
      p.end = { how: calm || !p.sat ? 'cut' : 'fade', at: now, items: [] };
    } else p.end = cut(now);
  }
}

/** Per frame, after advanceWalkers; writes only when a drop starts or ends, or the agent first sits. */
export function tickCoins(piles: Piles, scene: Scene, walkers: Map<string, Walker>, now: number, calm: boolean): void {
  for (const [id, p] of piles) {
    if (!p.sat && scene.places.get(id)?.kind === 'desk' && walkers.get(id)?.moving === false) p.sat = true;
    if (p.sat && !p.end && p.dropAt === null && p.shown < p.target) { if (calm) p.shown = p.target; else p.dropAt = now; }
    if (p.dropAt !== null && now - p.dropAt >= (p.target - p.shown) * DROP.ms + DROP.glint) { p.shown = p.target; p.dropAt = null; }
  }
}
