import type { AgentView } from '../../../../shared/types.ts';
import { CAT, catHit, type CatPose, type Perch } from '../../logic/cat.ts';
import { POUR, type Trip } from '../../logic/coffee.ts';
import { cornerSpots, freeSpot, gaugeColor, gaugeText } from '../../logic/corner.ts';
import { handover, type CourierPose } from '../../logic/couriers.ts';
import { DESK_LIGHT, failFx, flameCols, medicAt, overworkMin, pointAt, type FailFx } from '../../logic/fx.ts';
import { clearFlames, ENTRY_H, IN_H, isoDepth, isoDeskTag, isoDoor, isoFlameBox, isoProj, isoSign, isoSofaCorner, isoView, isoWaitBalloons, signBox, scan, T, toWorld, WALL_H, type IsoView } from '../../logic/iso.ts';
import { t } from '../../logic/i18n.ts';
import { boardBands, isoLeftGlass, windowGlass } from '../../logic/lights.ts';
import { phase, SCREEN_MS, screenLines, SKY_W, swayDx } from '../../logic/ambient.ts';
import { applyNight, BOARD_GLOW, cutBands, cutPool, drawLamp, nightLayers, paintSky, steamFull, windowBars } from './ambient.ts';
import { tagName } from '../../logic/labels.ts';
import { colorOf } from '../../logic/model.ts';
import { frameOf, type Walker } from '../../logic/motion.ts';
import { chargerOf } from '../../logic/robot.ts';
import { boardOf, CAFE_DX, cafeSide, doneSeats, ISO, isoLine, regionAt, sofaSeats, tailX, TILE, type Layout, type Pt, type Rect, type RoomId } from '../../logic/layout.ts';
import { BOARD_HIT, boardFill, boardLit, boardMarks } from '../../logic/board.ts';
import { atWork, type Dir, type Hit, type Place, type Theme } from '../../logic/scene.ts';
import { WIND } from '../../logic/wind.ts';
import { payHop } from '../../logic/coins.ts';
import { burnParts } from './burn.ts';
import { fireItems } from './fire.ts';
import { serverRacks } from '../../logic/fire.ts';
import { chatClouds, drawCloud } from './chat.ts';
import { coinItems, isoSpots } from './coins.ts';
import { drawClock } from './corner.ts';
import { drawCourier, drawLetter, handAt } from './couriers.ts';
import { ambulance, BOARD_OFF, BOARD_SCREEN_H, bubbleLabel, deskScreen, dirOf, dizzy, doneCheck, drawChar, drawLying, fireGlow, FLAME, flick, iconAt, lot, mug, ring, seatedDesks, seedOf, smoke, sparks, tagLabel, wind } from './flat.ts';
import { catTag, CHARGER_LED, chargerUnit, drawCat, drawEater, drawFood, drawRobot, drawWater, MAT, robotLed } from './pets.ts';
import { labelBox, shortHotTags, type Body, type Frame, type Label, type Renderer } from './renderer.ts';
import { iconBubble, img, medicSheet, mk, px, ready, remember, ROOM_LOOK, size, topDecor, ventXs, wallColor, decorOf } from './sprites.ts';
import { bowlsOf, type DecorName } from '../../logic/decor.ts';
import { idleAct, type IdleAct } from '../../logic/idle.ts';
import { drawCell, idleRole, seatedCell, type Cell } from './decor.ts';

// The isometric office: drawing the flat Layout,
// its walkers and the fx.ts timings through a 2:1 projection (the corridor office, its themed rooms
// and coffee corners). Everything is procedural except the characters and the back wall's decor.
type G = CanvasRenderingContext2D;
type V3 = [number, number, number];
type Proj = (x: number, y: number, z: number) => [number, number];
interface Pal { top: string; x: string; y: string; nx?: string; ny?: string }
interface Spr { c: HTMLCanvasElement; ox: number; oy: number }
type Item = { z: number; d: () => void };

const LIFT_SIT = 3, LIFT_SOFA = 5;   // heights in office px
// the corridor's front (lower) wall as a low cutaway: the robot's lane 1.25 tiles behind
// it rises 10 px, so nothing on the corridor floor (the cat, the robot, its dock, walkers' legs) is hidden
const CUT_H = 8;
const DOOR_ANG = [0, 42, 80];
// a flat walking direction seen on the 2:1 screen: +x runs down-right (side), +y down-left (mirrored side), −x and −y away (back)
const ISO_DIR: Record<Dir, Dir> = { right: 'right', down: 'left', up: 'up', left: 'up' };

/** Darker below 1, towards white above 1. */
function shade(hex: string, k: number): string {
  return '#' + [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(k <= 1 ? c * k : c + (255 - c) * (k - 1)).toString(16).padStart(2, '0');
  }).join('');
}

// --- pixel raster: polygons filled by pixel centres, no anti-aliasing ---
function fillPoly(g: G, pts: [number, number][], color: string) {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  g.fillStyle = color;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    const xs = scan(pts, y);
    for (let k = 0; k + 1 < xs.length; k += 2) { const xa = Math.round(xs[k]), xb = Math.round(xs[k + 1]); if (xb > xa) g.fillRect(xa, y, xb - xa, 1); }
  }
}
const quad = (g: G, P: Proj, q: V3[], c: string) => fillPoly(g, q.map(p => P(...p)), c);
const face = (g: G, P: Proj, n: V3, q: V3[], c: string) => { if (n[0] + n[1] + n[2] > 0) quad(g, P, q, c); };
function box(g: G, P: Proj, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, C: Pal) {
  face(g, P, [-1, 0, 0], [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], C.nx || C.x);
  face(g, P, [0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], C.ny || C.y);
  face(g, P, [1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], C.x);
  face(g, P, [0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], C.y);
  face(g, P, [0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], C.top);
}
function blob(g: G, cx: number, cy: number, r: number, col: string) {
  g.fillStyle = col;
  for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.6)); g.fillRect(Math.round(cx) - w, Math.round(cy) + dy, 2 * w + 1, 1); }
}
function outline(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!, d = g.getImageData(0, 0, c.width, c.height), a = d.data, w = c.width, h = c.height, add: number[] = [];
  const on = (i: number) => a[i * 4 + 3] > 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!on(i) && ((x > 0 && on(i - 1)) || (x < w - 1 && on(i + 1)) || (y > 0 && on(i - w)) || (y < h - 1 && on(i + w)))) add.push(i);
  }
  for (const i of add) { a[i * 4] = 24; a[i * 4 + 1] = 18; a[i * 4 + 2] = 30; a[i * 4 + 3] = 255; }
  g.putImageData(d, 0, 0);
}

/** A piece drawn once around its own origin (world box bx0..by1, zTop high), outlined unless it is a wall piece. */
function bakeB(bx0: number, by0: number, bx1: number, by1: number, zTop: number, draw: (g: G, P: Proj) => void, outlined = true): Spr {
  const minX = Math.floor((bx0 - by1) * 16) - 2, maxX = Math.ceil((bx1 - by0) * 16) + 2;
  const minY = Math.floor((bx0 + by0) * 8 - zTop) - 2, maxY = Math.ceil((bx1 + by1) * 8) + 2;
  // outline reads the pixels back: on a GPU canvas each first getImageData stalls (~20 ms a sprite, ~360 ms for the set
  // on the first iso frame), so an outlined piece is drawn on a CPU one
  const c = mk(maxX - minX, maxY - minY);
  draw(c.getContext('2d', { willReadFrequently: outlined })!, (x, y, z) => [(x - y) * 16 - minX, (x + y) * 8 - z - minY]);
  if (outlined) outline(c);
  return { c, ox: -minX, oy: -minY };
}
const blit = (g: G, P: Proj, s: Spr, x: number, y: number) => { const [sx, sy] = P(x, y, 0); g.drawImage(s.c, Math.round(sx - s.ox), Math.round(sy - s.oy)); };

// palettes: top / +x face / +y face (optional −x, −y)
const WOOD = { top: '#d19a63', x: '#9a6738', y: '#b37b47' }, DARKWOOD = { top: '#8a5c3a', x: '#5e3d24', y: '#734b2e' };
const METAL = { top: '#9aa3b5', x: '#5c6375', y: '#7a8296' }, MONC = { top: '#4a5266', x: '#2a2f3d', y: '#3a4152' };
const CHAIR = { top: '#a0683f', x: '#6e4527', y: '#875533' }, SOFA_C = { top: '#c4466b', x: '#7e2440', y: '#a03455' }, SOFA_BACK = { top: '#d65a7e', x: '#7e2440', y: '#9a3050' };
const CUSH = { top: '#86a7d6', x: '#45618d', y: '#5d7fae' }, POT = { top: '#d27a4a', x: '#8d4326', y: '#b05a34' }, CUP = { top: '#ffffff', x: '#aab2c2', y: '#d6dbe6' };
const BED = { top: '#f8f9fa', x: '#ced4da', y: '#dee2e6' }, POLE = { top: '#6c757d', x: '#343a40', y: '#495057' };
const RUG = { top: '#c9a24a', x: '#8a6d2c', y: '#a3843a' }, RACK = { top: '#3a4458', x: '#1b2130', y: '#2c3446' };
const MACHINE = { top: '#3d4352', x: '#1b1e25', y: '#23262f' }, CARAFE = { top: '#5a3a22', x: '#9fb0c2', y: '#c9d6e3' };
const CABINET = { top: '#2b3242', x: '#141821', y: '#1b2130' };
// the decor pieces' palettes
const WHITE = { top: '#f1f3f5', x: '#aab2c2', y: '#d6dbe6' }, WATER = { top: '#a9dcff', x: '#3b82c4', y: '#5aa6e0' }, PRINT = { top: '#d5d9e1', x: '#7d8496', y: '#a5acbb' };
const RED = { top: '#ff8a8a', x: '#9a1b1b', y: '#e5383b' }, BURG = { top: '#c35d66', x: '#5e2027', y: '#8d2f3a' }, BRASS = { top: '#e0b84a', x: '#8a6d2c', y: '#c9a24a' }, SHADE = { top: '#fff3b0', x: '#c99a2e', y: '#f2cc60' };
const SHADE_LIT = { top: '#fff3b0', x: '#e0b84a', y: '#ffe9a8' };   // a floor lamp lit in the evening
/** A standing decor piece's footprint half sizes in tiles: its sprite stands at the footprint's centre. */
const FOOT: Record<Exclude<DecorName, 'rugWait'>, [number, number]> = {
  cooler: [0.32, 0.3], printer: [0.6, 0.35], extinguisher: [0.18, 0.18], armchair: [0.55, 0.5], lamp: [0.22, 0.22],
  sidetable: [0.3, 0.3], shelf: [1, 0.3], lowtable: [0.85, 0.4], pot: [0.16, 0.16],
};
const wallPal = (w: string): Pal => ({ top: shade(w, 0.58), x: shade(w, 0.87), y: w });
const partPal = (w: string): Pal => ({ top: shade(w, 1.6), x: shade(w, 1.02), y: shade(w, 1.2), nx: shade(w, 0.885), ny: shade(w, 1.08) });

