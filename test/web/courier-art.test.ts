import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAG, BAG_INK, CAP, hatRows, HAT_INK, HEAD_TOP, ICON, ICON_INK, LETTER, LETTER_INK, SEAL, withOutline } from '../../web/src/logic/courier-art.ts';

const cells = (rows: string[]) => new Set(rows.join(''));

test('CAP: two companies, three views, eight rows of 16; hatRows outlines them in nine rows and every letter has an ink', () => {
  for (const co of ['ms', 'g'] as const) for (const [v, rows] of Object.entries(CAP[co])) assert.deepEqual([rows.length, ...new Set(rows.map(r => r.length))], [8, 16], `${co} ${v}`);
  for (const co of ['ms', 'g'] as const) for (const v of ['front', 'back', 'side'] as const) {
    const h = hatRows(co, v);
    assert.deepEqual([h.length, ...new Set(h.map(r => r.length))], [9, 16], `${co} ${v}`);
    for (const ch of cells(h)) if (ch !== '.') assert.ok(HAT_INK[co][ch], `${co} ${v}: no ink for ${ch}`);
  }
});

test('withOutline: a blank row on top, o round the filled cells, the filled cells kept, nothing below', () => {
  assert.deepEqual(withOutline(['....', '.XX.', '.XX.']), ['....', '.oo.', 'oXXo', 'oXXo']);
});

test('hatRows: a 5×5 badge on the front: Microsoft\'s four squares with a gap, Google\'s G over a four-stripe visor', () => {
  const badge = (co: 'ms' | 'g') => hatRows(co, 'front').slice(3, 8).map(r => r.slice(5, 10));
  assert.deepEqual(badge('ms'), ['aaCbb', 'aaCbb', 'CCCCC', 'ccCdd', 'ccCdd']);
  assert.deepEqual(badge('g'), ['CRRRC', 'RCCCC', 'YCCBB', 'YCCCB', 'CGGGC']);
  assert.ok(!/[abcd]/.test(hatRows('g', 'front').join('')));
  assert.equal(hatRows('g', 'front')[8], 'oBBBBRRRYYYGGGGo');
});

test('HEAD_TOP, BAG, LETTER, ICON: sizes and inks', () => {
  for (const r of [0, 1, 2] as const) assert.equal(HEAD_TOP[r].length, 3);
  for (const b of Object.values(BAG)) for (const co of ['ms', 'g'] as const) for (const ch of cells(b.bag)) assert.ok(BAG_INK[co][ch]);
  for (const co of ['ms', 'g'] as const) assert.ok(BAG_INK[co].S, `${co}: no strap ink`);
  assert.deepEqual([LETTER.length, ...new Set(LETTER.map(r => r.length))], [6, 8]);
  for (const ch of cells(LETTER)) assert.ok(ch === 's' || LETTER_INK[ch]);
  assert.equal(Object.keys(ICON).length, 10);
  for (const [n, rows] of Object.entries(ICON)) {
    assert.deepEqual([rows.length, ...new Set(rows.map(r => r.length))], [8, 8], n);
    for (const ch of cells(rows)) assert.ok(ch === '.' || ICON_INK[ch], `${n}: ${ch}`);
    assert.ok(SEAL[n as keyof typeof SEAL], n);
  }
});
