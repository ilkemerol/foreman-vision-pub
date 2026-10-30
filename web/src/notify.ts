import type { AlertRef } from './logic/alerts.ts';
import { t } from './logic/i18n.ts';
import { drawIcon, iconRows, ICON_PX } from './logic/icon.ts';

let lastDot: boolean | null = null;

/** A dot on the favicon while someone waits. */
export function setFavicon(dot: boolean) {
  if (dot === lastDot) return;
  lastDot = dot;
  const c = document.createElement('canvas');
  c.width = c.height = ICON_PX * 2;
  drawIcon(c.getContext('2d')!, iconRows({ dot }), 2);
  (document.getElementById('favicon') as HTMLLinkElement).href = c.toDataURL();
}

/** A click brings the tab forward and selects the agent; without permission only title + favicon remain. */
export function desktopNotify(a: AlertRef, onClick: () => void) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    // No tag: a tag would silently replace a still-open notice when the same agent waits again
    const n = new Notification(`${a.project}: ${a.label}`, { body: a.reason || t('wait.you') });
    n.onclick = () => { window.focus(); onClick(); n.close(); };
  } catch { /* some environments throw on construction; title + favicon still carry the alert */ }
}

let audio: AudioContext | null = null;
let room: GainNode | null = null;

/** The dry path plus a short noise tail, the small room around the notes. */
function makeRoom(ctx: AudioContext) {
  const dry = ctx.createGain();
  const wet = ctx.createConvolver();
  const wetGain = ctx.createGain();
  const ir = ctx.createBuffer(2, ctx.sampleRate * 0.9, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.16));
  }
  wet.buffer = ir;
  wetGain.gain.value = 0.15;
  dry.gain.value = 0.3;
  dry.connect(ctx.destination);
  dry.connect(wet).connect(wetGain).connect(ctx.destination);
  return dry;
}

function partial(ctx: AudioContext, out: AudioNode, t: number, freq: number, peak: number, attack: number, decay: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + attack + decay + 0.02);
}

/** Two kalimba notes, each a soft tone plus a brief metallic pluck. */
export function beep() {
  try {
    audio ??= new AudioContext();
    room ??= makeRoom(audio);
    void audio.resume(); // created before a user gesture it starts suspended
    const t = audio.currentTime + 0.01;
    for (const [f, at] of [[523.25, 0], [783.99, 0.11]]) {
      partial(audio, room, t + at, f, 0.65, 0.003, 0.75);
      partial(audio, room, t + at, f * 6.27, 0.07, 0.002, 0.05);
    }
  } catch { /* no audio available: stay silent */ }
}
