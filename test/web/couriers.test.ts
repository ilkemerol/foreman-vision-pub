import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentView, ConnectorCall } from '../../shared/types.ts';
import { busyCalls, companyOf, courierPoses, courierSpots, CSPEED, deskBusy, DOOR_GAP, foremanAtDesk, GIVE, handover, HOLD_MAX, latestCalls, LIFT, LINGER, PASS,
  noteCalls, productOf, seedCouriers, stepCouriers, type Company, type Couriers, type CourierSpots } from '../../web/src/logic/couriers.ts';
import { cornerSpots } from '../../web/src/logic/corner.ts';
import { pointAt } from '../../web/src/logic/fx.ts';
import { TEXT } from '../../web/src/logic/i18n.ts';
import { signBox } from '../../web/src/logic/iso.ts';
import { flatSignAt, officeLayout, type Fit, type Layout, type Pt, type Rect } from '../../web/src/logic/layout.ts';
import { syncWalkers, type Walker } from '../../web/src/logic/motion.ts';
import { officeScene } from '../../web/src/logic/scene.ts';
import { agent } from './fake.ts';

const fit = (w: number, h: number): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0 });
const LAYOUTS = [fit(1114, 589), fit(1146, 613), fit(1700, 1036), fit(2308, 1372)].map(f => officeLayout(f));   // minimum; 1366, 1920, 2560 boxes
const MIN = LAYOUTS[0], SP = courierSpots(MIN), WALK = SP.len / CSPEED;
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const sprite = (p: Pt): Rect => ({ x0: p.x - 8, y0: p.y - 32, x1: p.x + 8, y1: p.y });
const capped = (p: Pt): Rect => ({ ...sprite(p), y0: p.y - 35 });
/** What a courier must not meet in the main office's top part: the back wall, plant, foreman's desk, the box, the desk rows. */
function solids(l: Layout): Rect[] {
  const F = l.foreman.seat, { x0, y0, x1 } = l.rooms.main;
  return [
    { x0, y0: 0, x1, y1: y0 },                                            // back wall
    { x0: x1 - 32, y0: 40, x1, y1: 88 },                                  // large plant
    { x0: F.x - 24, y0: F.y - 40, x1: F.x + 24, y1: l.foreman.y + 32 },   // foreman chair and desk
    { x0: F.x - 26, y0: F.y - 34, x1: F.x + 26, y1: l.foreman.y + 50 },   // the foreman's hit box
    cornerSpots(l).box,
    ...l.desks.map(d => ({ x0: d.cx - 28, y0: d.y - 18, x1: d.cx + 28, y1: d.y + 54 })),   // monitor, desk, chair, desk tag
  ];
}
const call = (server: string, tool: string, at: number): ConnectorCall => ({ server, tool, at });
const MS = 'claude_ai_Microsoft_365', GM = 'claude_ai_Gmail';
/** Frames every 20 ms over [t0, t1). */
function run(c: Couriers, t0: number, t1: number, busy: Company[] = [], seated = true, sp: CourierSpots = SP, asking = false) {
  for (let t = t0; t < t1; t += 20) stepCouriers(c, sp, t, 20, { calls: new Set(busy), asking }, seated);
}
const one = (c: Couriers, co: Company = 'ms') => c.list.find(k => k.co === co);

test('companyOf and productOf: Microsoft 365 by tool prefix, else the logo; six Google servers; anything else none', () => {
  assert.deepEqual(['teams_list_chats', 'chat_message_search', 'outlook_send_mail', 'find_meeting_availability', 'sharepoint_search', 'get_me', 'search_people']
    .map(t => productOf(MS, t)), ['teams', 'teams', 'outlook', 'outlook', 'sharepoint', 'microsoft', 'microsoft']);
  assert.deepEqual(['claude_ai_Gmail', 'claude_ai_Google_Calendar', 'claude_ai_Google_Drive', 'claude_ai_Google_Docs', 'claude_ai_Google_Sheets', 'claude_ai_Google_Slides']
    .map(s => [companyOf(s), productOf(s, 'x')]), [['g', 'gmail'], ['g', 'calendar'], ['g', 'drive'], ['g', 'docs'], ['g', 'sheets'], ['g', 'slides']]);
  assert.equal(companyOf(MS), 'ms');
  for (const s of ['claude_ai_Notion', 'plugin_playwright_playwright', 'claude_ai_Slack']) assert.deepEqual([companyOf(s), productOf(s, 'x')], [null, null]);
});

