import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertKeys, newAlerts, titleFor } from '../../web/src/logic/alerts.ts';
import { agent, session, snap } from './fake.ts';

const floor = (sid: string, id: string, alert: boolean) => session({
  sid, waitingCount: alert ? 1 : 0,
  agents: [agent({ id, label: 'run tests', stage: alert ? 'waiting' : 'running', alert, reasons: alert ? [{ kind: 'permission', tool: 'Bash', label: 'npm test' }] : [] })],
});

test('newAlerts: the first snapshot after a load notifies nothing', () => {
  assert.deepEqual(newAlerts(null, snap([floor('s1', 'a1', true)])), []);
});

test('newAlerts: once per entry into waiting, again after a re-entry', () => {
  const calm = snap([floor('s1', 'a1', false)]);
  const waiting = snap([floor('s1', 'a1', true)]);
  assert.deepEqual(newAlerts(alertKeys(calm), waiting).map(a => [a.key, a.label, a.reason, a.project]),
    [['s1/a1', 'run tests', 'permission: Bash npm test', 'proj']]);
  assert.deepEqual(newAlerts(alertKeys(waiting), waiting), []);
  assert.equal(newAlerts(alertKeys(calm), waiting).length, 1); // it calmed down, now it waits again
});

test('newAlerts: main waiting on two floors are two alerts', () => {
  const two = snap([floor('s1', 'main', true), floor('s2', 'main', true)]);
  assert.deepEqual(newAlerts(new Set(), two).map(a => a.key), ['s1/main', 's2/main']);
});

test('alertKeys: an alert\'s key is its spawn key, the one a pick selects', () => {
  const s = snap([session({ agents: [agent({ id: 'A1', key: 'toolu_1', stage: 'waiting', alert: true })] })]);
  assert.deepEqual([...alertKeys(s)], ['s1/toolu_1']);
});
test('titleFor: (n) prefix only while someone waits', () => {
  assert.equal(titleFor(0), 'foreman-vision');
  assert.equal(titleFor(3), '(3) foreman-vision');
});
