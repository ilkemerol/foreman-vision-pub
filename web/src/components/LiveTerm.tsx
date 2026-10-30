import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TermLine, TermPage } from '../../../shared/types.ts';
import { brief, shortPath, type TermItem } from '../logic/blocks.ts';
import { lineDiff } from '../logic/diff.ts';
import { t, TEXT, type Key } from '../logic/i18n.ts';
import { toolName } from '../logic/labels.ts';

const POLL_MS = 1000;
const MAX_LINES = 500;
const NONE: TermLine[] = [];

/** The agent's transcript (GET /api/term, polled while `live`): another agent starts it over, closing keeps the lines. Nothing is ever sent to the agent. */
export function useTerm(sid: string, id: string, live: boolean): { lines: TermLine[]; remote: string | null } {
  const k = `${sid}/${id}`;
  const [term, setTerm] = useState<{ k: string; lines: TermLine[]; remote: string | null }>({ k, lines: NONE, remote: null });
  const cursor = useRef<number | null>(null), seen = useRef(k);
  useEffect(() => {
    if (seen.current !== k) { seen.current = k; cursor.current = null; }
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
          if (p.reset || p.lines.length || p.remote) setTerm(o => {
            const same = o.k === k;
            return { k, lines: [...(p.reset || !same ? [] : o.lines), ...p.lines].slice(-MAX_LINES), remote: p.remote ?? (same ? o.remote : null) };
          });
        }
      } catch { /* server away: the next poll tries again */ }
      if (!stop) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [k, live]);
  return term.k === k ? term : { lines: NONE, remote: null };
}

/** The transcript as a read-only terminal, newest at the bottom, following it unless the user scrolled up. A tool call and
 *  its result are one block, collapsed like the CLI; a click opens it, Edit/MultiEdit/Write as a diff. */
export function LiveTerm({ items, remote, cwd, jump, asking }: { items: TermItem[]; remote: string | null; cwd: string | null; jump: { id: string; n: number } | null; asking: string[] }) {
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [hl, setHl] = useState<string | null>(null);
  const toggle = (key: string) => setOpen(o => { const n = new Set(o); if (!n.delete(key)) n.add(key); return n; });
  useLayoutEffect(() => { if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight; }, [items]);
  useEffect(() => {
    if (!jump) return;
    follow.current = false;
    setOpen(o => new Set(o).add(jump.id));
    setHl(jump.id);
    requestAnimationFrame(() => log.current?.querySelector(`[data-key="${CSS.escape(jump.id)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [jump?.id, jump?.n]);
  return (
    <div className="lterm">
      <div className="tbar">
        <i /><i /><i /><b>{t('term.title')}</b>
        {remote && <a href={remote} target="_blank" rel="noreferrer">{t('term.remote')} ↗</a>}
      </div>
      <div ref={log} className="tlog" tabIndex={0} aria-label={t('term.title')}
        onScroll={e => { const el = e.currentTarget; follow.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4; }}>
        {items.length === 0 ? <div className="dim">{t('term.empty')}</div> : items.map((it, i) => ('line' in it
          ? <Line key={'-' + i} l={it.line} />
          : <Block key={it.key} it={it} cwd={cwd} open={open.has(it.key)} hl={hl === it.key || (asking.includes(it.key) && !it.out)} onToggle={() => toggle(it.key)} />))}
      </div>
    </div>
  );
}

const OP = { ' ': 'ctx', '-': 'del', '+': 'add' } as const;

/** One tool call: `● Name(path)`, then its brief result with an (open) control, or open its full output / diff with a (close) one.
 *  An unanswered AskUserQuestion lists its questions instead, as the CLI's dialog shows them (display only).
 *  The block takes the click (not while text is selected); its controls are buttons only for Tab/Enter, so one click is one toggle. */
function Block({ it, cwd, open, hl, onToggle }: { it: Extract<TermItem, { key: string }>; cwd: string | null; open: boolean; hl: boolean; onToggle: () => void }) {
  const { tool, out } = it, b = brief(tool, out);
  const asked = !out ? tool?.questions : undefined;
  const can = !asked && (open || !!b?.open);
  return (
    <div data-key={it.key} className={hl ? 'hl' : undefined}
      onClick={e => { if (can && ((e.target as HTMLElement).closest('button') || !getSelection()?.toString())) onToggle(); }}>
      {tool && <div className="tool">● <b>{toolName(tool.name ?? '')}</b>{tool.text ? `(${shortPath(tool.text, cwd)})` : ''}</div>}
      {!open && b && out && (
        <div className={out.kind}>
          ⎿ {b.text}
          {b.open && <>{b.more > 0 ? '\n' : ' '}<button className="more">{b.more > 0 ? t('term.more', { n: b.more }) + ' ' + t('term.open') : t('term.open')}</button></>}
        </div>
      )}
      {asked?.map((q, i) => (
        <div key={i} className="qs">
          <div className="q">{q.header && `[${q.header}] `}? {q.question}</div>
          {q.options.map((o, j) => <div key={j}>{q.multiSelect && '[ ] '}{j + 1}. {o.label}{o.description && <span className="dim"> — {o.description}</span>}</div>)}
        </div>
      ))}
      {open && !asked && <>
        {tool?.edits ? <>
          {tool.edits.map((e, i) => <div key={i} className="diff">{lineDiff(e.old, e.new).map((d, j) => <div key={j} className={OP[d.op]}>{d.op} {d.text}</div>)}</div>)}
          {tool.more ? <div className="diff dim">{t('term.more', { n: tool.more })}</div> : null}
        </> : out && <Line l={out} />}
        <div className="diff"><button className="more">{t('term.close')}</button></div>
      </>}
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
