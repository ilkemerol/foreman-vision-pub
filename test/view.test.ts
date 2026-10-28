import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_GRACE_MS, DONE_STAY_MS, type ForemanMode, type HookPayload } from '../shared/types.ts';
import { parseBoard, parseMode } from '../src/board.ts';
import { emptyState, reduce, type State } from '../src/reducer.ts';
import { toSnapshot } from '../src/view.ts';
import { officeLayout } from '../web/src/logic/layout.ts';
import { stretchStart } from '../web/src/logic/model.ts';
import { assignDesks, deskMemory, officeScene } from '../web/src/logic/scene.ts';
import { hook } from './helpers.ts';

const board = (st: State, text: string, foreman: ForemanMode = 'on') =>
  reduce(st, { kind: 'board', sid: 's1', foreman, rows: parseBoard(text) });
const view = (st: State, id: string) => toSnapshot(st, 0).sessions[0].agents.find(a => a.id === id)!;
const stay = (since: number) => since + DONE_STAY_MS;   // a done agent's latest leave from the Done lounge

test('parseBoard: TSV rows, "-" means no agent yet, bad rows skipped, CRLF ok', () => {
  assert.deepEqual(parseBoard('1\t-\tExplore\tsearch\tqueued\t\r\n2\ta9\tgp\twrite\tbogus\t\njunk\n3\ta3\tgp\tfinished\tdone\tok\n'), [
    { n: 1, agentId: null, type: 'Explore', job: 'search', stage: 'queued', note: '' },
    { n: 3, agentId: 'a3', type: 'gp', job: 'finished', stage: 'done', note: 'ok' },
  ]);
  assert.equal(parseMode('on'), 'on');
  assert.equal(parseMode('task\n'), 'task');
  assert.equal(parseMode(null), 'off');
});

test('floors: oldest session first, project from cwd, same cwd stays two floors', () => {
  const st = emptyState();
  hook(st, 'SessionStart', { session_id: 'bbbbbbbb-2', cwd: 'C:\\Users\\me\\proj' }, 200);
  hook(st, 'SessionStart', { session_id: 'aaaaaaaa-1', cwd: '/Users/me/proj/' }, 100);
  hook(st, 'SessionStart', { session_id: 'cccccccc-3' }, 300);
  assert.deepEqual(toSnapshot(st, 0).sessions.map(s => [s.sid, s.project]),
    [['aaaaaaaa-1', 'proj'], ['bbbbbbbb-2', 'proj'], ['cccccccc-3', 'cccccccc']]);
});

test('foreman session: main is the foreman, the board gives label and type', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1', agent_type: 'general-purpose' });
  board(st, '1\tA1\tExplore\tread files\trunning\t\n');
  assert.equal(view(st, 'main').role, 'foreman');
  assert.deepEqual([view(st, 'A1').label, view(st, 'A1').type, view(st, 'A1').stage], ['read files', 'Explore', 'running']);
  board(st, '', 'off');
  assert.equal(view(st, 'main').role, 'main');
});

test('stopped agent: board says what it means; a stale running row gets a badge', () => {
  const st = emptyState();
  for (const id of ['A1', 'A2', 'A3', 'A4']) {
    hook(st, 'SubagentStart', { agent_id: id });
    hook(st, 'SubagentStop', { agent_id: id });
  }
  board(st, '1\tA1\tx\tj1\tverifying\t\n2\tA2\tx\tj2\tfailed\ttest broken\n3\tA3\tx\tj3\trunning\t\n');
  assert.equal(view(st, 'A1').stage, 'verifying');
  assert.equal(view(st, 'A2').stage, 'failed');
  assert.deepEqual([view(st, 'A3').stage, view(st, 'A3').badges], ['done', ['stale-board']]);
  assert.deepEqual([view(st, 'A4').stage, view(st, 'A4').badges], ['done', []]);
});

test('board waiting: needs-agent waits quietly, needs-decision alerts; reasons merge', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1' });
  hook(st, 'SubagentStart', { agent_id: 'A2' });
  hook(st, 'Notification', { agent_id: 'A2', notification_type: 'permission_prompt', message: 'allow?' });
  board(st, '1\tA1\tx\tj1\twaiting\tneeds-agent: after B\n2\tA2\tx\tj2\twaiting\tneeds-decision: which one?\n');
  assert.deepEqual([view(st, 'A1').stage, view(st, 'A1').alert], ['waiting', false]);
  assert.deepEqual(view(st, 'A2').reasons, [{ kind: 'notification', text: 'allow?' }, { kind: 'note', text: 'needs-decision: which one?' }]);
  assert.equal(view(st, 'A2').alert, true);
  assert.equal(toSnapshot(st, 0).sessions[0].waitingCount, 1);
});

test('a waiting board row with no note has no reason', () => {
  const st = emptyState();
  hook(st, 'SessionStart');
  board(st, '1\t-\tExplore\tdecision\twaiting\t\n');
  assert.deepEqual([view(st, 'board:1').stage, view(st, 'board:1').reasons], ['waiting', []]);
});

