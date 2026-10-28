import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionView, Snapshot } from '../../../shared/types.ts';
import { addBeat, EKG_H, EKG_W, SCROLL_MS, tracePoints } from '../logic/ekg.ts';
import { floorCounts, floorTitle, waitPill, type FloorNumbers } from '../logic/floors.ts';
import { t } from '../logic/i18n.ts';
import type { Settings } from '../logic/settings.ts';
import { zoomIn, zoomOut } from '../logic/zoom.ts';
import type { Live } from '../store.ts';
import { SettingsPanel } from './SettingsPanel.tsx';

/** A thin title over the floor and its wait pill; schema warning, connection and the ⚙ drawer. */
export function Header({ live, floor, numbers, settings, onSave, zoom, onZoom }: {
  live: Live; floor: SessionView | null; numbers: FloorNumbers; settings: Settings; onSave: (s: Settings) => void;
  zoom: { z: number | null; auto: number } | null; onZoom: (z: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); gear.current?.focus(); };
  const snap = live.snap;
  const c = floor ? floorCounts(floor) : null;
  const state = t(live.connected ? 'header.online' : 'header.offline');
  const cur = zoom ? zoom.z ?? zoom.auto : 0, zin = zoom ? zoomIn(cur) : null, zout = zoom ? zoomOut(cur) : null;
  return (
    <header className="header">
      {floor && c && <>
        <span className="htitle">{floorTitle(numbers[floor.sid], floor)}</span>
        {/* Pixel office + Isometric only; the steps from the stored one, else from the floor's auto scale */}
        {zoom && <span className="hzoom" role="group" aria-label={t('zoom.group')}>
          <button title={t('zoom.out')} aria-label={t('zoom.out')} disabled={zout === null} onClick={() => onZoom(zout)}>−</button>
          <button title={t('zoom.in')} aria-label={t('zoom.in')} disabled={zin === null} onClick={() => onZoom(zin)}>+</button>
          <button title={t('zoom.resetTitle')} disabled={zoom.z === null} onClick={() => onZoom(null)}>{t('zoom.reset')}</button>
        </span>}
        <span className={`hwait${c.wait === 0 ? ' none' : c.alert ? ' alert' : ''}`}>{waitPill(c)}</span>
      </>}
      <span className="hright">
        {snap && snap.unknownEvents + snap.badLines > 0 && (
          <span className="badge warn" title={t('header.schemaTitle', { u: snap.unknownEvents, b: snap.badLines })}>{t('header.schema')}</span>
        )}
        <span className={`conn ${live.connected ? 'ok' : 'off'}`} role="img" title={state} aria-label={`${t('header.status')}: ${state}`}>{t('header.status')}<Ekg connected={live.connected} snap={snap} /></span>
        <button ref={gear} className={`gear${open ? ' on' : ''}`} title={t('settings.title')} aria-label={t('settings.title')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>⚙</button>
      </span>
      <SettingsPanel open={open} settings={settings} onSave={onSave} onClose={close} />
    </header>
  );
}

const FLAT = tracePoints([], 0), STILL = tracePoints([0], SCROLL_MS / 2);

/** A heart-rhythm line: each snapshot from the server is one spike; flat while disconnected. Decorative. */
function Ekg({ connected, snap }: { connected: boolean; snap: Snapshot | null }) {
  const line = useRef<SVGPolylineElement>(null);
  const beats = useRef<number[]>([]);
  const [reduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [flash, setFlash] = useState(0); // reduced motion: the still spike brightens on each beat

  // store.ts makes a new snap object only when a snapshot message arrives, so its identity is the beat
  useEffect(() => {
    if (connected && snap && addBeat(beats.current, performance.now()) && reduced) setFlash(f => f + 1);
  }, [snap]);

  useLayoutEffect(() => {
    if (!connected || reduced) return;
    const el = line.current!;
    let raf = 0;
    const frame = () => { el.setAttribute('points', tracePoints(beats.current, performance.now())); raf = requestAnimationFrame(frame); };
    const toggle = () => { cancelAnimationFrame(raf); if (document.visibilityState === 'visible') frame(); };
    toggle();
    document.addEventListener('visibilitychange', toggle);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', toggle); beats.current = []; };
  }, [connected]);

  return (
    <svg className="ekg" width={EKG_W} height={EKG_H} viewBox={`0 0 ${EKG_W} ${EKG_H}`} aria-hidden="true">
      <polyline ref={line} key={flash} className={flash ? 'flash' : undefined} points={!connected ? FLAT : reduced ? STILL : undefined} />
    </svg>
  );
}
