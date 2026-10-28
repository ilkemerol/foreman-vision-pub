import type { AgentView, ConnectorCall } from '../../../shared/types.ts';
import type { Company, Product } from './courier-art.ts';
import { pathLen, pointAt } from './fx.ts';
import type { Layout, Pt } from './layout.ts';
import { outside, route, SPEED, type Walker } from './motion.ts';
import type { Dir, Scene } from './scene.ts';

// Office couriers: which connector call brings which courier, its visit and its hand-over; pure, no DOM.
export type { Company, Product };
export const CSPEED = 2 * SPEED, GIVE = 1400, LINGER = 3000, DOOR_GAP = 16 + 35, HOLD_MAX = 20000, PASS = 12;
/** DOOR_GAP: a sprite's width plus its height (cap included), so two in single file stay apart round a corner too.
 *  The queued courier waits LIFT px up the aisle: its cap (a 35 px tall sprite) then clears a leaver PASS px down, and the
 *  leaver clears the first desk row's monitors. */
export const LIFT = 35 - PASS;
export const GIVE_AT = { fly: 200, land: 650, open: 900 } as const;

const GOOGLE: Record<string, Product> = { claude_ai_Gmail: 'gmail', claude_ai_Google_Calendar: 'calendar', claude_ai_Google_Drive: 'drive',
  claude_ai_Google_Docs: 'docs', claude_ai_Google_Sheets: 'sheets', claude_ai_Google_Slides: 'slides' };
export const companyOf = (server: string): Company | null => server === 'claude_ai_Microsoft_365' ? 'ms' : server in GOOGLE ? 'g' : null;
/** Google by its server; Microsoft 365 by the tool's prefix, else the company logo. */
export function productOf(server: string, tool: string): Product | null {
  if (server !== 'claude_ai_Microsoft_365') return GOOGLE[server] ?? null;
  return /^(teams_|chat_)/.test(tool) ? 'teams' : /^(outlook_|find_meeting)/.test(tool) ? 'outlook' : /^sharepoint_/.test(tool) ? 'sharepoint' : 'microsoft';
}
/** Per company, its latest call in the snapshot and that call's product. */
export function latestCalls(calls: ConnectorCall[]): Partial<Record<Company, { at: number; product: Product }>> {
  const out: Partial<Record<Company, { at: number; product: Product }>> = {};
  for (const k of calls) {
    const co = companyOf(k.server);
    if (co && k.at > (out[co]?.at ?? -Infinity)) out[co] = { at: k.at, product: productOf(k.server, k.tool)! };
  }
  return out;
}
/** The companies main is calling right now (a call still in activeTools: a permission wait, a long call), and whether
 *  main waits on a permission prompt (the hold has no time cap then; an idle prompt after an Esc does not count). */
export interface Busy { calls: Set<Company>; asking: boolean }
export function busyCalls(main: AgentView | undefined): Busy {
  const calls = new Set<Company>();
  for (const t of main?.activeTools ?? []) {
    const [mcp, server, ...rest] = t.name.split('__'), co = mcp === 'mcp' && rest.join('__') ? companyOf(server) : null;   // as the reducer parses it
    if (co) calls.add(co);
  }
  return { calls, asking: !!main?.reasons.some(r => r.kind === 'permission') };
}

/** The walk in (Entrance → the desk's right side), how far along it the queue point is, and the two points. */
export interface CourierSpots { path: Pt[]; len: number; queue: number; desk: Pt; queuePt: Pt }
export function courierSpots(l: Layout): CourierSpots {
  const F = l.foreman.seat, aisle = l.foreman.aisle, desk = { x: F.x + 36, y: F.y + 4 }, queuePt = { x: F.x + 60, y: aisle };
  const path = route(l, outside(l), { room: 'main', pt: desk, aisle }), len = pathLen(path);
  return { path, len, queue: len - (aisle - desk.y) - (queuePt.x - desk.x), desk, queuePt };
}

