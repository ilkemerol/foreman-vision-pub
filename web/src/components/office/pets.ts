// Smooth and the cleaning robot: pixel grids drawn in code (the cat a dark tabby).
import type { CatPose, HeartDraw } from '../../logic/cat.ts';
import type { Pt, Rect } from '../../logic/layout.ts';
import { chargeLit, type Charge } from '../../logic/robot.ts';
import type { Label } from './renderer.ts';

export const CAT_NAME = 'Smooth', CAT_COLOR = '#ff9ecf';

const CAT = {
  // side view, facing right; two walk frames. h: the lit top edge, s: the near-black tabby stripes, d/s: the tail's rings
  walk: [[
    '..........h..h',
    '..........hshh',
    's.........bbeb',
    'd.........sbbp',
    's.hhshhshhbbw.',
    '.dbsbsbsbsbbb.',
    '..sbsbsbbsbb..',
    '..b.b....b.b..',
    '..s.s....s.s..',
  ], [
    '..........h..h',
    '..........hshh',
    '.s........bbeb',
    'd.........sbbp',
    's.hhshhshhbbw.',
    '.dbsbsbsbsbbb.',
    '..sbsbsbbsbb..',
    '...bb....bb...',
    '...ss....ss...',
  ]],
  // front view, sitting, the forehead's M over the eyes; the tail sways between the two
  sit: [[
    '.h.....h.',
    '.hh...hh.',
    '.hsbsbsh.',
    '.bebsbeb.',
    '.sbbpbbs.',
    '..bbwbb..',
    '..bsbsb..',
    '.sbbsbbsd',
    '.bsbbbsbs',
    '.bsb.bsbd',
  ], [
    '.h.....h.',
    '.hh...hh.',
    '.hsbsbsh.',
    '.bebsbeb.',
    '.sbbpbbs.',
    '..bbwbb.d',
    '..bsbsb.s',
    '.sbbsbbsd',
    '.bsbbbsb.',
    '.bsb.bsb.',
  ]],
  // curled up asleep, side view; the tail wraps round her in rings
  loaf: [
    '........h..h',
    '..hhshhshhsh',
    '.bsbsbsbsbcb',
    'sbbsbbsbbbbb',
    'dbsbbsbbsbw.',
    '.sdsdsdsd...',
  ],
};
// a dark classic tabby: brown-grey with near-black stripes, amber eyes, only a tan muzzle;
// the lit top edge (h) and the 1 px outline keep her apart from the dark server and corridor floors
const CAT_PAL: Record<string, string> = { b: '#5b4a3c', h: '#857058', s: '#1f1813', d: '#5b4a3c', w: '#b49a7e', e: '#f2b632', p: '#d98c8c', c: '#1f1813', o: '#0e0b09' };

// a round floor robot, seen from the front and a little above; brush bristles 'y' turn while it drives
const ROBOT_A = [[
  '....hhhhhh....',
  '..hhhhhhhhhh..',
  '.hhhhhLhhhhhh.',
  'mmmmmmmmmmmmmm',
  'kmmmmmmmmmmmmk',
  'y.kkkkkkkkkk.y',
], [
  '....hhhhhh....',
  '..hhhhhhhhhh..',
  '.hhhhhLhhhhhh.',
  'mmmmmmmmmmmmmm',
  'kmmmmmmmmmmmmk',
  '.ykkkkkkkkkky.',
]];
const ROBOT_PAL = { h: '#d9dee8', m: '#7d8597', k: '#3a3f4b', y: '#f2c14e', o: '#1c1f27' };

const cache = new Map<string, HTMLCanvasElement>();
/** A fill grid with a 1 px outline around it (4-neighbour), drawn once into a canvas; `pal` maps grid letters to colours. */
export function sprite(key: string, grid: string[], pal: Record<string, string>): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) return hit;
  const w = grid[0].length + 2, h = grid.length + 2, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!, on = (x: number, y: number) => (grid[y - 1]?.[x - 1] ?? '.') !== '.';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (on(x, y)) { g.fillStyle = pal[grid[y - 1][x - 1]]; g.fillRect(x, y, 1, 1); }
    else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) { g.fillStyle = pal.o; g.fillRect(x, y, 1, 1); }
  }
  cache.set(key, c);
  return c;
}

