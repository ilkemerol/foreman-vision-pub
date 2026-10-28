import { readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { SpoolLine } from '../shared/types.ts';
import { parseBoard, parseMode } from './board.ts';
import { emptyState, reduce, type SessionFacts, type State } from './reducer.ts';
import { readNew } from './tail.ts';
import { registry } from './term.ts';
import { scanTranscript } from './transcript.ts';

/** abandonMs: the spool ticks at each line's ts (the silence abandon of a replay); without it only tick() does.
 *  sessionsDir: Claude Code's session registry; tick() ends a session whose process is gone (endGone). */
export interface EngineDirs { spoolDir: string; stateDir: string; abandonMs?: number; sessionsDir?: string }

export interface Engine {
  state: State;
  /** Read everything new: spool lines, meta.json bindings, boards, transcripts. */
  scan(now: number): void;
  tick(now: number, abandonMs: number): void;
  /** Delete spools of ended or day-old sessions and drop them from the state. */
  sweep(now: number): void;
}

const DAY_MS = 24 * 3600_000;
const ENDED_GRACE_MS = 60_000;  // a late hook append must not re-create a swept spool
const STOPPED_READ_MS = 5 * 60_000; // stop reading an agent's transcript this long after it ended
const PID_DOMAIN = `${process.platform}:${hostname().toLowerCase()}`;   // the registry's pidDomain for this machine's pids

/** <dir>/<sid>.jsonl → <dir>/<sid>/subagents, where agent-<id>.meta.json and agent-<id>.jsonl live. */
export function subagentDir(transcriptPath: string): string {
  return join(dirname(transcriptPath), basename(transcriptPath, '.jsonl'), 'subagents');
}

/** An agent's transcript: main's is the session's transcript_path, a sub-agent's sits in its subagents dir. */
export const transcriptFile = (s: SessionFacts, agentId: string) =>
  agentId === 'main' ? s.transcriptPath! : join(subagentDir(s.transcriptPath!), `agent-${agentId}.jsonl`);

export function createEngine(dirs: EngineDirs): Engine {
  const state = emptyState();
  const offsets = new Map<string, number>();              // file → bytes consumed (spools and transcripts)
  const drained = new Set<string>();                      // transcripts of long-ended agents read to their end
  const unbound = new Set<string>();                      // "sid\tagentId" still waiting for meta.json
  const boardSeen = new Map<string, string>();            // sid → last mode + board text applied

  const spoolFiles = () => {
    try { return readdirSync(dirs.spoolDir).filter(f => f.endsWith('.jsonl')); } catch { return []; }
  };

  /** Before a replay tick: an agent silent in hooks past the limit takes its unread transcript's last line time ≤ now,
   *  as live it kept transcriptAt from the transcript's growth. `stamps` indexes each transcript once per scan. */
  function noteWrites(now: number, abandonMs: number, stamps: Map<string, number[]>) {
    for (const s of state.sessions.values()) {
      if (!s.transcriptPath) continue;
      for (const a of s.agents.values()) {
        if (a.id === 'main' || a.id.startsWith('pending:') || (a.hook !== 'running' && a.hook !== 'spawning')) continue;
        if (now - Math.max(a.lastEventAt, a.transcriptAt) <= abandonMs) continue;
        const path = transcriptFile(s, a.id);
        let ts = stamps.get(path);
        // ponytail: sees the next 8 MB chunk of the transcript, as readTranscripts does per scan
        if (!ts) stamps.set(path, (ts = readNew(path, offsets.get(path) ?? 0).lines.map(lineTime)));
        const last = ts.reduce((m, t) => (t <= now && t > m ? t : m), a.transcriptAt);
        if (last > a.transcriptAt) reduce(state, { kind: 'transcript', sid: s.sid, agentId: a.id, at: last, model: null, tokens: null, context: null });
      }
    }
  }

  function readSpool() {
    const stamps = new Map<string, number[]>();
    for (const f of spoolFiles()) {
      const path = join(dirs.spoolDir, f);
      const r = readNew(path, offsets.get(path) ?? 0);
      offsets.set(path, r.offset);
      for (const raw of r.lines) {
        const line = parseLine(raw);
        if (!line) { reduce(state, { kind: 'badLine' }); continue; }
        // a restart reads the spool at once: the ticks between its lines abandon the silent ones as the live ones did;
        // the transcript's own line times keep alive one silent in hooks but still writing, as live it was.
        if (dirs.abandonMs) {
          noteWrites(line.ts, dirs.abandonMs, stamps);
          reduce(state, { kind: 'tick', now: line.ts, abandonMs: dirs.abandonMs });
        }
        reduce(state, { kind: 'hook', line });
        const { session_id: sid, agent_id: aid } = line.payload;
        if (line.event === 'SubagentStart' && aid) unbound.add(sid + '\t' + aid);
      }
    }
  }

  function bindFromMeta() {
    for (const key of unbound) {
      const [sid, agentId] = key.split('\t');
      const s = state.sessions.get(sid);
      const a = s?.agents.get(agentId);
      if (!s || !a || a.toolUseId) { unbound.delete(key); continue; }
      const meta = s.transcriptPath ? readJson(join(subagentDir(s.transcriptPath), `agent-${agentId}.meta.json`)) : null;
      if (typeof meta?.toolUseId === 'string') {
        reduce(state, { kind: 'bind', sid, toolUseId: meta.toolUseId, agentId });
        unbound.delete(key);
      } else if (a.hook === 'stopped' || a.hook === 'abandoned') {
        unbound.delete(key); // no meta by its end: only PostToolUse(Agent) can still bind it
      }
    }
  }

  function readBoards() {
    for (const s of state.sessions.values()) {
      const mode = readText(join(dirs.stateDir, `active-${s.sid}`));
      const board = readText(join(dirs.stateDir, `board-${s.sid}`)) ?? '';
      const seen = `${mode ?? ''}\0${board}`;
      if (boardSeen.get(s.sid) === seen) continue;
      boardSeen.set(s.sid, seen);
      reduce(state, { kind: 'board', sid: s.sid, foreman: parseMode(mode), rows: parseBoard(board) });
    }
  }

  function readTranscripts(now: number) {
    for (const s of state.sessions.values()) {
      if (!s.transcriptPath) continue;
      for (const a of s.agents.values()) {
        if (a.id.startsWith('pending:')) continue;
        const path = transcriptFile(s, a.id);
        // long ended: read on (a restart starts at 0, 8 MB a scan) until a read finds nothing new, then never again
        const stale = a.endedAt !== null && now - a.endedAt > STOPPED_READ_MS;
        if (stale && drained.has(path)) continue;
        const r = readNew(path, offsets.get(path) ?? 0);
        if (stale && r.offset === (offsets.get(path) ?? 0)) drained.add(path);
        offsets.set(path, r.offset);
        if (!r.lines.length) continue;
        const { model, tokens, context } = scanTranscript(r.lines);
        // the growth's own time, not the scan's: a restart reads old lines, and live and replay then agree to the ms
        const at = Math.max(a.transcriptAt, Math.min(now, lastTime(r.lines) ?? now));
        reduce(state, { kind: 'transcript', sid: s.sid, agentId: a.id, at, model, tokens, context });
      }
    }
  }

  /** A Claude process killed, or lost with the machine, sends no SessionEnd. Its registry file stays behind only until
   *  the next Claude Code start, whose registry sweep deletes every dead pid's file (a clean exit removes it too). A
   *  session ends as by a SessionEnd at `now` when every registry file naming it is this machine's and its pid is gone,
   *  or when none names it and the file of its remembered pid (s.pid, kept over a restart) is gone or names another
   *  session. Never seen in the registry, a file it cannot judge or a live pid (a reused one too) keeps today's rules. */
  function endGone(now: number) {
    const up = new Map<string, boolean>();
    for (const o of registry(dirs.sessionsDir)) {
      if (typeof o.sessionId !== 'string') continue;
      const mine = o.pidDomain === PID_DOMAIN && Number.isSafeInteger(o.pid);
      const live = !mine || alive(o.pid as number);
      up.set(o.sessionId, up.get(o.sessionId) || live);
      const s = state.sessions.get(o.sessionId);
      if (s && mine && live) s.pid = o.pid as number;
    }
    for (const s of state.sessions.values()) {
      if (s.ended) continue;
      const gone = up.has(s.sid) ? !up.get(s.sid)
        : s.pid !== undefined && dirs.sessionsDir !== undefined && vanished(join(dirs.sessionsDir, `${s.pid}.json`), s.sid);
      if (gone) reduce(state, { kind: 'hook', line: { ts: now, event: 'SessionEnd', payload: { session_id: s.sid } } });
    }
  }

  return {
    state,
    scan(now) {
      readSpool();
      bindFromMeta();
      readBoards();
      readTranscripts(now);
    },
    tick(now, abandonMs) {
      reduce(state, { kind: 'tick', now, abandonMs });
      endGone(now);
    },
    sweep(now) {
      for (const f of spoolFiles()) {
        const path = join(dirs.spoolDir, f);
        const sid = basename(f, '.jsonl');
        let mtime: number;
        try { mtime = statSync(path).mtimeMs; } catch { continue; }
        const ended = state.sessions.get(sid)?.ended;
        if (ended ? now - mtime <= ENDED_GRACE_MS : now - mtime < DAY_MS) continue;
        try { unlinkSync(path); } catch { continue; }
        const tp = state.sessions.get(sid)?.transcriptPath;
        if (tp) {
          const sub = subagentDir(tp);
          for (const m of [offsets, drained]) for (const k of [...m.keys()]) if (k === tp || k.startsWith(sub)) m.delete(k);
        }
        for (const k of [...unbound]) if (k.startsWith(sid + '\t')) unbound.delete(k);
        offsets.delete(path);
        boardSeen.delete(sid);
        reduce(state, { kind: 'drop', sid });
      }
    },
  };
}

function parseLine(raw: string): SpoolLine | null {
  try {
    const l = JSON.parse(raw);
    return typeof l?.ts === 'number' && typeof l?.event === 'string' && typeof l?.payload?.session_id === 'string' ? l : null;
  } catch {
    return null;
  }
}

/** A transcript line's own `timestamp` in ms; NaN when it has none. */
function lineTime(raw: string): number {
  try { return Date.parse(JSON.parse(raw)?.timestamp); } catch { return NaN; }
}

/** The newest line time in appended lines: from the end, so a scan parses one line, not every tool output. */
function lastTime(lines: string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) { const t = lineTime(lines[i]); if (Number.isFinite(t)) return t; }
  return null;
}

/** kill(pid, 0) sends nothing: ESRCH, no such process; EPERM, one we may not signal, so alive (POSIX and Windows). */
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** A registry file seen once is no more: missing, or naming another session. One being rewritten in place (torn,
 *  unreadable, EBUSY) still stands. */
function vanished(path: string, sid: string): boolean {
  try {
    const o = JSON.parse(readFileSync(path, 'utf8'));
    return typeof o?.sessionId === 'string' && o.sessionId !== sid;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

function readText(path: string): string | null {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

function readJson(path: string): { toolUseId?: unknown } | null {
  const text = readText(path);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}
