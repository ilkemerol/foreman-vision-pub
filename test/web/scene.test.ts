import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cafeSide, doneAisle, doneSeats, officeLayout, queueSpot, sofaSeats, waitAisle, waitSpots, type Fit } from '../../web/src/logic/layout.ts';
import { hash } from '../../web/src/logic/model.ts';
import { blockOrder, deskCells } from '../../web/src/logic/team.ts';
import { assignDesks, atWork, BURN_HOLD_MS, deskDemand, deskMemory, doneMemory, doneSeating, FAIL_RELEASE_MS, hitAt, keepFloors, officeScene, rememberDone, themeOf, THEMES } from '../../web/src/logic/scene.ts';
import type { AgentView } from '../../shared/types.ts';
import { agent } from './fake.ts';

const fit = (w: number, h: number, o: Partial<Fit> = {}): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0, ...o });
const MIN = officeLayout(fit(1114, 589)), BIG = officeLayout(fit(2308, 1372));   // 34×18 and 47×25

const roomOf = (m: Map<string, number>) => Object.fromEntries([...m].map(([id, i]) => [id, MIN.desks[i].room]));
test('assignDesks: room = hash(id) mod 3, a desk in it the key picks; a full room overflows to the next', () => {
  const ag = (['a-hot', 'a-hook', 'a-lint', 'a-config', 'a-engine'] as const).map((id, i) => agent({ id, startedAt: i + 1 }));
  const m = assignDesks(ag, MIN);   // hashes: a-hot, a-hook, a-lint → Library (2 desks); a-config → Server room; a-engine → main office
  assert.deepEqual(roomOf(m), { 'a-hot': 'library', 'a-hook': 'library', 'a-lint': 'main', 'a-config': 'server', 'a-engine': 'main' });
  assert.deepEqual([m.get('a-lint'), m.get('a-engine')], [0, 5]);   // a-lint's pick is desk 0, a-engine's desk 5
});
test('assignDesks: the desk in the room is the key\'s pick, the same for any snapshot order and any reload', () => {
  const ag = ['r', 'g', 'n', 'x', 'm1', 'c', 'e', 'a', 'b'].map((id, i) => agent({ id, startedAt: i * 10 }));
  const m = assignDesks(ag, MIN);
  assert.deepEqual(assignDesks([...ag].reverse(), MIN), m);
  assert.deepEqual(assignDesks(ag.map(a => ({ ...a })), MIN), m);
  assert.equal(new Set(m.values()).size, ag.length, 'one agent per desk');
});
test('assignDesks: alone in the office, agents spread over every desk of their room, not the first ones', () => {
  const keys = Array.from({ length: 200 }, (_, i) => `toolu_${i}`);
  for (const r of ROOMS) {
    const mine = keys.filter(k => ROOMS[hash(k) % 3] === r), desks = new Set(mine.map(k => assignDesks([agent({ id: k })], BIG).get(k)!));
    assert.deepEqual([...desks].sort((a, b) => a - b), BIG.desks.flatMap((d, i) => (d.room === r ? [i] : [])), r);
  }
  // three in one room do not sit at its first three desks
  const three = ['r', 'g', 'n'].map((id, i) => agent({ id, startedAt: i })), m = assignDesks(three, BIG);
  assert.notDeepEqual(three.map(a => m.get(a.id)!).sort((a, b) => a - b), [0, 1, 2]);
});
test('assignDesks: someone finishing moves nobody; the next agent of that room takes the freed desk', () => {
  const base = ['a-hot', 'a-hook', 'a-config', 'a-engine'].map((id, i) => agent({ id, startedAt: i + 1 }));
  const before = assignDesks(base, MIN);
  const after = assignDesks([...base.map(a => a.id === 'a-hook' ? { ...a, stage: 'done' as const, stageSince: 10 } : a), agent({ id: 'a-new', startedAt: 11 })], MIN);
  for (const a of base) if (a.id !== 'a-hook') assert.equal(after.get(a.id), before.get(a.id), a.id);
  assert.equal(after.get('a-new'), before.get('a-hook'));
});
test('deskDemand: the most desks held at once; a finish does not lower it; placeholders hold none', () => {
  const a = agent({ id: 'a', startedAt: 1 }), b = agent({ id: 'b', startedAt: 2 }), c = agent({ id: 'c', startedAt: 3 });
  assert.equal(deskDemand([a, b, c]), 3);
  assert.equal(deskDemand([a, { ...b, stage: 'done', stageSince: 4 }, c, agent({ id: 'd', startedAt: 5 })]), 3);
  assert.equal(deskDemand([agent({ id: 'board:1', role: 'placeholder', stage: 'queued' })]), 0);
});
test('deskDemand: verifying keeps the desk after endedAt; failed frees after the sequence; abandoned at stageSince', () => {
  const v = agent({ id: 'v', stage: 'verifying', startedAt: 1000, endedAt: 2000, stageSince: 2500 });
  assert.equal(deskDemand([v, agent({ id: 'n', startedAt: 3000 })]), 2);
  const f = agent({ id: 'f', stage: 'failed', startedAt: 1000, stageSince: 2000 });
  assert.equal(deskDemand([f, agent({ id: 'early', startedAt: 2000 + FAIL_RELEASE_MS - 1 })]), 2);
  assert.equal(deskDemand([f, agent({ id: 'late', startedAt: 2000 + FAIL_RELEASE_MS })]), 1);
  const ab = agent({ id: 'ab', stage: 'abandoned', startedAt: 1000, stageSince: 2000 });
  assert.equal(deskDemand([ab, agent({ id: 'x', startedAt: 2000 })]), 1);
});
test('deskDemand (page): one that runs again does not grow the grid backwards; really more at once does', () => {
  // r stops at 100; x0…x9 fill MIN's 10 desks; x9 stops at 300; r runs again at 400: 10 at once, the replay counts 11
  const r = (o: Partial<AgentView>) => agent({ id: 'r', startedAt: 0, ...o });
  const xs = Array.from({ length: 10 }, (_, i) => agent({ id: `x${i}`, startedAt: 200 + i, stageSince: 200 + i }));
  const mem = deskMemory();
  const see = (ag: AgentView[], now: number) => {
    const l = officeLayout(fit(1114, 589, { demand: deskDemand(ag, { mem, now }) })), { places } = officeScene(ag, now, l, [], mem);
    return { key: l.key, desk: (id: string) => places.get(id)?.desk };
  };
  const first = see([r({ stage: 'done', stageSince: 100 }), ...xs], 250);
  assert.equal(first.key, MIN.key);
  const back = [r({ stageSince: 400 }), ...xs.map(x => x.id === 'x9' ? { ...x, stage: 'done' as const, stageSince: 300 } : x)];
  assert.equal(deskDemand(back), 11);   // the replay alone, without r's stop in its history
  assert.equal(deskDemand(back.map(a => a.id === 'r' ? { ...a, breaks: [[100, 400]] } : a)), 10);   // with it: what the page held
  const then = see(back, 400);
  assert.equal(then.key, first.key);
  for (const x of xs.slice(0, 9)) assert.equal(then.desk(x.id), first.desk(x.id), x.id);
  assert.equal(then.desk('r'), first.desk('x9'));   // the one desk free
  assert.notEqual(see([...back, agent({ id: 'y', startedAt: 500, stageSince: 500 })], 500).key, first.key);   // eleven at once
});
test('assignDesks (page): a new grid (a zoom step) drops the old grid\'s seats, so every desk is one of the new grid', () => {
  const ag = ['a', 'b', 'c', 'd'].map((id, i) => agent({ id, startedAt: i })), mem = deskMemory();
  const big = assignDesks(ag, BIG, { mem, now: 10 });
  assert.ok([...big.values()].some(d => d >= MIN.desks.length), 'some BIG desk is past MIN\'s');
  const min = assignDesks(ag, MIN, { mem, now: 20 });
  assert.equal(mem.grid, MIN.key);
  for (const [id, d] of min) assert.ok(d < MIN.desks.length, id);
  assert.deepEqual(min, assignDesks(ag, MIN));   // seeded anew, as a fresh page on MIN would
});
const ROOMS = ['main', 'server', 'library'] as const;
test('assignDesks: a pending agent and its bound successor share the spawn key, so the room and the desk stay', () => {
  // the ids alone would pick different rooms: pending:T2 → Library, A2 → Server room; the key T2 → main office
  assert.deepEqual([ROOMS[hash('pending:T2') % 3], ROOMS[hash('A2') % 3], ROOMS[hash('T2') % 3]], ['library', 'server', 'main']);
  const others = ['a-hot', 'a-config', 'a-engine'].map((id, i) => agent({ id, startedAt: 100 + i }));
  const before = assignDesks([...others, agent({ id: 'pending:T2', key: 'T2', stage: 'spawning', startedAt: 1000 })], MIN);
  const after = assignDesks([...others, agent({ id: 'A2', key: 'T2', startedAt: 1000 })], MIN);
  assert.equal(MIN.desks[after.get('A2')!].room, 'main');
  assert.equal(after.get('A2'), before.get('pending:T2'));
  for (const a of others) assert.equal(after.get(a.id), before.get(a.id), a.id);
});
test('assignDesks: two parallel spawns in one room bind out of order and neither desk moves', () => {
  const other = agent({ id: 'a-engine', startedAt: 500 });   // main office, like the keys T2 and T4
  const steps = [
    [agent({ id: 'pending:T2', key: 'T2', stage: 'spawning', startedAt: 1000 }), agent({ id: 'pending:T4', key: 'T4', stage: 'spawning', startedAt: 1100 })],
    [agent({ id: 'pending:T2', key: 'T2', stage: 'spawning', startedAt: 1000 }), agent({ id: 'B4', key: 'T4', startedAt: 1100 })],   // the later one binds first
    [agent({ id: 'A2', key: 'T2', startedAt: 1000 }), agent({ id: 'B4', key: 'T4', startedAt: 1100 })],
  ];
  const byKey = (ag: AgentView[]) => { const m = assignDesks([other, ...ag], MIN); return [m.get('a-engine'), ...ag.map(a => m.get(a.id))]; };
  const first = byKey(steps[0]);
  assert.deepEqual(first.map(i => MIN.desks[i!].room), ['main', 'main', 'main']);
  for (const s of steps) assert.deepEqual(byKey(s), first);
});
test('officeScene: a pending agent keeps its body sprite when it binds to its agent id (the spawn key picks it)', () => {
  // real spool: PreToolUse(Agent) toolu_015NYH… → SubagentStart/PostToolUse abba4fd4d9458f4d6 about 1 s later
  const T = 'toolu_015NYHtJf9NTajJhraNy9fEp', A = 'abba4fd4d9458f4d6';
  assert.notEqual(hash('pending:' + T) % 6, hash(A) % 6, 'the ids alone pick different sprites');
  const sprite = (a: AgentView) => officeScene([a], 2000, MIN).places.get(a.id)!.sprite;
  assert.equal(sprite(agent({ id: A, key: T })), sprite(agent({ id: 'pending:' + T, key: T, stage: 'spawning' })));
});
// the page's view: each snapshot through one DeskMemory, the desk of every agent drawn at one (release later than t)
const watch = (l = MIN) => {
  const mem = deskMemory();
  return (ag: AgentView[], t: number) => {
    const { places } = officeScene(ag, t, l, [], mem);
    return new Map([...places].filter(([, p]) => p.kind === 'desk').map(([id, p]) => [id, p.desk]));
  };
};
test('officeScene: one that stopped and runs again moves nobody seated meanwhile', () => {
  // r, g, n → main office. r stops at 100; g and n sit at the room's first two desks; r's follow-up resumes it at 300
  assert.deepEqual(['r', 'g', 'n'].map(k => ROOMS[hash(k) % 3]), ['main', 'main', 'main']);
  const r = (o: Partial<AgentView>) => agent({ id: 'r', startedAt: 0, ...o });
  const g = agent({ id: 'g', startedAt: 200, stageSince: 200 }), n = agent({ id: 'n', startedAt: 201, stageSince: 201 });
  const see = watch();
  see([r({ stageSince: 0 })], 50);
  const before = see([r({ stage: 'done', stageSince: 100 }), g, n], 250);
  const after = see([r({ stageSince: 300 }), g, n], 300);
  assert.deepEqual([after.get('g'), after.get('n')], [before.get('g'), before.get('n')]);
  assert.ok(after.has('r') && ![after.get('g'), after.get('n')].includes(after.get('r')), 'r sits at a free desk');
});
test('assignDesks: a reload replays every stretch (breaks), so it seats everyone where the live page did', () => {
  // g, n, x pick r's desk. r stops at 100, g takes its desk, r resumes at 300; g stops, x comes, r stops and resumes again
  const r = (o: Partial<AgentView>) => agent({ id: 'r', startedAt: 0, ...o });
  const g = agent({ id: 'k1', startedAt: 200, stageSince: 200 }), n = agent({ id: 'k14', startedAt: 201, stageSince: 201 });
  const x = agent({ id: 'k41', startedAt: 500, stageSince: 500 }), gDone = { ...g, stage: 'done' as const, stageSince: 400, endedAt: 400 };
  const one = (id: string) => assignDesks([agent({ id })], MIN).get(id);
  assert.deepEqual(['k1', 'k14', 'k41'].map(one), [one('r'), one('r'), one('r')]);
  const steps: [AgentView[], number][] = [
    [[r({})], 50],
    [[r({ stage: 'done', stageSince: 100, endedAt: 100 }), g, n], 250],
    [[r({ stageSince: 300, breaks: [[100, 300]] }), g, n], 300],
    [[r({ stageSince: 300, breaks: [[100, 300]] }), gDone, n, x], 500],
    [[r({ stage: 'done', stageSince: 600, endedAt: 600, breaks: [[100, 300]] }), gDone, n, x], 600],
    [[r({ stageSince: 700, breaks: [[100, 300], [600, 700]] }), gDone, n, x], 700],
  ];
  const see = watch(), sorted = (m: Map<string, number | null>) => Object.fromEntries([...m].sort());
  const live = steps.map(([ag, t]) => see(ag, t));
  assert.equal(live[1].get('k1'), live[0].get('r'), 'r\'s desk is taken while it is away');
  steps.forEach(([ag, t], k) => {
    const reload = assignDesks(ag, MIN);
    assert.deepEqual(sorted(new Map([...live[k]].map(([id]) => [id, reload.get(id) ?? null]))), sorted(live[k]), `reload at ${t}`);
  });
});
// team seating
const L52 = officeLayout(fit(1700, 901, { sb: 15, frame: true }));   // the 1920 window's 52×27: main office 3×4, Server room 2×3, Library 1×3
const tm = (id: string, startedAt: number, o: Partial<AgentView> = {}) => agent({ id, type: 'marketing:seo', startedAt, stageSince: startedAt, ...o });
const gp = (id: string, startedAt: number, o: Partial<AgentView> = {}) => agent({ id, type: 'general-purpose', startedAt, stageSince: startedAt, ...o });
const keyIn = (room: string, prefix: string, skip = 0) => Array.from({ length: 200 }, (_, i) => `${prefix}${i}`).filter(k => ROOMS[hash(k) % 3] === room)[skip];
const keyAt = (desk: number, others: AgentView[], startedAt: number) =>   // a general-purpose key whose pick is `desk`
  Array.from({ length: 2000 }, (_, i) => `g${i}`).find(k => assignDesks([...others, gp(k, startedAt)], L52).get(k) === desk)!;
