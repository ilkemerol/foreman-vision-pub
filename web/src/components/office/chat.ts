// The Done lounge's chat clouds: the cloud's pixels and one
// floor's chat clocks, kept with its walkers (both styles draw the same floor from the same map).
import { chatMem, cloudAt, cloudBox, cloudLook, fullTables, stepChat, type ChatMem } from '../../logic/chat.ts';
import type { Walker } from '../../logic/motion.ts';
import type { Frame } from './renderer.ts';
import { mk, px } from './sprites.ts';

type G = CanvasRenderingContext2D;
// o outline, w fill, s its shaded bottom, d a dot (fill until the typing reaches it)
const BODY = ['.oo.ooo.oo.', 'owwowwwowwo', 'owwwwwwwwwo', 'owdwwdwwdwo', 'owwwwwwwwwo', '.owsssssso.', '.owoooooo..', '.oo........'];
const PUFF = ['.o.', 'owo', '.o.'];
const PAL: Record<string, string> = { o: '#3a4058', w: '#f6f7fb', s: '#d9deea', d: '#3a4058' };
const sprites = new Map<string, HTMLCanvasElement>();
/** `rows` mirrored for the right sitter (`flip`), its first `dots` dots (left to right as seen) drawn, the rest fill. */
function sprite(rows: string[], flip: boolean, dots: number): HTMLCanvasElement {
  const key = `${rows.length}:${+flip}:${dots}`;
  let c = sprites.get(key);
  if (!c) {
    const r = flip ? rows.map(s => [...s].reverse().join('')) : rows, g = (c = mk(r[0].length, r.length)).getContext('2d')!;
    let k = 0;
    r.forEach((s, y) => [...s].forEach((ch, x) => { const col = ch === 'd' ? (k++ < dots ? PAL.d : PAL.w) : PAL[ch]; if (col) px(g, col, x, y, 1, 1); }));
    sprites.set(key, c);
  }
  return c;
}

const mems = new WeakMap<Map<string, Walker>, ChatMem>();
/** This frame's clouds, each over its sitter (`id`): side 0 the left one, 1 the right; u its age (ms). */
export function chatClouds(f: Frame): { id: string; side: 0 | 1; u: number }[] {
  let m = mems.get(f.walkers);
  if (!m) mems.set(f.walkers, m = chatMem());
  const full = fullTables(f.scene.layout, f.scene.places, f.walkers, f.trips), out: { id: string; side: 0 | 1; u: number }[] = [];
  stepChat(m, full, f.now);
  for (const [i, pair] of full) { const c = cloudAt(m.talks.get(i)!, f.now); if (c) out.push({ id: pair[c.side], ...c }); }
  return out;
}

/** A cloud at age u over a sitter's drawn feet (x, y), toward its partner. In `post`: over the night. */
export function drawCloud(g: G, x: number, y: number, side: 0 | 1, u: number, calm: boolean): void {
  const look = cloudLook(u, calm), b = cloudBox(Math.round(x), Math.round(y), side), flip = side === 1;
  g.globalAlpha = look.alpha;
  if (look.puff) g.drawImage(sprite(PUFF, flip, 0), flip ? b.x1 - 3 : b.x0, b.y0 + 5);
  else g.drawImage(sprite(BODY, flip, look.dots), b.x0, b.y0 - look.lift);
  g.globalAlpha = 1;
}
