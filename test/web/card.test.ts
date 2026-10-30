import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TermLine } from '../../shared/types.ts';
import { termItems } from '../../web/src/logic/blocks.ts';
import { lastCalls, statusPill, took } from '../../web/src/logic/card.ts';
import { agent, inLang } from './fake.ts';

test('lastCalls: running calls each a row with a live time, else the last finished one with ✓/✗ and its result from the terminal; the target CLI-short, a missing label from the terminal', () => {
  const items = termItems([{ kind: 'tool', name: 'Bash', text: 'npm test', id: 'b1' }, { kind: 'out', text: 'ℹ pass 3', id: 'b1' },
    { kind: 'tool', name: 'AskUserQuestion', text: 'Which color?', id: 'q1' }] as TermLine[]);
  const runs = [{ id: 'r1', name: 'Read', label: 'C:\\w\\fv\\web\\a.ts', at: 10_000 }, { id: 'r2', name: 'Read', label: 'b.ts', at: 11_000 }];
  const done = { id: 'b1', name: 'Bash', label: 'npm test', at: 1000, ms: 3400, ok: true };
  assert.deepEqual(lastCalls(agent({ activeTools: runs, recentTools: [done] }), items, 22_000, 'C:\\w\\fv'), [
    { id: 'r1', name: 'Read', target: 'web/a.ts', state: 'run', ms: 12_000, result: null },
    { id: 'r2', name: 'Read', target: 'b.ts', state: 'run', ms: 11_000, result: null }]);
  assert.deepEqual(lastCalls(agent({ recentTools: [done] }), items, 22_000, null), [{ id: 'b1', name: 'Bash', target: 'npm test', state: 'ok', ms: 3400, result: 'ℹ pass 3' }]);
  assert.equal(lastCalls(agent({ recentTools: [{ ...done, ok: false }] }), items, 0, null)[0].state, 'bad');
  assert.equal(lastCalls(agent({ activeTools: [{ id: 'q1', name: 'AskUserQuestion', label: null, at: 0 }] }), items, 1000, null)[0].target, 'Which color?');
  assert.deepEqual(lastCalls(agent(), [], 0, null), []);
});
test('took: one decimal under a minute in the language, then minutes', () => {
  assert.deepEqual([took(3400), took(100), took(65_000), inLang('tr', () => took(3400))], ['3.4 s', '0.1 s', '1 min 5 s', '3,4 sn']);
});
test('statusPill: waiting on the user is ⏳, its reason and the wait so far; otherwise the stage and its current run', () => {
  assert.deepEqual(statusPill(agent({ stage: 'waiting', alert: true, reasons: [{ kind: 'question' }], stageSince: 10_000 }), 52_000), { text: '⏳ question · 42 s', wait: true });
  assert.deepEqual(inLang('tr', () => statusPill(agent({ stage: 'running', activeSince: 1000 }), 13_000)), { text: 'çalışıyor · 12 sn', wait: false });
});
