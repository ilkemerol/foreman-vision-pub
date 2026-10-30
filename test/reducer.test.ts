import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, reduce } from '../src/reducer.ts';
import { toSnapshot } from '../src/view.ts';
import { whyText } from '../web/src/logic/i18n.ts';
import { agentOf as agent, hook } from './helpers.ts';
import { inLang } from './web/fake.ts';

test('main: prompt → running, Stop → idle, idle_prompt → waiting with alert', () => {
  const st = emptyState();
  hook(st, 'SessionStart', { cwd: '/w/proj', source: 'startup' });
  const main = () => agent(st, 'main');
  assert.equal(main().hook, 'idle');
  assert.equal(st.sessions.get('s1')!.cwd, '/w/proj');
  hook(st, 'UserPromptSubmit');
  assert.equal(main().hook, 'running');
  hook(st, 'Stop');
  assert.deepEqual([main().hook, main().alert], ['idle', false]);
  hook(st, 'Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
  assert.deepEqual([main().hook, main().alert, main().waitReason], ['waiting', true, { kind: 'notification', text: 'Claude is waiting for your input' }]);
});

test('Agent call: pending until SubagentStart, then bound by meta toolUseId', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T1', label: 'read', subagent_type: 'Explore' });
  assert.deepEqual([agent(st, 'pending:T1').hook, agent(st, 'pending:T1').parentId], ['spawning', 'main']);
  hook(st, 'SubagentStart', { agent_id: 'A1', agent_type: 'Explore' });
  reduce(st, { kind: 'bind', sid: 's1', toolUseId: 'T1', agentId: 'A1' });
  const a = agent(st, 'A1');
  assert.deepEqual([a.hook, a.description, a.parentId, a.toolUseId, a.type], ['running', 'read', 'main', 'T1', 'Explore']);
  assert.equal(st.sessions.get('s1')!.agents.has('pending:T1'), false);
});

test('PostToolUse(Agent) agentId binds when meta.json is missing', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T1', label: 'background' });
  hook(st, 'SubagentStart', { agent_id: 'A1' });
  hook(st, 'PostToolUse', { tool_name: 'Agent', tool_use_id: 'T1', response_agent_id: 'A1' });
  assert.equal(agent(st, 'A1').description, 'background');
  assert.equal(st.sessions.get('s1')!.agents.has('pending:T1'), false);
});

test('a bind that arrives before SubagentStart is applied when the agent appears', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T1', label: 'early' });
  reduce(st, { kind: 'bind', sid: 's1', toolUseId: 'T1', agentId: 'A1' });
  hook(st, 'SubagentStart', { agent_id: 'A1' });
  assert.equal(agent(st, 'A1').description, 'early');
});

test('parallel Agent calls bind to the right agents', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T1', label: 'one' });
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T2', label: 'two' });
  hook(st, 'SubagentStart', { agent_id: 'A2' });
  hook(st, 'SubagentStart', { agent_id: 'A1' });
  reduce(st, { kind: 'bind', sid: 's1', toolUseId: 'T2', agentId: 'A2' });
  reduce(st, { kind: 'bind', sid: 's1', toolUseId: 'T1', agentId: 'A1' });
  assert.equal(agent(st, 'A1').description, 'one');
  assert.equal(agent(st, 'A2').description, 'two');
});

test('tool calls: active while running, then the newest 5 in recentTools', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1' });
  hook(st, 'PreToolUse', { agent_id: 'A1', tool_name: 'Bash', tool_use_id: 't1', label: 'npm test' }, 5000);
  assert.deepEqual(agent(st, 'A1').activeTools.map(t => t.label), ['npm test']);
  assert.deepEqual(agent(st, 'A1').activeTools, [{ id: 't1', name: 'Bash', label: 'npm test', at: 5000 }]);
  hook(st, 'PostToolUse', { agent_id: 'A1', tool_name: 'Bash', tool_use_id: 't1' }, 5400);
  assert.deepEqual(agent(st, 'A1').activeTools, []);
  assert.deepEqual(agent(st, 'A1').recentTools[0], { id: 't1', name: 'Bash', label: 'npm test', at: 5000, ms: 400, ok: true });
  for (let i = 0; i < 6; i++) {
    hook(st, 'PreToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r' + i });
    hook(st, 'PostToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r' + i });
  }
  assert.equal(agent(st, 'A1').recentTools.length, 5);
});