test('board rows without a live agent become placeholders; pending agents are not off-board', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T1', label: 'new' });
  board(st, '1\t-\tExplore\tnext up\tqueued\t\n2\tZZ\tx\told\tdone\t\n');
  assert.deepEqual(toSnapshot(st, 0).sessions[0].agents.map(a => [a.id, a.role, a.stage]), [
    ['main', 'foreman', 'running'],
    ['pending:T1', 'agent', 'spawning'],
    ['board:1', 'placeholder', 'queued'],
    ['board:2', 'placeholder', 'done'],
  ]);
  assert.deepEqual(view(st, 'pending:T1').badges, []);
});

test('key: the spawn tool_use_id from pending to bound; else the id (main, board rows, agents with no spawn call)', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T1', label: 'new' });
  board(st, '1\t-\tExplore\tnext up\tqueued\t\n');
  hook(st, 'SubagentStart', { agent_id: 'F1', agent_type: 'fork' });   // a forked agent: no Agent call behind it
  assert.deepEqual(['pending:T1', 'main', 'board:1', 'F1'].map(id => view(st, id).key), ['T1', 'main', 'board:1', 'F1']);
  hook(st, 'SubagentStart', { agent_id: 'A1', agent_type: 'general-purpose' });
  reduce(st, { kind: 'bind', sid: 's1', toolUseId: 'T1', agentId: 'A1' });
  assert.deepEqual([view(st, 'A1').key, toSnapshot(st, 0).sessions[0].agents.some(a => a.id === 'pending:T1')], ['T1', false]);
});

test('off-board: a running agent with no board row is badged', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1' });
  board(st, '');
  assert.deepEqual([view(st, 'A1').stage, view(st, 'A1').badges], ['running', ['off-board']]);
});

test('the board note travels with the agent at any stage; no row means null', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1' });
  hook(st, 'SubagentStart', { agent_id: 'A2' });
  board(st, '1\tA1\tx\tj1\tverifying\ttests running\n2\t-\tx\tj2\tqueued\twaiting its turn\n');
  assert.equal(view(st, 'A1').note, 'tests running');
  assert.equal(view(st, 'A2').note, null);
  assert.equal(view(st, 'board:2').note, 'waiting its turn');
});

test('stageSince: first sight uses endedAt ?? startedAt, a change stamps now, no change keeps it', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1' }, 5000);
  assert.equal(toSnapshot(st, 6000).sessions[0].agents.find(a => a.id === 'A1')!.stageSince, 5000);
  hook(st, 'SubagentStop', { agent_id: 'A1' }, 7000);
  const at = (now: number) => toSnapshot(st, now).sessions[0].agents.find(a => a.id === 'A1')!.stageSince;
  assert.equal(at(7200), 7200);   // running → done seen now
  assert.equal(at(9000), 7200);
});

test('stageSince: the board catching up on a stopped agent is a new stage, done → done too', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1' }, 5000);
  board(st, '1\tA1\tx\tj\trunning\t\n');
  const at = (now: number) => { const a = toSnapshot(st, now).sessions[0].agents.find(a => a.id === 'A1')!; return [a.stage, a.badges, a.stageSince]; };
  assert.deepEqual(at(6000), ['running', [], 5000]);
  hook(st, 'SubagentStop', { agent_id: 'A1' }, 7000);
  assert.deepEqual(at(7000), ['done', ['stale-board'], 7000]);
  board(st, '1\tA1\tx\tj\tdone\t\n');
  assert.deepEqual(at(10_000), ['done', [], 10_000]);
  assert.deepEqual(at(11_000), ['done', [], 10_000]);
});

test('stageSince: after a restart a finished agent falls back to endedAt', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1' }, 5000);
  hook(st, 'SubagentStop', { agent_id: 'A1' }, 7000);
  assert.equal(view(st, 'A1').stageSince, 7000);
});

test('activeSince and breaks come from the spool: a restart replaying it keeps them, the current run counts from the resume', () => {
  const lines: [string, Partial<HookPayload>, number][] = [
    ['SubagentStart', { agent_id: 'A1', agent_type: 'Explore' }, 1000],
    ['SubagentStop', { agent_id: 'A1' }, 5000],
    ['PreToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r' }, 8000],   // resumed (SendMessage)
    ['PermissionRequest', { agent_id: 'A1', tool_name: 'Bash' }, 10_000],
    ['PostToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r' }, 12_000], // back from waiting
  ];
  const replay = () => { const st = emptyState(); for (const [e, p, ts] of lines) hook(st, e, p, ts); return st; };
  const live = emptyState();
  for (const [e, p, ts] of lines) { hook(live, e, p, ts); toSnapshot(live, ts); }
  const before = view(live, 'A1'), after = view(replay(), 'A1');   // after: a fresh state, first sight
  assert.deepEqual([after.activeSince, after.breaks], [12_000, [[5000, 8000]]]);
  assert.deepEqual([after.activeSince, after.breaks], [before.activeSince, before.breaks]);
  assert.equal(after.stageSince, 1000);          // first sight: startedAt
  assert.equal(stretchStart(after), 12_000);     // not the first start
});

