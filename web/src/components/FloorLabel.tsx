import type { SessionView } from '../../../shared/types.ts';
import { t } from '../logic/i18n.ts';
import { shortSid } from '../logic/model.ts';

/** Project folder + short sid + foreman badge, plus how many wait on the user. */
export function FloorLabel({ s }: { s: SessionView }) {
  return (
    <span className="flabel">
      <b>{s.project}</b> <code>{shortSid(s.sid)}</code>
      {s.foreman !== 'off' && <span className="badge fm">foreman</span>}
      {s.waitingCount > 0 && <span className="badge wait">{t('floor.waiting', { n: s.waitingCount })}</span>}
      {s.ended && <span className="badge">{t('floor.ended')}</span>}
    </span>
  );
}
