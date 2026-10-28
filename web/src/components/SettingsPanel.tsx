import { useEffect, useRef, useState } from 'react';
import { t, type Key, type Lang } from '../logic/i18n.ts';
import { samePrefs, type CtxWindow, type OfficeStyle, type Settings, type ViewName } from '../logic/settings.ts';

const VIEWS: [ViewName, Key][] = [['pixel', 'view.pixel'], ['hybrid', 'view.hybrid'], ['kanban', 'view.kanban']];
const STYLES: [OfficeStyle, Key][] = [['flat', 'style.flat'], ['iso', 'style.iso']];
const CTX_WINDOWS: CtxWindow[] = ['200k', '1M'];
// each language named in itself, so a user who cannot read the current one still finds theirs
const LANGS: [Lang, string][] = [['en', 'English'], ['tr', 'Türkçe']];

/** The ⚙ drawer. Choices stay in a draft until Save; closing without it drops them.
 *  Its own text follows the saved language, not the draft.
 *  It stays mounted, so CSS slides it out as well as in. */
export function SettingsPanel({ open, settings, onSave, onClose }: {
  open: boolean; settings: Settings; onSave: (s: Settings) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [, rerender] = useState(0);
  // each opening starts from what is saved; adjusted during render, so no stale draft slides in
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); setSaved(false); if (open) setDraft(settings); }
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { if (open) panel.current?.focus(); }, [open]);
  // "Saved" shows for a moment, then the drawer closes; closing first (Esc) clears saved and the timer
  useEffect(() => { if (!saved) return; const timer = setTimeout(onClose, 600); return () => clearTimeout(timer); }, [saved]);
  const set = (p: Partial<Settings>) => setDraft(d => ({ ...d, ...p }));
  const askPermission = draft.notify && 'Notification' in window && Notification.permission === 'default';
  return (
    <div className={`drawer${open ? ' open' : ''}`} inert={!open}>
      <div className="drawer-dim" onClick={onClose} />
      <aside ref={panel} className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
          if (e.key !== 'Tab') return;
          // aria-modal: Tab wraps inside the drawer, never reaching the page behind it
          const f = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input')], at = document.activeElement;
          if (e.shiftKey ? at === f[0] || at === panel.current : at === f[f.length - 1]) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
        }}>
        <div className="settings-head">
          <h2 id="settings-title">{t('settings.title')}</h2>
          <button className="settings-x" title={t('close')} aria-label={t('close')} onClick={onClose}>×</button>
        </div>
        <div className="settings-body">
          <fieldset>
            <legend><span lang="tr">Dil</span> / Language</legend>
            <div className="seg">
              {LANGS.map(([v, name]) => (
                <label key={v} lang={v}><input type="radio" name="lang" checked={draft.lang === v} onChange={() => set({ lang: v })} /><span>{name}</span></label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{t('settings.view')}</legend>
            <div className="seg">
              {VIEWS.map(([v, key]) => (
                <label key={v}><input type="radio" name="view" checked={draft.view === v} onChange={() => set({ view: v })} /><span>{t(key)}</span></label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{t('settings.style')}</legend>
            <div className="seg">
              {STYLES.map(([v, key]) => (
                <label key={v}><input type="radio" name="style" checked={draft.style === v} onChange={() => set({ style: v })} /><span>{t(key)}</span></label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{t('corner.window')}</legend>
            <div className="seg">
              {CTX_WINDOWS.map(v => (
                <label key={v}><input type="radio" name="ctx" checked={draft.ctxWindow === v} onChange={() => set({ ctxWindow: v })} /><span>{v}</span></label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{t('settings.alerts')}</legend>
            <label className="switch">
              <span>{t('settings.sound')}<small>{t('settings.soundHint')}</small></span>
              <input type="checkbox" role="switch" checked={draft.sound} onChange={e => set({ sound: e.target.checked })} /><i />
            </label>
            <label className="switch">
              <span>{t('settings.notify')}<small>{t('settings.notifyHint')}</small></span>
              <input type="checkbox" role="switch" checked={draft.notify} onChange={e => set({ notify: e.target.checked })} /><i />
            </label>
            {askPermission && <button className="settings-ask" onClick={() => void Notification.requestPermission().then(() => rerender(n => n + 1))}>{t('settings.allow')}</button>}
          </fieldset>
        </div>
        <div className="settings-foot">
          <button onClick={onClose}>{t('settings.cancel')}</button>
          <button className={`primary${saved ? ' done' : ''}`} disabled={saved || samePrefs(draft, settings)}
            onClick={() => { onSave(draft); setSaved(true); }}>{saved ? t('settings.saved') : t('settings.save')}</button>
        </div>
      </aside>
    </div>
  );
}
