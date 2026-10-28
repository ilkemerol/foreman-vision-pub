import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EYE_ROWS, ICON_PALETTE, ICON_PX, iconRows } from '../../web/src/logic/icon.ts';

const used = (rows: string[]) => new Set(rows.join('').replace(/\./g, ''));

test('iconRows: 16×16, only palette colours, a mirror-symmetric face with two open eyes and a smile by default', () => {
  for (const o of [{}, { dot: true }, { lid: 1 }, { lid: EYE_ROWS, dot: true }]) {
    const rows = iconRows(o);
    assert.equal(rows.length, ICON_PX);
    for (const r of rows) assert.equal(r.length, ICON_PX);
    for (const c of used(rows)) assert.ok(c in ICON_PALETTE, c);
  }
  const open = iconRows();
  const shape = (r: string, c: string) => [...r].map(x => x === c ? c : '.').join('');
  for (const r of open) for (const c of 'okp') assert.equal(shape(r, c), [...shape(r, c)].reverse().join(''));
  assert.equal(open.join('').split('p').length - 1, 8); // 2×2 eye pixels + a 4-pixel smile
  assert.ok(!used(open).has('d'));
});
test('iconRows: the lid shuts the eyes from the top; closed leaves a lash line and the smile', () => {
  const dark = (lid: number, c: string) => iconRows({ lid }).join('').split(c).length - 1;
  assert.deepEqual([0, 1, EYE_ROWS].map(l => dark(l, 'p')), [8, 6, 4]);
  const shut = iconRows({ lid: EYE_ROWS }), open = iconRows();
  const changed = shut.flatMap((r, y) => [...r].flatMap((c, x) => c !== open[y][x] ? [`${x},${y}:${c}`] : []));
  assert.deepEqual(changed, ['5,10:k', '10,10:k', '4,11:o', '5,11:o', '10,11:o', '11,11:o']);
});
test('iconRows: the dot sits top-right, outlined, and changes nothing else', () => {
  const plain = iconRows(), dot = iconRows({ dot: true });
  assert.ok(used(dot).has('d'));
  dot.forEach((r, y) => [...r].forEach((c, x) => {
    if (c !== plain[y][x]) assert.ok(x >= 10 && y < 6 && (c === 'd' || c === 'o'), `${x},${y}`);
  }));
  assert.equal(dot[0].slice(10), '..oo..');
});
