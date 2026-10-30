import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgentView, SessionView } from '../../../shared/types.ts';
import { termItems } from '../logic/blocks.ts';
import { callTarget, lastCalls, statusPill, took } from '../logic/card.ts';
import { roomAgents, type Room } from '../logic/hybrid.ts';
import { getLang, t, whyText } from '../logic/i18n.ts';
import { stageText, toolName } from '../logic/labels.ts';
import { badgeText, colorOf, duration, span, stretchStart } from '../logic/model.ts';
import { serverNow } from '../store.ts';
import { AgentChip } from './AgentChip.tsx';
import { AskForm } from './AskForm.tsx';
import { LiveTerm, useTerm } from './LiveTerm.tsx';

/** A pop-up over the dimmed, blurred floor, side by side: id, type, model, parent, job, note, active tool, time, tokens,
 *  the last tool call's card and the last 5 calls on the left, the live terminal on the right. */
export function DetailPanel({ s, a, now, closing, onClose }: { s: SessionView; a: AgentView; now: number; closing: boolean; onClose: () => void }) {
  const parent = a.parentId ? s.agents.find(x => x.id === a.parentId) : undefined;
  const rows: [string, ReactNode][] = [
    [t('detail.id'), <code>{a.id}</code>],
    [t('detail.type'), a.type],
    [t('detail.stage'), stageText(a.stage)],
    [t('detail.badges'), a.badges.map(badgeText).join(', ') || '—'],
    [t('detail.model'), a.model ?? '—'],
    [t('detail.parent'), parent?.label ?? a.parentId ?? '—'],
    [t('detail.job'), a.label],
    [t('detail.note'), a.note ?? '—'],
    [t('detail.waiting'), whyText(a) || '—'],
    [t('detail.tool'), a.activeTools.map(x => (x.label ? `${toolName(x.name)}: ${x.label}` : toolName(x.name))).join(', ') || '—'],
    [t('detail.time'), duration(a, now)],
    [t('detail.stretch'), duration(a, now, stretchStart(a))],
    [t('detail.tokens'), a.tokens.toLocaleString(getLang())],
  ];
  const { lines, remote } = useTerm(s.sid, a.id, !closing);
  const items = useMemo(() => termItems(lines), [lines]);
  const term = `${s.sid}/${a.id}`;
  // a running call's time ticks every second; the snapshot's `now` is enough otherwise
  const [tick, setTick] = useState(0);
  const running = a.activeTools.length > 0;
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => setTick(serverNow()), 1000);
    return () => clearInterval(i);
  }, [running]);
  const clock = running ? Math.max(now, tick) : now;
  const pill = statusPill(a, clock);
  // tagged with its terminal, so another agent picked meanwhile never jumps to it
  const [jump, setJump] = useState<{ term: string; id: string; n: number } | null>(null);
  const box = useRef<HTMLElement>(null);
  const x = useRef<HTMLButtonElement>(null);
  // focus moves in on open and back to the opener on close (not after the fade-out); another agent picked meanwhile keeps it in
  useEffect(() => {
    if (closing) return;
    const opener = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => opener?.focus();
  }, [closing]);
  return (
    <div className={`modal${closing ? ' out' : ''}`} inert={closing}>
      <div className="drawer-dim" onClick={onClose} />
      <section ref={box} className="agent" role="dialog" aria-modal="true" aria-labelledby="agent-title" tabIndex={-1}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
          // aria-modal: Tab cycles × (the terminal's link, its scroll area, the answer area but a disabled Send), never reaching the page behind
          if (e.key === 'Tab') {
            e.preventDefault();
            const f = [...box.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')];
            const i = f.indexOf(document.activeElement as HTMLElement);
            f[i < 0 ? (e.shiftKey ? f.length - 1 : 0) : (i + (e.shiftKey ? f.length - 1 : 1)) % f.length]?.focus();
          }
        }}>
        <div className="settings-head">
          <h2 id="agent-title" style={{ color: colorOf(a) }}>{a.label}</h2>
          <span className={'pill' + (pill.wait ? ' wait' : '')}>{pill.text}</span>
          {a.model && <span className="pill">{a.model}</span>}
          <button ref={x} className="settings-x" title={t('close')} aria-label={t('close')} onClick={onClose}>×</button>
        </div>
        <div className="agent-cols">
          <div className="agent-body">
            <dl>{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
            <h4>{t('detail.last')}</h4>
            {lastCalls(a, items, clock, s.cwd).map(c => (
              <div key={c.id} className="call">
                {items.some(i => 'key' in i && i.key === c.id) &&
                  <button className="j" onClick={() => setJump(j => ({ term, id: c.id, n: (j?.n ?? 0) + 1 }))}>{t('detail.show')}</button>}
                <div className="t"><b>{toolName(c.name)}</b>{c.target && ` · ${c.target}`}</div>
                <div className="s"><span className={c.state}>{c.state === 'run' ? t('detail.run', { t: span(c.ms) }) : t(`detail.${c.state}`, { t: took(c.ms) })}</span></div>
                {c.result && <div className="r">{c.result}</div>}
              </div>
            ))}
            <h4>{t('detail.recent')}</h4>
            <ol>{a.recentTools.map(x => {
              const target = callTarget(x, items, s.cwd);
              return <li key={x.id}><span className={x.ok ? 'ok' : 'bad'}>{x.ok ? '✓' : '✗'}</span>{toolName(x.name)}{target && ' · ' + target}<small>{took(x.ms)}</small></li>;
            })}</ol>
          </div>
          <div className="agent-term">
            <LiveTerm key={term} items={items} remote={remote} cwd={s.cwd} jump={jump?.term === term ? jump : null}
              asking={a.activeTools.filter(x => x.name === 'AskUserQuestion').map(x => x.id)} />
            {a.id === 'main' && s.ask && <AskForm key={s.ask.id} ask={s.ask} />}
          </div>
        </div>
      </section>
    </div>
  );
}

/** Hybrid "+N": every agent of one stage card, newest first; a click opens that agent's detail. */
export function StageList({ s, room, onPick, onClose }: { s: SessionView; room: Room; onPick: (key: string) => void; onClose: () => void }) {
  const list = roomAgents(s.agents, room).reverse();
  return (
    <aside className="detail">
      <button className="close" onClick={onClose} aria-label={t('close')}>×</button>
      <h3>{t(`room.${room}`)} · {list.length}</h3>
      {list.map(a => <AgentChip key={a.key} a={a} selected={false} onClick={() => onPick(a.key)} />)}
    </aside>
  );
}
