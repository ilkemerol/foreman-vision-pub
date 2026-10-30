import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AskView } from '../../../shared/types.ts';
import { answers, draft, keep, other, pick, recommended, type Pick } from '../logic/answer.ts';
import { t } from '../logic/i18n.ts';

/** Main's open AskUserQuestion under its terminal, each question's options, its own Other box and one
 *  Send. Once sent (or answered elsewhere: 404) the snapshot drops `ask` and the area goes with it. Half-made picks
 *  survive closing the pop-up (a draft per question). */
export function AskForm({ ask }: { ask: AskView }) {
  const qs = ask.questions;
  const [p, setPicks] = useState(() => draft(ask.id, qs));
  const setP = (v: Pick[]) => { keep(ask.id, v); setPicks(v); };
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // the narrow layout stacks it under the terminal: bring it into view when it comes
  useEffect(() => { box.current?.scrollIntoView({ block: 'nearest' }); }, []);
  // answered elsewhere while focus is in here: the area goes (before it leaves the page), focus stays on the pop-up
  useLayoutEffect(() => {
    const el = box.current!;
    return () => { if (el.contains(document.activeElement)) el.closest<HTMLElement>('[role="dialog"]')?.focus(); };
  }, []);
  const a = answers(qs, p);
  const send = async () => {
    if (!a || busy) return;
    // the focused Send / Other box goes disabled, which drops focus to the page: keep it on the pop-up (its Esc, its Tab)
    if (box.current?.contains(document.activeElement)) box.current.closest<HTMLElement>('[role="dialog"]')?.focus();
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch('/api/ask/' + ask.id, { method: 'POST', headers: { 'X-Foreman-Vision': '1', 'content-type': 'application/json' }, body: JSON.stringify({ answers: a }) });
      if (r.status === 204 || r.status === 404) { keep(ask.id, null); return; }   // stays disabled until the snapshot takes it away
    } catch { /* the server away: try again */ }
    setFailed(true);
    setBusy(false);
  };
  return (
    <div ref={box} className="ask">
      {qs.map((q, i) => (
        <div key={q.question}>
          <div className="q">{q.header && <span className="h">{q.header}</span>}? {q.question}{q.multiSelect && <small> · {t('ask.multi')}</small>}</div>
          <div className="opts">{q.options.map(o => {
            const on = p[i].labels.includes(o.label);
            return <button key={o.label} className={'opt' + (recommended(o.label) ? ' rec' : '') + (on ? ' on' : '')} aria-pressed={on}
              disabled={busy} onClick={() => setP(pick(qs, p, i, o.label))}>{o.label}{o.description && <small>{o.description}</small>}</button>;
          })}</div>
          <div className="inp">
            <input value={p[i].other} maxLength={4000} placeholder={t('ask.other')} aria-label={`${q.question} ${t('ask.other')}`} disabled={busy}
              onChange={e => setP(other(qs, p, i, e.target.value))}
              onKeyDown={e => {
                if (e.key === 'Enter') void send();
                // Esc only leaves the box (focus back on the pop-up, which keeps its own Esc); the text and the pop-up stay
                if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus(); }
              }} />
          </div>
        </div>
      ))}
      <div className="foot">
        {failed && <span className="fail" role="alert">{t('ask.failed')}</span>}
        <button className="send" disabled={!a || busy} onClick={() => void send()}>{t('ask.send')}</button>
      </div>
    </div>
  );
}
