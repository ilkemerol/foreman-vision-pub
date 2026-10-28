import { useLayoutEffect, useRef } from 'react';
import type { AgentView } from '../../../../shared/types.ts';
import { boardRows } from '../../logic/board.ts';
import { t } from '../../logic/i18n.ts';
import { sidePlace } from '../../logic/labels.ts';
import { colorOf } from '../../logic/model.ts';
import type { Hit } from '../../logic/scene.ts';

/** The Done lounge smart board's balloon: left of the board, centred on it, its tail pointing right at it
 *  (right of it where the stage has no room on the left), inside the stage (above it ran off the page); a table like `/foreman status` of who is in the Done lounge, newest
 *  first. Office px × `scale` = CSS px. It takes no pointer: it closes as the pointer leaves the board and never covers
 *  a click. */
export function BoardPop({ done, cap, hit, scale, stageW, stageH, now }: { done: AgentView[]; cap: number; hit: Hit; scale: number; stageW: number; stageH: number; now: number }) {
  const el = useRef<HTMLDivElement>(null);
  const { rows, more } = boardRows(done, now);
  useLayoutEffect(() => {
    const e = el.current!, p = sidePlace({ x0: hit.x0 * scale, x1: hit.x1 * scale, y0: hit.y0 * scale, y1: hit.y1 * scale }, e.offsetWidth, e.offsetHeight, stageW, stageH, 12);
    e.style.left = p.x + 'px';
    e.style.top = p.y + 'px';
    e.classList.toggle('r', p.side === 'r');
    (e.lastElementChild as HTMLElement).style.top = p.ty + 'px';
  });
  return (
    <div ref={el} className="bpop">
      <div className="bhead"><b>{t('board.title')}</b><span>{t('board.count', { n: done.length, cap })}</span></div>
      {rows.length ? (
        <table>
          <thead><tr><th>#</th><th>{t('board.col.agent')}</th><th>{t('board.col.type')}</th><th>{t('board.col.note')}</th><th>{t('board.col.done')}</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{r.n}</td><td><i className="dot" style={{ background: colorOf(done.find(a => a.id === r.id)!) }} />{r.name}</td><td>{r.type}</td><td>{r.note}</td><td>{r.ago}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="bempty">{t('board.empty')}</div>}
      {more > 0 && <div className="bmore">{t('board.more', { n: more })}</div>}
      <i className="btail" />
    </div>
  );
}
