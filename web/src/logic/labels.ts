import type { AgentView, Stage, ToolRef } from '../../../shared/types.ts';
import { t, whyText } from './i18n.ts';
import type { Rect } from './layout.ts';
import type { Product } from './courier-art.ts';
import { productOf } from './couriers.ts';

// Text for the office's DOM overlay: name tags, tool pills, speech balloons.
export const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const PRODUCT: Record<Product, string> = { teams: 'Teams', outlook: 'Outlook', sharepoint: 'SharePoint', microsoft: 'Microsoft 365',
  gmail: 'Gmail', calendar: 'Calendar', drive: 'Drive', docs: 'Docs', sheets: 'Sheets', slides: 'Slides' };
/** Couriers: `mcp__<server>__<tool>` reads as its product (else the server, its connector/plugin prefix dropped)
 *  and the tool, its product prefix dropped: `Outlook · email_search`. Any other name stays. */
export function toolName(name: string): string {
  const [mcp, server, ...rest] = name.split('__'), tool = rest.join('__');
  if (mcp !== 'mcp' || !tool) return name;
  const p = productOf(server, tool);
  return `${p ? PRODUCT[p] : server.replace(/^(claude_ai_|plugin_[^_]+_)/, '').replace(/_/g, ' ')} · ${tool.replace(/^(teams|outlook|sharepoint)_/, '')}`;
}
export const toolText = (t: ToolRef): string => (t.label === null ? toolName(t.name) : `${toolName(t.name)} ${t.label}`);

/** The tool pill under the name tag: what it runs now, else what it ran last. */
export function pillText(a: AgentView): string | null {
  const t = a.activeTools[0] ?? a.recentTools[0];
  return t ? '▸ ' + trunc(toolText(t), 22) : null;
}

