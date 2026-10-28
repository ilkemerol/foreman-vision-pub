import type { BoardStage, ConnectorCall, ContextUse, ForemanMode, HookPayload, Reason, SpoolLine, Stage, ToolCall, ToolRef } from '../shared/types.ts';

export type HookStage = 'spawning' | 'running' | 'waiting' | 'idle' | 'stopped' | 'abandoned';

export interface ActiveTool extends ToolRef { toolUseId: string; startedAt: number }

export interface AgentFacts {
  id: string;               // agent_id, 'main', or 'pending:<tool_use_id>' until its agent is bound
  parentId: string | null;
  type: string;
  description: string | null;
  toolUseId: string | null;
  hook: HookStage;
  waitReason: Reason | null;
  alert: boolean;
  activeTools: ActiveTool[];
  recentTools: ToolCall[];  // newest first, at most 5
  startedAt: number;
  lastEventAt: number;
  endedAt: number | null;
  activeSince: number | null;   // last time its hook went running from another one (setHook); null: not since it started
  breaks: [number, number][];   // [endedAt, resumedAt] of each stop it came back from, oldest first
  transcriptAt: number;     // last time the engine saw the transcript grow
  model: string | null;
  tokens: number;
}

export interface BoardRow { n: number; agentId: string | null; type: string; job: string; stage: BoardStage; note: string }

export interface SessionFacts {
  sid: string;
  cwd: string | null;
  transcriptPath: string | null;
  firstSeen: number;
  ended: boolean;
  pid?: number;   // its Claude process, from this machine's registry (engine endGone); the view memory keeps it
  foreman: ForemanMode;
  board: BoardRow[];
  agents: Map<string, AgentFacts>;
  bindings: Map<string, string>; // tool_use_id → agent_id
  stages: Map<string, { stage: string; since: number }>; // AgentView.id → last seen stage key (view.ts stamp); the view keeps it
  leave: Map<string, number>;   // AgentView.id → when it leaves the office (view.ts leaveTimes); in memory only
  holds: Map<string, number | null>;   // "<agent id>@<endedAt>" → when that stop released its desk (view.ts holdTimes); the view keeps it
  pairs: Map<string, number>;   // agent id → the unbound board row n it was last paired with (view.ts pairRows); in memory only
  context: ContextUse | null;    // main's; null until its first usage
  connectors: Map<string, ConnectorCall>;   // server → main's latest MCP call; in memory only
}

/** hidden: sid → when its floor was hidden (POST /api/floors/<sid>/hide); the sid may be unknown yet. */
export interface State { sessions: Map<string, SessionFacts>; unknownEvents: number; badLines: number; hidden: Map<string, number> }

export type Action =
  | { kind: 'hook'; line: SpoolLine }
  | { kind: 'bind'; sid: string; toolUseId: string; agentId: string }
  | { kind: 'board'; sid: string; foreman: ForemanMode; rows: BoardRow[] }
  | { kind: 'transcript'; sid: string; agentId: string; at: number; model: string | null; tokens: number | null; context: ContextUse | null }
  | { kind: 'tick'; now: number; abandonMs: number }
  | { kind: 'badLine' }
  | { kind: 'drop'; sid: string };

const KNOWN = new Set(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'PermissionRequest']);
const AGENT_TOOLS = new Set(['Agent', 'Task']); // Task: the tool's name before the rename
const ALERTING = new Set(['permission_prompt', 'agent_needs_input', 'idle_prompt']);
// ponytail: an agent inside a tool call (a long build) gets 6x the silence limit; per-tool limits if this misfires
const BUSY_FACTOR = 6;

export function emptyState(): State {
  return { sessions: new Map(), unknownEvents: 0, badLines: 0, hidden: new Map() };
}

/** No IO, no clock: time comes in the actions. */
// ponytail: updates `state` in place; copy-on-write only if something ever needs old states (no history in scope)
export function reduce(state: State, action: Action): State {
  switch (action.kind) {
    case 'hook':
      onHook(state, action.line);
      break;
    case 'bind': {
      const s = state.sessions.get(action.sid);
      if (s) link(s, action.toolUseId, action.agentId);
      break;
    }
    case 'board': {
      const s = state.sessions.get(action.sid);
      if (s) { s.foreman = action.foreman; s.board = action.rows; }
      break;
    }
    case 'transcript': {
      const s = state.sessions.get(action.sid);
      const a = s?.agents.get(action.agentId);
      if (a) { a.transcriptAt = action.at; a.model = action.model ?? a.model; if (action.tokens !== null) a.tokens = action.tokens; }
      if (s && action.agentId === 'main' && action.context) {
        s.context = { used: action.context.used, peak: Math.max(s.context?.peak ?? 0, action.context.peak) };
      }
      break;
    }
    case 'tick':
      onTick(state, action.now, action.abandonMs);
      break;
    case 'badLine':
      state.badLines++;
      break;
    case 'drop':
      state.sessions.delete(action.sid);
      state.hidden.delete(action.sid);
      break;
  }
  return state;
}

