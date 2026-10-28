import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { SessionView } from '../../../shared/types.ts';
import { overworkMin } from '../logic/fx.ts';
import { chainOf, orbitLayout, orbitZoom, type Room } from '../logic/hybrid.ts';
import { t } from '../logic/i18n.ts';
import { agentKey, colorOf } from '../logic/model.ts';
import { serverNow } from '../store.ts';
import { useSize } from '../useSize.ts';
import { AgentChip } from './AgentChip.tsx';
import { FloorSlide } from './FloorSlide.tsx';
import type { ViewProps } from './view-props.ts';

const ROOM_COLOR: Record<Room, string> = { queue: '#a1a1aa', work: '#22c55e', wait: '#f97316', verify: '#3b82f6', exit: '#9ca3af' };

function HybridFloor({ s, size, resized, selected, onSelect, onList }: { s: SessionView; size: { w: number; h: number }; resized: boolean; selected: string | null; onSelect: ViewProps['onSelect']; onList: ViewProps['onList'] }) {
  const [hover, setHover] = useState<string | null>(null);
  const { zoom, box } = orbitZoom(size);
  const o = orbitLayout(s.agents, box), main = s.agents.find(a => a.id === 'main');
  const selId = s.agents.find(a => agentKey(s.sid, a.key) === selected)?.id ?? null;
  const onScreen = (id: string | null) => !!id && (id === 'main' ? !!main : o.chips.has(id));
  // a chip that went behind +N (or left) gets no mouseleave: drop its hover, else it would dim the floor if it came back
  if (hover && !onScreen(hover)) setHover(null);
  // only an agent on screen can be the focus: one behind +N (or gone) would leave everything dimmed
  const focus = [hover, selId].find(onScreen) ?? null;
  const chain = focus ? chainOf(s.agents, focus) : null;
  const hi = (id: string) => (chain?.has(id) ? ' hi' : '');
  const leave = (id: string) => () => setHover(h => (h === id ? null : h));
  const hoverOf = (id: string) => ({ onMouseEnter: () => setHover(id), onMouseLeave: leave(id), onFocus: () => setHover(id), onBlur: leave(id) });
  const waiting = s.agents.filter(a => a.id !== 'main' && a.stage === 'waiting').length, now = serverNow();
  return (
    <div className={`hfloor${chain ? ' focus' : ''}${resized ? ' still' : ''}`} style={{ width: box.w, height: box.h, zoom }}>
      {o.cards.map(c => <div key={c.room} className={`hcard${c.alert ? ' alert' : ''}`} style={{ left: c.x, top: c.y, width: c.w, height: c.h, '--sc': ROOM_COLOR[c.room] } as CSSProperties}>
        <header><i />{t(`room.${c.room}`)} <span className="n">{c.n}</span>{c.failed > 0 && <small>{c.failed} ✗</small>}</header></div>)}
      <svg width={box.w} height={box.h}>
        {o.edges.map(e => <path key={e.room} className={`e${e.n ? '' : ' zero'}`} d={e.d} style={{ d: `path("${e.d}")`, stroke: ROOM_COLOR[e.room], strokeWidth: 1.5 + Math.min(e.n, 8) * 0.55 }} />)}
        {o.links.map(l => <path key={l.id} className={`l${l.main ? ' main' : ''}${chain?.has(l.id) && chain.has(l.parentId) ? ' hi' : ''}`}
          d={l.d} style={{ d: `path("${l.d}")`, stroke: l.main ? ROOM_COLOR[o.chips.get(l.id)!.room] : colorOf(s.agents.find(a => a.id === l.parentId)!) }} />)}
      </svg>
      {o.edges.map(e => <span key={e.room} className="epill" style={{ left: e.mid.x, top: e.mid.y, '--sc': ROOM_COLOR[e.room] } as CSSProperties}>{e.n}</span>)}
      {main && <button className={`hmain st-${main.stage}${main.alert ? ' alert' : ''}${selId === 'main' ? ' sel' : ''}${hi('main')}`}
        style={{ left: o.main.x, top: o.main.y, width: o.main.w, height: o.main.h }} onClick={() => onSelect(s.sid, 'main')} {...hoverOf('main')}>
        <b>{main.label}</b>{main.role === 'foreman' && <span className="t">{t('name.foreman')}</span>}
        <span className="s">{t('hybrid.agents', { n: s.agents.length - 1 })}{waiting > 0 && <em> · {t('floor.waiting', { n: waiting })}</em>}</span>
      </button>}
      {s.agents.map(a => { const p = o.chips.get(a.id); return p && (
        <div key={a.id} className={`hslot${p.compact ? ' compact' : ''}${hi(a.id)}`} style={{ left: p.x, top: p.y, width: p.w, height: p.h }} {...hoverOf(a.id)}>
          <AgentChip a={a} selected={selId === a.id} hot={overworkMin(a, now)} onClick={() => onSelect(s.sid, a.key)} />
        </div>); })}
      {o.cards.map(c => c.more && <button key={c.room} className="hmore" style={{ left: c.more.x, top: c.more.y, width: c.more.w, height: c.more.h }}
        title={t('hybrid.more', { n: c.more.n })} aria-label={t('hybrid.more', { n: c.more.n })} onClick={() => onList(s.sid, c.room)}>+{c.more.n}</button>)}
    </div>
  );
}

/** Hybrid: the picked floor as stage cards around main, zoomed to fill the main area; a stage change slides the chip (CSS). */
export function HybridView({ floor, numbers, selected, onSelect, onList }: ViewProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  // the size on screen since the last commit: a render with a new size is a resize, which jumps instead of sliding
  const drawn = useRef(size);
  useEffect(() => { drawn.current = size; });
  const resized = drawn.current.w !== size.w || drawn.current.h !== size.h;
  return (
    <div ref={ref} className="fit">
      <FloorSlide floor={floor} numbers={numbers} render={s => (size.w && size.h ? <HybridFloor s={s} size={size} resized={resized} selected={selected} onSelect={onSelect} onList={onList} /> : null)} />
    </div>
  );
}
