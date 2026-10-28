import { mainWallDecor } from '../../logic/corner.ts';
import { ICON, ICON_INK, type Product } from '../../logic/courier-art.ts';
import { decorKey, placeDecor, type Piece } from '../../logic/decor.ts';
import { CAFE_DX, regionAt, TILE, type Layout, type RoomId } from '../../logic/layout.ts';
import { libraryWallDecor } from '../../logic/lights.ts';
import type { Theme } from '../../logic/scene.ts';

// pixel-agents sprites and the flat office's baked background.
const NAMES = ['char_0', 'char_1', 'char_2', 'char_3', 'char_4', 'char_5', 'DESK_FRONT', 'PC_FRONT_OFF', 'PC_FRONT_ON_1', 'PC_FRONT_ON_2', 'PC_FRONT_ON_3',
  'PC_BACK', 'WOODEN_CHAIR_BACK', 'WOODEN_CHAIR_FRONT', 'BOOKSHELF', 'DOUBLE_BOOKSHELF', 'WHITEBOARD', 'CLOCK', 'LARGE_PAINTING', 'SMALL_PAINTING', 'HANGING_PLANT',
  'PLANT', 'LARGE_PLANT', 'SOFA_FRONT', 'SOFA_BACK', 'SOFA_SIDE', 'COFFEE_TABLE', 'COFFEE', 'CUSHIONED_BENCH', 'WOODEN_BENCH', 'BIN', 'wall_0', 'floor_1', 'floor_3', 'floor_6',
  'floor_2', 'floor_4', 'SMALL_PAINTING_2', 'SMALL_TABLE_FRONT'];

const IMG = new Map<string, HTMLImageElement>();
for (const n of NAMES) { const i = new Image(); i.src = `/pixel-agents/${n}.png`; IMG.set(n, i); }

export const img = (n: string): HTMLImageElement => IMG.get(n)!;
/** Every sprite decoded: until then the office draws nothing (a frame or two). */
export const ready = (): boolean => NAMES.every(n => { const i = IMG.get(n)!; return i.complete && i.naturalWidth > 0; });

export const spr = (g: CanvasRenderingContext2D, n: string, x: number, y: number) => g.drawImage(img(n), Math.round(x), Math.round(y));
/** A sprite's size (mainWallDecor's, windowGlass's `size`). */
export const size = (n: string) => ({ w: img(n).width, h: img(n).height });
export const px = (g: CanvasRenderingContext2D, c: string, x: number, y: number, w: number, h: number) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };

export const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/** Multiply a sprite (or a cell of it) by `color`, keeping its alpha. */
export function tint(i: HTMLImageElement, color: string, sx = 0, sy = 0, w = i.width, h = i.height): HTMLCanvasElement {
  const c = mk(w, h), g = c.getContext('2d')!;
  g.drawImage(i, sx, sy, w, h, 0, 0, w, h);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = color; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in'; g.drawImage(i, sx, sy, w, h, 0, 0, w, h);
  return c;
}

const medics: HTMLCanvasElement[] = [];
/** A character sheet in a white uniform with a red cross, from char_1 / char_3. Call only when `ready()`. */
export function medicSheet(k: 0 | 1): HTMLCanvasElement {
  return medics[k] ??= (() => {
    const c = mk(112, 96), g = c.getContext('2d')!;
    g.drawImage(img(k ? 'char_3' : 'char_1'), 0, 0);
    g.globalCompositeOperation = 'source-atop';
    for (let r = 0; r < 3; r++) {
      g.fillStyle = 'rgba(248,250,255,.82)'; g.fillRect(0, r * 32 + 15, 112, 17);
      g.fillStyle = '#e5383b';
      for (let i = 0; i < 7; i++) { g.fillRect(i * 16 + 7, r * 32 + 18, 2, 6); g.fillRect(i * 16 + 5, r * 32 + 20, 6, 2); }
    }
    return c;
  })();
}

const firemen: HTMLCanvasElement[] = [];
/** Server-fire 5.4: a character sheet (char_0, 3, 2) as a firefighter: a yellow helmet over the hair's top rows with a
 *  brim under it, a red coat with two reflective stripes, dark trousers. Call only when `ready()`. */
