import type { CSSProperties } from 'react';
import type { AgentView, Stage } from '../../../shared/types.ts';
import { t, whyText } from '../logic/i18n.ts';
import { toolName } from '../logic/labels.ts';
import { badgeText, colorOf } from '../logic/model.ts';

const ICON: Partial<Record<Stage, string>> = { waiting: '!', verifying: '🔍', done: '✓', failed: '✗' };

/** One agent as a DOM card; the stage class carries its look. */
export function AgentChip({ a, selected, onClick, style, hot }: { a: AgentView; selected: boolean; onClick: () => void; style?: CSSProperties; hot?: number | null }) {
  const tool = a.activeTools[0];
  return (
    <button
      className={`chip st-${a.stage}${a.alert ? ' alert' : ''}${selected ? ' sel' : ''}`}
      style={{ ...style, '--c': colorOf(a) } as CSSProperties}
      title={whyText(a) || a.label}
      onClick={onClick}
    >
      <span className="dot" />
      <span className="lbl">{a.label}</span>
      {hot != null && <span className="hot">{t('tag.hot', { n: hot })}</span>}
      <span className="type">{a.role === 'foreman' ? t('name.foreman') : a.type}</span>
      {a.badges.map(b => <span key={b} className="badge">{badgeText(b)}</span>)}
      {ICON[a.stage] && <span className="icon">{ICON[a.stage]}</span>}
      {tool && <span className="tool">{toolName(tool.name)}{tool.label ? `: ${tool.label}` : ''}</span>}
    </button>
  );
}