/** (x, y): the feet point, the sprite's bottom centre; `flip` mirrors it (facing left). */
export function blit(g: CanvasRenderingContext2D, c: HTMLCanvasElement, x: number, y: number, flip: boolean) {
  const X = Math.round(x - c.width / 2), Y = Math.round(y - c.height + 1);
  if (!flip) { g.drawImage(c, X, Y); return; }
  g.save(); g.translate(X + c.width, Y); g.scale(-1, 1); g.drawImage(c, 0, 0); g.restore();
}

/** Smooth at her feet point (x, y); `flip`: facing left (the sitting cat faces front and never flips). */
export function drawCat(g: CanvasRenderingContext2D, pose: CatPose, x: number, y: number, now: number, flip: boolean): void {
  if (pose === 'walk' || pose === 'run') {
    const f = Math.floor(now / (pose === 'run' ? 80 : 150)) % 2;
    blit(g, sprite(`catw${f}`, CAT.walk[f], CAT_PAL), x, y, flip);
  } else if (pose === 'loaf') blit(g, sprite('catl', CAT.loaf, CAT_PAL), x, y, flip);
  else {
    const f = pose === 'startle' ? 0 : Math.floor(now / 650) % 2, up = pose === 'startle' ? 3 : 0;
    blit(g, sprite(`cats${f}`, CAT.sit[f], CAT_PAL), x, y - up, false);
    if (pose === 'startle') {   // a pixel "!" over the head (pixel art, not text)
      const X = Math.round(x), Y = Math.round(y);
      g.fillStyle = '#fff'; g.fillRect(X - 1, Y - 22, 3, 6); g.fillRect(X - 1, Y - 15, 3, 2);
      g.fillStyle = '#ff5d5d'; g.fillRect(X, Y - 21, 1, 4); g.fillRect(X, Y - 14, 1, 1);
    }
  }
}

// a pet's heart: pink with a light spot, outlined like the sprites
const HEART = ['.r.r.', 'rlrrr', 'rrrrr', '.rrr.', '..r..'];
const HEART_PAL = { r: '#ff5d8f', l: '#ffc2d6', o: '#5a1030' };
/** The hearts (logic/cat.ts heartsAt) over her head top (x, top): each its bottom there plus its offset, fading. */
export function drawHearts(g: CanvasRenderingContext2D, hearts: HeartDraw[], x: number, top: number): void {
  for (const h of hearts) {
    g.save(); g.globalAlpha = h.alpha;
    blit(g, sprite('heart', HEART, HEART_PAL), x + h.dx, top - 1 - h.up, false);
    g.restore();
  }
}

/** The robot at its feet point; out (touring): the brush turns and the LED blinks blue; docked: the LED green as the
 *  charger's (robot.ts chargeLit). */
export function drawRobot(g: CanvasRenderingContext2D, x: number, y: number, now: number, charge: Charge, calm: boolean): void {
  const moving = charge === 'out', f = moving ? Math.floor(now / 120) % 2 : 0;
  const led = moving ? (Math.floor(now / 250) % 2 ? '#5aa9ff' : '#1f4f9a') : chargeLit(charge, now, calm) ? '#7ee787' : '#2f7d3a';
  blit(g, sprite(`rob${f}${led}`, ROBOT_A[f], { ...ROBOT_PAL, L: led }), x, y, false);
}
/** The robot's LED pixel (ROBOT_A's L) for the robot drawn at feet point (x, y), for the night's cut-outs. */
export const robotLed = (x: number, y: number): Pt => ({ x: Math.round(x - 8) + 7, y: Math.round(y - 7) + 3 });

