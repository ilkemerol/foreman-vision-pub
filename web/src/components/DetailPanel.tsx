import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentView, SessionView, TermLine, TermPage } from '../../../shared/types.ts';
import { roomAgents, type Room } from '../logic/hybrid.ts';
import { getLang, t, TEXT, whyText, type Key } from '../logic/i18n.ts';
import { stageText, toolName } from '../logic/labels.ts';
import { badgeText, colorOf, duration, stretchStart } from '../logic/model.ts';
import { AgentChip } from './AgentChip.tsx';

/** A pop-up over the dimmed, blurred floor with id, type, model, parent, job, note, active tool, last 5 tool calls, time and tokens. */
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
          // aria-modal: Tab cycles × (the terminal's link, its scroll area), never reaching the page behind
          if (e.key === 'Tab') {
            e.preventDefault();
            const f = [...box.current!.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]')];
            const i = f.indexOf(document.activeElement as HTMLElement);
            f[i < 0 ? (e.shiftKey ? f.length - 1 : 0) : (i + (e.shiftKey ? f.length - 1 : 1)) % f.length]?.focus();
          }
        }}>
        <div className="settings-head">
          <h2 id="agent-title" style={{ color: colorOf(a) }}>{a.label}</h2>
          <button ref={x} className="settings-x" title={t('close')} aria-label={t('close')} onClick={onClose}>×</button>
        </div>
        <div className="agent-body">
          <dl>{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
          <h4>{t('detail.recent')}</h4>
          <ol>{a.recentTools.map((x, i) => <li key={i}>{toolName(x.name)}{x.label ? `: ${x.label}` : ''} <small>{x.ms} ms</small></li>)}</ol>
        </div>
        <LiveTerm key={`${s.sid}/${a.id}`} sid={s.sid} id={a.id} live={!closing} />
      </section>
    </div>
  );
}

const POLL_MS = 1000;
const MAX_LINES = 500;

/** The agent's transcript as a read-only terminal (GET /api/term, polled while the pop-up is open): newest at the
 *  bottom, following it unless the user scrolled up. Nothing is ever sent to the agent. */
function LiveTerm({ sid, id, live }: { sid: string; id: string; live: boolean }) {
  const [lines, setLines] = useState<TermLine[]>([]);
  const [remote, setRemote] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const cursor = useRef<number | null>(null);
  useEffect(() => {
    if (!live) return;
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const q = new URLSearchParams({ session: sid, agent: id });
        if (cursor.current !== null) q.set('from', String(cursor.current));
        const r = await fetch('/api/term?' + q, { headers: { 'X-Foreman-Vision': '1' } });
        if (r.status === 404) return;   // no transcript for it (a board row, a pending spawn): nothing to follow
        if (r.ok) {
          const p = await r.json() as TermPage;
          if (stop) return;
          cursor.current = p.cursor;
          if (p.remote) setRemote(p.remote);
          if (p.reset || p.lines.length) setLines(old => [...(p.reset ? [] : old), ...p.lines].slice(-MAX_LINES));
        }
      } catch { /* server away: the next poll tries again */ }
      if (!stop) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [live]);
  useLayoutEffect(() => { if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight; }, [lines]);
  return (
    <div className="lterm">
      <div className="tbar">
        <i /><i /><i /><b>{t('term.title')}</b>
        {remote && <a href={remote} target="_blank" rel="noreferrer">{t('term.remote')} ↗</a>}
      </div>
      <div ref={log} className="tlog" tabIndex={0} aria-label={t('term.title')}
        onScroll={e => { const el = e.currentTarget; follow.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4; }}>
        {lines.length === 0 ? <div className="dim">{t('term.empty')}</div> : lines.map((l, i) => <Line key={i} l={l} />)}
      </div>
    </div>
  );
}

function Line({ l }: { l: TermLine }) {
  if (l.kind === 'text') return <div className="text">● {l.text}</div>;
  if (l.kind === 'tool') return <div className="tool">● <b>{toolName(l.name ?? '')}</b>{l.text ? `(${l.text})` : ''}</div>;
  if (l.kind === 'big') return <div className="out">⎿ {t('term.big')}</div>;
  if (l.kind === 'user') {
    const from = `term.from.${l.from}`;
    return <div className="user">❯ {l.from !== 'prompt' && <b>[{from in TEXT.en ? t(from as Key) : l.from}] </b>}{l.text}</div>;
  }
  const images = Array(l.images ?? 0).fill(t('term.image')).join(' ');
  return (
    <div className={l.kind}>
      ⎿ {l.text || images || t('term.none')}{l.text && images ? ' ' + images : ''}
      {l.more ? <span className="dim">{'\n' + t('term.more', { n: l.more })}</span> : null}
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
