// The ambient layer's pixels: the sky through
// a window, plant sway, the banker's lamp, scrolling screen lines, fuller steam, the Done lounge clock's face and the night
// overlay. Motion is the caller's call: it passes the time (0 when calm).
import { birdsAt, clockHands, cloudsAt, ih, mix, MOON_X, screenLines, starAt, type Phase } from '../../logic/ambient.ts';
import { glowHalf } from '../../logic/fx.ts';
import type { Pt } from '../../logic/layout.ts';
import type { Glass, Light, Pool } from '../../logic/lights.ts';
import { img, mk, px } from './sprites.ts';

type G = CanvasRenderingContext2D;

/** Paints the sky into a window's glass: rect (x0, y0, w, h) on g, `wx` the sky x of its left column; t: ms, 0 when calm. */
export function paintSky(g: G, x0: number, y0: number, w: number, h: number, wx: number, t: number, ph: Phase): void {
  const [top, hor, cloud] = ph.sky;
  for (let b = 0; b < 4; b++) {   // four bands, top to horizon
    const r0 = Math.round(b * h / 4), r1 = Math.round((b + 1) * h / 4);
    px(g, mix(top, hor, b / 3), x0, y0 + r0, w, r1 - r0);
  }
  const put = (x: number, y: number, n: number, c: string) => {   // a run of n px at sky x, glass row y, clipped to the glass
    const a = Math.max(x, wx), e = Math.min(x + n, wx + w);
    if (e > a && y >= 0 && y < h) px(g, c, x0 + a - wx, y0 + y, e - a, 1);
  };
  if (ph.dark > 0.6) {   // still stars and a crescent moon
    g.globalAlpha = Math.min(1, (ph.dark - 0.6) / 0.3);
    for (let sx = Math.floor(wx); sx < wx + w; sx++) { const y = starAt(sx, h); if (y !== null) put(sx, y, 1, ih(sx * 5) % 3 ? '#dfe6ff' : '#8f9cc8'); }
    [[1, 2], [0, 1], [0, 1], [1, 2]].forEach(([a, n], r) => put(MOON_X + a, 2 + r, n, '#f3efcf'));
    g.globalAlpha = 1;
  }
  for (const c of cloudsAt(t)) {
    g.globalAlpha = ph.dark > 0.6 ? 0.55 : 0.92;
    put(c.x + 3, c.y, c.w - 6, cloud); put(c.x + 1, c.y + 1, c.w - 2, cloud); put(c.x, c.y + 2, c.w, cloud); put(c.x + 2, c.y + 3, c.w - 4, mix(cloud, hor, 0.35));
  }
  g.globalAlpha = 1;
  for (const b of birdsAt(t, ph.dark)) {
    if (b.frame) { put(b.x, b.y, 1, '#2a2d3a'); put(b.x + 2, b.y, 1, '#2a2d3a'); put(b.x + 1, b.y + 1, 1, '#2a2d3a'); }
    else { put(b.x + 1, b.y, 1, '#2a2d3a'); put(b.x, b.y + 1, 1, '#2a2d3a'); put(b.x + 2, b.y + 1, 1, '#2a2d3a'); }
  }
}

/** sprites.ts win's mullions (or the library's leads) over the sky painted into its glass. */
export function windowBars(g: G, w: Glass): void {
  const ww = w.x1 - w.x0;
  if (w.lead) for (let y = w.y0 + 4; y < w.y1; y += 5) px(g, '#4a3b33', w.x0, y, ww, 1);
  else { px(g, '#4a3b33', w.x0 + (ww >> 1), w.y0, 1, w.y1 - w.y0); px(g, '#4a3b33', w.x0, w.y0 + ((w.y1 - w.y0) >> 1), ww, 1); }
}

/** A sprite drawn in horizontal bands [row0, row1, k], each shifted trunc(k · dx) px. */
export function swaySprite(g: G, im: CanvasImageSource & { width: number; height: number }, x: number, y: number, dx: number, bands: readonly (readonly [number, number, number])[]): void {
  x = Math.round(x); y = Math.round(y);
  for (const [r0, r1, k] of bands) g.drawImage(im, 0, r0, im.width, r1 - r0, x + Math.trunc(dx * k), y + r0, im.width, r1 - r0);
}

const lamps: HTMLCanvasElement[] = [];   // [off, on]: 7×8, the foot at (3, 7)
/** The green banker's lamp: brass foot and stem, green shade, its underside warm when on; foot at (x, y). */
export function drawLamp(g: G, x: number, y: number, on: boolean): void {
  if (!lamps.length) for (const lit of [false, true]) {
    const c = mk(7, 8), q = c.getContext('2d')!;
    px(q, '#6b5a2a', 1, 6, 5, 1); px(q, '#8a7a3a', 3, 3, 1, 3);
    px(q, '#1f6b3a', 1, 0, 5, 1); px(q, '#2f8a4a', 0, 1, 7, 1); px(q, '#175530', 0, 2, 7, 1);
    if (lit) px(q, '#ffe9a8', 1, 3, 5, 1);
    lamps.push(c);
  }
  g.drawImage(lamps[on ? 1 : 0], Math.round(x) - 3, Math.round(y) - 7);
}