export function fireSheet(k: number): HTMLCanvasElement {
  return firemen[k] ??= (() => {
    const c = mk(112, 96), g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img(['char_0', 'char_3', 'char_2'][k]), 0, 0);
    g.globalCompositeOperation = 'source-atop';
    for (let r = 0; r < 3; r++) {
      const y = r * 32;
      g.fillStyle = '#f2c230'; g.fillRect(0, y, 112, 10);                     // helmet
      g.fillStyle = '#ffe27a'; g.fillRect(0, y + 3, 112, 2);                  // its shine
      g.fillStyle = 'rgba(200,28,28,.9)'; g.fillRect(0, y + 18, 112, 7);     // coat
      g.fillStyle = '#ffe14d'; g.fillRect(0, y + 20, 112, 1); g.fillRect(0, y + 23, 112, 1);   // reflective stripes
      g.fillStyle = 'rgba(28,32,46,.85)'; g.fillRect(0, y + 25, 112, 6);     // trousers, boots
    }
    g.globalCompositeOperation = 'source-over';
    // the brim: one row under the helmet, a px past the head either side (front, back), forward on the side view
    const d = g.getImageData(0, 0, 112, 96).data;
    g.fillStyle = '#b8860b';
    for (let r = 0; r < 3; r++) for (let col = 0; col < 7; col++) {
      let x0 = 16, x1 = -1;
      for (let x = 0; x < 16; x++) if (d[((r * 32 + 9) * 112 + col * 16 + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
      if (x1 >= 0) g.fillRect(col * 16 + x0 - (r === 2 ? 0 : 1), r * 32 + 10, x1 - x0 + 3, 1);
    }
    return c;
  })();
}

/** Wall auto-tile: neighbour bits up 1, right 2, down 4, left 8 pick one of wall_0's 16 pieces (16×32). */
export const wallMask = (walls: { has(k: string): boolean }, c: number, r: number): number => {
  const on = (c: number, r: number) => walls.has(`${c},${r}`);
  return (on(c, r - 1) ? 1 : 0) | (on(c + 1, r) ? 2 : 0) | (on(c, r + 1) ? 4 : 0) | (on(c - 1, r) ? 8 : 0);
};

/** The themed rooms keep their own look on every floor: floor sprite, its tint, wall colour. */
export const ROOM_LOOK: Record<Exclude<RoomId, 'main'>, { floor: string; tint: string; wall: string }> = {
  server: { floor: 'floor_2', tint: '#7b879c', wall: '#66738c' },
  library: { floor: 'floor_4', tint: '#9a6a48', wall: '#b08a68' },
  wait: { floor: 'floor_1', tint: '#6f8fb3', wall: '#8b96bd' },
  done: { floor: 'floor_3', tint: '#a7799c', wall: '#8b96bd' },
  hall: { floor: 'floor_2', tint: '#8f8a99', wall: '#8b96bd' },
};
/** A wall cell's colour: the floor theme's in the main office, the owner room's own elsewhere. */
export const wallColor = (theme: Theme, id: RoomId): string => id === 'main' ? theme.wall : ROOM_LOOK[id].wall;

const pieces = new Map<string, HTMLCanvasElement[]>();
export function wallPieces(color: string): HTMLCanvasElement[] {
  let p = pieces.get(color);
  if (!p) pieces.set(color, p = Array.from({ length: 16 }, (_, i) => tint(img('wall_0'), color, (i % 4) * 16, Math.floor(i / 4) * 32, 16, 32)));
  return p;
}

/** pixel-agents has no door: 16×28 frames closed → half → open, hinge on the left. */
export const DOOR_FRAMES: HTMLCanvasElement[] = [0, 1, 2].map(k => {
  const c = mk(16, 28), g = c.getContext('2d')!;
  g.fillStyle = '#2a1d14'; g.fillRect(0, 0, 16, 28);           // frame
  g.fillStyle = '#100c09'; g.fillRect(1, 1, 14, 27);           // dark doorway behind the leaf
  const w = [14, 8, 3][k];
  g.fillStyle = '#3b2616'; g.fillRect(1, 1, w, 27);            // leaf outline
  g.fillStyle = ['#a8743f', '#8c5f34', '#6e4a2a'][k]; g.fillRect(2, 2, Math.max(1, w - 2), 25);
  if (k < 2) {
    g.fillStyle = 'rgba(0,0,0,.25)'; for (const x of (k ? [5] : [5, 10])) g.fillRect(x, 3, 1, 23);   // planks
    g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(2, 2, w - 2, 1);
    g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(3, 6, w - 4, 1); g.fillRect(3, 19, w - 4, 1);       // panels
    g.fillStyle = '#f2cc60'; g.fillRect(k ? w - 2 : 11, 14, 2, 2);                                   // knob
  }
  return c;
});

// a tiny pixel balloon round an 8×8 icon (at 2, 2): 12×12 with a 1 px outline, its tail on rows 12–13 at x 3–4
const BUB = ['.oooooooooo.', ...Array<string>(10).fill('owwwwwwwwwwo'), '.oowwoooooo.', '..owwo......', '...oo.......'];
const ICONS = {
  ghost: ['..kkkk..', '.kggggk.', 'kgeggegk', 'kgeggegk', 'kggggggk', 'kggggggk', 'kggggggk', 'kk.kk.kk'],
  zz: ['.....zzz', '......z.', '.....zzz', 'ZZZZZ...', '...Z....', '..Z.....', '.Z......', 'ZZZZZ...'],
};
const PAL: Record<string, string> = { o: '#1b1f2a', w: '#ffffff', k: '#5b6488', g: '#cdd5ee', e: '#1b1f2a', Z: '#3b63c4', z: '#7f9be6' };
const paint = (g: CanvasRenderingContext2D, rows: string[], x: number, y: number, pal = PAL) =>
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (pal[r[i]]) px(g, pal[r[i]], x + i, y + j, 1, 1); });
const bubbles = new Map<string, HTMLCanvasElement>();
/** The icon balloon (12×14) over a queued placeholder (a ghost), an abandoned agent (Zz) or by the foreman's head (a courier's product). */
export function iconBubble(name: keyof typeof ICONS | Product): HTMLCanvasElement {
  let c = bubbles.get(name);
  if (!c) {
    c = mk(12, 14); const g = c.getContext('2d')!; paint(g, BUB, 0, 0);
    if (name in ICONS) paint(g, ICONS[name as keyof typeof ICONS], 2, 2); else paint(g, ICON[name as Product], 2, 2, ICON_INK);
    bubbles.set(name, c);
  }
  return c;
}

