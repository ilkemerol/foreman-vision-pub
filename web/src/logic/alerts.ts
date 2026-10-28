import type { Snapshot } from '../../../shared/types.ts';
import { whyText } from './i18n.ts';
import { agentKey } from './model.ts';

export interface AlertRef { sid: string; id: string; key: string; label: string; reason: string; project: string }

export function alertsOf(snap: Snapshot): AlertRef[] {
  const out: AlertRef[] = [];
  for (const s of snap.sessions) for (const a of s.agents) {
    if (a.alert) out.push({ sid: s.sid, id: a.id, key: agentKey(s.sid, a.key), label: a.label, reason: whyText(a), project: s.project });
  }
  return out;
}

export const alertKeys = (snap: Snapshot) => new Set(alertsOf(snap).map(a => a.key));

/** Notify once per entry into waiting. `prev` null = first snapshot after a load: nothing is new. */
export function newAlerts(prev: Set<string> | null, snap: Snapshot): AlertRef[] {
  return prev ? alertsOf(snap).filter(a => !prev.has(a.key)) : [];
}

export const titleFor = (n: number) => (n > 0 ? `(${n}) foreman-vision` : 'foreman-vision');
