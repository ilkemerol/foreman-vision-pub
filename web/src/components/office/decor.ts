// Office decor drawing: the flat decor pieces, the working desk's props and the
// seated agents' idle frames.
import type { AgentView } from '../../../../shared/types.ts';
import { deskProps, foremanMug, type Piece } from '../../logic/decor.ts';
import type { IdleAct } from '../../logic/idle.ts';
import type { Layout } from '../../logic/layout.ts';
import type { Place } from '../../logic/scene.ts';
import { img, mk, px, spr } from './sprites.ts';

type G = CanvasRenderingContext2D;

/** A standing decor piece at its box's top-left corner; `lit`: a floor lamp's shade glows. */
export function drawPiece(g: G, p: Pick<Piece, 'name' | 'x0' | 'y0'>, lit = false): void {
  const x = p.x0, y = p.y0;
  switch (p.name) {
    case 'cooler':
      px(g, '#2b3446', x + 2, y, 8, 11); px(g, '#79c2ec', x + 3, y + 1, 6, 9); px(g, '#4a90c8', x + 3, y + 7, 6, 3); px(g, '#c6ecff', x + 4, y + 2, 1, 5); px(g, '#3b6ea8', x + 4, y, 4, 1);
      px(g, '#3a4152', x, y + 10, 12, 14); px(g, '#e8ecf2', x + 1, y + 11, 10, 12); px(g, '#c2c8d3', x + 9, y + 11, 2, 12);
      px(g, '#2b3240', x + 3, y + 13, 6, 4); px(g, '#e5383b', x + 4, y + 14, 1, 2); px(g, '#3b82f6', x + 7, y + 14, 1, 2); px(g, '#8b93a7', x + 3, y + 18, 6, 1);
      px(g, '#1f2430', x + 1, y + 23, 10, 1); break;
    case 'printer':
      px(g, '#3b2616', x, y + 10, 20, 11); px(g, '#6e4a2a', x + 1, y + 11, 18, 9); px(g, '#3b2616', x + 1, y + 15, 18, 1); px(g, '#c9a24a', x + 9, y + 13, 2, 1); px(g, '#c9a24a', x + 9, y + 17, 2, 1);
      px(g, '#3a3f4b', x + 1, y + 2, 18, 9); px(g, '#d5d9e1', x + 2, y + 3, 16, 6); px(g, '#aeb4c0', x + 2, y + 8, 16, 2); px(g, '#1f2430', x + 4, y + 5, 10, 1);
      px(g, '#ffffff', x + 5, y, 8, 4); px(g, '#c9ced8', x + 6, y + 1, 6, 1); px(g, '#39d353', x + 15, y + 4, 1, 1); break;
    case 'extinguisher':
      px(g, '#1b1f2a', x + 1, y, 3, 2); px(g, '#1b1f2a', x + 3, y + 1, 3, 1); px(g, '#7a1010', x, y + 2, 6, 11); px(g, '#e5383b', x + 1, y + 3, 4, 9); px(g, '#ff8a8a', x + 1, y + 4, 1, 6); px(g, '#f1f3f5', x + 1, y + 7, 4, 1); break;
    case 'armchair':
      px(g, '#3a1418', x + 2, y, 14, 12); px(g, '#8d2f3a', x + 3, y + 1, 12, 9); px(g, '#a8454d', x + 4, y + 2, 10, 1);
      px(g, '#3a1418', x, y + 6, 18, 10); px(g, '#7d2f35', x + 1, y + 7, 3, 8); px(g, '#7d2f35', x + 14, y + 7, 3, 8); px(g, '#a8454d', x + 4, y + 9, 10, 5); px(g, '#c35d66', x + 4, y + 9, 10, 1);
      px(g, '#2a1d14', x + 2, y + 16, 2, 2); px(g, '#2a1d14', x + 14, y + 16, 2, 2); break;
    case 'lamp':
      px(g, '#6b4a1a', x, y + 1, 8, 7); px(g, lit ? '#ffe9a8' : '#f2cc60', x + 1, y + 2, 6, 5); px(g, '#fff3b0', x + 2, y + 2, 4, 1); px(g, '#6b4a1a', x + 1, y, 6, 1);
      px(g, '#8a6d2c', x + 3, y + 8, 2, 18); px(g, '#c9a24a', x + 3, y + 8, 1, 18); px(g, '#4a3b1c', x + 1, y + 26, 6, 2); break;
    case 'sidetable':
      px(g, '#3b82f6', x + 2, y, 6, 2); px(g, '#e5383b', x + 1, y + 2, 7, 2); px(g, '#3b2616', x, y + 4, 10, 3); px(g, '#a8743f', x + 1, y + 4, 8, 2);
      px(g, '#3b2616', x + 4, y + 7, 2, 4); px(g, '#3b2616', x + 2, y + 11, 6, 1); break;
    case 'shelf': spr(g, 'DOUBLE_BOOKSHELF', x, y); break;
    case 'pot':
      px(g, '#1d4d25', x + 1, y, 8, 9); px(g, '#2f7d3a', x + 2, y + 1, 6, 7); px(g, '#57b85f', x + 3, y + 1, 2, 3); px(g, '#3c9a48', x + 5, y + 4, 2, 3); px(g, '#1d4d25', x, y + 3, 2, 4); px(g, '#1d4d25', x + 8, y + 2, 2, 4);
      px(g, '#5a2d16', x + 1, y + 9, 8, 7); px(g, '#d27a4a', x + 2, y + 9, 6, 6); px(g, '#e8955f', x + 2, y + 9, 6, 1); px(g, '#b05a34', x + 6, y + 10, 2, 5); break;
    case 'lowtable':
      px(g, '#3b2616', x, y + 3, 28, 6); px(g, '#a8743f', x + 1, y + 4, 26, 4); px(g, '#c58d52', x + 1, y + 4, 26, 1);
      px(g, '#3b2616', x + 2, y + 9, 2, 5); px(g, '#3b2616', x + 24, y + 9, 2, 5);
      px(g, '#79c0ff', x + 5, y + 1, 7, 4); px(g, '#f1f3f5', x + 6, y + 2, 5, 1); px(g, '#ff9ecf', x + 15, y + 2, 8, 3); px(g, '#1b1f2a', x + 16, y + 3, 4, 1); break;
  }
}

