import { balloonBox, boardOf, CAFE_DX, isoLine, isoView, LINE, placeBalloons, T, TILE, WAIT_FULL, waitBalloons, waitBound, type Balloon, type Door, type IsoView, type Layout, type Pt, type Rect } from './layout.ts';
import { shiftOff } from './labels.ts';

// The isometric office's projection: the flat Layout seen as a true 2:1 diamond.
// World is in tiles: x → back-right, y → front-left, z is height in office px.
export { isoView, WALL_H, PAD, T, type IsoView } from './layout.ts';

/** A flat feet point in tiles; the flat floor starts under the 2-tile top wall. */
export const toWorld = (p: Pt): { x: number; y: number } => ({ x: p.x / TILE, y: (p.y - 2 * TILE) / TILE });

/** The inner walls' height (office px). */
export const IN_H = 24;
/** The doors' heights (office px): a room or the corridor's, the entrance's. */
export const DOOR_H = 22, ENTRY_H = 30;

/** A closed door in iso: its leaves as [hinge x, y, closed direction x, y, opening direction x, y] (world): in and hall
 *  in a wall along y (hall a double door), the four room doors in the corridor walls along x; leaf length, height. */
export function isoDoor(l: Layout, d: Door): { leaves: number[][]; len: number; h: number } {
  const w = toWorld(d), up = d.y < l.hallY;
  const leaves = d.id === 'in' ? [[0, w.y - 0.45, 0, 1, 1, 0]]
    : d.id === 'hall' ? [[w.x + 1 - T / 2, w.y - 1, 0, 1, 1, 0], [w.x + 1 - T / 2, w.y + 1, 0, -1, 1, 0]]
    : [[w.x + 0.05, up ? w.y - T / 2 : w.y - 1 + T / 2, 1, 0, 0, up ? -1 : 1]];
  return { leaves, len: d.id === 'hall' ? 0.95 : 0.9, h: d.id === 'in' ? ENTRY_H : DOOR_H };
}

