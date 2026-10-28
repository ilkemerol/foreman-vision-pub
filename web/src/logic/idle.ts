// Idle actions of a seated agent: a pure function of its id and the frame clock, so
// nothing is kept: a reseed, a tab return, a style or floor change never breaks one, and two agents never move in step.
import { hash } from './model.ts';

export type IdleKind = 'stretch' | 'sip' | 'lookL' | 'lookR' | 'pause';
export interface IdleAct { kind: IdleKind; t: number; dur: number }   // t: ms into it
export const IDLE_EVERY = 30_000;   // one action every 30 s on average (Normal)
export const ACT_MS: Record<Exclude<IdleKind, 'pause'>, number> = { stretch: 1600, sip: 2600, lookL: 1300, lookR: 1300 };
export const BURST = 8000;          // typing pauses: one 0.6–1.4 s pause per 8 s window

const WORKER: IdleKind[] = ['stretch', 'sip', 'sip'], FOREMAN: IdleKind[] = ['stretch', 'sip', 'lookL', 'lookR', 'sip'];

/** The action at `now` (ms, the frame clock): `worker` a running agent at its desk, `foreman` the foreman idle (all four
 *  kinds), `foremanBusy` the foreman running (stretch and sip only). Null between actions, and always when `calm`
 *  (prefers-reduced-motion). Only a worker pauses its typing. */
export function idleAct(id: string, role: 'worker' | 'foreman' | 'foremanBusy', now: number, calm = false): IdleAct | null {
  if (calm) return null;
  const off = hash(id) % IDLE_EVERY, n = Math.floor((now + off) / IDLE_EVERY), t0 = n * IDLE_EVERY - off, h = hash(`${id}:${n}`);
  const kinds = role === 'foreman' ? FOREMAN : WORKER, kind = kinds[h % kinds.length] as Exclude<IdleKind, 'pause'>, dur = ACT_MS[kind];
  const start = t0 + (h >>> 8) % (IDLE_EVERY - dur - 1000);
  if (now >= start && now < start + dur) return { kind, t: now - start, dur };
  if (role !== 'worker') return null;
  const bo = hash(id + ':b') % BURST, m = Math.floor((now + bo) / BURST), hb = hash(`${id}:b${m}`), at = (now + bo) % BURST;
  const len = 600 + hb % 800, s = 1000 + (hb >>> 10) % (BURST - len - 1000);
  return at >= s && at < s + len ? { kind: 'pause', t: at - s, dur: len } : null;
}
