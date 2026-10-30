import type { AgentView, Badge, Reason, SessionView, Snapshot, Stage } from '../shared/types.ts';
import { BOARD_GRACE_MS, DONE_STAY_MS } from '../shared/types.ts';
import type { AgentFacts, BoardRow, SessionFacts, State } from './reducer.ts';

const ALERT_NOTE = /^(needs-decision|blocked)\b/; // needs-agent / needs-info are the foreman's job
// done/failed "-" rows are from before the spool; a waiting "-" row is a decision before the spawn (its placeholder waits)
const OPEN_ROW = new Set(['queued', 'running']);
const LIVE_ROW = new Set(['queued', 'running', 'verifying']);   // an unbound live row holds every clock
export const DONE_KEEP = 5;

type Unstamped = Omit<AgentView, 'stageSince' | 'leaveAt'>;

/** Also updates each session's `stages` and `leave` memory, so call it with the real clock. */
export function toSnapshot(state: State, now: number): Snapshot {
  const sessions = [...state.sessions.values()].sort((a, b) => a.firstSeen - b.firstSeen).map(s => ({ ...sessionView(s, now), hiddenAt: state.hidden.get(s.sid) ?? null }));
  return { serverTime: now, sessions, unknownEvents: state.unknownEvents, badLines: state.badLines };
}

function sessionView(s: SessionFacts, now: number): Omit<SessionView, 'hiddenAt'> {
  const rowOf = new Map(s.board.filter(r => r.agentId).map(r => [r.agentId!, r]));
  const all = withPending(s);
  const paired = pairRows(s, all);
  const pairedRows = new Set(paired.values());
  const views = all.filter(a => !isGhost(a)).map(a => agentView(s, a, rowOf.get(a.id) ?? paired.get(a.id)));
  for (const r of s.board) {
    if (!pairedRows.has(r) && (!r.agentId || !s.agents.has(r.agentId))) views.push(placeholder(r));
  }
  const fresh = new Set(views.filter(v => !s.stages.has(v.id)).map(v => v.id));
  const rowed = new Set([...rowOf.keys(), ...paired.keys()]);
  const agents = views.map(v => stamp(s, v, now));
  leaveTimes(s, agents, rowed, fresh, pairedRows, now);
  holdTimes(s, agents, now);
  const seen = new Set(agents.map(a => a.id));
  for (const id of s.stages.keys()) if (!seen.has(id)) s.stages.delete(id);
  return {
    sid: s.sid, cwd: s.cwd,
    project: s.cwd?.split(/[\\/]/).filter(Boolean).pop() ?? s.sid.slice(0, 8),
    firstSeen: s.firstSeen, ended: s.ended, foreman: s.foreman,
    waitingCount: agents.filter(a => a.alert).length, agents, context: s.context,
    connectors: [...s.connectors.values()].sort((a, b) => a.at - b.at || (a.server < b.server ? -1 : 1)),
  };
}

const oldestFirst = (a: AgentFacts, b: AgentFacts) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1);

/** An agent that started before its meta.json bind and its unbound pending Agent call of the same type
 *  are one job. The agent takes the call's data as link() will (reducer.ts), so its key never changes on the bind;
 *  the pending card goes. Several of a type: oldest call with oldest agent. An agent of type unknown (no agent_type)
 *  takes the oldest call left after the typed agents took theirs, and the call's type, as link() gives it. */
function withPending(s: SessionFacts): AgentFacts[] {
  const all = [...s.agents.values()];
  const reserved = new Set(s.bindings.keys());   // a call whose agent is known but not seen yet waits for that agent
  const calls = all.filter(a => a.id.startsWith('pending:') && !reserved.has(a.toolUseId!)).sort(oldestFirst);
  const merged = new Map<string, AgentFacts>(), taken = new Set<string>();
  const loose = all.filter(a => a.id !== 'main' && !a.id.startsWith('pending:') && !a.toolUseId && !isGhost(a)).sort(oldestFirst);
  const unknown = (a: AgentFacts) => a.type === 'unknown';
  for (const a of [...loose.filter(a => !unknown(a)), ...loose.filter(unknown)]) {
    const i = calls.findIndex(p => unknown(a) || p.type === a.type);
    if (i < 0) continue;
    const [p] = calls.splice(i, 1);
    taken.add(p.id);
    merged.set(a.id, { ...a, toolUseId: p.toolUseId, parentId: p.parentId, description: p.description,
      type: unknown(a) ? p.type : a.type, startedAt: Math.min(a.startedAt, p.startedAt) });
  }
  return all.filter(a => !taken.has(a.id)).map(a => merged.get(a.id) ?? a);
}