// procedural top-wall pieces (window, vent)
function win(g: CanvasRenderingContext2D, x: number, w: number, lead: boolean) {
  const y = 5, h = 20;
  px(g, '#4a3b33', x, y, w, h); px(g, '#a9d8ff', x + 1, y + 1, w - 2, h - 2); px(g, '#d6efff', x + 1, y + 1, w - 2, 5);
  if (lead) for (let yy = y + 5; yy < y + h; yy += 5) px(g, '#4a3b33', x, yy, w, 1);
  else { px(g, '#4a3b33', x + (w >> 1), y, 1, h); px(g, '#4a3b33', x, y + (h >> 1), w, 1); }
  px(g, '#7a6656', x - 1, y + h, w + 2, 2);
}
function vent(g: CanvasRenderingContext2D, x: number) { px(g, '#2b3240', x, 8, 24, 12); for (let i = 0; i < 4; i++) px(g, '#151a24', x + 2, 10 + i * 2.5, 20, 1); }
/** Stores a per-layout cache entry, the oldest dropped past four: the grid follows the window, so the keys would pile
 *  up; four leaves room for a floor slide, which draws two floors (themes, maybe grids) at once. */
export function remember<V>(m: Map<string, V>, key: string, v: V): void {
  if (m.size >= 4) m.delete(m.keys().next().value!);
  m.set(key, v);
}

const decors = new Map<string, Piece[]>();
/** The layout's decor, placed once per layout (logic/decor.ts placeDecor). */
export function decorOf(l: Layout): Piece[] {
  let d = decors.get(decorKey(l));
  if (!d) remember(decors, decorKey(l), d = placeDecor(l));
  return d;
}
const RUG: Record<string, [string, string, string]> = { rugWait: ['#2f4a6b', '#3f6b96', '#8fb6da'] };
/** A rug on the floor: an edge, a field, a faint inner line and a dot pattern. */
export function decorRug(g: CanvasRenderingContext2D, p: Piece): void {
  const [b, f, d] = RUG[p.name], w = p.x1 - p.x0, h = p.y1 - p.y0;
  px(g, b, p.x0, p.y0, w, h); px(g, f, p.x0 + 2, p.y0 + 2, w - 4, h - 4);
  g.globalAlpha = 0.5; g.strokeStyle = d; g.lineWidth = 1; g.strokeRect(p.x0 + 4.5, p.y0 + 4.5, w - 9, h - 9); g.globalAlpha = 1;
  for (let y = p.y0 + 9; y < p.y1 - 8; y += 8) for (let x = p.x0 + 9 + ((y - p.y0) / 8 % 2) * 4; x < p.x1 - 8; x += 8) px(g, d, x, y, 1, 1);
}

