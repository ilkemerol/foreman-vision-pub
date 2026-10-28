import type { AgentView } from '../../../shared/types.ts';
import { outside, route, SPEED, type Walker } from './motion.ts';
import type { Desk, Layout, Pt } from './layout.ts';
import type { Scene } from './scene.ts';
import { stretchStart } from './model.ts';

// Overwork fire and the failure sequence's timeline, shared by every office style.
export const OVERWORK_MIN = 10;
const WORKING = new Set(['spawning', 'running', 'verifying']);

/** Whole minutes a sub-agent has worked in its current stretch (resumed or back from waiting starts anew) once past
 *  OVERWORK_MIN, else null. */
export function overworkMin(a: AgentView, serverNow: number): number | null {
  if (a.role !== 'agent' || !WORKING.has(a.stage)) return null;
  const m = Math.floor((Math.min(serverNow, a.endedAt ?? serverNow) - stretchStart(a)) / 60_000);   // a stopped one stops counting
  return m >= OVERWORK_MIN ? m : null;
}

/** The fire's floor light: half the width of an a × b (half axes) ellipse band on row y from its centre, in coarse
 *  2 px steps: rows go in pairs, and the half width is even. */
export const glowHalf = (a: number, b: number, y: number): number => {
  const yy = Math.round(y / 2) * 2;
  return Math.round(a * Math.sqrt(Math.max(0, 1 - (yy / b) ** 2)) / 2) * 2;
};

/** The iso fire's flame row (a full-bodied flame): n one-pixel columns, each the heights of the
 *  four colour layers (red, orange, yellow, white core; 0 = left out) of five pointed tongues `fr` scaled by hk. The
 *  inner layers stay off the row's ends. */
export const flameCols = (fr: number[], n: number, hk: number): number[][] =>
  Array.from({ length: n }, (_, u) => {
    const i = Math.min(4, Math.floor(u * 5 / n)), d = Math.abs(u + 0.5 - (i + 0.5) * n / 5);
    return [1, 0.8, 0.55, 0.3].map((k, L) => {
      const ins = [0, 0, 1, 3][L];
      return u < ins || u >= n - ins ? 0 : Math.max(0, Math.round(fr[i] * k * hk - d * 1.5));
    });
  });

/** The iso fire's light on its desk top: three bands [x0, x1, y0, y1] in tiles from the desk's centre, outermost
 *  first, each round the monitor (x ±0.4, y −0.36..−0.24) and inside the desk top (x ±1, y ±0.45). */
export const DESK_LIGHT: [number, number, number, number][] = [1, 0.66, 0.36].map(f =>
  [Math.max(-1, -0.5 - 0.5 * f), Math.min(1, 0.5 + 0.5 * f), -0.45, Math.min(0.45, -0.3 + 0.75 * f)]);

/** ms after failAt. */
export interface FailTimes { stand: number; fall: number; medStart: number; arrive: number; leave: number; end: number; dark: number; smokeEnd: number; speed: number }

const LOAD = 1000, WALK_BUDGET = 13_500, EXIT = 60;   // EXIT: the team walks this far past the path's start, out of sight

/** A team's walking speed (the medics', the fire brigade's): in and out of a `len` px path within
 *  WALK_BUDGET, never slower than everyone's. */
export const teamSpeed = (len: number): number => Math.max(SPEED, (2 * len + EXIT) / WALK_BUDGET);

export function failTimes(medicPathLen: number): FailTimes {
  const fall = 2700, medStart = fall + 2000, speed = teamSpeed(medicPathLen);
  const arrive = medStart + medicPathLen / speed, leave = arrive + LOAD;
  return { stand: 1500, fall, medStart, arrive, leave, end: leave + (medicPathLen + EXIT) / speed, dark: 7000, smokeEnd: 12_000, speed };
}

export const smokeLevel = (t: number, f: FailTimes): number =>
  t < 0 ? 0 : t < 1000 ? t / 1000 : t < f.dark ? 1 : Math.max(0, 1 - (t - f.dark) / (f.smokeEnd - f.dark));

/** The medics' way in: from the Entrance, through the corridor and the room door when the desk is
 *  not in the main office, to the aisle just left of the desk's chair. */
export const medicPath = (desk: Desk, l: Layout): Pt[] =>
  route(l, outside(l), { room: desk.room, pt: { x: desk.seat.x - 14, y: desk.aisle }, aisle: desk.aisle });

export const pathLen = (p: Pt[]): number => p.reduce((s, q, i) => i ? s + Math.abs(q.x - p[i - 1].x) + Math.abs(q.y - p[i - 1].y) : 0, 0);

/** The point `s` px along an axis-aligned path; before the start and past the end it runs on along the end segments. */
export function pointAt(p: Pt[], s: number): Pt {
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], d = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (s <= d || i === p.length - 1) {
      const k = d ? s / d : 0;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    s -= d;
  }
  return p[0];
}

/** How far along the medic path the stretcher's middle is at t (ms after failAt); null while the team is not in. */
export function medicAt(t: number, f: FailTimes, len: number): number | null {
  if (t < f.medStart || t >= f.end) return null;
  if (t < f.arrive) return (t - f.medStart) * f.speed;
  if (t < f.leave) return len;
  return len - (t - f.leave) * f.speed;
}

/** One running failure sequence: t is ms after the walker's failAt. */
export interface FailFx { desk: Desk; t: number; f: FailTimes; path: Pt[]; len: number }

/** Every fail place whose sequence started (a walker with failAt); a fail never seen live has none. */
export function failFx(scene: Scene, walkers: Map<string, Walker>, now: number): Map<string, FailFx> {
  const out = new Map<string, FailFx>();
  for (const [id, p] of scene.places) {
    const w = walkers.get(id), desk = p.desk === null ? undefined : scene.layout.desks[p.desk];
    if (p.kind !== 'fail' || !desk || w?.failAt == null) continue;
    const path = medicPath(desk, scene.layout), len = pathLen(path);
    out.set(id, { desk, t: now - w.failAt, f: failTimes(len), path, len });
  }
  return out;
}

/** The two medics' feet, 20 px either side of the stretcher's middle along the path; [] while they are not in. */
export function medicPts(x: FailFx): Pt[] {
  const s = medicAt(x.t, x.f, x.len);
  return s === null ? [] : [pointAt(x.path, s + 20), pointAt(x.path, s - 20)];
}
