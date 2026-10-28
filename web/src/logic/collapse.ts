import type { SessionView } from '../../../shared/types.ts';

/** A hidden floor caves in: it cracks and shakes, its blocks fall top row first, dust puffs
 *  where they leave the floor's bottom edge; under reduced motion it only fades. */
export const COLLAPSE_MS = 1400, FADE_MS = 200;
export const CRACK_MS = 260;   // shaking and cracking, nothing falls yet
const FALL_MS = 520;           // a block falls `fall` px in this long
const JITTER_MS = 120;
const DUST_MS = 420;

export interface Block { x: number; y: number; w: number; h: number; delay: number; drift: number }

/** The w×h bitmap cut into size×size blocks (the right and bottom ones smaller), each falling at `delay`: row by row from
 *  the top, with random jitter, so the last starts FALL_MS before the end. `drift`: px it moves sideways over a fall. */
export function collapseBlocks(w: number, h: number, size: number, rand: () => number): Block[] {
  const rows = Math.ceil(h / size), cols = Math.ceil(w / size);
  const rowMs = rows > 1 ? (COLLAPSE_MS - CRACK_MS - FALL_MS - JITTER_MS) / (rows - 1) : 0;
  const out: Block[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * size, y = r * size;
    out.push({ x, y, w: Math.min(size, w - x), h: Math.min(size, h - y), delay: Math.round(CRACK_MS + r * rowMs + rand() * JITTER_MS), drift: Math.round(rand() * 6 - 3) });
  }
  return out;
}

/** A block's whole-pixel offset at `t` ms into the collapse: still before its delay, then gravity (it falls `fall` px
 *  in FALL_MS) and its drift; `p` is how far into its fall (0–1, 1 also after). */
export function blockAt(b: Block, t: number, fall: number): { dx: number; dy: number; p: number } {
  const p = Math.min(1, Math.max(0, (t - b.delay) / FALL_MS));
  return { dx: Math.round(b.drift * p) || 0, dy: Math.round(fall * p * p), p };
}

/** Seams between the blocks once the floor cracks (half way into the shaking). */
export const cracked = (t: number) => t >= CRACK_MS / 2;

/** The whole-pixel shake: hard while it cracks, a tremor while blocks fall, still at the end. */
export function shakeAt(t: number): { x: number; y: number } {
  const amp = t < CRACK_MS ? 2 : t < COLLAPSE_MS - 300 ? 1 : 0;
  return { x: amp && (Math.floor(t / 40) % 2 ? amp : -amp), y: Math.floor(t / 60) % 2 ? amp >> 1 : 0 };
}

export interface Puff { x: number; y: number; s: number }

/** Dust where a block's bottom crosses the floor's bottom edge (`h`): two pixel squares per block that rise, spread
 *  and shrink over DUST_MS. */
export function dustAt(blocks: Block[], h: number, t: number): Puff[] {
  const out: Puff[] = [];
  for (const b of blocks) {
    const at = b.delay + FALL_MS * Math.sqrt(Math.max(0, h - b.y - b.h) / h);   // blockAt with fall = h
    const q = (t - at) / DUST_MS;
    if (q < 0 || q >= 1) continue;
    const s = Math.max(1, Math.round(4 * (1 - q))), cx = b.x + (b.w >> 1), spread = Math.round(b.w * 0.6 * q);
    for (const side of [-1, 1]) out.push({ x: cx + side * spread - (s >> 1), y: h - s - Math.round(10 * q), s });
  }
  return out;
}

/** Floors to draw: shown ones and the ones still collapsing. */
export const visibleSessions = (sessions: SessionView[], collapsing: ReadonlySet<string>) =>
  sessions.filter(s => s.hiddenAt === null || collapsing.has(s.sid));

/** The hidden floors not seen hidden before (`seen`: those already handled; null: the first snapshot after a load), and
 *  of them the ones to collapse: hidden within COLLAPSE_MS of `now`. A reload never replays. `seen` is the next one. */
export function newlyHidden(seen: ReadonlySet<string> | null, sessions: SessionView[], now: number): { seen: Set<string>; collapse: string[] } {
  const hidden = sessions.filter(s => s.hiddenAt !== null);
  const collapse = seen ? hidden.filter(s => !seen.has(s.sid) && now - s.hiddenAt! < COLLAPSE_MS).map(s => s.sid) : [];
  return { seen: new Set(hidden.map(s => s.sid)), collapse };
}

/** The floor that takes a gone floor's place: the card under it in the sidebar (the next F down), else the one above;
 *  `sessions` bottom to top (byFloor). */
export function nextFloor(sessions: SessionView[], sid: string): string | null {
  const i = sessions.findIndex(s => s.sid === sid);
  return sessions[i - 1]?.sid ?? sessions[i + 1]?.sid ?? null;
}
