import { BAG, BAG_INK, COURIER_SHEET, HAT_INK, HEAD_TOP, hatRows, LETTER, LETTER_INK, SEAL, type Company, type Product, type View } from '../../logic/courier-art.ts';
import type { Dir } from '../../logic/scene.ts';
import { drawChar } from './flat.ts';
import { img, px } from './sprites.ts';

// The couriers: a char sheet with its satchel and cap, and the letter; one drawing for both styles.
const ROW: Record<Dir, 0 | 1 | 2> = { down: 0, up: 1, right: 2, left: 2 };
const VIEW: View[] = ['front', 'back', 'side'];

/** Paints a pixel map, its top-left at (x, y); `flip` mirrors each row within its own width. */
function paintRows(g: CanvasRenderingContext2D, rows: string[], x: number, y: number, ink: Record<string, string>, flip: boolean) {
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (ink[r[i]]) px(g, ink[r[i]], x + (flip ? r.length - 1 - i : i), y + j, 1, 1); });
}

/** A courier, feet at (x, y) on screen, seen in screen direction `dir` (iso: after ISO_DIR), sheet column `col`. */
export function drawCourier(g: CanvasRenderingContext2D, co: Company, x: number, y: number, dir: Dir, col: number): void {
  const row = ROW[dir], view = VIEW[row], flip = dir === 'left', sx = Math.round(x) - 8, sy = Math.round(y) - 32;
  drawChar(g, img(`char_${COURIER_SHEET[co]}`), col, row, x, y, flip, 1);
  const b = BAG[view], ink = BAG_INK[co], w = b.bag[0].length;
  for (const [i, j] of b.strap) px(g, ink.S, sx + (flip ? 15 - i : i), sy + j, 1, 1);
  paintRows(g, b.bag, flip ? sx + 16 - b.at[0] - w : sx + b.at[0], sy + b.at[1], ink, flip);
  paintRows(g, hatRows(co, view), sx, sy + HEAD_TOP[row][Math.min(col, 2)] - 5, HAT_INK[co], flip);
}

/** The letter's top-left at (x, y), its seal in the product's colour. */
export function drawLetter(g: CanvasRenderingContext2D, x: number, y: number, product: Product): void {
  paintRows(g, LETTER, Math.round(x), Math.round(y), { ...LETTER_INK, s: SEAL[product] }, false);
}

/** Where the letter sits in a courier's hand: its top-left from the feet. */
export const handAt = (x: number, y: number, flip: boolean): [number, number] => [Math.round(x) + (flip ? -10 : 2), Math.round(y) - 15];
