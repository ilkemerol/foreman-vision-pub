import type { BoardStage, HookPayload } from '../shared/types.ts';

/** A spool line, a "__board" snapshot, an "__end" (the board and mode go), a "__usage" context use or an "__agentOut"
 *  sub-agent's tokens, `at` ms after its floor opens; `backdate` moves its ts into the past. */
export interface ScriptLine { at: number; event: string; payload: Partial<HookPayload> & { text?: string; used?: number; out?: number }; backdate?: number }
export interface ScriptFloor { sid: string; cwd: string; startAt: number; foreman: boolean; lines: ScriptLine[]; metas: Record<string, string> } // agentId → toolUseId

const TOOLS = [['Read', 'src/engine.ts'], ['Bash', 'npm test'], ['Grep', '"SessionView"'], ['Edit', 'src/view.ts'], ['Glob', 'src/**/*.ts']];
const LOOP_MS = 3000;    // a working agent starts a tool this often
const TOOL_MS = 500;     // and finishes it this much later
const LOOP_END = 600_000;
export const CAT_ROUNDS = [0, 210_000, 420_000], CAT_WORK = 120_000;   // F5's rounds start this long after it opens

type Row = { agentId: string; type: string; job: string; stage: BoardStage; note: string };

/** Line builders for one floor; `lines()` returns them in `at` order (stable: same-time lines keep their order). */
function script(jobs: Record<number, [agentId: string, type: string, job: string]> = {}) {
  const out: ScriptLine[] = [];
  const types: Record<string, string> = {};
  const rows = new Map<number, Row>();
  const add = (at: number, event: string, payload: ScriptLine['payload'] = {}) => { out.push({ at, event, payload }); };
  const write = (at: number) => {
    const text = [...rows].sort(([a], [b]) => a - b).map(([n, r]) => `${n}\t${r.agentId}\t${r.type}\t${r.job}\t${r.stage}\t${r.note}\n`).join('');
    add(at, '__board', { text });
  };
  return {
    add,
    open(at: number) { add(at, 'SessionStart', { source: 'startup' }); add(at, 'UserPromptSubmit'); },
    start(id: string, type: string, at: number, backdate?: number, busy = false) {
      types[id] = type;
      out.push({ at, event: 'SubagentStart', payload: { agent_id: id, agent_type: type }, ...(backdate ? { backdate } : {}) });
      // a long tool from its backdated start on, so the spool's replay ticks (engine.ts) do not abandon
      // it in the silence up to now (a busy agent may be quiet 6× longer); it ends at `at` + 1 s
      if (busy && backdate) {
        const p = { agent_id: id, agent_type: type, tool_name: 'Bash', tool_use_id: `${id}-long`, label: 'npm run build' };
        out.push({ at, event: 'PreToolUse', payload: p, backdate }, { at: at + 1000, event: 'PostToolUse', payload: p });
      }
    },
    stop(id: string, at: number) { add(at, 'SubagentStop', { agent_id: id, agent_type: types[id] }); },
    /** The main transcript's context use (input + cache) is now `used` tokens. */
    usage(at: number, used: number) { add(at, '__usage', { used }); },
    /** Sub-agent `id`'s tokens (input + cache + output, as the CLI shows) are now `tokens` (the reducer drops any before its SubagentStart). */
    out(at: number, id: string, tokens: number) { add(at, '__agentOut', { agent_id: id, out: tokens }); },
    /** Main (or `from`) runs MCP tool `mcp__<server>__<tool>` from `at` for `ms`; with `ask` it first asks for permission. */
    mcp(at: number, server: string, tool: string, ms = 900, o: { from?: { agent_id: string; agent_type: string }; ask?: boolean } = {}) {
      const p = { ...o.from, tool_name: `mcp__${server}__${tool}`, tool_use_id: `M-${server}-${at}` };
      add(at, 'PreToolUse', p);
      if (o.ask) add(at, 'PermissionRequest', p);
      add(at + ms, 'PostToolUse', p);
    },
    loop(id: string, from: number, to: number) {
      for (let t = from, i = 0; t < to; t += LOOP_MS, i++) {
        const [tool_name, label] = TOOLS[i % TOOLS.length];
        const p = { agent_id: id, agent_type: types[id], tool_name, tool_use_id: `${id}-${t}`, label };
        add(t, 'PreToolUse', p);
        add(t + TOOL_MS, 'PostToolUse', p);
      }
    },
    /** Sets rows [n, stage, note?, agentId?] (job and type from `jobs`) and writes the whole board. */
    board(at: number, set: [n: number, stage: BoardStage, note?: string, agentId?: string][]) {
      for (const [n, stage, note = '', agentId] of set) {
        const [id, type, job] = jobs[n];
        rows.set(n, { agentId: agentId ?? rows.get(n)?.agentId ?? id, type, job, stage, note });
      }
      write(at);
    },
    /** Deletes rows `ns` (a prune) and writes the board. */
    drop(at: number, ns: number[]) { for (const n of ns) rows.delete(n); write(at); },
    /** Clears the rows; the board and mode files go (foreman-state.sh end). */
    end(at: number) { rows.clear(); add(at, '__end'); },
    lines: () => out.sort((a, b) => a.at - b.at),
  };
}

