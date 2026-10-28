import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** The content box of the element behind `ref`, kept current with a ResizeObserver. */
export function useSize<T extends HTMLElement>(): [RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** window.devicePixelRatio, kept current: moving the window to another monitor or a browser zoom changes it. */
export function useDpr(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useLayoutEffect(() => {
    const mq = matchMedia(`(resolution: ${dpr}dppx)`), on = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [dpr]);
  return dpr;
}

let sb: number | undefined;
/** The page's scrollbar thickness (CSS px; 0 for overlay scrollbars), measured once on a hidden scrolling box. */
export function scrollbarSize(): number {
  if (sb === undefined) {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll';
    document.body.appendChild(d);
    sb = d.offsetWidth - d.clientWidth;
    d.remove();
  }
  return sb;
}
