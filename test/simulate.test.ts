import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sseReader, tempDir } from './helpers.ts';
import { DONE_STAY_MS, type Snapshot } from '../shared/types.ts';
import { parseBoard } from '../src/board.ts';
import { emptyState, reduce } from '../src/reducer.ts';
import { askScenario, DONE_END, DONE_N, doneScenario, CAT_ROUNDS, CAT_WORK, FIRE_AT, FIRE_B_AT, FIRE_BREAK, FIRE_REFORM, fireScenario, pixelScenario, type ScriptFloor } from '../src/scenario.ts';
import type { Config } from '../src/config.ts';
import { serve } from '../src/server.ts';
import { askLine, place, sandbox, simulate } from '../src/simulate.ts';
import { termLines } from '../src/term.ts';
import { scanTranscript } from '../src/transcript.ts';
import { toSnapshot } from '../src/view.ts';
import { hotCount } from '../web/src/logic/fire.ts';
import { officeLayout, type Fit } from '../web/src/logic/layout.ts';
import { assignDesks, deskDemand, deskMemory, officeScene } from '../web/src/logic/scene.ts';

const fit = (w: number, h: number, o: Partial<Fit> = {}): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0, ...o });

test('simulate: an unknown scenario name, an Object.prototype key too, is rejected before anything starts', async () => {
  for (const name of ['nope', 'constructor', 'toString'])
    await assert.rejects(simulate({} as Config, ['--scenario', name]), /unknown scenario/);
});

test('simulate: a non-numeric --speed or --copies is a clear error before anything starts, not NaN', async () => {
  for (const [key, v] of [['speed', 'abc'], ['speed', '0'], ['copies', 'abc'], ['copies', '1.5']])
    await assert.rejects(simulate({} as Config, ['--scenario', 'nope', `--${key}`, v]), { message: `invalid --${key}: "${v}"` });
});