test('latestCalls and busyCalls: the latest call per company with its product; main\'s running MCP calls by company', () => {
  assert.deepEqual(latestCalls([call(GM, 'search_threads', 5), call('claude_ai_Google_Calendar', 'list_events', 9), call(MS, 'get_me', 7), call('claude_ai_Notion', 'x', 99)]),
    { g: { at: 9, product: 'calendar' }, ms: { at: 7, product: 'microsoft' } });
  assert.deepEqual(latestCalls([]), {});
  const main = agent({ id: 'main', role: 'foreman', activeTools: [{ id: 'x', name: 'mcp__claude_ai_Microsoft_365__outlook_send_mail', label: null, at: 0 }, { id: 'x', name: 'Bash', label: 'ls', at: 0 }] });
  assert.deepEqual([[...busyCalls(main).calls], busyCalls(main).asking], [['ms'], false]);
  assert.deepEqual([[...busyCalls(undefined).calls], busyCalls(undefined).asking], [[], false]);
  const ask = (r: AgentView['reasons'][number]) => busyCalls(agent({ ...main, stage: 'waiting', alert: true, reasons: [r] })).asking;
  assert.deepEqual([ask({ kind: 'permission', tool: 'mcp__claude_ai_Microsoft_365__outlook_send_mail', label: null }), ask({ kind: 'notification', text: 'idle_prompt' })], [true, false]);
});

test('courierSpots: Entrance → main lane → the foreman aisle → the desk\'s right side; the queue point on the way', () => {
  assert.deepEqual(SP.path, [{ x: -10, y: 272 }, { x: 200, y: 272 }, { x: 200, y: 92 }, { x: 140, y: 92 }, { x: 140, y: 70 }]);
  assert.deepEqual([SP.len, SP.queue, SP.desk, SP.queuePt], [472, 426, { x: 140, y: 70 }, { x: 164, y: 92 }]);
  for (const l of LAYOUTS) {
    const sp = courierSpots(l);
    for (const p of [sp.desk, sp.queuePt, { x: sp.queuePt.x, y: sp.queuePt.y - LIFT }]) solids(l).forEach((r, i) => assert.ok(!meet(capped(p), r), `${l.key}: ${p.x},${p.y} meets #${i}`));
    assert.deepEqual(pointAt(sp.path, sp.queue), sp.queuePt, `${l.key}: the queue point is on the path`);
  }
});

test('courierSpots: a courier at rest (desk, queue, LIFT up from it; cap included) is under no door sign, in either language, at 1 and 1.25 dpr', () => {
  for (const dpr of [1, 1.25]) for (const f of [fit(1114, 589), fit(1146, 613), fit(1700, 1036), fit(2308, 1372)]) {
    const l = officeLayout({ ...f, dpr }), sp = courierSpots(l), css = l.views.flat.css, k = Math.max(css, 2) / css;   // overlay.ts textScale
    for (const p of [sp.desk, sp.queuePt, { x: sp.queuePt.x, y: sp.queuePt.y - LIFT }]) for (const d of l.doors) for (const lang of ['en', 'tr'] as const) {
      const sign = signBox({ ...flatSignAt(d), side: d.side }, TEXT[lang][`door.${d.id}`], k);
      assert.ok(!meet({ ...sprite(p), y0: p.y - 35 }, sign), `${l.key} dpr ${dpr} ${lang}: ${p.x},${p.y} under the ${d.id} sign`);
    }
  }
});

