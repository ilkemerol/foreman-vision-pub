/** The header's heart-rhythm line: one spike per snapshot, scrolling left. Size in CSS px. */
export const EKG_W = 48, EKG_H = 14;
export const SCROLL_MS = 3000;  // a spike crosses the whole width in this time
export const BEAT_GAP_MS = 600; // closer beats are dropped, so a burst does not glue spikes together

const BASE = 9;
// QRS-like shape relative to where the beat sits: small dip, tall peak, dip, back to baseline (y grows down)
const SPIKE: [number, number][] = [[-6, 0], [-5, 2], [-3.5, -7], [-2, 2.5], [-1, 0]];

/** Records a beat at `now` unless the last one is under BEAT_GAP_MS ago; forgets beats off the left edge. */
export function addBeat(beats: number[], now: number): boolean {
  while (beats.length && now - beats[0] >= SCROLL_MS) beats.shift();
  if (beats.length && now - beats[beats.length - 1] < BEAT_GAP_MS) return false;
  beats.push(now);
  return true;
}

/** SVG polyline points for the trace at `now`; a beat ends at the right edge when it arrives. `beats` is oldest first. */
export function tracePoints(beats: number[], now: number): string {
  const out = [`0,${BASE}`];
  for (const b of beats) {
    const x = EKG_W - ((now - b) / SCROLL_MS) * EKG_W;
    if (x <= 0 || x > EKG_W) continue;
    for (const [dx, dy] of SPIKE) out.push(`${+(x + dx).toFixed(1)},${BASE + dy}`);
  }
  out.push(`${EKG_W},${BASE}`);
  return out.join(' ');
}