/** Greedy word wrap; a word longer than a line is split, text left over cuts the last line with '…'. */
export function wrapBalloon(text: string, width = 28, lines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean).flatMap(w => {
    const parts: string[] = [];
    for (let i = 0; i < w.length; i += width) parts.push(w.slice(i, i + width));
    return parts;
  });
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    if (!cur) cur = words[i];
    else if (cur.length + 1 + words[i].length <= width) cur += ' ' + words[i];
    else {
      out.push(cur);
      if (out.length === lines) {
        out[lines - 1] = trunc(cur + ' ' + words.slice(i).join(' '), width);
        return out;
      }
      cur = words[i];
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** A DOM label (w×h) kept inside the W×H office frame: `x` is its anchor, `ax` the share of its width left of it (its
 *  CSS translateX), `y` its top. One that would cross the bottom flips its bottom to `above` (over the agent's head)
 *  when given; then it is clamped inside. Any one unit (office or CSS px). */
export function keepInside(x: number, y: number, w: number, h: number, W: number, H: number, ax: number, above?: number): { x: number; y: number } {
  if (y + h > H && above !== undefined) y = above - h;
  return { x: Math.min(Math.max(x, w * ax), W - w * (1 - ax)), y: Math.min(Math.max(y, 0), H - h) };
}

/** A Done lounge label's side: `x` its anchor, `gap` from its agent's x (side 'l' ends there, 'r' starts there), `w` wide.
 *  One that would cross 0..W (keepInside would push it back onto its agent's head) takes the other side when that one
 *  fits; else it stays. Returns the side and its anchor. Any one unit. */
export function doneSide(x: number, w: number, side: 'l' | 'r', gap: number, W: number): { side: 'l' | 'r'; x: number } {
  const fits = (s: 'l' | 'r', a: number) => (s === 'l' ? a - w >= 0 : a + w <= W);
  const other = side === 'l' ? 'r' : 'l', ox = side === 'l' ? x + 2 * gap : x - 2 * gap;
  return fits(side, x) || !fits(other, ox) ? { side, x } : { side: other, x: ox };
}

/** A balloon (w×h) beside a target rect `r`, centred on it vertically: left of it (its tail on the right edge) when it
 *  fits there, else right of it, else left, pushed inside 0..W × 0..H. `x`,`y` its top-left; `ty` where the tail
 *  points, down the balloon from its top (kept 12 off the corners). Any one unit. */
export function sidePlace(r: Rect, w: number, h: number, W: number, H: number, gap: number): { side: 'l' | 'r'; x: number; y: number; ty: number } {
  const side = r.x0 - gap - w >= 0 || r.x1 + gap + w > W ? 'l' : 'r';
  const x = Math.min(Math.max(side === 'l' ? r.x0 - gap - w : r.x1 + gap, 0), Math.max(W - w, 0));
  const y = Math.min(Math.max((r.y0 + r.y1) / 2 - h / 2, 0), Math.max(H - h, 0));
  return { side, x, y, ty: Math.min(Math.max((r.y0 + r.y1) / 2 - y, 12), Math.max(h - 12, 12)) };
}

/** How far to move box `b` sideways off every obstacle it meets, the shortest way (a door
 *  sign stays, a seated agent's label moves): 0 when it meets none; else the smallest move left or right, at most
 *  `max`, after which it meets none and stays within 0..W; null when no such move exists. Any one unit. */
export function shiftOff(b: Rect, obstacles: Rect[], W: number, max = Infinity): number | null {
  const row = obstacles.filter(o => o.y0 < b.y1 && b.y0 < o.y1);
  const clear = (dx: number) => Math.abs(dx) <= max && b.x0 + dx >= 0 && b.x1 + dx <= W && !row.some(o => o.x0 < b.x1 + dx && b.x0 + dx < o.x1);
  return [0, ...row.flatMap(o => [o.x1 - b.x0, o.x0 - b.x1])].sort((p, q) => Math.abs(p) - Math.abs(q)).find(clear) ?? null;
}

const meet = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Where a resting label `b` goes when shiftOff's move `dx` (not 0) puts it on its own agent's
 *  sprite `own`: over its head (its bottom `above` clear of the sprite's top), else under its feet, both at that x, else
 *  on its agent's other side (mirrored about the sprite's centre), the first that meets neither the sprite nor any of
 *  `obstacles` and stays inside W×H; else where shiftOff put it. Returns its move. Any one unit. */
export function offOwn(b: Rect, dx: number, own: Rect, obstacles: Rect[], W: number, H: number, above = 0): { dx: number; dy: number } {
  const at = (x: number, y: number): Rect => ({ x0: b.x0 + x, y0: b.y0 + y, x1: b.x1 + x, y1: b.y1 + y });
  if (dx === 0 || !meet(at(dx, 0), own)) return { dx, dy: 0 };
  const free = ({ dx, dy }: { dx: number; dy: number }) => { const r = at(dx, dy); return r.x0 >= 0 && r.y0 >= 0 && r.x1 <= W && r.y1 <= H && ![own, ...obstacles].some(o => meet(o, r)); };
  return [{ dx, dy: own.y0 - above - b.y1 }, { dx, dy: own.y1 - b.y0 }, { dx: own.x0 + own.x1 - b.x0 - b.x1, dy: 0 }].find(free) ?? { dx, dy: 0 };
}

/** Smooth's tag (key `cat`) and a Done lounge agent's name (kind 'done') show only while the
 *  pointer is on her or it (`hover`: the hit box's id). */
export const shownLabels = <L extends { kind: string; key: string }>(labels: L[], hover: string | null, cat = 'cat'): L[] =>
  labels.filter(l => (l.key === cat ? hover === cat : l.kind !== 'done' || l.key === 'done-' + hover));

/** The main desk is the foreman's, or just the desk when foreman is off. */
export const tagName = (a: AgentView): string => (a.role === 'foreman' ? t('name.foreman') : a.role === 'main' ? t('name.desk') : a.label);

// The hover terminal.
export interface TermLine { text: string; kind: 'old' | 'cur' | 'why-alert' | 'why-info' | 'ok' }

/** Oldest → newest, at most 5; the active tool counts as the newest. A wait ends with its reason, done with ✓. */
export function termLines(a: AgentView): TermLine[] {
  const calls = [...a.activeTools.slice(0, 1), ...a.recentTools].map(toolText);
  const tail: TermLine | null = a.stage === 'waiting' ? { text: '⏸ ' + (whyText(a) || t('wait.you')), kind: a.alert ? 'why-alert' : 'why-info' }
    : a.stage === 'done' ? { text: t('term.done'), kind: 'ok' } : null;
  const lines: TermLine[] = calls.slice(0, tail ? 4 : 5).reverse().map(text => ({ text, kind: 'old' }));
  if (tail) lines.push(tail);
  else if (lines.length) lines[lines.length - 1].kind = 'cur';
  return lines;
}

const p2 = (n: number) => String(n).padStart(2, '0');
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${p2(Math.floor(s / 60))}:${p2(s % 60)}`;
}

export const stageText = (s: Stage): string => t(`stage.${s}`);
