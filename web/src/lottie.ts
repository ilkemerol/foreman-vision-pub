// light canvas build: the files use no expressions, and the full build's eval breaks a clean bundle
import type { AnimationItem, LottiePlayer } from 'lottie-web/build/player/lottie_light_canvas';

// the player loads in its own chunk; until it is here (or if it never comes) no Lottie draws, they are decoration
let lottie: LottiePlayer | null = null;
const ready = import('lottie-web/build/player/lottie_light_canvas').then(m => { lottie = m.default; }, e => console.warn('lottie did not load', e));

export type LottieName = 'confetti' | 'bell' | 'question' | 'lamp' | 'check' | 'coffee';

const FILES: Record<LottieName, string> = {
  confetti: 'a-confetti-burst', bell: 'b-ring-the-bell', question: 'b-question-mark',
  lamp: 'f-alert-lamp', check: 'c-success-check', coffee: 'c-brewing-coffee',
};

function load(lottie: LottiePlayer, container: HTMLElement, name: LottieName, loop: boolean): AnimationItem {
  return lottie.loadAnimation({ container, renderer: 'canvas', loop, autoplay: true, path: `/lottie/${FILES[name]}.json` });
}

/** Starts the animation once the player is here, unless the cleanup ran first. */
function later(container: HTMLElement, name: LottieName, loop: boolean, start: (anim: AnimationItem) => void = () => {}): () => void {
  let anim: AnimationItem | null = null, gone = false;
  void ready.then(() => { if (!gone && lottie) start(anim = load(lottie, container, name, loop)); });
  return () => { gone = true; anim?.destroy(); };
}

/** In the office Lottie is pixelated; it plays smooth in a hidden 96×96 canvas and is downsampled per size. */
const sources = new Map<LottieName, { anim: AnimationItem; el: HTMLElement; src: HTMLCanvasElement | null; small: Map<number, { c: HTMLCanvasElement; f: number }> }>();

export function lottieFrame(name: LottieName, px: number): HTMLCanvasElement | null {
  let s = sources.get(name);
  if (!s) {
    if (!lottie) return null;
    const el = document.createElement('div');
    el.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 96px; height: 96px';
    document.body.appendChild(el);
    sources.set(name, s = { anim: load(lottie, el, name, true), el, src: null, small: new Map() });
  }
  const src = s.src ??= s.el.querySelector('canvas'); // called every frame: look the canvas up once
  if (!src || !src.width || !s.anim.isLoaded) return null;
  let sm = s.small.get(px);
  if (!sm) {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    s.small.set(px, sm = { c, f: -1 });
  }
  if (sm.f !== s.anim.currentFrame) {
    // the downsample is smooth; the caller scales the result up with smoothing off
    const g = sm.c.getContext('2d')!;
    g.clearRect(0, 0, px, px);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, px, px);
    sm.f = s.anim.currentFrame;
  }
  return sm.c;
}

/** Plays once in `container` and destroys itself; the cleanup stops it early. */
export function playOnce(container: HTMLElement, name: LottieName): () => void {
  return later(container, name, false, anim => anim.addEventListener('complete', () => anim.destroy()));
}

export function loopIn(container: HTMLElement, name: LottieName): () => void {
  return later(container, name, true);
}
