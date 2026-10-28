import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLang, reasonText, t, TEXT, whyText, type Key } from '../../web/src/logic/i18n.ts';
import { gaugeText } from '../../web/src/logic/corner.ts';
import { ROOMS } from '../../web/src/logic/hybrid.ts';
import { officeLayout } from '../../web/src/logic/layout.ts';
import { agent, inLang } from './fake.ts';

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join();

test('TEXT: both languages have the same keys, none empty, the same {params} per key', () => {
  assert.deepEqual(Object.keys(TEXT.tr).sort(), Object.keys(TEXT.en).sort());
  for (const k of Object.keys(TEXT.en) as Key[]) {
    assert.ok(TEXT.en[k] && TEXT.tr[k], k);
    assert.equal(holes(TEXT.tr[k]), holes(TEXT.en[k]), k);
  }
});
test('t: English by default; numbers and names fill in; Turkish after setLang', () => {
  assert.equal(getLang(), 'en');
  assert.equal(t('floor.waiting', { n: 2 }), '2 waiting');
  assert.equal(t('bubble.head', { name: 'lint' }), 'lint is waiting');
  assert.equal(t('dur.ms', { m: 2, s: 5 }), '2 min 5 s');
  assert.equal(t('floor.badge', { n: '' }), 'F');   // a leaving floor has no number: the plate shows no "undefined"
  assert.equal(inLang('tr', () => t('floor.waiting', { n: 2 })), '2 bekliyor');
  assert.equal(inLang('tr', () => t('bubble.head', { name: 'ustabaşı' })), 'ustabaşı bekliyor');
  assert.equal(t('door.wait'), 'Waiting room');   // inLang put English back
});
test('reasonText: permission is written in the language; notification and note text stay as they came', () => {
  const p = { kind: 'permission', tool: 'Bash', label: 'npm test' } as const;
  assert.equal(reasonText(p), 'permission: Bash npm test');
  assert.equal(inLang('tr', () => reasonText(p)), 'izin: Bash npm test');
  assert.equal(reasonText({ kind: 'permission', tool: 'Bash', label: null }), 'permission: Bash');
  const mcp = { kind: 'permission', tool: 'mcp__claude_ai_Microsoft_365__outlook_email_search', label: null } as const;
  assert.equal(reasonText(mcp), 'permission: Outlook · email_search');   // the readable name, as the office shows it
  assert.equal(inLang('tr', () => reasonText(mcp)), 'izin: Outlook · email_search');
  assert.deepEqual([reasonText({ kind: 'question' }), inLang('tr', () => reasonText({ kind: 'question' }))], ['question', 'soru']);
  for (const l of ['en', 'tr'] as const) {
    assert.equal(inLang(l, () => reasonText({ kind: 'notification', text: 'Claude needs your permission to use Bash' })), 'Claude needs your permission to use Bash');
    assert.equal(inLang(l, () => reasonText({ kind: 'note', text: 'needs-info: which file?' })), 'needs-info: which file?');
  }
});
test('whyText: reasons joined with " · ", empty when none', () => {
  assert.equal(whyText(agent({ reasons: [{ kind: 'permission', tool: 'Bash', label: null }, { kind: 'note', text: 'needs-decision: x' }] })), 'permission: Bash · needs-decision: x');
  assert.equal(whyText(agent()), '');
});
test('door signs: every door of the layout has a name in both languages; the layout itself carries no text', () => {
  const l = officeLayout({ w: 1114, h: 589, dpr: 1, demand: 0, sb: 0 });
  assert.deepEqual(l.doors.map(d => t(`door.${d.id}`)), ['Entrance', 'Corridor', 'Server room', 'Library', 'Waiting room', 'Done lounge ✓']);
  assert.deepEqual(inLang('tr', () => l.doors.map(d => t(`door.${d.id}`))), ['Giriş', 'Koridor', 'Sunucu odası', 'Kütüphane', 'Bekleme', 'Bitti ✓']);
  assert.ok(l.doors.every(d => !('label' in d)));
});
test('foreman corner: the gauge, the pill and the drawer legend in both languages; gaugeText follows the language', () => {
  assert.deepEqual([t('corner.gauge', { n: 42 }), t('corner.empty'), t('corner.pill'), t('corner.window')],
    ['context 42%', 'context —', '▸ updating context', 'Context window']);
  assert.deepEqual(inLang('tr', () => [t('corner.gauge', { n: 42 }), t('corner.empty'), t('corner.pill'), t('corner.window')]),
    ['context %42', 'context —', '▸ context güncelleniyor', 'Context penceresi']);
  assert.deepEqual([gaugeText(41.6), gaugeText(null)], ['context 42%', 'context —']);
  assert.equal(inLang('tr', () => gaugeText(41.6)), 'context %42');
});

test('hybrid: card titles and the main card count in both languages', () => {
  assert.deepEqual(ROOMS.map(r => t(`room.${r.key}`)), ['Queue', 'Work', 'Waiting', 'Verify', 'Done / Failed']);
  assert.deepEqual(inLang('tr', () => ROOMS.map(r => t(`room.${r.key}`))), ['Kuyruk', 'Çalışma', 'Bekleme', 'Doğrulama', 'Bitti / Hata']);
  assert.equal(t('hybrid.agents', { n: 22 }), '22 agents');
  assert.equal(inLang('tr', () => t('hybrid.agents', { n: 22 })), '22 ajan');
  assert.equal(t('hybrid.more', { n: 17 }), '17 more: show the list');
  assert.equal(inLang('tr', () => t('hybrid.more', { n: 17 })), '17 tane daha: listeyi göster');
});
