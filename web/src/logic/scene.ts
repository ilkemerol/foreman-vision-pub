import type { AgentView, Stage } from '../../../shared/types.ts';
import { doneAisle, doneSeats, queueSpot, WAIT_MAX, waitAisle, waitSpots, type Layout, type Pt, type WorkRoom } from './layout.ts';
import { hash } from './model.ts';

// Who is where on one floor. The geometry is layout.ts's.
export const FAIL_RELEASE_MS = 20_000;
export const BURN_HOLD_MS = 15_000;   // a burn place outlives leaveAt this long: a 5 s tick shows it, the burn fits

export type Room = WorkRoom | 'wait' | 'done' | 'out';
export type Dir = 'down' | 'up' | 'right' | 'left';
export interface Spot { room: Room; pt: Pt; aisle: number }         // aisle: the y it leaves its place along (wait/done/queue: pt.y)
export interface Theme { work: string; wall: string }   // the floor theme tints only the main office
export type Pose = 'type' | 'read' | 'still';
export interface Place { spot: Spot; kind: 'foreman' | 'desk' | 'wait' | 'done' | 'queue' | 'fail' | 'burn'; pose: Pose; face: Dir; alpha: number; desk: number | null; bubble: 'alert' | 'info' | null; label: string; sprite: number }
export interface Scene { layout: Layout; places: Map<string, Place> }  // key: AgentView.id

/** Stopped while its board row still says running: it stays at its desk until the board says what the stop means, so
 *  verifying or failed next does not take back a desk released in between. */
export const stale = (a: AgentView) => a.stage === 'done' && a.badges.includes('stale-board');

/** Works at its desk (or waits there for the board): its screen is on and, at night, its lamp lit (an
 *  abandoned desk's lamp goes out). */
export const atWork = (a: AgentView | undefined): boolean => !!a && (a.stage === 'spawning' || a.stage === 'running' || a.stage === 'verifying' || stale(a));

const release = (a: AgentView) => stale(a) ? Infinity
  : a.stage === 'done' || a.stage === 'abandoned' ? a.stageSince : a.stage === 'failed' ? a.stageSince + FAIL_RELEASE_MS : Infinity;

// desks follow AgentView.key (the spawn's tool_use_id), so binding a pending agent to its id moves nothing.
// ponytail: an agent seen before its bind (SubagentStart ahead of the tool_use_id link) is keyed by its id until then;
// the page's DeskMemory keeps its desk at the bind, the replay alone may move it; key it from the engine's spawn match if that ever shows
const byStart = (agents: AgentView[]) =>
  agents.filter(a => a.role === 'agent').sort((a, b) => a.startedAt - b.startedAt || a.key.localeCompare(b.key));

/** Each agent holds a desk over each of its stretches: [startedAt, first stop), [each resume, next stop), the last one
 *  up to release. In start order each stretch keeps the agent's desk if it is free
 *  then, as the page's DeskMemory does, else `pick` chooses its [pool, desk in pool] from the pools' release times at
 *  `from`, or null to leave it unseated. The agent's desk is its last stretch's. */
function intervals(agents: AgentView[], pick: (a: AgentView, from: number, freeAt: number[][]) => [number, number] | null): Map<string, [number, number]> {
  // a past stretch ends at its break's start: the server sends where the desk was released, so a board hold after the
  // stop (verifying, stale) is in it
  const freeAt: number[][] = [[], [], []];   // per pool, per desk: the latest release of its owners so far
  const out = new Map<string, [number, number]>();
  const runs = byStart(agents).flatMap(a => {
    const ends = [...a.breaks.map(([stop]) => stop), release(a)];
    return [a.startedAt, ...a.breaks.map(([, resume]) => resume)].map((from, k) => ({ a, from, to: ends[k] }));
  }).sort((x, y) => x.from - y.from);   // stable: a tie keeps byStart's order
  for (const { a, from, to } of runs) {
    const own = out.get(a.id), free = (d: [number, number]) => (freeAt[d[0]][d[1]] ?? -Infinity) <= from;
    const at = own && free(own) ? own : pick(a, from, freeAt);
    if (!at) { out.delete(a.id); continue; }
    const f = freeAt[at[0]];
    f[at[1]] = Math.max(f[at[1]] ?? -Infinity, to);
    out.set(a.id, at);
  }
  return out;
}
const lowestFree = (f: number[], from: number) => { const i = f.findIndex(t => t <= from); return i < 0 ? f.length : i; };

