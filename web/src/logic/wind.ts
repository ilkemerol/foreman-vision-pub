// Wind out of the server room's vents: from each grille a few thin wavy 1 px ribbons
// blow out and down into the room, each ending in a small curl; one grows out of the grille, travels ~2 tiles and
// shrinks into its curl, then rests until its next cycle.
const DIR = [0.5, 0.866], SIDE = [0.866, -0.5];   // travel: down, a little right (flat px); its side: up-right
export const WIND = {
  travel: 36,   // px the tip moves in a cycle
  len: 12,      // px of wavy body behind the tip
  box: { x0: -3, x1: 21, y0: 0, y1: 30 },   // every pixel's offset from the grille's bottom edge
};

/** One ribbon at phase t (0..1) of its cycle: its pixels as integer offsets from where it leaves the grille's bottom
 *  edge, tail first, curl last. Above that edge it is still in the grille (hidden); the last 15% of the cycle is empty. */
export function windRibbon(seed: number, t: number): [number, number][] {
  const u = t / 0.85;
  if (!(u > 0 && u < 1)) return [];
  const k = Math.min(1, (1 - u) / 0.25), tip = u * WIND.travel - 4, ph = seed * 6.283;   // k: shrinks it at the end
  const wave = (s: number) => 1.5 * Math.sin(s / 2.5 + ph);
  const out: [number, number][] = [], seen = new Set<number>();
  const add = (s: number, n: number) => {
    const x = Math.round(s * DIR[0] + n * SIDE[0]), y = Math.round(s * DIR[1] + n * SIDE[1]);
    if (y >= 0 && !seen.has(x * 64 + y)) { seen.add(x * 64 + y); out.push([x, y]); }
  };
  for (let s = Math.ceil(tip - WIND.len * k); s <= tip; s++) add(s, wave(s));
  // the curl: from the tip, a shrinking loop round a centre 3 px to its side
  const n0 = wave(tip);
  for (let j = 0; j <= 12 * k; j++) { const a = j * 0.4, r = 3 - j * 0.12; add(tip + r * Math.sin(a), n0 + 3 - r * Math.cos(a)); }
  return out;
}
