import type { Layout } from './layout.ts';
import { hash } from './model.ts';

// Team seating: sub-agents of one team sit together, in a two-row block that grows
// sideways, so 4 of them make a square: 2 at the front desks, 2 right behind them.
const SOLO = new Set(['general-purpose', 'claude', 'unknown', 'workflow-subagent']);

/** The team of a sub-agent type: before its first colon, else the whole name; the solo types sit as today (null). Case-sensitive. */
export const teamOf = (type: string): string | null => SOLO.has(type) ? null : type.split(':')[0];

// keyed by the desks array, which a layout's copies (isoFit's { ...l }) share; a layout's desks never change once built
const CELLS = new WeakMap<Layout['desks'], readonly { readonly row: number; readonly col: number }[]>();

/** Each desk's row and column within its room (same index as l.desks): its y's and cx's rank among the room's. */
export function deskCells(l: Layout): readonly { readonly row: number; readonly col: number }[] {
  const rank = (i: number, k: 'y' | 'cx') => new Set(l.desks.filter(e => e.room === l.desks[i].room && e[k] < l.desks[i][k]).map(e => e[k])).size;
  let c = CELLS.get(l.desks);
  if (!c) CELLS.set(l.desks, c = l.desks.map((_, i) => ({ row: rank(i, 'y'), col: rank(i, 'cx') })));
  return c;
}

/** Every desk of the anchor's room, block first: the anchor and its right neighbour, the two behind them (the row above,
 *  else below), then a column at a time rightwards, then leftwards; the desks off the strip by distance, seeded ties. */
export function blockOrder(l: Layout, anchor: number, seed: number): number[] {
  const cells = deskCells(l), { row: r, col: c } = cells[anchor];
  const mine = l.desks.map((_, i) => i).filter(i => l.desks[i].room === l.desks[anchor].room);
  const rows = new Set(mine.map(i => cells[i].row)), back = rows.has(r - 1) ? r - 1 : rows.has(r + 1) ? r + 1 : null;
  const cols = [...new Set(mine.map(i => cells[i].col))].sort((a, b) => a - b);
  const lane = [...cols.filter(k => k >= c), ...cols.filter(k => k < c).reverse()];
  const pairs = lane.flatMap(k => [[r, k], [back, k]]);
  if (lane[1] === c + 1) [pairs[1], pairs[2]] = [pairs[2], pairs[1]];   // the anchor's 2×2 row by row: front pair, then back pair
  const strip = pairs.map(([row, col]) => mine.find(i => cells[i].row === row && cells[i].col === col)).filter(i => i !== undefined);
  // off the strip lie only other rows, so a same-row/back-row tie-break never applies
  const dist = (i: number) => Math.abs(cells[i].row - r) + Math.abs(cells[i].col - c);
  const rest = mine.filter(i => !strip.includes(i)).sort((a, b) => dist(a) - dist(b) || hash(`${seed}:${a}`) - hash(`${seed}:${b}`));
  return [...strip, ...rest];
}

/** How many of the first four desks of the anchor's block are free (0–4); the seed cannot reach them (every room has 2+ columns). */
export const blockFree = (l: Layout, anchor: number, free: (i: number) => boolean): number =>
  blockOrder(l, anchor, 0).slice(0, 4).filter(free).length;
