import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doneSide, keepInside, mmss, offOwn, pillText, shiftOff, sidePlace, stageText, tagName, termLines, toolName, wrapBalloon } from '../../web/src/logic/labels.ts';
import { reasonText } from '../../web/src/logic/i18n.ts';
import { BUBBLE, flatSignAt, officeLayout } from '../../web/src/logic/layout.ts';
import { labelBox, shortHotTags, type Label } from '../../web/src/components/office/renderer.ts';
import { agent, inLang } from './fake.ts';

test('doneSide: a Done lounge label that would cross the office edge flips to its agent\'s other side when that fits, else stays', () => {
  const W = 400, gap = 18;   // agent at x 360: 'r' anchors at 378, 'l' at 342
  assert.deepEqual(doneSide(378, 20, 'r', gap, W), { side: 'r', x: 378 });    // fits: stays
  assert.deepEqual(doneSide(378, 60, 'r', gap, W), { side: 'l', x: 342 });    // past the right wall: left of the agent
  assert.deepEqual(doneSide(22, 60, 'l', gap, W), { side: 'r', x: 58 });      // agent at 40, past the left wall: right of it
  assert.deepEqual(doneSide(378, 380, 'r', gap, W), { side: 'r', x: 378 });   // neither side fits: today's spot
});
test('shiftOff: a label moves sideways off what it meets, the shortest way, and stays inside', () => {
  const r = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
  const b = r(100, 10, 140, 20), W = 400;
  assert.equal(shiftOff(b, [], W), 0);
  assert.equal(shiftOff(b, [r(0, 0, 90, 30), r(150, 0, 300, 30)], W), 0);           // only touches its neighbours' sides
  assert.equal(shiftOff(b, [r(130, 0, 200, 15)], W), -10);                           // a sign over its right end: left
  assert.equal(shiftOff(b, [r(90, 12, 105, 30)], W), 5);                             // a head under its left end: right
  assert.equal(shiftOff(b, [r(90, 0, 105, 30), r(142, 0, 150, 30)], W), -50);        // squeezed: past the left one
  assert.equal(shiftOff(b, [r(90, 0, 105, 30), r(145, 0, 150, 30)], W), 5);          // a gap that fits it exactly
  assert.equal(shiftOff(b, [r(130, 0, 200, 15), r(60, 0, 95, 15)], W), -80);         // left blocked near: past the other
  assert.equal(shiftOff(b, [r(130, 0, 200, 15), r(10, 0, 95, 15)], W), 100);         // ...unless past the sign is shorter
  assert.equal(shiftOff(b, [r(60, 0, 140, 30)], 145), -80);                          // +40 would leave the office
  assert.equal(shiftOff(b, [r(0, 0, 400, 30)], W), null);                            // nowhere to go
  assert.equal(shiftOff(b, [r(130, 0, 200, 15), r(10, 0, 95, 15)], W, 40), null);    // nothing within 40
  assert.equal(shiftOff(b, [r(90, 12, 105, 30)], W, 5), 5);                          // the cap itself is allowed
  assert.equal(shiftOff(b, [r(0, 21, 400, 30)], W), 0);                              // below it: not in its row
});
test('offOwn: a label shifted onto its own agent goes over its head, else under its feet, else to its other side, else stays', () => {
  const r = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
  // "type checks" right of its agent (sprite 100..116 × 60..92, its ✓ 4 px over it), a sign on its right
  const own = r(100, 60, 116, 92), b = r(117, 70, 177, 81), sign = r(170, 66, 240, 96), W = 400, H = 300;
  const dx = shiftOff(b, [sign], W)!, head = r(90, 30, 200, 56), feet = r(90, 92, 200, 110);
  assert.equal(dx, -7);   // shiftOff alone: onto its own face
  assert.deepEqual(offOwn(b, dx, own, [sign], W, H, 4), { dx, dy: -25 });                         // over the head, under the ✓
  assert.deepEqual(offOwn(b, dx, own, [sign, head], W, H, 4), { dx, dy: 22 });                    // head blocked: under the feet
  assert.deepEqual(offOwn(b, dx, own, [sign, head, feet], W, H, 4), { dx: -78, dy: 0 });          // both: its other side
  assert.deepEqual(offOwn(b, dx, own, [sign, head], W, 100, 4), { dx: -78, dy: 0 });              // under the feet leaves the office
  assert.deepEqual(offOwn(b, dx, own, [sign, head, feet, r(30, 70, 99, 81)], W, H, 4), { dx, dy: 0 });   // none free: stays
  assert.deepEqual(offOwn(r(117, 10, 177, 21), dx, r(100, 14, 116, 46), [], W, H, 4), { dx, dy: 36 });   // over leaves it: under
  assert.deepEqual(offOwn(b, dx, r(60, 60, 76, 92), [], W, H, 4), { dx, dy: 0 });                 // off its own sprite: unchanged
  assert.deepEqual(offOwn(r(95, 70, 155, 81), 0, own, [], W, H, 4), { dx: 0, dy: 0 });            // not moved: stays
});