test('breaks end where the desk was released: a board hold after the stop is replayed on a reload', () => {
  // r stops at 100 and the board holds its desk (verifying, or stale) or frees it (done); k1 starts at 200 and picks
  // r's desk; r resumes at 300. A reload seats them from the last snapshot alone, as the live page did
  const MIN = officeLayout({ w: 1114, h: 589, dpr: 1, demand: 0, sb: 0 });
  for (const stage of ['verifying', 'running', 'done']) {
    const st = emptyState(), mem = deskMemory();
    const page = (t: number) => {
      const ag = toSnapshot(st, t).sessions[0].agents, { places } = officeScene(ag, t, MIN, [], mem);
      return { ag, desks: new Map([...places].filter(([, p]) => p.kind === 'desk').map(([id, p]) => [id, p.desk])) };
    };
    hook(st, 'SubagentStart', { agent_id: 'r', agent_type: 'Explore' }, 0);
    board(st, '1\tr\tExplore\tsearch\trunning\t\n');
    page(0);
    hook(st, 'SubagentStop', { agent_id: 'r' }, 100);
    board(st, `1\tr\tExplore\tsearch\t${stage}\t\n`);
    page(100);
    hook(st, 'SubagentStart', { agent_id: 'k1', agent_type: 'Explore' }, 200);
    page(200);
    hook(st, 'PreToolUse', { agent_id: 'r', tool_name: 'Read', tool_use_id: 'x' }, 300);
    const live = page(300), reload = assignDesks(live.ag, MIN);
    assert.equal(live.desks.get('k1') === live.desks.get('r'), false, stage);
    assert.deepEqual(['r', 'k1'].map(id => reload.get(id)), ['r', 'k1'].map(id => live.desks.get(id)), stage);
    assert.deepEqual(live.ag.find(a => a.id === 'r')!.breaks, [[stage === 'done' ? 100 : 300, 300]], stage);
  }
});

test('one card per job: an unbound board row takes the unbound live agent of its type', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1', agent_type: 'Explore' }, 1000);
  hook(st, 'SubagentStart', { agent_id: 'A2', agent_type: 'Explore' }, 2000);
  board(st, '1\t-\tExplore\tfirst\tqueued\t\n2\t-\tExplore\tsecond\trunning\t\n3\t-\tPlan\tplan\tqueued\t\n');
  const ids = toSnapshot(st, 0).sessions[0].agents.map(a => a.id);
  assert.deepEqual(ids.sort(), ['A1', 'A2', 'board:3', 'main']);
  assert.deepEqual([view(st, 'A1').label, view(st, 'A1').badges], ['first', []]);
  assert.equal(view(st, 'A2').label, 'second');
});

test('one card per job: a stopped agent and a done "-" row are not paired', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1', agent_type: 'Explore' });
  hook(st, 'SubagentStop', { agent_id: 'A1' });
  hook(st, 'SubagentStart', { agent_id: 'A2', agent_type: 'Explore' });
  board(st, '1\t-\tExplore\tjob\trunning\t\n2\t-\tExplore\told\tdone\t\n');
  assert.equal(view(st, 'A2').label, 'job');
  assert.ok(view(st, 'board:2'));
  assert.equal(view(st, 'A1').stage, 'done');
});

test('one card per job: a waiting "-" row (a decision before the spawn) takes no live agent of its type', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1', agent_type: 'general-purpose' });
  board(st, '1\t-\tgeneral-purpose\tdecision\twaiting\tneeds-decision: which one?\n');
  assert.deepEqual([view(st, 'A1').stage, view(st, 'A1').alert, view(st, 'A1').badges], ['running', false, ['off-board']]);
  assert.deepEqual([view(st, 'board:1').role, view(st, 'board:1').stage, view(st, 'board:1').alert], ['placeholder', 'waiting', true]);
});

test('one card per job: an agent started before its meta.json bind wears its pending call\'s key, so the bind moves no desk', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T1', subagent_type: 'Explore', label: 'read' }, 1000);
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T2', subagent_type: 'Explore', label: 'write' }, 1100);
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T3', subagent_type: 'Plan', label: 'plan' }, 1200);
  hook(st, 'SubagentStart', { agent_id: 'A2', agent_type: 'Explore' }, 1600);
  hook(st, 'SubagentStart', { agent_id: 'A1', agent_type: 'Explore' }, 1500);
  const cards = () => toSnapshot(st, 2000).sessions[0].agents.map(a => [a.id, a.key, a.label, a.startedAt]);
  const before = cards();
  // oldest pending with the oldest agent of its type; the Plan call has no agent yet and stays a pending card
  assert.deepEqual(before, [['main', 'main', 'main', 1000], ['pending:T3', 'T3', 'plan', 1200], ['A2', 'T2', 'write', 1100], ['A1', 'T1', 'read', 1000]]);
  assert.deepEqual(cards(), before);
  reduce(st, { kind: 'bind', sid: 's1', toolUseId: 'T1', agentId: 'A1' });
  reduce(st, { kind: 'bind', sid: 's1', toolUseId: 'T2', agentId: 'A2' });
  assert.deepEqual(cards(), before);
});

