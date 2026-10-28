import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACT_MS, BURST, IDLE_EVERY, idleAct } from '../../web/src/logic/idle.ts';

const IDS = Array.from({ length: 40 }, (_, i) => `agent-${i}`);
const H = 3_600_000;   // an hour, at 100 ms

test('idleAct: a pure function of the id and the time', () => {
  for (const id of IDS.slice(0, 5)) for (let t = 0; t < 120_000; t += 250) assert.deepEqual(idleAct(id, 'worker', t), idleAct(id, 'worker', t));
});

test('idleAct: about one stretch or sip per 30 s per agent, each its full length, never two at once in a cycle', () => {
  for (const id of IDS) {
    let n = 0, prev = null as string | null;
    for (let t = 0; t < H; t += 100) {
      const a = idleAct(id, 'worker', t), k = a && a.kind !== 'pause' ? a.kind : null;
      if (k && k !== prev) { n++; assert.ok(a!.dur === ACT_MS[k as keyof typeof ACT_MS] && a!.t >= 0 && a!.t < a!.dur); }
      prev = k;
    }
    assert.ok(Math.abs(n - H / IDLE_EVERY) <= 2, `${id}: ${n} actions in an hour`);
  }
});

test('idleAct: a worker pauses typing 0.6–1.4 s once per 8 s window (a stretch or sip may take its place)', () => {
  for (const id of IDS.slice(0, 8)) {
    let pauses = 0, prev = false;
    for (let t = 0; t < 10 * BURST * 10; t += 50) {
      const a = idleAct(id, 'worker', t), p = a?.kind === 'pause';
      if (p) assert.ok(a!.dur >= 600 && a!.dur < 1400);
      if (p && !prev) pauses++;
      prev = p;
    }
    assert.ok(pauses >= 88 && pauses <= 101, `${id}: ${pauses}`);
  }
});

test('idleAct: workers stretch and sip; an idle foreman also looks round; a working one never does; nothing when calm', () => {
  const kinds = (role: 'worker' | 'foreman' | 'foremanBusy') => new Set(IDS.flatMap(id => Array.from({ length: H / 500 }, (_, i) => idleAct(id, role, i * 500)?.kind).filter(Boolean)));
  assert.deepEqual([...kinds('worker')].sort(), ['pause', 'sip', 'stretch']);
  assert.deepEqual([...kinds('foreman')].sort(), ['lookL', 'lookR', 'sip', 'stretch']);
  assert.deepEqual([...kinds('foremanBusy')].sort(), ['sip', 'stretch']);
  for (let t = 0; t < 120_000; t += 100) assert.equal(idleAct('agent-1', 'worker', t, true), null);
});

test('idleAct: two agents rarely move at the same moment (out of step by their hash)', () => {
  let both = 0, one = 0;
  for (let t = 0; t < H; t += 100) {
    const a = idleAct('agent-1', 'worker', t)?.kind, b = idleAct('agent-2', 'worker', t)?.kind;
    const x = !!a && a !== 'pause', y = !!b && b !== 'pause';
    if (x && y) both++; if (x || y) one++;
  }
  assert.ok(both < one * 0.2, `${both} of ${one}`);
});
