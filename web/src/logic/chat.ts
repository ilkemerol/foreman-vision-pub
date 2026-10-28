// The Done lounge's chat clouds: the two at a full café table now and then "talk", tiny three-dot clouds
// over their heads by turns. Pure: which tables are full, each table's seeded clock, the cloud now, its look and box.
import { CAFE_DX, type Layout, type Rect } from './layout.ts';
import { hash } from './model.ts';
import { AWAY_MS, type Walker } from './motion.ts';
import type { Place } from './scene.ts';

export const LIFE = 1200, STEP = 1400;   // ms a cloud lives; from one cloud's start to the next one's
/** The pause before talk n (n = 0: after the table filled), 30–60 s, seeded by the table and its pair (as
 *  coffee.ts tripGap). */
export const talkGap = (key: string, n: number): number => 30_000 + hash(key + 'chat' + n) % 30_000;
/** Talk n's clouds (3 or 4) and who starts it (0 left, 1 right). */
export const talkCount = (key: string, n: number): number => 3 + hash(key + 'count' + n) % 2;
export const talkFirst = (key: string, n: number): 0 | 1 => (hash(key + 'first' + n) % 2) as 0 | 1;
export const talkMs = (key: string, n: number): number => (talkCount(key, n) - 1) * STEP + LIFE;

/** The full café tables, index into l.cafes → [left sitter, right sitter]: both seats held by a done agent at
 *  rest on it (not walking, not out for coffee: `out`). A burning one has a 'burn' place, a paid one stands by its desk. */
export function fullTables(l: Layout, places: Map<string, Place>, walkers: Map<string, Walker>, out: { has(id: string): boolean }): Map<number, [string, string]> {
  const seats = new Map<string, string>();
  for (const [id, p] of places) {
    const w = walkers.get(id);
    if (p.kind === 'done' && w && !w.moving && !out.has(id) && w.pt.x === p.spot.pt.x && w.pt.y === p.spot.pt.y) seats.set(`${w.pt.x},${w.pt.y}`, id);
  }
  const full = new Map<number, [string, string]>();
  l.cafes.forEach((t, i) => {
    const a = seats.get(`${t.x - CAFE_DX},${t.y}`), b = seats.get(`${t.x + CAFE_DX},${t.y}`);
    if (a && b) full.set(i, [a, b]);
  });
  return full;
}

/** A full table's clock: talk n starts at `at`. `key` seeds it: the table and its pair. */
export interface Talk { pair: string; key: string; at: number; n: number }
/** One floor's chat clocks (components/office/chat.ts keeps one per walkers map) and the last frame's time. */
export interface ChatMem { last: number; talks: Map<number, Talk> }
export const chatMem = (): ChatMem => ({ last: -Infinity, talks: new Map() });

/** Follow this frame's full tables. A newly full table (or a new pair) starts its clock now; one no longer
 *  full is dropped (its cloud goes at once); a finished talk schedules the next. A frame gap over AWAY_MS (the floor
 *  reseeds) restarts every clock, so a reload or a return to the tab never bursts into clouds. */
export function stepChat(m: ChatMem, full: Map<number, [string, string]>, now: number): void {
  if (now - m.last > AWAY_MS) m.talks.clear();
  m.last = now;
  for (const i of [...m.talks.keys()]) if (!full.has(i)) m.talks.delete(i);
  for (const [i, [a, b]] of full) {
    const pair = `${a}|${b}`;
    let t = m.talks.get(i);
    if (!t || t.pair !== pair) { const key = `${i}:${pair}`; m.talks.set(i, t = { pair, key, at: now + talkGap(key, 0), n: 0 }); }
    while (now >= t.at + talkMs(t.key, t.n)) { t.at += talkMs(t.key, t.n) + talkGap(t.key, t.n + 1); t.n++; }
  }
}

/** The cloud over a table now: who talks (0 left, 1 right) and the cloud's age (ms, 0 … LIFE), or null. */
export function cloudAt(t: Talk, now: number): { side: 0 | 1; u: number } | null {
  if (now < t.at) return null;
  const k = Math.floor((now - t.at) / STEP), u = now - t.at - k * STEP;
  return k < talkCount(t.key, t.n) && u < LIFE ? { side: ((talkFirst(t.key, t.n) + k) % 2) as 0 | 1, u } : null;
}

/** A cloud at age u. `puff`: the 3×3 pop instead of the cloud; `lift`: px up; `dots`: shown (typing 1-2-3);
 *  reduced motion: the whole cloud, still, all three dots. */
export function cloudLook(u: number, calm: boolean): { puff: boolean; lift: 0 | 1; alpha: number; dots: number } {
  if (calm) return { puff: false, lift: 0, alpha: 1, dots: 3 };
  if (u < 70) return { puff: true, lift: 0, alpha: 1, dots: 0 };
  if (u < 150) return { puff: false, lift: 1, alpha: 1, dots: 1 };
  if (u >= LIFE - 250) return { puff: false, lift: 1, alpha: [0.7, 0.45, 0.2][Math.min(2, Math.floor((u - (LIFE - 250)) / 84))], dots: 3 };
  return { puff: false, lift: 0, alpha: 1, dots: 1 + Math.floor((u - 150) / 220) % 3 };
}

export const CLOUD_W = 11, CLOUD_H = 8;
/** The cloud's box over a sitter's drawn feet (x, y), toward its partner: the left one's (side 0) from x + 6,
 *  the right one's mirrored about the sitter's centre column (x − ½); y − 35 … y − 28 (two px lower than a first draft, which in
 *  iso touched the feet of the sitter one table up and left: its pop and fade rise 1 px, to y − 36). The pop's 3×3 puff
 *  starts at the box's near bottom corner, (x + 6, y − 30) mirrored. */
export function cloudBox(x: number, y: number, side: 0 | 1): Rect {
  const x0 = side === 0 ? x + 6 : x - 6 - CLOUD_W;
  return { x0, y0: y - 35, x1: x0 + CLOUD_W, y1: y - 35 + CLOUD_H };
}
