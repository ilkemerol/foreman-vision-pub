import { gaugeColor } from '../../logic/corner.ts';
import { px } from './sprites.ts';

// The foreman corner's drawings: the clock and the box.
type G = CanvasRenderingContext2D;

// 4×7 seven-segment digits: each segment's two pixels
const SEG: Record<string, [number, number][]> = { a: [[1, 0], [2, 0]], b: [[3, 1], [3, 2]], c: [[3, 4], [3, 5]], d: [[1, 6], [2, 6]], e: [[0, 4], [0, 5]], f: [[0, 1], [0, 2]], g: [[1, 3], [2, 3]] };
const DIG = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
const ON = '#ff3b2f', OFF = '#3a1210';

function digit(g: G, n: number, x: number, y: number) {
  for (const s in SEG) for (const [cx, cy] of SEG[s]) px(g, DIG[n].includes(s) ? ON : OFF, x + cx, y + cy, 1, 1);
}

/** The digital wall clock, local HH:MM: a 25×11 case, its shadow row under it (26×12 in all); the colon lit for half of each second. */
export function drawClock(g: G, x: number, y: number, d: Date) {
  const hh = d.getHours(), mm = d.getMinutes();
  px(g, 'rgba(0,0,0,.25)', x + 1, y + 11, 25, 1);
  px(g, '#0b0c10', x, y, 25, 11); px(g, '#2a2d36', x + 1, y + 1, 23, 9); px(g, '#3b3f4a', x + 1, y + 1, 23, 1);
  px(g, '#140607', x + 2, y + 2, 21, 7);
  digit(g, Math.floor(hh / 10), x + 2, y + 2); digit(g, hh % 10, x + 7, y + 2);
  digit(g, Math.floor(mm / 10), x + 14, y + 2); digit(g, mm % 10, x + 19, y + 2);
  const colon = d.getMilliseconds() < 500 ? ON : OFF;
  px(g, colon, x + 12, y + 4, 1, 1); px(g, colon, x + 12, y + 6, 1, 1);
}

/** The context box, 16×32 at its top-left (x, y): a dark cabinet, a glass front, one liquid tank filled to v % in its
 *  band's colour (null: empty); the blue LED blinks fast while the foreman works at it. */
export function drawGaugeBox(g: G, x: number, y: number, v: number | null, now: number, working: boolean) {
  px(g, '#141821', x, y, 16, 32); px(g, '#2b3242', x + 1, y + 1, 14, 30); px(g, '#46516a', x + 1, y + 1, 14, 2);
  px(g, Math.floor(now / 500) % 2 ? '#39d353' : '#0f3d1c', x + 3, y + 4, 1, 1);
  px(g, working && Math.floor(now / 120) % 2 ? '#79c0ff' : '#14304d', x + 5, y + 4, 1, 1);
  px(g, '#1a2030', x + 9, y + 4, 4, 1);
  px(g, '#0d121c', x + 2, y + 6, 12, 23);                                          // glass
  px(g, '#4b5670', x + 5, y + 7, 6, 21); px(g, '#121826', x + 6, y + 8, 4, 19);   // tube
  for (const t of [0.25, 0.5, 0.75]) px(g, '#4b5670', x + 11, y + 27 - Math.round(19 * t), 2, 1);
  const h = v === null ? 0 : Math.round(19 * v / 100);
  if (h > 0) {
    px(g, gaugeColor(v), x + 6, y + 27 - h, 4, h);
    g.globalAlpha = 0.45; px(g, '#ffffff', x + 6, y + 27 - h, 4, 1); px(g, '#000000', x + 9, y + 28 - h, 1, h - 1);
    if (h > 3) { g.globalAlpha = 0.7; px(g, '#ffffff', x + 7 + Math.floor(now / 400) % 2, y + 26 - Math.floor(now / 90) % (h - 1), 1, 1); }
    g.globalAlpha = 1;
  }
  g.globalAlpha = 0.16; px(g, '#ffffff', x + 3, y + 7, 1, 21); px(g, '#ffffff', x + 4, y + 7, 1, 5); g.globalAlpha = 1;
}
