// Iso zoom: the header's steps and the whole-px drawing of a layout. Pure.
import { dashFrame, FLAT, ISO, MARGIN, textRatio, type Layout, type Style, type StyleScale } from './layout.ts';

/** CSS px per office px. */
export const ZOOM_STEPS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const EPS = 1e-6;
export const isStep = (z: unknown): z is number => typeof z === 'number' && ZOOM_STEPS.some(s => Math.abs(s - z) < EPS);
/** The next step up / down from `cur` (a stored step or the auto scale, which may be off the list); null past the ends. */
export const zoomIn = (cur: number): number | null => ZOOM_STEPS.find(s => s > cur + EPS) ?? null;
export const zoomOut = (cur: number): number | null => [...ZOOM_STEPS].reverse().find(s => s < cur - EPS) ?? null;
/** The scroll (CSS px, whole, clamped) that puts office point `c` at the visible centre: the canvas at `o` in
 *  the scroll content, `z` CSS px per office px, `client` visible, `max` = scrollWidth − clientWidth. */
export const zoomScroll = (c: number, z: number, o: number, client: number, max: number): number =>
  Math.min(Math.max(0, Math.round(c * z + o - client / 2)), Math.max(0, max));
/** The office point (office px) at the visible centre. */
export const zoomCentre = (scroll: number, z: number, o: number, client: number): number => (scroll + client / 2 - o) / z;

/** How a style's office is shown: its StyleScale (device: the canvas's backing scale, css: CSS px per office px) plus
 *  the sizes OfficeFloor sets (CSS px): `text` (overlay --s), `textK` (text px per office px, the scene's), the office
 *  canvas W×H, the frame canvas fw×fh, the shell's padding (frame + margin), and `at`, the shell's top-left margin in
 *  the pane (null: centred by CSS margin: auto, as today). */
export interface Shown extends StyleScale { text: number; textK: number; W: number; H: number; fw: number; fh: number; pad: { t: number; r: number; b: number; l: number }; at: { x: number; y: number } | null }

/** Flat and a whole device px iso: today's numbers exactly; iso with its own text ratio (the fit or
 *  a zoom step's layout) at its own scale, every size and position whole CSS px. `w × h`:
 *  the pane (CSS px); `sb`: its scrollbar. */
export function shown(l: Layout, st: Style, w: number, h: number, dpr: number, sb: number): Shown {
  const v = l.views[st], s = (st === 'flat' ? FLAT : ISO).size(l.cols, l.rows), f = v.frame ? dashFrame(s.w, s.h) : null, textK = textRatio(v);
  if (st === 'flat' || v.k === undefined) {
    const c = v.css, pad = f ? { t: f.t * c + v.my, r: f.r * c + v.mx, b: f.b * c + v.my, l: f.l * c + v.mx } : { t: v.my, r: v.mx, b: v.my, l: v.mx };
    return { ...v, text: Math.max(c, 2), textK, W: s.w * c, H: s.h * c, fw: f ? f.w * c : 0, fh: f ? f.h * c : 0, pad, at: null };
  }
  const z = v.css, R = Math.round, W = R(s.w * z), H = R(s.h * z), fw = f ? R(f.w * z) : W, fh = f ? R(f.h * z) : H;
  const fl = f ? R(f.l * z) : 0, ft = f ? R(f.t * z) : 0;
  // frameBox's margin rule: 8 where it fits, less where only the margin would scroll, 8 and a scroll where nothing fits
  const margin = (a: number, n: number) => a - 2 * MARGIN >= n || a < n ? MARGIN : Math.floor((a - n) / 2);
  let cw = Math.floor(w), ch = Math.floor(h), mx = 0, my = 0, x = false, y = false;
  for (let i = 0; i < 3; i++) {   // one axis's scrollbar narrows the other
    mx = margin(cw, fw); my = margin(ch, fh); x = fw + 2 * mx > cw; y = fh + 2 * my > ch;
    const nw = Math.floor(y ? w - sb : w), nh = Math.floor(x ? h - sb : h);
    if (nw === cw && nh === ch) break;
    cw = nw; ch = nh;
  }
  // text: the layout's own ratio (decor.ts isoK) · z
  return { device: v.device, css: z, frame: v.frame, mx, my, scroll: { x, y }, text: textK * z, textK, W, H, fw: f ? fw : 0, fh: f ? fh : 0,
    pad: { t: ft + my, r: fw - W - fl + mx, b: fh - H - ft + my, l: fl + mx }, at: { x: x ? 0 : Math.floor((cw - fw - 2 * mx) / 2), y: y ? 0 : Math.floor((ch - fh - 2 * my) / 2) } };
}
