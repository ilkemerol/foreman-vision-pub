// The server-room fire: burning racks, smoke, the brigade, its spray, the alarm and the engine's
// lights; one drawing for both styles. The timeline is logic/fire.ts.
import type { FireFrame, Rack } from '../../logic/fire.ts';
import { ENTRY_H, toWorld } from '../../logic/iso.ts';
import type { Layout, Pt, Rect } from '../../logic/layout.ts';
import { frameOf } from '../../logic/motion.ts';
import type { Dir } from '../../logic/scene.ts';
import { drawChar, fire, fireGlow, flick, smoke } from './flat.ts';
import { fireSheet, px } from './sprites.ts';

type G = CanvasRenderingContext2D;
/** A style's projection: `S` a flat point `z` px up on the screen, `D` its depth; `P` (iso) world tiles → screen;
 *  `span` the server room floor's x range on a screen row (fireGlow); `ambulance` the medics' light is on (the engine's
 *  then goes 18 px over it). */
export interface FireView { iso: boolean; S: (p: Pt, z?: number) => [number, number]; D: (p: Pt) => number; P?: (x: number, y: number, z: number) => [number, number]; span: (y: number) => [number, number]; ambulance: boolean }
/** Where the pieces go: `item` depth-sorted with the office, `post` over everything (after the night overlay), `lit`
 *  a burning rack's flame box and floor-light centre (flat px `pt`, screen `x, y`) to cut out of the night. */
export interface FireOut { item: (z: number, d: () => void) => void; post: (d: () => void) => void; lit: (box: Rect, glow: { pt: Pt; x: number; y: number }) => void }

const ISO_DIR: Record<Dir, Dir> = { right: 'right', down: 'left', up: 'up', left: 'up' };   // iso.ts's
const seedOf = (r: Rack) => r.i * 0.37 + 0.11;   // never negative: flick() indexes FLAME with it

function poly(g: G, pts: [number, number][], col: string, a: number) {
  g.globalAlpha = a; g.fillStyle = col; g.beginPath(); pts.forEach(([x, y], j) => j ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill(); g.globalAlpha = 1;
}
/** A rack's smoke: the desk smoke's squares, bigger and paler, rising ~34 px and drifting right. */
function heavySmoke(g: G, cx: number, base: number, level: number, now: number, calm: boolean) {
  for (let i = 0; i < 9; i++) {
    const ph = calm ? (i + 0.5) / 9 : (now / 1900 + i / 9) % 1, s = 3 + Math.round(ph * 4);
    g.globalAlpha = level * (1 - ph * 0.8) * 0.85;
    px(g, ['#6e737b', '#a3a9b1', '#cdd1d6'][i % 3], cx - 4 + ((i * 5) % 9) + Math.sin(ph * 5 + i) * 3 + ph * 10 - s / 2, base - ph * 34 - s / 2, s, s);
  }
  g.globalAlpha = 1;
}
/** The powder: a 5 px jet out of the nozzle, then 16 puffs along it, spreading and growing toward the fire. */
function spray(g: G, from: [number, number], to: [number, number], now: number, calm: boolean, seed: number) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  for (let k = 0; k <= 4; k++) px(g, '#ffffff', from[0] + dx * k / 12, from[1] + dy * k / 12, 1, 1);
  for (let i = 0; i < 16; i++) {
    const ph = calm ? (i + 0.5) / 16 : (now / 380 + i / 16 + seed) % 1, j = Math.sin(i * 12.9 + seed * 7) * (1 + ph * 6);
    const x = from[0] + dx * (0.2 + ph * 0.95) + j * 0.5, y = from[1] + dy * (0.2 + ph * 0.95) + j, s = 1 + Math.round(ph * 2);
    g.globalAlpha = 1 - ph * 0.35; px(g, ['#ffffff', '#d6ecff', '#a8d8ff'][i % 3], x - s / 2, y - s / 2, s, s);
  }
  g.globalAlpha = 1;
}
/** The white cloud round a sprayed rack, then settling. */
function powder(g: G, cx: number, cy: number, k: number, now: number, calm: boolean) {
  for (let i = 0; i < 16; i++) {
    const ph = calm ? 0.35 + (i % 4) * 0.1 : (now / 1300 + i / 16) % 1, a = i * 2.4, r = 3 + ph * 10, s = 2 + Math.round(ph * 3);
    g.globalAlpha = k * (0.85 - ph * 0.6); px(g, i % 3 ? '#f4f8ff' : '#cfe6ff', cx + Math.cos(a) * r - s / 2, cy + Math.sin(a) * r * 0.6 - ph * 5 - s / 2, s, s);
  }
  g.globalAlpha = 1;
}
/** The alarm light over the server room's door, its red halo turning every 300 ms (steady when calm). */
function beacon(g: G, x: number, y: number, now: number, calm: boolean) {
  const on = calm || Math.floor(now / 300) % 2 === 0;
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = on ? 0.4 : 0.15; g.fillStyle = '#ff2d2d';
  g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill(); g.restore();
  px(g, '#3a1010', x - 3, y + 1, 6, 1); px(g, on ? '#ff3b3b' : '#a01818', x - 2, y - 2, 4, 3); px(g, '#ffd0d0', x - 1, y - 2, 1, 1);
}
/** The fire engine's red and amber lights at the entrance (flat.ts ambulance's twin). */
function engine(g: G, x: number, y: number, now: number, calm: boolean) {
  const on = calm ? 1 : Math.floor(now / 220) % 2;
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.38; g.fillStyle = on ? '#ff2d2d' : '#ffb703';
  g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill(); g.restore();
  px(g, '#1b1f2a', x - 6, y - 3, 12, 6); px(g, on ? '#ff3b3b' : '#ffb703', x - 5, y - 2, 5, 4); px(g, on ? '#ffb703' : '#ff3b3b', x, y - 2, 5, 4);
}
/** The extinguisher in a hand, 3×6; with `noz` its hose to the nozzle. */
function handExt(g: G, x: number, y: number, noz: [number, number] | null) {
  px(g, '#1b1f2a', x, y - 1, 3, 1); px(g, '#7a1010', x, y, 3, 6); px(g, '#e5383b', x, y, 2, 5); px(g, '#ff8a8a', x, y + 1, 1, 2); px(g, '#f1f3f5', x, y + 3, 3, 1);
  if (noz) { g.strokeStyle = '#111'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 1.5, y - 0.5); g.lineTo(noz[0] + 0.5, noz[1] + 0.5); g.stroke(); px(g, '#2b2b2b', noz[0] - 1, noz[1] - 1, 2, 2); }
}

