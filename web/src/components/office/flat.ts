import type { AgentView } from '../../../../shared/types.ts';
import { t, whyText } from '../../logic/i18n.ts';
import { pillText, tagName, trunc, wrapBalloon } from '../../logic/labels.ts';
import { colorOf, hash } from '../../logic/model.ts';
import { failFx, glowHalf, medicAt, overworkMin, pointAt, smokeLevel, type FailFx } from '../../logic/fx.ts';
import { CAT, catHit, type CatPose, type Perch } from '../../logic/cat.ts';
import { POUR, type Trip } from '../../logic/coffee.ts';
import { payHop } from '../../logic/coins.ts';
import { cornerSpots, gaugeColor, gaugeText } from '../../logic/corner.ts';
import { handover, type CourierPose } from '../../logic/couriers.ts';
import { frameOf, type Walker } from '../../logic/motion.ts';
import { chargerOf } from '../../logic/robot.ts';
import { boardOf, BUBBLE, CAFE_DX, cafeSide, doneSeats, FLAT, flatSignAt, LINE, sofaParts, sofaSeats, tailX, waitBalloonBoxes, type Pt, type Rect } from '../../logic/layout.ts';
import { BOARD_HIT, boardFill, boardLit, boardMarks, type Mark } from '../../logic/board.ts';
import { atWork, type Dir, type Hit, type Place } from '../../logic/scene.ts';
import { windRibbon } from '../../logic/wind.ts';
import { lottieFrame, type LottieName } from '../../lottie.ts';
import { clockLeft, clockPixels, clockRing } from '../../logic/burn.ts';
import { burnParts } from './burn.ts';
import { fireItems } from './fire.ts';
import { serverRacks } from '../../logic/fire.ts';
import { chatClouds, drawCloud } from './chat.ts';
import { coinItems, flatSpots } from './coins.ts';
import { drawClock, drawGaugeBox } from './corner.ts';
import { drawCourier, drawLetter, handAt } from './couriers.ts';
import { catTag, chargerLeds, drawCat, drawCharger, drawEater, drawFood, drawMat, drawRobot, drawWater, robotLed } from './pets.ts';
import { bowlsOf } from '../../logic/decor.ts';
import { shortHotTags, type Body, type Frame, type Label, type Renderer } from './renderer.ts';
import { phase, SCREEN_MS, SKY_W, SWAY_BANDS, swayDx } from '../../logic/ambient.ts';
import { flatLights, foremanLampAt, lampAt, windowGlass, type LightsIn } from '../../logic/lights.ts';
import { applyNight, clockFace, cutFlat, drawLamp, nightLayers, paintSky, screenOverlay, steamFull, swaySprite, windowBars } from './ambient.ts';
import { idleAct, type IdleAct } from '../../logic/idle.ts';
import { drawCell, drawForemanMug, drawPiece, drawProps, idleRole, seatedCell } from './decor.ts';
import { bake, decorOf, doneClockX, DOOR_FRAMES, hangingPlants, iconBubble, img, medicSheet, px, ready, size, spr, ventXs, wallColor, wallMask, wallPieces, wallStrips } from './sprites.ts';

// The flat office: the whole floor drawn on one canvas.
const WORKING = new Set(['spawning', 'running', 'verifying']);
const CHAIR_BACK_Z = 54;   // a desk's chair back sorts at d.y + this

type Item = { z: number; d: () => void };

export function drawChar(g: CanvasRenderingContext2D, sheet: CanvasImageSource, col: number, row: number, fx: number, fy: number, flip: boolean, alpha: number) {
  const x = Math.round(fx - 8), y = Math.round(fy - 32);
  g.globalAlpha = alpha;
  if (flip) { g.save(); g.translate(x + 16, y); g.scale(-1, 1); g.drawImage(sheet, col * 16, row * 32, 16, 32, 0, 0, 16, 32); g.restore(); }
  else g.drawImage(sheet, col * 16, row * 32, 16, 32, x, y, 16, 32);
  g.globalAlpha = 1;
}

export function sparks(g: CanvasRenderingContext2D, x: number, y: number, seed: number, now: number) {
  for (let i = 0; i < 3; i++) {
    const ph = (now / 1000 + seed + i / 3) % 1;
    g.globalAlpha = 1 - ph; g.fillStyle = i % 2 ? '#39c5cf' : '#7ee787';
    g.fillRect(Math.round(x + ((i * 7 + seed * 13) | 0) % 12 - 6), Math.round(y - ph * 12), i === 1 ? 1 : 2, i === 1 ? 1 : 2);
  }
  g.globalAlpha = 1;
}

// fire, smoke and the failure sequence: fire, smoke, static noise, lying down, dizzy, stretcher
type G = CanvasRenderingContext2D;
/** A pixel ellipse outline (no anti-aliasing): the pulse ring under an alerting waiter. */
export function ring(g: G, x: number, y: number, rx: number, ry: number, col: string, alpha: number) {
  g.globalAlpha = alpha; g.fillStyle = col;
  for (let k = 0; k < 56; k++) { const a = k / 56 * Math.PI * 2; g.fillRect(Math.round(x + rx * Math.cos(a)), Math.round(y + ry * Math.sin(a)), 1, 1); }
  g.globalAlpha = 1;
}
export const FLAME = [[8, 12, 16, 11, 7], [10, 15, 12, 14, 9], [7, 13, 16, 10, 11], [9, 11, 14, 16, 8]];   // five tongues' heights, 4 frames
export const flick = (now: number, seed: number) => Math.floor(now / 190 + seed * 7) % 4;   // the flame's frame; its floor light follows it

/** Flames on a monitor's top (base: one below their bottom row): five 4 px tongues across its 16 px, red tips over an
 *  orange body, a yellow inside and a white-yellow core, and sparks rising off them; `scale` the tongues' heights and
 *  the sparks' rise and alpha. */
export function fire(g: G, cx: number, base: number, now: number, seed: number, scale = 1) {
  const fr = FLAME[flick(now, seed)];
  const layer = (c: string, k: number, i0: number, i1: number, inset: number) => {
    for (let i = i0; i < i1; i++) { const h = Math.round(fr[i] * k * scale); px(g, c, cx - 8 + i * 3 + inset, base - h, 4 - inset, h); }
  };
  layer('#d62828', 1, 0, 5, 0); layer('#f77f00', 0.8, 0, 5, 0); layer('#ffb703', 0.55, 0, 5, 1); layer('#fff3b0', 0.3, 1, 4, 1);
  for (let i = 0; i < 5; i++) {   // sparks
    const ph = (now / 1600 + i / 5 + seed) % 1;
    g.globalAlpha = (1 - ph) * scale;
    px(g, ['#fff3b0', '#ffb703', '#fb8500'][i % 3], cx - 6 + (i * 5 + Math.floor(seed * 3)) % 13 + Math.sin(ph * 5 + i) * 2, base - (6 + ph * 14) * scale, 1, 1);
  }
  g.globalAlpha = 1;
}

/** The fire's light on the floor, drawn before the desk, chair and sitter: a 2:1 ellipse in coarse 2 px steps
 *  (glowHalf) centred at (cx, cy) (whole px), three bands brighter inward, flickering with the flame and kept inside its room: `span(y)` is the room
 *  floor's x range on pixel row y (the iso style passes its diamond's); `scale` its alpha. */
