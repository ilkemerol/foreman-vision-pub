import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentView, Stage } from '../../shared/types.ts';
import { applyHold, MIN_STAGE_MS, type Held } from '../../web/src/logic/hold.ts';
import { agent, session, snap } from './fake.ts';

const at = (stage: Stage, alert = false) => snap([session({ agents: [agent({ id: 'a1', stage, alert })] })]);
const stageOf = (r: ReturnType<typeof applyHold>) => r.snap.sessions[0].agents[0].stage;

test('applyHold: a new stage waits until the old one was shown MIN_STAGE_MS; the latest stage wins', () => {
  const held: Held = new Map();
  let r = applyHold(held, at('spawning'), 0);
  assert.equal(stageOf(r), 'spawning');
  assert.equal(r.nextAt, null);
  r = applyHold(held, at('running'), 400);
  assert.equal(stageOf(r), 'spawning');
  assert.equal(r.nextAt, MIN_STAGE_MS);
  r = applyHold(held, at('done'), 900);
  assert.equal(stageOf(r), 'spawning');
  r = applyHold(held, at('done'), MIN_STAGE_MS);
  assert.equal(stageOf(r), 'done');
  assert.equal(r.nextAt, null);
});

test('applyHold: a held stage keeps its badges, so a stale-board done stays one', () => {
  const held: Held = new Map(), one = (o: Partial<AgentView>) => snap([session({ agents: [agent({ id: 'a1', ...o })] })]);
  applyHold(held, one({ stage: 'done', badges: ['stale-board'] }), 0);
  const a = applyHold(held, one({ stage: 'verifying' }), 500).snap.sessions[0].agents[0];
  assert.deepEqual([a.stage, a.badges], ['done', ['stale-board']]);
});

test('applyHold: an alerting wait shows at once', () => {
  const held: Held = new Map();
  applyHold(held, at('running'), 0);
  const r = applyHold(held, at('waiting', true), 100);
  assert.equal(stageOf(r), 'waiting');
  assert.equal(r.nextAt, null);
});

test('applyHold: keys main per floor and forgets agents that vanished', () => {
  const held: Held = new Map();
  applyHold(held, snap([
    session({ sid: 's1', agents: [agent({ id: 'main', stage: 'idle' })] }),
    session({ sid: 's2', agents: [agent({ id: 'main', stage: 'running' })] }),
  ]), 0);
  const r = applyHold(held, snap([session({ sid: 's1', agents: [agent({ id: 'main', stage: 'running' })] })]), 100);
  assert.equal(r.snap.sessions[0].agents[0].stage, 'idle');
  assert.deepEqual([...held.keys()], ['s1/main']);
});
test('applyHold: a pending agent\'s stage hold carries over when it binds to its agent id (the spawn key)', () => {
  const held: Held = new Map(), T = 'toolu_1';
  applyHold(held, snap([session({ agents: [agent({ id: 'pending:' + T, key: T, stage: 'spawning' })] })]), 0);
  const r = applyHold(held, snap([session({ agents: [agent({ id: 'A1', key: T, stage: 'running' })] })]), 1000);
  assert.equal(r.snap.sessions[0].agents[0].stage, 'spawning');
  assert.equal(r.nextAt, MIN_STAGE_MS);
});