const occupy = (desks: number[]) => desks.reduce<AgentView[]>((ag, d, k) => [...ag, gp(keyAt(d, ag, k + 1), k + 1)], []);   // general-purpose agents on these desks
// one room, two neighbouring rows and two neighbouring columns, one desk each
const square = (l: typeof MIN, ds: number[]) => {
  const c = deskCells(l), span = (k: 'row' | 'col') => { const v = [...new Set(ds.map(d => c[d][k]))].sort((a, b) => a - b); return v.length === 2 && v[1] - v[0] === 1; };
  return new Set(ds).size === 4 && new Set(ds.map(d => l.desks[d].room)).size === 1 && span('row') && span('col');
};
const near = (l: typeof MIN, ds: number[]) => {   // all within one 2×2 of one room
  const c = deskCells(l), span = (k: 'row' | 'col') => Math.max(...ds.map(d => c[d][k])) - Math.min(...ds.map(d => c[d][k]));
  return new Set(ds.map(d => l.desks[d].room)).size === 1 && span('row') <= 1 && span('col') <= 1;
};
test('assignDesks: team-less agents sit where they did before teams while no team is in', () => {
  const t = (i: number) => (i % 2 ? 'claude' : 'general-purpose'), seat = (m: Map<string, number>) => Object.fromEntries(m);
  // the desks the code gave before team seating (the first three assignDesks tests' agents)
  assert.deepEqual(seat(assignDesks(['a-hot', 'a-hook', 'a-lint', 'a-config', 'a-engine'].map((id, i) => agent({ id, type: t(i), startedAt: i + 1 })), MIN)),
    { 'a-hot': 8, 'a-hook': 9, 'a-lint': 0, 'a-config': 6, 'a-engine': 5 });
  assert.deepEqual(seat(assignDesks(['r', 'g', 'n', 'x', 'm1', 'c', 'e', 'a', 'b'].map((id, i) => agent({ id, type: t(i), startedAt: i * 10 })), MIN)),
    { r: 5, g: 0, n: 3, x: 4, m1: 1, c: 8, e: 9, a: 7, b: 6 });
  assert.deepEqual(seat(assignDesks(['r', 'g', 'n'].map((id, i) => agent({ id, type: t(i), startedAt: i })), BIG)), { r: 11, g: 6, n: 3 });
});
test('assignDesks: four marketing:* arriving at once sit in one room as a 2×2 square', () => {
  for (const room of ['main', 'server']) {   // the first one's room (the Library has one row)
    const types = ['marketing:copywriter', 'marketing:seo', 'marketing:social', 'marketing:analytics'];
    const ag = [keyIn(room, 'a-'), 'z1', 'z2', 'z3'].map((id, i) => agent({ id, type: types[i], startedAt: 100 })), m = assignDesks(ag, L52);
    const ds = ag.map(a => m.get(a.id)!);
    assert.ok(square(L52, ds), `${room}: ${ds}`);
    assert.equal(L52.desks[ds[0]].room, room);
  }
});
test('assignDesks: a team whose room is full gathers in a block in the main office', () => {
  // the Server room's right column held leaves it one free 2×2 (desks 12, 13, 15, 16), which the first four fill
  const first = keyIn('server', 'a-'), ag = [...occupy([14, 17]), ...[first, 't2', 't3', 't4', 't5', 't6', 't7'].map((id, k) => tm(id, 10 + k))];
  const m = assignDesks(ag, L52), rest = ['t5', 't6', 't7'].map(id => m.get(id)!);
  assert.deepEqual([first, 't2', 't3', 't4'].map(id => m.get(id)!).sort((a, b) => a - b), [12, 13, 15, 16]);
  assert.deepEqual(rest.map(d => L52.desks[d].room), ['main', 'main', 'main']);
  assert.ok(near(L52, rest), `${rest}`);
});
test('assignDesks: a taken desk in the block is skipped, the team stays together', () => {
  const first = keyIn('main', 'a-'), A = assignDesks([tm(first, 0)], L52).get(first)!, bo = blockOrder(L52, A, 0);
  const g = keyAt(bo[1], [tm(first, 0)], 1);
  const m = assignDesks([tm(first, 0), gp(g, 1), tm('t2', 2), tm('t3', 3), tm('t4', 4)], L52);
  assert.equal(m.get(g), bo[1]);
  assert.deepEqual([first, 't2', 't3', 't4'].map(id => m.get(id)), [bo[0], bo[2], bo[3], bo[4]]);
});
// L52 main rows 0–2 × cols 0–3 (desks 0–11), Server room rows 0–1 × cols 0–2 (12–17): its middle row / column held kills every free 2×2
test('assignDesks: a team\'s first member skips its room without a free 2×2 for the next room in its order with one', () => {
  const ag = [...occupy([4, 5, 6, 7]), ...[keyIn('main', 'a-'), 't2', 't3', 't4'].map(id => tm(id, 10))], m = assignDesks(ag, L52);
  const ds = ag.slice(4).map(a => m.get(a.id)!);
  assert.equal(L52.desks[ds[0]].room, 'server');
  assert.ok(square(L52, ds), `${ds}`);
});
test('assignDesks: with no free 2×2 anywhere a team\'s first member sits as before', () => {
  const first = keyIn('main', 'a-'), ag = [...occupy([4, 5, 6, 7, 13, 16]), tm(first, 10)];
  assert.equal(assignDesks(ag, L52).get(first), 8);   // the desk the code gave before the 2×2 preference
});
test('assignDesks (page): a new team member arriving moves nobody seated, even one starting earlier', () => {
  const mem = deskMemory(), see = (ag: AgentView[], now: number) => assignDesks(ag, L52, { mem, now });
  const steps = [[tm('t1', 10), tm('t2', 11)], [tm('t0', 5)], [gp('g1', 1)]], ag: AgentView[] = [], seen = new Map<string, number>();
  steps.forEach((more, k) => {
    ag.push(...more);
    const m = see([...ag], 100 + k);
    for (const [id, d] of seen) assert.equal(m.get(id), d, `${id} moves at step ${k}`);
    for (const [id, d] of m) seen.set(id, d);
  });
  assert.equal(new Set(seen.values()).size, 4);
  assert.deepEqual(['t0', 't2'].map(id => L52.desks[seen.get(id)!].room), [L52.desks[seen.get('t1')!].room, L52.desks[seen.get('t1')!].room]);
});
test('assignDesks (page): a late team member with an earlier startedAt joins its seated mates\' block, not the replay\'s', () => {
  const mem = deskMemory(), see = (ag: AgentView[], now: number) => assignDesks(ag, L52, { mem, now }), mates = [tm('t1', 10), tm('t2', 11)];
  const first = see(mates, 100), m = see([...mates, tm('t0', 5)], 101), held = new Set(first.values());
  assert.notEqual(L52.desks[assignDesks([...mates, tm('t0', 5)], L52).get('t0')!].room, L52.desks[first.get('t1')!].room, 'the replay seats the team elsewhere');
  assert.equal(m.get('t0'), blockOrder(L52, first.get('t1')!, hash('t0')).find(d => !held.has(d)));
  assert.ok(near(L52, [m.get('t0')!, first.get('t1')!]));
});
test('assignDesks (page): a fresh page seats a team where the replay does, though a desk its block skipped is free now', () => {
  // g held the block's second desk when t2 came and has left since: a reload keeps t2 past it, as the live page did
  const A = assignDesks([tm('t1', 0)], L52).get('t1')!, bo = blockOrder(L52, A, 0), g = keyAt(bo[1], [tm('t1', 0)], 1);
  const ag = [tm('t1', 0), gp(g, 1, { stage: 'done', stageSince: 20 }), tm('t2', 10)];
  assert.equal(assignDesks(ag, L52).get('t2'), bo[2]);
  assert.deepEqual(assignDesks(ag, L52, { mem: deskMemory(), now: 30 }), assignDesks(ag, L52));
});
test('assignDesks (page): one whose type turns from unknown to marketing:seo at its bind keeps its desk', () => {
  const mem = deskMemory(), see = (ag: AgentView[], now: number) => assignDesks(ag, L52, { mem, now }), mates = [tm('t1', 0), tm('t2', 1)];
  const before = see([...mates, agent({ id: 'x', type: 'unknown', startedAt: 2, stageSince: 2 })], 10);
  const after = see([...mates, tm('x', 2)], 11);
  assert.deepEqual(after, before);
  assert.notEqual(assignDesks([...mates, tm('x', 2)], L52).get('x'), before.get('x'), 'a reload seats it with its team');
});
test('assignDesks: a team agent running again whose desk was taken sits in its live mates\' block', () => {
  // t1 sits alone, t2 and t3 join its block; t1 stops at 100 and g takes its desk; t1 runs again at 300
  const t1 = (o: Partial<AgentView>) => tm('t1', 0, o), mates = [tm('t2', 10), tm('t3', 11)];
  const A = assignDesks([t1({}), ...mates], L52).get('t1')!, g = keyAt(A, [t1({ stage: 'done', stageSince: 100 }), ...mates], 200);
  const m = assignDesks([t1({ stageSince: 300, breaks: [[100, 300]] }), ...mates, gp(g, 200)], L52);
  assert.equal(m.get(g), A);
  const held = new Set([m.get('t2'), m.get('t3'), A]);
  assert.equal(m.get('t1'), blockOrder(L52, m.get('t2')!, hash('t1')).find(d => !held.has(d)));
  assert.ok(near(L52, [m.get('t1')!, m.get('t2')!]));
});
test('assignDesks (page): the same snapshot again changes nothing; on a new grid (a zoom step) the team is together again', () => {
  const ag = [keyIn('main', 'a-'), 'z1', 'z2', 'z3'].map(id => tm(id, 100)), mem = deskMemory();
  const a = assignDesks(ag, L52, { mem, now: 200 });
  assert.deepEqual(assignDesks(ag, L52, { mem, now: 200 }), a);
  assert.ok(square(L52, ag.map(x => a.get(x.id)!)));
  const b = assignDesks(ag, MIN, { mem, now: 300 });
  assert.ok(square(MIN, ag.map(x => b.get(x.id)!)), `${[...b.values()]}`);
  assert.deepEqual(b, assignDesks(ag, MIN));
});
test('assignDesks: with teams too a reload seats everyone where the live page did', () => {
  const t1 = (o: Partial<AgentView>) => tm('t1', 0, o), t2 = tm('t2', 1), g = gp('g', 2), t3 = tm('t3', 200), t4 = agent({ id: 't4', type: 'marketing:social', startedAt: 500, stageSince: 500 });
  const t1r = t1({ stageSince: 300, breaks: [[100, 300]] }), t2Done = { ...t2, stage: 'done' as const, stageSince: 400, endedAt: 400 };
  const steps: [AgentView[], number][] = [
    [[t1({}), t2, g], 5],
    [[t1({ stage: 'done', stageSince: 100, endedAt: 100 }), t2, g, t3], 200],
    [[t1r, t2, g, t3], 300],
    [[t1r, t2Done, g, t3, t4], 500],
  ];
  const see = watch(L52), sorted = (m: Map<string, number | null>) => Object.fromEntries([...m].sort());
  steps.forEach(([ag, t]) => {
    const live = see(ag, t), reload = assignDesks(ag, L52);
    assert.deepEqual(sorted(new Map([...live].map(([id]) => [id, reload.get(id) ?? null]))), sorted(live), `reload at ${t}`);
  });
});
test('officeScene: agents arriving one by one in any startedAt order never move a seated one', () => {
  // five main office keys and two Library ones (2 desks: one overflows) arrive in every order of their startedAt
  const keys = ['r', 'g', 'n', 'x', 'm1', 'c', 'e'], starts = [70, 10, 50, 30, 60, 20, 40];
  const perms = (xs: number[]): number[][] => xs.length ? xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p])) : [[]];
  for (const order of perms([0, 1, 2, 3, 4, 5, 6]).filter((_, i) => i % 7 === 0)) {
    const see = watch(), ag: AgentView[] = [], seen = new Map<string, number | null>();
    order.forEach((k, t) => {
      ag.push(agent({ id: keys[k], startedAt: starts[k], stageSince: starts[k] }));
      const m = see([...ag], 100 + t);
      for (const [id, d] of seen) assert.equal(m.get(id), d, `${id} moves when ${keys[k]} arrives (order ${order.map(i => keys[i])})`);
      for (const [id, d] of m) seen.set(id, d);
      assert.equal(new Set(m.values()).size, m.size, 'one agent per desk');
    });
  }
});
test('officeScene: 30 agents on a 1920 window all get a desk of their own', () => {
  const many = Array.from({ length: 30 }, (_, i) => agent({ id: `x${i}`, startedAt: i }));
  const l = officeLayout(fit(1668, 1012, { demand: deskDemand(many) })), { places } = officeScene(many, 0, l);
  assert.ok(many.every(a => places.get(a.id)?.kind === 'desk'));
  assert.equal(new Set(many.map(a => places.get(a.id)!.desk)).size, 30);
});
test('officeScene: another window keeps each agent\'s room (re-layout)', () => {
  const ag = ['a-hot', 'a-config', 'a-engine', 'a-docs'].map((id, i) => agent({ id, startedAt: i }));
  const rooms = (l: typeof MIN) => { const m = assignDesks(ag, l); return ag.map(a => l.desks[m.get(a.id)!].room); };
  assert.deepEqual(rooms(MIN), rooms(BIG));
});
test('officeScene: a stale-board agent stays seated; when the board catches up nobody changes desk', () => {
  // a stops at 100 with its row still running; b starts at 105; the board then says verifying or failed, later done
  const a = (o: Partial<AgentView>) => agent({ id: 'a', startedAt: 0, ...o }), b = agent({ id: 'b', startedAt: 105, stageSince: 105 });
  for (const next of [a({ stage: 'verifying', stageSince: 110 }), a({ stage: 'failed', stageSince: 110 })]) {
    const steps: [AgentView[], number][] = [
      [[a({ stageSince: 0 })], 50], [[a({ stage: 'done', badges: ['stale-board'], stageSince: 100 }), b], 106],
      [[next, b], 111], [[a({ stage: 'done', stageSince: 120 }), b], 121],
    ];
    const desks = new Map<string, number>();
    for (const [agents, now] of steps) {
      const { places } = officeScene(agents, now, MIN), at = `${next.stage}, now ${now}`;
      for (const id of ['a', 'b']) {
        const d = places.get(id)?.desk;
        if (d == null) continue;
        assert.equal(d, desks.get(id) ?? d, `${id} at ${at}`);
        desks.set(id, d);
      }
      if (now === 106) assert.deepEqual([places.get('a')!.kind, places.get('a')!.pose, places.get('a')!.spot.pt], ['desk', 'read', MIN.desks[desks.get('a')!].seat], at);
      if (now === 111) assert.equal(places.get('a')!.kind, next.stage === 'failed' ? 'fail' : 'desk', at);
    }
    assert.notEqual(desks.get('a'), desks.get('b'));
  }
});
test('officeScene: every stage has its place', () => {
  const agents = [
    agent({ id: 'main', role: 'foreman', stage: 'waiting', alert: true }),
    agent({ id: 'r', startedAt: 1 }), agent({ id: 'v', stage: 'verifying', startedAt: 2 }),
    agent({ id: 'w', stage: 'waiting', startedAt: 3 }), agent({ id: 'd', stage: 'done', startedAt: 4 }),
    agent({ id: 'f', stage: 'failed', startedAt: 5, stageSince: 0 }), agent({ id: 'ab', stage: 'abandoned', startedAt: 6 }),
    agent({ id: 'board:1', role: 'placeholder', stage: 'queued', startedAt: 0 }),
    agent({ id: 'board:2', role: 'placeholder', stage: 'waiting', alert: true, startedAt: 0 }),
    agent({ id: 'board:3', role: 'placeholder', stage: 'failed', startedAt: 0 }),
  ];
  const { places } = officeScene(agents, 1000, MIN);
  const p = (id: string) => places.get(id)!;
  assert.deepEqual([p('main').kind, p('main').spot.pt, p('main').bubble], ['foreman', MIN.foreman.seat, 'alert']);
  assert.deepEqual([p('r').kind, p('r').spot.pt, p('r').pose, p('r').face], ['desk', MIN.desks[p('r').desk!].seat, 'type', 'up']);
  assert.equal(p('r').spot.room, MIN.desks[p('r').desk!].room);
  assert.equal(p('v').pose, 'read');
  assert.deepEqual([p('w').kind, p('w').spot.room, p('w').bubble, p('w').desk], ['wait', 'wait', 'info', assignDesks(agents, MIN).get('w')]);
  assert.deepEqual([p('d').kind, p('d').spot.pt], ['done', doneSeats(MIN)[0]]);
  assert.equal(p('f').kind, 'fail');
  assert.deepEqual([p('ab').kind, p('ab').alpha], ['desk', 0.35]);
  assert.deepEqual([p('board:1').kind, p('board:1').alpha, p('board:1').spot.pt], ['queue', 0.5, queueSpot(0, MIN)]);
  assert.deepEqual([p('board:2').kind, p('board:2').alpha, p('board:2').bubble], ['wait', 0.6, 'alert']);
  assert.equal(places.has('board:3'), false);
});
test('officeScene: a failed agent past FAIL_RELEASE_MS leaves the office; its desk goes to the next agent', () => {
  const f = agent({ id: 'f', stage: 'failed', startedAt: 1000, stageSince: 2000 });   // f and next: both Library
  const n = agent({ id: 'next', startedAt: 2000 + FAIL_RELEASE_MS });
  const before = officeScene([f], 2000 + FAIL_RELEASE_MS - 1, MIN).places;
  assert.equal(before.get('f')!.kind, 'fail');
  const { places } = officeScene([f, n], 2000 + FAIL_RELEASE_MS, MIN);
  assert.equal(places.has('f'), false);
  assert.equal(places.get('next')!.desk, officeScene([n], 2000 + FAIL_RELEASE_MS, MIN).places.get('next')!.desk);   // f holds nothing
});
test('officeScene: of two abandoned owners of one desk only the latest stays', () => {
  const a1 = agent({ id: 'ab4', stage: 'abandoned', startedAt: 1000, stageSince: 2000 });   // both Server room, both pick its desk 1
  const a2 = agent({ id: 'ab2', stage: 'abandoned', startedAt: 3000, stageSince: 4000 });
  const { places } = officeScene([a2, a1], 5000, MIN);
  assert.deepEqual([places.has('ab4'), places.get('ab2')!.desk], [false, MIN.desks.filter(d => d.room === 'server').map(d => MIN.desks.indexOf(d))[1]]);
});
test('officeScene: of two abandoned owners of one desk the latest stretch stays, not the latest start', () => {
  // ab4 starts first, is abandoned at 2000 and comes back at 5000; ab2 sits there over [3000, 4000)
  const a1 = agent({ id: 'ab4', stage: 'abandoned', startedAt: 1000, stageSince: 6000, breaks: [[2000, 5000]] });
  const a2 = agent({ id: 'ab2', stage: 'abandoned', startedAt: 3000, stageSince: 4000 });
  const { places } = officeScene([a2, a1], 7000, MIN);
  assert.deepEqual([places.get('ab4')?.desk, places.has('ab2')], [MIN.desks.filter(d => d.room === 'server').map(d => MIN.desks.indexOf(d))[1], false]);
});
test('officeScene: waiting, done and queue places go in (stageSince, id) order', () => {
  const { places } = officeScene([
    agent({ id: 'w2', stage: 'waiting', stageSince: 300 }), agent({ id: 'w1', stage: 'waiting', stageSince: 100 }),
    agent({ id: 'wb', stage: 'waiting', stageSince: 200 }), agent({ id: 'wa', stage: 'waiting', stageSince: 200 }),
    agent({ id: 'd2', stage: 'done', stageSince: 50 }), agent({ id: 'd1', stage: 'done', stageSince: 10 }),
    agent({ id: 'board:2', role: 'placeholder', stage: 'queued', stageSince: 5 }),
    agent({ id: 'board:1', role: 'placeholder', stage: 'queued', stageSince: 5 }),
  ], 1000, MIN);
  assert.deepEqual(['w1', 'wa', 'wb', 'w2'].map(id => places.get(id)!.spot.pt), waitSpots(4, MIN));
  assert.deepEqual(['d1', 'd2'].map(id => places.get(id)!.spot.pt), doneSeats(MIN).slice(0, 2));
  assert.deepEqual(['board:1', 'board:2'].map(id => places.get(id)!.spot.pt), [queueSpot(0, MIN), queueSpot(1, MIN)]);
});
test('officeScene: past six waiting the extra ones carry no balloon kind', () => {
  const eight = Array.from({ length: 8 }, (_, i) => agent({ id: `w${i}`, stage: 'waiting', stageSince: i }));
  const { places } = officeScene(eight, 1000, MIN);
  assert.deepEqual(eight.map(a => places.get(a.id)!.bubble), ['info', 'info', 'info', 'info', 'info', 'info', null, null]);
  assert.deepEqual(Object.keys(themeOf('s2')), ['work', 'wall']);   // the floor theme tints only the main office
  // tied to the floor's sid, not its F: a renumbered floor keeps its colour
  assert.equal(themeOf('s4'), THEMES[hash('s4') % THEMES.length]);
  assert.ok(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(themeOf)).size > 1);
});
test('hitAt: the front-most hit wins, empty floor hits nothing', () => {
  const hits = [{ id: 'back', x0: 0, y0: 0, x1: 20, y1: 40, z: 100 }, { id: 'front', x0: 10, y0: 10, x1: 30, y1: 50, z: 200 }];
  assert.equal(hitAt(hits, { x: 15, y: 20 }), 'front');
  assert.equal(hitAt(hits, { x: 5, y: 5 }), 'back');
  assert.equal(hitAt(hits, { x: 99, y: 99 }), null);
});
test('officeScene: a done agent sits until leaveAt, burns on its seat until leaveAt + BURN_HOLD_MS, then has no place', () => {
  const d = agent({ id: 'd', stage: 'done', stageSince: 0, leaveAt: 10_000 });
  const p = (now: number) => officeScene([d], now, MIN).places.get('d');
  assert.deepEqual([p(9_999)!.kind, p(10_000)!.kind, p(10_000 + BURN_HOLD_MS - 1)!.kind, p(10_000 + BURN_HOLD_MS)], ['done', 'burn', 'burn', undefined]);
  const b = p(10_000)!;
  assert.deepEqual([b.spot.room, b.spot.pt, b.pose, b.face, b.alpha], ['done', doneSeats(MIN)[0], 'read', 'down', 1]);
  assert.equal(officeScene([{ ...d, leaveAt: null }], 1e9, MIN).places.get('d')!.kind, 'done');
});
test('officeScene: an abandoned ghost burns at its desk (still, face up, 0.35) from leaveAt for BURN_HOLD_MS, then is gone', () => {
  const g = agent({ id: 'ab', stage: 'abandoned', startedAt: 1000, stageSince: 2000, leaveAt: 62_000 });
  const p = (now: number) => officeScene([g], now, MIN).places.get('ab');
  const desk = p(61_999)!, b = p(62_000)!;
  assert.deepEqual([desk.kind, desk.alpha], ['desk', 0.35]);
  assert.deepEqual([b.kind, b.spot, b.desk, b.pose, b.face, b.alpha], ['burn', desk.spot, desk.desk, 'still', 'up', 0.35]);
  assert.equal(p(62_000 + BURN_HOLD_MS), undefined);
});
test('officeScene: Done lounge seats — one leaving moves nobody; a burning seat stays taken for BURN_HOLD_MS, then the next to finish takes the lowest free one; the snapshot order does not matter', () => {
  const d = (id: string, since: number, leaveAt: number | null = null) => agent({ id, stage: 'done', stageSince: since, leaveAt });
  const seats = doneSeats(MIN), pt = (agents: AgentView[], now: number, id: string) => officeScene(agents, now, MIN).places.get(id)?.spot.pt;
  const five = [0, 1, 2, 3, 4].map(i => d('d' + i, i * 1000));
  five.forEach((a, i) => assert.deepEqual(pt(five, 5000, a.id), seats[i]));
  const out = [d('d0', 0, 10_000), ...five.slice(1)];
  five.slice(1).forEach((a, i) => assert.deepEqual(pt(out, 10_000, a.id), seats[i + 1], a.id));   // d0 burns, nobody moves
  const n1 = d('n1', 12_000), n2 = d('n2', 10_000 + BURN_HOLD_MS);
  assert.deepEqual(pt([...out, n1], 12_000, 'n1'), seats[5]);                                // not d0's burning seat
  assert.deepEqual(pt([...out, n1, n2], 10_000 + BURN_HOLD_MS, 'n2'), seats[0]);            // free again: the lowest
  assert.deepEqual(pt([...out, n1, n2].reverse(), 10_000 + BURN_HOLD_MS, 'n1'), seats[5]);  // a reload gives the same seats
});
test('officeScene: on the 2K window\'s 42×23 the sixth to finish takes the café seat nearest the door, the tables fill seat by seat, nobody seated moves and nobody shares a seat', () => {
  const L = officeLayout(fit(1344, 736)), d = (k: number) => agent({ id: 'd' + k, stage: 'done', stageSince: k * 1000 }), first = new Map<string, unknown>(), seats = doneSeats(L);
  assert.deepEqual([L.key, seats.length], ['42x23', 12]);
  for (let n = 1; n <= seats.length; n++) {
    const ag = Array.from({ length: n }, (_, k) => d(k)), places = officeScene(ag, n * 1000, L).places;
    for (const a of ag) { const pt = places.get(a.id)!.spot.pt; if (!first.has(a.id)) first.set(a.id, pt); assert.deepEqual(pt, first.get(a.id), `${a.id} moved at ${n}`); }
    assert.equal(new Set(ag.map(a => JSON.stringify(places.get(a.id)!.spot.pt))).size, n, `two share a seat at ${n}`);
  }
  assert.deepEqual([...first.values()], seats);
  const spot = officeScene([d(0)], 1000, L).places.get('d0')!.spot;
  assert.ok(cafeSide(L, spot.pt) !== null && spot.aisle === doneAisle(L, spot.pt) && spot.aisle === spot.pt.y + 10);   // it leaves in front of its table
});
test('officeScene: the Done lounge holds no more than its seats; one finishing in a full room pushes out the oldest, who burns at once on its seat while nobody else moves; a reload replays no burn', () => {
  for (const L of [MIN, officeLayout(fit(1344, 736)), BIG]) {
    const cap = doneSeats(L).length, d = (k: number) => agent({ id: 'd' + String(k).padStart(2, '0'), stage: 'done', stageSince: k * 1000 });
    const seated = (n: number, now = n * 1000) => officeScene(Array.from({ length: n }, (_, k) => d(k)), now, L).places;
    const full = seated(cap);
    for (let n = cap + 1; n <= cap + 4; n++) {
      const places = seated(n), done = [...places].filter(([, p]) => p.kind === 'done');
      assert.equal(done.length, cap, `${L.key}: ${done.length} in a room of ${cap} at ${n}`);
      assert.equal(new Set(done.map(([, p]) => JSON.stringify(p.spot.pt))).size, cap, `${L.key} ${n}: a shared seat`);
      // the oldest burn from their push (the pusher's stageSince), oldest first; the newest takes the freed seat
      for (let k = 0; k < n - cap; k++) assert.equal(places.get(d(k).id)!.kind, 'burn', `${L.key} ${n}: d${k}`);
      for (let k = n - cap; k < cap; k++) assert.deepEqual(places.get(d(k).id)!.spot.pt, full.get(d(k).id)!.spot.pt, `${L.key} ${n}: d${k} moved`);
      assert.deepEqual(places.get(d(n - 1).id)!.spot.pt, full.get(d(n - 1 - cap).id)!.spot.pt);
    }
    // past the burn the pushed ones are gone (a reload's seed shows none of them), and a fresh page seats the rest where they were
    const late = seated(cap + 2, (cap + 1) * 1000 + BURN_HOLD_MS);
    assert.deepEqual([late.has(d(0).id), late.has(d(1).id)], [false, false]);
    assert.equal([...late.values()].filter(p => p.kind === 'done').length, cap);
    const ag = Array.from({ length: cap + 2 }, (_, k) => d(k)), fresh = officeScene(ag, (cap + 1) * 1000 + BURN_HOLD_MS, L, rememberDone(doneMemory(), ag)).places;
    for (const [id, p] of late) assert.deepEqual(fresh.get(id)!.spot.pt, p.spot.pt);
  }
});
test('doneSeating: a full room pushes out its oldest holder (stageSince, then id) at the pusher\'s stageSince, whose seat the pusher takes; one that left first is not pushed', () => {
  const d = (id: string, since: number, leaveAt: number | null = null) => agent({ id, stage: 'done', stageSince: since, leaveAt });
  const r = doneSeating([d('b', 0), d('a', 0), d('c', 5), d('e', 9)], [], 2);
  assert.deepEqual([...r.pushed], [['a', 5], ['b', 9]]);
  assert.deepEqual([r.seat.get('c'), r.seat.get('e')], [r.seat.get('a'), r.seat.get('b')]);
  const s = doneSeating([d('a', 0, -BURN_HOLD_MS + 3), d('b', 1), d('c', 5)], [], 2);   // a's seat is free from 3
  assert.deepEqual([...s.pushed], []);
  assert.equal(doneSeating([d('a', 0), d('b', 1), d('c', 2)]).pushed.size, 0);   // no cap
});
test('officeScene: one leaving the Done lounge (resume, stale-board) keeps its seat interval for the page, so nobody after it moves; a reload compacts once', () => {
  const d = (id: string, since: number) => agent({ id, stage: 'done', stageSince: since });
  const seats = doneSeats(MIN), mem = doneMemory();
  const pt = (agents: AgentView[], now: number, id: string, m = mem) => officeScene(agents, now, MIN, rememberDone(m, agents)).places.get(id)?.spot.pt;
  const a = d('a', 1000), b = d('b', 2000);
  assert.deepEqual([pt([a, b], 2000, 'a'), pt([a, b], 2000, 'b')], [seats[0], seats[1]]);
  const back = [agent({ id: 'a', stageSince: 3000 }), b];                                    // a runs again
  assert.deepEqual(pt(back, 3000, 'b'), seats[1]);
  assert.deepEqual(pt(back, 3000, 'b'), seats[1]);                                          // the same snapshot again: no change
  const sb = { ...b, stageSince: 4000, badges: ['stale-board' as const] };                  // b back at its desk for the board
  assert.deepEqual(pt([back[0], sb, d('c', 5000)], 5000, 'c'), seats[0]);                   // a's seat is free from 3000
  assert.deepEqual(pt([back[0], sb, d('c', 5000), d('e', 6000)], 6000, 'e'), seats[1]);     // b's from 4000
  assert.deepEqual(pt(back, 3000, 'b', doneMemory()), seats[0]);                             // a reload forgets: b compacts once
});
test('keepFloors: a floor that left the snapshot drops its Done lounge memory, the others keep theirs', () => {
  const a = doneMemory(), mems = new Map([['s1', a], ['s2', doneMemory()]]);
  keepFloors(mems, [{ sid: 's1' }, { sid: 's3' }]);
  assert.deepEqual([...mems.keys()], ['s1']);
  assert.equal(mems.get('s1'), a);
});