test('permission prompt: waiting with alert until the tool runs', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1' });
  hook(st, 'PreToolUse', { agent_id: 'A1', tool_name: 'Bash', tool_use_id: 't1' });
  hook(st, 'Notification', { agent_id: 'A1', notification_type: 'permission_prompt', message: 'allow?' });
  assert.deepEqual([agent(st, 'A1').hook, agent(st, 'A1').alert], ['waiting', true]);
  hook(st, 'PostToolUse', { agent_id: 'A1', tool_name: 'Bash', tool_use_id: 't1' });
  assert.deepEqual([agent(st, 'A1').hook, agent(st, 'A1').alert], ['running', false]);
});

test('SubagentStop stops; SessionEnd abandons the rest and ends the session', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1' });
  hook(st, 'SubagentStart', { agent_id: 'A2' });
  hook(st, 'SubagentStop', { agent_id: 'A1' }, 9000);
  assert.deepEqual([agent(st, 'A1').hook, agent(st, 'A1').endedAt], ['stopped', 9000]);
  hook(st, 'UserPromptSubmit');
  hook(st, 'SessionEnd', { reason: 'prompt_input_exit' });
  assert.equal(st.sessions.get('s1')!.ended, true);
  assert.equal(agent(st, 'A1').hook, 'stopped');
  assert.equal(agent(st, 'A2').hook, 'abandoned');
  assert.equal(agent(st, 'main').hook, 'idle');
});

test('old Task tool name spawns too; nested calls get the calling agent as parent', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'Task', tool_use_id: 'T1' });
  assert.ok(st.sessions.get('s1')!.agents.has('pending:T1'));
  hook(st, 'SubagentStart', { agent_id: 'A1' });
  hook(st, 'PreToolUse', { agent_id: 'A1', tool_name: 'Agent', tool_use_id: 'T2' });
  assert.equal(agent(st, 'pending:T2').parentId, 'A1');
});

test('events from an agent without SubagentStart (Workflow) create it', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { agent_id: 'W1', agent_type: 'workflow-step', tool_name: 'Read', tool_use_id: 'r1' });
  assert.deepEqual([agent(st, 'W1').hook, agent(st, 'W1').type, agent(st, 'W1').parentId], ['running', 'workflow-step', 'main']);
});

test('a SubagentStop without SubagentStart (side fork, empty agent_type) creates no agent', () => {
  const st = emptyState();
  hook(st, 'SubagentStop', { agent_id: 'F1', agent_type: '' }, 7000);
  assert.deepEqual([...st.sessions.get('s1')!.agents.keys()], ['main']);
});

test('an agent_id no subagent owns (side fork: no SubagentStart, no agent_type, no binding) creates no agent and leaves main alone', () => {
  const st = emptyState();
  hook(st, 'UserPromptSubmit');
  hook(st, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 't1' });
  hook(st, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 't1' });
  hook(st, 'Stop');
  // a recorded session: a lone PreToolUse with no PostToolUse, then a SubagentStop with agent_type ""
  hook(st, 'PreToolUse', { agent_id: 'G1', tool_name: 'AskUserQuestion', tool_use_id: 'g1' });
  hook(st, 'SubagentStop', { agent_id: 'G1', agent_type: '' });
  hook(st, 'PreToolUse', { agent_id: 'G2', tool_name: 'Bash', tool_use_id: 'g2' });
  hook(st, 'PermissionRequest', { agent_id: 'G2', tool_name: 'Bash' });
  const s = st.sessions.get('s1')!;
  assert.deepEqual([...s.agents.keys()], ['main']);
  assert.deepEqual([agent(st, 'main').hook, agent(st, 'main').activeTools], ['idle', []]);
  // an id the Agent call's response names is a real subagent even without agent_type
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T1', label: 'bg' });
  hook(st, 'PostToolUse', { tool_name: 'Agent', tool_use_id: 'T1', response_agent_id: 'A1' });
  hook(st, 'PreToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r1' });
  assert.deepEqual([agent(st, 'A1').description, agent(st, 'A1').activeTools.length], ['bg', 1]);
});