test('keepInside: a label stays inside the office frame; one under the feet on the bottom line flips over the head', () => {
  const W = 560, H = 288, feet = H - 16, tag = { w: 60, h: 32 };   // name + pill under the feet of a walker on l.h − 16
  const flip = keepInside(100, feet + 2, tag.w, tag.h, W, H, 0.5, feet - 34);
  assert.deepEqual(flip, { x: 100, y: feet - 34 - 32 });              // bottom over the head (sprite 32 px tall)
  assert.ok(flip.y + tag.h <= H);
  assert.deepEqual(keepInside(100, feet + 2, tag.w, tag.h, W, H, 0.5), { x: 100, y: H - 32 });   // no flip given: pushed up
  assert.deepEqual(keepInside(10, -5, 60, 10, W, H, 0.5), { x: 30, y: 0 });       // centred tag at the left / top edge
  assert.deepEqual(keepInside(W - 5, 50, 60, 10, W, H, 0.5), { x: W - 30, y: 50 }); // right edge
  assert.deepEqual(keepInside(20, 50, 60, 10, W, H, 1), { x: 60, y: 50 });         // ends at x (translateX(-100%))
  assert.deepEqual(keepInside(W - 20, 50, 60, 10, W, H, 0), { x: W - 60, y: 50 });  // starts at x
  assert.deepEqual(keepInside(100, 50, 60, 10, W, H, 0.5, 0), { x: 100, y: 50 });   // inside: unchanged
});