/** An unbound open row and an unbound live agent of its type are one job, matched in order. A paired
 *  agent that stops keeps its row until the board binds or removes it: no walk out and back. */
function pairRows(s: SessionFacts, all: AgentFacts[]): Map<string, BoardRow> {
  const bound = new Set(s.board.map(r => r.agentId));
  const unbound = new Map(s.board.filter(r => !r.agentId).map(r => [r.n, r]));
  const paired = new Map<string, BoardRow>();
  for (const a of all) {
    const r = a.hook === 'stopped' && !bound.has(a.id) ? unbound.get(s.pairs.get(a.id) ?? NaN) : undefined;
    if (r) { paired.set(a.id, r); unbound.delete(r.n); }
  }
  const free = all.filter(a => a.id !== 'main' && a.hook !== 'stopped' && !bound.has(a.id)).sort(oldestFirst);
  for (const r of [...unbound.values()].sort((a, b) => a.n - b.n)) {
    if (!OPEN_ROW.has(r.stage)) continue;
    const i = free.findIndex(a => a.type === r.type);
    if (i >= 0) paired.set(free.splice(i, 1)[0].id, r);
  }
  s.pairs = new Map([...paired].map(([id, r]) => [id, r.n]));
  return paired;
}

/** A forked skill opens and stops an agent in one event; its first event was SubagentStop. */
function isGhost(a: AgentFacts) {
  return a.type === 'unknown' && a.hook === 'stopped' && a.endedAt === a.startedAt;
}

/** stageSince is when this view's stage last changed; first sight falls back to the facts. A stale-board
 *  done is its own stage: the office keeps it at its desk, so the board's done after it releases the desk from then. */
function stamp(s: SessionFacts, v: Unstamped, now: number): AgentView {
  const prev = s.stages.get(v.id), stage = v.stage + (v.badges.includes('stale-board') ? '*' : '');
  const since = !prev ? v.endedAt ?? (v.startedAt || now) : prev.stage === stage ? prev.since : now;
  s.stages.set(v.id, { stage, since });
  return { ...v, stageSince: since, leaveAt: null };
}

// the exact reverse of the client's bySince (web/src/logic/scene.ts), ties included
const newestFirst = (a: AgentView, b: AgentView) => b.stageSince - a.stageSince || b.id.localeCompare(a.id);

/** When each finished sub-agent leaves the office. A past value stays while the agent stays
 *  finished; a value is never moved earlier. `fresh`: first sight (a restart), computed from the past. A "-" row
 *  paired with an agent is that agent's, so it holds no clock. */
function leaveTimes(s: SessionFacts, agents: AgentView[], rowed: Set<string>, fresh: Set<string>, pairedRows: Set<BoardRow>, now: number): void {
  const board = s.foreman !== 'off';
  const finished = (a: AgentView) => a.role === 'agent' && (a.stage === 'done' || a.stage === 'abandoned');
  const cand = (a: AgentView) => finished(a) && (a.stage === 'done' ? !a.badges.includes('stale-board') : board);
  const gone = (a: AgentView) => finished(a) && (s.leave.get(a.id) ?? Infinity) <= now;
  const room = agents.filter(a => cand(a) && !gone(a));
  const keep = new Set([...agents.filter(gone), ...room].map(a => a.id));
  for (const id of s.leave.keys()) if (!keep.has(id)) s.leave.delete(id);
  if (board) {
    const held = s.board.some(r => !r.agentId && LIVE_ROW.has(r.stage) && !pairedRows.has(r));
    for (const a of room) {
      const past = a.stageSince + BOARD_GRACE_MS;   // first sight: left before the restart if its grace is over
      if (rowed.has(a.id)) s.leave.delete(a.id);
      else if (fresh.has(a.id) && (!held || past <= now)) s.leave.set(a.id, past);
      else if (held) s.leave.delete(a.id);
      else if (!s.leave.has(a.id)) s.leave.set(a.id, now + BOARD_GRACE_MS);
    }
  } else {
    const all = agents.filter(cand).sort(newestFirst);
    all.forEach((a, i) => { if (fresh.has(a.id) && i >= DONE_KEEP) s.leave.set(a.id, all[i - DONE_KEEP].stageSince); });
    room.filter(a => !gone(a)).sort(newestFirst).forEach((a, i) => { if (i < DONE_KEEP) s.leave.delete(a.id); else s.leave.set(a.id, now); });
  }
  // a done one leaves the Done lounge DONE_STAY_MS after it came in (stageSince) at the latest, the earlier
  // time wins. Applied here, not kept in `leave`, so the rules above run as before; it follows from stageSince alone.
  for (const a of agents) {
    const t = Math.min(s.leave.get(a.id) ?? Infinity, cand(a) && a.stage === 'done' ? a.stageSince + DONE_STAY_MS : Infinity);
    a.leaveAt = t < Infinity ? t : null;
  }
}