function screen(on: boolean, k: number) {   // the work monitor's screen, on the plane y = −0.24 facing the chair
  return (g: G, P: Proj) => {
    const zq = (x0: number, x1: number, z0: number, z1: number, col: string) => quad(g, P, [[x0, -0.24, z0], [x1, -0.24, z0], [x1, -0.24, z1], [x0, -0.24, z1]], col);
    zq(-0.33, 0.33, 18, 28, on ? '#103a26' : '#151a24');
    if (on) {   // tick k's code lines (screenLines), the fourth the next tick's third, so they scroll up
      const L = [...screenLines(k, 0), screenLines(k + 1, 0)[2]];
      [26, 24, 22, 20].forEach((z, i) => zq(-0.28, -0.28 + 0.56 * L[i].w / 8, z, z + 1, L[i].bright ? '#7ee787' : '#39c5cf'));
    } else zq(0.12, 0.24, 24, 27, '#2a3142');
  };
}
const deskBody = (g: G, P: Proj) => { box(g, P, -0.9, -0.35, 0.9, 0.32, 0, 10, DARKWOOD); box(g, P, -1, -0.45, 1, 0.45, 10, 13, WOOD); };
const workDesk = (on: boolean, k: number) => bakeB(-1.1, -0.5, 1.1, 0.5, 32, (g, P) => {
  deskBody(g, P);
  box(g, P, -0.08, -0.32, 0.08, -0.22, 13, 16, METAL);
  box(g, P, -0.4, -0.36, 0.4, -0.24, 16, 29, MONC);
  screen(on, k)(g, P);
  quad(g, P, [[-0.3, 0.02, 13], [0.3, 0.02, 13], [0.3, 0.22, 13], [-0.3, 0.22, 13]], '#cfd5e2');
});
/** A potted plant; `dx`: its top leaves shifted dx px, its body half of that, the pot still. */
const plant = (pot: number, z: number, r: number, dx = 0) => bakeB(-0.6, -0.6, 0.6, 0.6, z + r + 4, (g, P) => {
  box(g, P, -pot, -pot, pot, pot, 0, 9, POT); box(g, P, -pot - 0.05, -pot - 0.05, pot + 0.05, pot + 0.05, 9, 10, POT);
  const [x, y] = P(0, 0, z), s = r / 8, h = Math.trunc(dx / 2);
  blob(g, x + h, y, r, '#2f7d3a'); blob(g, x - 4 * s + h, y + 2 * s, 5 * s, '#3c9a48'); blob(g, x + 4 * s + dx, y - 3 * s, 5 * s, '#3c9a48');
  blob(g, x + s + dx, y - 7 * s, 4 * s, '#57b85f'); blob(g, x - 3 * s + dx, y - 4 * s, 2 * s, '#6fd07a');
});

let SP: ReturnType<typeof bakeSprites> | null = null;
function bakeSprites() {
  const plants = [-1, 0, 1].map(dx => plant(0.2, 20, 8, dx));   // the large plant swayed 1 px left, still, right
  return {
    deskOff: workDesk(false, 0), deskOn: [0, 1, 2, 3, 4, 5, 6, 7].map(k => workDesk(true, k)),   // 8 scroll ticks
    plants,
    // the foreman faces the room: its monitor stands on the far (+y) side, seen from behind
    deskBack: bakeB(-1.1, -0.5, 1.1, 0.5, 32, (g, P) => {
      deskBody(g, P);
      quad(g, P, [[-0.3, -0.22, 13], [0.3, -0.22, 13], [0.3, -0.02, 13], [-0.3, -0.02, 13]], '#cfd5e2');
      box(g, P, -0.08, 0.22, 0.08, 0.32, 13, 16, METAL);
      box(g, P, -0.4, 0.24, 0.4, 0.36, 16, 29, MONC);
    }),
    seat: bakeB(-0.3, -0.3, 0.3, 0.3, 10, (g, P) => { box(g, P, -0.06, -0.06, 0.06, 0.06, 0, 6, METAL); box(g, P, -0.27, -0.27, 0.27, 0.27, 6, 8, CHAIR); }),
    back: bakeB(-0.3, 0.15, 0.3, 0.35, 22, (g, P) => box(g, P, -0.27, 0.2, 0.27, 0.3, 8, 20, CHAIR)),       // a desk chair's back, viewer side
    backF: bakeB(-0.3, -0.35, 0.3, -0.15, 22, (g, P) => box(g, P, -0.27, -0.3, 0.27, -0.2, 8, 20, CHAIR)),  // the foreman's, wall side
    // the Done lounge's café tables: a round-ish top on a pedestal, two cups; a chair's back away from it
    cafeTable: bakeB(-0.5, -0.5, 0.5, 0.5, 16, (g, P) => {
      box(g, P, -0.25, -0.12, 0.25, 0.12, 0, 1, DARKWOOD); box(g, P, -0.06, -0.06, 0.06, 0.06, 1, 10, DARKWOOD);
      box(g, P, -0.38, -0.28, 0.38, 0.28, 10, 12, WOOD); box(g, P, -0.28, -0.38, 0.28, 0.38, 10, 12, WOOD);
      box(g, P, -0.3, -0.08, -0.16, 0.06, 12, 15, CUP); box(g, P, 0.16, -0.06, 0.3, 0.08, 12, 15, CUP);
    }),
    chairL: bakeB(-0.35, -0.3, 0.3, 0.3, 22, (g, P) => box(g, P, -0.32, -0.27, -0.22, 0.27, 8, 20, CHAIR)),   // its back on −x
    chairR: bakeB(-0.3, -0.3, 0.35, 0.3, 22, (g, P) => box(g, P, 0.22, -0.27, 0.32, 0.27, 8, 20, CHAIR)),     // its back on +x
    sofaTop: bakeB(-1.05, -0.5, 1.05, 0.5, 20, (g, P) => {   // backrest on the wall side, seats face the table
      box(g, P, -1, -0.45, 1, -0.2, 0, 17, SOFA_BACK); box(g, P, -1, -0.2, 1, 0.45, 0, 7, SOFA_C);
      box(g, P, -1, -0.45, -0.78, 0.45, 0, 11, SOFA_C); box(g, P, 0.78, -0.45, 1, 0.45, 0, 11, SOFA_C);
    }),
    sofaSide: bakeB(-0.5, -1.05, 0.5, 1.05, 20, (g, P) => {  // along y, backrest on the −x side (the Waiting room's set opens to +x)
      box(g, P, -0.45, -1, -0.2, 1, 0, 17, SOFA_BACK);
      box(g, P, -0.2, -1, 0.45, 1, 0, 7, SOFA_C);
      box(g, P, -0.45, -1, 0.45, -0.78, 0, 11, SOFA_C); box(g, P, -0.45, 0.78, 0.45, 1, 0, 11, SOFA_C);
    }),
    sofaBottom: bakeB(-1.05, -0.5, 1.05, 0.5, 20, (g, P) => {  // backrest on the viewer side
      box(g, P, -1, -0.45, 1, 0.2, 0, 7, SOFA_C);
      box(g, P, -1, -0.45, -0.78, 0.45, 0, 11, SOFA_C); box(g, P, 0.78, -0.45, 1, 0.45, 0, 11, SOFA_C);
      box(g, P, -1, 0.2, 1, 0.45, 0, 17, SOFA_BACK);
    }),
    table: bakeB(-0.8, -0.45, 0.8, 0.45, 12, (g, P) => {
      box(g, P, -0.6, -0.25, 0.6, 0.25, 0, 6, DARKWOOD); box(g, P, -0.7, -0.35, 0.7, 0.35, 6, 8, WOOD);
      box(g, P, -0.38, -0.12, -0.22, 0.04, 8, 11, CUP); box(g, P, 0.2, 0.02, 0.36, 0.18, 8, 11, CUP);
    }),
    bench: bakeB(-1.05, -0.3, 1.05, 0.3, 10, (g, P) => { box(g, P, -1, -0.25, 1, 0.25, 0, 4, DARKWOOD); box(g, P, -0.95, -0.22, 0.95, 0.22, 4, 7, CUSH); }),
    woodBench: bakeB(-0.55, -0.3, 0.55, 0.3, 10, (g, P) => { box(g, P, -0.45, -0.2, 0.45, 0.2, 0, 4, DARKWOOD); box(g, P, -0.5, -0.25, 0.5, 0.25, 4, 7, WOOD); }),
    plant: plants[1], plantS: plant(0.14, 15, 5),
    bin: bakeB(-0.3, -0.3, 0.3, 0.3, 12, (g, P) => box(g, P, -0.18, -0.18, 0.18, 0.18, 0, 9, METAL)),
    // a server cabinet against the room's left wall, its front (+x) with six slots (the LEDs blink per frame: rackLeds)
    rack: bakeB(-0.5, -0.9, 0.5, 0.9, 32, (g, P) => {
      box(g, P, -0.45, -0.85, 0.45, 0.85, 0, 30, RACK);
      for (let i = 0; i < 6; i++) quad(g, P, [[0.45, -0.65, 25 - i * 4.5], [0.45, 0.65, 25 - i * 4.5], [0.45, 0.65, 28 - i * 4.5], [0.45, -0.65, 28 - i * 4.5]], '#262f42');
    }),
    // the coffee corner (flat's station): table, the machine at its back left, the carafe before it, two mugs
    station: bakeB(-1, -0.7, 1, 0.7, 28, (g, P) => {
      box(g, P, -0.85, -0.5, 0.85, 0.5, 0, 9, DARKWOOD); box(g, P, -0.95, -0.6, 0.95, 0.6, 9, 12, WOOD);
      box(g, P, -0.75, -0.45, -0.2, -0.05, 12, 25, MACHINE); box(g, P, -0.68, 0.05, -0.42, 0.3, 12, 18, CARAFE);
      box(g, P, 0.2, -0.15, 0.38, 0.03, 12, 15, CUP); box(g, P, 0.5, 0.05, 0.68, 0.23, 12, 15, CUP);
    }),
    // the context box: a dark cabinet, its glass front on +x drawn per frame (cabinetFront)
    cabinet: bakeB(-0.5, -0.65, 0.5, 0.05, 32, (g, P) => box(g, P, -0.45, -0.6, 0.45, 0, 0, 30, CABINET)),
    // the charger's floor plate the robot docks on: a low metal pad, two contacts on top
    plate: bakeB(-0.7, -0.3, 0.7, 0.3, 4, (g, P) => {
      box(g, P, -0.62, -0.25, 0.62, 0.25, 0, 2, METAL);
      for (const x of [-0.3, 0.2]) box(g, P, x, -0.06, x + 0.12, 0.06, 2, 2.5, { top: '#f2c14e', x: '#a8822c', y: '#c99f3a' });
    }),
    // the decor pieces, each around its footprint's centre
    cooler: bakeB(-0.4, -0.4, 0.4, 0.4, 26, (g, P) => {
      box(g, P, -0.3, -0.28, 0.3, 0.28, 0, 15, WHITE); quad(g, P, [[-0.15, 0.28, 8], [0.15, 0.28, 8], [0.15, 0.28, 11], [-0.15, 0.28, 11]], '#2b3240');
      box(g, P, -0.2, -0.2, 0.2, 0.2, 15, 25, WATER);
    }),
    printer: bakeB(-0.7, -0.45, 0.7, 0.45, 22, (g, P) => {
      box(g, P, -0.6, -0.35, 0.6, 0.35, 0, 10, DARKWOOD); box(g, P, -0.55, -0.3, 0.55, 0.3, 10, 17, PRINT);
      quad(g, P, [[-0.3, -0.2, 17.2], [0.3, -0.2, 17.2], [0.3, 0.1, 17.2], [-0.3, 0.1, 17.2]], '#ffffff'); quad(g, P, [[-0.45, 0.3, 13], [0.35, 0.3, 13], [0.35, 0.3, 14], [-0.45, 0.3, 14]], '#1f2430');
    }),
    extinguisher: bakeB(-0.25, -0.25, 0.25, 0.25, 15, (g, P) => { box(g, P, -0.15, -0.15, 0.15, 0.15, 0, 11, RED); box(g, P, -0.06, -0.06, 0.06, 0.06, 11, 13, MACHINE); }),
    armchair: bakeB(-0.65, -0.6, 0.65, 0.6, 20, (g, P) => {
      box(g, P, -0.55, -0.5, 0.55, 0.5, 0, 7, BURG); box(g, P, -0.55, -0.5, 0.55, -0.25, 7, 18, BURG);
      box(g, P, -0.55, -0.25, -0.35, 0.5, 7, 11, BURG); box(g, P, 0.35, -0.25, 0.55, 0.5, 7, 11, BURG);
    }),
    lamp: bakeB(-0.3, -0.3, 0.3, 0.3, 32, (g, P) => { box(g, P, -0.18, -0.18, 0.18, 0.18, 0, 2, BRASS); box(g, P, -0.04, -0.04, 0.04, 0.04, 2, 22, BRASS); box(g, P, -0.2, -0.2, 0.2, 0.2, 22, 29, SHADE); }),
    lampLit: bakeB(-0.3, -0.3, 0.3, 0.3, 32, (g, P) => { box(g, P, -0.18, -0.18, 0.18, 0.18, 0, 2, BRASS); box(g, P, -0.04, -0.04, 0.04, 0.04, 2, 22, BRASS); box(g, P, -0.2, -0.2, 0.2, 0.2, 22, 29, SHADE_LIT); }),
    sidetable: bakeB(-0.4, -0.4, 0.4, 0.4, 16, (g, P) => {
      box(g, P, -0.06, -0.06, 0.06, 0.06, 0, 7, DARKWOOD); box(g, P, -0.3, -0.3, 0.3, 0.3, 7, 9, WOOD);
      box(g, P, -0.18, -0.12, 0.14, 0.1, 9, 11, RED); box(g, P, -0.12, -0.06, 0.12, 0.08, 11, 12, CUSH);
    }),
    shelf: bakeB(-1.1, -0.4, 1.1, 0.4, 34, (g, P) => {
      box(g, P, -1, -0.3, 1, 0.3, 0, 30, DARKWOOD);
      const C = ['#e5383b', '#3b82f6', '#f2cc60', '#7ee787', '#c8a6ff', '#ffa657'];
      for (let s = 0; s < 3; s++) for (let b = 0; b < 9; b++) {
        const u = -0.9 + b * 0.2;
        quad(g, P, [[u, 0.3, 3 + s * 9], [u + 0.15, 0.3, 3 + s * 9], [u + 0.15, 0.3, 9 + s * 9 - (b % 3)], [u, 0.3, 9 + s * 9 - (b % 3)]], C[(b * 7 + s * 3) % 6]);
      }
    }),
    lowtable: bakeB(-0.95, -0.5, 0.95, 0.5, 12, (g, P) => {
      box(g, P, -0.75, -0.3, 0.75, 0.3, 0, 6, DARKWOOD); box(g, P, -0.85, -0.4, 0.85, 0.4, 6, 8, WOOD);
      quad(g, P, [[-0.6, -0.2, 8.2], [-0.15, -0.2, 8.2], [-0.15, 0.2, 8.2], [-0.6, 0.2, 8.2]], '#79c0ff'); quad(g, P, [[0.1, -0.15, 8.2], [0.6, -0.15, 8.2], [0.6, 0.25, 8.2], [0.1, 0.25, 8.2]], '#ff9ecf');
    }),
    pot: plant(0.14, 15, 5),
  };
}