export function fireGlow(g: G, cx: number, cy: number, now: number, seed: number, span: (y: number) => [number, number], scale = 1) {
  const k = flick(now, seed), rx = 29 + (k % 2), ry = 14 + (k >> 1);
  g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = '#ff7a1a';
  for (const f of [1, 0.7, 0.4]) {
    const a = Math.round(rx * f), b = Math.round(ry * f);
    g.globalAlpha = [0.11, 0.09, 0.1, 0.08][k] * scale;
    for (let y = -b; y <= b; y++) {
      const w = glowHalf(a, b, y), [x0, x1] = span(cy + y), l = Math.max(cx - w, x0), r = Math.min(cx + w, x1);
      if (r > l) g.fillRect(l, cy + y, r - l, 1);
    }
  }
  g.restore();
}
/** A flat room's `span` for fireGlow. */
const rectSpan = (r: Rect) => (y: number): [number, number] => y >= r.y0 && y < r.y1 ? [r.x0, r.x1] : [0, 0];

export function smoke(g: G, cx: number, base: number, level: number, now: number) {
  for (let i = 0; i < 6; i++) {
    const ph = (now / 1400 + i / 6) % 1, sz = 2 + Math.round(ph * 3);
    g.globalAlpha = level * (1 - ph) * 0.85;
    px(g, i % 2 ? '#8d939b' : '#5f646b', cx - 3 + ((i * 5) % 7) + Math.sin(ph * 6 + i) * 3 + ph * 8 - sz / 2, base - ph * 24, sz, sz);
  }
  g.globalAlpha = 1;
}

function staticNoise(g: G, x: number, y: number, now: number) {   // red static on PC_FRONT's screen (≈ 10×5 px at +3,+5)
  const k = Math.floor(now / 60);
  for (let yy = 0; yy < 5; yy++) for (let xx = 0; xx < 10; xx++) {
    const n = (xx * 73 + yy * 151 + k * 197) % 11;
    px(g, n < 3 ? '#ff4d4d' : n < 6 ? '#7a1010' : '#1a0505', x + 3 + xx, y + 5 + yy, 1, 1);
  }
}

/** The front-facing still sprite rotated about its feet point; ang 0..1 = 0..90°. */
export function drawLying(g: G, sheet: CanvasImageSource, fx: number, fy: number, ang: number) {
  g.save(); g.translate(Math.round(fx), Math.round(fy)); g.rotate(-ang * Math.PI / 2);
  g.drawImage(sheet, 16, 0, 16, 32, -8, -32, 16, 32); g.restore();
}

export function dizzy(g: G, x: number, y: number, now: number) {
  for (let i = 0; i < 3; i++) {
    const a = now / 300 + i * 2.1, sx = x + Math.cos(a) * 7, sy = y + Math.sin(a) * 2;
    px(g, '#ffd60a', sx, sy - 1, 1, 3); px(g, '#ffd60a', sx - 1, sy, 3, 1);
  }
}

function stretcher(g: G, cx: number, y: number) {   // y = the medics' feet line
  px(g, '#495057', cx - 23, y - 15, 46, 1); px(g, '#495057', cx - 23, y - 8, 46, 1);   // poles with handles
  px(g, '#f8f9fa', cx - 20, y - 14, 40, 6); px(g, '#ced4da', cx - 20, y - 9, 40, 1);
  px(g, '#e5383b', cx + 13, y - 14, 2, 5); px(g, '#e5383b', cx + 11, y - 13, 6, 2);    // red cross at the foot end
}

function rack(g: G, x: number, y: number, now: number, seed: number) {   // 14×30 front-facing server cabinet, blinking LEDs
  px(g, '#3a4458', x, y, 14, 30); px(g, '#1b2130', x + 1, y + 1, 12, 28);
  for (let i = 0; i < 6; i++) {
    px(g, '#262f42', x + 2, y + 2 + i * 4.5, 10, 3);
    const k = (Math.floor(now / (180 + i * 37)) + seed + i) % 5;
    px(g, k === 0 ? '#ffb703' : k < 3 ? '#39d353' : '#0f3d1c', x + 10, y + 3 + i * 4.5, 1, 1);
    if (i % 2) px(g, k === 4 ? '#79c0ff' : '#14304d', x + 8, y + 3 + i * 4.5, 1, 1);
  }
  px(g, '#0d1017', x, y + 30, 14, 1);
}

/** Wind out of the server room's vents (sprites.ts ventXs, logic/wind.ts): three ribbons per grille, white and pale
 *  cyan, a third of a 1.8–2.4 s cycle apart so the grille always blows. `at(x, dy)` puts flat x, dy px under the
 *  grille's bottom edge on the screen. */
export function wind(g: G, vents: number[], now: number, at: (x: number, dy: number) => [number, number]) {
  vents.forEach((vx, v) => {
    const ms = 1800 + v * 263 % 600;
    for (let i = 0; i < 3; i++) {
      g.fillStyle = i % 2 ? '#a8e1ff' : '#e6f6ff';
      for (const [x, y] of windRibbon(v * 0.37 + i * 0.29, (now / ms + i / 3 + v * 0.37) % 1)) {
        const [sx, sy] = at(vx + 4 + i * 7 + x, y);
        g.fillRect(Math.round(sx), Math.round(sy), 1, 1);
      }
    }
  });
}

export function steam(g: G, x: number, y: number, now: number, n = 2) {
  for (let i = 0; i < n; i++) { const ph = (now / 900 + i / n) % 1; g.globalAlpha = 0.8 * (1 - ph); px(g, '#e9edf2', x + Math.round(Math.sin(ph * 6 + i)), y - ph * 6, 1, 1); }
  g.globalAlpha = 1;
}

// coffee corner: (x, y) = the table's top-left; SMALL_TABLE_FRONT's top is rows 11–24 (apron 25–31),
// so the machine stands on it at row 18 and the mugs just in front at row 20
function station(g: G, x: number, y: number, now: number, calm: boolean) {
  spr(g, 'SMALL_TABLE_FRONT', x, y);
  px(g, '#23262f', x + 3, y + 6, 11, 13); px(g, '#3d4352', x + 4, y + 7, 9, 3);             // machine
  px(g, calm || Math.floor(now / 600) % 2 ? '#ff5d5d' : '#6b1b1b', x + 11, y + 11, 1, 1);   // power LED, steady when calm
  px(g, '#c9d6e3', x + 5, y + 13, 5, 5); px(g, '#5a3a22', x + 6, y + 15, 3, 2);             // carafe
  if (!calm) steamFull(g, x + 8, y + 5, now);
  for (const mx of [18, 24]) { px(g, '#f1f3f5', x + mx, y + 17, 4, 4); px(g, '#f1f3f5', x + mx + 4, y + 18, 1, 2); px(g, '#6b4423', x + mx + 1, y + 17, 2, 1); }
}

export function mug(g: G, fx: number, fy: number, now: number, sip: boolean, calm = false) {   // held mug, front view; a sip lifts it to the mouth
  const x = Math.round(fx + 3), y = Math.round(fy - (sip ? 21 : 14));
  px(g, '#f1f3f5', x, y, 3, 3); px(g, '#f1f3f5', x + 3, y + 1, 1, 1); px(g, '#6b4423', x, y, 3, 1);
  if (!sip && !calm) steam(g, x + 1, y - 1, now);
}