export type Mode = 'walk' | 'queue' | 'hold' | 'give' | 'linger';
/** `off`: px the courier steps aside: down (+PASS) while it walks out past the other one, up (−LIFT) while it queues. */
export interface Courier { co: Company; s: number; mode: Mode; t0: number; pending: number; product: Product; giving: Product | null; dir: Dir; off: number }
export interface Couriers { seen: Record<Company, number>; list: Courier[]; owner: Company | null }
/** A seed: nobody in the office, every call so far seen. A re-layout seed passes the couriers it replaces (`was`): their
 *  seen stays, so a call that came with the snapshot that grew the grid still sends its courier. */
export function seedCouriers(calls: ConnectorCall[], was?: Couriers): Couriers {
  const l = latestCalls(calls);
  return { seen: was ? { ...was.seen } : { ms: l.ms?.at ?? -Infinity, g: l.g?.at ?? -Infinity }, list: [], owner: null };
}
/** A newer call per company than seen: one more letter for its courier, who sets out from the Entrance if not in. Idempotent. */
export function noteCalls(c: Couriers, calls: ConnectorCall[]): void {
  for (const [co, { at, product }] of Object.entries(latestCalls(calls)) as [Company, { at: number; product: Product }][]) {
    if (at <= c.seen[co]) continue;
    c.seen[co] = at;
    let k = c.list.find(o => o.co === co);
    if (!k) c.list.push(k = { co, s: 0, mode: 'walk', t0: 0, pending: 0, product, giving: null, dir: 'right', off: 0 });
    k.pending++; k.product = product;
  }
}

const dirOf = (a: Pt, b: Pt): Dir => Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (b.x > a.x ? 'right' : 'left') : (b.y > a.y ? 'down' : 'up');

/** One frame (dt ms). `busy`: busyCalls(main); `seated`: foremanAtDesk. */
export function stepCouriers(c: Couriers, sp: CourierSpots, now: number, dt: number, busy: Busy, seated: boolean): void {
  for (const k of [...c.list].sort((a, b) => b.s - a.s)) {   // the one ahead claims the desk first
    const other = c.list.find(o => o !== k);
    const stay = other?.mode === 'queue' ? 0 : LINGER;       // someone queues: leave right after the hand-over
    const coming = !!other && other.pending > 0 && other.mode !== 'queue';   // on its way in: stay till it waits at the queue point, not meet it head-on
    const wants = k.pending > 0 || k.mode === 'hold' || k.mode === 'give' || (k.mode === 'linger' && (now - k.t0 < stay || coming));
    if (wants && c.owner === null) c.owner = k.co;
    else if (!wants && c.owner === k.co) c.owner = null;
    const passing = !!other && other.off > 0 && other.s > sp.queue - 16;   // the other walks out, not yet a sprite width past the queue point
    const T = wants ? (c.owner === k.co && !passing ? sp.len : sp.queue) : 0;
    // walking out with the other one in: a step down; at the queue point: a step up; so they pass clear of each other
    const to = k.s > T && other ? PASS : k.s === T && T === sp.queue ? -LIFT : 0, v = CSPEED * dt;
    k.off = Math.abs(to - k.off) <= v ? to : k.off + Math.sign(to - k.off) * v;
    if (k.s === T && T === sp.queue && k.off !== -LIFT) { k.mode = 'walk'; k.dir = 'up'; continue; }   // stepping up to wait
    if (k.s !== T) {
      // one at a time through the door, DOOR_GAP apart after this step; none comes in while the other walks out
      if (k.s === 0 && other && other.s > 0 && (other.s < DOOR_GAP + v || (other.mode === 'walk' && other.pending === 0))) continue;
      const a = pointAt(sp.path, k.s);
      k.s = k.s < T ? Math.min(T, k.s + CSPEED * dt) : Math.max(T, k.s - CSPEED * dt);
      const b = pointAt(sp.path, k.s);
      if (a.x !== b.x || a.y !== b.y) k.dir = dirOf(a, b);
      k.mode = 'walk';
      continue;
    }
    if (T === 0) { c.list = c.list.filter(o => o !== k); continue; }   // out of the Entrance
    k.dir = 'left';   // the queue point and the desk both face the foreman's side
    if (T === sp.queue) { k.mode = 'queue'; continue; }
    if (k.mode === 'give') { if (now - k.t0 >= GIVE) { k.mode = 'linger'; k.t0 = now; k.giving = null; } }
    else if (k.pending > 0) {
      if (k.mode !== 'hold') { k.mode = 'hold'; k.t0 = now; }
      // a call main lost (Esc: no PostToolUse until its Stop) holds at most HOLD_MAX; a permission prompt holds on
      const call = busy.calls.has(k.co) && (busy.asking || now - k.t0 < HOLD_MAX);
      if (seated && !call) { k.mode = 'give'; k.t0 = now; k.giving = k.product; k.pending--; }   // one letter per hand-over
    } else if (k.mode !== 'linger') { k.mode = 'linger'; k.t0 = now; }
  }
}
/** A courier holds the desk (hold, give, linger): no box visit starts. */
export const deskBusy = (c: Couriers, sp: CourierSpots): boolean => c.list.some(k => k.s === sp.len && k.mode !== 'walk');
/** The foreman sits at its desk: placed, its walker at rest, not on a box visit. */
export function foremanAtDesk(sc: Scene, walkers: Map<string, Walker>, visiting: boolean): boolean {
  const id = [...sc.places].find(([, p]) => p.kind === 'foreman')?.[0], w = id === undefined ? undefined : walkers.get(id);
  return !!w && !w.moving && !visiting;
}

