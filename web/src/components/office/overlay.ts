import { getLang, t } from '../../logic/i18n.ts';
import { doneSide, keepInside, offOwn, shiftOff } from '../../logic/labels.ts';
import type { Rect } from '../../logic/layout.ts';
import { lottieFrame } from '../../lottie.ts';
import type { Body, Label } from './renderer.ts';

// The office's text as DOM over the canvas: crisp at any scale and devicePixelRatio.
type El = HTMLElement & { _html?: string; _size?: [number, number] };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function html(l: Label): [cls: string, html: string] {
  switch (l.kind) {
    case 'tag': {
      const hot = l.hot !== null ? `<span class="hot">${t('tag.hot', { n: l.hot })}</span>` : '';
      const pill = l.failed ? `<code class="fail">${t('tag.failed')}</code>` : l.pill ? `<code>${esc(l.pill)}</code>` : '';
      return ['tag', `<b style="color:${l.color};border-color:${l.color}">${esc(l.name)}${hot}</b>${pill}`];   // framed in its colour
    }
    case 'bubble': {
      // "permission:" / "needs-info:" lead the first line in colour
      const cls = l.alert ? 'k-perm' : 'k-info', tail = `<i class="tail${l.up ? ' up' : ''}"></i>`;
      // the icon's canvas has as many px as the text px it shows (styles.css .bub canvas), so its pixels scale evenly
      if (l.line) return ['bub line', `<canvas width="7" height="7"></canvas><div class="msg ${cls}">${esc(l.lines[0])}</div>${tail}`];
      const msg = l.lines.map((t, i) => {
        const m = i === 0 ? t.match(/^([\w-]+:)(.*)$/) : null;
        return m ? `<span class="${cls}">${esc(m[1])}</span>${esc(m[2])}` : esc(t);
      }).join('<br>');
      return [`bub${l.compact ? ' compact' : ''}`, `<canvas width="10" height="10"></canvas><div><small>${esc(l.head)}</small><div class="msg">${msg}</div></div>${tail}`];
    }
    case 'sign': return [`sign ${l.tone}${l.side ? (l.side < 0 ? ' l' : ' r') : ''}`, esc(l.text)];
    case 'done': return [`dl ${l.side}`, `<span style="color:${l.color};border-color:${l.color}">${esc(l.text)}</span>`];
    case 'gauge': return ['sign gauge', `<span style="color:${l.color}">${esc(l.text)}</span>`];
  }
}

const place = (e: HTMLElement, x: number, y: number) => {
  const left = Math.round(x) + 'px', top = Math.round(y) + 'px';
  if (e.style.left !== left) e.style.left = left;
  if (e.style.top !== top) e.style.top = top;
};

/** The overlay's text size in CSS px per text px: the office scale, but never below 2 so text stays readable. */
export const textScale = (scale: number): number => Math.max(scale, 2);

/** Keyed DOM nodes for `labels` under `root`: placed at office px × `scale` CSS px, sized by textScale; nodes of keys no
 *  longer there go. Every label but a balloon is kept inside the root (the canvas), measured only when its content or the
 *  language changes. A resting agent's label (`own`) then moves sideways, the shortest way and at most its own width,
 *  off the signs (1 text px clear of their shadow ring), the other resting agents' sprites (`bodies`, office px) and
 *  the `own` labels before it, else off the signs and labels only (the sign stays). Its
 *  inputs hold still while everyone rests, so it does not flicker. `text`: CSS px per text px (the caller's: a fitted or
 *  zoomed iso's own ratio). */
