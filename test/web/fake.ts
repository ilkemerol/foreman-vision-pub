import type { AgentView, SessionView, Snapshot } from '../../shared/types.ts';
import { getLang, setLang, type Lang } from '../../web/src/logic/i18n.ts';

export const agent = (o: Partial<AgentView> = {}): AgentView => ({
  id: 'a1', parentId: 'main', role: 'agent', type: 'Explore', label: 'job', stage: 'running', reasons: [], alert: false,
  badges: [], note: null, activeTools: [], recentTools: [], model: null, tokens: 0, startedAt: 1000, endedAt: null, activeSince: null, breaks: [], stageSince: 1000, leaveAt: null, ...o,
  key: o.key ?? o.id ?? 'a1',
});

export const session = (o: Partial<SessionView> = {}): SessionView => ({
  sid: 's1', cwd: '/w/proj', project: 'proj', firstSeen: 0, ended: false, foreman: 'off', waitingCount: 0, agents: [], context: null, connectors: [], hiddenAt: null, ...o,
});

export const snap = (sessions: SessionView[], o: Partial<Snapshot> = {}): Snapshot => ({
  serverTime: 0, sessions, unknownEvents: 0, badLines: 0, ...o,
});

export const inLang = <T>(l: Lang, f: () => T): T => { const was = getLang(); setLang(l); try { return f(); } finally { setLang(was); } };
