import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Stage } from '../../shared/types.ts';
import { BASE, chainOf, orbitLayout, orbitZoom, roomAgents, type Rect } from '../../web/src/logic/hybrid.ts';
import { agent } from './fake.ts';

const MIX: [id: string, stage: Stage, parent: string][] = [
  ['r1', 'running', 'main'], ['r2', 'running', 'main'], ['r3', 'running', 'main'], ['r4', 'running', 'r1'], ['w1', 'waiting', 'main'],
  ['w2', 'waiting', 'r2'], ['v1', 'verifying', 'main'], ['d1', 'done', 'main'], ['d2', 'done', 'r3'], ['f1', 'failed', 'main'],
  ['q1', 'queued', 'main'], ['x1', 'running', 'r1'], ['x2', 'running', 'main'], ['x3', 'running', 'r2'], ['x4', 'running', 'main'],
  ['x5', 'running', 'r3'], ['x6', 'waiting', 'x2'], ['x7', 'verifying', 'r1'], ['x8', 'verifying', 'main'], ['x9', 'done', 'main'],
  ['x10', 'done', 'r2'], ['x11', 'queued', 'main'],
];
const main = agent({ id: 'main', role: 'foreman', parentId: null, stage: 'idle' });
const mix = () => [main, ...MIX.map(([id, stage, parentId], i) =>
  agent({ id, stage, parentId, startedAt: 1000 + i, endedAt: stage === 'done' || stage === 'failed' ? 5000 + i : null }))];
const done = (n: number) => [main, ...Array.from({ length: n }, (_, i) => agent({ id: `d${i}`, stage: 'done', startedAt: 1000, endedAt: 2000 + i }))];
const card = (o: ReturnType<typeof orbitLayout>, room: string) => o.cards.find(c => c.room === room)!;
const inside = (a: Rect, b: Rect) => a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.y + a.h <= b.y + b.h + 1e-6;
const apart = (a: Rect, b: Rect) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
const ends = (d: string) => { const n = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number); return [{ x: n[0], y: n[1] }, { x: n.at(-2)!, y: n.at(-1)! }]; };
const near = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.abs(p.x - q.x) < 0.06 && Math.abs(p.y - q.y) < 0.06;
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const onBorder = (p: { x: number; y: number }, r: Rect) => inside({ x: p.x, y: p.y, w: 0, h: 0 }, { x: r.x - .06, y: r.y - .06, w: r.w + .12, h: r.h + .12 })
  && [p.x - r.x, r.x + r.w - p.x, p.y - r.y, r.y + r.h - p.y].some(d => Math.abs(d) < 0.06);

test('orbitZoom: the box is at least BASE with the view aspect, and zoom maps it back onto the view', () => {
  // 732×401: a 1366×768 laptop at 140% browser zoom; the zoom goes below 1 rather than scroll
  for (const size of [{ w: 1122, h: 589 }, { w: 1676, h: 1012 }, { w: 2316, h: 1012 }, { w: 732, h: 401 }]) {
    const { zoom, box } = orbitZoom(size);
    assert.ok(box.w >= BASE.w - 1e-9 && box.h >= BASE.h - 1e-9);
    assert.ok(Math.abs(box.w - BASE.w) < 1e-9 || Math.abs(box.h - BASE.h) < 1e-9);
    assert.ok(Math.abs(box.w * zoom - size.w) < 1e-9 && Math.abs(box.h * zoom - size.h) < 1e-9);
  }
  assert.ok(Math.abs(orbitZoom({ w: 1122, h: 589 }).zoom - 589 / 680) < 1e-9);
});

test('roomAgents: sub-agents of the room, oldest first by endedAt ?? startedAt, main never', () => {
  const a = [main, agent({ id: 'b', startedAt: 3000 }), agent({ id: 'a', startedAt: 3000 }), agent({ id: 'c', startedAt: 1000 }),
    agent({ id: 'z', stage: 'done', startedAt: 0, endedAt: 9000 }), agent({ id: 'y', stage: 'failed', startedAt: 500, endedAt: 4000 })];
  assert.deepEqual(roomAgents(a, 'work').map(x => x.id), ['c', 'a', 'b']);
  assert.deepEqual(roomAgents(a, 'exit').map(x => x.id), ['y', 'z']);
  assert.deepEqual(roomAgents([main], 'work'), []);
});

test('orbitLayout: cards inside the box and apart from each other and from main, chips inside their card and apart', () => {
  for (const box of [{ w: 1240, h: 680 }, { w: 1296, h: 680 }, { w: 1612, h: 680 }, { w: 1240, h: 900 }]) {
    for (const agents of [[main, agent({ id: 'r' }), agent({ id: 'w', stage: 'waiting' })], mix(), done(30)]) {
      const o = orbitLayout(agents, box), all = { x: 0, y: 0, ...box };
      assert.ok(inside(o.main, all));
      o.cards.forEach((c, i) => {
        assert.ok(inside(c, all), `${c.room} in ${box.w}×${box.h}`);
        assert.ok(apart(c, o.main), c.room);
        o.cards.slice(i + 1).forEach(d => assert.ok(apart(c, d), `${c.room}/${d.room}`));
        if (c.more) assert.ok(inside(c.more, c));
      });
      const chips = [...o.chips.values()];
      chips.forEach((p, i) => {
        assert.ok(inside(p, card(o, p.room)));
        chips.slice(i + 1).forEach(q => assert.ok(apart(p, q)));
      });
    }
  }
});