/** A mug on a desk top, its 6×6 outline's top-left at (x, y), the handle on its right. */
function mugAt(g: G, x: number, y: number): void {
  px(g, '#3a4152', x, y, 6, 6); px(g, '#f1f3f5', x + 1, y + 1, 4, 4); px(g, '#6b4423', x + 1, y + 1, 4, 1);
  px(g, '#3a4152', x + 5, y + 2, 2, 2); px(g, '#f1f3f5', x + 5, y + 3, 1, 1);
}
/** A working desk's papers and mug (logic/decor.ts deskProps); the mug leaves the desk while it is sipped. */
export function drawProps(g: G, d: { cx: number; y: number }, sipping: boolean): void {
  const { papers: p, mug: m } = deskProps(d);
  px(g, '#d8dde6', p.x0, p.y0 + 1, 8, 4); px(g, '#ffffff', p.x0 + 1, p.y0, 8, 4); px(g, '#aab2c2', p.x0 + 2, p.y0 + 1, 5, 1); px(g, '#aab2c2', p.x0 + 2, p.y0 + 3, 4, 1);
  if (!sipping) mugAt(g, m.x0, m.y0);
}
/** The foreman's mug in front of its monitor (logic/decor.ts foremanMug). */
export function drawForemanMug(g: G, l: Layout, sipping: boolean): void {
  if (!sipping) { const m = foremanMug(l); mugAt(g, m.x0, m.y0); }
}

// per sheet: shirt, its outline, skin (read off the PNGs: back still frame (7,20), (3,18); front (6,13))
const SHEET = [['#114978', '#071c2e', '#e9a384'], ['#252525', '#7e4b29', '#e9a384'], ['#f67d20', '#56110e', '#5f4132'],
  ['#d4d4d4', '#4c4c4c', '#b67352'], ['#d4d4d4', '#4c4c4c', '#e9a384'], ['#b24737', '#640026', '#fcd6c4']];
