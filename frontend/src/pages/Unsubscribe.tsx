import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { api } from '../lib/api';

/** Landing page of the unsubscribe link in e-mails. The link carries its own HMAC token, so no login is needed. */
export function Unsubscribe() {
  const { t } = useTranslation();
  const [q] = useSearchParams();
  const [state, setState] = useState<'working' | 'done' | 'invalid'>('working');
  const kind = q.get('k') ?? '';
  useEffect(() => {
    const qs = new URLSearchParams({ u: q.get('u') ?? '', k: kind, t: q.get('t') ?? '' });
    api('POST', `/api/email/unsubscribe?${qs}`).then(() => setState('done')).catch(() => setState('invalid'));
  }, [q, kind]);
  return (
    <Shell>
      <div className="glass w-full max-w-md rounded-[28px] p-8 text-center" role="status" aria-live="polite">
        <h1 className="mb-2 text-2xl font-extrabold text-navy">{t('app:unsub.title')}</h1>
        <p className="mb-4 text-muted">{state === 'working' ? t('app:unsub.working') : state === 'done' ? t(`app:unsub.done.${['digest', 'instant', 'all'].includes(kind) ? kind : 'all'}`) : t('app:unsub.invalid')}</p>
        <Link to="/profile" className="inline-flex h-11 items-center rounded-full bg-navy px-6 font-extrabold text-white hover:bg-navy-deep">{t('app:unsub.manage')}</Link>
      </div>
    </Shell>
  );
}
