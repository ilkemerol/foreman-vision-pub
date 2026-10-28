import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Snapshot } from '../shared/types.ts';
import { parseBoard } from '../src/board.ts';
import { emptyState, reduce } from '../src/reducer.ts';
import { hybridScenario } from '../src/scenario.ts';
import { toSnapshot } from '../src/view.ts';
import { ROOMS, roomOf } from '../web/src/logic/hybrid.ts';

/** The scenario as the engine sees it up to `t` (each floor in order; agents bind through PostToolUse's response_agent_id). */
function at(t: number): Snapshot {
  const st = emptyState();
  for (const f of hybridScenario()) for (const l of f.lines) {
    if (f.startAt + l.at > t) continue;
    if (l.event === '__board') reduce(st, { kind: 'board', sid: f.sid, foreman: 'on', rows: parseBoard(l.payload.text ?? '') });
    else reduce(st, { kind: 'hook', line: { ts: f.startAt + l.at, event: l.event, payload: { ...l.payload, session_id: f.sid, cwd: f.cwd } } });
  }
  return toSnapshot(st, t);
}
const floor = (s: Snapshot, sid: string) => s.sessions.find(x => x.sid === sid)!.agents;

test('hybridScenario: F1 has 22 sub-agents over the five stages, 9 of them children of sub-agents, all bound and on the board', () => {
  const k1 = floor(at(15_000), 'sim-hybrid-a'), subs = k1.filter(a => a.id !== 'main');
  assert.equal(subs.length, 22);
  assert.deepEqual(subs.filter(a => a.id.startsWith('pending:')).map(a => a.id), []);
  assert.deepEqual(subs.flatMap(a => a.badges), []);
  assert.deepEqual(ROOMS.map(r => subs.filter(a => roomOf(a.stage) === r.key).length), [2, 9, 3, 3, 5]);
  assert.equal(subs.filter(a => a.parentId !== 'main').length, 9);
  for (const a of subs) assert.ok(k1.some(p => p.id === a.parentId), a.id);
});

test('hybridScenario: the six stage moves between 20 and 70 s', () => {
  const jobs = ['new job', 'decision', 'test runner', 'schema audit', 'hook test', 'file scanner'];
  const stages = (t: number) => { const k1 = floor(at(t), 'sim-hybrid-a'); return jobs.map(j => k1.find(a => a.label === j)!.stage); };
  assert.deepEqual(stages(15_000), ['queued', 'waiting', 'running', 'verifying', 'running', 'running']);
  assert.deepEqual(stages(75_000), ['running', 'running', 'verifying', 'done', 'waiting', 'failed']);
});

test('hybridScenario: F2 has three agents, F3 26 finished of 30', () => {
  const s = at(15_000), c = floor(s, 'sim-hybrid-c');
  assert.equal(floor(s, 'sim-hybrid-b').length, 3);
  assert.deepEqual([c.length, c.filter(a => a.stage === 'done').length], [31, 26]);
});