/** The most desks held at once: a single-pool assignment, its desk count. With `page` (mem: the page's memory,
 *  updated here; now: server time) that count is taken once, at the page's first snapshot, and after it only the desks
 *  really held at `now` raise it: the replay's count can still change backwards (one arriving with an earlier startedAt,
 *  the board holding a stopped one's desk), which would grow the grid and reseed everyone. A reload counts from the past
 *  again; with each agent's stretches (breaks) that is what the page held. */
export function deskDemand(agents: AgentView[], page?: { mem: DeskMemory; now: number }): number {
  const peak = page?.mem.peak;
  if (page && peak !== undefined) return (page.mem.peak = Math.max(peak, agents.filter(a => a.role === 'agent' && release(a) > page.now).length));
  const m = intervals(agents, (_, from, freeAt) => [0, lowestFree(freeAt[0], from)]);
  const n = Math.max(0, ...[...m.values()].map(([, i]) => i + 1));
  if (page) page.mem.peak = n;
  return n;
}

const ROOMS: WorkRoom[] = ['main', 'server', 'library'];

/** Room = hash(key) mod 3, then the next rooms: the first desk `free` says yes to, from one the key picks in the room
 *  (hash / 3, so not tied to the room's mod 3) on; [room, desk in room], null when none is free. */
function pick(a: AgentView, idx: number[][], free: (r: number, i: number) => boolean): [number, number] | null {
  const h = hash(a.key);
  for (let j = 0; j < 3; j++) {
    const r = (h % 3 + j) % 3, n = idx[r].length;
    for (let k = 0; k < n; k++) { const i = (Math.floor(h / 3) + k) % n; if (free(r, i)) return [r, i]; }
  }
  return null;
}

/** Per floor, for the page's lifetime: the desk each agent was given (by AgentView.id and .key) and whether it held it
 *  then; `peak`: the desk demand so far (deskDemand), kept across a new grid. */
export interface DeskMemory { grid: string; seats: Map<string, { desk: number; held: boolean }>; peak?: number }
export const deskMemory = (): DeskMemory => ({ grid: '', seats: new Map() });

/** Room = hash(key) mod 3, the desk its key picks among those free in it at startedAt; a full room overflows
 *  to the next one. One that runs again keeps its desk if it is free at the resume, else picks again then (intervals).
 *  Returns an index into l.desks; an agent no room has space for (l not built for deskDemand) gets none.
 *  With `page` (mem: the page's memory, updated here; now: server time) nobody holding a desk at `now` moves: the
 *  replay re-seats a later agent when one arrives with an earlier startedAt (or the board held a desk the history does
 *  not show), so one who held its desk keeps it, and a newcomer takes its own old desk, else the replay's, else the
 *  first free one now. The replay follows the same rules over each agent's stretches, so a reload seats everyone where
 *  the page did. The same snapshot again changes nothing. */
export function assignDesks(agents: AgentView[], l: Layout, page?: { mem: DeskMemory; now: number }): Map<string, number> {
  const idx = ROOMS.map(r => l.desks.flatMap((d, i) => (d.room === r ? [i] : [])));
  const m = intervals(agents, (a, from, freeAt) => pick(a, idx, (r, i) => (freeAt[r][i] ?? -Infinity) <= from));
  const base = new Map([...m].map(([id, [r, i]]) => [id, idx[r][i]]));
  if (!page) return base;
  const { mem, now } = page;
  if (mem.grid !== l.key) { mem.grid = l.key; mem.seats.clear(); }   // a new grid seeds everyone at their new place
  const ag = byStart(agents), out = new Map<string, number>(), taken = new Set<number>(), holds = (a: AgentView) => release(a) > now;
  // seats go by id and by key: the id holds on while the key changes (keyed by its id until the bind, or a pending call
  // it briefly stands for), the key carries the desk from a pending card to its bound agent
  const seat = (a: AgentView, d: number | undefined) => { if (d !== undefined) { out.set(a.id, d); taken.add(d); } };
  for (const a of ag) { const s = mem.seats.get(a.id); if (holds(a) && s?.held && !taken.has(s.desk)) seat(a, s.desk); }
  for (const a of ag) if (holds(a) && !out.has(a.id)) {
    const at = pick(a, idx, (r, i) => !taken.has(idx[r][i]));
    seat(a, [mem.seats.get(a.id)?.desk, mem.seats.get(a.key)?.desk, base.get(a.id)].find(d => d !== undefined && !taken.has(d)) ?? (at ? idx[at[0]][at[1]] : undefined));
  }
  for (const a of ag) if (!holds(a)) { const d = (mem.seats.get(a.id) ?? mem.seats.get(a.key))?.desk ?? base.get(a.id); if (d !== undefined) out.set(a.id, d); }
  mem.seats = new Map(ag.filter(a => out.has(a.id)).flatMap(a => [a.key, a.id].map(k => [k, { desk: out.get(a.id)!, held: holds(a) }] as const)));
  return out;
}