function newAgent(id: string, ts: number, over: Partial<AgentFacts> = {}): AgentFacts {
  return {
    id, parentId: null, type: 'main', description: null, toolUseId: null, hook: 'idle', waitReason: null,
    alert: false, activeTools: [], recentTools: [], startedAt: ts, lastEventAt: ts, endedAt: null,
    activeSince: null, breaks: [], transcriptAt: 0, model: null, tokens: 0, ...over,
  };
}

function session(state: State, sid: string, ts: number): SessionFacts {
  let s = state.sessions.get(sid);
  if (!s) {
    s = { sid, cwd: null, transcriptPath: null, firstSeen: ts, ended: false, foreman: 'off', board: [],
      agents: new Map([['main', newAgent('main', ts)]]), bindings: new Map(), stages: new Map(), leave: new Map(), holds: new Map(), pairs: new Map(), context: null, connectors: new Map() };
    state.sessions.set(sid, s);
  }
  return s;
}

/** The agent an event belongs to; events without agent_id are the main session's. Null: no subagent owns the id. */
function actor(s: SessionFacts, event: string, p: HookPayload, ts: number): AgentFacts | null {
  if (!p.agent_id) return s.agents.get('main')!;
  let a = s.agents.get(p.agent_id);
  if (!a) {
    // Claude Code's side forks (next-prompt suggestions and the like) send an agent_id with no SubagentStart, no
    // agent_type and no transcript; their lone PreToolUse never gets a PostToolUse, so they belong to no agent.
    if (event !== 'SubagentStart' && !p.agent_type && ![...s.bindings.values()].includes(p.agent_id)) return null;
    // SubagentStart, or the first event of an agent that never sent one (e.g. a Workflow agent).
    // `||`, not `??`: agent_type can be "" (empty string).
    a = newAgent(p.agent_id, ts, { parentId: 'main', type: p.agent_type || 'unknown', hook: 'running' });
    s.agents.set(a.id, a);
    for (const [t, id] of s.bindings) if (id === a.id) link(s, t, a.id);
  }
  return a;
}

/** tool_use_id ↔ agent_id is known: move the pending Agent call's data onto the agent. */
function link(s: SessionFacts, toolUseId: string, agentId: string) {
  s.bindings.set(toolUseId, agentId);
  const a = s.agents.get(agentId);
  if (!a) return;
  a.toolUseId = toolUseId;
  const p = s.agents.get('pending:' + toolUseId);
  if (!p) return;
  a.parentId = p.parentId;
  a.description = p.description;
  if (a.type === 'unknown') a.type = p.type;
  a.startedAt = Math.min(a.startedAt, p.startedAt);
  s.agents.delete(p.id);
}

/** Main's latest call per MCP server, from `mcp__<server>__<tool>`; `at` never goes back. */
function noteConnector(s: SessionFacts, name: string | undefined, ts: number) {
  const [mcp, server, ...rest] = (name ?? '').split('__'), tool = rest.join('__');
  if (mcp !== 'mcp' || !server || !tool) return;
  const prev = s.connectors.get(server);
  if (!prev || ts >= prev.at) s.connectors.set(server, { server, tool, at: ts });
}

function askedPermission(s: SessionFacts) {
  return [...s.agents.values()].some(a => a.hook === 'waiting' && a.alert && (a.waitReason?.kind === 'permission' || a.waitReason?.kind === 'question'));
}

function setHook(a: AgentFacts, h: HookStage, ts: number) {
  if (h === 'running' && a.hook !== 'running') a.activeSince = ts;
  if (h === 'running' && a.endedAt !== null) a.breaks.push([a.endedAt, ts]);
  a.hook = h;
  if (h !== 'waiting') { a.waitReason = null; a.alert = false; }
  if (h === 'running') a.endedAt = null; // a resume (same agent_id, no SubagentStart) or an abandoned agent's return
}