test('place: spool lines get the sandbox session, board snapshots become files', () => {
  const root = tempDir('fv-sim-');
  sandbox(root, 'sim0-x', join(root, 'none.jsonl'));
  place(root, 'sim0-x', { ts: 1, event: 'SessionStart', payload: { session_id: 'orig', cwd: '/w' } }, 42);
  place(root, 'sim0-x', { ts: 2, event: '__board', payload: { session_id: 'orig', text: '1\t-\tx\tj\tqueued\t\n' } }, 43);
  const [line] = readFileSync(join(root, 'spool', 'sim0-x.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual([line.ts, line.payload.session_id, line.payload.transcript_path, line.payload.cwd],
    [42, 'sim0-x', join(root, 'projects', 'sim0-x.jsonl'), '/w']);
  assert.equal(readFileSync(join(root, 'state', 'board-sim0-x'), 'utf8'), '1\t-\tx\tj\tqueued\t\n');
  assert.equal(readFileSync(join(root, 'state', 'active-sim0-x'), 'utf8'), 'on');
});

test('place: a "__usage" line appends an assistant message carrying that context to the main transcript', () => {
  const root = tempDir('fv-sim-');
  sandbox(root, 'sim0-x');
  place(root, 'sim0-x', { ts: 1, event: '__usage', payload: { session_id: 'orig', used: 130_000 } }, 42);
  const lines = readFileSync(join(root, 'projects', 'sim0-x.jsonl'), 'utf8').trim().split('\n');
  assert.deepEqual(scanTranscript(lines).context, { used: 130_000, peak: 130_000 });
  assert.equal(existsSync(join(root, 'spool', 'sim0-x.jsonl')), false);
});

test('place: an "__agentOut" line appends an assistant message whose usage totals that many tokens to the sub-agent\'s transcript', () => {
  const root = tempDir('fv-sim-');
  sandbox(root, 'sim0-x');
  for (const out of [12_000, 30_000]) place(root, 'sim0-x', { ts: 42, event: '__agentOut', payload: { session_id: 'orig', agent_id: 'a1', out } }, 42);
  const lines = readFileSync(join(root, 'projects', 'sim0-x', 'subagents', 'agent-a1.jsonl'), 'utf8').trim().split('\n');
  assert.deepEqual(scanTranscript(lines), { model: 'claude-opus-5-5', tokens: 30_000, context: { used: 29_960, peak: 29_960 } });   // the latest wins
  assert.equal(existsSync(join(root, 'spool', 'sim0-x.jsonl')), false);
});

test('place: an "__end" line deletes the board and the mode, as foreman-state.sh end does', () => {
  const root = tempDir('fv-sim-');
  sandbox(root, 'sim0-x');
  place(root, 'sim0-x', { ts: 1, event: '__board', payload: { session_id: 'orig', text: '1\t-\tx\tj\tqueued\t\n' } }, 42);
  place(root, 'sim0-x', { ts: 2, event: '__end', payload: { session_id: 'orig' } }, 43);
  assert.deepEqual(['board-sim0-x', 'active-sim0-x'].map(f => existsSync(join(root, 'state', f))), [false, false]);
  assert.equal(existsSync(join(root, 'spool', 'sim0-x.jsonl')), false);
});

test('place: tool hooks also write the call and its result to that agent\'s transcript, for the pop-up terminal', () => {
  const root = tempDir('fv-sim-');
  sandbox(root, 'sim0-x');
  const p = { session_id: 'orig', agent_id: 'a1', tool_name: 'Bash', tool_use_id: 't1', label: 'npm test' };
  place(root, 'sim0-x', { ts: 1, event: 'PreToolUse', payload: p }, 42);
  place(root, 'sim0-x', { ts: 2, event: 'PostToolUseFailure', payload: p }, 43);
  place(root, 'sim0-x', { ts: 3, event: 'PreToolUse', payload: { ...p, agent_id: undefined, tool_name: 'Read', label: 'a.md' } }, 44);
  place(root, 'sim0-x', { ts: 4, event: 'PostToolUse', payload: { ...p, agent_id: undefined, tool_name: 'Read', label: 'a.md' } }, 45);
  const lines = (f: string) => termLines(readFileSync(join(root, 'projects', f), 'utf8').trim().split('\n'));
  assert.deepEqual(lines('sim0-x/subagents/agent-a1.jsonl'), [
    { kind: 'text', text: 'Next: Bash npm test' }, { kind: 'tool', name: 'Bash', id: 't1', text: 'npm test' },
    { kind: 'err', id: 't1', text: 'Exit code 1\n✖ test 3 failed\nℹ fail 1' }]);
  assert.deepEqual(lines('sim0-x.jsonl').map(l => l.kind), ['text', 'tool', 'out']);
  assert.equal(lines('sim0-x.jsonl')[2].text.split('\n').length, 140);
});

/** Reduce the scenario the way the engine would see it, without a server: one state, a snapshot at each of `times`
 *  (ascending), so stageSince keeps its memory between them. With `abandonMs`, a tick comes before each snapshot. */
function run(times: number[], abandonMs?: number, floors = pixelScenario()): Snapshot[] {
  const st = emptyState();
  const lines = floors.flatMap(f => f.lines.map(l => ({ f, l, abs: f.startAt + l.at }))).sort((a, b) => a.abs - b.abs);
  let k = 0;
  return times.map(t => {
    for (; k < lines.length && lines[k].abs <= t; k++) {
      const { f, l, abs } = lines[k];
      if (l.event === '__board') reduce(st, { kind: 'board', sid: f.sid, foreman: 'on', rows: parseBoard(l.payload.text ?? '') });
      else if (l.event === '__end') reduce(st, { kind: 'board', sid: f.sid, foreman: 'off', rows: [] });
      else if (l.event === '__usage') reduce(st, { kind: 'transcript', sid: f.sid, agentId: 'main', at: abs, model: null, tokens: null, context: { used: l.payload.used!, peak: l.payload.used! } });
      else if (l.event === '__agentOut') reduce(st, { kind: 'transcript', sid: f.sid, agentId: l.payload.agent_id!, at: abs, model: null, tokens: l.payload.out!, context: null });
      else reduce(st, { kind: 'hook', line: { ts: abs - (l.backdate ?? 0), event: l.event, payload: { ...l.payload, session_id: f.sid, cwd: f.cwd } } });
      for (const [agentId, toolUseId] of Object.entries(f.metas)) if (l.payload.agent_id === agentId) reduce(st, { kind: 'bind', sid: f.sid, toolUseId, agentId });
    }
    if (abandonMs !== undefined) reduce(st, { kind: 'tick', now: t, abandonMs });
    return toSnapshot(st, t);
  });
}
const stateAt = (t: number) => run([t])[0];
const byLabel = (snap: Snapshot, label: string) => snap.sessions.flatMap(s => s.agents).filter(a => a.label === label);

test('pixelScenario: waits, overwork and the double-card window', () => {
  let s = stateAt(14_000);
  assert.equal(s.sessions.length, 1);
  assert.deepEqual([byLabel(s, 'hook test')[0].stage, byLabel(s, 'hook test')[0].alert], ['waiting', true]);
  assert.deepEqual(byLabel(s, 'hook test')[0].reasons[0], { kind: 'permission', tool: 'Bash', label: 'node -e "console.log(1)"' });
  assert.deepEqual([byLabel(s, 'config scanner')[0].stage, byLabel(s, 'config scanner')[0].alert], ['waiting', false]);
  assert.equal(byLabel(s, 'decision')[0].alert, true);
  const hot = byLabel(s, 'test runner')[0];
  assert.ok(14_000 - hot.startedAt >= 10 * 60_000 && hot.stage === 'running');
  s = stateAt(35_000);
  assert.equal(s.sessions.length, 2);
  assert.deepEqual(['lint', 'type check', 'spec reader'].map(l => byLabel(s, l)[0].stage), ['done', 'done', 'failed']);
  s = stateAt(55_000);
  assert.equal(byLabel(s, 'new job').length, 1);
  assert.deepEqual([byLabel(s, 'new job')[0].role, byLabel(s, 'new job')[0].badges], ['agent', []]);
  s = stateAt(65_000);
  assert.equal(s.sessions.length, 3);
  assert.equal(byLabel(s, 'new job')[0].id, 'a-new');
});

test('pixelScenario: the stale-board window shifts no desk and keeps the stopped agent seated', () => {
  const times = Array.from({ length: 141 }, (_, i) => i * 500), desks = new Map<string, number>(), mem = deskMemory();   // the page's view
  run(times).forEach((s, k) => {
    const t = times[k], agents = s.sessions[0].agents, l = officeLayout(fit(1146, 613, { demand: deskDemand(agents) })), { places } = officeScene(agents, t, l, [], mem);
    for (const [id, d] of assignDesks(agents, l, { mem, now: t })) { assert.equal(d, desks.get(id) ?? d, `${id} changes desk at ${t}`); desks.set(id, d); }
    const tip = places.get('a-type'), docs = agents.find(a => a.id === 'a-docs');
    if (t >= 10_000 && t < 13_000) assert.deepEqual([tip?.kind, tip?.pose, tip?.desk], ['desk', 'read', desks.get('a-type')], `a-type at ${t}`);
    if (t >= 12_000 && t < 13_000) {   // the waiting "-" row of its type is not a-docs
      assert.deepEqual([docs?.stage, docs?.badges], ['running', ['off-board']]);
      assert.equal(byLabel(s, 'decision')[0].role, 'placeholder');
    }
  });
  assert.notEqual(desks.get('a-docs'), desks.get('a-type'));
});

test('pixelScenario: context rises past 60 and 85 %, drops after a compact, changes while main waits, passes 200k', () => {
  const ctx = (s: Snapshot, sid: string) => s.sessions.find(x => x.sid === sid)?.context ?? null;
  const main = (s: Snapshot, sid: string) => s.sessions.find(x => x.sid === sid)!.agents.find(a => a.id === 'main')!;
  const [s4, s46, s57, s69, s81, s101, s106] = run([4_000, 46_000, 57_000, 69_000, 81_000, 101_000, 106_000]);
  assert.equal(ctx(s4, 'sim-pixel-a'), null);
  assert.deepEqual(ctx(s46, 'sim-pixel-a'), { used: 130_000, peak: 130_000 });
  assert.deepEqual([ctx(s57, 'sim-pixel-b'), main(s57, 'sim-pixel-b').stage, main(s57, 'sim-pixel-b').role], [{ used: 130_000, peak: 130_000 }, 'waiting', 'main']);
  assert.deepEqual(ctx(s69, 'sim-pixel-c'), { used: 250_000, peak: 250_000 });
  assert.equal(main(s81, 'sim-pixel-b').stage, 'running');
  assert.deepEqual(ctx(s101, 'sim-pixel-c'), { used: 40_000, peak: 250_000 });
  assert.deepEqual(ctx(s106, 'sim-pixel-a'), { used: 30_000, peak: 175_000 });
});

test('pixelScenario: sub-agents earn tokens for the office coins', () => {
  // by id: a label can also name a pending card or a board row
  const tok = (s: Snapshot, id: string) => { const a = s.sessions.flatMap(x => x.agents).find(a => a.id === id)!; return [a.stage, a.tokens]; };
  const [s7, s16, s21, s26, s31, s46, s53] = run([7_000, 16_000, 21_000, 26_000, 31_000, 46_000, 53_000]);
  assert.deepEqual(tok(s7, 'a-config'), ['running', 60_000]);
  assert.deepEqual(tok(s21, 'a-config'), ['waiting', 70_000]);
  assert.deepEqual(tok(s21, 'a-hot'), ['running', 155_000]);
  assert.deepEqual(tok(s16, 'a-lint'), ['done', 52_000]);
  assert.deepEqual(tok(s26, 'a-audit'), ['failed', 40_000]);
  assert.deepEqual(tok(s31, 'a-type'), ['done', 90_000]);
  assert.deepEqual(tok(s46, 'a-hook'), ['running', 40_000]);
  assert.deepEqual([tok(s53, 'a-engine'), tok(s53, 'a-new')[1]], [['running', 60_000], 10_000]);
  assert.equal(tok(run([404_000])[0], 'd-ghost')[1], 30_000);   // F4 opens at 90 s
});

test('pixelScenario: eight-plus sub-agents, three waiting, two done, and the failure is in a work room other than the main office', () => {
  const s14 = stateAt(14_000).sessions[0].agents;
  assert.ok(s14.filter(a => a.role === 'agent').length >= 8);
  assert.equal(s14.filter(a => a.role !== 'foreman' && a.role !== 'main' && a.stage === 'waiting').length, 3);
  assert.ok(stateAt(31_000).sessions[0].agents.filter(a => a.stage === 'done').length >= 2);
  const agents = stateAt(26_000).sessions[0].agents, at = (id: string) => agents.find(a => a.id === id)!.startedAt;
  // the browser breaks equal start times by the ms the lines land, not by id: a-audit must start strictly before the
  // other Library agents that would take its desk (a-hot holds the first)
  for (const id of ['a-hook', 'a-lint']) assert.ok(at('a-audit') < at(id), `a-audit starts before ${id}`);
  // the OfficeFloor box at 1366×657 and 1920×1080, with this task's −32/−24 padding and without it
  for (const [w, h] of [[1114, 589], [1146, 613], [1668, 1012], [1700, 1036]]) {
    const l = officeLayout(fit(w, h, { demand: deskDemand(agents) })), p = officeScene(agents, 26_000, l).places.get('a-audit')!;
    assert.deepEqual([p.kind, l.desks[p.desk!].room], ['fail', 'library']);
  }
});

const CLEAN = Array.from({ length: 110 }, (_, i) => i * 5000);   // 0 … 545 s
test('pixelScenario: F4 and F2 leave the office on schedule', () => {
  const snaps = run(CLEAN, 60_000), find = (t: number, id: string) => snaps[t / 5000].sessions.flatMap(s => s.agents).find(a => a.id === id);
  // 'stay': only its ten minutes in the Done lounge count
  const leave = (t: number, id: string) => { const a = find(t, id); return a && a.leaveAt === a.stageSince + DONE_STAY_MS ? 'stay' : a?.leaveAt; };
  for (let t = 100_000; t < 260_000; t += 5000) assert.ok([null, 'stay'].includes(leave(t, 'd-pa') as string | null), `d-pa at ${t}`);   // at work, then done in the Done lounge
  assert.equal(leave(200_000, 'd-help'), 260_000);
  for (const id of ['d-pa', 'd-pb', 'd-1', 'd-2', 'd-3']) assert.equal(leave(260_000, id), 320_000, id);
  assert.deepEqual(['d-4', 'd-5', 'd-9'].map(id => leave(350_000, id)), [350_000, 'stay', 'stay']);
  assert.deepEqual(['d-5', 'd-9'].map(id => leave(390_000, id)), ['stay', 'stay']);   // the new task's "-" row holds them
  // d-10 starts at 395 s and pairs with that row: it holds no clock any more, before its bind at 400 s
  assert.deepEqual(['d-4', 'd-5', 'd-9'].map(id => leave(400_000, id)), [350_000, 455_000, 455_000]);
  assert.deepEqual([leave(460_000, 'd-ghost'), leave(465_000, 'd-ghost')], [null, 525_000]);
  assert.deepEqual(['b-1', 'b-2'].map(id => leave(80_000, id)), ['stay', 'stay']);
  assert.deepEqual(['b-1', 'b-2', 'b-3'].map(id => leave(90_000, id)), [85_000, 90_000, 'stay']);
  assert.deepEqual([snaps[85_000 / 5000].sessions.length, snaps[90_000 / 5000].sessions.length], [3, 4]);   // F4 opens at 90 s
});

test('pixelScenario: in F4 a Done lounge seat never moves, nobody sits on a burning seat, the pruned five burn together', () => {
  const l = officeLayout(fit(2308, 1372)), seat = new Map<string, string>(), five = ['d-pa', 'd-pb', 'd-1', 'd-2', 'd-3'];
  run(CLEAN, 60_000).forEach((s, i) => {
    const t = CLEAN[i], d = s.sessions.find(x => x.sid === 'sim-pixel-d');
    if (!d) return;
    const { places } = officeScene(d.agents, t, l), taken = new Set<string>();
    for (const [id, p] of places) {
      if (p.spot.room !== 'done') continue;
      const k = `${p.spot.pt.x},${p.spot.pt.y}`;
      assert.equal(seat.get(id) ?? k, k, `${id} moves at ${t}`);
      assert.ok(!taken.has(k), `two on ${k} at ${t}`);
      seat.set(id, k); taken.add(k);
    }
    if (t === 325_000) assert.deepEqual(five.map(id => places.get(id)?.kind), five.map(() => 'burn'));
    if (t === 335_000) assert.ok(five.every(id => !places.has(id)));
    if (t === 530_000) assert.deepEqual([places.get('d-ghost')?.kind, places.get('d-ghost')?.spot.room !== 'done'], ['burn', true]);
    if (t === 540_000) assert.equal(places.has('d-ghost'), false);
  });
});

test('pixelScenario: main\'s connector calls for the couriers; a sub-agent\'s is not one; a permission wait on its own call', () => {
  const conn = (s: Snapshot, sid: string) => s.sessions.find(x => x.sid === sid)!.connectors.map(c => `${c.server}/${c.tool}@${c.at}`);
  const main = (s: Snapshot, sid: string) => s.sessions.find(x => x.sid === sid)!.agents.find(a => a.id === 'main')!;
  const [s17, s51, s101, s130, s141, s151, s171] = run([17_000, 51_000, 101_000, 130_000, 141_000, 151_000, 171_000]);
  assert.deepEqual(conn(s17, 'sim-pixel-a'), ['claude_ai_Microsoft_365/teams_list_chats@16000']);
  assert.deepEqual(conn(s51, 'sim-pixel-a'), ['claude_ai_Gmail/search_threads@50000', 'claude_ai_Microsoft_365/outlook_email_search@50000']);
  // main's Agent call for a-new (50 s) never gets its PostToolUse in the script, so only the MCP one is checked
  assert.deepEqual([main(s130, 'sim-pixel-a').stage, main(s130, 'sim-pixel-a').activeTools.map(t => t.name).filter(n => n.startsWith('mcp__'))],
    ['waiting', ['mcp__claude_ai_Microsoft_365__outlook_send_mail']]);
  assert.deepEqual(main(s130, 'sim-pixel-a').reasons[0], { kind: 'permission', tool: 'mcp__claude_ai_Microsoft_365__outlook_send_mail', label: null });
  assert.equal(main(s141, 'sim-pixel-a').stage, 'running');
  assert.ok(conn(s151, 'sim-pixel-a').includes('claude_ai_Gmail/get_thread@109000'), 'the sub-agent\'s call at 150 s is not main\'s');
  assert.deepEqual(conn(s171, 'sim-pixel-a').slice(-3), ['claude_ai_Google_Drive/search_files@160000', 'claude_ai_Google_Calendar/list_events@162000', 'claude_ai_Notion/notion-search@170000']);
  assert.deepEqual(conn(s101, 'sim-pixel-b'), ['claude_ai_Gmail/search_threads@90000', 'claude_ai_Microsoft_365/teams_list_chats@100000']);
});

test('pixelScenario: F5 has three seated runners past the cat\'s first rest, then nobody working, three times', () => {
  const F5 = 95_000, l = officeLayout(fit(1146, 613));
  const times = CAT_ROUNDS.flatMap(r => [F5 + r + 60_000, F5 + r + CAT_WORK + 1000]);
  run(times).forEach((s, i) => {
    const agents = s.sessions.find(x => x.sid === 'sim-pixel-e')!.agents, { places } = officeScene(agents, times[i], l);
    const working = agents.filter(a => a.stage === 'running' || a.stage === 'verifying');
    if (i % 2) assert.deepEqual(working, [], `nobody works at ${times[i]}`);
    else assert.deepEqual(working.map(a => places.get(a.id)?.kind), ['desk', 'desk', 'desk'], `three at desks at ${times[i]}`);
  });
});

test('doneScenario: twelve sub-agents work at 5 s, all done and staying in the Done lounge by its end for their ten minutes, half of them paid', () => {
  const [s5, sEnd, s60] = run([5_000, DONE_END, 60_000], undefined, doneScenario());
  const subs = (s: Snapshot) => s.sessions[0].agents.filter(a => a.role === 'agent');
  assert.deepEqual(subs(s5).map(a => a.stage), Array(DONE_N).fill('running'));
  for (const s of [sEnd, s60]) assert.deepEqual(subs(s).map(a => [a.stage, a.leaveAt! - a.stageSince]), Array(DONE_N).fill(['done', DONE_STAY_MS]));
  assert.equal(subs(sEnd).filter(a => a.tokens > 0).length, DONE_N / 2);
});

test('fireScenario: F1 reaches five sub-agents at 30+ minutes at FIRE_AT, breaks at FIRE_BREAK, forms again at FIRE_REFORM; F2 at FIRE_B_AT', () => {
  const times = [FIRE_AT - 1000, FIRE_AT + 1000, FIRE_B_AT - 1000, FIRE_B_AT + 1000, FIRE_BREAK + 1000, FIRE_REFORM - 1000, FIRE_REFORM + 1000];
  const snaps = run(times, undefined, fireScenario());
  const counts = snaps.map((s, i) => s.sessions.map(f => hotCount(f.agents, times[i])));
  assert.deepEqual(counts, [[4, 4], [5, 4], [5, 4], [5, 5], [4, 5], [4, 5], [5, 5]]);
});

test('askScenario: F1 and F3 are foreman floors, F2 is not; F1\'s main works (a failure, two calls at once), then asks two questions, one multi-select, and waits; its sub-agent asks too; F2 and F3 are answered in the terminal', () => {
  const [a, b, c] = askScenario();
  assert.deepEqual([a.foreman, b.foreman, c.foreman], [true, false, true]);
  const asks = (f: ScriptFloor) => f.lines.filter(l => l.event === '__ask').map(l => l.payload);
  assert.deepEqual(asks(a).map(p => [p.agent_id ?? 'main', p.questions!.length, p.questions!.some(q => q.multiSelect), p.terminal ?? null]),
    [['a-explore', 1, false, 8000], ['main', 2, true, null]]);
  assert.deepEqual([asks(b)[0].terminal, asks(c)[0].terminal], [20_000, 15_000]);
  assert.ok(a.lines.some(l => l.event === 'PostToolUseFailure' && l.payload.tool_name === 'Bash' && !l.payload.agent_id));
  const [s] = run([9000], undefined, [a]);
  assert.equal(s.sessions[0].agents.find(x => x.id === 'main')!.activeTools.length, 2);
});

const Q = { question: 'Which color?', options: [{ label: 'Blue' }, { label: 'Red' }], multiSelect: false };
const lastOf = (f: string) => JSON.parse(readFileSync(f, 'utf8').trim().split('\n').at(-1)!);
const lastResult = (root: string, sid: string) => lastOf(join(root, 'projects', `${sid}.jsonl`)).message.content.find((b: { type: string }) => b.type === 'tool_result').content;
const lastSpool = (root: string, sid: string) => { const l = lastOf(join(root, 'spool', `${sid}.jsonl`)); return [l.event, l.payload.tool_name]; };

test('askLine: the question waits on the server as fv-ask.sh would; the pop-up\'s answer is written back as Claude Code would; a terminal answer is a PostToolUse and no decision', { timeout: 20_000 }, async () => {
  const root = tempDir('fv-sim-');
  sandbox(root, 'k1');
  writeFileSync(join(root, 'state', 'active-k1'), 'on');
  place(root, 'k1', { ts: 0, event: 'SessionStart', payload: { session_id: 'k1' } }, Date.now());
  const running = await serve({ port: 0, abandonMs: 600_000, spoolDir: join(root, 'spool'), stateDir: join(root, 'state'), settingsPath: join(root, 'settings.json') });
  try {
    const port = running.port;
    const next = sseReader(await fetch(`http://127.0.0.1:${port}/events`));
    const asked = askLine(root, 'k1', { ts: 0, event: '__ask', payload: { session_id: 'k1', tool_use_id: 'q1', questions: [Q] } }, port);
    let ask;
    while (!(ask = (await next()).sessions.find(x => x.sid === 'k1')?.ask));
    const r = await fetch(`http://127.0.0.1:${port}/api/ask/${ask.id}`, { method: 'POST', headers: { 'X-Foreman-Vision': '1' }, body: JSON.stringify({ answers: { 'Which color?': 'Blue' } }) });
    assert.equal(r.status, 204);
    assert.equal(await asked, 200);
    assert.equal(lastResult(root, 'k1'), 'Your questions have been answered: "Which color?"="Blue". You can now continue with these answers in mind.');
    assert.deepEqual(lastSpool(root, 'k1'), ['PostToolUse', 'AskUserQuestion']);
    assert.equal(await askLine(root, 'k1', { ts: 0, event: '__ask', payload: { session_id: 'k1', tool_use_id: 'q2', questions: [Q], terminal: 300 } }, port), 204);
  } finally {
    running.stop();
  }
});
