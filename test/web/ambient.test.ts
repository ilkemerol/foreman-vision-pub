import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BIRD_EVERY, birdsAt, clockHands, cloudsAt, LAMPS_AT, mix, phase, screenLines, SKY_W, starAt, SUN, swayDx } from '../../web/src/logic/ambient.ts';

const at = (m: number, d: number, h: number, min = 0) => new Date(2026, m, d, h, min);

test('phase: the same sunrise and sunset every day of the year', () => {
  for (let m = 0; m < 12; m++) for (const d of [1, 15, 28]) {
    const p = phase(at(m, d, 12));
    assert.deepEqual([p.rise, p.set], [...SUN]);
  }
});

test('phase: day 0, 0.15 at sunset, 1 from 45 min after it, the mirror at dawn; lamps from 0.35', () => {
  const [rise, set] = SUN, when = (h: number) => phase(at(9, 25, Math.floor(h), Math.round(h % 1 * 60)));
  assert.equal(when(12).dark, 0);
  assert.equal(when(set - 0.6).dark, 0);
  assert.ok(Math.abs(when(set).dark - 0.15) < 0.02);
  assert.equal(when(set + 0.76).dark, 1);
  assert.equal(when(23).dark, 1);
  assert.ok(Math.abs(when(rise + 0.25).dark - when(set - 0.25).dark) < 0.03);
  assert.equal(when(set + 0.1).lamps, false);
  assert.equal(when(set + 0.3).lamps, true);
  assert.ok(when(set + 0.3).dark >= LAMPS_AT);
  assert.equal(when(rise - 0.3).lamps, true);
  assert.equal(when(rise + 0.1).lamps, false);
});

test('phase: the sky — blue by day, warm at sunset, navy at night', () => {
  assert.deepEqual(phase(at(9, 25, 12)).sky, ['#6fb6ee', '#cfe9ff', '#ffffff']);
  assert.deepEqual(phase(at(9, 25, 23)).sky, ['#0e1430', '#1a2248', '#2a3158']);
  const [, set] = SUN, dusk = phase(at(9, 25, Math.floor(set), Math.round(set % 1 * 60))).sky;
  assert.ok(parseInt(dusk[1].slice(1, 3), 16) > 0xe0);   // a warm horizon
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});

test('swayDx: at most 1 px, 0 when calm, a 6 s period, neighbours out of step', () => {
  const xs = Array.from({ length: 600 }, (_, i) => swayDx(0.3, i * 10, false));
  assert.ok(xs.every(x => Math.abs(x) <= 1));
  assert.ok(xs.includes(1) && xs.includes(-1) && xs.includes(0));
  assert.equal(swayDx(0.3, 1234, true), 0);
  assert.equal(swayDx(0.3, 1000, false), swayDx(0.3, 7000, false));
  const changes = xs.filter((x, i) => i && x !== xs[i - 1]).length;
  assert.ok(changes <= 4, `${changes} steps in 6 s`);   // calm: about four 1 px steps a period
  assert.notDeepEqual(xs, Array.from({ length: 600 }, (_, i) => swayDx(1.7, i * 10, false)));
});

test('cloudsAt: six clouds, 8–14 px wide in the glass\'s top rows, drifting 1.5–2.4 px/s; a pure function of the time', () => {
  const a = cloudsAt(100_000), b = cloudsAt(110_000);
  assert.equal(a.length, 6);
  for (const [i, c] of a.entries()) {
    assert.ok(c.w >= 8 && c.w <= 14 && c.y >= 1 && c.y <= 4);
    const dx = b[i].x - c.x;
    assert.ok((dx >= 14 && dx <= 25) || dx < 0, `cloud ${i} moved ${dx} px in 10 s`);   // < 0: wrapped round
  }
  assert.deepEqual(cloudsAt(100_000), a);
});

test('birdsAt: one flight per 90 s slice (sometimes a pair), across the whole sky; none after dark', () => {
  let flights = 0;
  for (let s = 0; s < 40; s++) {
    const seen = Array.from({ length: 90 }, (_, i) => birdsAt(s * BIRD_EVERY + i * 1000, 0).length).some(n => n > 0);
    if (seen) flights++;
  }
  assert.ok(flights >= 30, `${flights} of 40 slices`);
  for (let t = 0; t < 10 * BIRD_EVERY; t += 500) {
    const b = birdsAt(t, 0);
    assert.ok(b.length <= 4);
    for (const q of b) assert.ok(q.x >= -40 && q.x <= SKY_W + 40 && q.y >= 1 && q.y <= 9);
    assert.deepEqual(birdsAt(t, 0.6), []);
  }
});

test('starAt: still stars, about one column in 23, in the glass\'s top 70 %', () => {
  const cols = Array.from({ length: SKY_W }, (_, x) => starAt(x, 18)).filter(y => y !== null) as number[];
  assert.ok(cols.length > SKY_W / 40 && cols.length < SKY_W / 15);
  assert.ok(cols.every(y => y >= 0 && y < 12));
});

test('screenLines: three lines inside the 8 px screen; the next tick moves each line up one row', () => {
  for (let n = 0; n < 50; n++) {
    const a = screenLines(n, 3), b = screenLines(n + 1, 3);
    assert.equal(a.length, 3);
    for (const q of a) assert.ok(q.x >= 0 && q.w >= 1 && q.x + q.w <= 8);
    assert.deepEqual(b.slice(0, 2), a.slice(1));
  }
});

test('clockHands: the minute hand 3 px, the hour hand 2 px, pointing at the time', () => {
  assert.deepEqual(clockHands(at(9, 25, 12, 0)), { minute: [{ x: 0, y: -1 }, { x: 0, y: -2 }, { x: 0, y: -3 }], hour: [{ x: 0, y: -1 }, { x: 0, y: -2 }] });
  assert.deepEqual(clockHands(at(9, 25, 3, 30)).minute, [{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }]);
  assert.deepEqual(clockHands(at(9, 25, 15, 0)).hour, [{ x: 1, y: 0 }, { x: 2, y: 0 }]);
  assert.deepEqual(clockHands(at(9, 25, 9, 0)).hour, [{ x: -1, y: 0 }, { x: -2, y: 0 }]);
});
