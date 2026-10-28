import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { SessionView } from '../../../shared/types.ts';
import { blockAt, collapseBlocks, COLLAPSE_MS, cracked, FADE_MS, shakeAt } from '../logic/collapse.ts';
import { badgeShift, byFloor, floorCounts, type FloorNumbers } from '../logic/floors.ts';
import { t } from '../logic/i18n.ts';
import { drawIcon, EYE_ROWS, iconRows, ICON_PX } from '../logic/icon.ts';
import { shortSid } from '../logic/model.ts';
import { loopIn, playOnce, type LottieName } from '../lottie.ts';
import { useDpr } from '../useSize.ts';

/** The floor picker, the highest F on top (always sorted by F); a fresh floor pops in, an ended one fades. */
export function Sidebar({ sessions, numbers, fresh, collapsing, floor, onPick }: {
  sessions: SessionView[]; numbers: FloorNumbers; fresh: Set<string>; collapsing: ReadonlySet<string>; floor: string | null; onPick: (sid: string) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand"><Logo /><div><h1>foreman-vision</h1><small>{t('side.tagline')}</small></div></div>
      <div className="cards">
        {byFloor(sessions, numbers).reverse().map(s => {
          const c = floorCounts(s);
          return (
            <Card key={s.sid} crumble={collapsing.has(s.sid)} onClick={() => onPick(s.sid)}
              className={`card${s.sid === floor ? ' sel' : ''}${s.ended ? ' ended' : ''}${fresh.has(s.sid) ? ' pop' : ''}`}>
              <span className="row1"><KBadge k={numbers[s.sid]} /><span className="proj">{s.project}</span></span>
              <span className="sid">{shortSid(s.sid)}{s.foreman !== 'off' && <span className="fbadge">foreman</span>}</span>
              <span className="counts" title={t('side.counts')}>
                <span className="c-run">{c.run}</span><span className="c-wait">{c.wait}</span><span className="c-done">{c.done}</span>
              </span>
              {fresh.has(s.sid) && <Lottie className="confetti" name="confetti" once />}
              {c.wait > 0 && <span className={`wbadge${c.alert ? ' alert' : ''}`} title={t('side.waitBadge')}>{c.wait}</span>}
            </Card>
          );
        })}
      </div>
    </aside>
  );
}

/** The card's floor number; when a known floor is renumbered (a floor under it went or came back)
 *  the new number slides in from the side it came from for SHIFT_MS. Reduced motion: no shift. */
function KBadge({ k }: { k: number }) {
  const ref = useRef<HTMLSpanElement>(null), prev = useRef<number>(undefined);
  useLayoutEffect(() => {
    const dir = badgeShift(prev.current, k);
    prev.current = k;
    if (!dir || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const from = dir === 'down' ? '-100%' : '100%';   // a smaller number drops in from above
    ref.current!.animate([{ transform: `translateY(${from})`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: SHIFT_MS, easing: 'ease-out' });
  }, [k]);
  return <span className="kbadge"><span ref={ref} className="kn">{t('floor.badge', { n: k })}</span></span>;
}
const SHIFT_MS = 300;

const CARD_BLOCK = 8;   // css px

/** A floor card; `crumble`: its floor was hidden, so it breaks into pixel blocks that fall (copies of the card, each
 *  clipped to its block), then its height closes; under reduced motion it fades. */
function Card({ crumble, className, children, onClick }: { crumble: boolean; className: string; children: ReactNode; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const card = ref.current!;
    if (!crumble) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const a = card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: 'forwards' });
      return () => a.cancel();
    }
    const w = card.offsetWidth, h = card.offsetHeight, layer = document.createElement('span');
    layer.className = 'crumble';
    Object.assign(layer.style, { left: `${-card.clientLeft}px`, top: `${-card.clientTop}px` });
    const blocks = collapseBlocks(w, h, CARD_BLOCK, Math.random).map(b => {
      const el = document.createElement('i'), copy = card.cloneNode(true) as HTMLElement;
      Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
      Object.assign(copy.style, { left: `${-b.x}px`, top: `${-b.y}px`, width: `${w}px`, height: `${h}px` });
      el.append(copy);
      layer.append(el);
      return { b, el };
    });
    card.append(layer);
    card.classList.add('crumbling');
    const t0 = performance.now();
    let raf = 0, close: Animation | undefined;
    const step = (now: number) => {
      const e = now - t0, sh = shakeAt(e), seam = cracked(e) ? 1 : 0;
      for (const { b, el } of blocks) {
        const { dx, dy, p } = blockAt(b, e, h * 2);
        el.style.transform = `translate(${dx + sh.x}px, ${dy + sh.y}px)`;
        el.style.width = `${b.w - seam}px`; el.style.height = `${b.h - seam}px`;
        el.style.opacity = String(1 - p);
      }
      // the emptied card closes; the -8 px margin takes the cards' gap with it
      close ??= e > COLLAPSE_MS - 300 ? card.animate([{ height: `${h}px` }, { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '-8px' }], { duration: 300, fill: 'forwards' }) : undefined;
      if (e < COLLAPSE_MS) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); close?.cancel(); layer.remove(); card.classList.remove('crumbling'); };
  }, [crumble]);
  return <button ref={ref} className={className} onClick={onClick}>{children}</button>;
}

/** A smooth (not pixelated) Lottie in a span; `once` plays it a single time on mount, as the fresh card's confetti. */
function Lottie({ name, once, className }: { name: LottieName; once?: boolean; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => (once ? playOnce : loopIn)(ref.current!, name), [name, once]);
  return <span ref={ref} className={className} />;
}

const LIDS = [1, EYE_ROWS, 1, 0]; // a blink: half, shut, half, open

/** The brand icon at 2× (whole device pixels at any dpr); its eye blinks every 6–10 s, still under prefers-reduced-motion. */
function Logo() {
  const ref = useRef<HTMLCanvasElement>(null);
  const dpr = useDpr();
  useEffect(() => {
    const c = ref.current!, k = Math.max(1, Math.round(2 * dpr));
    c.width = c.height = ICON_PX * k;
    c.style.width = c.style.height = `${ICON_PX * k / dpr}px`;
    const g = c.getContext('2d')!;
    const draw = (lid: number) => { g.clearRect(0, 0, c.width, c.height); drawIcon(g, iconRows({ lid }), k); };
    draw(0);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let i = LIDS.length, timer = 0;
    const tick = () => {
      if (i < LIDS.length) { draw(LIDS[i++]); timer = window.setTimeout(tick, 70); }
      else { i = 0; timer = window.setTimeout(tick, 6000 + Math.random() * 4000); }
    };
    tick();
    return () => clearTimeout(timer);
  }, [dpr]);
  return <canvas ref={ref} className="logo" aria-hidden="true" />;
}
