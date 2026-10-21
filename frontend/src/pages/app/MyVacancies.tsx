import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CompanyStatusBanner } from '../../components/CompanyStatusBanner';
import { Card, LoadState, PageHeader, StatusBadge, btnDanger, btnGhost, btnPrimary } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { apiErrText } from '../../lib/errors';
import { fmtDate } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';
import type { VacancyDto } from './VacancyCard';

export function MyVacancies() {
  const { t } = useTranslation();
  const toast = useToast();
  usePageTitle('nav.myVacancies');
  const { data, error, loading, reload } = useApi<{ vacancies: VacancyDto[] }>('/api/vacancies/mine');
  const act = async (id: string, kind: 'publish' | 'close' | 'delete') => {
    if (kind !== 'publish' && !window.confirm(t('app:confirm'))) return;
    try {
      if (kind === 'delete') { await api('DELETE', `/api/vacancies/${id}`); toast(t('app:mine.deleted')); }
      else if (kind === 'close') { await api('POST', `/api/vacancies/${id}/close`); toast(t('app:mine.closed')); }
      else { const r = await api<{ matches: number; queued?: boolean }>('POST', `/api/vacancies/${id}/publish`); toast(r.queued ? t('app:mine.publishedQueued') : t('app:mine.published', { n: r.matches })); }
      await reload();
    } catch (e) { toast(apiErrText(t, e), 'error'); }
  };
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('app:mine.title')} actions={<Link to="/vacancies/new" className={btnPrimary}><Plus size={16} aria-hidden />{t('app:mine.new')}</Link>} />
      <CompanyStatusBanner pendingKey="app:mine.pendingWarn" className="mb-3" />
      <LoadState loading={loading && !data} error={error} empty={!!data && data.vacancies.length === 0} emptyText={t('app:mine.empty')} />
      <ul className="space-y-3">
        {data?.vacancies.map((v) => (
          <li key={v.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-extrabold text-navy"><Link to={`/vacancies/${v.id}`} className="hover:text-brand hover:underline">{v.title}</Link></h2>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                    <StatusBadge status={v.status} label={t(`app:mine.status.${v.status}`)} /><span>{t(`options:kinds.${v.kind}`)}</span>
                    <span>{t('app:mine.applicants', { n: v.applicants ?? 0 })}</span>{v.deadline && <span>{t('app:deadline', { date: fmtDate(v.deadline) })}</span>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {v.status !== 'closed' && <Link to={`/vacancies/${v.id}/edit`} className={btnGhost}>{t('app:mine.edit')}</Link>}
                  <Link to={`/vacancies/${v.id}/applicants`} className={btnGhost}>{t('app:mine.view')}</Link>
                  {v.status !== 'published' && <button type="button" onClick={() => void act(v.id, 'publish')} className={btnPrimary + ' !h-9 !px-4 !text-[13px]'}>{t('app:mine.publish')}</button>}
                  {v.status === 'published' && <button type="button" onClick={() => void act(v.id, 'close')} className={btnGhost}>{t('app:mine.close')}</button>}
                  {(v.applicants ?? 0) === 0 && <button type="button" onClick={() => void act(v.id, 'delete')} className={btnDanger}>{t('app:mine.delete')}</button>}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
