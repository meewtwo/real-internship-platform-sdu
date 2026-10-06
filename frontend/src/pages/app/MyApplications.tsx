import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, LoadState, MatchBadge, PageHeader, StatusBadge, btnDanger, btnGhost } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { apiErrText } from '../../lib/errors';
import { fmtDate } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';

interface App { id: string; status: string; matchPercent: number; createdAt: string; vacancy: { id: string; title: string; company: string; status: string }; events: { status: string; at: string }[] }

export function MyApplications() {
  const { t } = useTranslation();
  usePageTitle('nav.applications');
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ applications: App[] }>('/api/applications');
  const withdraw = async (id: string) => {
    if (!window.confirm(t('app:confirm'))) return;
    try { await api('POST', `/api/applications/${id}/withdraw`); toast(t('app:apps.withdrawn')); await reload(); } catch (e) { toast(apiErrText(t, e), 'error'); }
  };
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('app:apps.title')} />
      <LoadState loading={loading && !data} error={error} empty={!!data && data.applications.length === 0} emptyText={t('app:apps.empty')} />
      <ul className="space-y-3">
        {data?.applications.map((a) => (
          <li key={a.id}>
            <Card>
              <div className="flex flex-wrap items-start gap-3">
                <MatchBadge percent={a.matchPercent} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-extrabold text-navy"><Link to={`/vacancies/${a.vacancy.id}`} className="hover:text-brand hover:underline">{a.vacancy.title}</Link></h2>
                  <p className="text-[13px] text-muted">{a.vacancy.company} · {t('app:apps.appliedOn', { date: fmtDate(a.createdAt) })}</p>
                  <div className="mt-1.5"><StatusBadge status={a.status} label={t(`options:appStatuses.${a.status}`)} /></div>
                </div>
                {!['withdrawn', 'rejected'].includes(a.status) && <Link to={`/messages/${a.id}`} className={btnGhost}>{t('app:chat.open')}</Link>}
                {!['withdrawn', 'accepted', 'rejected'].includes(a.status) && <button type="button" onClick={() => void withdraw(a.id)} className={btnDanger}>{t('app:apps.withdraw')}</button>}
              </div>
              <ol className="mt-3 flex flex-wrap gap-x-2 gap-y-1 border-t border-slate-100 pt-3" aria-label={t('app:apps.history')}>
                {a.events.map((e, i) => <li key={i} className="flex items-center gap-1.5 text-[12px] text-muted"><span className="font-bold text-navy">{t(`options:appStatuses.${e.status}`)}</span>{fmtDate(e.at)}{i < a.events.length - 1 && <span aria-hidden>→</span>}</li>)}
              </ol>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
