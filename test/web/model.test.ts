import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Stage } from '../../shared/types.ts';
import { agentKey, badgeText, colorOf, columnOf, duration, findAgent, hash, stretchStart, totalAlerts } from '../../web/src/logic/model.ts';
import { agent, inLang, session, snap } from './fake.ts';

test('columnOf: every stage has its Kanban column, idle main counts as working', () => {
  const want: Record<Stage, string> = {
    queued: 'queued', spawning: 'running', running: 'running', idle: 'running', waiting: 'waiting',
    verifying: 'verifying', done: 'finished', failed: 'finished', abandoned: 'finished',
  };
  for (const [s, c] of Object.entries(want)) assert.equal(columnOf(s as Stage), c);
});

test('colorOf: stable per key, different keys differ', () => {
  assert.equal(colorOf(agent({ id: 'a83a04044161979d3' })), colorOf(agent({ id: 'a83a04044161979d3' })));
  assert.equal(colorOf(agent({ id: 'a1' })), 'hsl(175 65% 55%)');
  assert.notEqual(colorOf(agent({ id: 'a1' })), colorOf(agent({ id: 'a2' })));
  assert.equal(hash('a1'), 472168615);
});
test('colorOf: a pending agent keeps its colour when it binds to its agent id', () => {
  const T = 'toolu_015NYHtJf9NTajJhraNy9fEp', A = 'abba4fd4d9458f4d6';   // one spawn from the real spool
  assert.notEqual(hash('pending:' + T) % 360, hash(A) % 360, 'the ids alone pick different colours');
  assert.equal(colorOf(agent({ id: A, key: T })), colorOf(agent({ id: 'pending:' + T, key: T, stage: 'spawning' })));
});

test('duration: running uses now, ended uses endedAt, a placeholder has none; in the language', () => {
  assert.equal(duration(agent({ startedAt: 1000, endedAt: null }), 6000), '5 s');
  assert.equal(duration(agent({ startedAt: 1000, endedAt: 126_000 }), 999_999), '2 min 5 s');
  assert.equal(duration(agent({ startedAt: 1000, endedAt: 1000 + 3_720_000 }), 0), '1 h 2 min');
  assert.equal(inLang('tr', () => duration(agent({ startedAt: 1000, endedAt: 126_000 }), 0)), '2 dk 5 sn');
  assert.equal(inLang('tr', () => duration(agent({ startedAt: 1000, endedAt: 1000 + 3_720_000 }), 0)), '1 sa 2 dk');
  assert.equal(duration(agent({ startedAt: 0 }), 5000), '—');
  assert.equal(duration(agent({ startedAt: 1000, stageSince: 4000 }), 6000, 4000), '2 s');
});

test('stretchStart: a working agent counts from when it last became active, anything else over its whole life', () => {
  assert.equal(stretchStart(agent({ stage: 'running', startedAt: 1000, stageSince: 50_000 })), 50_000); // back from waiting / resumed
  for (const stage of ['waiting', 'done', 'abandoned', 'spawning', 'idle'] as const)
    assert.equal(stretchStart(agent({ stage, startedAt: 1000, stageSince: 50_000, endedAt: stage === 'done' ? 60_000 : null })), 1000);
  // a stopped agent under the master's check: endedAt is before stageSince, so the stretch would go negative
  assert.equal(stretchStart(agent({ stage: 'verifying', startedAt: 1000, stageSince: 70_000, endedAt: 60_000 })), 1000);
  // ...unless it was resumed: then from its last start
  assert.equal(stretchStart(agent({ stage: 'verifying', startedAt: 1000, activeSince: 40_000, stageSince: 70_000, endedAt: 60_000 })), 40_000);
  assert.equal(stretchStart(agent({ stage: 'running', startedAt: 1000, stageSince: 0 })), 1000);
});

test('findAgent: main on two floors is two different agents', () => {
  const s = snap([
    session({ sid: 's1', agents: [agent({ id: 'main', label: 'one' })] }),
    session({ sid: 's2', agents: [agent({ id: 'main', label: 'iki' })] }),
  ]);
  assert.equal(findAgent(s, agentKey('s2', 'main'))?.a.label, 'iki');
  assert.equal(findAgent(s, agentKey('s1', 'main'))?.s.sid, 's1');
  assert.equal(findAgent(s, null), null);
  assert.equal(findAgent(s, agentKey('s3', 'main')), null);
});
test('findAgent: a pending agent picked before it binds stays picked once it has its agent id', () => {
  const T = 'toolu_015NYHtJf9NTajJhraNy9fEp', pending = agent({ id: 'pending:' + T, key: T, stage: 'spawning' });
  const picked = agentKey('s1', pending.key);   // what a click on the pending agent selects
  assert.equal(findAgent(snap([session({ agents: [pending] })]), picked)?.a.id, pending.id);
  assert.equal(findAgent(snap([session({ agents: [agent({ id: 'abba4fd4d9458f4d6', key: T })] })]), picked)?.a.id, 'abba4fd4d9458f4d6');
});

test('totalAlerts: sums waitingCount over floors', () => {
  assert.equal(totalAlerts(snap([session({ waitingCount: 2 }), session({ sid: 's2', waitingCount: 1 })])), 3);
});

test('badgeText: per badge, in the language of the moment (not frozen at import)', () => {
  assert.equal(badgeText('stale-board'), 'board out of date');
  assert.equal(inLang('tr', () => badgeText('stale-board')), 'board güncel değil');
  assert.equal(inLang('tr', () => badgeText('off-board')), 'board dışı');
  assert.equal(badgeText('off-board'), 'off board');
});
