import type { AgentView, Stage } from '../../../shared/types.ts';

export type Room = 'queue' | 'work' | 'wait' | 'verify' | 'exit';

/** Titles come from t(`room.${key}`) at render time, so a language change never leaves an old one. */
export const ROOMS: { key: Room }[] = [
  { key: 'queue' }, { key: 'work' }, { key: 'wait' }, { key: 'verify' }, { key: 'exit' },
];

const ROOM_OF: Record<Stage, Room> = {
  queued: 'queue', spawning: 'work', running: 'work', idle: 'work', waiting: 'wait',
  verifying: 'verify', done: 'exit', failed: 'exit', abandoned: 'exit',
};

export const roomOf = (s: Stage): Room => ROOM_OF[s];

export interface Rect { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }
export interface OrbitCard extends Rect { room: Room; n: number; failed: number; alert: boolean; compact: boolean; more: (Rect & { n: number }) | null }
export interface OrbitChip extends Rect { room: Room; compact: boolean }
export interface OrbitEdge { room: Room; n: number; d: string; mid: Pt }
/** main: the parent is main (drawn only in a chain). */
export interface OrbitLink { id: string; parentId: string; main: boolean; d: string }
export interface Orbit { main: Rect; cards: OrbitCard[]; chips: Map<string, OrbitChip>; edges: OrbitEdge[]; links: OrbitLink[] }

export const BASE = { w: 1240, h: 680 } as const;
const CHIP = { w: 136, h: 40, cw: 112, ch: 28, gx: 8, gy: 6 };   // normal and compact (cw × ch) chip, gaps
const CARD = { head: 32, pad: 10, minW: 200, gap: 6 };            // gap: each slot is inset this much on every side
const MAIN = { w: 200, h: 100 };
/** Each room's slot as fractions of the box, and where its card sits in it (share of the free space left / above). */
const SLOTS: Record<Room, { x0: number; y0: number; x1: number; y1: number; ax: number; ay: number }> = {
  work: { x0: .26, y0: 0, x1: .74, y1: .38, ax: .5, ay: 1 },
  queue: { x0: 0, y0: .2, x1: .255, y1: .6, ax: 1, ay: .5 },
  wait: { x0: .745, y0: .2, x1: 1, y1: .6, ax: 0, ay: .5 },
  exit: { x0: .1, y0: .64, x1: .4, y1: 1, ax: 1, ay: 0 },
  verify: { x0: .6, y0: .64, x1: .9, y1: 1, ax: 0, ay: 0 },
};

/** The view's size → the logical box (at least BASE, the view's aspect) and the CSS zoom that maps it onto the view. */
export function orbitZoom(size: { w: number; h: number }): { zoom: number; box: { w: number; h: number } } {
  const zoom = Math.min(size.w / BASE.w, size.h / BASE.h);
  return { zoom, box: { w: size.w / zoom, h: size.h / zoom } };
}

/** Sub-agents (not main) of one room, oldest first: endedAt ?? startedAt, then id. */
export function roomAgents(agents: AgentView[], room: Room): AgentView[] {
  return agents.filter(a => a.id !== 'main' && ROOM_OF[a.stage] === room)
    .sort((a, b) => (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt) || a.id.localeCompare(b.id));
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const curve = (a: Pt, b: Pt, c: Pt, d: Pt) => `M ${r1(a.x)} ${r1(a.y)} C ${r1(b.x)} ${r1(b.y)}, ${r1(c.x)} ${r1(c.y)}, ${r1(d.x)} ${r1(d.y)}`;
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
/** Where the ray from r's centre toward p leaves r. */
function rectEdge(r: Rect, p: Pt): Pt {
  const c = centre(r), dx = p.x - c.x, dy = p.y - c.y;
  const s = Math.min(r.w / 2 / Math.abs(dx || 1e-6), r.h / 2 / Math.abs(dy || 1e-6));
  return { x: c.x + dx * s, y: c.y + dy * s };
}
/** The two control points of a curve from a to b bent sideways by k (every edge bends the same way). */
const bow = (a: Pt, b: Pt, k: number): [Pt, Pt] => {
  const dx = b.x - a.x, dy = b.y - a.y;
  return [{ x: a.x + dx * .3 - dy * k, y: a.y + dy * .3 + dx * k }, { x: a.x + dx * .7 - dy * k, y: a.y + dy * .7 + dx * k }];
};
const bez = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt => {
  const u = 1 - t, f = (k: 'x' | 'y') => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k];
  return { x: f('x'), y: f('y') };
};

