import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answersOf, askOf, decision, stillOpen } from '../src/ask.ts';
import { emptyState, reduce } from '../src/reducer.ts';
import { A, hook, hookIn, input, Q } from './helpers.ts';

test('askOf: main\'s AskUserQuestion PermissionRequest with its questions; a sub-agent, another tool or event, 0 or 5 questions, a repeated text, an option without a label is none', () => {
  assert.deepEqual(askOf(hookIn()), { sid: 's1', input, questions: Q });
  const bare = { questions: [{ question: 'q', options: [{ label: 'x' }] }] };
  assert.deepEqual(askOf(hookIn({ tool_input: bare }))!.questions, [{ question: 'q', options: [{ label: 'x' }], multiSelect: false }]);
  const five = Array.from({ length: 5 }, (_, i) => ({ ...Q[0], question: `q${i}` }));
  for (const bad of [hookIn({ agent_id: 'a1' }), hookIn({ tool_name: 'Bash' }), hookIn({ hook_event_name: 'PreToolUse' }), hookIn({ session_id: 7 }),
    hookIn({ tool_input: { questions: [] } }), hookIn({ tool_input: { questions: five } }), hookIn({ tool_input: { questions: [Q[0], Q[0]] } }),
    hookIn({ tool_input: { questions: [{ ...Q[0], options: [{ description: 'x' }] }] } }), null, 'x', []])
    assert.equal(askOf(bad), null, JSON.stringify(bad));
});

test('answersOf: exactly one non-empty answer of at most 4000 chars per question text', () => {
  assert.deepEqual(answersOf(Q, { answers: A }), A);
  for (const answers of [{ 'Which color?': 'Blue' }, { ...A, 'Which ones?': '  ' }, { ...A, x: 'y' }, { ...A, 'Which color?': 'x'.repeat(4001) }, { ...A, 'Which color?': 1 }])
    assert.equal(answersOf(Q, { answers }), null, JSON.stringify(answers));
  assert.equal(answersOf(Q, null), null);
});

test('decision: allow, the tool input echoed whole with the answers added', () => {
  assert.deepEqual(JSON.parse(decision(input, A)), { hookSpecificOutput: { hookEventName: 'PermissionRequest',
    decision: { behavior: 'allow', updatedInput: { questions: Q, metadata: { source: 'x' }, answers: A } } } });
});

test('stillOpen: a foreman session\'s main inside its AskUserQuestion; foreman off, ended, no such call, or out of its question wait once seen is closed', () => {
  const st = emptyState();
  hook(st, 'SessionStart');
  reduce(st, { kind: 'board', sid: 's1', foreman: 'on', rows: [] });
  const s = () => st.sessions.get('s1');
  let p = { waited: false };
  assert.equal(stillOpen(p, s()), false);                                      // no AskUserQuestion yet
  hook(st, 'PreToolUse', { agent_id: 'a1', agent_type: 'Explore', tool_name: 'AskUserQuestion', tool_use_id: 'x' });
  assert.equal(stillOpen(p, s()), false);                                      // a sub-agent's does not count
  hook(st, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q1' });
  assert.equal(stillOpen(p, s()), true);                                       // its PermissionRequest line may come after the hook's ask
  hook(st, 'PermissionRequest', { tool_name: 'AskUserQuestion' });
  assert.deepEqual([stillOpen(p, s()), p.waited], [true, true]);
  reduce(st, { kind: 'board', sid: 's1', foreman: 'off', rows: [] });
  assert.equal(stillOpen(p, s()), false);
  reduce(st, { kind: 'board', sid: 's1', foreman: 'task', rows: [] });
  assert.equal(stillOpen(p, s()), true);
  hook(st, 'UserPromptSubmit');                                                // Esc, then a new prompt: the call stays, the wait is over
  assert.equal(stillOpen(p, s()), false);
  p = { waited: false };
  hook(st, 'PostToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q1' }); // answered in the terminal
  assert.equal(stillOpen(p, s()), false);
  hook(st, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q2' });
  hook(st, 'SessionEnd');
  assert.equal(stillOpen(p, s()), false);
  assert.equal(stillOpen(p, undefined), false);
});

test('stillOpen: the permission_prompt Notification Claude Code sends ~6 s into the open dialog keeps it open, before or after its PermissionRequest line', () => {
  for (const notifyFirst of [false, true]) {
    const st = emptyState();
    hook(st, 'SessionStart');
    reduce(st, { kind: 'board', sid: 's1', foreman: 'on', rows: [] });
    const s = () => st.sessions.get('s1');
    const p = { waited: false };
    const notify = () => hook(st, 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' });
    hook(st, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q1' });
    if (notifyFirst) { notify(); assert.equal(stillOpen(p, s()), true); }
    hook(st, 'PermissionRequest', { tool_name: 'AskUserQuestion' });
    assert.equal(stillOpen(p, s()), true);
    if (!notifyFirst) { notify(); assert.equal(stillOpen(p, s()), true); }
    assert.equal(p.waited, true, String(notifyFirst));
    hook(st, 'Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
    assert.equal(st.sessions.get('s1')!.agents.get('main')!.waitReason?.kind, 'notification');   // the reason changed, the wait did not
    assert.equal(stillOpen(p, s()), true);
  }
});

test('stillOpen: an older AskUserQuestion cancelled with Esc (still in activeTools) does not keep a later question open once that one is answered', () => {
  const st = emptyState();
  hook(st, 'SessionStart');
  reduce(st, { kind: 'board', sid: 's1', foreman: 'on', rows: [] });
  const s = () => st.sessions.get('s1');
  hook(st, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q1' });   // Esc: no PostToolUse ever comes
  hook(st, 'UserPromptSubmit');
  hook(st, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q2' });
  const p: { waited: boolean; tool?: string } = { waited: false };
  assert.deepEqual([stillOpen(p, s()), p.tool], [true, 'q2']);
  hook(st, 'PostToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q2' });  // answered in the terminal before its wait was seen
  assert.deepEqual(s()!.agents.get('main')!.activeTools.map(t => t.id), ['q1']);
  assert.equal(stillOpen(p, s()), false);
});