/** A lit PC_FRONT's 8×3 inside at (x, y): three code lines at tick n. */
export function screenOverlay(g: G, x: number, y: number, n: number, seed: number): void {
  px(g, '#4a655d', x, y, 8, 3);
  screenLines(n, seed).forEach((q, j) => px(g, q.bright ? '#60c677' : '#548e61', x + q.x, y + j, q.w, 1));
}

/** Fuller steam: four 1–2 px puffs, 1.6 s up 11 px. */
export function steamFull(g: G, x: number, y: number, now: number): void {
  for (let i = 0; i < 4; i++) {
    const ph = (now / 1600 + i / 4) % 1, s = ph < 0.45 ? 1 : 2;
    g.globalAlpha = 0.55 * (1 - ph) * Math.min(1, ph / 0.12);
    px(g, '#eef2f6', x + Math.round(Math.sin(ph * 5 + i * 1.7) * 1.5) - (s - 1), y - Math.round(ph * 11), s, s);
  }
  g.globalAlpha = 1;
}

let FACE: [number, number][] | null = null;   // CLOCK.png's face pixels (white and its printed hands), read once
/** The analog CLOCK sprite (16×32 at x, y): its face repainted, the time's hands drawn (minute 3 px, hour 2 px). */
export function clockFace(g: G, x: number, y: number, d: Date): void {
  if (!FACE) {
    const c = mk(16, 32), q = c.getContext('2d', { willReadFrequently: true })!;
    q.drawImage(img('CLOCK'), 0, 0);
    const a = q.getImageData(0, 0, 16, 32).data;
    FACE = [];
    for (let i = 0; i < 16 * 32; i++) {
      const r = a[i * 4], gg = a[i * 4 + 1], b = a[i * 4 + 2];
      if (a[i * 4 + 3] && ((r > 220 && gg > 220 && b > 220) || (r === 0x73 && gg === 0x78))) FACE.push([i % 16, Math.floor(i / 16)]);
    }
  }
  for (const [fx, fy] of FACE) px(g, '#ededed', x + fx, y + fy, 1, 1);
  const { minute, hour } = clockHands(d);
  for (const p of minute) px(g, '#73787e', x + 7 + p.x, y + 16 + p.y, 1, 1);
  for (const p of hour) px(g, '#394449', x + 7 + p.x, y + 16 + p.y, 1, 1);
  px(g, '#394449', x + 7, y + 16, 1, 1);
}

// --- night -----------------------------------------------------------------------------------------------------
export interface Night { key: string; mask: HTMLCanvasElement; glow: HTMLCanvasElement }
const nights: Night[] = [];   // most recently used first; two: a floor slide draws two floors at once
/** The cached night layers: `mask` (navy #0a0f2a at 40 %, light sources cut out) and `glow` (their light, drawn
 *  'lighter'). `build(m, gl)` cuts into m (destination-out already set) and paints into gl. Rebuilt only on a new size or
 *  key, into the least recently used entry's canvases when they are the same size. */
export function nightLayers(w: number, h: number, key: string, build: (m: G, gl: G) => void): Night {
  key = `${w}x${h}:${key}`;
  const i = nights.findIndex(n => n.key === key);
  if (i >= 0) { const n = nights[i]; if (i) nights.unshift(...nights.splice(i, 1)); return n; }
  const old = nights.length >= 2 ? nights.pop()! : null, same = old && old.mask.width === w && old.mask.height === h;
  const mask = same ? old!.mask : mk(w, h), glow = same ? old!.glow : mk(w, h);
  const m = mask.getContext('2d')!, gl = glow.getContext('2d')!;
  m.globalCompositeOperation = 'source-over'; m.clearRect(0, 0, w, h);
  m.globalAlpha = 0.4; m.fillStyle = '#0a0f2a'; m.fillRect(0, 0, w, h); m.globalAlpha = 1;
  m.globalCompositeOperation = 'destination-out'; m.fillStyle = '#000';
  gl.clearRect(0, 0, w, h);
  build(m, gl);
  const n = { key, mask, glow };
  nights.unshift(n);
  return n;
}