test('one card per job: an agent with no agent_type pairs with any pending call, after the typed ones took theirs', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T1', subagent_type: 'Explore', label: 'read' }, 1000);
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T2', subagent_type: 'Plan', label: 'plan' }, 1100);
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T3', subagent_type: 'Plan', label: 'wait' }, 1200);
  reduce(st, { kind: 'bind', sid: 's1', toolUseId: 'T3', agentId: 'A9' });   // T3's agent is known, not seen yet
  hook(st, 'SubagentStart', { agent_id: 'U1', agent_type: '' }, 1400);
  hook(st, 'SubagentStart', { agent_id: 'A1', agent_type: 'Explore' }, 1500);
  const cards = () => toSnapshot(st, 2000).sessions[0].agents.map(a => [a.id, a.key, a.label, a.type]);
  const before = cards();
  // the older unknown U1 leaves T1 to the typed A1 and takes the oldest call left; reserved T3 stays a pending card
  assert.deepEqual(before, [['main', 'main', 'main', 'main'], ['pending:T3', 'T3', 'wait', 'Plan'],
    ['U1', 'T2', 'plan', 'Plan'], ['A1', 'T1', 'read', 'Explore']]);
  reduce(st, { kind: 'bind', sid: 's1', toolUseId: 'T1', agentId: 'A1' });
  reduce(st, { kind: 'bind', sid: 's1', toolUseId: 'T2', agentId: 'U1' });
  assert.deepEqual(cards(), before);
});

test('one card per job: a paired agent that stops before the board names it keeps its row, a stale-board done at its desk', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1', agent_type: 'Explore' }, 1000);
  board(st, '1\t-\tExplore\tjob\trunning\t\n');
  const at = (now: number) => {
    const agents = agentsAt(st, now), a = agents.find(x => x.id === 'A1')!;
    return [a.label, a.stage, a.badges, a.leaveAt, agents.some(x => x.id === 'board:1')];
  };
  assert.deepEqual(at(2000), ['job', 'running', [], null, false]);
  hook(st, 'SubagentStop', { agent_id: 'A1' }, 3000);
  assert.deepEqual(at(3000), ['job', 'done', ['stale-board'], null, false]);
  board(st, '1\tA1\tExplore\tjob\trunning\t\n');   // the board catches up: no stage change, no walk
  assert.deepEqual(at(4000), ['job', 'done', ['stale-board'], null, false]);
  assert.equal(agentsAt(st, 4000).find(x => x.id === 'A1')!.stageSince, 3000);
  board(st, '1\tA1\tExplore\tjob\tdone\t\n');
  assert.deepEqual(at(5000), ['job', 'done', [], stay(5000), false]);
});

test('one card per job: a stopped agent\'s kept row lets go once the row is removed; the row coming back does not restore it', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1', agent_type: 'Explore' }, 1000);
  board(st, '1\t-\tExplore\tjob\trunning\t\n');
  agentsAt(st, 2000);
  hook(st, 'SubagentStop', { agent_id: 'A1' }, 3000);
  agentsAt(st, 3000);
  board(st, '');
  assert.deepEqual([view(st, 'A1').stage, view(st, 'A1').badges], ['done', []]);
  board(st, '1\t-\tExplore\tjob\trunning\t\n');   // the same row back: the pairing is gone, the row waits for its agent
  assert.deepEqual([view(st, 'A1').badges, view(st, 'board:1').role], [[], 'placeholder']);
});

test('ghosts: an unknown agent whose first event is SubagentStop is not shown; one that ran a tool first is', () => {
  const st = emptyState();
  hook(st, 'SubagentStop', { agent_id: 'F1', agent_type: '' }, 7000);
  hook(st, 'SubagentStart', { agent_id: 'F2', agent_type: '' }, 7050);
  hook(st, 'PreToolUse', { agent_id: 'F2', agent_type: '', tool_name: 'Read', tool_use_id: 'r' }, 7100);
  hook(st, 'SubagentStop', { agent_id: 'F2', agent_type: '' }, 7200);
  const ids = toSnapshot(st, 0).sessions[0].agents.map(a => a.id);
  assert.ok(!ids.includes('F1'));
  assert.ok(ids.includes('F2'));
});

test('SessionView.context: null until main\'s first usage, then used and peak', () => {
  const st = emptyState();
  hook(st, 'SessionStart');
  assert.equal(toSnapshot(st, 0).sessions[0].context, null);
  reduce(st, { kind: 'transcript', sid: 's1', agentId: 'main', at: 0, model: null, tokens: null, context: { used: 30_000, peak: 175_000 } });
  assert.deepEqual(toSnapshot(st, 0).sessions[0].context, { used: 30_000, peak: 175_000 });
});

const agentsAt = (st: State, now: number) => toSnapshot(st, now).sessions[0].agents;
const leaveAt = (st: State, now: number, id: string) => agentsAt(st, now).find(a => a.id === id)!.leaveAt;

test('leaveAt in a board session: a row keeps an agent in; a pruned row starts 60 s from that snapshot and the value stays; a row back in the grace clears it', () => {
  const st = emptyState();
  for (const id of ['A1', 'A2']) { hook(st, 'SubagentStart', { agent_id: id, agent_type: 'gp' }, 100); hook(st, 'SubagentStop', { agent_id: id }, 200); }
  const r1 = '1\tA1\tgp\tj1\tdone\t\n', r2 = '2\tA2\tgp\tj2\tdone\t\n';
  board(st, r1 + r2);
  assert.deepEqual([leaveAt(st, 10_000, 'A1'), leaveAt(st, 10_000, 'A2')], [stay(200), stay(200)]);
  board(st, r2);
  assert.equal(leaveAt(st, 20_000, 'A1'), 20_000 + BOARD_GRACE_MS);
  assert.equal(leaveAt(st, 25_000, 'A1'), 80_000);
  board(st, '');
  assert.equal(leaveAt(st, 30_000, 'A2'), 90_000);
  board(st, r2);
  assert.deepEqual([leaveAt(st, 40_000, 'A2'), leaveAt(st, 40_000, 'A1')], [stay(200), 80_000]);
  board(st, '');
  assert.equal(leaveAt(st, 50_000, 'A2'), 110_000);   // a fresh 60 s
});

