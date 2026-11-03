import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamScenario } from '../src/scenario.ts';

test('teamScenario: one foreman floor with 14 sub-agent starts by type', () => {
  const floors = teamScenario();
  assert.equal(floors.length, 1);
  const [f] = floors;
  assert.deepEqual([f.sid, f.cwd, f.foreman], ['sim-team', '/w/foreman-vision', true]);
  const starts = f.lines.filter(l => l.event === 'SubagentStart');
  assert.equal(starts.length, 14);
  const count = (p: (t: string) => boolean) => starts.filter(l => p(l.payload.agent_type ?? '')).length;
  assert.equal(count(t => t.startsWith('marketing:')), 5);
  assert.equal(count(t => t.startsWith('caveman:')), 3);
  assert.equal(count(t => t === 'general-purpose'), 3);
  assert.equal(count(t => t === 'Explore'), 2);
  assert.equal(count(t => t === 'claude'), 1);
  // the late marketing:seo comes at 50 s
  assert.deepEqual(starts.filter(l => l.at === 50_000).map(l => l.payload.agent_type), ['marketing:seo']);
});
