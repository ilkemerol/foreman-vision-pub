import type { AgentView } from '../../../shared/types.ts';
import { placeDecor } from './decor.ts';
import { overworkMin, pathLen, pointAt, teamSpeed } from './fx.ts';
import type { Layout, Pt, Rect } from './layout.ts';
import { outside, route } from './motion.ts';
import type { Dir } from './scene.ts';
// The server-room fire: the trigger, its memory, and the event's timeline, a pure function of the
// layout and the time since it started. Drawing: components/office/fire.ts.

// ------------------------------------------------------------ the trigger
export const FIRE_HOT = 5, FIRE_MIN = 30;
export const FIRE_COOLDOWN = 2 * 3_600_000, FIRE_SOOT = 10 * 60_000, SOOT_FADE = 3000;

/** Sub-agents whose current working stretch is FIRE_MIN minutes or more (the overwork clock). */
export function hotCount(agents: Iterable<AgentView>, now: number): number {
  let n = 0;
  for (const a of agents) { const m = overworkMin(a, now); if (m !== null && m >= FIRE_MIN) n++; }
  return n;
}
export const fireMet = (agents: Iterable<AgentView>, now: number): boolean => hotCount(agents, now) >= FIRE_HOT;

/** Per floor: `armed` the condition was seen unmet since the last look that found it met; `last` the server
 *  time of the last fire (null: none known). */
export interface FireMemory { armed: boolean; last: number | null }
export const fireMemory = (last: number | null = null): FireMemory => ({ armed: false, last });
/** A bind (a mount, a reload, a floor or view change, a tab return, a new grid): armed only if it is not met now, so a
 *  condition already met (or met while nobody watched) never fires. */
export function armFire(m: FireMemory, met: boolean): void { m.armed = !met; }
/** One look: true when a fire starts now (then m.last = now). Met while armed and FIRE_COOLDOWN past the last fire:
 *  fire; met: disarm either way, so only a break and a new forming fires again. */
export function stepFire(m: FireMemory, met: boolean, now: number): boolean {
  if (!met) { m.armed = true; return false; }
  const go = m.armed && (m.last === null || now - m.last >= FIRE_COOLDOWN);
  m.armed = false;
  if (go) m.last = now;
  return go;
}
/** The soot left on the burnt racks, 1 → 0 over its last SOOT_FADE ms, FIRE_SOOT after the fire's start. */
export function sootAt(now: number, last: number | null): number {
  if (last === null || now < last) return 0;
  return Math.max(0, Math.min(1, 1 - (now - last - FIRE_SOOT) / SOOT_FADE));
}

// ------------------------------------------------------------ the last fire per floor, in this browser
export type FireLog = Record<string, number>;
const KEY = 'foreman-vision.fire';
/** Bad JSON or a non-finite time is dropped. */
export function parseFireLog(raw: string | null): FireLog {
  let v: unknown = null;
  try { v = JSON.parse(raw ?? 'null'); } catch { /* empty */ }
  const out: FireLog = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [sid, t] of Object.entries(v)) if (typeof t === 'number' && Number.isFinite(t)) out[sid] = t;
  return out;
}
/** The log with `sid`'s fire at `now`, entries past the cooldown dropped (they no longer matter: soot ends sooner). */
export const logFire = (log: FireLog, sid: string, now: number): FireLog =>
  Object.fromEntries(Object.entries({ ...log, [sid]: now }).filter(([, t]) => now - t < FIRE_COOLDOWN));
export function loadFireLog(): FireLog {
  try { return parseFireLog(localStorage.getItem(KEY)); } catch { return {}; }
}
export function saveFireLog(log: FireLog): void {
  try { localStorage.setItem(KEY, JSON.stringify(log)); } catch { /* private mode: this tab only */ }
}

// ------------------------------------------------------------ where it happens
/** A server cabinet: its flat top-left (14×30); i 0 is the top one. */
export interface Rack { i: number; x: number; y: number }
/** One firefighter's walk: Entrance → the server room's bottom line → the column right of the racks → its rack. */
export interface Crew { path: Pt[]; len: number; rack: Rack }
/** `grab`: who takes the room's extinguisher (`ext`, its decor box), at `sExt` px along its path; -1: none. */
export interface FireGeom { racks: Rack[]; burn: Rack[]; crew: Crew[]; ext: Rect | null; grab: number; sExt: number }