test('unknown events are counted and create nothing; other notifications are ignored', () => {
  const st = emptyState();
  hook(st, 'SomethingNew', { session_id: 's9' });
  assert.equal(st.unknownEvents, 1);
  assert.equal(st.sessions.has('s9'), false);
  hook(st, 'SessionStart');
  hook(st, 'Notification', { notification_type: 'auth_success' });
  assert.equal(agent(st, 'main').hook, 'idle');
});

test('tick: silence plus a still transcript abandons; a busy tool or a fresh transcript does not', () => {
  const st = emptyState();
  const MIN = 60_000;
  for (const id of ['A1', 'A2', 'A3']) hook(st, 'SubagentStart', { agent_id: id }, 0);
  hook(st, 'PreToolUse', { agent_id: 'A2', tool_name: 'Bash', tool_use_id: 'b' }, 0);
  hook(st, 'UserPromptSubmit', {}, 0);
  reduce(st, { kind: 'transcript', sid: 's1', agentId: 'A3', at: 9 * MIN, model: 'claude-opus-5-5', tokens: 40, context: null });
  reduce(st, { kind: 'tick', now: 11 * MIN, abandonMs: 10 * MIN });
  assert.deepEqual([agent(st, 'A1').hook, agent(st, 'A1').endedAt], ['abandoned', 10 * MIN]);   // when the silence passed the limit
  assert.equal(agent(st, 'A2').hook, 'running');
  assert.deepEqual([agent(st, 'A3').hook, agent(st, 'A3').model, agent(st, 'A3').tokens], ['running', 'claude-opus-5-5', 40]);
  assert.equal(agent(st, 'main').hook, 'running');
  hook(st, 'PreToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r' }, 12 * MIN);
  assert.deepEqual([agent(st, 'A1').hook, agent(st, 'A1').endedAt], ['running', null]);
});

test('transcript tokens: the latest total is set, not added; null keeps it', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1' }, 0);
  const tok = (tokens: number | null) => reduce(st, { kind: 'transcript', sid: 's1', agentId: 'A1', at: 0, model: null, tokens, context: null });
  tok(60_000);
  tok(20_000);
  assert.equal(agent(st, 'A1').tokens, 20_000);
  tok(null);
  assert.equal(agent(st, 'A1').tokens, 20_000);
});

test('a stopped agent resumed with the same agent_id (no SubagentStart) runs again with endedAt cleared', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1', agent_type: 'Explore' }, 1000);
  hook(st, 'SubagentStop', { agent_id: 'A1' }, 5000);
  assert.deepEqual([agent(st, 'A1').hook, agent(st, 'A1').endedAt], ['stopped', 5000]);
  hook(st, 'PreToolUse', { agent_id: 'A1', tool_name: 'Read', tool_use_id: 'r' }, 8000);
  assert.deepEqual([agent(st, 'A1').hook, agent(st, 'A1').endedAt, agent(st, 'A1').startedAt], ['running', null, 1000]);
  hook(st, 'SubagentStop', { agent_id: 'A1' }, 9000);
  assert.deepEqual([agent(st, 'A1').hook, agent(st, 'A1').endedAt], ['stopped', 9000]);
});

