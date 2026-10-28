import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardLit, flickerEvent, FLICKER_SLOT } from '../../web/src/logic/board.ts';

test('boardLit: by day and with reduced motion always lit; at night 60–120 s between flickers, 1–3 blinks of 0.1 s or, about one in four, a 1 s outage that stutters back; the same instant the same answer', () => {
  const t0 = Date.UTC(2026, 9, 26, 18), events: { start: number; dark: number; spans: number }[] = [];
  let was = true, start = -Infinity;
  for (let ms = t0; ms < t0 + 6 * 3600_000; ms += 10) {
    const lit = boardLit(ms, 1, false);
    assert.equal(boardLit(ms, 0.34, false), true); assert.equal(boardLit(ms, 1, true), true); assert.equal(lit, boardLit(ms, 1, false));
    if (!lit && was) { if (ms - start > 2000) { events.push({ start: ms, dark: 0, spans: 0 }); start = ms; } events[events.length - 1].spans++; }
    if (!lit) events[events.length - 1].dark += 10;
    was = lit;
  }
  assert.ok(events.length >= 170 && events.length <= 240, `${events.length} events in 6 h`);
  for (let i = 1; i < events.length; i++) { const gap = events[i].start - events[i - 1].start; assert.ok(gap > 60_000 && gap < 120_000, `gap ${gap}`); }
  const outages = events.filter(e => e.dark >= 1000);
  assert.ok(outages.length > events.length / 8 && outages.length < events.length / 2, `${outages.length} outages`);
  for (const e of outages) assert.deepEqual([e.dark, e.spans], [1080, 2]);
  for (const e of events.filter(e => e.dark < 1000)) assert.ok(e.spans >= 1 && e.spans <= 3 && e.dark === e.spans * 100, `${e.spans} blinks, ${e.dark} ms`);
  assert.deepEqual(flickerEvent(7), flickerEvent(7));
  assert.ok(flickerEvent(7).start >= 7 * FLICKER_SLOT && flickerEvent(7).start < 7 * FLICKER_SLOT + 30_000);
});
