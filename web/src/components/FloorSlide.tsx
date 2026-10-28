import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionView } from '../../../shared/types.ts';
import { passedFloors, type FloorNumbers } from '../logic/floors.ts';
import { t } from '../logic/i18n.ts';

const SLIDE = { duration: 450, easing: 'cubic-bezier(.65,0,.35,1)' }; // reduced motion: the plain slide, no shudder
const CREEP_MS = 360, MOVE_MS = 540, PASS_MS = 250, PASS_CAP = 3;
// [ms, floors travelled, sideways px]: an old elevator shudders while it creeps 4 % of a floor
// (each step snaps, whole px), then eases in to full speed and just arrives
const CREEP: [number, number, number][] = [
  [0, 0, 0], [45, 0.005, 2], [90, 0.01, -2], [135, 0.015, 1], [180, 0.02, -2],
  [225, 0.025, 2], [270, 0.03, -1], [315, 0.035, 1], [360, 0.04, 0],
];

/** A ride of `n` floors: 900 ms for one, 250 ms more for each floor passed up to 3; a longer ride only goes faster. */
const rideMs = (n: number) => CREEP_MS + MOVE_MS + PASS_MS * Math.min(n - 1, PASS_CAP);

/** Every pane gets the same steps, pane `slot` (0 the old floor … n the new one) `slot` floors behind, so they stay in lock-step. */
function frames(d: number, n: number, slot: number): Keyframe[] {
  const ms = rideMs(n);
  return [...CREEP, [ms, n, 0]].map(([at, p, x]) => ({
    offset: at / ms, transform: `translate(${x}px, ${(p - slot) * d}%)`,
    easing: at < CREEP_MS ? 'steps(1, end)' : 'cubic-bezier(.32,0,.67,0)',
  }));
}

/**
 * Elevator: on a floor change the old and the new floor slide together; they shudder and creep, then
 * speed up (900 ms; the plain 450 ms slide under reduced motion). A ride past other floors shows each one passing as
 * its number plate (a full floor would mount its office and play its one-shot arrivals mid-ride), see rideMs.
 * Going to a bigger F the content moves down (the new floor comes from above). No slide on first mount.
 */
export function FloorSlide({ floor, numbers, render }: { floor: SessionView; numbers: FloorNumbers; render: (s: SessionView) => ReactNode }) {
  const [cur, setCur] = useState(floor.sid);
  const [out, setOut] = useState<{ s: SessionView; up: boolean; pass: number[] } | null>(null);
  const last = useRef(floor); // the latest view of the floor on screen, drawn while it slides away
  const inEl = useRef<HTMLDivElement>(null), outEl = useRef<HTMLDivElement>(null), slideEl = useRef<HTMLDivElement>(null);
  if (cur !== floor.sid) {
    // set during render, so the old pane never unmounts between the two commits
    setCur(floor.sid);
    // reduced motion keeps its one-floor slide: floors flying past are the motion it asks to spare
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setOut({ s: last.current, up: (numbers[floor.sid] ?? 0) > (numbers[last.current.sid] ?? 0),
      pass: calm ? [] : passedFloors(numbers, last.current.sid, floor.sid) });
  }
  useEffect(() => { last.current = floor; });
  useLayoutEffect(() => {
    if (!out) return;
    const d = out.up ? 100 : -100, n = out.pass.length + 1;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timing = calm ? SLIDE : { duration: rideMs(n) };
    const a = inEl.current?.animate(calm ? [{ transform: `translateY(${-d}%)` }, { transform: 'none' }] : frames(d, n, n), timing);
    const b = outEl.current?.animate(calm ? [{ transform: 'none' }, { transform: `translateY(${d}%)` }] : frames(d, n, 0), { ...timing, fill: 'forwards' });
    const mid = [...slideEl.current!.querySelectorAll<HTMLElement>(':scope > .pass')].map((el, i) => el.animate(frames(d, n, i + 1), { ...timing, fill: 'forwards' }));
    if (b) b.onfinish = () => setOut(null);
    return () => { a?.cancel(); b?.cancel(); for (const m of mid) m.cancel(); };
  }, [out]);
  return (
    <div ref={slideEl} className="slide">
      {out && <div key={out.s.sid} ref={outEl} className="pane">{render(out.s)}</div>}
      {out?.pass.map(k => <div key={`pass-${k}`} className="pane pass"><b className="kbadge">{t('floor.badge', { n: k })}</b></div>)}
      <div key={floor.sid} ref={inEl} className="pane">{render(floor)}</div>
    </div>
  );
}
