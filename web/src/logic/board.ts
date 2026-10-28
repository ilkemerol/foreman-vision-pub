import type { AgentView } from '../../../shared/types.ts';
import { t } from './i18n.ts';
import { trunc } from './labels.ts';
import { LAMPS_AT } from './ambient.ts';
import { hash } from './model.ts';

// The Done lounge's smart board: pixel writing that fills up with the room, and the table its hover
// balloon shows. Pure; the drawing is flat.ts / iso.ts boardScreen, the balloon BoardPop.
export const BOARD_HIT = 'board';   // its hit box's id (OfficeFloor: hovering it opens the balloon)
export const INK = ['#e6edf3', '#7ee787', '#79c0ff', '#ffa657', '#d2a8ff', '#f2cc60'];

/** One pixel row of writing on the screen: from (x, y), w px long, in colour c (screen px from its inner top left). */
export interface Mark { x: number; y: number; w: number; c: string }

/** The board's writing for its agents (`keys`, oldest arrival first) on a w×h screen: one line each, 2 px apart, the
 *  left column first, a second column on a screen 30 px wide or more; as many lines as fit. A line is a coloured bullet
 *  and white words of 2–6 px up to somewhere in its last third, seeded by the agent's key, so it never flickers. */
export function boardMarks(keys: string[], w: number, h: number): Mark[] {
  const rows = Math.floor((h - 1) / 2) + 1, cols = w >= 30 ? 2 : 1, cw = Math.floor((w - 2 * (cols - 1)) / cols), out: Mark[] = [];
  keys.slice(0, rows * cols).forEach((key, i) => {
    const x0 = Math.floor(i / rows) * (cw + 2), y = (i % rows) * 2, hk = hash(key + ':board');
    out.push({ x: x0, y, w: 1, c: INK[1 + hk % (INK.length - 1)] });
    const end = x0 + Math.max(4, cw - (hk >>> 3) % Math.max(1, Math.floor(cw / 3)));   // a line ends somewhere in its last third
    for (let x = x0 + 2, k = 0; x < end; k++) {
      const len = Math.min(end - x, 2 + (hk >>> (6 + 3 * (k % 8))) % 5);
      out.push({ x, y, w: len, c: INK[0] });
      x += len + 1;
    }
  });
  return out;
}

/** The board's fill bar: the share of the Done lounge's seats taken, 0..1. */
export const boardFill = (n: number, cap: number): number => (cap > 0 ? Math.min(1, n / cap) : 0);

/** "3 min ago" from ms. */
export function agoText(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  return m < 1 ? t('board.ago.now') : m < 60 ? t('board.ago.min', { n: m }) : t('board.ago.hour', { n: Math.floor(m / 60) });
}

export interface BoardRow { n: number; id: string; name: string; type: string; note: string; ago: string }
export const BOARD_ROWS = 10;
/** The balloon's table (like `/foreman status`): the Done lounge's agents newest first (stageSince, then id), at most `max`
 *  rows (`more`: the rest), long text cut with '…'. */
export function boardRows(done: AgentView[], now: number, max = BOARD_ROWS): { rows: BoardRow[]; more: number } {
  const all = [...done].sort((a, b) => b.stageSince - a.stageSince || a.id.localeCompare(b.id));
  const rows = all.slice(0, max).map((a, i) => ({ n: i + 1, id: a.id, name: trunc(a.label, 28), type: trunc(a.type, 16), note: trunc(a.note ?? '—', 40), ago: agoText(now - a.stageSince) }));
  return { rows, more: all.length - rows.length };
}

/** Hovering an agent in the Done lounge shows only its name tag: the board's balloon says the rest, so no terminal. */
export const hasTerminal = (place?: { kind: string }): boolean => place?.kind !== 'done';

// At night the board flickers like a failing tube now and then. A pure function of the local
// clock (Frame.ambient.date), so a reload, a style switch or a floor slide shows the same flicker at the same instant:
// one event in every 90 s slot, 0–30 s into it (60–120 s apart); one in four a 1 s outage that stutters back, else 1–3
// blinks of 0.1 s.
export const FLICKER_SLOT = 90_000;
const BLINKS: [number, number][] = [[0, 100], [220, 320], [440, 540]], OUTAGE: [number, number][] = [[0, 1000], [1060, 1140]];
/** Slot k's flicker: its start (ms, local clock) and its dark spans (ms from the start). */
export function flickerEvent(k: number): { start: number; off: [number, number][] } {
  const h = hash('board-flicker' + k);
  return { start: k * FLICKER_SLOT + hash('board' + k) % 30_000, off: h % 4 === 0 ? OUTAGE : BLINKS.slice(0, 1 + (h >>> 2) % 3) };
}
/** Is the board's screen lit at local time `ms`? Always by day (dark < LAMPS_AT) and with reduced motion. */
export function boardLit(ms: number, dark: number, calm: boolean): boolean {
  if (dark < LAMPS_AT || calm) return true;
  const e = flickerEvent(Math.floor(ms / FLICKER_SLOT)), t = ms - e.start;
  return !e.off.some(([a, b]) => t >= a && t < b);
}
