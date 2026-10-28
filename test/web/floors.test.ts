import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeShift, byFloor, floorCounts, floorTitle, newFloors, numberFloors, passedFloors, pickFloor, urlFloor, waitPill } from '../../web/src/logic/floors.ts';
import { agent, inLang, session } from './fake.ts';

test('numberFloors: contiguous by age (sids oldest first), a gone floor drops the ones above, a re-shown one takes its age slot', () => {
  assert.deepEqual(numberFloors(['a', 'b', 'c']), { a: 1, b: 2, c: 3 });
  assert.deepEqual(numberFloors(['a', 'c']), { a: 1, c: 2 });             // F2 gone: F3 becomes F2
  assert.deepEqual(numberFloors(['a', 'b', 'c', 'd']), { a: 1, b: 2, c: 3, d: 4 });   // b back between a and c
  assert.deepEqual(numberFloors([]), {});
});

test('byFloor: bottom to top by F, which is age order', () => {
  const numbers = numberFloors(['a', 'b', 'c']);
  assert.deepEqual(byFloor(['c', 'a', 'b'].map(sid => session({ sid })), numbers).map(s => s.sid), ['a', 'b', 'c']);
});

test('badgeShift: only a known floor whose number changed shifts, in the direction it moved', () => {
  assert.equal(badgeShift(undefined, 3), null);   // first appearance
  assert.equal(badgeShift(3, 3), null);
  assert.equal(badgeShift(3, 2), 'down');
  assert.equal(badgeShift(2, 3), 'up');
});

test('passedFloors: the floors between, in passing order; a gap in F is no floor', () => {
  const n = { a: 1, b: 2, c: 3, d: 5 };
  assert.deepEqual(passedFloors(n, 'a', 'd'), [2, 3]);
  assert.deepEqual(passedFloors(n, 'd', 'a'), [3, 2]);
  assert.deepEqual(passedFloors(n, 'c', 'd'), []);   // no F4
  assert.deepEqual(passedFloors(n, 'a', 'b'), []);
  assert.deepEqual(passedFloors(n, 'gone', 'd'), []);
});

test('pickFloor: the saved floor, else the newest, else none', () => {
  const ss = [session({ sid: 'old' }), session({ sid: 'new' })];
  assert.equal(pickFloor(ss, 'old'), 'old');
  assert.equal(pickFloor(ss, 'gone'), 'new');
  assert.equal(pickFloor(ss, null), 'new');
  assert.equal(pickFloor([], 'old'), null);
});

test('urlFloor: ?session=<sid> once the session is in the snapshot, else none', () => {
  const ss = [session({ sid: 'a' }), session({ sid: 'b' })];
  assert.equal(urlFloor('?session=a', ss), 'a');
  assert.equal(urlFloor('?x=1&session=b', ss), 'b');
  assert.equal(urlFloor('?session=c', ss), null); // not here yet: the caller retries on the next snapshot
  assert.equal(urlFloor('?session=a', []), null);
  assert.equal(urlFloor('', ss), null);
  assert.equal(urlFloor('?session=', ss), null);
});

test('floorCounts: working, waiting (alert pulses), done', () => {
  const c = floorCounts(session({ agents: [agent({ id: 'r', stage: 'running' }), agent({ id: 'v', stage: 'verifying' }),
    agent({ id: 'w', stage: 'waiting', alert: true }), agent({ id: 'board:1', role: 'placeholder', stage: 'waiting' }),
    agent({ id: 'd', stage: 'done' }), agent({ id: 'f', stage: 'failed' })] }));
  assert.deepEqual(c, { run: 2, wait: 2, done: 1, alert: true });
  assert.equal(waitPill(c), '2 waiting');
  assert.equal(waitPill({ run: 0, wait: 0, done: 0, alert: false }), 'none waiting');
  assert.equal(inLang('tr', () => waitPill(c)), '2 bekliyor');
  assert.equal(inLang('tr', () => waitPill({ run: 0, wait: 0, done: 0, alert: false })), 'bekleyen yok');
});

test('newFloors: nothing is new on the first snapshot, a later sid is; floorTitle', () => {
  assert.deepEqual(newFloors(null, [session({ sid: 'a' })]), []);
  assert.deepEqual(newFloors(new Set(['a']), [session({ sid: 'a' }), session({ sid: 'b' })]), ['b']);
  assert.equal(floorTitle(2, session({ sid: '181298ef-xyz', project: 'foreman-vision', foreman: 'on' })), 'F2 · foreman-vision · 181298ef · foreman');
  assert.equal(floorTitle(1, session({ sid: 'b0c53c4e-1', project: 'notes' })), 'F1 · notes · b0c53c4e');
});

test('floorTitle: F in English, K in Turkish', () => {
  const s = session({ sid: 'abcdef123456', project: 'proj', foreman: 'on' });
  assert.equal(floorTitle(3, s), 'F3 · proj · abcdef12 · foreman');
  assert.equal(inLang('tr', () => floorTitle(3, s)), 'K3 · proj · abcdef12 · foreman');
});