test('sessions are independent; drop removes one', () => {
  const st = emptyState();
  hook(st, 'SessionStart', { session_id: 'a', cwd: '/w/x' });
  hook(st, 'SessionStart', { session_id: 'b', cwd: '/w/x' });
  hook(st, 'SubagentStart', { session_id: 'b', agent_id: 'A1' });
  assert.equal(st.sessions.size, 2);
  assert.equal(st.sessions.get('a')!.agents.has('A1'), false);
  reduce(st, { kind: 'drop', sid: 'a' });
  assert.deepEqual([...st.sessions.keys()], ['b']);
});

test('a parallel tool finishing does not clear a permission alert for another tool', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'Read', tool_use_id: 'r1' });
  hook(st, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'b1' });
  hook(st, 'Notification', { notification_type: 'permission_prompt', message: 'allow?' });
  hook(st, 'PostToolUse', { tool_name: 'Read', tool_use_id: 'r1' });
  assert.deepEqual([agent(st, 'main').hook, agent(st, 'main').alert], ['waiting', true]);
  hook(st, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1' });
  assert.deepEqual([agent(st, 'main').hook, agent(st, 'main').alert], ['running', false]);
});

test('a late SubagentStop does not re-open an ended session; SessionStart does', () => {
  const st = emptyState();
  hook(st, 'SessionStart');
  hook(st, 'SubagentStart', { agent_id: 'L1' });
  hook(st, 'SessionEnd', { reason: 'other' });
  hook(st, 'SubagentStop', { agent_id: 'L1', agent_type: '' });
  assert.equal(st.sessions.get('s1')!.ended, true);
  assert.equal(agent(st, 'L1').hook, 'stopped');
  hook(st, 'SessionStart');
  assert.equal(st.sessions.get('s1')!.ended, false);
});

test('a Notification for a stopped agent is ignored', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1' });
  hook(st, 'SubagentStop', { agent_id: 'A1' });
  hook(st, 'Notification', { agent_id: 'A1', notification_type: 'permission_prompt' });
  assert.deepEqual([agent(st, 'A1').hook, agent(st, 'A1').alert], ['stopped', false]);
});

test('PostToolUseFailure ends the tool call like PostToolUse', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A1' });
  hook(st, 'PreToolUse', { agent_id: 'A1', tool_name: 'Bash', tool_use_id: 't1' });
  hook(st, 'PostToolUseFailure', { agent_id: 'A1', tool_name: 'Bash', tool_use_id: 't1' });
  assert.deepEqual(agent(st, 'A1').activeTools, []);
  assert.deepEqual([agent(st, 'A1').recentTools[0].name, agent(st, 'A1').recentTools[0].ok], ['Bash', false]);
  assert.equal(st.unknownEvents, 0);
});

test('a failed Agent call drops its pending agent', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'T9' });
  assert.ok(agent(st, 'pending:T9'));
  hook(st, 'PostToolUseFailure', { tool_name: 'Agent', tool_use_id: 'T9' });
  assert.equal(st.sessions.get('s1')!.agents.has('pending:T9'), false);
});

test('main: a failed tool plus the approved tool clear the permission alert', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 't1' });
  hook(st, 'PreToolUse', { tool_name: 'Write', tool_use_id: 't2' });
  hook(st, 'Notification', { notification_type: 'permission_prompt', message: 'allow?' });
  hook(st, 'PostToolUseFailure', { tool_name: 'Bash', tool_use_id: 't1' });
  hook(st, 'PostToolUse', { tool_name: 'Write', tool_use_id: 't2' });
  assert.deepEqual([agent(st, 'main').hook, agent(st, 'main').alert], ['running', false]);
});