export function ambulance(g: G, x: number, y: number, now: number) {   // over the entrance while the medics are in
  const on = Math.floor(now / 250) % 2;
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35; g.fillStyle = on ? '#ff2d2d' : '#9ec5ff';
  g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.fill(); g.restore();
  px(g, '#1b1f2a', x - 5, y - 3, 10, 6); px(g, on ? '#ff3b3b' : '#f1f3f5', x - 4, y - 2, 4, 4); px(g, on ? '#f1f3f5' : '#ff3b3b', x, y - 2, 4, 4);
}

export const dirOf = (dx: number, dy: number): Dir => Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');

/** A ghost's or sleeper's icon balloon at its head's top right, at full opacity: (x, y) the drawn feet, the tail just
 *  over the head's right side, the box clear of the next one in the queue line (14 px apart). */
export const iconAt = (g: G, name: 'ghost' | 'zz', x: number, y: number) => g.drawImage(iconBubble(name), Math.round(x) + 1, Math.round(y) - 46);

export function lot(g: CanvasRenderingContext2D, name: LottieName, x: number, y: number, n: number) {
  const c = lottieFrame(name, n);
  if (c) g.drawImage(c, Math.round(x), Math.round(y), n, n);
}

/** A done agent's ✓ is its clock to the burn: the 10 px check while it stays; once it counts
 *  down, a crisp 7 px pie in the check's green over a dim ring, emptying clockwise from 12 o'clock and fading. */
export function doneCheck(g: CanvasRenderingContext2D, a: AgentView, x: number, y: number, serverNow: number) {
  const left = clockLeft(a.leaveAt, serverNow, a.stageSince);
  if (left === 1) return lot(g, 'check', x, y, 10);
  const X = Math.round(x) + 1, Y = Math.round(y) + 1, k = g.globalAlpha * (0.3 + 0.7 * left);
  g.save();
  g.fillStyle = '#1a5c36'; g.globalAlpha = k * 0.6;
  for (const [px, py] of clockRing(7)) g.fillRect(X + px, Y + py, 1, 1);
  g.fillStyle = '#2ece72'; g.globalAlpha = k;   // the Lottie check's green
  for (const [px, py] of clockPixels(7, left)) g.fillRect(X + px, Y + py, 1, 1);
  g.restore();
}

export const tagLabel = (id: string, a: AgentView, x: number, y: number, failed = false, hot: number | null = null): Extract<Label, { kind: 'tag' }> => ({
  kind: 'tag', key: 'tag-' + id, x, y, name: tagName(a), color: colorOf(a), failed, hot,
  pill: !failed && (a.role === 'agent' ? WORKING.has(a.stage) : a.stage === 'running') ? pillText(a) : null,   // the foreman's only while it runs
});

export type BubbleLabel = Extract<Label, { kind: 'bubble' }>;
/** `line`: the one-line balloon — the reason without its `kind:` lead (the icon and colour carry it), cut to fit;
 *  the whole text stays in the hover terminal and the detail panel. */
export const bubbleLabel = (id: string, a: AgentView, p: Place, x: number, y: number, clamp: [number, number], compact: boolean, line = false): BubbleLabel => {
  const why = whyText(a) || t('wait.you');
  return {
    kind: 'bubble', key: 'bub-' + id, x, y, head: t('bubble.head', { name: tagName(a) }), icon: p.bubble === 'alert' ? 'bell' : 'question', alert: p.bubble === 'alert',
    lines: line ? [trunc(why.replace(/^[\w-]+:\s*/, ''), LINE.chars)] : wrapBalloon(why, BUBBLE.chars, compact ? 1 : 2), clamp, compact, line,
  };
};

// shared with the iso style: the same scene state drives both drawings
export const seedOf = (id: string): number => (hash(id) % 1000) / 100;

/** Desk index → whoever has arrived and sits at it. */
export function seatedDesks(f: Frame): Map<number, AgentView> {
  const seated = new Map<number, AgentView>();
  for (const [id, p] of f.scene.places) {
    const w = f.walkers.get(id);
    if (w && !w.moving && p.kind === 'desk' && p.desk !== null) seated.set(p.desk, f.agents.get(id)!);
  }
  return seated;
}

/** A desk's screen: on while its sitter works or waits at it for the board (stale-board, like verifying); a failing one flickers red while it sits, shows red static from
 *  standing up until dark, then is off, and smokes meanwhile. */
export function deskScreen(o: AgentView | undefined, fl: FailFx | undefined): { on: boolean; noise: boolean; smoke: number } {
  if (!fl) return { on: atWork(o), noise: false, smoke: 0 };
  const blink = Math.floor(fl.t / 90) % 4 === 0;
  return { on: fl.t < fl.f.dark && !blink, noise: fl.t < fl.f.stand ? blink : fl.t < fl.f.dark, smoke: smokeLevel(fl.t, fl.f) };
}

const OUTLINE = '#3b2616';
const CAFE_TOP = [5, 7, 8, 9, 9, 9, 9, 8, 7, 5];   // the round top's half width per row, seen from above (18 × 10)
/** A café table at (x, y), its sitters' feet line, in the office's 3/4 view:
 *  a round top seen from above with its front rim, two cups from above, a short pedestal on its base. */
export function cafeTable(g: G, x: number, y: number) {
  const y0 = y - 21;
  px(g, '#5e3d24', x - 1, y - 9, 2, 7);
  px(g, OUTLINE, x - 5, y - 3, 10, 1); px(g, '#5e3d24', x - 4, y - 2, 8, 1); px(g, OUTLINE, x - 5, y - 1, 10, 1);
  px(g, OUTLINE, x - 5, y0 - 1, 10, 1);
  CAFE_TOP.forEach((h, i) => { px(g, OUTLINE, x - h - 1, y0 + i, 1, 1); px(g, OUTLINE, x + h, y0 + i, 1, 1); px(g, i < 2 ? '#e0ad74' : '#d19a63', x - h, y0 + i, 2 * h, 1); });
  px(g, '#9a6738', x - 7, y0 + 10, 14, 2); px(g, OUTLINE, x - 8, y0 + 10, 1, 1); px(g, OUTLINE, x + 7, y0 + 10, 1, 1); px(g, OUTLINE, x - 6, y0 + 12, 12, 1);
  for (const [cx, cy] of [[x - 7, y0 + 3], [x + 3, y0 + 4]]) { px(g, '#c9ccd2', cx, cy, 4, 4); px(g, '#f1f3f5', cx, cy, 4, 1); px(g, '#6b4423', cx + 1, cy + 1, 2, 2); }
}
/** A café chair at its sitter's feet (x, y), side-on in the 3/4 view: its seat's top and front, four legs, its back a
 *  strip on the side away from the table like SOFA_SIDE's (`side` 'l': the left chair, its back on the left; 'r'
 *  mirrors it as drawChar does). */