function rackLeds(g: G, P: Proj, x: number, y: number, now: number, seed: number) {   // flat's rack LEDs on the iso front
  for (let i = 0; i < 6; i++) {
    const k = (Math.floor(now / (180 + i * 37)) + seed + i) % 5, z = 27 - i * 4.5, [ax, ay] = P(x + 0.45, y + 0.45, z), [bx, by] = P(x + 0.45, y + 0.25, z);
    px(g, k === 0 ? '#ffb703' : k < 3 ? '#39d353' : '#0f3d1c', ax, ay, 1, 1);
    if (i % 2) px(g, k === 4 ? '#79c0ff' : '#14304d', bx, by, 1, 1);
  }
}

/** flat drawGaugeBox's front on the cabinet's +x face: its column u (0..16) runs from y to y − 0.6, its row r stands at z 30 − r. */
function cabinetFront(g: G, P: Proj, x: number, y: number, v: number | null, now: number, working: boolean) {
  const Y = (u: number) => y - 0.6 * u / 16, at = (u: number, r: number) => P(x + 0.45, Y(u), 30 - r);
  const r = (u: number, r0: number, w: number, h: number, c: string) =>
    quad(g, P, [[x + 0.45, Y(u), 30 - r0 - h], [x + 0.45, Y(u + w), 30 - r0 - h], [x + 0.45, Y(u + w), 30 - r0], [x + 0.45, Y(u), 30 - r0]], c);
  px(g, Math.floor(now / 500) % 2 ? '#39d353' : '#0f3d1c', ...at(3, 4), 1, 1);
  px(g, working && Math.floor(now / 120) % 2 ? '#79c0ff' : '#14304d', ...at(5, 4), 1, 1);
  r(2, 6, 12, 23, '#0d121c');                              // glass
  r(5, 7, 6, 21, '#4b5670'); r(6, 8, 4, 19, '#121826');   // tube
  const h = v === null ? 0 : Math.round(19 * v / 100);
  if (h > 0) {
    r(6, 27 - h, 4, h, gaugeColor(v));
    g.globalAlpha = 0.45; r(6, 27 - h, 4, 1, '#ffffff');
    if (h > 3) { g.globalAlpha = 0.7; px(g, '#ffffff', ...at(7 + Math.floor(now / 400) % 2, 26 - Math.floor(now / 90) % (h - 1)), 1, 1); }
    g.globalAlpha = 1;
  }
}

// the box sign's last spot (freeSpot's prev) per floor and layout: OfficeFloor keeps one walkers map per floor, and
// during a floor slide two floors of the same size draw by turns
const signAt = new WeakMap<Frame['walkers'], { key: string; i: number }>();
let clk: HTMLCanvasElement | null = null;   // the digital clock, redrawn every frame before it is sheared onto the back wall
let skyBuf: HTMLCanvasElement | null = null;   // one window's sky (≤ 22 × 18), painted flat before it is sheared onto its wall

const walls = new Map<string, Spr>();
/** One inner-wall piece in `wall`'s colours: `len` tiles along y (vertical) or x, its room-side face at the origin. */
function wallPiece(wall: string, len: number, horiz: boolean, h = IN_H): Spr {
  const key = `${wall}${horiz ? 'h' : 'v'}${len}:${h}`;
  let s = walls.get(key);
  if (!s) {
    const [x0, y0, x1, y1] = horiz ? [0, -T, len, 0] : [-T, 0, 0, len];
    walls.set(key, s = bakeB(x0, y0, x1, y1, h, (g, P) => box(g, P, x0, y0, x1, y1, 0, h, partPal(wall)), false));
  }
  return s;
}

const baked = new Map<string, HTMLCanvasElement>();
/** The static background: floor slab and tiles per room, the corridor runner and library rug, the back wall in its
 *  owners' colours with flat's top wall decor sheared onto it, the left wall with windows and the entrance. */
function background(l: Layout, v: IsoView, th: Theme): HTMLCanvasElement {
  const key = `${th.work}${th.wall}:${l.key}`;
  let c = baked.get(key);
  if (c) return c;
  c = mk(v.w, v.h);
  const g = c.getContext('2d')!, P: Proj = (x, y, z) => isoProj(v, x, y, z), D = v.depth, C = l.cols;
  box(g, P, 0, 0, C, D, -6, 0, { top: '#000', x: '#262b38', y: '#2f3546' });
  // the main office's planks take the floor theme; every other room its own tint
  const pal = (id: RoomId) => { const t = id === 'main' ? th.work : ROOM_LOOK[id].tint; return [t, shade(t, 0.955), shade(t, id === 'main' ? 1.035 : 0.82)]; };
  for (let y = 0; y < D; y++) for (let x = 0; x < C; x++) {
    const id = regionAt(l, x, y + 2), p = pal(id);
    const [tx, ty] = P(x, y, 0), [rx, ry] = P(x + 1, y, 0), [bx, by] = P(x + 1, y + 1, 0), [lx, ly] = P(x, y + 1, 0);
    if (id === 'main') {   // wood planks with a seam on the back-right edge
      fillPoly(g, [[tx, ty], [rx, ry], [bx, by], [lx, ly]], p[(x * 7 + y * 3) % 2]);
      fillPoly(g, [[tx, ty], [rx, ry], [rx, ry + 1], [tx, ty + 1]], shade(th.work, 0.83));
    } else {        // tiles with 1 px grout
      fillPoly(g, [[tx, ty], [rx, ry], [bx, by], [lx, ly]], p[2]);
      fillPoly(g, [[tx, ty + 1], [rx - 2, ry], [bx, by - 1], [lx + 2, ly]], p[(x + y) % 2]);
    }
  }
  // flat's corridor runner along the walking line and library rug around its desks, as thin boxes on the floor
  const top = (x0: number, y0: number, x1: number, y1: number, col: string) => quad(g, P, [[x0, y0, 1], [x1, y0, 1], [x1, y1, 1], [x0, y1, 1]], col);
  const hx = l.rooms.hall.x0 / TILE, hy = toWorld({ x: 0, y: l.hallY }).y;
  box(g, P, hx, hy - 0.35, C, hy + 0.35, 0, 1, RUG); top(hx, hy - 0.22, C, hy + 0.22, '#7d2f35');
  for (let x = hx + 0.25; x < C; x += 0.5) { const [sx, sy] = P(x, hy, 1); px(g, '#a8454d', sx - 1, sy, 2, 1); }
  const lib = l.rooms.library, ys = l.desks.filter(d => d.room === 'library').map(d => d.y);
  const r0 = toWorld({ x: lib.x0 + 6, y: Math.min(...ys) - 8 }), r1 = toWorld({ x: lib.x1 - 22, y: Math.max(...ys) + 52 });
  box(g, P, r0.x, r0.y, r1.x, r1.y, 0, 1, RUG); top(r0.x + 0.12, r0.y + 0.12, r1.x - 0.12, r1.y - 0.12, '#5e2630');
  top(r0.x + 0.3, r0.y + 0.3, r1.x - 0.3, r1.y - 0.3, '#9a7a3c'); top(r0.x + 0.36, r0.y + 0.36, r1.x - 0.36, r1.y - 0.36, '#5e2630');
  for (const p of decorOf(l)) if (p.name === 'rugWait') {   // the Waiting room's rug, like the library's
    const a = toWorld({ x: p.x0, y: p.y0 }), b = toWorld({ x: p.x1, y: p.y1 });
    box(g, P, a.x, a.y, b.x, b.y, 0, 1, { top: '#2f4a6b', x: '#1e3047', y: '#26405e' }); top(a.x + 0.12, a.y + 0.12, b.x - 0.12, b.y - 0.12, '#3f6b96');
    top(a.x + 0.3, a.y + 0.3, b.x - 0.3, b.y - 0.3, '#8fb6da'); top(a.x + 0.36, a.y + 0.36, b.x - 0.36, b.y - 0.36, '#3f6b96');
  }
  // the back wall, one box per owner room (flat's top row), then the left wall (the main office's)
  const runs: { c0: number; c1: number; id: RoomId }[] = [];
  for (let x = 0; x < C; x++) {
    const id = l.walls.get(`${x},1`)!, r = runs[runs.length - 1];
    if (r && r.id === id) r.c1 = x + 1; else runs.push({ c0: x, c1: x + 1, id });
  }
  for (const r of runs) {
    const w = wallColor(th, r.id);
    box(g, P, r.c0 || -T, -T, r.c1, 0, 0, WALL_H, wallPal(w));
    face(g, P, [0, 1, 0], [[r.c0, 0, 0], [r.c1, 0, 0], [r.c1, 0, 5], [r.c0, 0, 5]], shade(w, 0.69));
  }
  const ey = toWorld(l.doors[0]).y;
  box(g, P, -T, 0, 0, D, 0, WALL_H, wallPal(th.wall));
  face(g, P, [1, 0, 0], [[0, 0, 0], [0, D, 0], [0, D, 5], [0, 0, 5]], shade(th.wall, 0.62));
  face(g, P, [1, 0, 0], [[0, ey - 0.65, 0], [0, ey + 0.65, 0], [0, ey + 0.65, ENTRY_H + 3], [0, ey - 0.65, ENTRY_H + 3]], '#4a3a30');
  face(g, P, [1, 0, 0], [[0, ey - 0.45, 0], [0, ey + 0.45, 0], [0, ey + 0.45, ENTRY_H], [0, ey - 0.45, ENTRY_H]], '#07080c');
  for (const [g0, g1] of isoLeftGlass(l)) {
    const q = (p: number, r: number, z0: number, z1: number, col: string) => face(g, P, [1, 0, 0], [[0, p, z0], [0, r, z0], [0, r, z1], [0, p, z1]], col);
    const m = g0 + 0.7;
    q(g0 - 0.1, g1 + 0.1, 17, 39, '#3d4563'); q(g0, g1, 19, 37, '#8fb6da'); q(m - 0.04, m + 0.04, 19, 37, '#3d4563');
  }
  // flat's top wall decor (main office, server vents and sign, library shelves and leaded windows) as one strip,
  // pixel-exact 2:1 shear (column shifts, no resampling), flat y 0 at 4 px under the wall top
  const strip = mk(l.w, 32), [sx, sy] = P(0, 0, WALL_H - 4);
  topDecor(strip.getContext('2d')!, l);
  for (let i = 0; i < l.w; i++) g.drawImage(strip, i, 0, 1, 32, sx + i, sy + Math.floor(i / 2), 1, 32);
  remember(baked, key, c);
  return c;
}

