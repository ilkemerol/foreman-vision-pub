import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIND, windRibbon } from '../../web/src/logic/wind.ts';

const SEEDS = [0, 0.13, 0.37, 0.5, 0.74, 0.99, 3.21];

test('windRibbon: integer pixels inside its box, the same for the same seed and phase', () => {
  const { x0, x1, y0, y1 } = WIND.box;
  let most = 0;
  for (const seed of SEEDS) for (let t = 0; t < 1; t += 0.005) {
    const pts = windRibbon(seed, t);
    most = Math.max(most, pts.length);
    assert.deepEqual(windRibbon(seed, t), pts);
    for (const [x, y] of pts) {
      assert.ok(Number.isInteger(x) && Number.isInteger(y), `${x},${y}`);
      assert.ok(x >= x0 && x <= x1 && y >= y0 && y <= y1, `${x},${y} at seed ${seed} t ${t}`);
    }
  }
  assert.ok(most >= 15 && most <= 30, String(most));   // a readable stroke and curl, still a few dozen pixels at most
});

test('windRibbon: grows out of the grille, travels, and is gone at the cycle edges', () => {
  for (const seed of SEEDS) {
    for (const t of [0, 0.85, 0.9, 0.999]) assert.deepEqual(windRibbon(seed, t), [], `seed ${seed} t ${t}`);
    const at = (t: number) => windRibbon(seed, t), far = (t: number) => Math.max(...at(t).map(p => p[1]));
    assert.ok(at(0.1).length > 0 && at(0.1).length < at(0.4).length);   // just out of the grille: short
    assert.ok(far(0.2) < far(0.5) && far(0.5) < far(0.8));                 // the tip moves on into the room
    assert.ok(at(0.84).length < at(0.5).length);                           // shrinks into its curl at the end
  }
});