export function syncOverlay(root: HTMLElement, labels: Label[], scale: number, bodies: Body[] = [], text = textScale(scale)): void {
  const t = text, s = String(t), W = root.clientWidth, H = root.clientHeight;
  const rescale = root.style.getPropertyValue('--s') !== s;
  if (rescale) root.style.setProperty('--s', s);
  const lang = getLang(), relang = root.lang !== lang;
  if (relang) root.lang = lang;
  if (root.style.getPropertyValue('--o') !== String(scale)) root.style.setProperty('--o', String(scale));   // a one-line balloon's width cap
  const seen = new Set<string>();
  const els = new Map<string, El>();
  for (const e of root.children as HTMLCollectionOf<El>) if (e.dataset.key) els.set(e.dataset.key, e);
  const signs: Rect[] = [], owned: [string, El, number, number, number, number, number][] = [];   // own, node, x, y, w, h, ax
  for (let l of labels) {
    seen.add(l.key);
    const [cls, h] = html(l);
    let e = els.get(l.key);
    if (!e) { e = document.createElement('div'); e.dataset.key = l.key; root.appendChild(e); }
    if (rescale || relang) e._size = undefined;
    // a Done lounge label's side (dl l / dl r) is only its translateX: its size stays, and its side is written once below
    if (e.className !== cls && !(cls.startsWith('dl ') && e.className.startsWith('dl '))) { e._size = undefined; e.className = cls; }
    if (e._html !== h) { e.innerHTML = h; e._html = h; e._size = undefined; }
    if (l.kind !== 'bubble') {
      const [w, ht] = e._size ??= [e.offsetWidth, e.offsetHeight];
      if (l.kind === 'done') {   // off the office edge to its agent's other side, not back onto its head (renderers: 9 px beside)
        const d = doneSide(l.x * scale, w, l.side, 9 * scale, W);
        let c = cls;
        if (d.side !== l.side) { l = { ...l, side: d.side, x: d.x / scale }; c = html(l)[0]; }
        if (e.className !== c) e.className = c;
      }
      const ax = l.kind === 'tag' || l.kind === 'gauge' ? 0.5 : l.kind === 'sign' ? (1 - l.side) / 2 : l.side === 'l' ? 1 : 0;   // the CSS translateX
      const p = keepInside(l.x * scale, l.y * scale, w, ht, W, H, ax, l.kind === 'tag' && l.above !== undefined ? l.above * scale : undefined);
      if ((l.kind === 'tag' || l.kind === 'done') && l.own !== undefined) { owned.push([l.own, e, p.x, p.y, w, ht, ax]); continue; }
      if (l.kind === 'sign' || l.kind === 'gauge') signs.push({ x0: p.x - w * ax - 2 * t, y0: p.y - 2 * t, x1: p.x + w * (1 - ax) + 2 * t, y1: p.y + ht + 3 * t });
      place(e, p.x, p.y);
      continue;
    }
    const tail = e.lastElementChild as HTMLElement;
    if (l.tipX !== undefined) {   // x, y is the outer box (1 px border outside the element); the tail under it at tipX
      const width = l.line && l.w !== undefined ? `${l.w * scale - 2 * t}px` : '';   // a one-line one's outer width, its border off
      if (e.style.width !== width) e.style.width = width;
      place(e, (l.x + 1) * scale, (l.y + 1) * scale);
      tail.style.left = Math.round((l.tipX - l.x - 1) * scale) + 'px';
    } else {   // the balloon stays inside its clamp range, its tail points at the agent
      const w = e.offsetWidth, ht = e.offsetHeight;
      const left = Math.min(Math.max(l.x * scale - w / 2, l.clamp[0] * scale), l.clamp[1] * scale - w);
      place(e, left, Math.max(0, l.y * scale - ht - 4 * t));
      tail.style.left = Math.round(l.x * scale - left) + 'px';
    }
    const cv = e.firstElementChild as HTMLCanvasElement, icon = lottieFrame(l.icon, cv.width), cg = cv.getContext('2d')!;
    cg.clearRect(0, 0, cv.width, cv.height);
    if (icon) cg.drawImage(icon, 0, 0);
  }
  const css = (b: Rect): Rect => ({ x0: b.x0 * scale, y0: b.y0 * scale, x1: b.x1 * scale, y1: b.y1 * scale });
  // so it stays by its agent: off everything at most its own width away, else off the signs and labels at most twice
  // that, else in place; one that would land on its own agent's sprite goes over its head (clear of the ✓ there, 4 px
  // over it), under its feet or to its other side where that is free (labels.ts offOwn)
  for (const [own, e, x, y, w, ht, ax] of owned) {
    const b = { x0: x - w * ax, y0: y, x1: x + w * (1 - ax), y1: y + ht }, others = [...signs, ...bodies.filter(o => o.id !== own).map(css)];
    const body = bodies.find(o => o.id === own), dx0 = shiftOff(b, others, W, w) ?? shiftOff(b, signs, W, 2 * w) ?? 0;
    const { dx, dy } = body ? offOwn(b, dx0, css(body), others, W, H, 4 * scale) : { dx: dx0, dy: 0 };
    place(e, x + dx, y + dy);
    signs.push({ x0: b.x0 + dx - 1, y0: b.y0 + dy, x1: b.x1 + dx + 1, y1: b.y1 + dy });   // the next resting label keeps off this one too (1 px for rounding)
  }
  for (const [k, e] of els) if (!seen.has(k)) e.remove();
}