test('pillText: the active tool first, else the newest finished one, cut at 22', () => {
  assert.equal(pillText(agent({ activeTools: [{ name: 'Read', label: 'engine.ts' }] })), '▸ Read engine.ts');
  assert.equal(pillText(agent({ recentTools: [{ name: 'Bash', label: 'npm test', ms: 5 }] })), '▸ Bash npm test');
  assert.equal(pillText(agent({ activeTools: [{ name: 'Grep', label: 'a-very-long-pattern-here' }] })), '▸ Grep a-very-long-patt…');
  assert.equal(pillText(agent()), null);
});
test('toolName: an MCP tool reads as its product and tool, an unknown server as its name; others stay', () => {
  assert.equal(toolName('mcp__claude_ai_Microsoft_365__outlook_email_search'), 'Outlook · email_search');
  assert.equal(toolName('mcp__claude_ai_Microsoft_365__teams_list_chats'), 'Teams · list_chats');
  assert.equal(toolName('mcp__claude_ai_Microsoft_365__sharepoint_search'), 'SharePoint · search');
  assert.equal(toolName('mcp__claude_ai_Microsoft_365__get_me'), 'Microsoft 365 · get_me');
  assert.equal(toolName('mcp__claude_ai_Gmail__search_threads'), 'Gmail · search_threads');
  assert.equal(toolName('mcp__claude_ai_Google_Drive__search_files'), 'Drive · search_files');
  assert.equal(toolName('mcp__claude_ai_Google_Calendar__list_events'), 'Calendar · list_events');
  assert.equal(toolName('mcp__claude_ai_Claude_Docs__batch'), 'Claude Docs · batch');
  assert.equal(toolName('mcp__plugin_playwright_playwright__browser_click'), 'playwright · browser_click');
  assert.equal(toolName('mcp__my_server__do_it'), 'my server · do_it');
  assert.equal(toolName('Bash'), 'Bash');
  assert.equal(toolName('mcp__broken'), 'mcp__broken');
  assert.equal(pillText(agent({ activeTools: [{ name: 'mcp__claude_ai_Microsoft_365__outlook_email_search', label: null }] })), '▸ Outlook · email_search');
  assert.equal(termLines(agent({ activeTools: [{ name: 'mcp__claude_ai_Gmail__search_threads', label: null }] })).at(-1)!.text, 'Gmail · search_threads');
});
test('wrapBalloon: ~28 chars a line, at most 2 lines, long words split, cut with …', () => {
  assert.deepEqual(wrapBalloon('permission: Bash node -e "console.log(1)"'), ['permission: Bash node -e', '"console.log(1)"']);
  assert.deepEqual(wrapBalloon('short'), ['short']);
  const cut = wrapBalloon('needs-info: which config file should it use, vite or tsconfig or maybe both of them?');
  assert.equal(cut.length, 2);
  assert.ok(cut[1].endsWith('…') && cut.every(l => l.length <= 28));
  assert.deepEqual(wrapBalloon('x'.repeat(30)), ['x'.repeat(28), 'xx']);
});
test('tagName: Foreman, Desk when foreman is off, else the label; Turkish after setLang', () => {
  assert.equal(tagName(agent({ id: 'main', role: 'foreman' })), 'Foreman');
  assert.equal(tagName(agent({ id: 'main', role: 'main' })), 'Desk');
  assert.equal(inLang('tr', () => tagName(agent({ id: 'main', role: 'foreman' }))), 'ustabaşı');
  assert.equal(inLang('tr', () => tagName(agent({ id: 'main', role: 'main' }))), 'masa');
  assert.equal(tagName(agent({ label: 'engine summary' })), 'engine summary');
});
test('balloon text in English: the lead stays on the first line, every line within 16 chars, two lines at most', () => {
  for (const r of [{ kind: 'permission', tool: 'Bash', label: 'node -e "console.log(1)"' }, { kind: 'permission', tool: 'WebFetch', label: 'https://example.com/a/long/path' }] as const)
    for (const lines of [wrapBalloon(reasonText(r), BUBBLE.chars, 2), wrapBalloon(reasonText(r), BUBBLE.chars, 1)]) {
      assert.ok(lines.length >= 1 && lines.length <= 2, lines.join('|'));
      assert.ok(lines.every(s => s.length <= BUBBLE.chars), lines.join('|'));
      assert.match(lines[0], /^permission:/);   // overlay.ts colours a [\w-]+: lead on the first line
    }
});

const tools = ['A', 'B', 'C', 'D', 'E'].map(n => ({ name: 'Read', label: n, ms: 1 })); // newest first
test('termLines: running — last five, oldest first, newest marked', () => {
  const l = termLines(agent({ recentTools: tools }));
  assert.deepEqual(l.map(x => x.text), ['Read E', 'Read D', 'Read C', 'Read B', 'Read A']);
  assert.deepEqual(l.map(x => x.kind), ['old', 'old', 'old', 'old', 'cur']);
  assert.equal(termLines(agent({ recentTools: tools, activeTools: [{ name: 'Bash', label: 'npm test' }] })).at(-1)!.text, 'Bash npm test');
});
test('termLines: a wait ends with its reason, done ends with ✓', () => {
  const w = termLines(agent({ stage: 'waiting', alert: true, reasons: [{ kind: 'permission', tool: 'Bash', label: 'ls' }], recentTools: tools }));
  assert.deepEqual(w.at(-1), { text: '⏸ permission: Bash ls', kind: 'why-alert' });
  assert.equal(w.length, 5);
  assert.equal(termLines(agent({ stage: 'waiting', reasons: [{ kind: 'note', text: 'needs-info: x' }] })).at(-1)!.kind, 'why-info');
  assert.deepEqual(termLines(agent({ stage: 'done', recentTools: tools })).at(-1), { text: '✓ done', kind: 'ok' });
  assert.deepEqual(inLang('tr', () => termLines(agent({ stage: 'done', recentTools: tools })).at(-1)), { text: '✓ tamamlandı', kind: 'ok' });
  assert.equal(termLines(agent({ stage: 'waiting' })).at(-1)!.text, '⏸ waiting for you');
});
test('mmss and stageText', () => {
  assert.equal(mmss(754_000), '12:34');
  assert.equal(mmss(-5), '00:00');
  assert.equal(stageText('running'), 'running');
  assert.equal(stageText('spawning'), 'starting');
  assert.equal(inLang('tr', () => stageText('running')), 'çalışıyor');
  assert.equal(inLang('tr', () => stageText('waiting')), 'bekliyor');
});

