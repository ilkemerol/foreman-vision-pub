import type { Lang } from './i18n.ts';
import { isStep } from './zoom.ts';

export type ViewName = 'kanban' | 'hybrid' | 'pixel';
export type OfficeStyle = 'flat' | 'iso';
export type CtxWindow = '200k' | '1M';
export interface Settings { view: ViewName; style: OfficeStyle; sound: boolean; notify: boolean; lang: Lang; ctxWindow: CtxWindow; floor: string | null;
  // the isometric office's zoom step (CSS px per office px); null: auto. The header writes it at once, like floor
  isoZoom: number | null;
}

export const DEFAULTS: Settings = { view: 'pixel', style: 'flat', sound: false, notify: true, lang: 'en', ctxWindow: '200k', floor: null, isoZoom: null };
const KEY = 'foreman-vision.settings';

/** Bad or old JSON in localStorage must never break the page: each field falls back on its own. */
export function parseSettings(raw: string | null): Settings {
  let o: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(raw ?? '{}');
    if (v && typeof v === 'object') o = v as Record<string, unknown>;
  } catch { /* defaults */ }
  return {
    view: o.view === 'kanban' || o.view === 'hybrid' || o.view === 'pixel' ? o.view : DEFAULTS.view,
    style: o.style === 'flat' || o.style === 'iso' ? o.style : DEFAULTS.style,
    sound: typeof o.sound === 'boolean' ? o.sound : DEFAULTS.sound,
    notify: typeof o.notify === 'boolean' ? o.notify : DEFAULTS.notify,
    lang: o.lang === 'tr' ? 'tr' : 'en',
    ctxWindow: o.ctxWindow === '1M' ? '1M' : '200k',
    floor: typeof o.floor === 'string' ? o.floor : DEFAULTS.floor,
    isoZoom: isStep(o.isoZoom) ? o.isoZoom : null,
  };
}

/** fallback: what runs when storage is off (private mode), so a Save still holds for this tab */
export function loadSettings(fallback: Settings = DEFAULTS): Settings {
  try { return parseSettings(localStorage.getItem(KEY)); } catch { return fallback; }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: settings live for this tab only */ }
}

/** The ⚙ drawer's fields; floor is not one of them (the sidebar changes it at once). */
export function samePrefs(a: Settings, b: Settings): boolean {
  return a.view === b.view && a.style === b.style && a.sound === b.sound && a.notify === b.notify && a.lang === b.lang && a.ctxWindow === b.ctxWindow;
}

/** The drawer's draft onto the current settings: the latest floor stays, a stale one never comes back. */
export function withPrefs(current: Settings, draft: Settings): Settings {
  return { ...current, view: draft.view, style: draft.style, sound: draft.sound, notify: draft.notify, lang: draft.lang, ctxWindow: draft.ctxWindow };
}