test('leaveAt: the parallel launch — while a "-" row is live no rowless finished agent starts its clock, so the early one stays its ten minutes', () => {
  const st = emptyState();
  hook(st, 'SessionStart', {}, 0);
  board(st, '1\t-\tExplore\tjob A\trunning\t\n2\t-\tExplore\tjob B\trunning\t\n');
  hook(st, 'SubagentStart', { agent_id: 'A', agent_type: 'Explore' }, 1000);
  hook(st, 'SubagentStart', { agent_id: 'B', agent_type: 'Explore' }, 1000);
  hook(st, 'SubagentStop', { agent_id: 'A' }, 5000);
  for (let t = 5000; t <= 300_000; t += 5000) {
    if (t === 180_000) hook(st, 'SubagentStop', { agent_id: 'B' }, t);
    if (t === 185_000) board(st, '1\tA\tExplore\tjob A\tdone\t\n2\tB\tExplore\tjob B\tdone\t\n');
    assert.equal(leaveAt(st, t, 'A'), stay(5000), `A at ${t}`);
  }
});

test('leaveAt: a queued "-" row holds a rowless helper; once it goes the clock starts; a verifying "-" row stops it again, a waiting one does not', () => {
  const st = emptyState();
  hook(st, 'SessionStart', {}, 0);
  board(st, '1\t-\tgp\tplanned\tqueued\t\n');
  hook(st, 'SubagentStart', { agent_id: 'H', agent_type: 'Explore' }, 1000);   // a helper never on the board
  hook(st, 'SubagentStop', { agent_id: 'H' }, 2000);
  for (const t of [5000, 300_000, 500_000]) assert.equal(leaveAt(st, t, 'H'), stay(2000));   // held: only its ten minutes
  board(st, '');
  assert.equal(leaveAt(st, 505_000, 'H'), 565_000);
  board(st, '1\t-\tgp\tx\tverifying\t\n');
  assert.equal(leaveAt(st, 510_000, 'H'), stay(2000));
  board(st, '1\t-\tgp\tdecision\twaiting\tneeds-decision: x\n');
  assert.equal(leaveAt(st, 520_000, 'H'), 580_000);
});

test('leaveAt without a board: the five latest finished stay; the sixth to finish sends the oldest out at that snapshot', () => {
  const st = emptyState();
  hook(st, 'SessionStart', {}, 0);
  const finish = (id: string, t: number) => { hook(st, 'SubagentStart', { agent_id: id, agent_type: 'Explore' }, t - 500); hook(st, 'SubagentStop', { agent_id: id }, t); };
  for (let i = 1; i <= 5; i++) { finish('D' + i, i * 1000); agentsAt(st, i * 1000 + 100); }
  assert.deepEqual(agentsAt(st, 6000).filter(a => a.role === 'agent').map(a => a.leaveAt), [1, 2, 3, 4, 5].map(i => stay(i * 1000)));
  finish('D6', 7000);
  assert.deepEqual(['D1', 'D2', 'D6'].map(id => leaveAt(st, 7100, id)), [7100, stay(2000), stay(7000)]);
  assert.equal(leaveAt(st, 9000, 'D1'), 7100);
  finish('D7', 10_000);
  assert.deepEqual(['D1', 'D2', 'D3'].map(id => leaveAt(st, 10_100, id)), [7100, 10_100, stay(3000)]);
});

test('leaveAt when the board goes (foreman off, task end) and a new one comes: the five latest stay, older ones leave now; on the new board the five leave 60 s after no row waits for its agent', () => {
  const st = emptyState();
  hook(st, 'SessionStart', {}, 0);
  const ids = [1, 2, 3, 4, 5, 6, 7].map(i => 'D' + i);
  ids.forEach((id, i) => { hook(st, 'SubagentStart', { agent_id: id, agent_type: 'gp' }, i * 1000 + 500); hook(st, 'SubagentStop', { agent_id: id }, i * 1000 + 1000); });
  const rows = (list: string[]) => list.map((id, i) => `${i + 1}\t${id}\tgp\tj${id}\tdone\t\n`).join('');
  board(st, rows(ids));
  assert.ok(agentsAt(st, 8000).every(a => a.leaveAt === (a.role === 'agent' ? stay(a.stageSince) : null)));
  board(st, rows(ids.slice(0, 6)));
  assert.equal(leaveAt(st, 8500, 'D7'), 68_500);           // pruned: in its grace
  board(st, '', 'off');                                     // foreman-state.sh end deletes the board
  assert.deepEqual(ids.map(id => leaveAt(st, 9000, id)), [9000, 9000, ...[3, 4, 5, 6, 7].map(i => stay(i * 1000))]);
  board(st, '1\t-\tExplore\tnew task\trunning\t\n');      // the next task: its row waits for its agent
  assert.deepEqual(ids.slice(2).map(id => leaveAt(st, 10_000, id)), [3, 4, 5, 6, 7].map(i => stay(i * 1000)));
  hook(st, 'SubagentStart', { agent_id: 'N', agent_type: 'Explore' }, 10_200);
  board(st, '1\tN\tExplore\tnew task\trunning\t\n');
  assert.deepEqual(ids.map(id => leaveAt(st, 11_000, id)), [9000, 9000, 71_000, 71_000, 71_000, 71_000, 71_000]);
});

