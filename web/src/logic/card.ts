import type { AgentView, ToolRun } from '../../../shared/types.ts';
import { outcome, shortPath, type TermItem } from './blocks.ts';
import { getLang, t, whyText } from './i18n.ts';
import { stageText } from './labels.ts';
import { duration, span, stretchStart } from './model.ts';

export interface CallRow { id: string; name: string; target: string; state: 'run' | 'ok' | 'bad'; ms: number; result: string | null }

const block = (items: TermItem[], id: string) => items.find(i => 'key' in i && i.key === id) as Extract<TermItem, { key: string }> | undefined;

/** A call's target as the CLI shows it: its label, else its tool line's text from the terminal, the session folder dropped. */
export const callTarget = (r: ToolRun, items: TermItem[], cwd: string | null) => shortPath(r.label ?? block(items, r.id)?.tool?.text ?? '', cwd);

/** The running calls, each a row (parallel ones too), else the last finished one; ms from `now` while running. */
export function lastCalls(a: AgentView, items: TermItem[], now: number, cwd: string | null): CallRow[] {
  const row = (r: ToolRun, state: CallRow['state'], ms: number): CallRow => {
    const b = state === 'run' ? undefined : block(items, r.id);
    return { id: r.id, name: r.name, target: callTarget(r, items, cwd), state, ms, result: b ? outcome(b.tool, b.out) : null };
  };
  if (a.activeTools.length) return a.activeTools.map(r => row(r, 'run', now - r.at));
  const last = a.recentTools[0];
  return last ? [row(last, last.ok ? 'ok' : 'bad', last.ms)] : [];
}

/** Under a minute one decimal in the language ('3.4 s', '3,4 sn'), else span. */
export function took(ms: number): string {
  return ms < 60_000 ? t('dur.s', { s: (ms / 1000).toLocaleString(getLang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : span(ms);
}

export function statusPill(a: AgentView, now: number): { text: string; wait: boolean } {
  return a.alert ? { text: `⏳ ${whyText(a) || stageText(a.stage)} · ${span(now - a.stageSince)}`, wait: true }
    : { text: `${stageText(a.stage)} · ${duration(a, now, stretchStart(a))}`, wait: false };
}
