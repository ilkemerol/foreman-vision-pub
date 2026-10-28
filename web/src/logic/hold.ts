import type { AgentView, Badge, SessionView, Snapshot, Stage } from '../../../shared/types.ts';
import { agentKey } from './model.ts';

export const MIN_STAGE_MS = 1500;
export type Held = Map<string, { stage: Stage; badges: Badge[]; since: number }>;   // badges: a stale-board done stays one

/**
 * Each stage stays on screen at least MIN_STAGE_MS, so a 200 ms spawning→running→done burst
 * does not flicker. An alerting wait shows at once: it is what the user is here for.
 * Updates `held` in place; returns the snapshot to draw and when to redraw (null: nothing pending).
 */
// ponytail: stages that come and go inside one hold are skipped (latest wins); queue them if that hides too much
export function applyHold(held: Held, snap: Snapshot, now: number, minMs = MIN_STAGE_MS): { snap: Snapshot; nextAt: number | null } {
  let nextAt: number | null = null;
  const seen = new Set<string>();
  const sessions: SessionView[] = [];
  for (const s of snap.sessions) {
    const agents: AgentView[] = [];
    for (const a of s.agents) {
      const key = agentKey(s.sid, a.key);   // the spawn key: a pending agent's hold carries over when it binds
      seen.add(key);
      const h = held.get(key);
      if (!h || h.stage === a.stage) {
        if (!h) held.set(key, { stage: a.stage, badges: a.badges, since: now });
        else h.badges = a.badges;
        agents.push(a);
      } else if (a.alert || now - h.since >= minMs) {
        held.set(key, { stage: a.stage, badges: a.badges, since: now });
        agents.push(a);
      } else {
        nextAt = Math.min(nextAt ?? Infinity, h.since + minMs);
        agents.push({ ...a, stage: h.stage, badges: h.badges });
      }
    }
    sessions.push({ ...s, agents });
  }
  for (const k of held.keys()) if (!seen.has(k)) held.delete(k);
  return { snap: { ...snap, sessions }, nextAt };
}