test('leaveAt stays once past: a row coming back or the board going keeps it; running again (resumed by SendMessage under the same agent_id) clears it', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A', agent_type: 'gp' }, 100);
  hook(st, 'SubagentStop', { agent_id: 'A' }, 500);
  const row = '1\tA\tgp\tj\tdone\t\n';
  board(st, row);
  assert.equal(leaveAt(st, 1000, 'A'), stay(500));
  board(st, '');
  assert.equal(leaveAt(st, 2000, 'A'), 62_000);
  assert.equal(leaveAt(st, 70_000, 'A'), 62_000);
  board(st, row);
  assert.equal(leaveAt(st, 71_000, 'A'), 62_000);
  board(st, '', 'off');
  assert.equal(leaveAt(st, 72_000, 'A'), 62_000);
  hook(st, 'PreToolUse', { agent_id: 'A', tool_name: 'Read', tool_use_id: 'r1' }, 73_000);   // no SubagentStart
  const a = agentsAt(st, 73_100).find(x => x.id === 'A')!;
  assert.deepEqual([a.stage, a.leaveAt, st.sessions.get('s1')!.leave.has('A')], ['running', null, false]);
  hook(st, 'SubagentStop', { agent_id: 'A' }, 74_000);
  assert.equal(leaveAt(st, 74_100, 'A'), stay(74_100));   // a newly finished agent, the latest of the floor
});

test('leaveAt for abandoned: in a board session a rowless ghost leaves 60 s after it goes quiet and stays gone when the board goes; without a board it stays a ghost', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'G', agent_type: 'gp' }, 100);
  board(st, '');
  assert.equal(leaveAt(st, 1000, 'G'), null);
  reduce(st, { kind: 'tick', now: 700_000, abandonMs: 600_000 });
  assert.equal(leaveAt(st, 700_000, 'G'), 760_000);
  assert.equal(leaveAt(st, 760_000, 'G'), 760_000);
  board(st, '', 'off');
  assert.equal(leaveAt(st, 765_000, 'G'), 760_000);
  hook(st, 'PreToolUse', { agent_id: 'G', tool_name: 'Read', tool_use_id: 'r1' }, 766_000);
  assert.equal(leaveAt(st, 766_100, 'G'), null);
  const off = emptyState();
  hook(off, 'SubagentStart', { agent_id: 'H', agent_type: 'gp' }, 100);
  reduce(off, { kind: 'tick', now: 700_000, abandonMs: 600_000 });
  const h = agentsAt(off, 700_000).find(a => a.id === 'H')!;
  assert.deepEqual([h.stage, h.leaveAt, leaveAt(off, 900_000, 'H')], ['abandoned', null, null]);
});

test('leaveAt on first sight (a restart rebuilds from the spool): a board session counts from stageSince; without a board the i-th older left when the (i − 5)-th later one finished', () => {
  const st = emptyState();
  for (const [id, end] of [['A', 1000], ['B', 100_000], ['C', 500]] as const) { hook(st, 'SubagentStart', { agent_id: id, agent_type: 'gp' }, 0); hook(st, 'SubagentStop', { agent_id: id }, end); }
  board(st, '1\tC\tgp\tj\tdone\t\n');
  assert.deepEqual(['A', 'B', 'C'].map(id => leaveAt(st, 120_000, id)), [61_000, 160_000, stay(500)]);
  const off = emptyState();
  for (let i = 1; i <= 7; i++) { hook(off, 'SubagentStart', { agent_id: 'D' + i, agent_type: 'gp' }, 0); hook(off, 'SubagentStop', { agent_id: 'D' + i }, i * 1000); }
  assert.deepEqual([1, 2, 3, 7].map(i => leaveAt(off, 50_000, 'D' + i)), [6000, 7000, stay(3000), stay(7000)]);
});

test('leaveAt is null for main, board placeholders and agents still at work; badges do not change', () => {
  const st = emptyState();
  for (const id of ['V', 'F', 'S']) { hook(st, 'SubagentStart', { agent_id: id, agent_type: 'gp' }, 100); hook(st, 'SubagentStop', { agent_id: id }, 200); }
  hook(st, 'SubagentStart', { agent_id: 'R', agent_type: 'Explore' }, 100);
  hook(st, 'SubagentStart', { agent_id: 'W', agent_type: 'Plan' }, 100);
  hook(st, 'Notification', { agent_id: 'W', notification_type: 'permission_prompt', message: 'allow?' }, 150);
  board(st, '1\tV\tgp\tv\tverifying\t\n2\tF\tgp\tf\tfailed\tbroken\n3\tS\tgp\ts\trunning\t\n4\t-\tgp\tq\tqueued\t\n');
  const ag = agentsAt(st, 999_000);
  assert.deepEqual(['main', 'R', 'W', 'V', 'F', 'S', 'board:4'].map(id => ag.find(a => a.id === id)!.leaveAt), [null, null, null, null, null, null, null]);
  assert.deepEqual(['R', 'W', 'S'].map(id => ag.find(a => a.id === id)!.badges), [['off-board'], ['off-board'], ['stale-board']]);
});

