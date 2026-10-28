import { useEffect } from 'react';
import { t } from '../logic/i18n.ts';
import { agentKey, columnOf, COLUMNS } from '../logic/model.ts';
import { AgentChip } from './AgentChip.tsx';
import { FloorLabel } from './FloorLabel.tsx';
import type { ViewProps } from './view-props.ts';

/** Kanban: stage columns, one lane per session (the lane does the floor's job); picking a floor scrolls to its lane. */
export function KanbanView({ sessions, floor, selected, onSelect }: ViewProps) {
  useEffect(() => {
    document.getElementById('lane-' + floor.sid)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [floor.sid]);
  return (
    <div className="kanban">
      <div className="krow khead">
        <div className="klane" />
        {COLUMNS.map(c => <div key={c.key} className="kcol">{t(`col.${c.key}`)}</div>)}
      </div>
      {sessions.map(s => (
        <div key={s.sid} id={'lane-' + s.sid} className={`krow${s.ended ? ' ended' : ''}${s.waitingCount ? ' alerting' : ''}`}>
          <div className="klane"><FloorLabel s={s} /></div>
          {COLUMNS.map(c => (
            <div key={c.key} className="kcol">
              {s.agents.filter(a => columnOf(a.stage) === c.key).map(a => (
                <AgentChip key={a.key} a={a} selected={selected === agentKey(s.sid, a.key)} onClick={() => onSelect(s.sid, a.key)} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