const FAIL_RELEASE_MS = 20_000;   // the client's (web/src/logic/scene.ts)

/** When a stopped agent's desk is released, by the client's rule (scene.ts release): done and abandoned at stageSince,
 *  failed after its sequence; null: held (verifying, stale-board, waiting). */
function releaseAt(a: AgentView): number | null {
  if ((a.stage === 'done' && !a.badges.includes('stale-board')) || a.stage === 'abandoned') return a.stageSince;
  return a.stage === 'failed' ? a.stageSince + FAIL_RELEASE_MS : null;
}

/** Each stop's release as seen live, kept in `holds` by
 *  "<id>@<endedAt>" (null: still held at last sight). A sent break [stop, resume] starts at that release instead,
 *  capped at the resume, so the client's replay frees the desk where the live page did; never seen: the stop. */
function holdTimes(s: SessionFacts, agents: AgentView[], now: number): void {
  const keep = new Map<string, number | null>();
  for (const a of agents) {
    if (a.role !== 'agent') continue;
    a.breaks = a.breaks.map(([stop, resume]) => {
      const r = s.holds.get(`${a.id}@${stop}`);
      if (r === undefined) return [stop, resume];
      keep.set(`${a.id}@${stop}`, r);
      return [Math.min(r ?? Infinity, resume), resume];
    });
    if (a.endedAt === null) continue;
    const k = `${a.id}@${a.endedAt}`, prev = s.holds.get(k);
    keep.set(k, prev != null && prev <= now ? prev : releaseAt(a));   // a past release stays
  }
  s.holds = keep;
}

/** Liveness comes from hooks, meaning after the stop comes from the board. */
function agentView(s: SessionFacts, a: AgentFacts, row: BoardRow | undefined): Unstamped {
  const isMain = a.id === 'main';
  const boardWaiting = row?.stage === 'waiting';
  const badges: Badge[] = [];
  let stage: Stage;
  switch (a.hook) {
    case 'stopped':
      if (!row) stage = 'done';
      else if (row.stage === 'running' || row.stage === 'queued') { stage = 'done'; badges.push('stale-board'); }
      else stage = row.stage; // verifying | done | failed | waiting
      break;
    case 'running':
      stage = boardWaiting ? 'waiting' : 'running';
      break;
    default:
      stage = a.hook; // spawning | waiting | idle | abandoned
  }
  if (!isMain && !row && s.foreman !== 'off' && a.hook !== 'stopped' && !a.id.startsWith('pending:')) badges.push('off-board');
  const reasons: Reason[] = [];
  if (a.hook === 'waiting' && a.waitReason) reasons.push(a.waitReason);
  if (boardWaiting && row.note) reasons.push({ kind: 'note', text: row.note });
  return {
    id: a.id, key: a.toolUseId ?? a.id, parentId: a.parentId,   // a pending agent carries its tool_use_id too
    role: isMain ? (s.foreman === 'off' ? 'main' : 'foreman') : 'agent',
    type: row?.type ?? a.type,
    label: row?.job ?? a.description ?? a.type,
    stage, reasons,
    alert: (a.hook === 'waiting' && a.alert) || (boardWaiting && ALERT_NOTE.test(row.note)),
    badges, note: row?.note || null,
    activeTools: a.activeTools.map(t => ({ ...t })),
    recentTools: a.recentTools,
    model: a.model, tokens: a.tokens, startedAt: a.startedAt, endedAt: a.endedAt, activeSince: a.activeSince, breaks: a.breaks,
  };
}

/** A board row with no live agent behind it: not spawned yet ("-") or from before the spool. */
function placeholder(r: BoardRow): Unstamped {
  const waiting = r.stage === 'waiting';
  return {
    id: 'board:' + r.n, key: 'board:' + r.n, parentId: 'main', role: 'placeholder', type: r.type, label: r.job, stage: r.stage,
    reasons: waiting && r.note ? [{ kind: 'note', text: r.note }] : [], alert: waiting && ALERT_NOTE.test(r.note), badges: [], note: r.note || null,
    activeTools: [], recentTools: [], model: null, tokens: 0, startedAt: 0, endedAt: null, activeSince: null, breaks: [],
  };
}