const HOLDING = new Set<Stage>(['spawning', 'running', 'verifying', 'waiting']);
const bySince = (a: AgentView, b: AgentView) => a.stageSince - b.stageSince || a.id.localeCompare(b.id);

/** A Done lounge seat held over [since, until). */
export interface Stint { id: string; since: number; until: number }
const inDone = (a: AgentView) => a.role !== 'main' && a.role !== 'foreman' && a.stage === 'done' && !stale(a);
const stint = (a: AgentView): Stint => ({ id: a.id, since: a.stageSince, until: a.leaveAt === null ? Infinity : a.leaveAt + BURN_HOLD_MS });

/** Each done holds a seat over [stageSince, leaveAt + BURN_HOLD_MS) (leaveAt null: for good), the long
 *  gone ones too, so the result follows from the past alone; in (stageSince, id) order each takes the lowest seat free at
 *  its stageSince. `past`: stints that left done since the page loaded (rememberDone). The Done lounge
 *  holds at most `cap` (its seats): one arriving at a full room pushes out the oldest seat holder there (stageSince,
 *  then id), whose seat frees at once and who burns from then (`pushed`: id → that time, the pusher's stageSince).
 *  Returns seat indexes into doneSeats, all under `cap`. */
export function doneSeating(done: AgentView[], past: Stint[] = [], cap = Infinity): { seat: Map<string, number>; pushed: Map<string, number> } {
  const holder: (Stint | undefined)[] = [], seat = new Map<string, number>(), pushed = new Map<string, number>();
  for (const s of [...done.map(stint), ...past].sort((a, b) => a.since - b.since || a.id.localeCompare(b.id))) {
    const held = holder.flatMap((h, k) => (h && h.until > s.since ? [k] : []));
    if (held.length >= cap) {   // the oldest goes: holders arrive in (since, id) order, so the first one arrived first
      const k = held.reduce((a, b) => (holder[b]!.since < holder[a]!.since || (holder[b]!.since === holder[a]!.since && holder[b]!.id < holder[a]!.id) ? b : a));
      pushed.set(holder[k]!.id, s.since);
      holder[k] = { ...holder[k]!, until: s.since };
    }
    const i = holder.findIndex(h => !h || h.until <= s.since), k = i < 0 ? holder.length : i;
    holder[k] = s;
    seat.set(s.id, k);
  }
  return { seat, pushed };
}

/** Per floor, for the page's lifetime: each Done lounge agent's current stint, and the stints that ended. */
export interface DoneMemory { now: Map<string, Stint>; past: Stint[] }
export const doneMemory = (): DoneMemory => ({ now: new Map(), past: [] });
/** Drops the memory (sid → DoneMemory or DeskMemory) of every floor no longer in the snapshot's `sessions`. */
export function keepFloors<T>(mems: Map<string, T>, sessions: { sid: string }[]): void {
  const live = new Set(sessions.map(s => s.sid));
  for (const sid of mems.keys()) if (!live.has(sid)) mems.delete(sid);
}

/** One that leaves done (it runs again, or the board turns it stale) keeps its seat up
 *  to then, so nobody seated after it moves. Only the page remembers it: a reload compacts the seats once. Updates `m`
 *  from a snapshot (the same snapshot again changes nothing); returns the ended stints for doneSeating. */
export function rememberDone(m: DoneMemory, agents: AgentView[]): Stint[] {
  const byId = new Map(agents.map(a => [a.id, a]));
  for (const [id, s] of m.now) {
    const a = byId.get(id);
    if (a && inDone(a) && a.stageSince === s.since) continue;
    m.now.delete(id);
    const until = a ? Math.min(s.until, a.stageSince) : s.since;   // gone from the snapshot: nothing to keep
    if (until > s.since) m.past.push({ ...s, id: `${id}#${s.since}`, until });
  }
  for (const a of agents) if (inDone(a)) m.now.set(a.id, stint(a));
  m.past = m.past.filter(s => byId.has(s.id.slice(0, s.id.lastIndexOf('#'))));
  return m.past;
}

