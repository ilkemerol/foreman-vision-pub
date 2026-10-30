import { Fragment, useEffect, useRef, useState } from 'react';
import { t, versionText, type Key } from '../logic/i18n.ts';

const CREDITS: [label: Key, links: [name: string, url: string][]][] = [
  ['about.art', [['Pixel Agents', 'https://github.com/pixel-agents-hq/pixel-agents'], ['Metro City', 'https://jik-a-4.itch.io/metrocity-free-topdown-character-pack']]],
  ['about.animations', [['LottieFiles', 'https://lottiefiles.com'], ['lottie-web', 'https://github.com/airbnb/lottie-web']]],
  ['about.inspiration', [['claude-office', 'https://github.com/paulrobello/claude-office'], ['Claude-Code-Agent-Monitor', 'https://github.com/hoangsonww/Claude-Code-Agent-Monitor']]],
];

/** The ⓘ pop-up, on the agent pop-up's modal: versions on the left, credits on the right. A closed one stays .28 s to fade out. */
export function AboutPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (open || !shown) return;
    const id = setTimeout(() => setShown(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280);
    return () => clearTimeout(id);
  }, [open, shown]);
  // null until it answers or when it fails: both show — and never "not installed", which only the server can know
  const [about, setAbout] = useState<{ version: string; commit: string | null; foreman: string | null } | null>(null);
  useEffect(() => {
    if (!open) return;
    void fetch('/api/about', { headers: { 'X-Foreman-Vision': '1' } })
      .then(r => (r.ok ? r.json() : null)).catch(() => null).then(setAbout);
  }, [open]);
  const box = useRef<HTMLElement>(null);
  useEffect(() => { if (open) box.current?.focus(); }, [open]);
  if (!shown) return null;
  const missing = about !== null && about.foreman === null;
  return (
    <div className={`modal${open ? '' : ' out'}`} inert={!open}>
      <div className="drawer-dim" onClick={onClose} />
      <section ref={box} className="agent about" role="dialog" aria-modal="true" aria-labelledby="about-title" tabIndex={-1}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
          // aria-modal: Tab cycles × and the links, never reaching the page behind
          if (e.key === 'Tab') {
            e.preventDefault();
            const f = [...box.current!.querySelectorAll<HTMLElement>('button, a[href]')];
            const i = f.indexOf(document.activeElement as HTMLElement);
            f[i < 0 ? (e.shiftKey ? f.length - 1 : 0) : (i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
          }
        }}>
        <div className="settings-head">
          <h2 id="about-title">{t('about.title')}</h2>
          <button className="settings-x" title={t('close')} aria-label={t('close')} onClick={onClose}>×</button>
        </div>
        <div className="agent-cols">
          <div className="agent-body">
            <div className="prod">
              <div className="t">foreman-vision<span className="v">{about ? versionText(about.version, about.commit) : '—'}</span></div>
              <p>{t('about.vision')}</p>
              <p><a href="https://github.com/ilkemerol/foreman-vision-pub" target="_blank" rel="noreferrer">github.com/ilkemerol/foreman-vision-pub</a></p>
              <p className="tag">{t('about.tagline')}</p>
            </div>
            <div className={`prod${missing ? ' off' : ''}`}>
              <div className="t">foreman<span className="v">{missing ? t('about.notInstalled') : about?.foreman ?? '—'}</span></div>
              <p>{t('about.foreman')}</p>
              <p><a href="https://github.com/ilkemerol/foreman" target="_blank" rel="noreferrer">github.com/ilkemerol/foreman</a></p>
              <p className="tag">{t('about.tagline')}</p>
            </div>
          </div>
          <div className="agent-body">
            <div>
              <h4>{t('about.credits')}</h4>
              <ul>{CREDITS.map(([label, links]) => (
                <li key={label}><span>{t(label)}</span>{links.map(([name, url], i) => (
                  <Fragment key={name}>{i > 0 && ', '}<a href={url} target="_blank" rel="noreferrer">{name}</a></Fragment>
                ))}</li>
              ))}</ul>
            </div>
            <p className="fine">{t('about.note')}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