/** A closed door's screen box. */
export function isoDoorBox(l: Layout, d: Door): Rect {
  const v = isoView(l.cols, l.rows), { leaves, len, h } = isoDoor(l, d);
  const pts = leaves.flatMap(([hx, hy, cx, cy]) => [0, len].flatMap(u => [0, h].map(z => isoProj(v, hx + cx * u, hy + cy * u, z))));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** A sign's box (screen px) at text scale k, an upper bound: x anchored per side as the overlay does, y the sign's top;
 *  styles.css .ov .sign is 8 text px tall and 6 wide plus its text, with no letter-spacing measured at most 2.874 text px
 *  a char in Chromium on Windows (Segoe UI; the Turkish Waiting room and Library signs 2.864, the gauge 2.689); on macOS (San Francisco) a Mac
 *  check measured 3.357 with the .04em spacing it had then, ~3.16 without (to be
 *  re-measured on the Mac), so 3.2; its shadow ring adds 1 px a side and 2 below. */
export function signBox(s: { x: number; y: number; side: -1 | 0 | 1 }, text: string, k: number): Rect {
  const w = k * (text.length * 3.2 + 6), a = (1 - s.side) / 2;
  return { x0: s.x - w * a - k, y0: s.y - k, x1: s.x + w * (1 - a) + k, y1: s.y + 10 * k };
}

/** The gap (text px) a door sign's box keeps from the doors and, in the offices tested, from the other signs. One: at
 *  150 % (k 3) the smallest office has 41.6 px between the server door's foot and the Library sign for the Done lounge's 33. */
export const SIGN_GAP = 1;

/** A door's sign at text scale k (screen px; x as the overlay anchors a sign of that side, y its top): on the wall beside
 *  the door (side −1 / +1), or centred over it, its box SIGN_GAP off the door. The server door's goes over it: beside
 *  it, the corridor's three rows put it only ~50 px right of the Waiting room's on screen. A sign beside its door that would come
 *  near another door (the Done lounge's, at the server door's foot in a wide office) hangs SIGN_GAP under it. A sign that covers a
 *  desk or the agent at it (the server room's row right behind its wall, at 1366, 1920 and 2560 and at 150 %; main's
 *  right column under the corridor's; the Done lounge's by the Library's first desk), or comes within SIGN_GAP of a sign before it,
 *  moves: on its side of the door, then a side
 *  sign on the other side, to the least drop (0, or just under a desk, door or sign) that keeps its top above the
 *  door's foot at which shiftOff finds a sideways move of at most its own width off every desk, SIGN_GAP off every door
 *  and `signs` (the signs placed before it); else it stays. */
export function isoSign(l: Layout, d: Door, k: number, text: string, signs: Rect[] = []): { x: number; y: number; side: -1 | 0 | 1 } {
  const v = isoView(l.cols, l.rows), w = toWorld(d), { leaves: [[hx, hy]], h } = isoDoor(l, d);
  const g = SIGN_GAP * k, ring = k;   // signBox's ring: 1 text px a side above and beside the sign
  const own = isoDoorBox(l, d), grow = (r: Rect): Rect => ({ x0: r.x0 - g, y0: r.y0 - g, x1: r.x1 + g, y1: r.y1 + g });
  const at = (side: -1 | 0 | 1) => {
    if (side === 0) return { x: isoProj(v, hx, w.y, 0)[0], y: isoProj(v, hx, hy, h)[1] - g - 10 * k, side };
    const s = { x: side < 0 ? own.x0 - g - ring : own.x1 + g + ring, y: isoProj(v, side < 0 ? w.x - 0.1 : w.x + 1.1, hy, DOOR_H + 2)[1], side };
    for (const o of l.doors) {
      const a = signBox(s, text, k), b = isoDoorBox(l, o);
      if (o !== d && a.x0 < b.x1 + g && b.x0 < a.x1 + g && a.y0 < b.y1 + g && b.y0 < a.y1 + g) s.y = b.y1 + g + ring;
    }
    return s;
  };
  const sides: (-1 | 0 | 1)[] = d.id === 'server' || d.side === 0 ? [0] : [d.side, -d.side as -1 | 1];
  const first = at(sides[0]), desks = [...l.desks.map(x => isoDeskBox(l, x.seat)), ...isoDoneBoxes(l)];
  // nor within SIGN_GAP of a sign before it (52×27 at k 1.5–2.5: the Waiting room's under the server sign)
  if (!desks.some(o => meet(o, signBox(first, text, k))) && !signs.some(o => meet(grow(o), signBox(first, text, k)))) return first;
  const obs = [...desks, ...l.doors.map(o => grow(isoDoorBox(l, o))), ...signs.map(grow)];
  for (const s of sides.map(at)) {
    const b = signBox(s, text, k);
    const drops = [0, ...obs.map(o => o.y1 - b.y0)].filter(dy => dy >= 0 && b.y0 + dy < own.y1).sort((p, q) => p - q);
    for (const dy of drops) {
      const dx = shiftOff({ ...b, y0: b.y0 + dy, y1: b.y1 + dy }, obs, v.w, b.x1 - b.x0);
      if (dx !== null) return { ...s, x: s.x + dx, y: s.y + dy };
    }
  }
  return first;
}

export const isoProj = (v: IsoView, x: number, y: number, z: number): [number, number] => [v.ox + (x - y) * 16, v.oy + (x + y) * 8 - z];

/** A desk's name tag at text scale k (screen px: x its centre, y its top), over the monitor like flat's over the desk.
 *  A hot one (`hot`: its height in text px, 19 with its tool line, 10 without) ends 22 px over the flame's base, 2 over
 *  the flame, so the flame shows under it at either height. */
export function isoDeskTag(l: Layout, seat: Pt, k: number, hot: number | null = null): [number, number] {
  const v = isoView(l.cols, l.rows), s = toWorld(seat);
  return [isoProj(v, s.x, s.y - 1, 0)[0], isoProj(v, s.x, s.y - 1.3, 29)[1] - (hot === null ? 18 : 22 + hot * k)];
}

/** A work desk's screen box, an upper bound: its top and monitor (components/office/iso.ts workDesk: ±1 × ±0.45 tiles,
 *  29 px high) a tile behind the chair, and the agent sitting at it (16 px wide, 40 tall with its lift and headroom). */
export function isoDeskBox(l: Layout, seat: Pt): Rect {
  const v = isoView(l.cols, l.rows), s = toWorld(seat), [sx, sy] = isoProj(v, s.x, s.y, 0);
  const pts = [-1, 1].flatMap(dx => [-0.45, 0.45].flatMap(dy => [0, 29].map(z => isoProj(v, s.x + dx, s.y - 1 + dy, z))));
  const xs = [...pts.map(p => p[0]), sx - 8, sx + 8], ys = [...pts.map(p => p[1]), sy - 40, sy];
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** The Done lounge's smart board and café tables with their sitters, screen boxes and upper bounds:
 *  the board's panel (iso.ts: 32 px high, at flat y1 − 6), each sitter 40 px tall with its lift and headroom. A door
 *  sign moves off them like off a desk (isoSign). */
export function isoDoneBoxes(l: Layout): Rect[] {
  const v = isoView(l.cols, l.rows), b = boardOf(l), box = (pts: [number, number][]): Rect => {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  const a = toWorld({ x: b.x0, y: b.y1 - 6 }), e = toWorld({ x: b.x1, y: b.y1 - 6 });
  const seat = (p: Pt) => { const s = toWorld(p), [x, y] = isoProj(v, s.x, s.y, 0); return box([[x - 8, y - 40], [x + 8, y]]); };
  return [box([a, e].flatMap(w => [isoProj(v, w.x, w.y, 0), isoProj(v, w.x, w.y, 32)])), ...l.cafes.flatMap(t => [seat({ x: t.x - CAFE_DX, y: t.y }), seat({ x: t.x + CAFE_DX, y: t.y })])];
}

/** Which hot desk tags drop their tool line (then 10 text px tall, isoDeskTag), each whose
 *  two-line box meets another hot tag's or any of `others` (the other resting labels and the signs). Screen px. */
export const shortHot = (hot: Rect[], others: Rect[]): boolean[] =>
  hot.map((b, i) => [...hot.filter((_, j) => j !== i), ...others].some(o => o.x0 < b.x1 && b.x0 < o.x1 && o.y0 < b.y1 && b.y0 < o.y1));

/** A hot desk's flame box (screen px, whole px), an upper bound: both flame rows (iso.ts flameRow, tongues up to 19 px
 *  over a base sloping down to the right) and their sparks; its top is 2 px under its own hot tag (isoDeskTag). */
export function isoFlameBox(l: Layout, seat: Pt): Rect {
  const v = isoView(l.cols, l.rows), s = toWorld(seat), x = isoProj(v, s.x, s.y - 1, 0)[0], base = isoProj(v, s.x, s.y - 1.3, 29)[1];
  return { x0: Math.floor(x - 4), y0: Math.floor(base - 20), x1: Math.ceil(x + 15), y1: Math.ceil(base + 9) };
}

/** How each hot desk tag (`hot`, screen px; `flames` the same desks' flame boxes) moves so it
 *  covers no other hot desk's flame. One that covers none stays. Else, back desks first, the smallest lift (0, then
 *  just over each obstacle above it, at most `up` and not over the top) at which shiftOff finds a sideways move of at
 *  most half its width (so it stays over its desk) off the other flames, the other hot tags (where they now are) and
 *  `others` (the other resting labels and the signs) inside 0..W; else it stays. Moves in whole px. `racks`: the server room's burning racks' flame boxes, flames no tag owns. */
export function clearFlames(hot: Rect[], flames: Rect[], others: Rect[], W: number, up: number, racks: Rect[] = []): { dx: number; dy: number }[] {
  const at = hot.map(b => ({ ...b })), moves = hot.map(() => ({ dx: 0, dy: 0 }));
  const by = (b: Rect, dx: number, dy: number): Rect => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
  for (const i of hot.map((_, i) => i).sort((p, q) => hot[p].y1 - hot[q].y1)) {
    const b = hot[i], fl = [...flames.filter((_, j) => j !== i), ...racks];   // the burning racks' flames too
    if (!fl.some(f => meet(f, b))) continue;
    const obs = [...fl, ...at.filter((_, j) => j !== i), ...others];
    const lifts = [0, ...obs.map(o => Math.floor(o.y0 - b.y1))].filter(d => d <= 0 && d >= -up && b.y0 + d >= 0).sort((p, q) => q - p);
    for (const dy of lifts) {
      const dx = shiftOff(by(b, 0, dy), obs.map(o => ({ x0: Math.floor(o.x0), y0: o.y0, x1: Math.ceil(o.x1), y1: o.y1 })), W, (b.x1 - b.x0) / 2);
      if (dx !== null) { moves[i] = { dx: dx < 0 ? Math.floor(dx) : Math.ceil(dx), dy }; at[i] = by(b, moves[i].dx, dy); break; }
    }
  }
  return moves;
}
const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Larger is nearer the viewer. */
export const isoDepth = (x: number, y: number): number => x + y;

/** The Waiting room's side sofa (components/office/iso.ts sofaSide: its centre `at`, 1.05 tiles either way along y) ends 6 px
 *  into the tile row of the left wall piece beside it. That piece sorts after the sofa (isoDepth of its corner + 0.5 −
 *  T / 2) and would cover the sofa's back corner, though the wall stands behind it: the sofa is drawn again just after
 *  it (`z`), left of the piece's room-side edge (`edge`: world x − y, its screen x / 16 less the origin's). */
export function isoSofaCorner(l: Pick<Layout, 'sofa' | 'rooms'>): { at: { x: number; y: number }; edge: number; z: number } {
  const at = toWorld({ x: l.sofa.x + 5.6, y: l.sofa.y + 38 }), x = l.rooms.wait.x0 / TILE, y = Math.floor(at.y + 1.05);
  return { at, edge: x - y, z: isoDepth(x, y) + 0.5 - T / 2 + 0.001 };
}

/** The screen bbox of a flat room rect projected onto the iso floor, its back corners also lifted `wallH` px (the back wall). */
export function isoRoomBox(v: IsoView, r: Rect, wallH: number): Rect {
  const pts = ([[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]] as const).flatMap(([x, y], i) => {
    const w = toWorld({ x, y }), p = isoProj(v, w.x, w.y, 0);
    return i === 2 ? [p] : [p, isoProj(v, w.x, w.y, wallH)];   // all but the front corner stand on a back wall
  });
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Where pixel row y's centre crosses the polygon's edges, left to right. */
export function scan(pts: [number, number][], y: number): number[] {
  const cy = y + 0.5, xs: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((a[1] <= cy) !== (b[1] <= cy)) xs.push(a[0] + (cy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
  }
  return xs.sort((p, q) => p - q);
}

/** The Waiting room balloons in iso (screen px). `waiters` in the scene's order: home and where
 *  drawn (`at`) in flat px, `feet` on screen, `out` for coffee; `sprites`: every agent drawn (screen). Those drawn inside
 *  the Waiting room get a balloon over their heads (layout.ts waitBalloons, placeBalloons), compact and how many decided from
 *  the homes, the fourth to sixth only when all of them get a box here too; one out for coffee gets none.
 *  The bound is the room's projection with its back walls' faces, reaching the corridor line like flat's
 *  waitBound. No balloon covers an agent or shows any of the corridor's floor: the floor behind the line the Waiting room's back
 *  wall hides (the corridor's back rows, the upper rooms) is an obstacle, as 2 px strips. The first three (WAIT_FULL)
 *  decide, once per set of waiters (homes, who is out; so a passer-by neither resizes nor moves them), a one-line
 *  balloon's width and the bound's left: as wide as the full text (LINE.w·k) where they all get a box in the Waiting room, else
 *  the widest, a char (4 text px) at a time, down to the 2·LINE.w cap; then the bound reaches left over the main
 *  office's front corner a tile at a time, only as far as they need (at most to the canvas edge). The first such
 *  choice where every one's tail points at its agent (over its head, or up from under its feet) wins over one where
 *  some tail points at nothing. Four to six also go compact where all of them get a box at the choice the first three
 *  take with no box under the feet, so a tail pointing up never costs them that. */
export function isoWaitBalloons(waiters: { id: string; home: Pt; at: Pt; feet: Pt; out: boolean }[], sprites: Rect[], l: Layout, k: number): { compact: boolean; w: number; boxes: Map<string, Balloon | null> } {
  const v = isoView(l.cols, l.rows), scr = (p: Pt): Pt => { const w = toWorld(p), [x, y] = isoProj(v, w.x, w.y, 0); return { x, y }; };
  const room = isoRoomBox(v, waitBound(l), IN_H), r = l.rooms.wait;
  // the wall stands T into the Waiting room's first row (iso.ts) and hides the floor up to IN_H flat px (1.5 tiles) behind it
  const behind = [[l.rooms.hall.x0, 2 * TILE], [l.w, 2 * TILE], [l.w, l.hallY + (1 + T) * TILE - IN_H], [l.rooms.hall.x0, l.hallY + (1 + T) * TILE - IN_H]]
    .map(([x, y]) => { const p = scr({ x, y }); return [p.x, p.y] as [number, number]; });
  const strips: Rect[] = [];
  for (let y = room.y0; y < room.y1; y += 2) {
    const xs = [...scan(behind, y), ...scan(behind, y + 1)];
    if (xs.length) strips.push({ x0: Math.floor(Math.min(...xs)), y0: y, x1: Math.ceil(Math.max(...xs)), y1: y + 2 });
  }
  const inRoom = waiters.filter(({ at }) => at.x >= r.x0 && at.x <= r.x1 && at.y >= r.y0 && at.y <= r.y1), homes = inRoom.map(o => scr(o.home));
  const line = isoLine(l.views.iso, k);   // under the fit two lines up to ISO_TWO
  // all: the fourth to sixth too, where waitBalloons says so; up: placeBalloons may put one under its agent's feet
  const place = (w: number, widen: number, all = true, up = true) => {
    const bound = { ...room, x0: room.x0 - widen }, d = waitBalloons(homes, bound, k, w, line), { compact, shown } = all ? d : { compact: false, shown: Math.min(d.shown, WAIT_FULL) };
    const list = inRoom.slice(0, shown).filter(o => !o.out), placed = placeBalloons(list.map(o => ({ feet: o.feet, ...balloonBox(k, compact, w, line) })), bound, [...sprites, ...strips], up);
    return { compact, w, boxes: new Map(list.map((o, i) => [o.id, placed[i]])) };
  };
  // `aimed`: each one's tail points at its agent too (a box over its head, or `up` under its feet)
  const firsts = (out: ReturnType<typeof place>, aimed = false) => inRoom.slice(0, WAIT_FULL).every(o => {
    const b = out.boxes.get(o.id);
    return o.out || (b && (!aimed || b.up || b.y1 <= o.feet.y - 32));
  });
  const key = `${l.key} ${k} ${line} ${inRoom.map((o, i) => `${homes[i].x},${homes[i].y},${o.out}`)}`;
  const f = fits.get(key);
  if (f) return place(...f);
  // two lines: full = cap, so only the bound widens, as at k 1
  const full = balloonBox(k, false, LINE.w * k, line).w, cap = balloonBox(k, false, undefined, line).w, most = Math.floor(room.x0 / TILE) * TILE, tries: [number, number][] = [];
  for (let w = full; w > cap; w -= 4 * k) tries.push([w, 0]);
  for (let widen = 0; widen < most; widen += TILE) tries.push([cap, widen]);
  const three = (up: boolean, aim = false) => tries.find(([w, widen]) => firsts(place(w, widen, false, up), aim)), aimed = three(true, true);
  // four to six go compact where all of them get a box there, or where the first three get one with no box under the
  // feet (a tail pointing up, which lets them stop widening sooner, takes no compact away)
  const fitsAll = (t?: [number, number]) => t && [...place(...t).boxes.values()].every(Boolean);
  const [w, widen] = (inRoom.length > WAIT_FULL ? [aimed, three(false)].find(fitsAll) : undefined) ?? aimed ?? three(true) ?? [cap, most];
  const out = place(w, widen), all = [...out.boxes.values()].every(Boolean);
  if (fits.size > 64) fits.clear();
  fits.set(key, [w, widen, all]);
  return all ? out : place(w, widen, false);
}
const fits = new Map<string, [w: number, widen: number, all: boolean]>();   // isoWaitBalloons' decisions