/** The office tour: floors added over time, a 10+ minute agent, fail, permission and needs-info waits, done, the double-card and
 *  stale-board windows; F5 for the cat's desks and a floor with nobody working. */
export function pixelScenario(): ScriptFloor[] {
  const jobs: Record<number, [string, string, string]> = {
    1: ['a-engine', 'Explore', 'engine summary'], 2: ['a-hot', 'general-purpose', 'test runner'],
    3: ['a-hook', 'general-purpose', 'hook test'], 4: ['a-config', 'Explore', 'config scanner'],
    5: ['a-lint', 'Explore', 'lint'], 6: ['a-type', 'general-purpose', 'type check'],
    7: ['a-audit', 'general-purpose', 'spec reader'], 8: ['-', 'general-purpose', 'new job'], 9: ['-', 'general-purpose', 'decision'],
    10: ['a-docs', 'general-purpose', 'docs scanner'],
  };
  const a = script(jobs);
  a.open(0);
  const first = [1, 2, 3, 4, 5, 6, 7];
  // a-hot started 12 min ago; a-audit 1 s before the rest, so it takes the Library's second desk whatever order the
  // same-time starts land in (the browser breaks the tie by ms, not by id) and fails there
  for (const n of first) a.start(jobs[n][0], jobs[n][1], 0, n === 2 ? 720_000 : n === 7 ? 1000 : undefined);
  a.board(0, first.map(n => [n, 'running']));
  for (const id of ['a-engine', 'a-hot', 'a-config']) a.loop(id, 0, LOOP_END);
  // tokens for the office coins, each after its agent's start: a-engine fills a column and
  // starts the second, a-hot passes 150K (the sack), a-config jumps four coins at once and grows while it waits, a-hook
  // keeps its pile through its wait; the stop, fail and done ones below take theirs away
  for (let k = 1; k <= 6; k++) a.out(2000 + 10_000 * (k - 1), 'a-engine', 10_000 * k);
  a.out(1000, 'a-hot', 140_000);
  a.out(20_000, 'a-hot', 155_000);
  a.out(1000, 'a-config', 20_000);
  a.out(6000, 'a-config', 60_000);
  a.out(20_000, 'a-config', 70_000);
  a.out(1000, 'a-hook', 30_000);
  a.out(45_000, 'a-hook', 40_000);
  a.out(1000, 'a-lint', 30_000);
  a.out(1000, 'a-type', 90_000);
  a.out(1000, 'a-audit', 40_000);
  // a-hook asks for permission and gets no tools while it waits
  const bash = { agent_id: 'a-hook', agent_type: 'general-purpose', tool_name: 'Bash', tool_use_id: 'h1', label: 'node -e "console.log(1)"' };
  a.loop('a-hook', 0, 8000);
  a.add(8000, 'PreToolUse', bash);
  a.add(8000, 'PermissionRequest', bash);
  a.add(40_000, 'PostToolUse', bash);
  a.loop('a-hook', 41_000, LOOP_END);
  a.board(12_000, [[4, 'waiting', 'needs-info: which config file?'], [9, 'waiting', 'needs-decision: which approach?']]);
  // the stale-board window: a-type stops, the board says verifying 3 s later; a-docs starts inside it (off-board until
  // then, and no match for the waiting "-" row of its type)
  a.loop('a-type', 0, 10_000);
  a.stop('a-type', 10_000);
  a.start('a-docs', 'general-purpose', 11_000);
  a.loop('a-docs', 11_000, LOOP_END);
  a.board(13_000, [[6, 'verifying'], [10, 'running']]);
  a.loop('a-lint', 0, 15_000);
  a.out(15_000, 'a-lint', 52_000);
  a.stop('a-lint', 15_000);
  a.board(15_000, [[5, 'done']]);
  a.loop('a-audit', 0, 25_000);
  a.stop('a-audit', 25_000);
  a.board(25_000, [[7, 'failed', 'test broken']]);
  a.board(30_000, [[6, 'done']]);
  // spawn before the board catches up: the "-" row and the new agent must stay one card
  a.board(45_000, [[8, 'queued']]);
  a.add(50_000, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T8', subagent_type: 'general-purpose', label: 'new job' });
  a.start('a-new', 'general-purpose', 51_000);
  a.loop('a-new', 51_000, LOOP_END);
  a.out(52_000, 'a-new', 10_000);
  a.board(61_000, [[8, 'running', '', 'a-new']]);
  // context: a calm step, past 60 and 85 %, a compact drop, a calm step, past 85 % again
  for (const [at, used] of [[5_000, 40_000], [25_000, 50_000], [45_000, 130_000], [75_000, 175_000], [105_000, 30_000],
    [135_000, 42_000], [240_000, 170_000]]) a.usage(at, used);
  // couriers: one Teams; Teams and Gmail together; a Gmail that arrives while the foreman is at the
  // box (the 75 s context step); three Gmail calls in a row; an Outlook send that asks first; a sub-agent's Gmail (no
  // courier); Drive then Calendar (one Google visit, two letters); Notion (no courier)
  const M365 = 'claude_ai_Microsoft_365', GMAIL = 'claude_ai_Gmail';
  a.mcp(16_000, M365, 'teams_list_chats');
  a.mcp(50_000, M365, 'outlook_email_search');
  a.mcp(50_000, GMAIL, 'search_threads');
  a.mcp(71_500, GMAIL, 'get_thread');
  a.mcp(100_000, GMAIL, 'search_threads');
  a.mcp(106_000, GMAIL, 'get_thread');
  a.mcp(109_000, GMAIL, 'get_thread', 900);
  a.mcp(125_000, M365, 'outlook_send_mail', 15_000, { ask: true });
  // the script's Agent call for a-new (50 s) never returns, so a PostToolUse leaves main waiting; its next tool ends the wait
  const read = { tool_name: 'Read', tool_use_id: 'R-141', label: 'notes.md' };
  a.add(141_000, 'PreToolUse', read);
  a.add(141_500, 'PostToolUse', read);
  a.mcp(150_000, GMAIL, 'search_threads', 900, { from: { agent_id: 'a-engine', agent_type: 'Explore' } });
  a.mcp(160_000, 'claude_ai_Google_Drive', 'search_files');
  a.mcp(162_000, 'claude_ai_Google_Calendar', 'list_events');
  a.mcp(170_000, 'claude_ai_Notion', 'notion-search');

  const b = script();
  b.open(0);
  b.add(0, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'B1', subagent_type: 'Explore', label: 'scan notes' });
  b.start('b-explore', 'Explore', 1000);
  b.loop('b-explore', 1000, LOOP_END);
  // the context changes while main waits at its desk; the foreman goes once the wait ends
  b.usage(3000, 24_000);
  b.add(30_000, 'Stop');
  b.add(31_000, 'Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
  b.usage(36_000, 130_000);
  b.add(60_000, 'UserPromptSubmit');
  b.mcp(70_000, 'claude_ai_Gmail', 'search_threads');
  b.mcp(80_000, 'claude_ai_Microsoft_365', 'teams_list_chats');
  // no board: seven agents done one after another, only the newest five stay
  for (let k = 1; k <= 7; k++) {
    b.start(`b-${k}`, 'Explore', 2000);
    b.loop(`b-${k}`, 2000, 35_000 + 5000 * k);
    b.stop(`b-${k}`, 35_000 + 5000 * k);
  }

  const c = script();
  c.open(0);
  c.board(0, []);
  // a peak past 200k takes the 1M window, so the drop to 40k reads 4 %, not 20 %
  c.usage(8000, 250_000);
  c.usage(40_000, 40_000);

  // done cleanup, in order: a parallel launch bound late, six done and a row-less helper, a prune, the board's end
  // and a new task, and a lone ghost
  const djobs: Record<number, [string, string, string]> = {
    1: ['-', 'Explore', 'parallel A'], 2: ['-', 'Explore', 'parallel B'], 12: ['-', 'Explore', 'new task'],
  };
  for (let k = 1; k <= 9; k++) djobs[k + 2] = [`d-${k}`, 'general-purpose', `part ${k}`];
  const d = script(djobs);
  const job = (id: string, type: string, from: number, to: number) => { d.start(id, type, from); d.loop(id, from, to); d.stop(id, to); };
  d.open(0);
  d.board(0, [[1, 'running'], [2, 'running']]);
  job('d-pa', 'Explore', 1000, 10_000);
  job('d-pb', 'Explore', 1000, 80_000);
  d.board(82_000, [[1, 'done', '', 'd-pa'], [2, 'done', '', 'd-pb']]);
  d.board(85_000, [3, 4, 5, 6, 7, 8].map(n => [n, 'running']));
  for (let k = 1; k <= 6; k++) {
    job(`d-${k}`, 'general-purpose', 85_000, 87_000 + 3000 * k);
    d.board(87_000 + 3000 * k, [[k + 2, 'done']]);
  }
  job('d-help', 'Explore', 85_000, 108_000);
  d.drop(170_000, [1, 2, 3, 4, 5]);
  d.board(200_000, [9, 10, 11].map(n => [n, 'running']));
  for (let k = 7; k <= 9; k++) {
    job(`d-${k}`, 'general-purpose', 200_000, 200_000 + 5000 * k);
    d.board(200_000 + 5000 * k, [[k + 2, 'done']]);
  }
  d.end(260_000);
  d.board(300_000, [[12, 'running']]);
  d.start('d-10', 'Explore', 305_000);
  d.loop('d-10', 305_000, LOOP_END);
  d.board(310_000, [[12, 'running', '', 'd-10']]);
  d.start('d-ghost', 'general-purpose', 312_000);
  d.loop('d-ghost', 312_000, 315_000);
  d.out(313_000, 'd-ghost', 30_000);

  // Smooth the cat: main idle from the start, three rounds of three agents that work 120 s (her desks)
  // and stop together (she hops down if she sits on one), then 90 s with no working agent (rest spots only)
  const e = script();
  e.open(0);
  e.add(500, 'Stop');
  for (const [r, at] of CAT_ROUNDS.entries()) for (let k = 1; k <= 3; k++) {
    const id = `e-${r * 3 + k}`, type = k === 2 ? 'Explore' : 'general-purpose';
    e.start(id, type, at + 1000);
    e.loop(id, at + 1000, at + CAT_WORK);
    e.stop(id, at + CAT_WORK);
  }

  return [
    { sid: 'sim-pixel-a', cwd: '/w/foreman-vision', startAt: 0, foreman: true, lines: a.lines(), metas: { 'a-new': 'T8' } },
    { sid: 'sim-pixel-b', cwd: '/w/notes', startAt: 20_000, foreman: false, lines: b.lines(), metas: { 'b-explore': 'B1' } },
    { sid: 'sim-pixel-c', cwd: '/w/foreman-vision', startAt: 60_000, foreman: true, lines: c.lines(), metas: {} },
    { sid: 'sim-pixel-d', cwd: '/w/cleanup', startAt: 90_000, foreman: true, lines: d.lines(), metas: {} },
    { sid: 'sim-pixel-e', cwd: '/w/cat', startAt: 95_000, foreman: false, lines: e.lines(), metas: {} },
  ];
}

export const DONE_N = 12, DONE_END = 6000 + 1500 * (DONE_N - 1);   // the last one is done 22.5 s in

/** Visual check of a full Done lounge: one foreman floor, twelve sub-agents at work from the start, done one every 1.5 s from
 *  6 s on (each row stays on the board, so all stay in the Done lounge); every second one earned tokens, so payday shows. */
export function doneScenario(): ScriptFloor[] {
  const jobs: Record<number, [string, string, string]> = {};
  for (let n = 1; n <= DONE_N; n++) jobs[n] = [`dn-${n}`, n % 3 ? 'general-purpose' : 'Explore', `part ${n}`];
  const a = script(jobs);
  a.open(0);
  for (let n = 1; n <= DONE_N; n++) a.start(jobs[n][0], jobs[n][1], 0);
  a.board(0, Object.keys(jobs).map(n => [+n, 'running']));
  for (let n = 1; n <= DONE_N; n++) {
    const id = jobs[n][0], end = 6000 + 1500 * (n - 1);
    if (n % 2) a.out(1000, id, 10_000 * n);
    a.loop(id, 0, end);
    a.stop(id, end);
    a.board(end, [[n, 'done']]);
  }
  return [{ sid: 'sim-done', cwd: '/w/foreman-vision', startAt: 0, foreman: true, lines: a.lines(), metas: {} }];
}

/** `from` (main when null) calls Agent at `at`; agent `id` starts 300 ms later and the call returns bound to it. */
function spawn(s: ReturnType<typeof script>, from: { agent_id: string; agent_type: string } | null, id: string, type: string, label: string, at: number) {
  const call = { ...from, tool_name: 'Agent', tool_use_id: 'T-' + id, subagent_type: type, label };
  s.add(at, 'PreToolUse', call);
  s.start(id, type, at + 300);
  s.add(at + 400, 'PostToolUse', { ...call, response_agent_id: id });
}

/** Crowded floors: a 22-agent foreman floor (9 children of sub-agents) whose stages move between 20 and 70 s, a
 *  3-agent floor and a long session of 30 agents, 26 of them done. */
export function hybridScenario(): ScriptFloor[] {
  // [job, stage at 2 s, parent row (0: main)]; rows 11 and 22 are "-" placeholders
  const ROWS: [job: string, stage: BoardStage, parent: number][] = [
    ['test runner', 'running', 0], ['engine summary', 'running', 0], ['hook test', 'running', 0], ['file scanner', 'running', 1],
    ['decision', 'waiting', 0], ['config scanner', 'waiting', 2], ['schema audit', 'verifying', 0], ['readme', 'done', 0],
    ['lint fix', 'done', 3], ['e2e run', 'failed', 0], ['new job', 'queued', 0], ['api scan', 'running', 1],
    ['type check', 'running', 0], ['css audit', 'running', 2], ['log analysis', 'running', 0], ['migration', 'running', 3],
    ['write docs', 'waiting', 13], ['dependencies', 'verifying', 1], ['perf measure', 'verifying', 0], ['i18n keys', 'done', 0],
    ['cleanup', 'done', 2], ['new job 2', 'queued', 0],
  ];
  const NOTES: Record<number, string> = { 5: 'needs-decision: which approach?', 6: 'needs-info: which profile?', 10: 'test broken', 17: 'needs-info: which language?' };
  const typeOf = (n: number) => n % 3 === 2 ? 'Explore' : 'general-purpose';
  const jobs: Record<number, [string, string, string]> = {};
  ROWS.forEach(([job, stage], i) => { jobs[i + 1] = [stage === 'queued' ? '-' : `h${i + 1}`, typeOf(i + 1), job]; });

  const a = script(jobs);
  a.open(0);
  const LOOP_TO: Record<string, number> = { h1: 40_000, h4: 70_000, h3: 60_000 };
  ROWS.forEach(([job, stage, parent], i) => {
    const n = i + 1, id = `h${n}`;
    if (stage === 'queued') return;
    const at = parent ? 1000 : 0;
    spawn(a, parent ? { agent_id: `h${parent}`, agent_type: typeOf(parent) } : null, id, typeOf(n), job, at);
    if (stage === 'verifying' || stage === 'done' || stage === 'failed') a.stop(id, 2500);
    else a.loop(id, at + 300, LOOP_TO[id] ?? LOOP_END);
  });
  a.loop('h3', 81_000, LOOP_END);
  a.board(2000, ROWS.map(([, stage], i) => [i + 1, stage, NOTES[i + 1]]));
  // the six moves; h11 takes row 11's type, so its pending call pairs with row 11, not with row 22
  spawn(a, null, 'h11', typeOf(11), 'new job', 20_000);
  a.loop('h11', 20_300, LOOP_END);
  a.board(21_000, [[11, 'running', '', 'h11']]);
  a.board(30_000, [[5, 'running']]);
  a.stop('h1', 40_000);
  a.board(40_000, [[1, 'verifying']]);
  a.board(50_000, [[7, 'done']]);
  const bash = { agent_id: 'h3', agent_type: 'general-purpose', tool_name: 'Bash', tool_use_id: 'P3', label: 'git push' };
  a.add(60_000, 'PreToolUse', bash);
  a.add(60_000, 'PermissionRequest', bash);
  a.add(80_000, 'PostToolUse', bash);
  a.stop('h4', 70_000);
  a.board(70_000, [[4, 'failed', 'timed out']]);

  const b = script();
  spawn(b, null, 'b1', 'Explore', 'scan notes', 0);
  spawn(b, null, 'b2', 'general-purpose', 'write summary', 500);
  b.loop('b1', 300, LOOP_END);
  b.loop('b2', 800, LOOP_END);

  const c = script();
  for (let i = 0; i < 30; i++) {
    spawn(c, null, `c${i}`, 'general-purpose', `job ${i + 1}`, i * 300);
    if (i < 26) c.stop(`c${i}`, i * 300 + 2000);
    else c.loop(`c${i}`, i * 300 + 300, LOOP_END);
  }

  return [
    { sid: 'sim-hybrid-a', cwd: '/w/foreman-vision', startAt: 0, foreman: true, lines: a.lines(), metas: {} },
    { sid: 'sim-hybrid-b', cwd: '/w/notes', startAt: 2000, foreman: false, lines: b.lines(), metas: {} },
    { sid: 'sim-hybrid-c', cwd: '/w/long-session', startAt: 4000, foreman: false, lines: c.lines(), metas: {} },
  ];
}

export const FIRE_AT = 20_000, FIRE_B_AT = 40_000, FIRE_BREAK = 120_000, FIRE_REFORM = 150_000, FIRE_END = 600_000;
/** The server-room fire: F1 (foreman) has seven sub-agents from the start, backdated so the fifth passes 30 minutes at
 *  FIRE_AT (the sixth is at 18); the first stops at FIRE_BREAK (the condition breaks) and the seventh passes 30 at
 *  FIRE_REFORM (it forms again within 2 h: no second fire). F2 forms it at FIRE_B_AT, unseen while F1 is on screen. */
export function fireScenario(): ScriptFloor[] {
  const M = 60_000, at30 = (t: number) => 30 * M - t;   // a backdate that passes 30:00 t ms after the open
  const floor = (sid: string, cwd: string, backs: number[], stop = FIRE_END): ScriptFloor => {
    const jobs: Record<number, [string, string, string]> = {};
    backs.forEach((_, i) => { jobs[i + 1] = [`${sid}-${i + 1}`, 'general-purpose', `part ${i + 1}`]; });
    const s = script(jobs);
    s.open(0);
    backs.forEach((b, i) => s.start(jobs[i + 1][0], 'general-purpose', 0, b, true));
    s.board(0, backs.map((_, i) => [i + 1, 'running']));
    backs.forEach((_, i) => {
      const id = jobs[i + 1][0], end = i === 0 ? stop : FIRE_END;
      s.loop(id, 0, end);
      if (end < FIRE_END) { s.stop(id, end); s.board(end, [[i + 1, 'done']]); }
    });
    return { sid, cwd, startAt: 0, foreman: true, lines: s.lines(), metas: {} };
  };
  return [
    floor('sim-fire', '/w/foreman-vision', [44 * M, 39 * M, 35 * M, 32 * M, at30(FIRE_AT), 18 * M, at30(FIRE_REFORM)], FIRE_BREAK),
    floor('sim-fire-b', '/w/notes', [41 * M, 37 * M, 33 * M, 31 * M, at30(FIRE_B_AT)]),
  ];
}
