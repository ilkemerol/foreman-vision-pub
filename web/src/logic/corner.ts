// Foreman corner: the context gauge's rule and timeline, the corner's geometry; pure, no DOM.
import type { AgentView, ContextUse } from '../../../shared/types.ts';
import { pathLen, pointAt } from './fx.ts';
import { t } from './i18n.ts';
import { keepInside } from './labels.ts';
import type { Layout, Pt, Rect } from './layout.ts';
import { SPEED, type Walker } from './motion.ts';
import type { Dir, Scene } from './scene.ts';
import type { CtxWindow } from './settings.ts';

export const gaugeText = (v: number | null): string => v === null ? t('corner.empty') : t('corner.gauge', { n: Math.round(v) });

/** A session past 200k is a 1M one for good (peak), whatever the setting. */
export function ctxPct(c: ContextUse | null, setting: CtxWindow): number | null {
  if (!c) return null;
  const window = setting === '1M' || c.peak > 200_000 ? 1_000_000 : 200_000;
  return Math.min(100, Math.round(100 * c.used / window));
}

export const band = (v: number): 0 | 1 | 2 => v > 85 ? 2 : v > 60 ? 1 : 0;
export const gaugeColor = (v: number | null): string => v === null ? '#8b93a7' : ['#39d353', '#f2a33a', '#ff5d5d'][band(v)];

export interface CornerSpots { box: Rect; sign: Pt; clock: Rect }
/** F = l.foreman.seat, fy = l.foreman.y: box (F.x − 56, fy + 2)–(F.x − 40, F.y + 12); sign (F.x − 48, box.y0 − 3 − 8·textK);
 *  clock case (F.x − 12, 8)–(F.x + 13, 19). */
export function cornerSpots(l: Layout, textK = 1): CornerSpots {
  const F = l.foreman.seat, box = { x0: F.x - 56, y0: l.foreman.y + 2, x1: F.x - 40, y1: F.y + 12 };
  return { box, sign: { x: F.x - 48, y: box.y0 - 3 - 8 * textK }, clock: { x0: F.x - 12, y0: 8, x1: F.x + 13, y1: 19 } };
}

/** The box's sign spot, an index into `spots` (x its centre, y its top): `prev` while its w×h box, where the
 *  overlay keeps it inside W×H (keepInside), meets none of `busy` (no jumping as someone walks by), else the first such
 *  spot; 0 when none is free. */
export function freeSpot(spots: Pt[], w: number, h: number, busy: Rect[], W: number, H: number, prev = -1): number {
  const free = (s: Pt) => {
    const p = keepInside(s.x, s.y, w, h, W, H, 0.5), x0 = p.x - w / 2;
    return !busy.some(r => r.x0 < x0 + w && x0 < r.x1 && r.y0 < p.y + h && p.y < r.y1);
  };
  return spots[prev] && free(spots[prev]) ? prev : Math.max(0, spots.findIndex(free));
}

/** The main office's top wall decor: sprite, flat x, y. The digital clock took SMALL_PAINTING's place at 96; the small
 *  painting took the analog CLOCK's at 176. */
const WALL_DECOR: [string, number, number][] = [['BOOKSHELF', 24, 14], ['WHITEBOARD', 56, 0], ['LARGE_PAINTING', 120, 0],
  ['SMALL_PAINTING', 176, 0], ['HANGING_PLANT', 200, 0], ['DOUBLE_BOOKSHELF', 224, 2], ['HANGING_PLANT', 252, 0], ['SMALL_PAINTING', 376, 0], ['HANGING_PLANT', 396, 0]];
export interface Piece { name: string; x: number; y: number }   // name 'win': topDecor's procedural window, its box x − 1..x + 23, y 5..27

/** topDecor's main office part as data: the pieces that fit (x + w ≤ main.x1 − 2), then a window and a hanging plant
 *  (at x + 4) by turns every 40 px; any piece within 2 px of cornerSpots(l).clock is left out. Then
 *  windows in every gap at least a window's box (24 px) wide between the main office's left edge, the pieces
 *  kept, the clock (2 px round it) and main.x1 − 2: one per 40 px, the row centred in its gap. */