function onHook(state: State, { ts, event, payload: p }: SpoolLine) {
  if (!KNOWN.has(event)) { state.unknownEvents++; return; }
  const s = session(state, p.session_id, ts);
  s.cwd ??= p.cwd ?? null;
  s.transcriptPath ??= p.transcript_path ?? null;
  if (event === 'SessionStart' || event === 'UserPromptSubmit') s.ended = false; // a resumed session comes back; late subagent events do not re-open it
  // a new or resumed session shows its floor again; a start from before the hide (a late read) does not
  if (event === 'SessionStart' && (state.hidden.get(s.sid) ?? Infinity) < ts) state.hidden.delete(s.sid);
  const me = actor(s, event, p, ts);
  if (!me) return;
  me.lastEventAt = Math.max(me.lastEventAt, ts);
  if (me.hook === 'abandoned') setHook(me, 'running', ts);
  const agentTool = AGENT_TOOLS.has(p.tool_name ?? '');
  switch (event) {
    case 'UserPromptSubmit':
      setHook(me, 'running', ts);
      break;
    case 'PreToolUse':
      setHook(me, 'running', ts);
      me.activeTools.push({ toolUseId: p.tool_use_id ?? '', name: p.tool_name ?? '?', label: p.label ?? null, startedAt: ts });
      if (agentTool && p.tool_use_id) {
        const id = 'pending:' + p.tool_use_id;
        s.agents.set(id, newAgent(id, ts, {
          parentId: me.id, type: p.subagent_type ?? 'general-purpose', description: p.label ?? null,
          toolUseId: p.tool_use_id, hook: 'spawning',
        }));
      }
      if (me.id === 'main') noteConnector(s, p.tool_name, ts);
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const i = me.activeTools.findIndex(t => t.toolUseId === (p.tool_use_id ?? ''));
      if (i >= 0) {
        const [t] = me.activeTools.splice(i, 1);
        me.recentTools = [{ name: t.name, label: t.label, ms: ts - t.startedAt }, ...me.recentTools].slice(0, 5);
      }
      if (me.hook === 'waiting' && me.activeTools.length === 0) setHook(me, 'running', ts);
      if (agentTool && p.tool_use_id && event === 'PostToolUseFailure') s.agents.delete('pending:' + p.tool_use_id);
      else if (agentTool && p.tool_use_id && p.response_agent_id) link(s, p.tool_use_id, p.response_agent_id);
      break;
    }
    case 'PermissionRequest':
      if (me.hook === 'stopped') break;
      me.hook = 'waiting';
      me.alert = true;
      me.waitReason = p.tool_name === 'AskUserQuestion' ? { kind: 'question' } : { kind: 'permission', tool: p.tool_name ?? '?', label: p.label || null };
      break;
    case 'Notification':
      // PermissionRequest already named the asking agent; its agent_id-less Notification twin would blame main
      if (p.notification_type === 'permission_prompt' && !p.agent_id && askedPermission(s)) break;
      if (ALERTING.has(p.notification_type ?? '') && me.hook !== 'stopped') {
        me.hook = 'waiting';
        me.alert = true;
        me.waitReason = { kind: 'notification', text: p.message || p.notification_type! }; // ALERTING: the type is set
      }
      break;
    case 'Stop':
      if (me.id === 'main') { me.activeTools = []; setHook(me, 'idle', ts); }
      break;
    case 'SubagentStart':
      if (p.agent_type) me.type = p.agent_type;
      break;
    case 'SubagentStop':
      if (me.id !== 'main') { me.activeTools = []; setHook(me, 'stopped', ts); me.endedAt = ts; }
      break;
    case 'SessionEnd':
      s.ended = true;
      for (const a of s.agents.values()) {
        a.activeTools = [];
        if (a.id === 'main') setHook(a, 'idle', ts);
        else if (a.hook !== 'stopped') { setHook(a, 'abandoned', ts); a.endedAt = ts; }
      }
      break;
  }
}

/** Silence alone never means done: abandoned needs silence and a transcript that stopped growing. It ends when the
 *  silence passed the limit, not at the tick, so a spool replay that ticks at each line's ts gives the same stop. */
function onTick(state: State, now: number, abandonMs: number) {
  for (const s of state.sessions.values()) {
    for (const a of s.agents.values()) {
      if (a.id === 'main' || (a.hook !== 'running' && a.hook !== 'spawning')) continue;
      const limit = a.activeTools.length ? abandonMs * BUSY_FACTOR : abandonMs, quiet = Math.max(a.lastEventAt, a.transcriptAt);
      if (now - quiet > limit) { setHook(a, 'abandoned', quiet + limit); a.endedAt = quiet + limit; }
    }
  }
}