function stretcher(g: G, P: Proj, cx: number, cy: number, vert: boolean) {   // along the corridor it is carried on
  const [ax, ay] = vert ? [0.3, 1.1] : [1.1, 0.3];
  box(g, P, cx - ax, cy - ay, cx + ax, cy + ay, 8, 10, BED);
  for (const s of [-1, 1]) {
    if (vert) box(g, P, cx + s * 0.33 - 0.03, cy - 1.35, cx + s * 0.33 + 0.03, cy + 1.35, 9, 10.5, POLE);
    else box(g, P, cx - 1.35, cy + s * 0.33 - 0.03, cx + 1.35, cy + s * 0.33 + 0.03, 9, 10.5, POLE);
  }
  const top = (x0: number, y0: number, x1: number, y1: number) => quad(g, P, [[x0, y0, 10], [x1, y0, 10], [x1, y1, 10], [x0, y1, 10]], '#e5383b');
  if (vert) { top(cx - 0.05, cy + 0.6, cx + 0.05, cy + 0.95); top(cx - 0.16, cy + 0.72, cx + 0.16, cy + 0.83); }   // red cross at the foot end
  else { top(cx + 0.6, cy - 0.05, cx + 0.95, cy + 0.05); top(cx + 0.72, cy - 0.16, cx + 0.83, cy + 0.16); }
}

function staticNoise(g: G, P: Proj, dx: number, dy: number, now: number) {   // red static on the slanted work screen
  const k = Math.floor(now / 60), [x0, y0] = P(dx - 0.3, dy - 0.24, 27);
  for (let xx = 0; xx < 9; xx++) for (let yy = 0; yy < 8; yy++) {
    const n = (xx * 73 + yy * 151 + k * 197) % 11;
    px(g, n < 3 ? '#ff4d4d' : n < 6 ? '#7a1010' : '#1a0505', x0 + 1 + xx, y0 + Math.floor((xx + 1) / 2) + yy, 1, 1);
  }
}

// the overwork fire on a work monitor (a full-bodied flame): a tall row from behind the
// monitor, a short bright one licking the screen's top edge, both on the iso x axis; the monitor top glowing, its
// light on the desk top
const FIRE = ['#d62828', '#f77f00', '#ffb703', '#fff3b0'], FIRE_DIM = ['#9a1b1b', '#c25400', '#de9200', '#ffd77a'];
/** Flames standing on the world line y from x0 to x1 at height z, a pixel column at a time so their base runs down the
 *  2:1 iso x axis; the last 4 columns (the +x side) a shade darker. */
function flameRow(g: G, P: Proj, x0: number, x1: number, y: number, z: number, now: number, seed: number, hk: number) {
  const [sx, sy] = P(x0, y, z), n = Math.round((x1 - x0) * 16);
  flameCols(FLAME[flick(now, seed)], n, hk).forEach((hs, u) => hs.forEach((h, L) => {
    if (h > 0) px(g, (u >= n - 4 ? FIRE_DIM : FIRE)[L], Math.round(sx) + u, Math.round(sy) + Math.floor(u / 2) - h, 1, h);
  }));
}
/** Sparks rising off the front row's sloped base. */
function fireSparks(g: G, P: Proj, dx: number, dy: number, now: number, seed: number) {
  const [sx, sy] = P(dx - 0.4, dy - 0.3, 29);
  for (let i = 0; i < 5; i++) {
    const ph = (now / 1600 + i / 5 + seed) % 1, u = (i * 5 + Math.floor(seed * 3)) % 13;
    g.globalAlpha = 1 - ph;
    px(g, FIRE[[3, 2, 1][i % 3]], sx + u + Math.sin(ph * 5 + i) * 2, sy + u / 2 - 6 - ph * 14, 1, 1);
  }
  g.globalAlpha = 1;
}
/** The monitor's top glowing and the flame's light on the desk top round it (DESK_LIGHT), flickering with the flame. */
function deskLight(g: G, P: Proj, dx: number, dy: number, now: number, seed: number) {
  const k = flick(now, seed), top = (x0: number, x1: number, y0: number, y1: number, z: number, c: string) =>
    quad(g, P, [[dx + x0, dy + y0, z], [dx + x1, dy + y0, z], [dx + x1, dy + y1, z], [dx + x0, dy + y1, z]], c);
  top(-0.4, 0.4, -0.36, -0.24, 29, '#ff9b2e');
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = [0.07, 0.055, 0.065, 0.05][k];
  for (const [x0, x1, y0, y1] of DESK_LIGHT) top(x0, x1, y0, y1, 13, '#ff7a1a');
  g.restore();
}