test('leaveAt without a board: a stageSince tie at the 5/6 boundary breaks as the exact reverse of the client\'s bySince', () => {
  const st = emptyState();
  hook(st, 'SessionStart', {}, 0);
  for (const id of ['A', 'B']) hook(st, 'SubagentStart', { agent_id: id, agent_type: 'gp' }, 100);
  agentsAt(st, 200);
  for (const id of ['A', 'B']) hook(st, 'SubagentStop', { agent_id: id }, 300);
  agentsAt(st, 1000);   // both turn done in one snapshot: stageSince 1000 each
  for (let i = 1; i <= 4; i++) { hook(st, 'SubagentStart', { agent_id: 'D' + i, agent_type: 'gp' }, i * 1000 + 1000); hook(st, 'SubagentStop', { agent_id: 'D' + i }, i * 1000 + 1500); agentsAt(st, i * 1000 + 1600); }
  assert.deepEqual(['A', 'B'].map(id => leaveAt(st, 6000, id)), [5600, stay(1000)]);   // bySince puts A first, so A is the oldest
});

test('leaveAt in a board session on first sight while a "-" row is live: one that finished in the last 60 s is held, then 60 s from the row going', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A', agent_type: 'gp' }, 100);
  hook(st, 'SubagentStop', { agent_id: 'A' }, 100_000);
  board(st, '1\t-\tgp\tx\trunning\t\n');
  assert.equal(leaveAt(st, 120_000, 'A'), stay(100_000));
  board(st, '');
  assert.equal(leaveAt(st, 130_000, 'A'), 190_000);
});

test('leaveAt after a restart while a "-" row is live: agents that finished long ago stay gone, they do not flood the Done lounge and burn 60 s after the bind', () => {
  const st = emptyState();   // a restart: a fresh State replays the old spool
  hook(st, 'SessionStart', {}, 0);
  const old = Array.from({ length: 20 }, (_, i) => 'D' + i);
  old.forEach((id, i) => { hook(st, 'SubagentStart', { agent_id: id, agent_type: 'gp' }, i * 1000); hook(st, 'SubagentStop', { agent_id: id }, i * 1000 + 500); });
  board(st, '28\t-\tgp\tnew job\trunning\t\n');   // added before its agent id
  hook(st, 'SubagentStart', { agent_id: 'N', agent_type: 'gp' }, 3_600_000);
  const past = old.map((_, i) => i * 1000 + 500 + BOARD_GRACE_MS);
  assert.deepEqual(old.map(id => leaveAt(st, 3_601_000, id)), past);
  board(st, '28\tN\tgp\tnew job\trunning\t\n');
  assert.deepEqual(old.map(id => leaveAt(st, 3_610_000, id)), past);
});

test('leaveAt when the board goes and one of the five latest already left: it stays gone and takes no seat among the five', () => {
  const st = emptyState();
  hook(st, 'SessionStart', {}, 0);
  const ids = [1, 2, 3, 4, 5, 6].map(i => 'D' + i);
  ids.forEach((id, i) => { hook(st, 'SubagentStart', { agent_id: id, agent_type: 'gp' }, i * 1000 + 1000); hook(st, 'SubagentStop', { agent_id: id }, i * 1000 + 1500); });
  board(st, ids.slice(0, 5).map((id, i) => `${i + 1}\t${id}\tgp\tj${id}\tdone\t\n`).join(''));
  assert.equal(leaveAt(st, 10_000, 'D6'), 66_500);   // rowless, first sight: stageSince + 60 s
  board(st, '', 'off');
  assert.deepEqual(ids.map(id => leaveAt(st, 70_000, id)), [...[1, 2, 3, 4, 5].map(i => stay(i * 1000 + 500)), 66_500]);
});

test('leaveAt for abandoned after SessionEnd: a board session sends it out 60 s later; without a board it stays', () => {
  for (const [foreman, want] of [['on', 63_000], ['off', null]] as const) {
    const st = emptyState();
    hook(st, 'SubagentStart', { agent_id: 'G', agent_type: 'gp' }, 100);
    board(st, '', foreman);
    assert.equal(leaveAt(st, 1000, 'G'), null);
    hook(st, 'SessionEnd', {}, 2000);
    const g = agentsAt(st, 3000).find(a => a.id === 'G')!;
    assert.deepEqual([g.stage, g.leaveAt], ['abandoned', want], foreman);
  }
});

