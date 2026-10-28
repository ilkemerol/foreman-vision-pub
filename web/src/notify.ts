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

export function beep() {
  try {
    audio ??= new AudioContext();
    void audio.resume(); // created before a user gesture it starts suspended
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.15);
  } catch { /* no audio available: stay silent */ }
}