/** Where everyone on the floor is right now `now` is server time. */
export function officeScene(agents: AgentView[], now: number, l: Layout, past: Stint[] = [], mem?: DeskMemory): Scene {
  const desks = assignDesks(agents, l, mem && { mem, now });
  const last = new Map<number, AgentView>();   // per desk: the owner whose last stretch started latest
  const lastFrom = (a: AgentView) => a.breaks.at(-1)?.[1] ?? a.startedAt;
  for (const a of byStart(agents).sort((x, y) => lastFrom(x) - lastFrom(y))) if (desks.has(a.id)) last.set(desks.get(a.id)!, a);
  const holds = (a: AgentView) => a.role === 'agent' && (HOLDING.has(a.stage) || stale(a) || (a.stage === 'failed' && now - a.stageSince < FAIL_RELEASE_MS));
  const places = new Map<string, Place>();
  const put = (a: AgentView, spot: Spot, kind: Place['kind'], pose: Pose, face: Dir, alpha: number, bubble: Place['bubble'] = null) =>
    places.set(a.id, { spot, kind, pose, face, alpha, desk: desks.get(a.id) ?? null, bubble, label: a.label, sprite: hash(a.key) % 6 });   // by the spawn key: a pending agent keeps its body when it binds
  const ring = (a: AgentView) => (a.alert ? 'alert' : 'info');
  // past leaveAt the place burns for BURN_HOLD_MS, then there is none
  const until = (a: AgentView, stay: Place['kind'], leave = a.leaveAt) => leave === null || now < leave ? stay : now < leave + BURN_HOLD_MS ? 'burn' : null;
  const waiting: AgentView[] = [], done: AgentView[] = [], queue: AgentView[] = [];

  for (const a of agents) {
    if (a.role === 'main' || a.role === 'foreman') {
      put(a, { room: 'main', pt: l.foreman.seat, aisle: l.foreman.aisle }, 'foreman', a.stage === 'running' ? 'type' : 'still', 'down', 1, a.stage === 'waiting' ? ring(a) : null);
    } else if (a.stage === 'waiting') waiting.push(a);
    else if (inDone(a)) done.push(a);
    else if (a.role === 'placeholder') {
      if (a.stage === 'queued' || a.stage === 'running' || a.stage === 'verifying') queue.push(a);
    } else {
      const i = desks.get(a.id);
      if (i === undefined) continue;   // no room had a desk (a layout not built for deskDemand)
      const d = l.desks[i], at: Spot = { room: d.room, pt: d.seat, aisle: d.aisle };
      if (a.stage === 'spawning' || a.stage === 'running') put(a, at, 'desk', 'type', 'up', 1);
      else if (a.stage === 'verifying' || stale(a)) put(a, at, 'desk', 'read', 'up', 1);
      else if (a.stage === 'failed') { if (holds(a)) put(a, at, 'fail', 'type', 'up', 1); }   // past the sequence: gone
      else if (a.stage === 'abandoned' && last.get(i) === a && !agents.some(o => o !== a && holds(o) && desks.get(o.id) === i)) {
        const k = until(a, 'desk');
        if (k) put(a, at, k, 'still', 'up', 0.35);
      }
    }
  }
  const w = waitSpots(waiting.length, l);
  waiting.sort(bySince).forEach((a, k) =>
    put(a, { room: 'wait', pt: w[k], aisle: waitAisle(l, w[k]) }, 'wait', 'still', 'down', a.role === 'placeholder' ? 0.6 : 1, k < WAIT_MAX ? ring(a) : null));
  // no more than its seats; one pushed out leaves (burns) when the earlier of its leaveAt and the push
  const seats = doneSeats(l), { seat, pushed } = doneSeating(done, past, seats.length);
  for (const a of done) {
    const p = pushed.get(a.id), k = until(a, 'done', p === undefined ? a.leaveAt : Math.min(p, a.leaveAt ?? Infinity)), pt = seats[seat.get(a.id)!];
    if (k) put(a, { room: 'done', pt, aisle: doneAisle(l, pt) }, k, 'read', 'down', 1);
  }
  queue.sort(bySince).forEach((a, k) => put(a, { room: 'main', pt: queueSpot(k, l), aisle: l.h - 16 }, 'queue', 'still', 'down', 0.5));
  return { layout: l, places };
}

export interface Hit { id: string; x0: number; y0: number; x1: number; y1: number; z: number } // office px; larger z = in front

/** The front-most hit box containing `p`. */
export function hitAt(hits: Hit[], p: Pt): string | null {
  let best: Hit | null = null;
  for (const h of hits) if (p.x >= h.x0 && p.x <= h.x1 && p.y >= h.y0 && p.y <= h.y1 && (!best || h.z > best.z)) best = h;
  return best?.id ?? null;
}

export const THEMES: Theme[] = [
  { work: '#a9825f', wall: '#a48fb8' },   // dusk
  { work: '#c8925c', wall: '#8b96bd' },   // warm
  { work: '#b99a6a', wall: '#8fae9b' },   // sage
];
/** By the floor's sid, not its F: a renumbered floor keeps its colour. */
export const themeOf = (sid: string): Theme => THEMES[hash(sid) % THEMES.length];
