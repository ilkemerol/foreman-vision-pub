import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, parseSettings, samePrefs, withPrefs } from '../../web/src/logic/settings.ts';

test('parseSettings: missing, broken or foreign values fall back field by field', () => {
  assert.deepEqual(parseSettings(null), DEFAULTS);
  assert.deepEqual(parseSettings('{broken'), DEFAULTS);
  assert.deepEqual(parseSettings('null'), DEFAULTS);
  assert.deepEqual(parseSettings('"pixel"'), DEFAULTS);
  assert.deepEqual(parseSettings(JSON.stringify({ view: 'kanban', sound: 'yes', notify: false })),
    { ...DEFAULTS, view: 'kanban', notify: false });
  assert.deepEqual(parseSettings(JSON.stringify({ view: 'old-view' })).view, DEFAULTS.view);
  assert.deepEqual(parseSettings(JSON.stringify({ view: 'pixel', style: 'iso', floor: 's9', filter: 's1' })),
    { ...DEFAULTS, style: 'iso', floor: 's9' });
  assert.equal(parseSettings(JSON.stringify({ style: 'square' })).style, 'flat');
  assert.equal(parseSettings(JSON.stringify({ floor: 42 })).floor, null);
});

test('DEFAULTS: Pixel office, flat style, sound off, English, context window 200k, auto iso zoom', () => {
  assert.deepEqual(DEFAULTS, { view: 'pixel', style: 'flat', sound: false, notify: true, lang: 'en', ctxWindow: '200k', floor: null, isoZoom: null });
});
test('parseSettings: ctxWindow is 200k or 1M; anything else, or none (saved before it existed), is 200k and the rest stays', () => {
  assert.equal(parseSettings(JSON.stringify({ ctxWindow: '1M' })).ctxWindow, '1M');
  for (const w of ['1m', '500k', 1_000_000, null]) assert.equal(parseSettings(JSON.stringify({ view: 'kanban', ctxWindow: w })).ctxWindow, '200k', String(w));
  assert.deepEqual(parseSettings(JSON.stringify({ view: 'kanban', ctxWindow: '2M', sound: true })), { ...DEFAULTS, view: 'kanban', sound: true });
});

test('parseSettings: lang is en or tr; anything else, or none (saved before i18n), is en and the rest stays', () => {
  assert.equal(parseSettings(JSON.stringify({ lang: 'tr' })).lang, 'tr');
  for (const lang of ['de', 5, null, 'TR']) assert.equal(parseSettings(JSON.stringify({ view: 'kanban', lang })).lang, 'en', String(lang));
  assert.deepEqual(parseSettings(JSON.stringify({ view: 'kanban', style: 'iso', sound: true })), { ...DEFAULTS, view: 'kanban', style: 'iso', sound: true });
});

test('samePrefs: the language counts', () => {
  assert.ok(!samePrefs(DEFAULTS, { ...DEFAULTS, lang: 'tr' }));
});

test('samePrefs: only the drawer fields count, floor does not', () => {
  assert.ok(samePrefs(DEFAULTS, { ...DEFAULTS, floor: 's2' }));
  for (const p of [{ view: 'kanban' }, { style: 'iso' }, { sound: true }, { notify: false }, { ctxWindow: '1M' }] as const)
    assert.ok(!samePrefs(DEFAULTS, { ...DEFAULTS, ...p }));
});

test('withPrefs: the draft lands on the current settings and keeps the latest floor', () => {
  const draft = { view: 'kanban', style: 'iso', sound: true, notify: false, lang: 'tr', ctxWindow: '1M', floor: 'old', isoZoom: null } as const;
  assert.deepEqual(withPrefs({ ...DEFAULTS, floor: 's9' }, draft), { ...draft, floor: 's9' });
});

test('parseSettings: isoZoom is one of the zoom steps; anything else, or none (saved before it existed), is auto', () => {
  assert.equal(parseSettings(JSON.stringify({ isoZoom: 1.25 })).isoZoom, 1.25);
  assert.equal(parseSettings(JSON.stringify({ isoZoom: 3 })).isoZoom, 3);
  for (const z of [1.3, 0.5, 4, '2', null, true]) assert.equal(parseSettings(JSON.stringify({ view: 'kanban', isoZoom: z })).isoZoom, null, String(z));
  assert.deepEqual(parseSettings(JSON.stringify({ view: 'kanban', isoZoom: 9 })), { ...DEFAULTS, view: 'kanban' });
});

test('isoZoom: the ⚙ drawer neither counts nor drops it', () => {
  assert.ok(samePrefs(DEFAULTS, { ...DEFAULTS, isoZoom: 2 }));
  assert.equal(withPrefs({ ...DEFAULTS, isoZoom: 1.5 }, { ...DEFAULTS, style: 'iso' }).isoZoom, 1.5);
});