/** The server room's rack column (flat.ts and iso.ts draw it from here). */
export function serverRacks(l: Pick<Layout, 'rooms'>): Rack[] {
  const sv = l.rooms.server, out: Rack[] = [];
  for (let y = sv.y0 + 4, i = 0; y + 30 <= sv.y1; y += 30, i++) out.push({ i, x: sv.x0 + 8, y });
  return out;
}
export const CREW_LINE = 8, BURN_MAX = 3;
/** The column the crew stands on: 34 px right of the room's left wall, moved left (to 28 at most, its
 *  feet then just clear of the rack column) where a desk stands closer, so its feet (±6 px) keep off the desks. */
export function crewX(l: Pick<Layout, 'rooms' | 'desks'>): number {
  const sv = l.rooms.server, left = Math.min(Infinity, ...l.desks.filter(d => d.room === 'server').map(d => d.cx - 24));
  return Math.max(sv.x0 + 28, Math.min(sv.x0 + 34, left - 6));
}
/** The top min(3, n) racks burn, one firefighter each, the leader to the top one; the extinguisher goes to
 *  the one whose path passes nearest it (a tie: the last in line). */
export function fireGeom(l: Layout): FireGeom {
  const sv = l.rooms.server, racks = serverRacks(l), burn = racks.slice(0, BURN_MAX);
  const X = crewX(l), B = sv.y1 - CREW_LINE;
  const base = route(l, outside(l), { room: 'server', pt: { x: X, y: B }, aisle: B });
  const crew = burn.map(rack => { const path = [...base, { x: X, y: rack.y + 28 }]; return { path, len: pathLen(path), rack }; });
  const e = placeDecor(l).find(p => p.name === 'extinguisher' && p.room === 'server'), ext = e ? { x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 } : null;
  let grab = -1, sExt = 0, best = Infinity;
  if (ext) crew.forEach((c, i) => {
    for (let s = 0; s <= c.len; s += 2) {
      const q = pointAt(c.path, s), d = Math.hypot(q.x - (ext.x0 + ext.x1) / 2, q.y - ext.y1) - i * 0.01;   // − i·0.01: a tie goes to the later one
      if (d < best) { best = d; sExt = s; grab = i; }
    }
  });
  return { racks, burn, crew, ext, grab, sExt };
}

// ------------------------------------------------------------ the timeline (ms after the fire's start)
export const FIRE = {
  smokeGap: 1500, smokeIn: 1200, flameAt: 3000, grow: 800, engine: 6000, walk: 7000, gap: 22, pick: 800, turn: 300,
  spray: 4500, tail: 700, powder: 2000, smokeOut: 4000, alarmTail: 1500, leave: 1200, exit: 60, engineTail: 800,
} as const;
export interface FireTimes { speed: number; arrive: number[]; spray: number[]; out: number[]; leave: number; end: number }

/** Whether crew member i stops at the extinguisher (the grabber, and the ones behind it whose stop falls on their path),
 *  and where: the line keeps its gaps. */
function stopOf(g: FireGeom, i: number): number | null {
  if (g.grab < 0 || i < g.grab) return null;
  const at = g.sExt - (i - g.grab) * FIRE.gap;
  return at <= g.crew[i].len && (i === g.grab || at < g.crew[i].len) ? at : null;
}
export function fireTimes(g: FireGeom): FireTimes {
  const max = Math.max(...g.crew.map(c => c.len)), speed = teamSpeed(max);
  const arrive = g.crew.map((c, i) => FIRE.walk + (c.len + i * FIRE.gap) / speed + (stopOf(g, i) !== null ? FIRE.pick : 0));
  const spray = arrive.map(a => a + FIRE.turn), out = spray.map(s => s + FIRE.spray);
  const leave = Math.max(...out) + FIRE.tail + FIRE.leave;
  return { speed, arrive, spray, out, leave, end: leave + (max + FIRE.exit) / speed };
}

