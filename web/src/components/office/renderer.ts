import type { AgentView } from '../../../../shared/types.ts';
import type { Trip } from '../../logic/coffee.ts';
import type { FireFrame } from '../../logic/fire.ts';
import type { VisitPose } from '../../logic/corner.ts';
import type { DoorState, Walker } from '../../logic/motion.ts';
import type { CatDraw } from '../../logic/cat.ts';
import type { CourierPose } from '../../logic/couriers.ts';
import type { Charge, RobotPos } from '../../logic/robot.ts';
import { balloonBox, type Door, type Pt, type Rect, type Style, type View } from '../../logic/layout.ts';
import { shortHot, signBox } from '../../logic/iso.ts';
import type { Hit, Scene, Theme } from '../../logic/scene.ts';
import type { Piles } from '../../logic/coins.ts';

/** DOM text over the canvas (text is never drawn on the canvas). x, y in office px. The overlay keeps every
 *  label but a balloon inside the canvas (logic/labels.ts keepInside); balloons are bounded by their own placement. */
export type Label =
  // tag: `above`, for one under the feet, the y its bottom flips up to (over the head) when it would cross the bottom;
  // tag, done: `own`, a resting agent's id: the overlay moves its label sideways off the signs, the other resting
  // agents (`bodies`) and the `own` labels before it (logic/labels.ts shiftOff)
  | { kind: 'tag'; key: string; x: number; y: number; name: string; color: string; pill: string | null; hot: number | null; failed: boolean; above?: number; own?: string }
  // bubble: x, y is the agent's head top and the balloon sits above it inside `clamp`; with `tipX` (Waiting room) x, y is
  // the outer box's top-left (layout.ts placeBalloons) and the tail sits under the box at office x tipX, or on its top
  // with `up` (a box under its agent's feet); `line`: the one-line balloon (layout.ts LINE) — icon and reason only, used
  // while the text is larger than the office pixels; `w`: its outer width (office px) where not styles.css's (iso
  // Waiting room: logic/iso.ts isoWaitBalloons)
  | { kind: 'bubble'; key: string; x: number; y: number; head: string; lines: string[]; icon: 'bell' | 'question'; alert: boolean; clamp: [number, number]; compact: boolean; line?: boolean; tipX?: number; up?: boolean; w?: number }
  // sign: side 0 centred above x, −1 ending at x (left of the door), +1 starting at x
  | { kind: 'sign'; key: string; x: number; y: number; text: string; tone: Door['id']; side: -1 | 0 | 1 }
  | { kind: 'done'; key: string; x: number; y: number; text: string; color: string; side: 'l' | 'r'; own?: string }
  // gauge: the foreman corner's sign, centred above x; y its top
  | { kind: 'gauge'; key: string; x: number; y: number; text: string; color: string };

/** A DOM label's box (office px), from guessed text widths: the DOM measures it only later (styles.css .ov: 6 px bold
 *  ~3.6 px a char, 5 px ~3.2; a tag with its pill ~19 text px tall). */
export function labelBox(l: Label, k: number): Rect {
  const box = (x0: number, y0: number, w: number, h: number): Rect => ({ x0, y0, x1: x0 + w, y1: y0 + h });
  switch (l.kind) {
    case 'tag': {
      const pill = l.failed ? '✗ failed' : l.pill, w = k * Math.max(l.name.length * 3.6 + 8 + (l.hot !== null ? 26 : 0), pill ? pill.length * 3.2 + 8 : 0);
      return box(l.x - w / 2, l.y, w, k * (pill ? 19 : 10));   // the name's box with its 1 px border
    }
    case 'bubble': {   // as overlay.ts places it: x, y its box with a tip, else centred on x in the clamp, 4 text px over y
      const b = balloonBox(k, l.compact, l.w, l.line ?? false);
      return l.tipX !== undefined ? box(l.x, l.y, b.w, b.h) : box(Math.min(Math.max(l.x - b.w / 2, l.clamp[0]), l.clamp[1] - b.w), l.y - 4 * k - b.h, b.w, b.h);
    }
    case 'sign': return signBox(l, l.text, k);
    case 'gauge': { const w = k * (l.text.length * 3.2 + 6); return box(l.x - w / 2, l.y, w, 8 * k); }
    case 'done': { const w = k * (l.text.length * 3.2 + 4); return box(l.side === 'l' ? l.x - w : l.x, l.y, w, 7 * k); }   // framed
  }
}

/** Both styles: a hot desk tag whose two lines meet another
 *  resting label or a sign drops its tool line; its name keeps the bottom, over the flame (logic/iso.ts shortHot).
 *  Changes `labels` in place; returns the labels it checked against (the signs and the other resting labels). */
export function shortHotTags(labels: Label[], k: number): Label[] {
  const isHot = (x: Label): x is Extract<Label, { kind: 'tag' }> => x.kind === 'tag' && x.hot !== null && x.pill !== null && x.own !== undefined;
  const hots = labels.filter(isHot), still = labels.filter(x => !isHot(x) && (x.kind === 'sign' || (x.kind !== 'bubble' && x.kind !== 'gauge' && x.own !== undefined)));
  shortHot(hots.map(x => labelBox(x, k)), still.map(x => labelBox(x, k))).forEach((s, i) => { if (s) Object.assign(hots[i], { pill: null, y: hots[i].y + 9 * k }); });
  return still;
}

/** One animation frame of a floor. `now` is the animation clock (performance.now), `serverNow` the server's.
 *  `trips`: who of the Waiting room and the Done lounge is out for coffee now, and where (logic/coffee.ts).
 *  `textK`: how many office px one px of the overlay's text layout takes (≥ 1: text never drops below its scale-2 size).
 *  `corner`: the context gauge's value now and the foreman's pose while on a visit to it (logic/corner.ts stepGauge).
 *  `pets`: Smooth and the robot this frame (logic/cat.ts catDraw, logic/robot.ts robotAt, chargeAt); not agents: no body; Smooth's
 *  hit box (catHit) is the petting one, in front of everyone's.
 *  `couriers`: the couriers in the office now (logic/couriers.ts courierPoses).
 *  `ambient`: the local clock and prefers-reduced-motion */
export interface Frame { scene: Scene; agents: Map<string, AgentView>; walkers: Map<string, Walker>; trips: Map<string, Trip>; doors: DoorState[]; theme: Theme; selectedId: string | null; now: number; serverNow: number; textK: number; corner: { value: number | null; visit: VisitPose | null }
  pets: { cat: CatDraw; robot: RobotPos; dock: Pt; charge: Charge; food: 'full' | 'half' };   // food: Smooth's food bowl
  couriers: CourierPose[];
  // `coins`: each agent's pile (logic/coins.ts), drawn from Pile.desk
  coins: Piles;
  ambient: { date: Date; calm: boolean };
  // the server room's fire while it runs, or the soot it left; absent: none
  fire?: FireFrame;
}

/** An office style: same scene, its own drawing; `size` is its canvas for the layout's grid (layout.ts View).
 *  `draw` gets a context already scaled to office px; `bodies`: the sprites (office px) of the agents drawn at rest. */
export interface Renderer extends View { style: Style; draw(g: CanvasRenderingContext2D, f: Frame): { labels: Label[]; hits: Hit[]; bodies: Body[] } }
export interface Body extends Rect { id: string }
