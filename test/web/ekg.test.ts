import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBeat, BEAT_GAP_MS, EKG_W, SCROLL_MS, tracePoints } from '../../web/src/logic/ekg.ts';

const pts = (s: string) => s.split(' ').map(p => p.split(',').map(Number));

test('addBeat: beats closer than BEAT_GAP_MS are dropped, so a burst makes one spike', () => {
  const beats: number[] = [];
  assert.equal(addBeat(beats, 1000), true);
  assert.equal(addBeat(beats, 1200), false);
  assert.equal(addBeat(beats, 1000 + BEAT_GAP_MS - 1), false);
  assert.equal(addBeat(beats, 1000 + BEAT_GAP_MS), true);
  assert.deepEqual(beats, [1000, 1000 + BEAT_GAP_MS]);
});

test('addBeat: beats that scrolled off the left edge are forgotten', () => {
  const beats = [0, 700];
  addBeat(beats, SCROLL_MS + 100);
  assert.deepEqual(beats, [700, SCROLL_MS + 100]);
});

test('tracePoints: no beats is a flat baseline across the whole width', () => {
  const p = pts(tracePoints([], 0));
  assert.equal(p.length, 2);
  assert.deepEqual([p[0][0], p[1][0]], [0, EKG_W]);
  assert.equal(p[0][1], p[1][1]);
});

test('tracePoints: a new beat ends at the right edge with a tall peak, then scrolls left and off', () => {
  const at = (now: number) => pts(tracePoints([0], now));
  const fresh = at(0), base = fresh[0][1];
  const peak = fresh.reduce((a, b) => (b[1] < a[1] ? b : a));
  assert.ok(base - peak[1] >= 6, 'peak rises well above the baseline');
  assert.ok(fresh.some(q => q[1] > base), 'it dips below the baseline');
  assert.ok(peak[0] > EKG_W - 6 && peak[0] < EKG_W);
  const half = at(SCROLL_MS / 2), halfPeak = half.reduce((a, b) => (b[1] < a[1] ? b : a));
  assert.ok(Math.abs(halfPeak[0] - (peak[0] - EKG_W / 2)) < 0.11, 'moved left by half the width');
  assert.equal(at(SCROLL_MS).length, 2, 'gone once it reaches the left edge');
});
