// Contract between the server and the browser. Fixed first; the views build on it.

/** One spool line, as hook/fv-hook.sh writes it. */
export interface SpoolLine {
  ts: number;
  event: string;
  payload: HookPayload;
}

export interface HookPayload {
  session_id: string;
  cwd?: string;
  agent_id?: string;
  agent_type?: string;
  tool_name?: string;
  tool_use_id?: string;
  notification_type?: string;
  source?: string;
  reason?: string;
  transcript_path?: string;
  message?: string;
  label?: string;
  subagent_type?: string;
  background?: boolean;
  response_agent_id?: string;
}

export type BoardStage = 'queued' | 'running' | 'waiting' | 'verifying' | 'done' | 'failed';
export type Stage = BoardStage | 'spawning' | 'abandoned' | 'idle';
export type Role = 'main' | 'foreman' | 'agent' | 'placeholder';
/** stale-board: the agent stopped but its board row still says running/queued. off-board: no board row in a foreman session. */
export type Badge = 'stale-board' | 'off-board';
export type ForemanMode = 'on' | 'task' | 'off';

export interface ToolRef { name: string; label: string | null }
export interface ToolCall extends ToolRef { ms: number }

/** Why an agent waits: the browser writes it in its language; notification and note text is shown as it came. */
export type Reason =
  | { kind: 'permission'; tool: string; label: string | null }
  | { kind: 'question' }                     // AskUserQuestion: Claude asks the user, not for a tool's permission
  | { kind: 'notification'; text: string }   // Claude's own message (or its notification_type)
  | { kind: 'note'; text: string };          // the board note, its needs-…: lead included

/** A done agent the board let go leaves this long after; the browser's ✓ counts it down. */
export const BOARD_GRACE_MS = 60_000;
/** A done agent stays in the Done lounge at most this long from its arrival (stageSince), whatever else
 *  holds it; the ✓ counts this one down on its own face. */
export const DONE_STAY_MS = 600_000;

export interface AgentView {
  id: string;              // agent_id, 'main', 'pending:<tool_use_id>' or 'board:<n>'
  key: string;             // stable from spawn to end: the spawning Agent call's tool_use_id, else id (office rooms and desks)
  parentId: string | null;
  role: Role;
  type: string;
  label: string;           // board job, else Agent description, else type
  stage: Stage;
  reasons: Reason[];       // why it waits: hook reason and board note together
  alert: boolean;          // waiting on the user
  badges: Badge[];
  note: string | null;     // board note at any stage
  activeTools: ToolRef[];
  recentTools: ToolCall[]; // newest first, at most 5
  model: string | null;
  tokens: number;          // its context now, as the CLI shows: input + cache read + cache creation + output of its last usage
  startedAt: number;
  endedAt: number | null;
  activeSince: number | null;  // last time it went running again (resumed, back from waiting or abandoned); null: not since startedAt. From the spool, so it survives a restart
  breaks: [number, number][];  // [releasedAt, resumedAt] of each stop it came back from, oldest first: its desk stretches. releasedAt: when the board let its desk go after the stop (verifying, stale-board hold it), at most resumedAt; the stop if the server never saw it
  stageSince: number;     // last change of `stage`; in memory only, first sight = endedAt ?? startedAt
  leaveAt: number | null;  // server time this finished sub-agent leaves the office (the Done lounge, or a ghost's desk); null: it stays
}

/** Context use in tokens: input + cache read + cache creation of main's last assistant
 *  message, and the largest seen in the session. The browser turns it into a percentage. */
export interface ContextUse { used: number; peak: number }

/** Main's latest call per MCP server: the server key, the tool after it, when it started (spool ts). */
export interface ConnectorCall { server: string; tool: string; at: number }

/** One session = one floor of the building. */
export interface SessionView {
  sid: string;
  cwd: string | null;
  project: string;         // last segment of cwd, else the first 8 chars of sid
  firstSeen: number;
  ended: boolean;
  foreman: ForemanMode;
  waitingCount: number;    // agents with alert
  agents: AgentView[];
  context: ContextUse | null;   // main's; null until its first assistant message
  connectors: ConnectorCall[];   // main's MCP calls, one per server, oldest first; [] until the first
  hiddenAt: number | null;  // server time its floor was hidden (POST /api/floors/<sid>/hide); null: shown
}

export interface Snapshot {
  serverTime: number;
  sessions: SessionView[]; // oldest first: the ground floor is the oldest session
  unknownEvents: number;
  badLines: number;
}

export type SseMessage = { type: 'snapshot'; data: Snapshot };

/** One line of the detail pop-up's read-only terminal (GET /api/term): a transcript line, cut short. Markers ([image],
 *  "+N lines", who sent a message) are the browser's to write in its language. */
export interface TermLine {
  kind: 'text' | 'tool' | 'out' | 'err' | 'user' | 'big';   // big: a line too long to read in one go
  text: string;     // text: the assistant's text; tool: its input in short; out/err: the result's first lines; user: the message
  name?: string;    // tool: the tool's name
  more?: number;    // out/err: lines cut after the first ones
  images?: number;  // out/err: image blocks
  from?: string;    // user: 'prompt', else a queued message's origin.kind (coordinator, human, peer, task-notification)
}

/** GET /api/term?session=&agent=&from=: lines after `from` (none: the file's last ~256 KB); `cursor` is the next `from`.
 *  reset: the file shrank, the lines start over. remote: the session's Remote Control link (claude.ai), when it has one. */
export interface TermPage { lines: TermLine[]; cursor: number; reset?: true; remote?: string }