test('seedCouriers and noteCalls: a seed brings nobody and sees every call; the same snapshot again brings nobody; a newer call one letter; two calls of a company in one snapshot one letter', () => {
  const c = seedCouriers([call(MS, 'teams_list_chats', 100)]);
  noteCalls(c, [call(MS, 'teams_list_chats', 100)]);
  assert.equal(c.list.length, 0);
  noteCalls(c, [call(MS, 'teams_list_chats', 200), call(GM, 'search_threads', 210), call('claude_ai_Google_Drive', 'search_files', 220)]);
  assert.deepEqual(c.list.map(k => [k.co, k.pending, k.product, k.s]), [['ms', 1, 'teams', 0], ['g', 1, 'drive', 0]]);
  noteCalls(c, [call(MS, 'teams_list_chats', 200), call(GM, 'search_threads', 210), call('claude_ai_Google_Drive', 'search_files', 220)]);
  assert.deepEqual(c.list.map(k => k.pending), [1, 1]);
  assert.deepEqual(seedCouriers([]).seen, { ms: -Infinity, g: -Infinity });
});

test('seedCouriers on a re-layout: the seen calls stay, so a call in the snapshot that grew the grid still sends its courier; a mount or tab return seed sees it', () => {
  const c = seedCouriers([call(MS, 'teams_list_chats', 100)]);
  const calls = [call(MS, 'teams_list_chats', 100), call(GM, 'search_threads', 200)];   // the new call and the bigger grid come together
  const grown = seedCouriers(calls, c);
  assert.deepEqual(grown.seen, { ms: 100, g: -Infinity });
  assert.notEqual(grown.seen, c.seen);
  noteCalls(grown, calls);
  assert.deepEqual(grown.list.map(k => [k.co, k.pending]), [['g', 1]]);
  const back = seedCouriers(calls);   // a mount or a tab return
  noteCalls(back, calls);
  assert.equal(back.list.length, 0);
});

test('a visit: walks in at twice agent speed, hands over for GIVE, lingers LINGER, walks out and is gone', () => {
  const c = seedCouriers([]);
  noteCalls(c, [call(MS, 'teams_list_chats', 1)]);
  run(c, 0, WALK - 40);
  assert.equal(one(c)!.mode, 'walk');
  run(c, WALK - 40, WALK + 40);
  assert.deepEqual([one(c)!.s, one(c)!.mode, one(c)!.giving, one(c)!.pending, one(c)!.dir], [SP.len, 'give', 'teams', 0, 'left']);
  assert.ok(deskBusy(c, SP));
  run(c, WALK + 40, WALK + GIVE + 60);
  assert.equal(one(c)!.mode, 'linger');
  run(c, WALK + GIVE + 60, WALK + GIVE + LINGER + 200);
  assert.equal(one(c)!.mode, 'walk');
  assert.ok(!deskBusy(c, SP));
  run(c, WALK + GIVE + LINGER + 200, 2 * WALK + GIVE + LINGER + 400);
  assert.equal(c.list.length, 0);
});

test('hold: the courier waits at the desk with its letter while its company\'s call runs or the foreman is away, then hands over', () => {
  const c = seedCouriers([]);
  noteCalls(c, [call(MS, 'outlook_send_mail', 1)]);
  run(c, 0, WALK + 3000, ['ms']);
  assert.deepEqual([one(c)!.mode, one(c)!.pending, deskBusy(c, SP)], ['hold', 1, true]);
  assert.deepEqual(courierPoses(c, SP, WALK + 3000).map(p => [p.tap, p.carry]), [[true, true]]);
  run(c, WALK + 3000, WALK + 4000, [], false);   // the call ended, the foreman is at the box
  assert.equal(one(c)!.mode, 'hold');
  run(c, WALK + 4000, WALK + 4040);
  assert.equal(one(c)!.mode, 'give');
});

