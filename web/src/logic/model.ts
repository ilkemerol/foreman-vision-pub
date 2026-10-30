import type { AgentView, Badge, SessionView, Snapshot, Stage } from '../../../shared/types.ts';
import { t } from './i18n.ts';

export const badgeText = (b: Badge) => t(`badge.${b}`);

export type Column = 'queued' | 'running' | 'waiting' | 'verifying' | 'finished';

/** Titles come from t(`col.${key}`) at render time, so a language change never leaves an old one. */
export const COLUMNS: { key: Column }[] = [
  { key: 'queued' }, { key: 'running' }, { key: 'waiting' }, { key: 'verifying' }, { key: 'finished' },
];

const COLUMN_OF: Record<Stage, Column> = {
  queued: 'queued', spawning: 'running', running: 'running', idle: 'running', waiting: 'waiting',
  verifying: 'verifying', done: 'finished', failed: 'finished', abandoned: 'finished',
};

export const columnOf = (s: Stage): Column => COLUMN_OF[s];

/** FNV-1a: stable per id, so an agent keeps its colour and sprite across reloads. */
export function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** By the spawn key, like the desk: a pending agent keeps its colour when it binds to its agent id. */
export const colorOf = (a: Pick<AgentView, 'key'>) => `hsl(${hash(a.key) % 360} 65% 55%)`;
export const shortSid = (sid: string) => sid.slice(0, 8);
/** 'main' exists on every floor: a selection, a React key and a hold entry need the session too. */
export const agentKey = (sid: string, id: string) => `${sid}/${id}`;

/** Start of the current working stretch: a running agent counts from when it last became active (back from the
 *  waiting room, or resumed after a stop), a stopped one under the master's check from when it last went running,
 *  anything else over its whole life. activeSince is the hooks' (it survives a restart, where stageSince falls back to
 *  startedAt), stageSince also sees the board's waiting. */
export const stretchStart = (a: AgentView) =>
  a.stage === 'running' && a.endedAt === null ? Math.max(a.stageSince, a.activeSince ?? 0) || a.startedAt
  : a.stage === 'verifying' ? a.activeSince ?? a.startedAt : a.startedAt;

/** `from`: the total by default, `stretchStart(a)` for the current stretch. */
export function duration(a: AgentView, now: number, from = a.startedAt): string {
  return from ? span((a.endedAt ?? now) - from) : '—';
}

/** A span in whole seconds, minutes or hours. */
export function span(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return t('dur.s', { s: sec });
  if (sec < 3600) return t('dur.ms', { m: Math.floor(sec / 60), s: sec % 60 });
  return t('dur.hm', { h: Math.floor(sec / 3600), m: Math.floor((sec % 3600) / 60) });
}

export const totalAlerts = (snap: Snapshot) => snap.sessions.reduce((n, s) => n + s.waitingCount, 0);

export function findAgent(snap: Snapshot, key: string | null): { s: SessionView; a: AgentView } | null {
  if (!key) return null;
  for (const s of snap.sessions) for (const a of s.agents) if (agentKey(s.sid, a.key) === key) return { s, a };
  return null;
}