test('orbitLayout: the work card on top of main; a card shrinks with its agents, an empty one is its header', () => {
  const box = { w: 1240, h: 680 };
  const one = orbitLayout([main, agent({ id: 'r' })], box), six = orbitLayout([main, ...Array.from({ length: 6 }, (_, i) => agent({ id: `r${i}` }))], box);
  assert.deepEqual([card(one, 'work').w, card(one, 'work').h], [200, 82]);
  assert.deepEqual([card(six, 'work').w, card(six, 'work').h], [444, 128]);
  assert.deepEqual([card(one, 'queue').w, card(one, 'queue').h, card(one, 'queue').n], [200, 32, 0]);
  assert.ok(card(one, 'work').y + card(one, 'work').h <= one.main.y);
  assert.deepEqual([one.main.w, one.main.h, one.main.x, one.main.y], [200, 100, 520, 290]);
});

test('orbitLayout: 22 agents over five stages fit without compact or +N', () => {
  const o = orbitLayout(mix(), { w: 1240, h: 680 });
  assert.equal(o.chips.size, 22);
  assert.ok(!o.chips.has('main'));
  assert.deepEqual(o.cards.map(c => [c.room, c.n, c.compact, c.more]), [['queue', 2, false, null], ['work', 9, false, null], ['wait', 3, false, null], ['verify', 3, false, null], ['exit', 5, false, null]]);
  assert.equal(card(o, 'exit').failed, 1);
});

test('orbitLayout: a card past its normal grid goes compact; past its compact grid it shows the newest and a +N cell', () => {
  const box = { w: 1240, h: 680 };
  const nine = card(orbitLayout(done(9), box), 'exit');
  assert.deepEqual([nine.compact, nine.more, nine.w, nine.h], [true, null, 252, 206]);
  const o = orbitLayout(done(30), box), c = card(o, 'exit');
  assert.deepEqual([c.n, c.compact, c.more?.n], [30, true, 21]);
  assert.deepEqual([...o.chips.keys()].sort(), Array.from({ length: 9 }, (_, i) => `d${21 + i}`).sort());
  assert.ok([...o.chips.values()].every(p => p.compact && p.w === 112 && p.h === 28));
});

test('orbitLayout: one edge per room from the main card border to the card border, with the room count', () => {
  const o = orbitLayout(mix(), { w: 1240, h: 680 });
  assert.deepEqual(o.edges.map(e => [e.room, e.n]), [['queue', 2], ['work', 9], ['wait', 3], ['verify', 3], ['exit', 5]]);
  for (const e of o.edges) {
    const [a, b] = ends(e.d);
    assert.ok(onBorder(a, o.main), `${e.room} starts on main`);
    assert.ok(onBorder(b, card(o, e.room)), `${e.room} ends on its card`);
  }
});

test('orbitLayout: a link per shown agent with a shown parent, from the parent chip (main: the main card centre) to the chip centre', () => {
  const o = orbitLayout(mix(), { w: 1240, h: 680 });
  assert.equal(o.links.length, 22);
  assert.deepEqual(o.links.filter(l => !l.main).map(l => l.id).sort(), ['d2', 'r4', 'w2', 'x1', 'x10', 'x3', 'x5', 'x6', 'x7']);
  for (const l of o.links) {
    const [a, b] = ends(l.d);
    assert.ok(near(b, centre(o.chips.get(l.id)!)), l.id);
    assert.ok(near(a, centre(l.main ? o.main : o.chips.get(l.parentId)!)), l.id);
    assert.equal(l.main, l.parentId === 'main');
  }
});

test('orbitLayout: no link when the parent is hidden behind +N or not on the floor', () => {
  const o = orbitLayout([...done(30), agent({ id: 'kid', parentId: 'd0' }), agent({ id: 'lost', parentId: 'gone' })], { w: 1240, h: 680 });
  assert.ok(o.chips.has('kid') && o.chips.has('lost') && !o.chips.has('d0'));
  assert.deepEqual(o.links.filter(l => l.id === 'kid' || l.id === 'lost'), []);
});

test('chainOf: the agent, its ancestors and descendants, not siblings or cousins; an id not on the floor gives an empty set', () => {
  const a = mix();
  assert.deepEqual([...chainOf(a, 'r1')].sort(), ['main', 'r1', 'r4', 'x1', 'x7']);
  assert.deepEqual([...chainOf(a, 'x6')].sort(), ['main', 'x2', 'x6']);
  assert.equal(chainOf(a, 'main').size, 23);
  assert.equal(chainOf(a, 'nope').size, 0);
});