test('hold cap: a call main lost (Esc, no PostToolUse) holds HOLD_MAX then hands over; a permission prompt holds on', () => {
  const c = seedCouriers([]);
  noteCalls(c, [call(MS, 'outlook_send_mail', 1)]);
  run(c, 0, WALK + HOLD_MAX - 200, ['ms']);
  assert.deepEqual([one(c)!.mode, deskBusy(c, SP)], ['hold', true]);
  run(c, WALK + HOLD_MAX - 200, WALK + HOLD_MAX + 200, ['ms']);   // the call is still in activeTools
  assert.equal(one(c)!.mode, 'give');
  const p = seedCouriers([]);
  noteCalls(p, [call(MS, 'outlook_send_mail', 1)]);
  run(p, 0, WALK + 3 * HOLD_MAX, ['ms'], true, SP, true);
  assert.equal(one(p)!.mode, 'hold');
  run(p, WALK + 3 * HOLD_MAX, WALK + 3 * HOLD_MAX + 40, ['ms']);   // the prompt gone (an Esc, then a new prompt), the call still listed
  assert.equal(one(p)!.mode, 'give');
});

test('linger: a call during the stay brings another hand-over and the stay starts again; one while walking in is a second letter', () => {
  const c = seedCouriers([]);
  noteCalls(c, [call(GM, 'search_threads', 1)]);
  run(c, 0, 1000);
  noteCalls(c, [call(GM, 'get_thread', 2)]);   // while walking in
  assert.equal(one(c, 'g')!.pending, 2);
  const at = WALK + GIVE + 1000;
  run(c, 1000, at);
  assert.deepEqual([one(c, 'g')!.mode, one(c, 'g')!.pending], ['give', 0]);   // the second letter right after the first
  run(c, at, at + GIVE + 1000);
  assert.equal(one(c, 'g')!.mode, 'linger');
  noteCalls(c, [call(GM, 'get_thread', 3)]);
  run(c, at + GIVE + 1000, at + GIVE + 1100);
  assert.equal(one(c, 'g')!.mode, 'give');
  run(c, at + GIVE + 1100, at + 2 * GIVE + 1100 + LINGER - 100);
  assert.deepEqual([one(c, 'g')!.mode, one(c, 'g')!.s], ['linger', SP.len]);   // the stay counts from the last hand-over
});

test('turn back: a call while walking out turns the same courier round to the desk; no second courier', () => {
  const c = seedCouriers([]);
  noteCalls(c, [call(MS, 'teams_list_chats', 1)]);
  const out = WALK + GIVE + LINGER + 1000;
  run(c, 0, out);
  const s = one(c)!.s;
  assert.ok(s < SP.len && s > 0 && one(c)!.mode === 'walk');
  noteCalls(c, [call(MS, 'teams_list_chats', 2)]);
  run(c, out, out + 200);
  assert.ok(one(c)!.s > s, 'it walks back in');
  run(c, out + 200, out + 1500);   // ~100 px back: there in about a second, then the hand-over
  assert.deepEqual([c.list.length, one(c)!.mode], [1, 'give']);
});

test('queue: two together go through the door DOOR_GAP apart; the first takes the desk, the second waits at the queue point, the first leaves right after its hand-over', () => {
  const c = seedCouriers([]);
  noteCalls(c, [call(MS, 'teams_list_chats', 1), call(GM, 'search_threads', 1)]);
  run(c, 0, 600);
  const [a, b] = [...c.list].sort((p, q) => q.s - p.s);
  assert.ok(b.s > 0 && a.s - b.s >= DOOR_GAP - CSPEED * 20 - 1e-9, `${a.s} − ${b.s}`);
  run(c, 600, WALK + 1000);
  assert.deepEqual([a.mode, b.mode, b.s, c.owner], ['give', 'queue', SP.queue, a.co]);
  run(c, WALK + 1000, WALK + GIVE + 200);
  assert.equal(a.mode, 'walk');   // no linger while one queues
  run(c, WALK + GIVE + 200, WALK + GIVE + 1200);
  assert.deepEqual([b.mode, c.owner], ['give', b.co]);
});

