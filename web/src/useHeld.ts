import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { Snapshot } from '../../shared/types.ts';
import { applyHold, type Held } from './logic/hold.ts';

/** The snapshot to draw: stages held for MIN_STAGE_MS, redrawn when a hold runs out. */
export function useHeld(snap: Snapshot | null): Snapshot | null {
  const held = useRef<Held>(new Map());
  const [tick, redraw] = useReducer((n: number) => n + 1, 0);
  // ponytail: mutates a ref inside useMemo; fine without StrictMode's double render
  const out = useMemo(() => (snap ? applyHold(held.current, snap, Date.now()) : null), [snap, tick]);
  useEffect(() => {
    if (out?.nextAt == null) return;
    const t = setTimeout(redraw, Math.max(0, out.nextAt - Date.now()));
    return () => clearTimeout(t);
  }, [out]);
  return out?.snap ?? null;
}
