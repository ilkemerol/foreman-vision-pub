import { useMemo, useRef } from 'react';
import type { Snapshot } from '../../shared/types.ts';
import { newFloors, numberFloors, type FloorNumbers } from './logic/floors.ts';

/**
 * Floor numbers by age, plus `fresh`: every sid that arrived after the first snapshot of this page.
 * A fresh card keeps its sid for the page's life, so its pop-in plays once on mount and a reload replays nothing.
 */
export function useFloors(snap: Snapshot | null): { numbers: FloorNumbers; fresh: Set<string> } {
  const seen = useRef<Set<string> | null>(null);
  const fresh = useRef(new Set<string>());
  // ponytail: mutates refs inside useMemo, like useHeld; fine without StrictMode's double render
  return useMemo(() => {
    if (snap) {
      for (const sid of newFloors(seen.current, snap.sessions)) fresh.current.add(sid);
      seen.current = new Set(snap.sessions.map(s => s.sid));
    }
    return { numbers: numberFloors(snap?.sessions.map(s => s.sid) ?? []), fresh: new Set(fresh.current) };
  }, [snap]);
}
