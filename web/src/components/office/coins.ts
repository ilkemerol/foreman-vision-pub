// Office coins: the piles, the falling coin, payday's flight and the sparkles.
import { isoView, type Layout } from '../../logic/layout.ts';
import { column, dropGlint, fall, landed, onPile, PAY, pileAlpha, pileFlat, pileIso, pileShows, sackOn, type Piles } from '../../logic/coins.ts';
import { isoDepth, isoProj } from '../../logic/iso.ts';
import { blit, sprite } from './pets.ts';
import { px, remember } from './sprites.ts';

// one palette for both styles; `o` the shared outline
const GOLD = { f: '#ffe066', F: '#fffbe6', g: '#f0b323', d: '#c27f0e', l: '#ffd75e', r: '#8f5c07', o: '#3a2306',
  b: '#b9824a', B: '#8a5a2c', t: '#5e3b14', y: '#ffd23f', Y: '#e0a419' };
// a column of m coins: a top face over 2 rows a coin (edge, rim line), 3 + 2m px tall with its outline
const COL = [1, 2, 3, 4, 5].map(m => ['fFff', ...Array<string[]>(m).fill(['dggl', 'rrrr']).flat()]);
const SPIN = [['fFff', 'dggl', 'rrrr'], ['fF', 'dl', 'rr'], ['l', 'g', 'r'], ['Ff', 'ld', 'rr']];   // a flying coin turns
const SACK = ['...YyY...', '..YyFyY..', '...ttt...', '..bbtbb..', '.bbbbbbb.', 'bbbyyybbb', 'bbbYYYbbb', 'bbbbbbbbB', '.BBBBBBB.'];
const colSprite = (m: number) => sprite(`coin-col${m}`, COL[m - 1], GOLD);   // m 1..5
const spin = (k: number) => sprite(`coin-spin${k}`, SPIN[k], GOLD);
const sack = () => sprite('coin-sack', SACK, GOLD);

/** A short sparkle at (x, y), u 0..1: a plus that grows, then four fading corner dots; `big` one px wider (the sack). */
function sparkle(g: CanvasRenderingContext2D, x: number, y: number, u: number, big = false) {
  if (!(u >= 0 && u < 1)) return;
  x = Math.round(x); y = Math.round(y);
  const r = (big ? 1 : 0) + (u < 0.25 ? 1 : u < 0.6 ? 2 : 3);
  if (u < 0.6) {
    px(g, '#ffd23f', x - r, y, 2 * r + 1, 1); px(g, '#ffd23f', x, y - r, 1, 2 * r + 1);
    px(g, '#fff3b0', x - 1, y, 3, 1); px(g, '#fff3b0', x, y - 1, 1, 3); px(g, '#ffffff', x, y, 1, 1);
  } else {
    g.globalAlpha = (1 - u) / 0.4;
    for (let dx = -1; dx <= 1; dx += 2) for (let dy = -1; dy <= 1; dy += 2) px(g, '#fff3b0', x + dx * (r - 1), y + dy * (r - 1), 1, 1);
    px(g, '#ffffff', x, y, 1, 1);
    g.globalAlpha = 1;
  }
}

export interface PileSpot { cols: { x: number; b: number; z: number }[]; sack: { x: number; y: number; z: number } }   // screen px: column sprite left, bottom row; the sack's feet; z: sort key
const flats = new Map<string, PileSpot[]>();
/** Each desk's pile spot, once per layout. */
export function flatSpots(l: Layout): PileSpot[] {
  let s = flats.get(l.key);
  if (!s) remember(flats, l.key, s = l.desks.map(d => {
    const p = pileFlat(d);
    return { cols: p.cols.map(c => ({ x: c.x, b: c.y, z: d.y + 31 })), sack: { ...p.sack, z: d.y + 38 } };
  }));
  return s;
}