/** A stepped pixel ellipse (flat) or a 2:1 one in coarse 2 px steps (iso, glowHalf), filled with g's fillStyle. */
function shapeFill(g: G, cx: number, cy: number, rx: number, ry: number, shape: 'ellipse' | 'iso') {
  cx = Math.round(cx); cy = Math.round(cy);
  for (let y = -ry; y <= ry; y++) {
    if (shape === 'iso') { const w = glowHalf(rx, ry, y); if (w > 0) g.fillRect(cx - w, cy + y, 2 * w, 1); }
    else { const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2))); g.fillRect(cx - w, cy + y, 2 * w + 1, 1); }
  }
}
/** A pool's three bands (scaled 1, 0.68, 0.4; outer first): cut[i] out of the mask, `glow` at `alpha` onto gl (0: none). */
export function cutPool(m: G, gl: G, p: Pool, cut: readonly number[], glow: string, alpha: number, shape: 'ellipse' | 'iso'): void {
  gl.fillStyle = glow;
  [1, 0.68, 0.4].forEach((f, i) => {
    const rx = Math.max(1, Math.round(p.rx * f)), ry = Math.max(1, Math.round(p.ry * f));
    m.globalAlpha = cut[i]; shapeFill(m, p.x, p.y, rx, ry, shape);
    if (alpha > 0) { gl.globalAlpha = alpha; shapeFill(gl, p.x, p.y, rx, ry, shape); }
  });
  m.globalAlpha = 1; gl.globalAlpha = 1;
}

/** A convex polygon in coarse 2 px rows (glowHalf's steps), each row's span snapped to even px. */
function stepFill(g: G, q: Pt[]) {
  const ys = q.map(p => p.y);
  for (let y = Math.floor(Math.min(...ys) / 2) * 2; y < Math.max(...ys); y += 2) {
    const c = y + 1, xs = q.flatMap((p, i) => { const r = q[(i + 1) % q.length]; return (p.y <= c) !== (r.y <= c) ? [p.x + (c - p.y) * (r.x - p.x) / (r.y - p.y)] : []; });
    if (!xs.length) continue;
    const a = Math.round(Math.min(...xs) / 2) * 2, b = Math.round(Math.max(...xs) / 2) * 2;
    if (b > a) g.fillRect(a, y, b - a, 2);
  }
}
/** The board's light (lights.ts boardBands, outer first): band i cut out of the mask at
 *  [0.2, 0.3, 0.4, 0.5][i] and `glow` at `alpha` onto gl, each over the last: brighter nearer the board. */
export function cutBands(m: G, gl: G, bands: Pt[][], glow: string, alpha: number): void {
  gl.fillStyle = glow;
  bands.forEach((q, i) => {
    m.globalAlpha = [0.2, 0.3, 0.4, 0.5][i]; stepFill(m, q);
    gl.globalAlpha = alpha; stepFill(gl, q);
  });
  m.globalAlpha = 1; gl.globalAlpha = 1;
}

/** The board's cool light (board.ts INK[2]). */
export const BOARD_GLOW = '#79c0ff';
/** flatLights' lights onto the night layers, each once, in order. */
export function cutFlat(m: G, gl: G, lights: Light[]): void {
  const clipped = (r: { x0: number; y0: number; x1: number; y1: number }, f: () => void) => {
    for (const c of [m, gl]) { c.save(); c.beginPath(); c.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); c.clip(); }
    f();
    for (const c of [m, gl]) c.restore();
  };
  for (const x of lights) {
    if (x.kind === 'lamp') clipped(x.clip, () => cutPool(m, gl, x.pool, [0.5, 0.8, 1], '#ffb057', 0.07, 'ellipse'));
    else if (x.kind === 'hole') m.fillRect(x.r.x0, x.r.y0, x.r.x1 - x.r.x0, x.r.y1 - x.r.y0);
    else if (x.kind === 'screen') {
      m.fillRect(x.r.x0, x.r.y0, x.r.x1 - x.r.x0, x.r.y1 - x.r.y0);
      cutPool(m, gl, { x: x.r.x0 + 5, y: x.r.y0 + 7, rx: 10, ry: 4 }, [0, 0, 0], '#7ee7c0', 0.05, 'ellipse');
    } else if (x.kind === 'board') {   // the screen a hole; its light on the floor
      const s = x.screen, li = x.light;
      m.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
      if (li) clipped(li.floor, () => cutBands(m, gl, li.bands, BOARD_GLOW, 0.045));
    } else clipped(x.clip, () => cutPool(m, gl, { x: x.x, y: x.y, rx: 29, ry: 14 }, [0.5, 0.8, 1], '', 0, 'iso'));   // fire: its own glow (fireGlow's 2:1 shape)
  }
}

/** Over everything drawn so far (not the canvas's empty parts): the mask, then the glow, both × dark. */
export function applyNight(g: G, dark: number, n: Night): void {
  if (dark <= 0) return;
  g.save(); g.globalAlpha = dark;
  g.globalCompositeOperation = 'source-atop'; g.drawImage(n.mask, 0, 0);
  g.globalCompositeOperation = 'lighter'; g.drawImage(n.glow, 0, 0);
  g.restore();
}