test('queue: the queued one waits LIFT up the aisle, the leaver walks PASS down, the queued one goes on once it is a sprite width past; one called while the other walks out waits outside; sprites (cap included) never meet each other or furniture, at the four sizes', () => {
  for (const l of LAYOUTS) for (let late of [0, 300, 1500, 3000, 6000, -500]) {   // the second call `late` ms after the first; −500: 500 ms into the walk out
    const sp = courierSpots(l), c = seedCouriers([]), walk = sp.len / CSPEED, out = late < 0;
    if (out) late = Math.ceil((walk + GIVE + LINGER - late) / 20) * 20;
    const solid = solids(l).filter((_, i) => i !== 1);   // walking: in front of the plant's pot, as on the lane
    noteCalls(c, [call(MS, 'teams_list_chats', 1)]);
    let passed = false;
    for (let t = 0; t <= late || one(c, 'ms'); t += 20) {   // till the first is out
      assert.ok(t < 3 * walk + 2 * GIVE + LINGER + late, `${l.key} +${late}: the first never left`);
      if (t === late) noteCalls(c, [call(MS, 'teams_list_chats', 1), call(GM, 'search_threads', 1)]);
      run(c, t, t + 20, [], true, sp);
      const ps = courierPoses(c, sp, t + 20), at = `${l.key} +${late} ${t}`;
      for (const p of ps) if (p.pt.x < sp.path[2].x && p.pt.y <= l.foreman.aisle + PASS) solid.forEach((r, i) => assert.ok(!meet(capped(p.pt), r), `${at}: ${p.pt.x},${p.pt.y} meets #${i}`));
      assert.ok(!out || ps.length < 2, `${at}: came in while the other walks out`);
      if (ps.length < 2) continue;
      const [a, b] = ps.map(p => p.pt);
      assert.ok(!meet(capped(a), capped(b)), `${at}: ${a.x},${a.y} and ${b.x},${b.y}`);
      passed ||= ps.some(p => p.pt.y === sp.queuePt.y + PASS) && ps.some(p => p.pt.y === sp.queuePt.y - LIFT && !p.walking);
    }
    assert.equal(passed, !out, `${l.key} +${late}: the leaver went PASS px down by the queued one LIFT px up`);
    // the first gone: the second has handed over, or is only now coming in
    assert.deepEqual(c.list.map(k => [k.co, k.pending]), [['g', out ? 1 : 0]]);
  }
});

test('handover: hand, a 10 px arc onto the desk, then the icon balloon rises 4 px; the foreman reads from the landing', () => {
  assert.deepEqual(handover(-1), { letter: null, k: 0, lift: 0, rise: null, read: false });
  assert.equal(handover(100).letter, 'hand');
  const mid = handover(425);
  assert.deepEqual([mid.letter, mid.k, mid.lift], ['fly', 0.5, 10]);
  assert.deepEqual([handover(700).letter, handover(700).read], ['desk', true]);
  assert.deepEqual([handover(900).letter, handover(900).rise, handover(1200).rise], [null, 0, 4]);
  assert.deepEqual(handover(GIVE), { letter: null, k: 0, lift: 0, rise: null, read: false });
});

test('foremanAtDesk: placed and at rest and not at the box; none on the floor or walking in is not', () => {
  const as = [agent({ id: 'f', role: 'foreman', stage: 'waiting' })], sc = officeScene(as, 0, MIN), w = new Map<string, Walker>();
  syncWalkers(w, sc.places, MIN, true, 0);
  assert.deepEqual([foremanAtDesk(sc, w, false), foremanAtDesk(sc, w, true)], [true, false]);   // a waiting foreman still sits
  w.get('f')!.moving = true;
  assert.equal(foremanAtDesk(sc, w, false), false);
  assert.equal(foremanAtDesk(officeScene([], 0, MIN), new Map(), false), false);
});

test('courierPoses: nobody at the Entrance yet; carry while a letter waits; give is t into the hand-over; the product handed over', () => {
  const c = seedCouriers([]);
  noteCalls(c, [call(GM, 'search_threads', 1)]);
  assert.deepEqual(courierPoses(c, SP, 0), []);
  run(c, 0, 1000);
  assert.deepEqual(courierPoses(c, SP, 1000).map(p => [p.co, p.walking, p.carry, p.give, p.product]), [['g', true, true, null, 'gmail']]);
  run(c, 1000, WALK + 300);
  const p = courierPoses(c, SP, WALK + 300)[0];
  assert.deepEqual([p.walking, p.carry, p.product], [false, false, 'gmail']);
  assert.ok(p.give! >= 0 && p.give! < GIVE);
});
