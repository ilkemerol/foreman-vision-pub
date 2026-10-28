import { useEffect } from 'react';
import { t } from '../logic/i18n.ts';
import { useSize } from '../useSize.ts';
import { FloorSlide } from './FloorSlide.tsx';
import { flat } from './office/flat.ts';
import { iso } from './office/iso.ts';
import { keepDoneMems, OfficeFloor } from './OfficeFloor.tsx';
import type { ViewProps } from './view-props.ts';

/** Pixel office: the picked floor's office fills the main area at a whole-number scale. */
export function PixelView({ sessions, floor, numbers, style, ctxWindow, isoZoom, onIsoAuto, selected, collapsing, onSelect }: ViewProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  // a style change: the same OfficeFloor (and its walkers) draws on with the other renderer, nobody walks again
  const renderer = style === 'iso' ? iso : flat;
  useEffect(() => keepDoneMems(sessions), [sessions]);   // floors gone from the snapshot forget their Done lounge seats
  return (
    <div ref={ref} className="fit">
      {/* only the floor on screen (the incoming one while sliding) tells the header its auto scale */}
      <FloorSlide floor={floor} numbers={numbers} render={s =>
        <OfficeFloor s={s} plate={t('floor.badge', { n: numbers[s.sid] ?? '' })} collapse={collapsing.has(s.sid)} renderer={renderer} ctxWindow={ctxWindow} avail={size} selected={selected} onSelect={onSelect}
          zoom={isoZoom} onAuto={s.sid === floor.sid ? onIsoAuto : undefined} />
      } />
    </div>
  );
}