test('PermissionRequest flags the asking subagent, the null-agent Notification is deduped, PostToolUse clears', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A', agent_type: 'general-purpose' });
  hook(st, 'PreToolUse', { agent_id: 'A', tool_name: 'Bash', tool_use_id: 'T1', label: 'npm test' });
  hook(st, 'PermissionRequest', { agent_id: 'A', tool_name: 'Bash', label: 'npm test' });
  const a = () => agent(st, 'A');
  assert.deepEqual([a().hook, a().alert, a().waitReason], ['waiting', true, { kind: 'permission', tool: 'Bash', label: 'npm test' }]);
  assert.deepEqual([agent(st, 'main').hook, agent(st, 'main').alert], ['idle', false]);
  hook(st, 'Notification', { notification_type: 'permission_prompt', message: 'needs permission' });
  assert.deepEqual([agent(st, 'main').hook, agent(st, 'main').alert], ['idle', false]);
  hook(st, 'PostToolUse', { agent_id: 'A', tool_name: 'Bash', tool_use_id: 'T1' });
  assert.deepEqual([a().hook, a().alert], ['running', false]);
});

test('main PermissionRequest waits until its PostToolUse', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'T1' });
  hook(st, 'PermissionRequest', { tool_name: 'Bash' });
  assert.deepEqual([agent(st, 'main').hook, agent(st, 'main').waitReason], ['waiting', { kind: 'permission', tool: 'Bash', label: null }]);
  hook(st, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'T1' });
  assert.equal(agent(st, 'main').hook, 'running');
});

test('AskUserQuestion PermissionRequest is a question, not a permission; its twin Notification is deduped, PostToolUse clears', () => {
  const st = emptyState();
  hook(st, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'Q1' });
  hook(st, 'PermissionRequest', { tool_name: 'AskUserQuestion' });
  hook(st, 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use AskUserQuestion' });
  const main = toSnapshot(st, 0).sessions[0].agents.find(a => a.id === 'main')!;
  assert.deepEqual([main.stage, main.alert, main.reasons], ['waiting', true, [{ kind: 'question' }]]);
  assert.equal(whyText(main), 'question');
  assert.equal(inLang('tr', () => whyText(main)), 'soru');
  hook(st, 'PostToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'Q1' });
  assert.deepEqual([agent(st, 'main').hook, agent(st, 'main').alert, agent(st, 'main').waitReason], ['running', false, null]);
});

test('permission_prompt Notification without any PermissionRequest still lands on main', () => {
  const st = emptyState();
  hook(st, 'Notification', { notification_type: 'permission_prompt', message: 'needs permission' });
  assert.deepEqual([agent(st, 'main').hook, agent(st, 'main').alert], ['waiting', true]);
});

test('Notification without a message: its type is the reason', () => {
  const st = emptyState();
  hook(st, 'Notification', { notification_type: 'idle_prompt' });
  assert.deepEqual(agent(st, 'main').waitReason, { kind: 'notification', text: 'idle_prompt' });
});

test('PermissionRequest from a stopped agent is ignored', () => {
  const st = emptyState();
  hook(st, 'SubagentStart', { agent_id: 'A' });
  hook(st, 'SubagentStop', { agent_id: 'A' });
  hook(st, 'PermissionRequest', { agent_id: 'A', tool_name: 'Bash' });
  assert.deepEqual([agent(st, 'A').hook, agent(st, 'A').alert], ['stopped', false]);
});

test('transcript context: main only; peak keeps the largest through a compact drop; null leaves it', () => {
  const st = emptyState();
  hook(st, 'SessionStart');
  const ctx = (agentId: string, used: number | null, peak = used) => reduce(st, { kind: 'transcript', sid: 's1', agentId, at: 0, model: null, tokens: null,
    context: used === null ? null : { used, peak: peak! } });
  assert.equal(st.sessions.get('s1')!.context, null);
  ctx('main', 120_000);
  ctx('main', 30_000);
  assert.deepEqual(st.sessions.get('s1')!.context, { used: 30_000, peak: 120_000 });
  hook(st, 'SubagentStart', { agent_id: 'A1' });
  ctx('A1', 190_000);
  ctx('main', null);
  assert.deepEqual(st.sessions.get('s1')!.context, { used: 30_000, peak: 120_000 });
  ctx('main', 40_000, 250_000);   // a restart reads a whole transcript at once: its own peak comes along
  assert.deepEqual(st.sessions.get('s1')!.context, { used: 40_000, peak: 250_000 });
});