// a 16×40 frame: the 16×32 cell 8 px down, so raised arms may reach over the head (rows from the frame's top)
const ARMS_UP = ['....ohho.ohho...', '....ohho.ohho...', '....osso.osso...', '...osso...osso..', '...oso.....oso..', '..osso.....osso.', '..oso.......oso.', '.osso.......osso', '.oso.........oso', '.oso.........oso'];
const SIP_ARM = ['owwwwo', 'owwwwwo', 'owwwwo', '.ohho.', '.oso..', '.oso..', '.oso..', '..oso.', '..oso.', '..oso.', '...oso'];
interface Frames { stretchBack: HTMLCanvasElement; stretchFront: HTMLCanvasElement; sipBack: HTMLCanvasElement }
const frames: Frames[] = [];
/** Sheet k's idle frames (16×40), built once. Call only when `ready()`. */
function idleFrames(k: number): Frames {
  return frames[k] ??= (() => {
    const [shirt, edge, skin] = SHEET[k], pal: Record<string, string> = { o: edge, s: shirt, h: skin, w: '#f1f3f5' };
    const paint = (g: G, rows: string[], x: number, y: number) => rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (pal[r[i]]) px(g, pal[r[i]], x + i, y + j, 1, 1); });
    const one = (row: number, up: number, map: (g: G) => void) => { const c = mk(16, 40), g = c.getContext('2d')!; g.drawImage(img(`char_${k}`), 16, row * 32, 16, 32, 0, 8 - up, 16, 32); map(g); return c; };
    return {
      // arms up over the head, sitting up 1 px: the hands at the sides are cleared, the arms drawn in the sheet's colours
      stretchBack: one(1, 1, g => { g.clearRect(0, 26, 4, 8); g.clearRect(12, 26, 4, 8); paint(g, ARMS_UP, 0, 1); }),
      stretchFront: one(0, 1, g => { g.clearRect(0, 25, 3, 9); g.clearRect(13, 25, 3, 9); paint(g, ARMS_UP, 0, 1); }),
      // back: the right hand brings the mug up beside the head
      sipBack: one(1, 0, g => { g.clearRect(12, 27, 4, 7); paint(g, SIP_ARM, 10, 15); px(g, '#6b4423', 11, 15, 4, 1); }),
    };
  })();
}

export type IdleRole = 'worker' | 'foreman' | 'foremanBusy';
/** Who may move idly: a running agent seated at its desk; the foreman unless it waits, is on a visit
 *  to the gauge box or reads a courier's letter (running: stretch and sip only). Nobody else. */
export function idleRole(p: Place, a: AgentView, visiting: boolean, reading: boolean): IdleRole | null {
  if (p.kind === 'desk') return a.stage === 'running' ? 'worker' : null;
  if (p.kind !== 'foreman' || visiting || reading || a.stage === 'waiting') return null;
  return a.stage === 'running' ? 'foremanBusy' : 'foreman';
}

export interface Cell { src: CanvasImageSource; sx: number; sy: number; h: 32 | 40; flip: boolean }
/** A seated agent's cell: `back` at a desk (the worker), else facing out (the foreman); (col, row) when no act changes it.
 *  The foreman's sip keeps its cell: the caller draws flat.ts mug(…, true). Call only when `ready()`. */
export function seatedCell(sprite: number, back: boolean, col: number, row: number, act: IdleAct | null): Cell {
  const f = idleFrames(sprite), sheet = img(`char_${sprite}`), cell = (c: number, r: number, flip = false): Cell => ({ src: sheet, sx: c * 16, sy: r * 32, h: 32, flip });
  const idle = (src: HTMLCanvasElement): Cell => ({ src, sx: 0, sy: 0, h: 40, flip: false });
  if (back) {
    if (act?.kind === 'stretch') return idle(f.stretchBack);
    if (act?.kind === 'sip') return idle(f.sipBack);
    if (act?.kind === 'pause') return cell(1, 1);
    return cell(col, row);
  }
  if (act?.kind === 'stretch') return idle(f.stretchFront);
  if (act?.kind === 'lookL' || act?.kind === 'lookR') return cell(1, 2, act.kind === 'lookL');
  return cell(col, row);
}
/** flat.ts drawChar for a Cell: feet at (fx, fy); a 40 px cell rises 8 px, its raised arms over the head. */
export function drawCell(g: G, c: Cell, fx: number, fy: number, alpha: number): void {
  const x = Math.round(fx - 8), y = Math.round(fy - 32) - (c.h - 32);
  g.globalAlpha = alpha;
  if (c.flip) { g.save(); g.translate(x + 16, y); g.scale(-1, 1); g.drawImage(c.src, c.sx, c.sy, 16, c.h, 0, 0, 16, c.h); g.restore(); }
  else g.drawImage(c.src, c.sx, c.sy, 16, c.h, x, y, 16, c.h);
  g.globalAlpha = 1;
}
