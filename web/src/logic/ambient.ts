// The ambient layer: the time of day from the local clock, the sky through the windows, plant
// sway, clouds and birds, scrolling screen lines and the analog clock's hands. Pure: a function of the clock alone,
// so a reload, a tab return, a style or floor change shows the same sky.
import type { Pt } from './layout.ts';

/** Sunrise and sunset, local clock hours: an approximation, a 12 h day at the same hours everywhere all year (no location is known). */
export const SUN = [7, 19] as const;

export const LAMPS_AT = 0.35;   // lamps and ceiling lights on from this darkness
// sky colours by hours past the horizon (x < 0: the sun is up): [x, top, horizon, cloud]
const SKY: [number, string, string, string][] = [[-1.5, '#6fb6ee', '#cfe9ff', '#ffffff'], [-0.6, '#86aee0', '#ffe0a8', '#fff4e0'], [0, '#6f78c0', '#ff9966', '#ffc2a0'],
  [0.35, '#3c3f80', '#d0607a', '#a06080'], [0.8, '#182048', '#2b3466', '#3a4370'], [1.5, '#0e1430', '#1a2248', '#2a3158']];
const rgb = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
/** `a` → `b` at k (0..1), as #rrggbb. */
export const mix = (a: string, b: string, k: number): string =>
  '#' + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * k).toString(16).padStart(2, '0')).join('');
export function skyAt(x: number): [string, string, string] {
  if (x <= SKY[0][0]) return [SKY[0][1], SKY[0][2], SKY[0][3]];
  for (let i = 1; i < SKY.length; i++) if (x <= SKY[i][0]) {
    const a = SKY[i - 1], b = SKY[i], k = (x - a[0]) / (b[0] - a[0]);
    return [mix(a[1], b[1], k), mix(a[2], b[2], k), mix(a[3], b[3], k)];
  }
  const z = SKY[SKY.length - 1];
  return [z[1], z[2], z[3]];
}

/** h: local hours; x: hours past the nearest sunrise or sunset (< 0 the sun is up); dark 0..1: 0 until 30 min before
 *  sunset, 0.15 at sunset, 1 from 45 min after it; the mirror at dawn. */
export interface Phase { h: number; rise: number; set: number; x: number; dark: number; lamps: boolean; sky: [string, string, string] }
export function phase(d: Date): Phase {
  const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600, [rise, set] = SUN;
  const up = h >= rise && h < set, m = up ? Math.min(h - rise, set - h) : Math.min((h - set + 24) % 24, (rise - h + 24) % 24), x = up ? -m : m;
  const dark = x < -0.5 ? 0 : x < 0 ? 0.15 * (1 + x / 0.5) : Math.min(1, 0.15 + 0.85 * x / 0.75);
  return { h, rise, set, x, dark, lamps: dark >= LAMPS_AT, sky: skyAt(x) };
}

/** An integer hash for seeded sky things. */
export const ih = (n: number): number => {
  n = Math.imul((n | 0) ^ ((n | 0) >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
};

/** A plant's sideways shift now, whole px (1 px, 6 s); 0 when calm (prefers-reduced-motion). */
export const SWAY = { amp: 1, period: 6000 } as const;
export const swayDx = (seed: number, now: number, calm: boolean): number =>
  calm ? 0 : Math.round(SWAY.amp * Math.sin(now / SWAY.period * 2 * Math.PI + seed * 6.283));
/** Bands [row0, row1, k] of a swaying sprite: each moves trunc(k · dx) px; the pot and the hook stay. */
export const SWAY_BANDS = {
  LARGE_PLANT: [[0, 16, 1], [16, 28, 0.5], [28, 48, 0]],
  HANGING_PLANT: [[0, 19, 0], [19, 26, 0.5], [26, 32, 1]],
} as const;

// the sky outside: one strip SKY_W px wide that clouds and birds wrap round; each window shows its part
export const SKY_W = 1400, CLOUDS = 6, BIRD_EVERY = 90_000, BIRD_V = 0.045;   // birds at a medium speed
export interface Cloud { x: number; y: number; w: number }
/** The clouds at time t (ms; frozen at 0 when calm): left x in sky px, top row in the glass, width 8–14. */
export function cloudsAt(t: number): Cloud[] {
  return Array.from({ length: CLOUDS }, (_, i) => {
    const w = 8 + ih(i + 1) % 7, y = 1 + ih(i * 3 + 1) % 4, v = (1.5 + ih(i * 5 + 1) % 10 / 10) / 1000;
    return { x: Math.round((t * v + ih(i * 11 + 1) % SKY_W) % (SKY_W + 40) - 20), y, w };
  });
}
/** The birds at time t: one flight per BIRD_EVERY slice (start and direction from the slice's hash), a pair one time in
 *  three; none while dark ≥ 0.6. x, y: the 3×2 bird's top-left (sky px, glass row); frame 0 wings down, 1 up. */
export function birdsAt(t: number, dark: number): { x: number; y: number; frame: 0 | 1 }[] {
  if (dark >= 0.6) return [];
  const out: { x: number; y: number; frame: 0 | 1 }[] = [], dur = (SKY_W + 40) / BIRD_V, k = Math.floor(t / BIRD_EVERY);
  for (const s of [k - 1, k]) {
    const u = t - (s * BIRD_EVERY + ih(s) % (BIRD_EVERY / 2));
    if (u < 0 || u >= dur) continue;
    const dir = ih(s * 7) % 2 ? 1 : -1, x = Math.round(dir > 0 ? -20 + u * BIRD_V : SKY_W + 20 - u * BIRD_V), y = 2 + ih(s * 13) % 5 + Math.round(Math.sin(u / 400));
    const frame = (Math.floor(u / 140) % 2) as 0 | 1;
    out.push({ x, y, frame });
    if (ih(s * 17) % 3 === 0) out.push({ x: x - dir * 7, y: y + 2, frame: (1 - frame) as 0 | 1 });
  }
  return out;
}
/** A star's glass row at sky x (1 in 23 columns), or null; still, in the top 70 % of an h-row glass. */
export const starAt = (x: number, h: number): number | null => ih(x * 7 + 3) % 23 === 0 ? ih(x) % Math.max(1, Math.floor(h * 0.7)) : null;
export const MOON_X = Math.round(SKY_W * 0.31);

/** A lit screen's three code lines (8×3 px, top first) at tick n (one line up every SCREEN_MS). */
export const SCREEN_MS = 450;
export function screenLines(n: number, seed: number): { x: number; w: number; bright: boolean }[] {
  return [0, 1, 2].map(j => { const k = n + seed * 37 + j, x = ih(k * 3) % 3; return { x, w: Math.min(2 + ih(k) % 6, 8 - x), bright: ih(k * 5) % 3 !== 0 }; });
}

/** The analog CLOCK's hands as px offsets from its face centre (sprite px 7, 16): minute 3 px, hour 2 px. */
export function clockHands(d: Date): { minute: Pt[]; hour: Pt[] } {
  const hand = (a: number, n: number) => Array.from({ length: n }, (_, i) => ({ x: Math.round(Math.sin(a) * (i + 1)) + 0, y: 0 - Math.round(Math.cos(a) * (i + 1)) }));   // + 0: no −0
  const m = d.getMinutes(), h = d.getHours() % 12 + m / 60;
  return { minute: hand(m / 60 * 2 * Math.PI, 3), hour: hand(h / 12 * 2 * Math.PI, 2) };
}
