import type { SessionView } from '../../../shared/types.ts';
import { t } from './i18n.ts';
import { shortSid } from './model.ts';

/** sid → floor number F. */
export type FloorNumbers = Record<string, number>;

/** F is the floor's place by age among the visible floors, oldest = F1, no gaps:
 *  `sids` come oldest first (the server's order), so a gone floor drops the ones above it and a re-shown one takes its age slot. */
export const numberFloors = (sids: string[]): FloorNumbers => Object.fromEntries(sids.map((sid, i) => [sid, i + 1]));

/** The sidebar badge's number shift when a known floor is renumbered; a floor's first appearance shifts nothing. */
export const badgeShift = (prev: number | undefined, k: number): 'up' | 'down' | null =>
  prev === undefined || prev === k ? null : k > prev ? 'up' : 'down';

/** Floors bottom to top by F (the sidebar shows them reversed). */
export const byFloor = (sessions: SessionView[], numbers: FloorNumbers) =>
  sessions.toSorted((a, b) => (numbers[a.sid] ?? Infinity) - (numbers[b.sid] ?? Infinity) || 0);

/** The floors a ride from `from` to `to` passes, as F in passing order (a missing F is no floor); an unnumbered end passes none. */
export function passedFloors(numbers: FloorNumbers, from: string, to: string): number[] {
  const a = numbers[from], b = numbers[to];
  if (a === undefined || b === undefined) return [];
  const ks = Object.values(numbers).filter(k => k > Math.min(a, b) && k < Math.max(a, b)).sort((x, y) => x - y);
  return a < b ? ks : ks.reverse();
}

/** The saved floor while it exists, else the newest session (sessions are oldest first), else none. */
export function pickFloor(sessions: SessionView[], saved: string | null): string | null {
  if (saved && sessions.some(s => s.sid === saved)) return saved;
  return sessions.at(-1)?.sid ?? null;
}

/** `?session=<sid>` names a floor to open once it is in the snapshot; absent param or sid = null. */
export function urlFloor(search: string, sessions: SessionView[]): string | null {
  const sid = new URLSearchParams(search).get('session');
  return sid && sessions.some(s => s.sid === sid) ? sid : null;
}

export interface FloorCounts { run: number; wait: number; done: number; alert: boolean }

/** Sidebar counters: working, waiting (placeholders included), done; `alert` makes the wait badge pulse. */
export function floorCounts(s: SessionView): FloorCounts {
  const c: FloorCounts = { run: 0, wait: 0, done: 0, alert: false };
  for (const a of s.agents) {
    if (a.stage === 'spawning' || a.stage === 'running' || a.stage === 'verifying') c.run++;
    else if (a.stage === 'waiting') c.wait++;
    else if (a.stage === 'done') c.done++;
    if (a.alert) c.alert = true;
  }
  return c;
}

/** Floors that appeared since the last snapshot. `prev` null = first snapshot after a load: nothing is new. */
export function newFloors(prev: Set<string> | null, sessions: SessionView[]): string[] {
  return prev ? sessions.filter(s => !prev.has(s.sid)).map(s => s.sid) : [];
}

export const floorTitle = (k: number, s: SessionView) =>
  `${t('floor.badge', { n: k })} · ${s.project} · ${shortSid(s.sid)}${s.foreman !== 'off' ? ' · foreman' : ''}`;

export const waitPill = (c: FloorCounts) => (c.wait > 0 ? t('floor.waiting', { n: c.wait }) : t('floor.noneWaiting'));
