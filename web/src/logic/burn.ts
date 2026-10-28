// web/src/logic/burn.ts — the burn out of the office: its timeline and pixel maps; pure, no DOM.
import { BOARD_GRACE_MS, DONE_STAY_MS } from '../../../shared/types.ts';

export const BURN_MS = 5000;

/** The maps, rows top down, '.' clear; copied verbatim without the row numbers. SITTER: rows 6–31 of the 16×32
 *  character cell (rows 0–5 are clear). PILE 16×8 (its last row on the floor line), ASH 12×3. */
export const SITTER = [
  '....SBBBBBS.....',
  '...SBBBBBBBBBS..',
  '..SBBBBBBBBBBBS.',
  '.SBBBBBBBBBBBBS.',
  '.SBBBBBBBBBBBBS.',
  '.SBKKKBBBBKKKBS.',
  '.SBKKKBBBBKKKBS.',
  '.SBBKBBBBBBKBBS.',
  '.SBBBBBKKBBBBBS.',
  '..SBBBBBBBBBBS..',
  '...SBKBKBKBKS...',
  '....SBBBBBBS....',
  '.......BB.......',
  '...SBBBBBBBBS...',
  '..B.BBBBBBBB.B..',
  '..B...SBBS...B..',
  '..B.BBBBBBBB.B..',
  '..B...SBBS...B..',
  '.BB..BBBBBB..BB.',
  '....BBSBBSBB....',
  '....BB....BB....',
  '....BB....BB....',
  '....SB....BS....',
  '....BB....BB....',
  '....BB....BB....',
  '...BBB....BBB...',
];

export const PILE = [
  '....SBBBS.......',
  '...SBKBKBS......',
  '...SBBBBBS..B...',
  '....SKBKS..BB...',
  '.B...SSS..BB....',
  'BBBBBBBBBBBBBB..',
  '.SBBSBBBBSBBS.BB',
  '..BBBBBBBBBBBB..',
];

export const ASH = [
  '....AAAA....',
  '..AAaAAAaA..',
  '.AAAAAAAAAA.',
];

/** The sitter seen from behind: rows 11–16 (indices 5–10) with K → B, the skull's back. */
export const sitterRows = (back: boolean): string[] =>
  back ? SITTER.map((r, i) => (i >= 5 && i <= 10 ? r.replaceAll('K', 'B') : r)) : SITTER;

/** Tones 0 bone, 1 scorched, 2 charred. */
export const BONE: [b: string, s: string, k: string][] = [
  ['#ece6d2', '#bdb49a', '#2a2320'],
  ['#a08a6a', '#7d6a52', '#2a2320'],
  ['#5a4636', '#3d2f25', '#1e1e1e'],
];

export const ASH_INK = { A: '#8d939b', a: '#5f646b' } as const;

/** A done agent's ✓ is a clock to its burn, in 12 steps of the board grace: 1 full (leaveAt
 *  null, or a whole grace or more left), down to the last step (1/12), which stays from leaveAt until the burn takes over.
 *  A leaveAt that is the 10-minute stay's (`since` + DONE_STAY_MS) counts on a 10-minute face. */
export function clockLeft(leaveAt: number | null, now: number, since = NaN): number {
  if (leaveAt === null) return 1;
  const face = leaveAt - since === DONE_STAY_MS ? DONE_STAY_MS : BOARD_GRACE_MS;
  return Math.min(12, Math.max(1, Math.ceil((leaveAt - now) / face * 12))) / 12;
}

const inDisc = (x: number, y: number, n: number) => (x + 0.5 - n / 2) ** 2 + (y + 0.5 - n / 2) ** 2 <= (n / 2) ** 2;

/** The pixels of an n px disc still shown at `left`: those from the hand clockwise back to 12 o'clock (it empties
 *  clockwise); an odd disc's centre pixel stays while any is left. */
export function clockPixels(n: number, left: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x + 0.5 - n / 2, dy = n / 2 - y - 0.5, a = Math.atan2(dx, dy) / (2 * Math.PI);   // turns clockwise from 12 o'clock, −½..½
    if (inDisc(x, y, n) && left > 0 && ((dx === 0 && dy === 0) || (a < 0 ? a + 1 : a) >= 1 - left)) out.push([x, y]);
  }
  return out;
}

/** The disc's own edge (its pixels with a 4-neighbour outside it): the clock face. */
export const clockRing = (n: number): [number, number][] => clockPixels(n, 1)
  .filter(([x, y]) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([u, v]) => !inDisc(u, v, n)));

export interface BurnFrame {
  bones: number;          // sitter rows from the top drawn as bones (6..32; the agent's own frame below); 0: no sitter
  shake: number;          // the sitter's x offset (−1, 0, 1)
  fall: number;           // 0..1 of the skeleton's drop, ((t − 800) / 150)² over 800–950
  pile: 0 | 1 | 2 | null; // bone pile tone; null: none
  bounce: number;         // px the pile sits above the floor line
  ash: number;            // ash rows left, counted from the bottom (0..3)
  dust: { d: number; a: number } | null;   // spread px and alpha
  flame: number;          // flame height and glow alpha scale 0..1
  smoke: number;          // smoke level 0..1
  ember: boolean;         // the two ember px lit
  motes: { x: number; y: number; a: number; dark: boolean }[];   // offsets from the ash pile's top row centre
  label: boolean;         // the name label stays
}

/** The frame t ms into the burn; null for t < 0 and t ≥ BURN_MS. */
export function burnPhase(t: number): BurnFrame | null {
  if (t < 0 || t >= BURN_MS) return null;
  const motes: BurnFrame['motes'] = [];
  for (let i = 0; i < 8; i++) {
    const age = t - 4000 - 60 * i;
    if (age < 0 || age >= 600) continue;
    const k = age / 600;
    motes.push({ x: i % 4 - 2 + Math.round(16 * k), y: Math.round(-8 * k + Math.sin(k * 4 * Math.PI)), a: 1 - k, dark: i % 2 === 1 });
  }
  return {
    bones: t < 500 ? 6 + Math.floor(t / 500 * 26) : t < 950 ? 32 : 0,
    shake: t >= 650 && t < 800 ? (Math.floor((t - 650) / 60) % 2 === 0 ? 1 : -1) : 0,
    fall: t >= 800 && t < 950 ? ((t - 800) / 150) ** 2 : 0,
    pile: t < 950 || t >= 3000 ? null : t < 1867 ? 0 : t < 2333 ? 1 : 2,
    bounce: t >= 950 && t < 1000 ? 1 : 0,
    ash: t < 3000 ? 0 : t < 4250 ? 3 : t < 4500 ? 2 : t < 4750 ? 1 : 0,
    dust: t >= 950 && t < 1100 ? { d: Math.round((t - 950) / 150 * 4), a: 1 - (t - 950) / 150 } : null,
    flame: t < 1100 ? 0 : t < 1400 ? Math.min(1, 0.25 * (1 + Math.floor((t - 1100) / 75)))
      : t < 2800 ? 1 : t < 3200 ? 1 - 0.25 * Math.floor((t - 2800) / 100) : 0,
    smoke: t < 2800 ? 0 : t < 3200 ? (t - 2800) / 400 : t < 4000 ? 1 - 0.5 * (t - 3200) / 800 : 0.5 - 0.5 * (t - 4000) / 1000,
    ember: t >= 3200 && t < 3600 && Math.floor((t - 3200) / 200) % 2 === 0,
    motes,
    label: t < 800,
  };
}
