import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.ts';
import { createEngine } from '../src/engine.ts';
import { loadFixture, place, sandbox } from '../src/simulate.ts';
import { toSnapshot } from '../src/view.ts';
import { emptyState, reduce } from '../src/reducer.ts';

const DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const FIXTURES = readdirSync(DIR).filter(f => f.endsWith('.jsonl')).map(f => join(DIR, f));

/** Replay fixtures as sessions sim0, sim1, ... into one engine, the way the hook would have written them. */
function replay(files: string[]) {
  const root = tempDir('fv-replay-');
  files.forEach((file, i) => {
    sandbox(root, `sim${i}`, file);
    for (const line of loadFixture(file)) place(root, `sim${i}`, line, line.ts + i);
  });
  const engine = createEngine({ spoolDir: join(root, 'spool'), stateDir: join(root, 'state') });
  engine.scan(Date.now());
  return toSnapshot(engine.state, Date.now());
}

for (const file of FIXTURES) {
  test(`fixture ${file.split(/[\\/]/).pop()}: replays cleanly, every Agent call bound`, () => {
    const snap = replay([file]);
    assert.equal(snap.unknownEvents, 0);
    assert.equal(snap.badLines, 0);
    const [s] = snap.sessions;
    assert.ok(s.ended, 'recorded sessions end with /exit');
    assert.deepEqual(s.agents.filter(a => a.id.startsWith('pending:')).map(a => a.label), []);
    for (const a of s.agents.filter(a => a.role === 'agent')) assert.ok(a.parentId, a.id);
  });
}

test('spike-foreman: a foreman floor with its three board jobs', () => {
  const [s] = replay([join(DIR, 'spike-foreman.jsonl')]).sessions;
  assert.equal(s.foreman, 'on');
  assert.equal(s.agents.find(a => a.id === 'main')!.role, 'foreman');
  const jobs = s.agents.filter(a => a.role === 'agent' && a.type !== 'unknown');
  assert.ok(jobs.length >= 3, `board jobs: ${jobs.map(a => a.label)}`);
});

test('spike-plain: Explore agent, two workflow agents; the forked-skill ghost is hidden', () => {
  const [s] = replay([join(DIR, 'spike-plain.jsonl')]).sessions;
  const types = s.agents.filter(a => a.role === 'agent').map(a => a.type).sort();
  assert.ok(types.includes('Explore'), `types: ${types}`);
  assert.equal(types.filter(t => t === 'workflow-subagent').length, 2, `types: ${types}`);
  assert.ok(!types.includes('unknown'), `types: ${types}`);
  assert.equal(s.foreman, 'off');
});

test('two fixtures replay as two floors, oldest first', () => {
  const snap = replay(FIXTURES);
  assert.equal(snap.sessions.length, FIXTURES.length);
  assert.ok(snap.sessions.every((s, i) => i === 0 || snap.sessions[i - 1].firstSeen <= s.firstSeen));
});

test('spike-permission: the subagent, not main, is flagged for its permission request', () => {
  const [s] = replay([join(DIR, 'spike-permission.jsonl')]).sessions;
  assert.equal(s.agents.find(a => a.id === 'main')!.stage, 'idle');
  const a = s.agents.find(a => a.id === 'ab2a7e56f751e0829')!;
  assert.deepEqual([a.stage, a.alert], ['done', false]);
  assert.equal(s.waitingCount, 0);

  const lines = loadFixture(join(DIR, 'spike-permission.jsonl'));
  const upto = lines.findIndex(l => l.event === 'Notification');
  const st = emptyState();
  lines.slice(0, upto + 1).forEach(line => reduce(st, { kind: 'hook', line }));
  const agents = st.sessions.values().next().value!.agents;
  assert.deepEqual([agents.get('ab2a7e56f751e0829')!.hook, agents.get('ab2a7e56f751e0829')!.alert], ['waiting', true]);
  assert.equal(agents.get('main')!.alert, false);
});
