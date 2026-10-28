import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AgentView } from '../../../../shared/types.ts';
import { mmss, stageText, termLines } from '../../logic/labels.ts';
import { stretchStart } from '../../logic/model.ts';
import type { Hit } from '../../logic/scene.ts';
import { serverNow } from '../../store.ts';

/** The mini terminal beside a hovered or pinned agent. Office px × `scale` = CSS px. */
export function Terminal({ a, hit, scale, stageW, stageH, pinned }: { a: AgentView; hit: Hit; scale: number; stageW: number; stageH: number; pinned: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  // right of the agent; flips left near the stage's right edge, clamped inside vertically
  useLayoutEffect(() => {
    const e = el.current!, tw = e.offsetWidth, th = e.offsetHeight;
    let left = (hit.x1 + 4) * scale, origin = 'left';
    if (left + tw > stageW - 4) { left = (hit.x0 - 4) * scale - tw; origin = 'right'; }
    const top = Math.min(hit.y0 * scale, stageH - 4 - th);
    e.style.left = Math.max(4, left) + 'px';
    e.style.top = Math.max(4, top) + 'px';
    e.style.transformOrigin = `${origin} top`;
  });
  return (
    <div ref={el} className="term">
      <div className="tbar">
        <i /><i /><i /><b>{a.label}</b>
        <span>{a.type} · {stageText(a.stage)} · <em>{a.startedAt ? mmss((a.endedAt ?? serverNow()) - stretchStart(a)) : '—'}</em></span>
        {pinned && <span className="pin">📌</span>}
      </div>
      <div className="tbody">
        {termLines(a).map((l, i) => (
          <div key={i} className={l.kind}>
            {l.kind === 'cur' ? '▸ ' : ''}{l.text}{l.kind === 'cur' || l.kind.startsWith('why') ? <> <span className="blk">█</span></> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