const vents = new Map<string, number[]>();
/** The server room's vents on the top wall: each 24 px grille's left x (flat px), its bottom edge at y 20. Per layout. */
export function ventXs(l: Layout): number[] {
  let xs = vents.get(l.key);
  if (xs) return xs;
  const s = l.rooms.server;
  xs = [];
  for (let x = s.x0 + 10; x + 24 <= s.x1 - 16; x += 44) xs.push(x);
  remember(vents, l.key, xs);
  return xs;
}

const baked = new Map<string, HTMLCanvasElement>();
/** The static background: each room's floor, the corridor runner, the library rug, the top wall in its owners' colours
 *  and its decor (main office, server room, library). Call only when `ready()`. */
export function bake(l: Layout, theme: Theme): HTMLCanvasElement {
  const key = `${theme.work}${theme.wall}:${l.key}`;
  let c = baked.get(key);
  if (c) return c;
  c = mk(l.w, l.h);
  const g = c.getContext('2d')!, tiles = new Map<RoomId, HTMLCanvasElement>();
  const tile = (id: RoomId) => tiles.get(id) ?? tiles.set(id, id === 'main' ? tint(img('floor_6'), theme.work) : tint(img(ROOM_LOOK[id].floor), ROOM_LOOK[id].tint)).get(id)!;
  for (let r = 2; r < l.rows; r++) for (let c = 0; c < l.cols; c++) g.drawImage(tile(regionAt(l, c, r)), c * TILE, r * TILE);
  // the corridor runner, then the library rug around its desks
  const rx0 = l.rooms.hall.x0, ry = (l.k + 1) * TILE + 3, rh = 10;
  px(g, '#c9a24a', rx0, ry, l.w - rx0, rh); px(g, '#7d2f35', rx0, ry + 2, l.w - rx0, rh - 4);
  for (let x = rx0 + 4; x < l.w; x += 8) px(g, '#a8454d', x, ry + (rh >> 1) - 1, 2, 2);
  const lib = l.rooms.library, ys = l.desks.filter(d => d.room === 'library').map(d => d.y);
  const x0 = lib.x0 + 6, x1 = lib.x1 - 22, y0 = Math.min(...ys) - 8, y1 = Math.max(...ys) + 52;
  px(g, '#c9a24a', x0, y0, x1 - x0, y1 - y0); px(g, '#5e2630', x0 + 2, y0 + 2, x1 - x0 - 4, y1 - y0 - 4);
  g.globalAlpha = 0.45; g.strokeStyle = '#c9a24a'; g.lineWidth = 1; g.strokeRect(x0 + 4.5, y0 + 4.5, x1 - x0 - 9, y1 - y0 - 9); g.globalAlpha = 1;
  for (const p of decorOf(l)) if (p.name === 'rugWait') decorRug(g, p);   // rugs bake with the floor
  for (let col = 0; col < l.cols; col++) g.drawImage(wallPieces(wallColor(theme, l.walls.get(`${col},1`)!))[wallMask(l.walls, col, 1)], col * TILE, 0);
  topDecor(g, l, { plants: false });   // flat's hanging plants sway, drawn every frame (hangingPlants)
  remember(baked, key, c);
  return c;
}

/** The top wall's decor in flat px (y 0..32): the main office's pieces that fit, the server room's vents and sign, the
 *  library's shelves and leaded windows. The iso style shears the same strip onto its back wall (its hanging plants
 *  still); `plants: false` leaves them out (flat sways them). Call only when `ready()`. */