/** Everything of the fire this frame. `ledsAt(r)` the rack's LED points (the renderer's own rack drawing). */
export function fireItems(g: G, f: FireFrame, l: Layout, v: FireView, now: number, calm: boolean, o: FireOut, ledsAt: (r: Rack) => [number, number][]): void {
  const t = calm ? 0 : now, sv = l.rooms.server, { geom, fx } = f;
  const racks = fx ? fx.racks : f.soot > 0 ? geom.burn.map(rack => ({ rack, flame: 0, smoke: 0, powder: 0, soot: f.soot, alarm: false })) : [];
  for (const R of racks) {
    const r = R.rack, seed = seedOf(r), mid = { x: r.x + 7, y: r.y + 15 }, z = v.D(mid) + 0.05;
    const zFront = v.iso ? z : r.y + 30.05;   // flat: just over the rack itself (flat.ts sorts it by its foot, r.y + 30)
    // the cabinet's front: soot, its slots' fire light, red LEDs
    let top: [number, number][], face: [number, number][], flames: [number, number][], smokeAt: [number, number];
    if (v.iso) {
      const P = v.P!, w = toWorld(mid);
      top = [[-0.5, -0.9], [0.5, -0.9], [0.5, 0.9], [-0.5, 0.9]].map(([a, b]) => P(w.x + a, w.y + b, 32));
      face = [P(w.x + 0.5, w.y - 0.9, 32), P(w.x + 0.5, w.y + 0.9, 32), P(w.x + 0.5, w.y + 0.9, 0), P(w.x + 0.5, w.y - 0.9, 0)];
      flames = [-0.45, 0.45].map(b => P(w.x, w.y + b, 32));
      smokeAt = P(w.x, w.y, 32 + R.flame * 12);
    } else {
      top = [[r.x, r.y - 6], [r.x + 14, r.y - 6], [r.x + 14, r.y], [r.x, r.y]];
      face = [[r.x, r.y], [r.x + 14, r.y], [r.x + 14, r.y + 30], [r.x, r.y + 30]];
      flames = [[r.x + 7, r.y]];
      smokeAt = [r.x + 7, r.y - 1 - R.flame * 10];
    }
    o.item(zFront, () => {
      if (R.soot > 0) {
        poly(g, face, '#000', R.soot * (v.iso ? 0.35 : 0.5));
        if (v.iso) poly(g, top, '#000', R.soot * 0.55);
        else { g.globalAlpha = R.soot * 0.6; for (let k = 0; k < 4; k++) px(g, '#1a1a1a', r.x + 2 + k * 3, r.y - 3 - (k % 2) * 2, 2, 3 + (k % 2) * 2); g.globalAlpha = 1; }   // streaks on the wall
      }
      if (R.flame > 0) {
        const k = flick(t, seed);
        if (v.iso) poly(g, face, '#ff7a1a', R.flame * [0.22, 0.16, 0.26, 0.18][k]);
        else { g.globalAlpha = R.flame * [0.6, 0.45, 0.7, 0.5][k]; for (let j = 0; j < 6; j++) px(g, '#ff7a1a', r.x + 2, r.y + 2 + j * 4.5, 8, 3); g.globalAlpha = 1; }
      }
      if (R.alarm) ledsAt(r).forEach(([x, y], j) => px(g, calm || (Math.floor(t / 260) + j) % 2 === 0 ? '#ff3b3b' : '#5a0d0d', x, y, 1, 1));
    });
    if (R.flame > 0) {
      const gp = { x: r.x + 18, y: r.y + 26 }, [gx, gy] = v.iso ? v.S({ x: sv.x0 + 28, y: r.y + 16 }) : [r.x + 18, r.y + 30];
      o.item(-1e9, () => fireGlow(g, Math.round(gx), Math.round(gy), t, seed, v.span, R.flame));   // on the floor, under everything
      o.item(z + 0.01, () => flames.forEach(([fx0, fy0], k) => fire(g, Math.round(fx0), Math.round(fy0) + 1, t, seed + k * 0.5, R.flame * 1.15)));
      const xs = flames.map(p => p[0]), ys = flames.map(p => p[1]);
      o.lit({ x0: Math.floor(Math.min(...xs) - 9), y0: Math.floor(Math.min(...ys) - 20), x1: Math.ceil(Math.max(...xs) + 9), y1: Math.ceil(Math.max(...ys) + 2) }, { pt: gp, x: Math.round(gx), y: Math.round(gy) });
    }
    if (R.smoke > 0) o.post(() => { heavySmoke(g, smokeAt[0], smokeAt[1], R.smoke, t, calm); smoke(g, smokeAt[0] + 2, smokeAt[1] - 2, R.smoke, t); });
    if (R.powder > 0) o.post(() => powder(g, smokeAt[0], smokeAt[1] + 8, R.powder, t, calm));
  }
  if (!fx) return;
  // the brigade, depth-sorted with everyone
  for (const c of fx.crew) {
    const dir = v.iso ? ISO_DIR[c.dir] : c.dir, fr = frameOf(c.moving ? 'walk' : 'still', dir, t), [x, y] = v.S(c.pt);
    const r = c.rack, rw = toWorld({ x: r.x + 7, y: r.y + 15 }), tgt: [number, number] = v.iso ? v.P!(rw.x + 0.5, rw.y, 24) : [r.x + 9, r.y + 4];
    const noz: [number, number] = fr.flip ? [x - 9, y - 15] : dir === 'right' ? [x + 9, y - 15] : dir === 'up' ? [x - 5, y - 17] : [x + 6, y - 12];
    const back = dir === 'up';
    o.item(v.D(c.pt) + 0.02, () => {
      if (c.ext && back) handExt(g, x - 6, y - 14, c.spraying ? noz : null);   // seen from behind: behind the body
      drawChar(g, fireSheet(c.i % 3), fr.col, fr.row, x, y, fr.flip, 1);
      if (c.ext && !back) handExt(g, fr.flip ? x - 6 : dir === 'right' ? x + 3 : x + 4, y - 13, c.spraying ? noz : null);
    });
    if (c.spraying) o.post(() => spray(g, noz, tgt, t, calm, c.i * 0.31));
  }
  // the alarm light over the server room's door, the engine's at the entrance (over the ambulance's when both)
  const d = l.doors.find(d => d.id === 'server')!;
  if (fx.alarm) { const [bx, by] = v.S({ x: d.x + 8, y: d.y }, v.iso ? 32 : 31); o.post(() => beacon(g, Math.round(bx), Math.round(by), t, calm)); }
  if (fx.engine) { const [ex, ey] = v.iso ? v.P!(0, toWorld(l.doors[0]).y, ENTRY_H + 26) : [8, l.h - 72], up = v.ambulance ? 18 : 0; o.post(() => engine(g, Math.round(ex), Math.round(ey) - up, t, calm)); }
}