export function mainWallDecor(l: Layout, size: (name: string) => { w: number; h: number }): Piece[] {
  const m = l.rooms.main.x1, c = cornerSpots(l).clock;
  const out: Piece[] = WALL_DECOR.filter(([n, x]) => x + size(n).w <= m - 2).map(([name, x, y]) => ({ name, x, y }));
  for (let x = Math.max(0, ...out.map(p => p.x + size(p.name).w)) + 8, i = 0; x + 24 <= m; x += 40, i++) out.push(i % 2 ? { name: 'HANGING_PLANT', x: x + 4, y: 0 } : { name: 'win', x, y: 5 });
  const box = (p: Piece): Rect => p.name === 'win' ? { x0: p.x - 1, y0: 5, x1: p.x + 23, y1: 27 } : { x0: p.x, y0: p.y, x1: p.x + size(p.name).w, y1: p.y + size(p.name).h };
  const kept = out.filter(p => { const r = box(p); return !(r.x0 < c.x1 + 2 && c.x0 - 2 < r.x1 && r.y0 < c.y1 + 2 && c.y0 - 2 < r.y1); });
  const spans = [...kept.map(box), { x0: c.x0 - 2, x1: c.x1 + 2 }, { x0: m - 2, x1: m - 2 }].sort((a, b) => a.x0 - b.x0);
  let from = l.rooms.main.x0;
  for (const s of spans) {
    const gap = s.x0 - from, n = gap >= 24 ? Math.floor((gap - 24) / 40) + 1 : 0, x = from + Math.floor((gap - 24 - (n - 1) * 40) / 2) + 1;
    for (let i = 0; i < n; i++) kept.push({ name: 'win', x: x + i * 40, y: 5 });
    from = Math.max(from, s.x1);
  }
  return kept;
}

/** The chair → behind the desk, left → down to the box's right side. */
export function visitPath(l: Layout): Pt[] {
  const F = l.foreman.seat;
  return [{ x: F.x, y: F.y }, { x: F.x - 31, y: F.y }, { x: F.x - 31, y: F.y + 12 }];
}

export const RISE = 250, WORK = 2200, FLOW = [400, 1800] as const, GAP_MS = 120_000, MIN_STEP = 5, DROP = 20;
export const visitMs = (path: Pt[]): number => 2 * RISE + 2 * pathLen(path) / SPEED + WORK;

const dirOf = (a: Pt, b: Pt): Dir => Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (b.x > a.x ? 'right' : 'left') : (b.y > a.y ? 'down' : 'up');
const ease = (k: number) => k < .5 ? 2 * k * k : 1 - 2 * (1 - k) ** 2;

/** seated: 1 in the chair, 0 standing (rising and sitting take RISE each). */
export interface VisitPose { pt: Pt; dir: Dir; pose: 'walk' | 'type' | 'still'; seated: number }

export function visitPose(start: number, path: Pt[], now: number): VisitPose | null {
  const t = now - start, walk = pathLen(path) / SPEED, back = RISE + walk + WORK;
  if (t < 0 || t >= visitMs(path)) return null;
  if (t < RISE) return { pt: path[0], dir: 'down', pose: 'still', seated: 1 - t / RISE };
  if (t >= back + walk) return { pt: path[0], dir: 'down', pose: 'still', seated: (t - back - walk) / RISE };
  if (t >= RISE + walk && t < back) return { pt: path[path.length - 1], dir: 'left', pose: 'type', seated: 0 };   // the box is on the left
  const p = t < back ? path : [...path].reverse(), s = (t - (t < back ? RISE : back)) * SPEED, pt = pointAt(p, s);
  return { pt, dir: dirOf(pt, pointAt(p, s + 1)), pose: 'walk', seated: 0 };
}

/** stepGauge's canGo: a foreman is on the floor, seated at its desk (not walking in) and not waiting. */
export function canVisit(sc: Scene, agents: Map<string, AgentView>, walkers: Map<string, Walker>): boolean {
  const id = [...sc.places].find(([, p]) => p.kind === 'foreman')?.[0], w = id === undefined ? undefined : walkers.get(id);
  return !!w && !w.moving && agents.get(id!)?.stage !== 'waiting';
}

/** shown: the gauge (null: none yet); lastStart: the last visit's start (−Infinity after a seed); visit.to is read on arrival. */
export interface Gauge { shown: number | null; lastStart: number; visit: { start: number; from: number; to: number | null } | null }
export const seedGauge = (target: number | null): Gauge => ({ shown: target, lastStart: -Infinity, visit: null });

/** One frame: read the target on arrival, end a visit, maybe start one; the value shown and the pose. */
export function stepGauge(g: Gauge, target: number | null, canGo: boolean, path: Pt[], now: number): { value: number | null; visit: VisitPose | null } {
  const arrive = RISE + pathLen(path) / SPEED;
  if (g.visit && now >= g.visit.start + arrive && g.visit.to === null) g.visit.to = target ?? g.visit.from;
  if (g.visit && now >= g.visit.start + visitMs(path)) { g.shown = g.visit.to; g.visit = null; }
  if (!g.visit && canGo && target !== null) {
    const s = g.shown, go = s === null || (Math.abs(target - s) >= MIN_STEP
      && (band(s) !== band(target) || s - target >= DROP || now - g.lastStart >= GAP_MS));
    if (go) { g.visit = { start: now, from: s ?? 0, to: null }; g.lastStart = now; }
  }
  const v = g.visit;
  if (!v) return { value: g.shown, visit: null };
  const w = now - v.start - arrive;
  const value = v.to === null || w < FLOW[0] ? g.shown
    : w < FLOW[1] ? v.from + (v.to - v.from) * ease((w - FLOW[0]) / (FLOW[1] - FLOW[0])) : v.to;
  return { value, visit: visitPose(v.start, path, now) };
}