/** The orbit for a box from orbitZoom (at least BASE). cards and edges in ROOMS order; chips only for agents on screen. */
export function orbitLayout(agents: AgentView[], box: { w: number; h: number }): Orbit {
  const main: Rect = { x: (box.w - MAIN.w) / 2, y: (box.h - MAIN.h) / 2, ...MAIN };
  const O = centre(main), cards: OrbitCard[] = [], chips: Orbit['chips'] = new Map(), edges: OrbitEdge[] = [], links: OrbitLink[] = [];
  for (const { key: room } of ROOMS) {
    const s = SLOTS[room], { head, pad, gap } = CARD;
    const slot = { x: s.x0 * box.w + gap, y: s.y0 * box.h + gap, w: (s.x1 - s.x0) * box.w - 2 * gap, h: (s.y1 - s.y0) * box.h - 2 * gap };
    const iw = slot.w - 2 * pad, ih = slot.h - head - pad;
    const grid = (cw: number, ch: number) => {
      const cols = Math.max(1, Math.floor((iw + CHIP.gx) / (cw + CHIP.gx))), rows = Math.max(1, Math.floor((ih + CHIP.gy) / (ch + CHIP.gy)));
      return { cw, ch, cols, cap: cols * rows };
    };
    const list = roomAgents(agents, room), n = list.length, normal = grid(CHIP.w, CHIP.h);
    const compact = n > normal.cap, g = compact ? grid(CHIP.cw, CHIP.ch) : normal;
    const cells = Math.min(n, g.cap), shown = n > g.cap ? list.slice(n - (g.cap - 1)) : list;
    const c = Math.min(cells, g.cols), r = Math.ceil(cells / c);
    const w = Math.min(slot.w, Math.max(CARD.minW, 2 * pad + c * g.cw + (c - 1) * CHIP.gx));
    const h = cells ? head + r * g.ch + (r - 1) * CHIP.gy + pad : head;
    const x = slot.x + (slot.w - w) * s.ax, y = slot.y + (slot.h - h) * s.ay;
    const cell = (j: number): Rect => ({ x: x + pad + (j % c) * (g.cw + CHIP.gx), y: y + head + Math.floor(j / c) * (g.ch + CHIP.gy), w: g.cw, h: g.ch });
    shown.forEach((a, j) => chips.set(a.id, { ...cell(j), room, compact }));
    const card: OrbitCard = {
      x, y, w, h, room, n, compact, failed: list.filter(a => a.stage === 'failed').length, alert: list.some(a => a.alert),
      more: n > g.cap ? { ...cell(g.cap - 1), n: n - (g.cap - 1) } : null,
    };
    cards.push(card);
    const A = rectEdge(main, centre(card)), B = rectEdge(card, O), [b1, b2] = bow(A, B, .2);
    edges.push({ room, n, d: curve(A, b1, b2, B), mid: bez(A, b1, b2, B, .5) });
  }
  for (const a of agents) {
    const chip = chips.get(a.id), parent = a.parentId === 'main' ? main : a.parentId && chips.get(a.parentId);
    if (!chip || !parent) continue;
    const P = centre(parent), C = centre(chip);
    links.push({ id: a.id, parentId: a.parentId!, main: a.parentId === 'main', d: curve(P, lerp(P, O, .5), lerp(C, O, .5), C) });
  }
  return { main, cards, chips, edges, links };
}

/** The agent, its ancestors and its descendants; empty when id is not on the floor. */
export function chainOf(agents: AgentView[], id: string): Set<string> {
  const byId = new Map(agents.map(a => [a.id, a])), chain = new Set<string>();
  for (let a = byId.get(id); a && !chain.has(a.id); a = a.parentId ? byId.get(a.parentId) : undefined) chain.add(a.id);
  if (!chain.size) return chain;
  const down = [id];
  for (let i = 0; i < down.length; i++)
    for (const a of agents) if (a.parentId === down[i] && !chain.has(a.id)) { chain.add(a.id); down.push(a.id); }
  return chain;
}