// the robot's wall charger: a lightning bolt on its panel, its LED (L) in the bottom edge
const CHARGER = [
  'cccccccccc',
  'cddddddddc',
  'cdddddYYdc',
  'cddddYYddc',
  'cdddYYYYdc',
  'cddddYYddc',
  'cdddYYdddc',
  'cdddYddddc',
  'cddddddddc',
  'ccccLLcccc',
];
// iso's: the bolt drawn so that sheared onto the wall (column pair i one px lower per i, iso.ts) it is flat's again
const CHARGER_ISO = [
  'cccccccccc',
  'cddddddddc',
  'cddddYYddc',
  'cddddYdddc',
  'cdddYYYddc',
  'cddYYYdddc',
  'cdddYddddc',
  'cddYYddddc',
  'cddYdddddc',
  'ccccLLcccc',
];
const CHARGER_PAL = { c: '#c9ced8', d: '#2b303b', Y: '#f2c14e', o: '#1c1f27' };
/** The LED's two pixels in the unit's canvas (outline included): left one at (x, y). */
export const CHARGER_LED = { x: 5, y: 10 };
/** The unit (12×12 with its outline): the LED off while the robot is out, blinking slowly while it charges, steady when
 *  full or when calm (prefers-reduced-motion). */
export function chargerUnit(charge: Charge, now: number, calm: boolean, iso = false): HTMLCanvasElement {
  const led = charge === 'out' ? '#1d3324' : chargeLit(charge, now, calm) ? '#7ee787' : '#2f7d3a';
  return sprite(`chg${+iso}${led}`, iso ? CHARGER_ISO : CHARGER, { ...CHARGER_PAL, L: led });
}
/** Flat: the unit on the corridor wall (robot.ts chargerOf, its bottom centre), its cable down the wall and along the
 *  dock's line to the floor plate the robot docks on (its contacts show while it is out). */
export function drawCharger(g: CanvasRenderingContext2D, dock: Pt, unit: Pt, charge: Charge, now: number, calm: boolean): void {
  const X = Math.round(dock.x), Y = Math.round(dock.y), ux = Math.round(unit.x), uy = Math.round(unit.y);
  g.fillStyle = '#1c1f27'; g.fillRect(ux + 4, uy, 1, Y - uy); g.fillRect(ux + 4, Y - 1, X - 10 - ux - 4, 1); g.fillRect(X - 10, Y - 3, 20, 5);
  g.fillStyle = '#4a5266'; g.fillRect(X - 9, Y - 2, 18, 3);
  g.fillStyle = '#f2c14e'; g.fillRect(X - 5, Y - 1, 2, 1); g.fillRect(X + 3, Y - 1, 2, 1);
  blit(g, chargerUnit(charge, now, calm), ux, uy, false);
}
/** Flat: the LED's pixels for the night's cut-outs. */
export const chargerLeds = (unit: Pt): Pt[] => [0, 1].map(i => ({ x: Math.round(unit.x) - 6 + CHARGER_LED.x + i, y: Math.round(unit.y) - 11 + CHARGER_LED.y }));

/** Smooth's name: the agents' tag (framed in her colour, overlay.ts), no pill; at rest or on a desk it is `own`, so the
 *  overlay moves it off signs, resting agents and earlier labels (logic/labels.ts shiftOff); she is in no `bodies`, so
 *  nobody's label moves for her. A name, not translated. */
export const catTag = (x: number, y: number, resting: boolean, above?: number): Extract<Label, { kind: 'tag' }> => ({
  kind: 'tag', key: 'cat', x, y, name: CAT_NAME, color: CAT_COLOR, pill: null, hot: null, failed: false,
  ...(resting ? { own: 'cat' } : {}), ...(above !== undefined ? { above } : {}),
});