export interface RackFx { rack: Rack; flame: number; smoke: number; powder: number; soot: number; alarm: boolean }
export interface CrewFx { i: number; pt: Pt; dir: Dir; moving: boolean; ext: boolean; spraying: boolean; rack: Rack }
/** One frame of the event; `extTaken`: the extinguisher is in a hand (not drawn as decor). */
export interface FireFx { racks: RackFx[]; crew: CrewFx[]; extTaken: boolean; alarm: boolean; engine: boolean }
/** One frame's fire for the renderers (renderer.ts Frame.fire): the event while it runs, else the soot left (0..1). */
export interface FireFrame { geom: FireGeom; fx: FireFx | null; soot: number }

const ramp = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const dirTo = (dx: number, dy: number): Dir => Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');

/** The event at t ms after its start, null once over. `calm`: the flame in thirds, nobody walks — the crew
 *  stands at its racks from arrival to leaving. */
export function fireAt(g: FireGeom, ft: FireTimes, t: number, calm: boolean): FireFx | null {
  if (t < 0 || t >= ft.end + FIRE.engineTail) return null;
  const outAll = Math.max(...ft.out);
  const racks = g.burn.map((rack, i): RackFx => {
    const from = i * FIRE.smokeGap, lit = FIRE.flameAt + i * FIRE.smokeGap, out = ft.out[i];
    let flame = Math.min(ramp(t, lit, lit + FIRE.grow), 1 - ramp(t, ft.spray[i], out));
    if (calm) flame = Math.ceil(flame * 3 - 1e-9) / 3;
    const smoke = t < out ? Math.max(ramp(t, from, from + FIRE.smokeIn), flame) : 1 - ramp(t, out, out + FIRE.smokeOut);
    const sprayEnd = out + FIRE.tail, powder = t >= ft.spray[i] ? 1 - ramp(t, sprayEnd, sprayEnd + FIRE.powder) : 0;
    return { rack, flame, smoke, powder, soot: t < lit ? 0 : t < out ? flame * 0.6 : 1, alarm: t >= from && t < out + FIRE.alarmTail };
  });
  const crew: CrewFx[] = [];
  let extTaken = false;
  g.crew.forEach((c, i) => {
    const grabs = i === g.grab, pk = FIRE.pick * ft.speed, stop = stopOf(g, i), spraying = t >= ft.spray[i] && t < ft.out[i] + FIRE.tail;
    let s: number, moving = false, back = false, picking = false, ext = !grabs;
    if (calm) {
      if (t < ft.arrive[i] || t >= ft.leave) return;
      s = c.len; ext = true;
    } else if (t < FIRE.walk || t >= ft.end) return;
    else if (t < ft.leave) {
      s = (t - FIRE.walk) * ft.speed - i * FIRE.gap;   // where it would be without the stop
      if (stop !== null && s > stop) {
        picking = s - stop < pk;
        if (grabs) ext = s - stop > pk / 2;
        s = picking ? stop : s - pk;
      }
      if (s < -FIRE.exit) return;
      moving = s < c.len && !picking; s = Math.min(s, c.len);
    } else {
      s = c.len - (t - ft.leave) * ft.speed; back = moving = true;
      if (grabs) ext = s > g.sExt;   // put back in passing
      if (s < -FIRE.exit) return;
    }
    const pt = pointAt(c.path, s), n = pointAt(c.path, s + (back ? -1 : 1));
    let dir = dirTo(n.x - pt.x, n.y - pt.y);
    if (picking && grabs && g.ext) dir = dirTo((g.ext.x0 + g.ext.x1) / 2 - pt.x, g.ext.y1 - 4 - pt.y);
    else if (!moving) dir = 'left';   // at its rack, facing it
    crew.push({ i, pt, dir, moving, ext, spraying: spraying && !moving && !picking, rack: c.rack });
    if (grabs) extTaken = ext;
  });
  return { racks, crew, extTaken, alarm: t >= FIRE.flameAt && t < outAll + FIRE.alarmTail, engine: t >= FIRE.engine && t < ft.end + FIRE.engineTail };
}
