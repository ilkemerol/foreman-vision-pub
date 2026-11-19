import { t } from '../logic/i18n.ts';
import { agentKey, columnOf, COLUMNS } from '../logic/model.ts';
import { AgentChip } from './AgentChip.tsx';
import { FloorSlide } from './FloorSlide.tsx';
import type { ViewProps } from './view-props.ts';

/** Kanban: the picked floor's stage columns, one floor at a time; a floor change rides the elevator. */
export function KanbanView({ floor, numbers, selected, onSelect }: ViewProps) {
  return (
    <div className="fit">
      <FloorSlide floor={floor} numbers={numbers} render={s => (
        <div className={`kanban${s.ended ? ' ended' : ''}`}>
          <div className="krow khead">
            {COLUMNS.map(c => <div key={c.key} className="kcol">{t(`col.${c.key}`)}</div>)}
          </div>
          <div className="krow">
            {COLUMNS.map(c => (
              <div key={c.key} className="kcol">
                {s.agents.filter(a => columnOf(a.stage) === c.key).map(a => (
                  <AgentChip key={a.key} a={a} selected={selected === agentKey(s.sid, a.key)} onClick={() => onSelect(s.sid, a.key)} slot />
                ))}
              </div>
            ))}
          </div>
        </div>
      )} />
    </div>
  );
}