// Smooth's bowls: 8×4 inside the outline — back rim, surface, front body, foot.
// Food: terracotta with kibble, full or half (never empty); water: white enamel, blue water. Drawn at their feet point.
const FOOD = {
  full: ['.kKkkKk.', 'wkKkkKkw', '.bbbbbb.', '..BBBB..'],
  half: ['.wwwwww.', 'wkKkkKkw', '.bbbbbb.', '..BBBB..'],
};
const FOOD_PAL = { w: '#ef9a74', b: '#cf5f3c', B: '#93402a', k: '#9a6430', K: '#5e3a17', o: '#1a1410' };
const WATER = ['.wwwwww.', 'wqqqqqqw', '.bbbbbb.', '..BBBB..'];
const WATER_PAL = { w: '#f2f5f9', b: '#c9d3df', B: '#8b97a8', q: '#3d8fd6', o: '#1a1410' };
const SHINE = '#d6f1ff', TONGUE = '#ff8fa8';
/** The mat's edge, field and inner line (flat 26×6; iso fills the same colours as a floor quad). */
export const MAT = { edge: '#2b4f42', fill: '#3d7560', line: '#5a9a80' } as const;
// Smooth at a bowl, front view (her sit sprite's palette): head down between her shoulders, the back's hump over it, the
// tail on the floor to her right. 'down': muzzle in the bowl; 'up': head a pixel up (chewing, lapping).
const EAT = {
  down: ['...hhh.....', '..hbsbh....', '.hhsbshh...', '.hhbsbhh...', '.hsbsbsh...', '.bsbsbsb...', 'sbbbpbbbs..', 'sbbbwbbbs.d', '.bsb.bsbsdd'],
  up: ['...hhh.....', '.hhbsbhh...', '.hhsbshh...', '.hsbsbsh...', '.bsbsbsb...', 'sbbbpbbbs..', 'sbbbwbbbs..', 'sbsb.bsbsd.', '.bsb.bsbsdd'],
};
/** Her tail tip up: row 7's last column a tail pixel, row 6's last two empty. */
const flickTail = (rows: string[]): string[] => rows.map((r, i) => i === 7 ? r.slice(0, 10) + 'd' : i === 6 ? r.slice(0, 9) + '..' : r);

/** Flat: the mat along the group box's bottom (decor.ts bowlsOf box). */
export function drawMat(g: CanvasRenderingContext2D, b: Rect): void {
  const w = b.x1 - b.x0;
  g.fillStyle = MAT.edge; g.fillRect(b.x0, b.y1 - 7, w, 6);
  g.fillStyle = MAT.fill; g.fillRect(b.x0 + 1, b.y1 - 6, w - 2, 4);
  g.fillStyle = MAT.line; g.fillRect(b.x0 + 2, b.y1 - 5, w - 4, 1);
}
export const drawFood = (g: CanvasRenderingContext2D, level: 'full' | 'half', x: number, y: number): void =>
  blit(g, sprite(`food-${level}`, FOOD[level], FOOD_PAL), x, y, false);
/** The water bowl at its feet point. Its surface row (y − 3, inner columns 1–6): a 1 px shimmer drifting across (still at
 *  column 2 when calm); while she drinks (`drink`: ms since she began) instead a ring spreading from the middle in three
 *  160 ms frames and her tongue every other 240 ms (neither when calm). */
export function drawWater(g: CanvasRenderingContext2D, x: number, y: number, now: number, calm: boolean, drink: number | null): void {
  blit(g, sprite('water', WATER, WATER_PAL), x, y, false);
  const X = Math.round(x) - 4, Y = Math.round(y) - 3, dot = (i: number, c: string) => { g.fillStyle = c; g.fillRect(X + i, Y, 1, 1); };
  if (drink !== null && !calm) {
    const f = Math.floor(drink / 160) % 3;
    if (f === 0) { dot(3, SHINE); dot(4, SHINE); } else { dot(3 - f, SHINE); dot(4 + f, SHINE); }
    if (Math.floor(drink / 240) % 2 === 0) dot(3, TONGUE);
  } else {
    const i = calm ? 1 : Math.floor(now / 420) % 9;
    if (i < 6) dot(1 + i, SHINE);
  }
}
/** Smooth at a bowl, her feet point (x, y): eating, the head bobs every 360 ms; drinking, every 240 ms; the tail tip
 *  flicks every 600 ms. Calm: still, head down eating, up drinking. Drawn 1 px right: her 9 px head over the bowl. */
export function drawEater(g: CanvasRenderingContext2D, which: 'eat' | 'drink', x: number, y: number, ms: number, calm: boolean): void {
  const f = calm ? (which === 'eat' ? 'down' : 'up') : Math.floor(ms / (which === 'eat' ? 360 : 240)) % 2 ? 'up' : 'down';
  const tip = !calm && Math.floor(ms / 600) % 2 === 1;
  blit(g, sprite(`eat-${f}-${+tip}`, tip ? flickTail(EAT[f]) : EAT[f], CAT_PAL), x + 1, y, false);
}