test('leaveAt: a done agent leaves the Done lounge ten minutes after it came in, its board row or a live "-" row notwithstanding; the same after a restart', () => {
  const st = emptyState();
  hook(st, 'SessionStart', {}, 0);
  hook(st, 'SubagentStart', { agent_id: 'A', agent_type: 'gp' }, 100);
  hook(st, 'SubagentStop', { agent_id: 'A' }, 1000);
  board(st, '1\tA\tgp\tj\tverifying\t\n');
  assert.equal(leaveAt(st, 2000, 'A'), null);   // verifying: at its desk, not in the Done lounge
  board(st, '1\tA\tgp\tj\tdone\t\n2\t-\tgp\tk\trunning\t\n');
  assert.equal(agentsAt(st, 3000).find(a => a.id === 'A')!.stageSince, 3000);   // it came in at 3000
  for (const t of [3000, 300_000, 602_999, 603_000, 700_000]) assert.equal(leaveAt(st, t, 'A'), stay(3000), `A at ${t}`);
  board(st, '2\t-\tgp\tk\trunning\t\n');   // a past leave stays past
  assert.equal(leaveAt(st, 710_000, 'A'), stay(3000));
  const again = emptyState();   // a restart: the spool replayed with the view memory reloaded (server.ts loadMemory)
  hook(again, 'SessionStart', {}, 0);
  hook(again, 'SubagentStart', { agent_id: 'A', agent_type: 'gp' }, 100);
  hook(again, 'SubagentStop', { agent_id: 'A' }, 1000);
  board(again, '1\tA\tgp\tj\tdone\t\n');
  again.sessions.get('s1')!.stages = new Map(st.sessions.get('s1')!.stages);
  assert.equal(leaveAt(again, 800_000, 'A'), stay(3000));
  const lost = emptyState();   // no memory: first sight counts from endedAt
  hook(lost, 'SubagentStart', { agent_id: 'A', agent_type: 'gp' }, 100);
  hook(lost, 'SubagentStop', { agent_id: 'A' }, 1000);
  assert.equal(leaveAt(lost, 5000, 'A'), stay(1000));
});

test('leaveAt: a "-" row already paired with a running agent holds no clock; it cannot be a finished agent\'s row', () => {
  const st = emptyState();
  hook(st, 'SessionStart', {}, 0);
  board(st, '1\t-\tgp\tjob\trunning\t\n');
  hook(st, 'SubagentStart', { agent_id: 'A', agent_type: 'gp' }, 1000);   // spawned, the board has not bound it yet
  hook(st, 'SubagentStart', { agent_id: 'H', agent_type: 'Explore' }, 1000);   // a helper never on the board
  agentsAt(st, 1500);
  hook(st, 'SubagentStop', { agent_id: 'H' }, 3000);
  const ag = agentsAt(st, 3000);
  assert.deepEqual([ag.find(a => a.id === 'A')!.label, ag.find(a => a.id === 'H')!.leaveAt], ['job', 3000 + BOARD_GRACE_MS]);
});

test('SessionView.connectors: main\'s latest MCP call per server; not a sub-agent\'s, not a non-MCP tool, not on PostToolUse', () => {
  const st = emptyState();
  hook(st, 'SessionStart', {}, 0);
  assert.deepEqual(toSnapshot(st, 0).sessions[0].connectors, []);
  hook(st, 'PreToolUse', { tool_name: 'mcp__claude_ai_Microsoft_365__teams_list_chats', tool_use_id: 'm1' }, 1000);
  hook(st, 'PostToolUse', { tool_name: 'mcp__claude_ai_Microsoft_365__teams_list_chats', tool_use_id: 'm1' }, 1900);
  hook(st, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'b1', label: 'ls' }, 2000);
  hook(st, 'SubagentStart', { agent_id: 'A', agent_type: 'Explore' }, 2100);
  hook(st, 'PreToolUse', { agent_id: 'A', agent_type: 'Explore', tool_name: 'mcp__claude_ai_Gmail__search_threads', tool_use_id: 'g0' }, 2200);
  hook(st, 'PreToolUse', { tool_name: 'mcp__claude_ai_Gmail__search_threads', tool_use_id: 'g1' }, 3000);
  hook(st, 'PreToolUse', { tool_name: 'mcp__claude_ai_Gmail__get_thread', tool_use_id: 'g2' }, 4000);
  hook(st, 'PreToolUse', { tool_name: 'mcp__claude_ai_Notion__notion-search', tool_use_id: 'n1' }, 5000);
  assert.deepEqual(toSnapshot(st, 0).sessions[0].connectors, [
    { server: 'claude_ai_Microsoft_365', tool: 'teams_list_chats', at: 1000 },
    { server: 'claude_ai_Gmail', tool: 'get_thread', at: 4000 },
    { server: 'claude_ai_Notion', tool: 'notion-search', at: 5000 },
  ]);
});

test('connectors: double underscores split server and tool; a late line with an older ts does not take `at` back; malformed names are skipped', () => {
  const st = emptyState();
  hook(st, 'SessionStart', {}, 0);
  hook(st, 'PreToolUse', { tool_name: 'mcp__plugin_x_y__a__b', tool_use_id: 'p1' }, 3000);
  hook(st, 'PreToolUse', { tool_name: 'mcp__plugin_x_y__older', tool_use_id: 'p2' }, 2000);
  for (const name of ['mcp__', 'mcp__only', 'mcp____tool', 'notmcp__s__t']) hook(st, 'PreToolUse', { tool_name: name, tool_use_id: name }, 4000);
  assert.deepEqual(toSnapshot(st, 0).sessions[0].connectors, [{ server: 'plugin_x_y', tool: 'a__b', at: 3000 }]);
});