export function topDecor(g: CanvasRenderingContext2D, l: Layout, o = { plants: true }) {
  // the main office's pieces that fit, then a window and a hanging plant by turns every 40 px, clear of the clock
  for (const p of mainWallDecor(l, size)) {
    if (p.name === 'win') win(g, p.x, 22, false);
    else if (o.plants || p.name !== 'HANGING_PLANT') spr(g, p.name, p.x, p.y);
  }
  // server room: a dark strip, a vent every 44 px, a warning sign top right
  const s = l.rooms.server;
  px(g, '#2a2f3a', s.x0, 27, s.x1 - s.x0, 2);
  for (const x of ventXs(l)) vent(g, x);
  px(g, '#f2cc60', s.x1 - 14, 9, 8, 8); px(g, '#1b1f2a', s.x1 - 11, 10, 2, 4); px(g, '#1b1f2a', s.x1 - 11, 15, 2, 1);
  // library: double bookshelves, every third place a leaded window
  for (const p of libraryWallDecor(l)) p.name === 'lead' ? win(g, p.x, 12, true) : spr(g, 'DOUBLE_BOOKSHELF', p.x, 2);
}

const strips = new Map<string, [HTMLCanvasElement, HTMLCanvasElement]>();
/** The corridor walls' faces (rows k and k + 3) seen from the corridor and from the lower rooms: 32 px decor strips
 *  drawn at rows k − 1 and k + 2, clear of the doors and their signs. Call only when `ready()`. */
export function wallStrips(l: Layout): [HTMLCanvasElement, HTMLCanvasElement] {
  let s = strips.get(l.key);
  if (s) return s;
  s = [mk(l.w, 32), mk(l.w, 32)];
  const g = s[0].getContext('2d')!, h = s[1].getContext('2d')!, p = stripPieces(l);
  for (const [n, x] of p.hall) if (n !== 'HANGING_PLANT') spr(g, n, x, 0);   // the plants sway (hangingPlants)
  for (const [n, x] of p.low) if (n !== 'HANGING_PLANT') spr(h, n, x, 0);
  remember(strips, l.key, s);
  return s;
}
/** wallStrips' pieces, [sprite, x] on each strip. */
function stripPieces(l: Layout): { hall: [string, number][]; low: [string, number][] } {
  const { wait, done } = l.rooms, hall: [string, number][] = [];
  const doors = l.doors.filter(d => d.id === 'server' || d.id === 'library').map(d => d.x);
  for (let x = l.rooms.hall.x0 + 10, i = 0; x + 16 <= l.w - 4; x += 44) {
    if (!doors.some(d => x + 16 > d - 60 && x < d + 20)) hall.push([['SMALL_PAINTING', 'HANGING_PLANT', 'SMALL_PAINTING_2'][i++ % 3], x]);
  }
  const low: [string, number][] = [['SMALL_PAINTING', wait.x0 + 12], ['HANGING_PLANT', wait.x0 + 34]];
  // the Done lounge's wall holds the board and the café table by it (whose sitters' heads would cover a piece); the clock and then
  // the corridor's pieces at its spacing go on right of them, where there is room
  const t = l.cafes.find(c => c.y === done.y0 + 10)!;
  for (let x = t.x + CAFE_DX + 12, i = 0; x + 16 <= done.x1 - 4; x += 44) low.push([['CLOCK', 'SMALL_PAINTING_2', 'HANGING_PLANT', 'SMALL_PAINTING'][i < 1 ? i++ : 1 + (i++ - 1) % 3], x]);
  return { hall, low };
}
/** The Done lounge's wall clock's x on the lower strip (flat draws its hands), or null where it has no room. */
export const doneClockX = (l: Layout): number | null => stripPieces(l).low.find(([n]) => n === 'CLOCK')?.[1] ?? null;

const plants = new Map<string, { top: number[]; hall: number[]; low: number[] }>();
/** The x of each HANGING_PLANT flat leaves out of its baked wall and strips, drawn swaying every
 *  frame: on the top wall (y 0), the corridor strip and the lower one. Per layout. Call only when `ready()`. */
export function hangingPlants(l: Layout): { top: number[]; hall: number[]; low: number[] } {
  let h = plants.get(l.key);
  if (h) return h;
  const p = stripPieces(l), xs = (a: [string, number][]) => a.filter(([n]) => n === 'HANGING_PLANT').map(([, x]) => x);
  h = { top: mainWallDecor(l, size).filter(q => q.name === 'HANGING_PLANT').map(q => q.x), hall: xs(p.hall), low: xs(p.low) };
  remember(plants, l.key, h);
  return h;
}