test('atWork: a desk is lit (screen, lamp) while its sitter works there, not once it is abandoned or waits', () => {
  for (const stage of ['spawning', 'running', 'verifying'] as const) assert.equal(atWork(agent({ stage })), true, stage);
  assert.equal(atWork(agent({ stage: 'done', badges: ['stale-board'] })), true);   // waits at its desk for the board
  for (const stage of ['abandoned', 'waiting', 'done', 'failed', 'idle', 'queued'] as const) assert.equal(atWork(agent({ stage })), false, stage);
  assert.equal(atWork(undefined), false);   // nobody at the desk
});
test('officeScene: waiters take the Waiting room\'s sofa seats first, then its standing spots; nobody seated or standing moves as others arrive; each leaves along its place\'s aisle', () => {
  for (const L of [MIN, BIG]) {
    const w = (k: number) => agent({ id: 'w' + k, stage: 'waiting', stageSince: k * 1000 }), first = new Map<string, unknown>();
    for (let n = 1; n <= L.waits.length; n++) {
      const places = officeScene(Array.from({ length: n }, (_, k) => w(k)), n * 1000, L).places;
      for (let k = 0; k < n; k++) {
        const s = places.get('w' + k)!.spot;
        if (!first.has('w' + k)) first.set('w' + k, s.pt);
        assert.deepEqual(s.pt, first.get('w' + k), `${L.key}: w${k} moved at ${n}`);
        assert.equal(s.aisle, waitAisle(L, s.pt));
      }
    }
    assert.deepEqual([...first.values()].slice(0, 5), sofaSeats(L.sofa));
    assert.deepEqual([...first.values()], L.waits);
  }
});
