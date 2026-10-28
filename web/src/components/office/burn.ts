// The burn out of the office: skeleton, fall, fire, ash; one drawing for both styles.
import { ASH, ASH_INK, BONE, burnPhase, PILE, sitterRows } from '../../logic/burn.ts';
import { fire, fireGlow, smoke } from './flat.ts';
import { mk, px } from './sprites.ts';

/** One burn's spot in screen px: (x, y) the sitter's drawn feet (lift applied); fl the piles' bottom row; drop the px the
 *  skeleton falls by 950 ms; the sitter's sheet cell and alpha (a ghost 0.35; bones always 1); back: the skeleton's back
 *  view; span: the room floor's row span for the light. */
export interface BurnSpot { x: number; y: number; fl: number; drop: number; sheet: CanvasImageSource; col: number; row: number; back: boolean; alpha: number; seed: number; span: (y: number) => [number, number] }
/** One frame's pieces for the renderer to sort; null: nothing of it this frame. */
export interface BurnParts { sitter: (() => void) | null; pile: (() => void) | null; glow: (() => void) | null; over: (() => void) | null; label: boolean }

/** A map baked once, each letter in its ink, '.' clear; `top` clear rows above it. */
function bakeMap(rows: string[], ink: Record<string, string>, top = 0): HTMLCanvasElement {
  const c = mk(rows[0].length, top + rows.length), g = c.getContext('2d')!;
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ink[ch]) { g.fillStyle = ink[ch]; g.fillRect(x, top + y, 1, 1); } }));
  return c;
}
const tone = ([B, S, K]: [string, string, string]) => ({ B, S, K });
let baked: { sit: HTMLCanvasElement[]; pile: HTMLCanvasElement[]; ash: HTMLCanvasElement } | null = null;
const maps = () => baked ??= {
  sit: [false, true].map(b => bakeMap(sitterRows(b), tone(BONE[0]), 6)),   // front, back; 16×32 like a character cell
  pile: BONE.map(t => bakeMap(PILE, tone(t))),
  ash: bakeMap(ASH, ASH_INK),
};

/** The filled px of a sheet's 16×32 cell (row-major), read once per sheet and cell. */
const masks = new Map<CanvasImageSource, Map<string, Uint8Array>>();
function maskOf(sheet: CanvasImageSource, col: number, row: number): Uint8Array {
  const m = masks.get(sheet) ?? new Map<string, Uint8Array>(), key = `${col},${row}`;
  masks.set(sheet, m);
  let v = m.get(key);
  if (!v) {
    const g = mk(16, 32).getContext('2d', { willReadFrequently: true })!;
    g.drawImage(sheet, col * 16, row * 32, 16, 32, 0, 0, 16, 32);
    const d = g.getImageData(0, 0, 16, 32).data;
    v = new Uint8Array(16 * 32).map((_, i) => d[i * 4 + 3] > 0 ? 1 : 0);
    m.set(key, v);
  }
  return v;
}

export function burnParts(g: CanvasRenderingContext2D, s: BurnSpot, t: number, now: number): BurnParts {
  const f = burnPhase(t);
  if (!f) return { sitter: null, pile: null, glow: null, over: null, label: false };
  const x = Math.round(s.x), y = Math.round(s.y), fl = Math.round(s.fl);
  const sitter = f.bones > 0 ? () => {
    const x0 = x - 8 + f.shake, y0 = y - 32 + Math.round(f.fall * s.drop), r = f.bones;
    g.drawImage(maps().sit[s.back ? 1 : 0], 0, 0, 16, r, x0, y0, 16, r);
    if (r >= 32) return;
    g.globalAlpha = s.alpha;
    g.drawImage(s.sheet, s.col * 16, s.row * 32 + r, 16, 32 - r, x0, y0 + r, 16, 32 - r);
    g.globalAlpha = 1;
    const m = maskOf(s.sheet, s.col, s.row);
    for (let c = 0; c < 16; c++) if (m[r * 16 + c]) px(g, '#fff3b0', x0 + c, y0 + r, 1, 1);   // the turning edge
  } : null;
  const dust = f.dust, piled = f.pile !== null || f.ash > 0 || dust !== null || f.ember;
  const pile = piled ? () => {
    if (f.pile !== null) g.drawImage(maps().pile[f.pile], x - 8, fl - 7 - f.bounce);
    if (f.ash > 0) g.drawImage(maps().ash, 0, 3 - f.ash, 12, f.ash, x - 6, fl + 1 - f.ash, 12, f.ash);   // its bottom rows on fl
    if (dust) {
      g.globalAlpha = dust.a;
      for (const dx of [x - 9 - dust.d, x + 8 + dust.d]) for (const dy of [fl - 1, fl - 3]) px(g, '#8d939b', dx, dy, 1, 1);
      g.globalAlpha = 1;
    }
    if (f.ember) { px(g, '#ff7a1a', x - 2, fl - 1, 1, 1); px(g, '#ff7a1a', x + 3, fl - 2, 1, 1); }
  } : null;
  const glow = f.flame > 0 ? () => fireGlow(g, x, fl + 1, now, s.seed, s.span, f.flame) : null;
  const over = f.flame > 0 || f.smoke > 0 || f.motes.length ? () => {
    if (f.flame > 0) fire(g, x, fl - 2, now, s.seed, f.flame);
    if (f.smoke > 0) smoke(g, x, fl - 4, f.smoke, now);
    for (const m of f.motes) { g.globalAlpha = m.a; px(g, m.dark ? ASH_INK.a : ASH_INK.A, x + m.x, fl - 2 + m.y, 1, 1); }
    g.globalAlpha = 1;
  } : null;
  return { sitter, pile, glow, over, label: f.label };
}
