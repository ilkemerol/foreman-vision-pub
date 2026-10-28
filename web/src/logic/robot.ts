import { pathLen, pointAt } from './fx.ts';
import type { Layout, Pt } from './layout.ts';
import { hash } from './model.ts';

// The cleaning robot: its dock, its tour through every room and where it is at a
// server time. A pure function of the layout, the session and the clock: a reload or a tab return shows it where it was.
export const ROBOT_EVERY = 600_000, ROBOT_SPEED = 0.035;   // a tour every 10 min; office px per ms

/** The corridor line it drives and docks on, 4 px behind the walking line: in iso the lower corridor wall (1.5 tiles in
 *  front) does not cover it, in flat it passes the upper doors without opening them (motion.ts nearDoor: < 12). */
export const robotLane = (l: Layout): number => l.hallY - 4;
export const dockOf = (l: Layout): Pt => ({ x: l.w - 40, y: robotLane(l) });

/** The wall charger's unit, 12 px square with its outline, on the corridor's back wall: its
 *  centre x 20 px left of the dock (in iso the Library sign hangs over the wall right above the dock; robot.test.ts),
 *  its bottom row y 4 px over the wall's foot in flat, its top row z 22 px up the 24 px wall in iso. Its cable runs
 *  down the wall 4 px right of its centre, over the floor to the dock's line and along it to the plate. */
export const chargerOf = (l: Layout): { x: number; y: number; z: number } => { const d = dockOf(l); return { x: d.x - 20, y: d.y - 16, z: 22 }; };

export type RobotRoom = 'main' | 'server' | 'library' | 'wait' | 'done';
const ROOMS: RobotRoom[] = ['main', 'server', 'library', 'wait', 'done'];

/** Each room's out-and-back lines [y, far x], entered from its door's column (l.lane): the work rooms below every desk
 *  row (the main office also below the foreman's desk), then the bottom line when 14 px clear of the last; the Waiting room under
 *  its bench right of its sofa set, and under the set (over its coffee corner where that is at the bottom); the Done lounge only
 *  under the board and the café table by it (its floor is café tables). */
export function robotLines(l: Pick<Layout, 'rooms' | 'desks' | 'foreman' | 'h' | 'sofa'>): Record<RobotRoom, [number, number][]> {
  const work = (id: 'main' | 'server' | 'library', far: number, first: number[]): [number, number][] => {
    const r = l.rooms[id], bottom = id === 'main' ? l.h - 8 : r.y1 - 3;
    const ys = [...new Set([...first, ...l.desks.filter(d => d.room === id).map(d => Math.min(d.aisle + 2, r.y1 - 3))])].sort((a, b) => a - b);
    if (!ys.length || bottom - ys[ys.length - 1] >= 14) ys.push(bottom);   // a room without desks still gets its bottom line
    return ys.map(y => [y, far]);
  };
  const { main, server, library, wait, done } = l.rooms;
  return {
    main: work('main', main.x0 + 10, [l.foreman.aisle + 12]),
    server: work('server', server.x0 + 30, []), library: work('library', library.x0 + 10, []),
    wait: [[wait.y0 + 28, l.sofa.x + 66], [Math.max(l.h - 40, l.sofa.y + 84), wait.x0 + 10]],
    done: [[done.y0 + 20, done.x1 - 10]],
  };
}

/** Dock → each room in turn (along the corridor line to its lane, up or down it, out and back each line) → dock. */
export function robotRoute(l: Layout): Pt[] {
  const y = robotLane(l), lines = robotLines(l), pts: Pt[] = [dockOf(l)];
  for (const id of ROOMS) {
    const x = l.lane[id];
    pts.push({ x, y });
    for (const [ly, far] of lines[id]) pts.push({ x, y: ly }, { x: far, y: ly }, { x, y: ly });
    pts.push({ x, y });
  }
  pts.push(dockOf(l));
  return pts.filter((p, i) => !i || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
}

export const robotPhase = (sid: string): number => hash(sid + ':robot') % ROBOT_EVERY;   // floors set out at different times
/** Faster on a route too long for half the gap. */
export const robotSpeed = (route: Pt[]): number => speedFor(pathLen(route));
const speedFor = (len: number): number => Math.max(ROBOT_SPEED, len / (ROBOT_EVERY / 2));

export interface RobotPos { pt: Pt; moving: boolean; tour: number; d: number }   // tour: the tour number; d: px along the route (0 docked)

export function robotAt(route: Pt[], sid: string, now: number): RobotPos {
  const len = pathLen(route), since = now - robotPhase(sid), tour = Math.floor(since / ROBOT_EVERY), d = (since - tour * ROBOT_EVERY) * speedFor(len);
  return d < len ? { pt: pointAt(route, d), moving: true, tour, d } : { pt: route[0], moving: false, tour, d: 0 };
}

/** The wall charger over the dock: 'out' while the robot tours (robotAt's moving), 'charging'
 *  its first CHARGE_MS back on the dock, then 'full' until the next tour. */
export const CHARGE_MS = 120_000;
export type Charge = 'out' | 'charging' | 'full';
export function chargeAt(route: Pt[], sid: string, now: number): Charge {
  const len = pathLen(route), since = now - robotPhase(sid), t = since - Math.floor(since / ROBOT_EVERY) * ROBOT_EVERY, back = len / speedFor(len);
  return t * speedFor(len) < len ? 'out' : t - back < CHARGE_MS ? 'charging' : 'full';
}

/** The green LED (the charger's and the docked robot's) in its bright phase now: a slow blink while charging, steady when
 *  full or calm (prefers-reduced-motion). */
export const chargeLit = (charge: Charge, now: number, calm: boolean): boolean => charge === 'full' || calm || Math.floor(now / 900) % 2 === 1;

export const nextTour = (sid: string, now: number): number => { const p = robotPhase(sid); return p + Math.ceil((now - p) / ROBOT_EVERY) * ROBOT_EVERY; };