function draw(g: G, f: Frame): { labels: Label[]; hits: Hit[]; bodies: Body[] } {
  const l = f.scene.layout, now = f.now, v = isoView(l.cols, l.rows);
  const labels: Label[] = [], hits: Hit[] = [], bodies: Body[] = [], flames = new Map<string, Rect>();   // flames: each hot desk's flame box by its agent
  g.clearRect(0, 0, v.w, v.h);
  if (!ready()) return { labels, hits, bodies };
  const rest = (id: string, x: number, y: number) => bodies.push({ id, x0: x - 8, y0: y - 32, x1: x + 8, y1: y });   // a sprite at rest
  const sp = SP ??= bakeSprites();
  const P: Proj = (x, y, z) => isoProj(v, x, y, z);
  const S = (p: Pt, z = 0) => { const w = toWorld(p); return P(w.x, w.y, z); };   // a flat feet point on the iso screen
  const D = (p: Pt) => { const w = toWorld(p); return isoDepth(w.x, w.y); };
  g.drawImage(background(l, v, f.theme), 0, 0);
  // the digital clock behind the foreman, sheared like background's wall strip (its place there is left empty)
  const clockX = cornerSpots(l).clock.x0, cv = f.corner.visit, [wx, wy] = P(0, 0, WALL_H - 4), cg = (clk ??= mk(26, 12)).getContext('2d')!;
  cg.clearRect(0, 0, 26, 12); drawClock(cg, 0, 0, new Date());
  for (let j = 0; j < 26; j++) g.drawImage(clk, j, 0, 1, 12, wx + clockX + j, wy + Math.floor((clockX + j) / 2) + 8, 1, 12);
  // the local clock and prefers-reduced-motion (`rm`: `calm` names the still labels below)
  const date = f.ambient.date, rm = f.ambient.calm, ph = phase(date), skyT = rm ? 0 : date.getTime();
  // the sky painted flat per window, then sheared onto its wall a pixel column at a time: the
  // back wall's glass as background's strip (flat column x at wx + x, wy + ⌊x / 2⌋), the left wall's from its top end
  const glass = windowGlass(l, size), sb = (skyBuf ??= mk(24, 18)).getContext('2d')!;
  for (const w of glass) {
    const gw = w.x1 - w.x0;
    sb.clearRect(0, 0, 24, 18); paintSky(sb, 0, 0, gw, 18, w.x0 % SKY_W, skyT, ph); windowBars(sb, { x0: 0, y0: 0, x1: gw, y1: 18, lead: w.lead });
    for (let i = 0; i < gw; i++) g.drawImage(skyBuf, i, 0, 1, 18, wx + w.x0 + i, wy + Math.floor((w.x0 + i) / 2) + 6, 1, 18);
  }
  const leftGlass = isoLeftGlass(l).map(([g0, g1]) => ({ g0, w: Math.round((g1 - g0) * 16), at: P(0, g1, 37) }));
  for (const { g0, w, at: [bx, by] } of leftGlass) {
    sb.clearRect(0, 0, 24, 18); paintSky(sb, 0, 0, w, 18, (1600 + g0 * 16) % SKY_W, skyT, ph); px(sb, '#3d4563', w >> 1, 0, 1, 18);
    for (let i = 0; i < w; i++) g.drawImage(skyBuf, i, 0, 1, 18, bx + i, by - Math.ceil(i / 2), 1, 18);   // ceil: background's glass rows exactly
  }
  const items: Item[] = [], post: (() => void)[] = [];
  const put = (s: Spr, x: number, y: number, bias = 0, alpha = 1, over?: () => void) => items.push({ z: isoDepth(x, y) + bias, d: () => {
    g.globalAlpha = alpha; blit(g, P, s, x, y); over?.(); g.globalAlpha = 1;
  } });
  const tag = (id: string, a: AgentView, x: number, y: number, failed = false, hot: number | null = null) => labels.push(tagLabel(id, a, x, y, failed, hot));
  const rect = (id: string, x: number, y: number, z: number): Hit => ({ id, x0: x - 8, y0: y - 32, x1: x + 8, y1: y, z });   // the projected sprite
  let sel: { x: number; y: number } | null = null;
  const sprites: Rect[] = [];   // every agent drawn (screen, 5 px headroom): no balloon covers one
  /** A character at a flat feet point, `lift` px up (seated); returns its drawn feet on screen. */
  const char = (id: string, p: Place, w: Walker, col: number, row: number, at: Pt, flip = false, lift = 0, bias = 0): [number, number] => {
    const alpha = p.alpha * Math.min(1, 0.2 + (now - w.bornAt) / 600), [sx, sy] = S(at), y = sy - lift;
    items.push({ z: D(at) + bias, d: () => drawChar(g, img(`char_${p.sprite}`), col, row, sx, y, flip, alpha) });
    if (id === f.selectedId) sel = { x: sx, y };
    sprites.push({ x0: sx - 8, y0: y - 37, x1: sx + 8, y1: y });
    return [sx, y];
  };
  /** `char` for a seated agent's cell (decor.ts seatedCell); a 40 px idle frame's box rises 8 px. */
  const seatedChar = (id: string, p: Place, w: Walker, cell: Cell, at: Pt, lift: number): [number, number] => {
    const alpha = p.alpha * Math.min(1, 0.2 + (now - w.bornAt) / 600), [sx, sy] = S(at), y = sy - lift;
    items.push({ z: D(at), d: () => drawCell(g, cell, sx, y, alpha) });
    if (id === f.selectedId) sel = { x: sx, y };
    sprites.push({ x0: sx - 8, y0: y - 37 - (cell.h - 32), x1: sx + 8, y1: y });
    return [sx, y];
  };
  const deskW =(d: { seat: Pt }) => { const s = toWorld(d.seat); return { x: s.x, y: s.y - 1 }; };   // the desk one tile behind its chair
  const deskTag = (d: { seat: Pt }, hot: boolean) => isoDeskTag(l, d.seat, f.textK, hot ? 19 : null);   // a tag with its pill ~19 text px

  /** A work room's floor diamond on screen (its regionAt tiles), as fireGlow's row span. */
  const floorSpan = (id: RoomId) => {
    let c0 = Infinity, c1 = 0, r0 = Infinity, r1 = 0;
    for (let r = 2; r < l.rows; r++) for (let c = 0; c < l.cols; c++) if (regionAt(l, c, r) === id) { c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
    const pts = ([[c0, r0 - 2], [c1 + 1, r0 - 2], [c1 + 1, r1 - 1], [c0, r1 - 1]] as const).map(([x, y]) => P(x, y, 0));
    return (y: number): [number, number] => { const xs = scan(pts, y); return xs.length ? [Math.round(xs[0]), Math.round(xs[xs.length - 1])] : [0, 0]; };
  };

  // a failure, the flat timings: sits with a red screen → stands, sways → faints beside the desk → the medics carry it out
  const failSequence = (id: string, a: AgentView, p: Place, w: Walker, x: FailFx) => {
    const { desk: d, t, f: ft } = x, seat = d.seat, ly = seat.y + 10, sheet = img(`char_${p.sprite}`);
    if (t >= ft.end) return;
    const end = pointAt(x.path, x.len), [ex, ey] = S(end, 12);   // where the stretcher waits
    if (t < ft.stand) {
      const [sx, sy] = char(id, p, w, frameOf('type', 'up', now).col, 1, seat, false, LIFT_SIT);
      tag(id, a, ...deskTag(d, false), true);
      hits.push(rect(id, sx, sy, D(seat)));
    } else if (t < ft.fall) {   // up into the aisle in 180 ms, then it sways
      const up = t < ft.stand + 180, bx = up ? seat.x : seat.x + Math.round(Math.sin(t / 90) * 1.5), by = up ? seat.y + (t - ft.stand) / 18 : ly;
      const [sx, sy] = char(id, p, w, 1, 0, { x: bx, y: by }, !up && Math.floor(t / 260) % 2 === 1);
      tag(id, a, sx, sy - 48, true);
    } else if (t < ft.leave) {   // on the floor (90° in 300 ms), lifted onto the stretcher once the team is there
      const k = t < ft.arrive ? 0 : (t - ft.arrive) / (ft.leave - ft.arrive), [fx0, fy0] = S({ x: seat.x, y: ly });
      const fx = fx0 + (ex + 16 - fx0) * k, fy = fy0 + (ey - fy0) * k;
      const ang = Math.min(1, (t - ft.fall) / 300), stars = t > ft.fall + 300 && t < ft.arrive;
      items.push({ z: k ? D(end) + 0.4 : D({ x: seat.x, y: ly }) + 0.5, d: () => { drawLying(g, sheet, fx, fy, ang); if (stars) dizzy(g, fx - 28, fy - 12, now); } });
      tag(id, a, Math.max(fx - 16, 30), fy - 30, true);
    }
    const s = medicAt(t, ft, x.len);
    if (s === null) return;
    const back = t >= ft.leave, walking = t < ft.arrive || back;
    const m = [20, -20].map(o => pointAt(x.path, s + o)), c = pointAt(x.path, s), cw = toWorld(c);
    m.forEach((q, k) => {
      const n = pointAt(x.path, s + (k ? -20 : 20) + (back ? -1 : 1)), fr = frameOf(walking ? 'walk' : 'still', ISO_DIR[dirOf(n.x - q.x, n.y - q.y)], now), [qx, qy] = S(q);
      items.push({ z: D(q), d: () => drawChar(g, medicSheet(k as 0 | 1), fr.col, fr.row, qx, qy, fr.flip, 1) });
    });
    const vert = Math.abs(m[0].x - m[1].x) < Math.abs(m[0].y - m[1].y), [cx, cy] = S(c, 12);
    items.push({ z: isoDepth(cw.x, cw.y) + 0.3, d: () => { stretcher(g, P, cw.x, cw.y, vert); if (back) drawLying(g, sheet, cx + 16, cy, 1); } });
    if (back) tag(id, a, Math.max(cx - 2, 30), cy - 35, true);
  };

  // inner walls (flat's l.walls below the top wall) in their owner room's colour, one tile piece at a time so each sorts
  // with its neighbours, the pieces of a run meeting into one wall: along y on a cell's right edge where the cell has a
  // wall above or below; along x on the corridor's edge (inside the cell) where the cell borders the corridor
  const isWall = (c: number, r: number) => l.walls.has(`${c},${r}`), hall = (c: number, r: number) => regionAt(l, c, r) === 'hall';
  for (const [key, id] of l.walls) {
    const [c, r] = key.split(',').map(Number), col = wallColor(f.theme, id);
    if (r < 2 || c === 0) continue;
    if (hall(c, r + 1)) put(wallPiece(col, 1, true), c, r - 1, 0.5 - T / 2);
    else if (hall(c, r - 1)) put(wallPiece(col, 1, true, CUT_H), c, r - 2 + T, 0.5 - T / 2);   // the corridor's front wall, cut away
    if (isWall(c, r - 1) || isWall(c, r + 1)) put(wallPiece(col, 1, false), c + 1, r - 2, 0.5 - T / 2);
  }
  // doors: in and hall open in a wall along y (hall a double door), the four room doors in the corridor walls along x;
  // each leaf turns by door.k from its hinge into its room; each sign over its door or on the wall beside it
  l.doors.forEach((d, i) => {
    const ang = DOOR_ANG[f.doors[i].k] * Math.PI / 180, { leaves, len, h } = isoDoor(l, d);
    for (const [hx, hy, cx, cy, ox, oy] of leaves) {
      const ux = (cx * Math.cos(ang) + ox * Math.sin(ang)) * len, uy = (cy * Math.cos(ang) + oy * Math.sin(ang)) * len;
      const at = (u: number, z: number): V3 => [hx + ux * u, hy + uy * u, z];
      items.push({ z: isoDepth(hx + ux / 2, hy + uy / 2) + 0.2, d: () => {
        quad(g, P, [at(0, 0), at(1, 0), at(1, h), at(0, h)], '#6b4730');
        quad(g, P, [at(0.14, 3), at(0.86, 3), at(0.86, h - 3), at(0.14, h - 3)], '#8d6142');
        const [kx, ky] = P(...at(0.8, h * 0.45)); g.fillStyle = '#f2cc60'; g.fillRect(Math.round(kx), Math.round(ky), 1, 2);
      } });
    }
    const text = t(`door.${d.id}`), before = labels.flatMap(x => x.kind === 'sign' ? [signBox(x, x.text, f.textK)] : []);
    labels.push({ kind: 'sign', key: 'door-' + d.id, ...isoSign(l, d, f.textK, text, before), text, tone: d.id });
  });

  // furniture that is always there: the foreman desk, every work desk, the Waiting room benches, the Done lounge, plants
  const F = toWorld(l.foreman.seat);
  // the seated agents' idle acts this frame (none when calm); a sip takes its desk's mug
  const reading = f.couriers.some(c => c.give !== null && handover(c.give).read), idle = new Map<string, IdleAct | null>();
  for (const [id, p] of f.scene.places) {
    const w = f.walkers.get(id), a = f.agents.get(id);
    if (!w || w.moving || !a) continue;
    const role = idleRole(p, a, cv !== null, reading);
    if (role) idle.set(id, idleAct(a.key, role, now, rm));
  }
  const sips = new Set([...f.scene.places].filter(([id, p]) => p.kind === 'desk' && idle.get(id)?.kind === 'sip').map(([, p]) => p.desk!));
  const foremanSips = [...f.scene.places].some(([id, p]) => p.kind === 'foreman' && idle.get(id)?.kind === 'sip');
  /** A mug on a desk top (z 13), its coffee showing. */
  const cup = (mx: number, my: number) => {
    box(g, P, mx - 0.09, my - 0.09, mx + 0.09, my + 0.09, 13, 17, CUP);
    quad(g, P, [[mx - 0.07, my - 0.07, 17.1], [mx + 0.07, my - 0.07, 17.1], [mx + 0.07, my + 0.07, 17.1], [mx - 0.07, my + 0.07, 17.1]], '#6b4423');
  };
  put(sp.backF, F.x, F.y, -0.2); put(sp.seat, F.x, F.y, -0.1); put(sp.deskBack, F.x, F.y + 1, 0, 1, () => {
    if (!foremanSips) cup(F.x + 0.05, F.y + 1.2);
    const [lx, ly] = P(F.x + 0.7, F.y + 0.9, 13); drawLamp(g, lx, ly, ph.lamps);   // the +x end, the letter and Smooth at −x
  });
  // the context box left of the desk (flat's feet point); sparks rise off its glass while the foreman works at it
  const cb = toWorld({ x: l.foreman.seat.x - 48, y: l.foreman.seat.y + 12 }), working = cv?.pose === 'type';
  put(sp.cabinet, cb.x, cb.y, 0, 1, () => cabinetFront(g, P, cb.x, cb.y, f.corner.value, now, working));
  if (working) post.push(() => { const [x, y] = P(cb.x + 0.5, cb.y - 0.3, 18); sparks(g, x, y, seedOf('gauge'), now); });
  const seated = seatedDesks(f), fails = failFx(f.scene, f.walkers, now), failing = [...fails.values()];
  // what stays lit at night (the overlay's cut-outs), gathered as the office is laid out
  const tick = rm ? 0 : Math.floor(now / SCREEN_MS), screens: number[] = [], lampsOn: number[] = [], hotDesks: number[] = [];
  const burns: { pt: Pt; x: number; y: number; room: RoomId }[] = [], leds: [number, number, number][] = [];   // burns: flat point (the key), screen glow centre; leds: x, y, width
  l.desks.forEach((d, i) => {
    const fl = failing.find(x => x.desk === d), scr = deskScreen(seated.get(i), fl), s = toWorld(d.seat), dw = deskW(d);
    if (fl || scr.on) screens.push(i);   // a failing desk's screen stays cut out all through its sequence
    if (scr.smoke > 0) { const [cx, base] = P(dw.x, dw.y - 0.3, 29); post.push(() => smoke(g, cx, base, scr.smoke, now)); }
    const [lx, ly] = P(dw.x - 0.7, dw.y - 0.15, 13), lit = ph.lamps && atWork(seated.get(i));   // the banker's lamp left of the monitor
    if (lit) lampsOn.push(i);   // its pool in the night overlay
    const props = scr.on && !fl;   // a working desk's papers (front left, clear of the lamp) and mug (front right)
    put(scr.on ? sp.deskOn[(tick + i * 3) % 8] : sp.deskOff, dw.x, dw.y, 0, 1, () => {
      if (scr.noise) staticNoise(g, P, dw.x, dw.y, now);
      drawLamp(g, lx, ly, lit);
      if (!props) return;
      quad(g, P, [[dw.x - 0.95, dw.y + 0.08, 13.1], [dw.x - 0.6, dw.y + 0.08, 13.1], [dw.x - 0.6, dw.y + 0.4, 13.1], [dw.x - 0.95, dw.y + 0.4, 13.1]], '#ffffff');
      quad(g, P, [[dw.x - 0.88, dw.y + 0.18, 13.2], [dw.x - 0.68, dw.y + 0.18, 13.2], [dw.x - 0.68, dw.y + 0.21, 13.2], [dw.x - 0.88, dw.y + 0.21, 13.2]], '#aab2c2');
      if (!sips.has(i)) cup(dw.x + 0.75, dw.y + 0.3);
    });
    put(sp.seat, s.x, s.y, -0.1); put(sp.back, s.x, s.y, 0.1);
  });
  // office coins: the piles on each desk's +x side, depth-sorted by their world points; under the night overlay
  coinItems(g, f.coins, isoSpots(l), id => { const w = f.walkers.get(id); if (w?.payAt == null) return null; const [x, y] = S(w.pt); return { x, y: y - 14, z: D(w.pt) + 0.21 }; }, now, rm, (z, d) => items.push({ z, d }));
  // the flat furniture's places (iso offsets from each flat sprite): the bench, the Waiting room's sofa set (mirrored: it
  // opens toward the door), plants, bin
  const at = (s: Spr, p: Pt) => { const w = toWorld(p); put(s, w.x, w.y); };
  const wr = l.rooms.wait, so = l.sofa, sofa = sofaSeats(so);
  at(sp.woodBench, { x: wr.x1 - 32, y: wr.y0 + 12 });
  // the set's floor lamp in its back corner (layout.ts sofaParts.lamp's base centre), and with
  // the library nook's (its footprint centre, as the decor below) the floor lamps lit in the evening
  const sofaLamp = toWorld({ x: so.x + 20, y: so.y + 16 });
  put(ph.lamps ? sp.lampLit : sp.lamp, sofaLamp.x, sofaLamp.y);
  const floorLamps = [{ w: sofaLamp, room: 'wait' as RoomId }, ...decorOf(l).filter(p => p.name === 'lamp').map(p => { const w = toWorld({ x: (p.x0 + p.x1) / 2, y: p.y1 }); return { w: { x: w.x, y: w.y - FOOT.lamp[1] }, room: p.room }; })];
  at(sp.sofaTop, { x: so.x + 40, y: so.y + 11.2 }); at(sp.sofaSide, { x: so.x + 5.6, y: so.y + 38 }); at(sp.sofaBottom, { x: so.x + 40, y: so.y + 72.8 });
  // the side sofa's back corner, which the left wall piece beside its far end would cover: again, over that piece
  const sc = isoSofaCorner(l), sx = v.ox + sc.edge * 16;
  items.push({ z: sc.z, d: () => { g.save(); g.beginPath(); g.rect(0, 0, sx, v.h); g.clip(); blit(g, P, sp.sofaSide, sc.at.x, sc.at.y); g.restore(); } });
  at(sp.table, { x: so.x + 40, y: so.y + 38.4 });
  // the Done lounge's café tables: the left chair's back behind its sitter, the right one's in front of its (who faces away)
  for (const t of l.cafes) {
    const L = toWorld({ x: t.x - CAFE_DX, y: t.y }), R = toWorld({ x: t.x + CAFE_DX, y: t.y });
    put(sp.seat, L.x, L.y, -0.1); put(sp.chairL, L.x, L.y, -0.2); put(sp.seat, R.x, R.y, -0.1); put(sp.chairR, R.x, R.y, 0.1);
    at(sp.cafeTable, t);
  }
  // the smart board against the Done lounge's back wall: legs, its panel, the writing and fill bar on its front (+y) face; dark
  // while it flickers
  const boardOn = boardLit(date.getTime(), ph.dark, rm);
  {
    const b = boardOf(l), a = toWorld({ x: b.x0, y: b.y1 - 6 }), e = toWorld({ x: b.x1, y: b.y1 - 6 }), bw = b.x1 - b.x0;
    const inDone = [...f.scene.places].filter(([, p]) => p.kind === 'done').map(([id]) => f.agents.get(id)!).sort((p, q) => p.stageSince - q.stageSince || p.id.localeCompare(q.id));
    const ink = boardMarks(inDone.map(x => x.key), bw - 6, BOARD_SCREEN_H), fill = boardFill(inDone.length, doneSeats(l).length);
    const y0 = a.y - 0.08, y1 = a.y + 0.08, X = (u: number) => a.x + u / TILE, Z = 32;   // panel z 12..32, legs under it
    const face = (u0: number, u1: number, z0: number, z1: number, c: string) => quad(g, P, [[X(u0), y1, z0], [X(u1), y1, z0], [X(u1), y1, z1], [X(u0), y1, z1]], c);
    items.push({ z: isoDepth((a.x + e.x) / 2, a.y), d: () => {
      for (const u of [3, bw - 5]) box(g, P, X(u), a.y - 0.05, X(u + 2), a.y + 0.05, 0, 12, METAL);
      box(g, P, a.x, y0, e.x, y1, 12, Z, { top: '#3a4152', x: '#20242e', y: '#20242e' });
      face(2, bw - 2, 14, Z - 2, boardOn ? '#14202a' : BOARD_OFF);
      if (!boardOn) return;
      for (const m of ink) face(3 + m.x, 3 + m.x + m.w, Z - 4 - m.y, Z - 3 - m.y, m.c);
      face(3, bw - 3, 15, 16, '#2b3240'); if (fill > 0) face(3, 3 + Math.round((bw - 6) * fill), 15, 16, '#7ee787');
    } });
    const pts = [P(a.x, y1, 0), P(e.x, y1, 0), P(a.x, y0, Z), P(e.x, y0, Z)], xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    hits.push({ id: BOARD_HIT, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), z: -Infinity });
  }
  // the large plants sway 1 px (baked variants)
  const potted = (p: Pt) => { const w = toWorld(p); put(sp.plants[1 + swayDx(w.x * 0.7 + w.y, now, rm)], w.x, w.y); };
  potted({ x: l.rooms.main.x1 - 16, y: 78.4 }); put(sp.bin, 1.75, 0.6);
  // the server room's rack column (flat's, left of its desks), its LEDs blinking
  for (const r of serverRacks(l)) {
    const w = toWorld({ x: r.x + 7, y: r.y + 15 });
    put(sp.rack, w.x, w.y, 0, 1, () => rackLeds(g, P, w.x, w.y, rm ? 0 : now, r.i * 3));   // calm: the LEDs hold still
    for (let j = 0; j < 6; j++) {   // rackLeds' points, cut out of the night
      const z = 27 - j * 4.5;
      leds.push([...P(w.x + 0.45, w.y + 0.45, z), 1]);
      if (j % 2) leds.push([...P(w.x + 0.45, w.y + 0.25, z), 1]);
    }
  }
  // the burning racks, the brigade and the lights; flames and their floor light cut out of the night,
  // the flames kept clear of the hot desk tags (clearFlames)
  const fireHoles: Rect[] = [];
  if (f.fire) fireItems(g, f.fire, l, { iso: true, S, D, P, span: floorSpan('server'), ambulance: failing.some(x => x.t >= x.f.medStart - 400 && x.t < x.f.end + 800) },
    now, rm, { item: (z, d) => items.push({ z, d }), post: d => post.push(d), lit: (box, gl) => { fireHoles.push(box); burns.push({ pt: gl.pt, x: gl.x, y: gl.y, room: 'server' }); } },
    r => { const w = toWorld({ x: r.x + 7, y: r.y + 15 }); return [0, 1, 2, 3, 4, 5].flatMap(j => [P(w.x + 0.45, w.y + 0.45, 27 - j * 4.5), ...(j % 2 ? [P(w.x + 0.45, w.y + 0.25, 27 - j * 4.5)] : [])]); });
  // wind from its back-wall vents (topDecor's strip: flat y 20 is WALL_H − 24 up): flat's ribbon depth q (0..1) runs
  // down the wall's plane first, then out onto the floor (a tile in at q 1, z 0); drawn before anything stands in the room
  if (!rm) items.push({ z: -1, d: () => wind(g, ventXs(l), now, (x, dy) => { const q = dy / WIND.box.y1; return P(x / TILE, q * q, (WALL_H - 24) * (1 - q)); }) });
  // the two coffee corners (flat's stations: table top-left corners): the machine's LED and steam per frame (calm: a
  // steady LED, no steam)
  for (const st of [l.stations.wait, l.stations.done]) {
    const w = toWorld({ x: st.x + 16, y: st.y + 18 }), [lx, ly] = P(w.x - 0.3, w.y - 0.05, 21), [vx, vy] = P(w.x - 0.5, w.y - 0.25, 26);
    put(sp.station, w.x, w.y, 0, 1, () => { px(g, rm || Math.floor(now / 600) % 2 ? '#ff5d5d' : '#6b1b1b', lx, ly, 1, 1); if (!rm) steamFull(g, Math.round(vx), Math.round(vy), now); });
    leds.push([lx, ly, 1]);
  }
  // each piece at its footprint's centre, on the flat piece's base line, depth-sorted like the
  // furniture
  for (const p of decorOf(l)) {
    if (p.name === 'rugWait' || (f.fire?.fx?.extTaken && p.name === 'extinguisher' && p.room === 'server')) continue;
    const [, hy] = FOOT[p.name], w = toWorld({ x: (p.x0 + p.x1) / 2, y: p.y1 });
    put(p.name === 'lamp' && ph.lamps ? sp.lampLit : sp[p.name], w.x, w.y - hy);
  }

  // who of the Waiting room and the Done lounge is out for coffee (OfficeFloor's per-room schedules), drawn with
  // flat's poses: walking, pouring with its back turned, then facing front with a steaming mug, sipping now and then
  const trips = f.trips;
  const lounger = (id: string, p: Place, w: Walker, t: Trip): [number, number] => {
    const cup = t.stay !== null && t.stay >= POUR, fr = frameOf(t.moving ? 'walk' : 'still', cup ? 'down' : ISO_DIR[t.dir], now);
    const [sx, sy] = char(id, p, w, fr.col, fr.row, t.pt, fr.flip);
    if (cup) items.push({ z: D(t.pt) + 0.01, d: () => mug(g, sx, sy, now, t.stay! % 1300 > 900, rm) });
    return [sx, sy];
  };
  // the Waiting room's waiters, labelled once every agent is placed (their balloons cover none)
  const waiters: { id: string; a: AgentView; p: Place; home: Pt; at: Pt; x: number; y: number }[] = [];

  // the people; a café sitter's drawn feet, for the chat clouds
  const chatFeet = new Map<string, Pt>();
  for (const [id, p] of f.scene.places) {
    const w = f.walkers.get(id), a = f.agents.get(id);
    if (!w || !a) continue;
    if (p.kind === 'fail') {
      const fx = fails.get(id);
      if (fx) failSequence(id, a, p, w, fx);
      continue;
    }
    if (w.payAt !== null) {   // coins 7.2: as flat: standing, facing down, the hop as a lift; over its chair back (+0.1) on its seat
      const [sx, sy] = char(id, p, w, 1, 0, w.pt, false, payHop(now - w.payAt), 0.2);
      labels.push({ ...tagLabel(id, a, Math.max(sx, 30), sy + 2), above: sy - 34 });
      continue;
    }
    if (w.moving) {
      const fr = frameOf('walk', ISO_DIR[w.dir], now), [sx, sy] = char(id, p, w, fr.col, fr.row, w.pt, fr.flip);
      if (p.kind === 'wait') waiters.push({ id, a, p, home: p.spot.pt, at: w.pt, x: sx, y: sy });
      else labels.push({ ...tagLabel(id, a, Math.max(sx, 30), sy + 2), above: sy - 34 });
      continue;
    }
    if (p.kind === 'burn') {   // flat's timeline and maps on the iso seat; no hit box, no outline
      const lounge = p.spot.room === 'done', left = lounge && cafeSide(l, w.pt) === 'l', row = left ? 0 : 1, lift = LIFT_SIT;
      const [sx, base] = S(w.pt), sy = base - lift, d = l.desks[p.desk ?? 0];
      const fr = lounge ? frameOf('read', 'down', now + (left ? 0 : 900)) : frameOf('still', 'up', now);
      const b = burnParts(g, { x: sx, y: sy, fl: base + 2, drop: lift + 4, sheet: img(`char_${p.sprite}`), col: fr.col, row, back: row === 1,
        alpha: p.alpha, seed: seedOf(a.key), span: floorSpan(lounge ? 'done' : d.room) }, now - (w.burnAt ?? now), now);
      if (b.sitter) items.push({ z: D(w.pt) + (lounge ? (row ? -1 : 0.5) : 0), d: b.sitter });
      if (b.pile) items.push({ z: D(w.pt) + 0.5, d: b.pile });
      if (b.sitter || b.pile) sprites.push({ x0: sx - 8, y0: sy - 37, x1: sx + 8, y1: base + 2 });   // no balloon or sign covers it
      if (b.glow) items.push({ z: -1, d: b.glow });
      burns.push({ pt: w.pt, x: sx, y: base + 2, room: lounge ? 'done' : d.room });   // its glow under the pile stays lit at night
      if (b.over) post.push(b.over);
      if (b.label && lounge) labels.push({ kind: 'done', key: 'done-' + id, x: left ? sx - 9 : sx + 9, y: sy - 22, text: tagName(a), color: colorOf(a), side: left ? 'l' : 'r' });
      else if (b.label) tag(id, a, ...deskTag(d, false));
      continue;
    }
    if (p.kind === 'foreman' && cv) {   // on a visit to the box: the name stays where it sits; no hit box, balloon or desk sparks
      // seated (rising, sitting) it faces front as at its desk
      const fr = frameOf(cv.pose, cv.pose === 'still' ? 'down' : ISO_DIR[cv.dir], now), [sx, sy] = S(l.foreman.seat), ty = sy - LIFT_SIT - 34 - 19 * f.textK;
      char(id, p, w, fr.col, fr.row, cv.pt, fr.flip, LIFT_SIT * cv.seated);
      labels.push({ ...tagLabel(id, a, sx, ty), pill: t('corner.pill') });
    } else if (p.kind === 'foreman') {
      // it reads the letter; its idle act, a sip lifting its mug
      const act = idle.get(id) ?? null, cell = seatedCell(p.sprite, false, frameOf(reading ? 'read' : p.pose, 'down', now).col, 0, act);
      const [sx, sy] = seatedChar(id, p, w, cell, w.pt, LIFT_SIT);
      if (act?.kind === 'sip') items.push({ z: D(w.pt) + 0.001, d: () => mug(g, sx, sy, now, true) });
      if (a.stage === 'running') post.push(() => { const [x, y] = P(F.x, F.y + 1.3, 31); sparks(g, x, y, seedOf(a.key), now); });
      // over its head against the back wall (under its desk it would meet the next desk row's tags), any balloon above
      const ty = sy - 34 - 19 * f.textK;   // a tag with its pill is ~19 text px tall (its name framed)
      labels.push({ ...tagLabel(id, a, sx, ty), own: id });
      if (p.bubble) labels.push(bubbleLabel(id, a, p, sx, ty, [2, v.w - 2], false, isoLine(l.views.iso, f.textK)));
      hits.push(rect(id, sx, sy, D(w.pt))); rest(id, sx, sy);
    } else if (p.kind === 'desk') {
      const d = l.desks[p.desk!], dw = deskW(d), hot = overworkMin(a, f.serverNow);
      const act = idle.get(id) ?? null, [sx, sy] = seatedChar(id, p, w, seatedCell(p.sprite, true, frameOf(p.pose, 'up', now).col, 1, act), w.pt, LIFT_SIT);
      if (hot !== null) {   // the light on the floor under the desk's front edge, before the furniture; the flames over everything
        hotDesks.push(p.desk!);   // its flames and floor light stay lit at night
        const [gx, gy] = P(dw.x, dw.y + 0.45, 0), span = floorSpan(d.room);
        items.push({ z: -1, d: () => fireGlow(g, Math.round(gx), Math.round(gy), now, seedOf(a.key), span) });
        // the back row before its desk (the monitor hides its foot), the light between the desk and its sitter
        const sd = seedOf(a.key), dz = isoDepth(dw.x, dw.y);
        items.push({ z: dz - 0.001, d: () => flameRow(g, P, dw.x - 0.46, dw.x + 0.46, dw.y - 0.42, 22, now, sd + 0.37, 1.2) });
        items.push({ z: dz + 0.001, d: () => deskLight(g, P, dw.x, dw.y, now, sd) });
        post.push(() => { flameRow(g, P, dw.x - 0.42, dw.x + 0.38, dw.y - 0.22, 27, now, sd, 0.8); fireSparks(g, P, dw.x, dw.y, now, sd); });
      } else if (a.stage === 'running') post.push(() => { const [x, y] = P(dw.x, dw.y - 0.2, 31); sparks(g, x, y, seedOf(a.key), now); });
      // an abandoned one's Zz balloon (flat iconAt, top sy − 46) keeps its name (~8 text px tall) above it
      const zz = a.stage === 'abandoned', [tx, ty] = deskTag(d, hot !== null);
      if (hot !== null) flames.set(id, isoFlameBox(l, d.seat));
      if (zz) post.push(() => iconAt(g, 'zz', sx, sy));
      labels.push({ ...tagLabel(id, a, tx, zz ? Math.min(ty, sy - 47 - 8 * f.textK) : ty, false, hot), own: id });
      hits.push(rect(id, sx, sy, D(w.pt))); rest(id, sx, sy);
    } else if (p.kind === 'wait') {
      // on the sofa: the top one faces the viewer, in front of its sofa; the bottom one the table, behind its backrest;
      // the side one the table (+x), side on
      // (layout.ts SOFA_SEATS: bottom, bottom, side, top, top)
      const tr = trips.get(id), pt = tr?.pt ?? w.pt, si = sofa.findIndex(s => s.x === w.pt.x && s.y === w.pt.y), fr = frameOf('read', si === 2 ? 'right' : 'down', now);
      const [sx, sy] = tr ? lounger(id, p, w, tr) : si < 0 ? char(id, p, w, frameOf(p.pose, 'down', now).col, 0, w.pt)
        : char(id, p, w, fr.col, si === 2 ? fr.row : si < 2 ? 1 : 0, w.pt, false, LIFT_SOFA, si < 2 ? -1 : 0.5);
      if (p.bubble === 'alert') {
        const pulse = () => { const k = (now % 1400) / 1400; ring(g, sx, sy - 1, 5 + k * 8, 2.5 + k * 4, '#ff8c1a', 0.8 * (1 - k)); };
        if (ph.dark > 0) post.unshift(pulse);   // over the night overlay, under everything else in post
        else items.push({ z: D(pt) - 0.05, d: pulse });
        post.push(() => lot(g, 'lamp', sx - 24, sy - 30, 16));
      }
      waiters.push({ id, a, p, home: p.spot.pt, at: pt, x: sx, y: sy });
      hits.push(rect(id, sx, sy, D(pt)));
      if (!tr) rest(id, sx, sy);
    } else if (p.kind === 'done') {
      // a café sitter faces its table: the left one down-right (side view), the right one away (its back); one out for
      // coffee keeps its name's side
      const tr = trips.get(id), left = cafeSide(l, w.pt) === 'l', fr = frameOf('read', ISO_DIR[left ? 'right' : 'left'], now + (left ? 0 : 900));
      const [sx, sy] = tr ? lounger(id, p, w, tr) : char(id, p, w, fr.col, fr.row, w.pt, false, LIFT_SIT);
      post.push(() => doneCheck(g, a, sx - 5, sy - 36, f.serverNow));
      if (!tr) chatFeet.set(id, { x: sx, y: sy });
      const side = left ? 'l' : 'r';
      labels.push({ kind: 'done', key: 'done-' + id, x: side === 'l' ? sx - 9 : sx + 9, y: sy - 22, text: tagName(a), color: colorOf(a), side, ...(tr ? {} : { own: id }) });
      hits.push(rect(id, sx, sy, D(tr?.pt ?? w.pt)));
      if (!tr) rest(id, sx, sy);
    } else {   // queue: a placeholder waiting by the entrance, a ghost over its head
      const [sx, sy] = char(id, p, w, frameOf(p.pose, 'down', now).col, 0, w.pt);
      post.push(() => iconAt(g, 'ghost', sx, sy));
      hits.push(rect(id, sx, sy, D(w.pt))); rest(id, sx, sy);
    }
  }

  for (const c of chatClouds(f)) { const q = chatFeet.get(c.id); if (q) post.push(() => drawCloud(g, q.x, q.y, c.side, c.u, rm)); }

  // the cat and the robot: the flat points projected, upright sprites like the characters; not in `sprites` (balloons and
  // the gauge sign do not dodge them); Smooth's hit box is the petting one
  const { cat, robot, dock, charge } = f.pets, dk = toWorld(dock);
  const smooth = (z: number, pose: CatPose, x: number, y: number, flip: boolean) => {
    items.push({ z, d: () => drawCat(g, pose, x, y, now, flip) });
    hits.push(catHit(pose, x, y));
  };
  // the wall charger (robot.ts chargerOf): flat's unit sheared onto the corridor's back wall
  // 0.75 tiles behind the dock (flat column x at ux + x, uy + ⌊x / 2⌋, as background's strip), over the wall pieces
  // under it; its cable down the wall and over the floor to the plate the robot docks on
  const ch = chargerOf(l), wallY = dk.y - 0.75, x0 = ch.x - 6, cx = ch.x + 4, [ux, uy] = P(0, wallY, ch.z), unit = chargerUnit(charge, now, rm, true);
  items.push({ z: isoDepth(Math.floor((ch.x + 6) / TILE), wallY) + 0.51 - T / 2, d: () => {
    for (let i = 0; i < 12; i++) g.drawImage(unit, i, 0, 1, 12, ux + x0 + i, uy + Math.floor((x0 + i) / 2), 1, 12);
    px(g, '#1c1f27', ux + cx, uy + Math.floor(cx / 2) + 12, 1, ch.z - 11);
    for (let y = dock.y - 11; y <= dock.y; y++) px(g, '#1c1f27', ...S({ x: cx, y }), 1, 1);
    for (let x = cx + 1; x <= dock.x - 10; x++) px(g, '#1c1f27', ...S({ x, y: dock.y }), 1, 1);
  } });
  put(sp.plate, dk.x, dk.y, -0.2);
  if (charge !== 'out') for (const i of [0, 1]) { const x = x0 + CHARGER_LED.x + i; leds.push([ux + x, uy + Math.floor(x / 2) + CHARGER_LED.y, 1]); }   // the LED, lit while the robot is home
  const [rx, ry] = S(robot.pt);
  items.push({ z: D(robot.pt) + 0.05, d: () => drawRobot(g, rx, ry, now, charge, rm) });
  if (charge !== 'out') { const p = robotLed(rx, ry); leds.push([p.x, p.y, 1]); }   // the docked robot's LED, lit at night too
  // a desk top (13 px up: deskBody's top), right of a work monitor, left of the foreman's; over the desk, under the chair back and sitter
  const top = (p: Perch) => {
    const w = p === 'foreman' ? { x: F.x - 0.65, y: F.y + 0.9, z: isoDepth(F.x, F.y + 1) } : (() => { const dw = deskW(l.desks[p]); return { x: dw.x + 0.65, y: dw.y + 0.05, z: isoDepth(dw.x, dw.y) }; })();
    const [x, y] = P(w.x, w.y, 13);
    return { x, y, z: w.z + 0.05 };
  };
  const end = (e: Pt | Perch) => { if (typeof e !== 'object') return top(e); const [x, y] = S(e); return { x, y, z: D(e) }; };
  // flat's directions on the 2:1 screen: right and up run right, down and left run left (mirrored)
  const isoFlip = (dir: Dir, moving: boolean, side: 'left' | 'right') => moving ? dir === 'down' || dir === 'left' : side === 'left';
  // the mat a floor quad under everything, the bowls upright at their feet points; Smooth 3 px up and
  // left of hers (flat), straight over it on the 2:1 screen
  const bowls = bowlsOf(l), drinking = cat.at === 'bowl' && cat.which === 'drink' ? cat.ms : null, bx = bowls.box;
  const matQuad = (x0: number, y0: number, x1: number, y1: number) => [S({ x: x0, y: y0 }), S({ x: x1, y: y0 }), S({ x: x1, y: y1 }), S({ x: x0, y: y1 })];
  items.push({ z: -1e9, d: () => { fillPoly(g, matQuad(bx.x0, bx.y1 - 7, bx.x1, bx.y1 - 1), MAT.edge); fillPoly(g, matQuad(bx.x0 + 1, bx.y1 - 6, bx.x1 - 1, bx.y1 - 2), MAT.fill); } });
  const food = S(bowls.food), water = S(bowls.water);
  items.push({ z: D(bowls.food), d: () => drawFood(g, f.pets.food, ...food) });
  items.push({ z: D(bowls.water), d: () => drawWater(g, ...water, now, rm, drinking) });
  let catAt: [number, number, boolean, number?] | null = null;
  if (cat.at === 'floor') {
    const [sx, sy] = S(cat.pt), flip = isoFlip(cat.dir, !cat.resting, cat.side);
    smooth(D(cat.pt), cat.pose, sx, sy, flip);
    catAt = [sx, sy + 2, cat.resting, sy - 14];
  } else if (cat.at === 'desk') {
    const q = top(cat.perch);
    smooth(q.z, cat.pose, q.x, q.y, false);
    catAt = [q.x, q.y + 2, true];
  } else if (cat.at === 'hop') {
    const a = end(cat.from), b = end(cat.to), x = a.x + (b.x - a.x) * cat.u, y = a.y + (b.y - a.y) * cat.u - Math.sin(Math.PI * cat.u) * CAT.arc;
    const z = typeof cat.from === 'object' && typeof cat.to === 'object' ? Math.max(a.z, b.z) : (typeof cat.from === 'object' ? b : a).z;
    smooth(z, 'walk', x, y, b.x < a.x);
  } else if (cat.at === 'bowl') {
    const q = { x: cat.pt.x - 3, y: cat.pt.y }, [sx, sy] = S(q), which = cat.which, ms = cat.ms;
    items.push({ z: D(q), d: () => drawEater(g, which, sx, sy, ms, rm) });
    hits.push(catHit('eat', sx + 1, sy));
    catAt = [sx, sy + 2, true, sy - 12];
  } else {
    const [sx, sy] = S(cat.pt);
    smooth(D(robot.pt) + 0.1, 'sit', sx, sy - CAT.lift, false);
    catAt = [sx, sy + 2, false];
  }

  // couriers: the flat path projected; seen through ISO_DIR (at the desk its back is turned); no hit box
  const F0 = l.foreman.seat;
  const letterFlight = (c: CourierPose, sx: number, sy: number, flip: boolean) => {   // the hand → the desktop, then the icon balloon by the foreman's head
    const h = handover(c.give!), [hx, hy] = handAt(sx, sy, flip), [dx, dy] = S({ x: F0.x - 14, y: F0.y + 2 }, 14);
    if (h.letter === 'fly') drawLetter(g, hx + (dx - hx) * h.k, hy + (dy - hy) * h.k - h.lift, c.product);
    else if (h.letter === 'desk') drawLetter(g, dx, dy, c.product);
    // beside the head, under the foreman's tag (its bottom 34 px over the seated feet): flat's spot (+14, −44) is under it
    const [fx, fy] = S(F0);
    if (h.rise !== null) g.drawImage(iconBubble(c.product), Math.round(fx) + 9, Math.round(fy) - LIFT_SIT - 28 - h.rise);
  };
  for (const c of f.couriers) {
    const [sx, sy] = S(c.pt), dir = ISO_DIR[c.dir], flip = dir === 'left';
    const col = c.walking ? frameOf('walk', dir, 2 * now).col : c.tap ? [1, 0][Math.floor(now / 400) % 2] : 1;
    items.push({ z: D(c.pt) + 0.05, d: () => {
      drawCourier(g, c.co, sx, sy, dir, col);
      const h = c.give === null ? null : handover(c.give);
      if (c.carry || h?.letter === 'hand') drawLetter(g, ...handAt(sx, sy, flip), c.product);
    } });
    sprites.push({ x0: sx - 8, y0: sy - 37, x1: sx + 8, y1: sy });   // no balloon or sign covers it
    if (!c.walking) rest('courier-' + c.co, sx, sy);
    if (c.give !== null) post.push(() => letterFlight(c, sx, sy, flip));
  }

  // a hot desk tag that meets another resting label or a sign drops its tool line (renderer.ts shortHotTags)
  const still = shortHotTags(labels, f.textK);
  // then one that covers another hot desk's flame moves sideways, at most two desk rows (64 px)
  // up, off the flames, the other labels and the signs, so every flame shows (logic/iso.ts clearFlames)
  const fire = labels.filter((x): x is Extract<Label, { kind: 'tag' }> => x.kind === 'tag' && x.own !== undefined && flames.has(x.own));
  const calm = still.filter(x => !fire.includes(x as Extract<Label, { kind: 'tag' }>));
  clearFlames(fire.map(x => labelBox(x, f.textK)), fire.map(x => flames.get(x.own!)!), calm.map(x => labelBox(x, f.textK)), v.w, 64, fireHoles)
    .forEach((m, i) => { fire[i].x += m.dx; fire[i].y += m.dy; });

  // the Waiting room balloons over their waiters' heads, over no agent and off the corridor
  // (logic/iso.ts isoWaitBalloons); one out for coffee and one without a balloon carry their name
  const k = f.textK, { compact, w: bw, boxes: balloons } = isoWaitBalloons(waiters.map(w => ({ ...w, feet: { x: w.x, y: w.y }, out: trips.has(w.id) })), sprites, l, k);
  for (const { id, a, p, x, y } of waiters) {
    const b = p.bubble ? balloons.get(id) : null;
    labels.push(b ? { ...bubbleLabel(id, a, p, b.x0, b.y0, [b.x0, b.x1], compact, isoLine(l.views.iso, k)), tipX: tailX(b, x), up: b.up, w: bw } : { ...tagLabel(id, a, Math.max(x, 30), y + 2), above: y - 34 });
  }

  // the box's sign over the cabinet, else beside that to its left, else higher, just over the foreman's tag row, else on
  // the floor before it: the first spot that meets no label and no agent (the foreman at the box too)
  const gt = gaugeText(f.corner.value), gw = k * (gt.length * 3.2 + 6), gh = 8 * k, [gx, gy] = P(cb.x, cb.y - 0.3, 34), [fx, fy] = P(cb.x, cb.y + 0.6, 0);
  const tagTop = S(l.foreman.seat)[1] - LIFT_SIT - 34 - 19 * k;
  const spots = [{ x: gx, y: gy - gh }, { x: P(cb.x - 0.45, cb.y, 0)[0] - 2 - gw / 2, y: gy - gh }, { x: gx, y: tagTop - gh - 2 }, { x: fx, y: fy }];
  const prev = signAt.get(f.walkers), spot = freeSpot(spots, gw, gh, [...labels.map(t => labelBox(t, k)), ...sprites], v.w, v.h, prev?.key === l.key ? prev.i : -1), gs = spots[spot];
  signAt.set(f.walkers, { key: l.key, i: spot });
  labels.push({ kind: 'gauge', key: 'gauge', x: gs.x, y: gs.y, text: gt, color: gaugeColor(f.corner.value) });
  if (catAt) labels.push(catTag(...catAt));   // last, after the sign's freeSpot: her tag moves off everyone's, nothing moves for hers

  if (failing.some(x => x.t >= x.f.medStart - 400 && x.t < x.f.end + 800)) {
    const [ax, ay] = P(0, toWorld(l.doors[0]).y, ENTRY_H + 26);
    post.push(() => ambulance(g, ax, ay, now));
  }

  items.sort((p, q) => p.z - q.z).forEach(it => it.d());
  // the night overlay over everything drawn, its lights cut out; rebuilt only when what is lit changes
  if (ph.dark > 0) {
    const key = [l.key, +ph.lamps, screens.join(','), lampsOn.join(','), hotDesks.join(','), burns.map(b => `${b.pt.x},${b.pt.y}`).join(';'), robot.moving, +boardOn, 'iso'].join('|');
    applyNight(g, ph.dark, nightLayers(v.w, v.h, key, (m, gl) => {
      // a room's floor (its rect's corners on the floor), clipping what lights it
      const clipped = (r: Rect, draw: () => void) => {
        const q = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].map(([x, y]) => S({ x, y }));
        for (const c of [m, gl]) { c.save(); c.beginPath(); q.forEach(([x, y], j) => j ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.clip(); }
        draw();
        for (const c of [m, gl]) c.restore();
      };
      for (const i of lampsOn) { const dw = deskW(l.desks[i]), [x, y] = P(dw.x - 0.55, dw.y + 0.05, 13); cutPool(m, gl, { x, y, rx: 18, ry: 9 }, [0.5, 0.8, 1], '#ffb057', 0.07, 'ellipse'); }
      // the glass (the sky's columns), the digital clock's, the context box's glass
      for (const w of glass) for (let X = w.x0; X < w.x1; X++) m.fillRect(wx + X, wy + Math.floor(X / 2) + 6, 1, 18);
      for (const { w, at: [bx, by] } of leftGlass) for (let i = 0; i < w; i++) m.fillRect(bx + i, by - Math.ceil(i / 2), 1, 18);
      for (let j = 0; j < 26; j++) m.fillRect(wx + clockX + j, wy + Math.floor((clockX + j) / 2) + 8, 1, 12);
      const Y = (u: number) => cb.y - 0.6 * u / 16;
      quad(m, P, [[cb.x + 0.45, Y(2), 1], [cb.x + 0.45, Y(14), 1], [cb.x + 0.45, Y(14), 24], [cb.x + 0.45, Y(2), 24]], '#000');
      for (const i of screens) {   // the lit screens on their plane, a faint green glow before them
        const dw = deskW(l.desks[i]), y = dw.y - 0.24, [x, sy] = P(dw.x, dw.y - 0.1, 13);
        quad(m, P, [[dw.x - 0.33, y, 18], [dw.x + 0.33, y, 18], [dw.x + 0.33, y, 28], [dw.x - 0.33, y, 28]], '#000');
        cutPool(m, gl, { x, y: sy, rx: 12, ry: 5 }, [0, 0, 0], '#7ee7c0', 0.05, 'ellipse');
      }
      for (const i of hotDesks) {   // the flames' floor light (fireGlow's 2:1 ellipse) in its room
        const d = l.desks[i], dw = deskW(d), [x, y] = P(dw.x, dw.y + 0.45, 0);
        clipped(l.rooms[d.room], () => cutPool(m, gl, { x: Math.round(x), y: Math.round(y), rx: 29, ry: 14 }, [0.5, 0.8, 1], '', 0, 'iso'));
      }
      for (const b of burns) clipped(l.rooms[b.room], () => cutPool(m, gl, { x: b.x, y: b.y, rx: 29, ry: 14 }, [0.5, 0.8, 1], '', 0, 'iso'));
      for (const [x, y, w] of leds) m.fillRect(Math.round(x), Math.round(y), w, 1);
      for (const r of fireHoles) m.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);   // the racks' flames
      // the lit board's screen; from LAMPS_AT its light on the Done lounge's floor (flat's, on the floor plane)
      if (boardOn) {
        const b = boardOf(l), a = toWorld({ x: b.x0, y: b.y1 - 6 }), bw = b.x1 - b.x0, y1 = a.y + 0.08, X = (u: number) => a.x + u / TILE;
        quad(m, P, [[X(2), y1, 14], [X(bw - 2), y1, 14], [X(bw - 2), y1, 30], [X(2), y1, 30]], '#000');
        if (ph.lamps) clipped(l.rooms.done, () => cutBands(m, gl, boardBands(l).map(q => q.map(p => { const [x, y] = S(p); return { x, y }; })), BOARD_GLOW, 0.045));
      }
      if (ph.lamps) {   // the foreman's lamp (as a work desk's), the floor lamps' shades and pools
        const [fx, fy] = P(F.x + 0.85, F.y + 1.05, 13);
        cutPool(m, gl, { x: fx, y: fy, rx: 18, ry: 9 }, [0.5, 0.8, 1], '#ffb057', 0.07, 'ellipse');
        for (const { w, room } of floorLamps) {
          const [sx, sy] = P(w.x, w.y, 25), [qx, qy] = P(w.x, w.y, 0);
          m.fillRect(Math.round(sx) - 5, Math.round(sy) - 4, 10, 7);
          clipped(l.rooms[room], () => cutPool(m, gl, { x: Math.round(qx), y: Math.round(qy), rx: 26, ry: 13 }, [0.5, 0.8, 1], '#ffb057', 0.07, 'iso'));
        }
      }
    }));
  }
  post.forEach(p => p());
  const s = sel as { x: number; y: number } | null;
  if (s) {
    const x0 = Math.round(s.x - 8), y0 = Math.round(s.y - 32);
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(x0 - 0.5, y0 + 1.5, 17, 31);
  }
  return { labels, hits, bodies };
}

export const iso: Renderer = { style: 'iso', ...ISO, draw };