const isos = new Map<string, PileSpot[]>();
/** pileIso's world points on the iso screen, depth-sorted by their world points, once per layout. */
export function isoSpots(l: Layout): PileSpot[] {
  let s = isos.get(l.key);
  if (!s) {
    const v = isoView(l.cols, l.rows);
    remember(isos, l.key, s = l.desks.map((_, i) => {
      const p = pileIso(l, i), [kx, ky] = isoProj(v, p.sack.x, p.sack.y, 0);
      return {
        cols: p.cols.map(c => { const [sx, sy] = isoProj(v, c.x, c.y, 0); return { x: Math.round(sx) - 3, b: Math.round(sy), z: isoDepth(c.x, c.y) }; }),
        sack: { x: kx, y: ky, z: isoDepth(p.sack.x, p.sack.y) },
      };
    }));
  }
  return s;
}

/** Every shown pile's items into the frame's depth sort (`push`): its columns and sack, a falling coin, the landing
 *  sparkles, payday's flight to `chest(id)` (the paid walker's chest, null: none) and the in-place glints. */
export function coinItems(g: CanvasRenderingContext2D, piles: Piles, spots: PileSpot[], chest: (id: string) => { x: number; y: number; z: number } | null,
  now: number, calm: boolean, push: (z: number, d: () => void) => void): void {
  for (const [id, p] of piles) {
    const s = spots[p.desk];
    if (!s || !pileShows(p, now, calm)) continue;
    const n = onPile(p, now, calm), a = pileAlpha(p, now, calm), e = p.end;
    for (let c = 0; c < 3; c++) {
      const m = column(n, c);
      if (m === 0) continue;
      const q = s.cols[c], spr = colSprite(m);
      push(q.z, () => { g.globalAlpha = a; g.drawImage(spr, q.x, q.b - spr.height + 1); g.globalAlpha = 1; });
    }
    if (sackOn(p, now, calm)) push(s.sack.z, () => { g.globalAlpha = a; blit(g, sack(), s.sack.x, s.sack.y, false); g.globalAlpha = 1; });
    if (!e) {
      if (calm) continue;
      const h = fall(p, now), L = landed(p, now);
      if (h !== null) {   // the next coin, h px over its landing
        const q = s.cols[Math.floor(L / 5)], spr = colSprite(1), b = q.b - 2 * (L % 5) - h;
        push(q.z + 0.01, () => g.drawImage(spr, q.x, b - spr.height + 1));
      }
      for (let k = Math.max(0, L - 2); k < L; k++) {   // the last two landed: their landing sparkle
        const u = dropGlint(p, k, now);
        if (u < 0) continue;
        const q = s.cols[Math.floor(k / 5)], y = q.b - 2 * (k % 5) - 6;
        push(q.z + 0.02, () => sparkle(g, q.x + 6, y, u));
      }
      continue;
    }
    if (e.how !== 'pay' && e.how !== 'glint') continue;
    const ch = e.how === 'pay' ? chest(id) : null;
    if (e.how === 'pay' && !ch) continue;
    const t = now - e.at;
    for (let j = 0; j < e.items.length; j++) {
      const it = e.items[j], k = it.k, big = k === 'sack';
      // the item's own place: a coin's centre, or over the sack's feet
      let fx = s.sack.x, fy = s.sack.y - 5, z = s.sack.z;
      if (k !== 'sack') { const q = s.cols[Math.floor(k / 5)]; fx = q.x + 3; fy = q.b - 2 * (k % 5) - 3; z = q.z; }
      if (!ch) {   // glint: it vanishes where it is
        const u = (t - it.lift) / PAY.glint;
        if (u >= 0 && u < 1) push(z + 0.02, () => sparkle(g, fx, fy, u, big));
        continue;
      }
      const u = (t - it.lift) / PAY.fly;
      if (u >= 0 && u < 1) {   // in a straight line to the chest with an arc over it
        const x = fx + (ch.x - fx) * u, y = fy + (ch.y - fy) * u - (big ? 8 : 12) * Math.sin(Math.PI * u);
        if (big) push(ch.z, () => blit(g, sack(), x, y + 5, false));
        else { const spr = spin(Math.floor(u * PAY.fly / 60) % 4); push(ch.z, () => g.drawImage(spr, Math.round(x - spr.width / 2), Math.round(y - spr.height / 2))); }
      }
      const v = (t - it.land) / PAY.glint, cx = ch.x + (j % 3) - 1, cy = ch.y - (j % 2);
      if (v >= 0 && v < 1) push(ch.z, () => sparkle(g, cx, cy, v, big));
    }
  }
}