const ease = (k: number) => k < .5 ? 2 * k * k : 1 - 2 * (1 - k) ** 2;   // corner.ts's
/** The letter `t` ms into a hand-over: in the hand, flying (`k` eased 0..1, `lift` px of the arc), on the
 *  desk, then gone and the icon balloon `rise` px up; `read` while the foreman reads. Outside [0, GIVE): nothing. */
export function handover(t: number): { letter: 'hand' | 'fly' | 'desk' | null; k: number; lift: number; rise: number | null; read: boolean } {
  const read = t >= GIVE_AT.land && t < GIVE;
  if (t < 0 || t >= GIVE) return { letter: null, k: 0, lift: 0, rise: null, read: false };
  if (t < GIVE_AT.fly) return { letter: 'hand', k: 0, lift: 0, rise: null, read };
  if (t < GIVE_AT.land) {
    const f = (t - GIVE_AT.fly) / (GIVE_AT.land - GIVE_AT.fly);
    return { letter: 'fly', k: ease(f), lift: Math.round(Math.sin(Math.PI * f) * 10), rise: null, read };
  }
  if (t < GIVE_AT.open) return { letter: 'desk', k: 1, lift: 0, rise: null, read };
  return { letter: null, k: 1, lift: 0, rise: Math.min(4, Math.floor((t - GIVE_AT.open) / 60)), read };
}

export interface CourierPose { co: Company; pt: Pt; dir: Dir; walking: boolean; tap: boolean; carry: boolean; product: Product; give: number | null }
/** What to draw: everyone past the Entrance (s > 0), stepped aside by `off`; carry while a letter is still to deliver; give: t into the hand-over. */
export function courierPoses(c: Couriers, sp: CourierSpots, now: number): CourierPose[] {
  return c.list.filter(k => k.s > 0).map(k => ({ co: k.co, pt: { x: pointAt(sp.path, k.s).x, y: pointAt(sp.path, k.s).y + k.off }, dir: k.dir, walking: k.mode === 'walk', tap: k.mode === 'hold',
    carry: k.pending > 0 && k.mode !== 'give', product: k.giving ?? k.product, give: k.mode === 'give' ? now - k.t0 : null }));
}