export function cafeChair(g: G, x: number, y: number, side: 'l' | 'r') {
  const r = (c: string, a: number, yy: number, w: number, h: number) => px(g, c, side === 'l' ? x + a : x - a - w, yy, w, h);
  r('#5e3d24', 4, y - 6, 1, 6); r('#4a2f1b', 2, y - 6, 1, 3);                                    // the far-side legs
  r(OUTLINE, -6, y - 15, 12, 1); r('#b97c4d', -6, y - 14, 12, 1); r('#a0683f', -6, y - 13, 12, 4);   // the seat from above
  r(OUTLINE, 6, y - 14, 1, 7); r('#6e4527', -6, y - 9, 12, 2); r(OUTLINE, -6, y - 7, 12, 1);        // its edge and front
  // the back on the seat's outer edge, where the old side view's stood (x − 7…x − 5), down to its legs
  r(OUTLINE, -7, y - 24, 3, 1); r('#b97c4d', -7, y - 23, 3, 1);
  r('#6e4527', -7, y - 22, 1, 16); r('#875533', -6, y - 22, 1, 16); r('#a0683f', -5, y - 22, 1, 16);
  r(OUTLINE, -7, y - 6, 3, 1); r('#5e3d24', -7, y - 5, 1, 5); r('#5e3d24', -5, y - 5, 1, 3);
}
export const BOARD_SCREEN_H = 11;   // the board's writing rows (boardMarks' h), under a 3 px bezel
export const BOARD_OFF = '#0a0e13';   // the screen with its light out
/** The Done lounge's smart board in its box `b` (layout.ts boardOf): a dark screen in a thin frame on two legs, its writing and,
 *  under it, the fill bar; `lit` false (a flicker): the screen dark, no writing, no bar. */
export function boardFlat(g: G, b: Rect, ink: Mark[], fill: number, lit = true) {
  const w = b.x1 - b.x0, x = b.x0, y = b.y0;
  for (const lx of [x + 3, b.x1 - 5]) { px(g, '#5c6375', lx, y + 20, 2, b.y1 - y - 21); px(g, '#2b3240', lx - 1, b.y1 - 1, 4, 1); }
  px(g, '#20242e', x, y, w, 20); px(g, '#5c6375', x + 1, y + 1, w - 2, 1); px(g, lit ? '#14202a' : BOARD_OFF, x + 2, y + 2, w - 4, 16);
  if (!lit) return;
  for (const m of ink) px(g, m.c, x + 3 + m.x, y + 3 + m.y, m.w, 1);
  px(g, '#2b3240', x + 3, y + 16, w - 6, 1); px(g, '#7ee787', x + 3, y + 16, Math.round((w - 6) * fill), 1);
}

