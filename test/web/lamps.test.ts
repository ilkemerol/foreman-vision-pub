import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripPath } from '../../web/src/logic/coffee.ts';
import { cornerSpots } from '../../web/src/logic/corner.ts';
import { foremanMug } from '../../web/src/logic/decor.ts';
import { boardBands, flatLights, floorLampShade, foremanLampAt, windowGlass } from '../../web/src/logic/lights.ts';
import { boardOf, CAFE_DX, CAFE_PX, officeLayout, sofaParts, waitAisle, type Fit, type Pt, type Rect } from '../../web/src/logic/layout.ts';

const fit = (w: number, h: number): Fit => ({ w, h, dpr: 1, demand: 0, sb: 0 });
const LAYOUTS = [[1114, 589], [1146, 613], [2308, 1372], [3000, 1700], [3600, 2000]].map(([w, h]) => officeLayout(fit(w, h)));   // 34×18, 35×19, 47×25, 61×33, 74×39
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const within = (a: Rect, b: Rect) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;
const SIZE = (n: string) => ({ w: n === 'win' ? 22 : 32, h: 32 });

test('flatLights: the board\'s screen while lit, its light on the floor (no wall light) only in the evening; the foreman\'s and the floor lamps only in the evening', () => {
  const l = LAYOUTS[2], c = cornerSpots(l), b = boardOf(l), d = l.rooms.done, wait = sofaParts(l.sofa).lamp;
  const o = { glass: windowGlass(l, SIZE), screens: [], lamps: [], hot: [], burns: [], clock: c.clock, gauge: c.box, racks: [], leds: [], floorLamps: [{ r: wait, room: 'wait' as const }] };
  const kinds = (x: Partial<typeof o> & { boardLit?: boolean; evening?: boolean }) => flatLights(l, { ...o, ...x }).filter(y => y.kind === 'board' || y.kind === 'lamp').map(y => y.kind === 'board' ? `board${y.light ? '+light' : ''}` : 'lamp');
  assert.deepEqual(kinds({}), []);
  assert.deepEqual(kinds({ boardLit: true }), ['board']);
  assert.deepEqual(kinds({ boardLit: true, evening: true }), ['lamp', 'lamp', 'board+light']);
  assert.deepEqual(kinds({ evening: true }), ['lamp', 'lamp']);
  const all = flatLights(l, { ...o, boardLit: true, evening: true });
  const board = all.find(x => x.kind === 'board')!, holes = all.filter(x => x.kind === 'hole').map(x => x.r);
  assert.ok(board.kind === 'board' && within(board.screen, b) && board.light);
  assert.deepEqual([Object.keys(board.light), board.light.bands, board.light.floor], [['bands', 'floor'], boardBands(l), d]);   // no wall light
  assert.ok(holes.some(r => r.x0 === floorLampShade(wait).x0 && r.y0 === floorLampShade(wait).y0) && within(floorLampShade(wait), wait));
});

test('boardBands: soft trapezoids on the Done lounge\'s floor from both sides of the board, widening into the room, over the café table in front and a neighbour; never on the wall', () => {
  // in a trapezoid [top left, top right, bottom right, bottom left], both edges level
  const inT = ([a, b, c, e]: Pt[], x: number, y: number) => { const u = (y - a.y) / (e.y - a.y); return u >= 0 && u <= 1 && x >= a.x + u * (e.x - a.x) && x <= b.x + u * (c.x - b.x); };
  for (const l of [...LAYOUTS, officeLayout(fit(1440, 770)), officeLayout(fit(1670, 870))]) {   // + 45×24, 52×27
    const bands = boardBands(l), [o] = bands, b = boardOf(l), d = l.rooms.done, cx = (b.x0 + b.x1) / 2;
    assert.equal(bands.length, 4, l.key);
    assert.deepEqual(o, [{ x: b.x0 - 4, y: d.y0 }, { x: b.x1 + 4, y: d.y0 }, { x: cx + 60, y: d.y0 + 70 }, { x: cx - 60, y: d.y0 + 70 }], `${l.key}: from the board's sides at the floor's edge, widening`);
    bands.forEach((q, i) => {
      assert.ok(q.every(r => r.x >= d.x0 && r.x <= d.x1 && r.y >= d.y0 && r.y <= d.y1), `${l.key}: band ${i} inside the Done lounge's floor`);
      assert.ok(q[0].y === d.y0 && q[1].x > q[0].x && q[2].x - q[3].x > q[1].x - q[0].x, `${l.key}: band ${i} from the floor's edge, widening`);
      if (i) assert.ok(q.every(r => inT(bands[i - 1], r.x, r.y)), `${l.key}: band ${i} inside band ${i - 1}`);
    });
    const row = l.cafes.filter(t => t.y > b.y1), y = Math.min(...row.map(t => t.y)), front = row.filter(t => t.y === y).sort((s, t) => Math.abs(s.x - cx) - Math.abs(t.x - cx))[0];
    assert.ok(inT(o, front.x, front.y) && inT(o, front.x, front.y - 20), `${l.key}: the front table`);
    const side = l.cafes.find(t => t.y === y && Math.abs(t.x - front.x) === CAFE_PX)!, near = side.x + Math.sign(front.x - side.x) * CAFE_DX;
    assert.ok(inT(o, near, side.y), `${l.key}: a neighbour's near chair`);
  }
});

test('foremanLampAt: the banker lamp (7×8 over its foot) on the desk\'s left end, clear of the courier\'s letter, the mug and the monitor', () => {
  for (const l of LAYOUTS) {
    const f = foremanLampAt(l), F = l.foreman.seat, fy = l.foreman.y, lamp = { x0: f.x - 3, y0: f.y - 7, x1: f.x + 4, y1: f.y + 1 };
    const letter = { x0: F.x - 14, y0: F.y - 12, x1: F.x - 6, y1: F.y - 6 }, monitor = { x0: F.x + 3, y0: fy + 5, x1: F.x + 19, y1: fy + 22 };
    for (const r of [letter, foremanMug(l), monitor]) assert.ok(!meet(lamp, r), `${l.key}`);
    assert.ok(lamp.x0 >= F.x - 24 && lamp.y1 <= fy + 32, `${l.key}: on the desk`);
  }
});

test('sofaParts.lamp: the Waiting room\'s floor lamp in the 8 px between the side and the top sofa, clear of every Waiting room place\'s sprite and its walks out and to the coffee', () => {
  for (const l of LAYOUTS) {
    const p = sofaParts(l.sofa), lamp = p.lamp, wr = l.rooms.wait;
    assert.deepEqual([lamp.x0, lamp.x1, lamp.y1], [p.side.x1, p.top.x0, p.top.y1]);
    assert.ok(lamp.y0 >= wr.y0 - 8, `${l.key}: at the wall's foot at most 8 px over the room`);
    for (const w of l.waits) {
      const a = waitAisle(l, w), feet = (q: Pt[]) => q.slice(1).map((b, i) => ({ x0: Math.min(q[i].x, b.x) - 6, y0: Math.min(q[i].y, b.y) - 4, x1: Math.max(q[i].x, b.x) + 6, y1: Math.max(q[i].y, b.y) + 1 }));
      assert.ok(!meet(lamp, { x0: w.x - 8, y0: w.y - 32, x1: w.x + 8, y1: w.y }), `${l.key}: ${w.x},${w.y}`);
      for (const r of [...feet([w, { x: w.x, y: a }, { x: l.lane.wait, y: a }]), ...feet(tripPath(w, l.stations.wait, a))]) assert.ok(!meet(lamp, r), `${l.key}: ${w.x},${w.y} walks`);
    }
  }
});