test('shortHotTags: F1 at 1920 Flat — the hot tag under the busy foreman drops its tool line, then stays within its width of its desk', () => {
  // the 34x18 office at scale 3 (text px = office px, k 1): the foreman's two-line tag over the first desk row, the
  // Corridor sign right of it, the hot third desk between them (flat.ts: hot tag at d.y − 19 − 19k)
  const l = officeLayout({ w: 1700, h: 1036, dpr: 1, demand: 8, sb: 0, frame: true }), k = 1, d = l.desks[2], hall = l.doors.find(o => o.id === 'hall')!;
  assert.equal(l.key, '34x18');
  const tag = (own: string, x: number, y: number, name: string, pill: string, hot: number | null): Label =>
    ({ kind: 'tag', key: 'tag-' + own, x, y, name, color: '#fff', pill, hot, failed: false, own });
  const hot = tag('a-hot', d.cx, d.y - 19 - 19 * k, 'test runner', '▸ Bash npm test', 12);
  const labels: Label[] = [
    { kind: 'sign', key: 'door-hall', ...flatSignAt(hall), text: 'Corridor', tone: 'hall', side: hall.side },
    tag('main', l.foreman.seat.x, l.foreman.y + 32, 'Foreman', '▸ mcp__claude_ai_Micros…', null),
    hot,
  ];
  const others = () => labels.filter(x => x !== hot).map(x => labelBox(x, k)), near = () => { const b = labelBox(hot, k); return shiftOff(b, others(), l.w, b.x1 - b.x0); };
  assert.equal(near(), null);   // two lines: no spot within its width (the overlay then took 2w and drifted ~100 px off)
  shortHotTags(labels, k);
  assert.equal(hot.kind === 'tag' && hot.pill, null);
  assert.equal(hot.y, d.y - 19 - 10 * k);   // its name keeps the bottom, over the flame
  const dx = near();
  assert.ok(dx !== null && Math.abs(dx) <= labelBox(hot, k).x1 - labelBox(hot, k).x0, `moves ${dx}`);
});

test('sidePlace: the board balloon sits left of the board, centred; right when the left has no room; else pushed inside', () => {
  const r = { x0: 300, y0: 100, x1: 340, y1: 140 }, W = 600, H = 400;
  assert.deepEqual(sidePlace(r, 200, 100, W, H, 12), { side: 'l', x: 88, y: 70, ty: 50 });
  assert.deepEqual(sidePlace({ ...r, x0: 100, x1: 140 }, 200, 100, W, H, 12), { side: 'r', x: 152, y: 70, ty: 50 });
  for (const rr of [{ x0: 0, y0: 0, x1: 40, y1: 20 }, { x0: 560, y0: 380, x1: 600, y1: 400 }, { x0: 150, y0: 5, x1: 450, y1: 395 }]) {
    const p = sidePlace(rr, 400, 380, W, H, 12);
    assert.ok(p.x >= 0 && p.x + 400 <= W && p.y >= 0 && p.y + 380 <= H && p.ty >= 12 && p.ty <= 368);
  }
  assert.equal(sidePlace(r, 200, 100, 150, 90, 12).y, 0);   // taller than the stage: never negative
});
