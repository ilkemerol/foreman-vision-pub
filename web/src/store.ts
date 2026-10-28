import { useSyncExternalStore } from 'react';
import type { Snapshot, SseMessage } from '../../shared/types.ts';

export interface Live { snap: Snapshot | null; connected: boolean }

let live: Live = { snap: null, connected: false };
const subs = new Set<() => void>();
const set = (next: Live) => { live = next; for (const f of subs) f(); };
let skew = 0; // serverTime − Date.now() at the last snapshot

/** The server's clock, so stage times and durations line up with the snapshot. */
export const serverNow = (): number => Date.now() + skew;

// EventSource reconnects on its own and the server sends a full snapshot on every connect
const es = new EventSource('/events');
es.onopen = () => set({ ...live, connected: true });
es.onerror = () => set({ ...live, connected: false });
es.onmessage = e => {
  const m = JSON.parse(e.data) as SseMessage;
  if (m.type === 'snapshot') {
    skew = m.data.serverTime - Date.now();
    set({ snap: m.data, connected: true });
  }
};

const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
export const useLive = () => useSyncExternalStore(subscribe, () => live);