function draw(g: CanvasRenderingContext2D, f: Frame): { labels: Label[]; hits: Hit[]; bodies: Body[] } {
  const l = f.scene.layout, now = f.now;
  const D = f.ambient.date, calm = f.ambient.calm, ph = phase(D), skyT = calm ? 0 : D.getTime();   // the sky on the wall clock: a reload moves no cloud
  const labels: Label[] = [], hits: Hit[] = [], bodies: Body[] = [];
  if (!ready()) { g.clearRect(0, 0, l.w, l.h); return { labels, hits, bodies }; }
  const rest = (id: string, x: number, y: number) => bodies.push({ id, x0: x - 8, y0: y - 32, x1: x + 8, y1: y });   // a sprite at rest
  g.drawImage(bake(l, f.theme), 0, 0);
  const c = cornerSpots(l, f.textK), v = f.corner.visit;
  drawClock(g, c.clock.x0, c.clock.y0, new Date());   // over the baked wall, behind the foreman
  // the sky in every window (its bars over it) and the top wall's hanging plants, over the baked
  // wall; a window's sky x wraps round the sky's width, so a far window gets clouds and birds too
  const glass = windowGlass(l, size);
  for (const w of glass) { paintSky(g, w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0, w.x0 % SKY_W, skyT, ph); windowBars(g, w); }
  const plants = hangingPlants(l), hang = (x: number, y: number) => swaySprite(g, img('HANGING_PLANT'), x, y, swayDx(x * 0.37, now, calm), SWAY_BANDS.HANGING_PLANT);
  for (const x of plants.top) hang(x, 0);
  const items: Item[] = [], post: (() => void)[] = [];
  const tag = (id: string, a: AgentView, x: number, y: number, failed = false, hot: number | null = null) => labels.push(tagLabel(id, a, x, y, failed, hot));
  let sel: { x: number; y: number } | null = null;   // selected sprite's feet point, outlined last
  const char = (id: string, p: Place, w: Walker, col: number, row: number, x: number, y: number, flip = false, z = y) => {
    const alpha = p.alpha * Math.min(1, 0.2 + (now - w.bornAt) / 600);
    items.push({ z, d: () => drawChar(g, img(`char_${p.sprite}`), col, row, x, y, flip, alpha) });
    if (id === f.selectedId) sel = { x, y };
  };
  // a Waiting room / Done lounge agent out for coffee: walking, pouring with its back turned, then
  // facing front with a steaming mug, sipping now and then
  const lounger = (id: string, p: Place, w: Walker, t: Trip) => {
    const { x, y } = t.pt, cup = t.stay !== null && t.stay >= POUR, fr = frameOf(t.moving ? 'walk' : 'still', cup ? 'down' : t.dir, now);
    char(id, p, w, fr.col, fr.row, x, y, fr.flip);
    if (cup) items.push({ z: y + 0.1, d: () => mug(g, x, y, now, t.stay! % 1300 > 900, calm) });
  };
  // a failure: sits with a red screen → stands, sways → faints beside the desk → the medics carry it out; then nothing
  const failSequence = (id: string, a: AgentView, p: Place, w: Walker, x: FailFx) => {
    const { desk: d, t, f: ft } = x, seat = d.seat, ly = seat.y + 10, sheet = img(`char_${p.sprite}`);
    if (t >= ft.end) return;
    if (t < ft.stand) {
      char(id, p, w, frameOf('type', 'up', now).col, 1, seat.x, seat.y);
      tag(id, a, d.cx, d.y - 18, true);
      hits.push({ id, x0: d.cx - 28, y0: d.y - 18, x1: d.cx + 28, y1: d.y + 44, z: seat.y });
    } else if (t < ft.fall) {   // up into the aisle in 180 ms, then it sways
      const up = t < ft.stand + 180, bx = up ? seat.x : seat.x + Math.round(Math.sin(t / 90) * 1.5), by = up ? seat.y + (t - ft.stand) / 18 : ly;
      char(id, p, w, 1, 0, bx, by, !up && Math.floor(t / 260) % 2 === 1);
      tag(id, a, bx, by - 48, true);
    } else if (t < ft.leave) {   // on the floor (90° in 300 ms), lifted onto the stretcher once the team is there
      const k = t < ft.arrive ? 0 : (t - ft.arrive) / (ft.leave - ft.arrive), by = ly + (d.aisle - 17 - ly) * k;
      const ang = Math.min(1, (t - ft.fall) / 300), stars = t > ft.fall + 300 && t < ft.arrive;
      items.push({ z: k ? d.aisle + 0.4 : by + 8, d: () => { drawLying(g, sheet, seat.x, by, ang); if (stars) dizzy(g, seat.x - 28, by - 12, now); } });
      tag(id, a, Math.max(seat.x - 16, 30), by - 30, true);
    }
    const s = medicAt(t, ft, x.len);
    if (s === null) return;
    const back = t >= ft.leave, walking = t < ft.arrive || back;
    const m = [20, -20].map(o => pointAt(x.path, s + o)), c = pointAt(x.path, s);
    m.forEach((q, k) => {
      const n = pointAt(x.path, s + (k ? -20 : 20) + (back ? -1 : 1)), fr = frameOf(walking ? 'walk' : 'still', dirOf(n.x - q.x, n.y - q.y), now);
      items.push({ z: q.y, d: () => drawChar(g, medicSheet(k as 0 | 1), fr.col, fr.row, q.x, q.y, fr.flip, 1) });
    });
    const vert = Math.abs(m[0].x - m[1].x) < Math.abs(m[0].y - m[1].y);
    items.push({ z: c.y + 0.3, d: () => {   // the stretcher (and whoever lies on it) turns with the corridor
      g.save(); g.translate(Math.round(c.x), Math.round(c.y) - 11); if (vert) g.rotate(Math.PI / 2); g.translate(0, 11);
      stretcher(g, 0, 0);
      if (back) drawLying(g, sheet, 14, -17, 1);
      g.restore();
    } });
    if (back) tag(id, a, Math.max(c.x - 2, 30), c.y - 47, true);
  };

  // walls in their owner room's colour (the top row is baked), the corridor walls' decor strips just in front of them,
  // and the six doors, each sign above its door or on the wall beside it
  for (const [k, id] of l.walls) {
    const [c, r] = k.split(',').map(Number);
    if (r > 1) items.push({ z: (r + 1) * 16, d: () => g.drawImage(wallPieces(wallColor(f.theme, id))[wallMask(l.walls, c, r)], c * 16, r * 16 - 16) });
  }
  const [hallStrip, lowStrip] = wallStrips(l);
  items.push({ z: (l.k + 1) * 16 + 0.01, d: () => { g.drawImage(hallStrip, 0, (l.k - 1) * 16); for (const x of plants.hall) hang(x, (l.k - 1) * 16); } });
  items.push({ z: (l.k + 4) * 16 + 0.01, d: () => {
    g.drawImage(lowStrip, 0, (l.k + 2) * 16);
    for (const x of plants.low) hang(x, (l.k + 2) * 16);
    const cx = doneClockX(l);
    if (cx !== null) clockFace(g, cx, (l.k + 2) * 16, D);   // the Done lounge's clock tells the time
  } });
  l.doors.forEach((d, i) => {
    items.push({ z: d.y - 0.5, d: () => g.drawImage(DOOR_FRAMES[f.doors[i].k], d.x, d.y - 28) });
    const { x, y } = flatSignAt(d);
    labels.push({ kind: 'sign', key: 'door-' + d.id, x, y, text: t(`door.${d.id}`), tone: d.id, side: d.side });
  });

  // furniture that is always there: the foreman desk, every work desk, the Waiting room benches, the Done lounge
  const F = l.foreman.seat, fy = l.foreman.y;
  items.push({ z: F.y - 1, d: () => spr(g, 'WOODEN_CHAIR_FRONT', F.x - 8, F.y - 40) });
  items.push({ z: fy + 32, d: () => spr(g, 'DESK_FRONT', F.x - 24, fy) });
  // the monitor's back stands on the viewer side of the desktop, 3 px in from its right edge, its top just under the foreman's chin
  items.push({ z: fy + 32.1, d: () => { spr(g, 'PC_BACK', F.x + 3, fy - 1); const fl = foremanLampAt(l); drawLamp(g, fl.x, fl.y, ph.lamps); } });
  // the context box left of the desk, its sign above it; sparks rise off its glass while the foreman works at it
  items.push({ z: c.box.y1, d: () => drawGaugeBox(g, c.box.x0, c.box.y0, f.corner.value, now, v?.pose === 'type') });
  labels.push({ kind: 'gauge', key: 'gauge', x: c.sign.x, y: c.sign.y, text: gaugeText(f.corner.value), color: gaugeColor(f.corner.value) });
  if (v?.pose === 'type') post.push(() => sparks(g, c.box.x0 + 8, c.box.y0 + 12, seedOf('gauge'), now));
  const seated = seatedDesks(f), fails = failFx(f.scene, f.walkers, now), failing = [...fails.values()];
  const tick = calm ? 0 : Math.floor(now / SCREEN_MS);
  // what stays lit at night (the overlay's cut-outs), gathered as the office is laid out
  const screens: number[] = [], lampsOn: number[] = [], hotDesks: number[] = [], burns: LightsIn['burns'] = [], racks: Rect[] = [];
  // the seated agents' idle acts this frame (none when calm); a sip takes its desk's mug
  const reading = f.couriers.some(c => c.give !== null && handover(c.give).read), idle = new Map<string, IdleAct | null>();
  for (const [id, p] of f.scene.places) {
    const w = f.walkers.get(id), a = f.agents.get(id);
    if (!w || w.moving || !a) continue;
    const role = idleRole(p, a, v !== null, reading);
    if (role) idle.set(id, idleAct(a.key, role, now, calm));
  }
  const sips = new Set([...f.scene.places].filter(([id, p]) => p.kind === 'desk' && idle.get(id)?.kind === 'sip').map(([, p]) => p.desk!));
  l.desks.forEach((d, i) => {
    const fl = failing.find(x => x.desk === d), scr = deskScreen(seated.get(i), fl), noise = scr.noise, lamp = lampAt(d), lit = ph.lamps && atWork(seated.get(i));
    if (fl || scr.on) screens.push(i);
    if (lit) lampsOn.push(i);   // its pool in the night overlay   // a failing desk's screen stays cut out all through its sequence: no rebuild per flicker
    if (scr.smoke > 0) post.push(() => smoke(g, d.cx, d.y - 1, scr.smoke, now));
    items.push({ z: d.y + 32, d: () => spr(g, 'DESK_FRONT', d.cx - 24, d.y) });
    items.push({ z: d.y + 32.1, d: () => {   // a lit screen's code scrolls; the banker's lamp left of it
      if (scr.on) { spr(g, 'PC_FRONT_ON_1', d.cx - 8, d.y - 2); screenOverlay(g, d.cx - 4, d.y + 4, tick, i); } else spr(g, 'PC_FRONT_OFF', d.cx - 8, d.y - 2);
      if (noise) staticNoise(g, d.cx - 8, d.y - 2, now);
      drawLamp(g, lamp.x, lamp.y, lit);
    } });
    if (scr.on && !fl) items.push({ z: d.y + 32.2, d: () => drawProps(g, d, sips.has(i)) });   // under the sitter, over the desk
    items.push({ z: d.y + CHAIR_BACK_Z, d: () => spr(g, 'WOODEN_CHAIR_BACK', d.cx - 8, d.y + 14) });
  });
  // coins 7.2: a paid agent and its arriving coins sort past its desk's chair back, which hides one standing on its seat
  const payZ = (id: string, y: number) => { const c = f.coins.get(id); return Math.max(y, c ? l.desks[c.desk].y + CHAIR_BACK_Z : y); };
  // office coins: each agent's pile right of its desk, sorted with everyone by its feet; under the night overlay
  coinItems(g, f.coins, flatSpots(l), id => { const w = f.walkers.get(id); return w?.payAt != null ? { x: w.pt.x, y: w.pt.y - 14, z: payZ(id, w.pt.y) + 0.02 } : null; }, now, calm, (z, d) => items.push({ z, d }));
  const sv = l.rooms.server;   // the server room's rack column, left of its desks (logic/fire.ts serverRacks)
  for (const r of serverRacks(l)) {
    items.push({ z: r.y + 30, d: () => rack(g, r.x, r.y, calm ? 0 : now, r.i * 3) });   // calm: the LEDs hold still
    racks.push({ x0: r.x + 8, y0: r.y + 3, x1: r.x + 11, y1: r.y + 27 });               // its LED column
  }
  // the burning racks, the brigade and the lights; flames and their floor light cut out of the night
  if (f.fire) fireItems(g, f.fire, l, { iso: false, S: (p, z = 0) => [p.x, p.y - z], D: p => p.y, span: rectSpan(sv), ambulance: failing.some(x => x.t >= x.f.medStart - 400 && x.t < x.f.end + 800) },
    now, calm, { item: (z, d) => items.push({ z, d }), post: d => post.push(d), lit: (box, gl) => { racks.push(box); burns.push({ pt: gl.pt, room: 'server' }); } },
    r => [0, 1, 2, 3, 4, 5].flatMap((j): [number, number][] => [[r.x + 10, r.y + 3 + j * 4.5], ...(j % 2 ? [[r.x + 8, r.y + 3 + j * 4.5] as [number, number]] : [])]));   // rack()'s LEDs
  // wind from its vents, down the wall and into the room, behind the racks and desks (none when calm)
  if (!calm) items.push({ z: sv.y0, d: () => wind(g, ventXs(l), now, (x, dy) => [x, 20 + dy]) });
  const wr = l.rooms.wait, so = l.sofa, sofa = sofaSeats(so);   // the Waiting room's bench along its back wall
  items.push({ z: wr.y0 + 20, d: () => spr(g, 'WOODEN_BENCH', wr.x1 - 40, wr.y0 + 4) });
  // its sofa set, mirrored to open toward the door: the side sofa unflipped
  // on the left, sorting just before its seat so whoever sits there is drawn over it
  const sofaLamp = sofaParts(so).lamp;   // the set's floor lamp in its back corner, lit in the evening
  items.push({ z: so.y + 16, d: () => drawPiece(g, { name: 'lamp', ...sofaLamp }, ph.lamps) });
  items.push({ z: so.y + 16, d: () => spr(g, 'SOFA_FRONT', so.x + 24, so.y) });
  items.push({ z: so.y + 36, d: () => spr(g, 'SOFA_SIDE', so.x, so.y + 22) });
  // COFFEE's mug is its top-right 8x7 px; both sit on the table's light top (its cols 4-27, rows 8-24)
  items.push({ z: so.y + 54, d: () => { spr(g, 'COFFEE_TABLE', so.x + 24, so.y + 22); spr(g, 'COFFEE', so.x + 24, so.y + 30); spr(g, 'COFFEE', so.x + 34, so.y + 37); } });
  items.push({ z: so.y + 74, d: () => spr(g, 'SOFA_BACK', so.x + 24, so.y + 58) });
  const potted = (x: number, y: number) => swaySprite(g, img('LARGE_PLANT'), x, y, swayDx(x * 0.37, now, calm), SWAY_BANDS.LARGE_PLANT);
  // the Done lounge's café tables: the chairs behind their sitters, the table in front of them
  for (const t of l.cafes) {
    for (const s of ['l', 'r'] as const) items.push({ z: t.y - 1, d: () => cafeChair(g, t.x + (s === 'l' ? -CAFE_DX : CAFE_DX), t.y, s) });
    items.push({ z: t.y + 4, d: () => cafeTable(g, t.x, t.y) });
  }
  // the smart board: one line of writing per agent in the Done lounge, its bar the share of the seats taken; hovering it opens its table
  const board = boardOf(l), inDone = [...f.scene.places].filter(([, p]) => p.kind === 'done').map(([id]) => f.agents.get(id)!).sort((a, b) => a.stageSince - b.stageSince || a.id.localeCompare(b.id));
  const ink = boardMarks(inDone.map(a => a.key), board.x1 - board.x0 - 6, BOARD_SCREEN_H), fill = boardFill(inDone.length, doneSeats(l).length);
  // the flicker runs on the ambient clock's epoch ms (Frame.ambient.date.getTime(), like the sky), so every view and
  // reload agrees on it; its dusk threshold is the desk lamps' (ph.dark, LAMPS_AT)
  const lit = boardLit(D.getTime(), ph.dark, calm);
  items.push({ z: board.y1, d: () => boardFlat(g, board, ink, fill, lit) });
  hits.push({ id: BOARD_HIT, ...board, z: board.y0 });
  items.push({ z: 88, d: () => potted(l.rooms.main.x1 - 32, 40) });   // the main office's top-right corner, off every route and seat
  items.push({ z: 52, d: () => spr(g, 'BIN', 20, 36) });
  for (const st of [l.stations.wait, l.stations.done]) items.push({ z: st.y + 32, d: () => station(g, st.x, st.y, now, calm) });
  // each standing piece one item at its base, like the benches
  for (const p of decorOf(l)) if (p.name !== 'rugWait' && !(f.fire?.fx?.extTaken && p.name === 'extinguisher' && p.room === 'server')) items.push({ z: p.y1, d: () => drawPiece(g, p, ph.lamps) });

  // who of the Waiting room and the Done lounge is out for coffee (OfficeFloor's per-room schedules)
  const trips = f.trips, at = (id: string) => trips.get(id)?.pt ?? f.walkers.get(id)!.pt;

  // the balloons of the waiters in the Waiting room over their heads, in stageSince order (the
  // scene's), none over an agent; four to six go compact only when all fit (decided at their spots), else only the first
  // three get one; a balloon goes along on a walk to a new spot; one out for coffee carries its name instead
  const k = f.textK, waits = [...f.scene.places].filter(([id, p]) => p.kind === 'wait' && f.walkers.has(id));
  const drawn = [...f.scene.places.keys()].filter(id => f.walkers.has(id)).map(at);   // every agent, e.g. one walking out of the Waiting room
  const { compact, boxes: balloons } = waitBalloonBoxes(waits.map(([id, p]) => ({ id, home: p.spot.pt, at: at(id), out: trips.has(id) })), l, k, drawn);
  // a waiter's balloon where it is placed, else its name under its feet (the reason in the hover terminal)
  const waitLabel = (id: string, a: AgentView, p: Place, x: number, y: number) => {
    const b = p.bubble ? balloons.get(id) : null;
    labels.push(b ? { ...bubbleLabel(id, a, p, b.x0, b.y0, [b.x0, b.x1], compact, k > 1), tipX: tailX(b, x), up: b.up } : { ...tagLabel(id, a, Math.max(x, 30), y + 2), above: y - 34 });
  };

  // the people; a café sitter's drawn feet, for the chat clouds
  const chatFeet = new Map<string, Pt>();
  for (const [id, p] of f.scene.places) {
    const w = f.walkers.get(id), a = f.agents.get(id);
    if (!w || !a) continue;   // a failed agent seen first after its sequence has no walker
    const tr = trips.get(id), { x, y } = tr?.pt ?? w.pt, box = (z = y): Hit => ({ id, x0: x - 8, y0: y - 32, x1: x + 8, y1: y, z });
    if (p.kind === 'fail') {   // ponytail: a fail while still walking in plays at the desk at once; wait for arrival if that ever shows
      const fx = fails.get(id);
      if (fx) failSequence(id, a, p, w, fx);
      continue;
    }
    if (w.payAt !== null) {   // coins 7.2: standing by its desk, facing down, a hop at 1620–1860 ms while its coins fly to it
      char(id, p, w, 1, 0, x, y - payHop(now - w.payAt), false, payZ(id, y) + 0.01);
      labels.push({ ...tagLabel(id, a, Math.max(x, 30), y + 2), above: y - 34 });
      continue;
    }
    if (w.moving) {
      const fr = frameOf('walk', w.dir, now);
      char(id, p, w, fr.col, fr.row, x, y, fr.flip);
      if (p.kind === 'wait') waitLabel(id, a, p, x, y);
      else labels.push({ ...tagLabel(id, a, Math.max(x, 30), y + 2), above: y - 34 });   // keep the name inside the office while entering
      continue;
    }
    if (p.kind === 'burn') {   // on its Done lounge seat, or at its desk (a ghost); no hit box, no outline, no ✓, mug or Zz
      const lounge = p.spot.room === 'done', d = l.desks[p.desk ?? 0], cs = cafeSide(l, w.pt), left = cs === 'l';
      const fr = lounge ? frameOf('read', 'down', now + (left ? 0 : 900)) : frameOf('still', 'up', now);
      const b = burnParts(g, { x, y, fl: y + 4, drop: 4, sheet: img(`char_${p.sprite}`), col: fr.col, row: lounge ? 0 : 1, back: !lounge,
        alpha: p.alpha, seed: seedOf(a.key), span: rectSpan(lounge ? l.rooms.done : l.rooms[d.room]) }, now - (w.burnAt ?? now), now);
      burns.push({ pt: { x, y }, room: lounge ? 'done' : d.room });
      if (b.sitter) items.push({ z: lounge ? y + 3 : y, d: b.sitter });
      if (b.pile) items.push({ z: y + 4, d: b.pile });
      if (b.glow) items.push({ z: 0, d: b.glow });
      if (b.over) post.push(b.over);
      if (b.label && lounge) labels.push({ kind: 'done', key: 'done-' + id, x: left ? x - 9 : x + 9, y: y - 22, text: tagName(a), color: colorOf(a), side: left ? 'l' : 'r' });
      else if (b.label) tag(id, a, d.cx, d.y - 18);
      continue;
    }
    if (p.kind === 'foreman' && v) {   // on a visit to the box: behind the desk, in front of the box; no hit box, balloon or desk sparks
      const fr = frameOf(v.pose, v.dir, now);
      char(id, p, w, fr.col, fr.row, v.pt.x, v.pt.y - 6 * v.seated, fr.flip, v.pt.y + 0.5);
      labels.push({ ...tagLabel(id, a, x, fy + 32), pill: t('corner.pill') });   // the name stays under the desk
    } else if (p.kind === 'foreman') {
      // it reads the letter; it sits 6 px up, between chair and desk; its idle act
      const act = idle.get(id) ?? null, fr = frameOf(reading ? 'read' : p.pose, 'down', now), cell = seatedCell(p.sprite, false, fr.col, 0, act);
      items.push({ z: y, d: () => { drawCell(g, cell, x, y - 6, p.alpha * Math.min(1, 0.2 + (now - w.bornAt) / 600)); if (act?.kind === 'sip') mug(g, x, y - 6, now, true); } });
      if (id === f.selectedId) sel = { x, y: y - 6 };
      items.push({ z: fy + 32.2, d: () => drawForemanMug(g, l, act?.kind === 'sip') });
      if (a.stage === 'running') post.push(() => sparks(g, x + 10, fy + 3, seedOf(a.key), now));
      rest(id, x, y - 6);
      labels.push({ ...tagLabel(id, a, x, fy + 32), own: id });
      if (p.bubble) labels.push(bubbleLabel(id, a, p, x, y - 38, [2, l.rooms.main.x1 - 2], false, f.textK > 1));
      hits.push({ id, x0: x - 26, y0: y - 34, x1: x + 26, y1: fy + 50, z: y });
    } else if (p.kind === 'desk') {
      const d = l.desks[p.desk!], hot = overworkMin(a, f.serverNow);
      const act = idle.get(id) ?? null, cell = seatedCell(p.sprite, true, frameOf(p.pose, 'up', now).col, 1, act);
      items.push({ z: y, d: () => drawCell(g, cell, x, y, p.alpha * Math.min(1, 0.2 + (now - w.bornAt) / 600)) });
      if (id === f.selectedId) sel = { x, y };
      if (hot !== null) {   // the light on the floor under the desk's front edge, the flames on the monitor over everything
        hotDesks.push(p.desk!);   // its floor light stays cut out of the night
        items.push({ z: 0, d: () => fireGlow(g, d.cx, d.y + 32, now, seedOf(a.key), rectSpan(l.rooms[d.room])) });
        post.push(() => fire(g, d.cx, d.y - 1, now, seedOf(a.key)));
      } else if (a.stage === 'running') post.push(() => sparks(g, d.cx, d.y + 4, seedOf(a.key), now));
      if (a.stage === 'abandoned') post.push(() => iconAt(g, 'zz', x, y));   // over the monitor, under its tag (≤ 10 px tall at d.y − 18)
      rest(id, x, y);
      labels.push({ ...tagLabel(id, a, d.cx, hot !== null ? d.y - 19 - 19 * f.textK : d.y - 18, false, hot), own: id });   // a hot tag (~19 text px) ends 2 px over the 16 px flames
      hits.push({ id, x0: d.cx - 28, y0: d.y - 18, x1: d.cx + 28, y1: d.y + 44, z: y });
    } else if (p.kind === 'wait') {
      if (p.bubble === 'alert') {
        const pulse = () => {   // pulse ring on the floor: only a wait that carries an alert
          const k = (now % 1400) / 1400;
          ring(g, x, y - 1, 5 + k * 7, 2 + k * 3, '#ff8c1a', 0.7 * (1 - k));
        };
        if (ph.dark > 0) post.unshift(pulse);   // over the night overlay, under everything else in post
        else items.push({ z: 0, d: pulse });
        post.push(() => lot(g, 'lamp', x - 24, y - 30, 16));
      }
      if (tr) lounger(id, p, w, tr);
      else if (sofa.some(s => s.x === x && s.y === y)) { const fr = frameOf('read', 'down', now); char(id, p, w, fr.col, fr.row, x, y, false, y + 3); rest(id, x, y); }   // seated, over its sofa
      else { char(id, p, w, frameOf(p.pose, 'down', now).col, 0, x, y); rest(id, x, y); }
      waitLabel(id, a, p, x, y);
      hits.push(box());
    } else if (p.kind === 'done') {
      // a café sitter's name on its own side, a coffee trip keeps the side; two at a table read out of step
      const cs = cafeSide(l, w.pt), left = cs === 'l';
      if (tr) lounger(id, p, w, tr);
      else {   // it faces its table
        const fr = frameOf('read', left ? 'right' : 'left', now + (left ? 0 : 900));
        char(id, p, w, fr.col, fr.row, x, y, fr.flip, y + 3); rest(id, x, y); chatFeet.set(id, { x, y });
      }
      post.push(() => doneCheck(g, a, x - 5, y - 36, f.serverNow));
      labels.push({ kind: 'done', key: 'done-' + id, x: left ? x - 9 : x + 9, y: y - 22, text: tagName(a), color: colorOf(a), side: left ? 'l' : 'r', ...(tr ? {} : { own: id }) });
      hits.push(box(y + 3));
    } else {   // queue: a placeholder waiting by the entrance, a ghost over its head
      char(id, p, w, frameOf(p.pose, 'down', now).col, 0, x, y);
      rest(id, x, y);
      post.push(() => iconAt(g, 'ghost', x, y));
      hits.push(box());
    }
  }

  for (const c of chatClouds(f)) { const p = chatFeet.get(c.id); if (p) post.push(() => drawCloud(g, p.x, p.y, c.side, c.u, calm)); }

  // couriers: in the main office, drawn like a walker; at rest it is a body the foreman's tag keeps off (no hit box)
  const letterFlight = (c: CourierPose, flip: boolean) => {   // out of the hand in an arc onto the desk, then the icon balloon by the foreman's head
    const h = handover(c.give!), [hx, hy] = handAt(c.pt.x, c.pt.y, flip), dx = F.x - 14, dy = F.y - 12;
    if (h.letter === 'fly') drawLetter(g, hx + (dx - hx) * h.k, hy + (dy - hy) * h.k - h.lift, c.product);
    else if (h.letter === 'desk') drawLetter(g, dx, dy, c.product);
    if (h.rise !== null) g.drawImage(iconBubble(c.product), Math.round(F.x) + 14, Math.round(F.y) - 50 - h.rise);
  };
  for (const c of f.couriers) {
    const { x, y } = c.pt, flip = c.dir === 'left';
    const col = c.walking ? frameOf('walk', c.dir, 2 * now).col : c.tap ? [1, 0][Math.floor(now / 400) % 2] : 1;
    items.push({ z: y + 0.5, d: () => {
      drawCourier(g, c.co, x, y, c.dir, col);
      const h = c.give === null ? null : handover(c.give);
      if (c.carry || h?.letter === 'hand') drawLetter(g, ...handAt(x, y, flip), c.product);
    } });
    if (!c.walking) rest('courier-' + c.co, x, y);
    if (c.give !== null) post.push(() => letterFlight(c, flip));
  }

  // office-cat-robot: the charger, the robot, Smooth and her name. Not agents: no body, no balloon room; her hit box is
  // the petting one
  const { cat, robot, dock, charge } = f.pets;
  const smooth = (z: number, pose: CatPose, x: number, y: number, flip: boolean) => {
    items.push({ z, d: () => drawCat(g, pose, x, y, now, flip) });
    hits.push(catHit(pose, x, y));
  };
  const unit = chargerOf(l);   // on the wall: over its strip, under all on the floor
  items.push({ z: dock.y - 11.9, d: () => drawCharger(g, dock, unit, charge, now, calm) });
  items.push({ z: robot.pt.y + 0.05, d: () => drawRobot(g, robot.pt.x, robot.pt.y, now, charge, calm) });
  // a desk top right of its monitor (the foreman's left of its, its PC on the right), over the desk and under its sitter
  const top = (p: Perch) => p === 'foreman' ? { x: F.x - 15, y: fy + 17, z: fy + 32.2 } : { x: l.desks[p].cx + 15, y: l.desks[p].y + 17, z: l.desks[p].y + 32.2 };
  const end = (e: Pt | Perch) => typeof e === 'object' ? { ...e, z: e.y } : top(e);
  // the mat under everything on the floor, the bowls at their feet points, Smooth behind the one she is at
  const bw = bowlsOf(l), drinking = cat.at === 'bowl' && cat.which === 'drink' ? cat.ms : null;
  items.push({ z: -1e9, d: () => drawMat(g, bw.box) });
  items.push({ z: bw.food.y, d: () => drawFood(g, f.pets.food, bw.food.x, bw.food.y) });
  items.push({ z: bw.water.y, d: () => drawWater(g, bw.water.x, bw.water.y, now, calm, drinking) });
  let tagAt: [number, number, boolean, number?] | null = null;
  if (cat.at === 'floor') {
    smooth(cat.pt.y, cat.pose, cat.pt.x, cat.pt.y, cat.side === 'left');
    tagAt = [cat.pt.x, cat.pt.y + 2, cat.resting, cat.pt.y - 14];
  } else if (cat.at === 'desk') {
    const q = top(cat.perch);
    smooth(q.z, cat.pose, q.x, q.y, false);
    tagAt = [q.x, q.y + 2, true];
  } else if (cat.at === 'hop') {
    const a = end(cat.from), b = end(cat.to), x = a.x + (b.x - a.x) * cat.u, y = a.y + (b.y - a.y) * cat.u - Math.sin(Math.PI * cat.u) * CAT.arc;
    const z = typeof cat.from === 'object' && typeof cat.to === 'object' ? Math.max(a.z, b.z) : (typeof cat.from === 'object' ? b : a).z;
    smooth(z, 'walk', x, y, b.x < a.x);
  } else if (cat.at === 'bowl') {
    const { x, y } = cat.pt, which = cat.which, ms = cat.ms;
    items.push({ z: y, d: () => drawEater(g, which, x, y, ms, calm) });
    hits.push(catHit('eat', x + 1, y));
    tagAt = [x, y + 2, true, y - 12];
  } else {
    smooth(robot.pt.y + 0.1, 'sit', cat.pt.x, cat.pt.y - CAT.lift, false);
    tagAt = [cat.pt.x, cat.pt.y + 2, false];
  }
  if (tagAt) labels.push(catTag(...tagAt));   // last: her tag moves off everyone's, never theirs off hers
  shortHotTags(labels, f.textK);   // a crowded hot tag drops its tool line, as in iso

  if (failing.some(x => x.t >= x.f.medStart - 400 && x.t < x.f.end + 800)) post.push(() => ambulance(g, 8, l.h - 72, now));

  items.sort((p, q) => p.z - q.z).forEach(it => it.d());
  // the night overlay over everything drawn, its lights cut out; rebuilt only when what is lit changes
  if (ph.dark > 0) {
    const box = c.box, leds: Pt[] = [l.stations.wait, l.stations.done].map(st => ({ x: st.x + 11, y: st.y + 11 }));
    if (charge !== 'out') leds.push(...chargerLeds(unit), robotLed(dock.x, dock.y));   // the charger's and the docked robot's LEDs
    const lightsIn: LightsIn = { glass, screens, lamps: lampsOn, hot: hotDesks, burns, clock: c.clock, gauge: { x0: box.x0 + 2, y0: box.y0 + 6, x1: box.x0 + 14, y1: box.y0 + 29 }, racks, leds,
      boardLit: lit, evening: ph.lamps, floorLamps: [{ r: sofaLamp, room: 'wait' }, ...decorOf(l).filter(p => p.name === 'lamp').map(p => ({ r: p, room: p.room }))] };
    const key = [l.key, +ph.lamps, screens.join(','), lampsOn.join(','), hotDesks.join(','), burns.map(b => `${b.pt.x},${b.pt.y}`).join(';'), robot.moving, +lit].join('|');
    applyNight(g, ph.dark, nightLayers(l.w, l.h, key, (m, gl) => cutFlat(m, gl, flatLights(l, lightsIn))));
  }
  post.forEach(p => p());
  const s = sel as { x: number; y: number } | null;
  if (s) {   // the selection outline stays, no parent link lines
    const x0 = Math.round(s.x - 8), y0 = Math.round(s.y - 32);
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(x0 - 0.5, y0 + 1.5, 17, 31);
  }
  return { labels, hits, bodies };
}

export const flat: Renderer = { style: 'flat', ...FLAT, draw };
