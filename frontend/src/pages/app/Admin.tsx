import { useTranslation } from 'react-i18next';
import { Card, LoadState, PageHeader, btnDanger, btnPrimary } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { apiErrText } from '../../lib/errors';
import { fmtDate } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';

interface Emp { id: string; email: string; companyName: string; bin: string; contactName: string; contactSurname: string; createdAt: string }

export function Approvals() {
  const { t } = useTranslation();
  usePageTitle('nav.approvals');
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ employers: Emp[] }>('/api/admin/employers?status=pending');
  const act = async (id: string, kind: 'approve' | 'reject') => {
    try { await api('POST', `/api/admin/employers/${id}/${kind}`); toast(t(kind === 'approve' ? 'app:approvals.approved' : 'app:approvals.rejected')); await reload(); } catch (e) { toast(apiErrText(t, e), 'error'); }
  };
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('app:approvals.title')} />
      <LoadState loading={loading && !data} error={error} empty={!!data && data.employers.length === 0} emptyText={t('app:approvals.empty')} />
      <ul className="space-y-3">
        {data?.employers.map((e) => (
          <li key={e.id}><Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><h2 className="text-lg font-extrabold text-navy">{e.companyName}</h2>
                <p className="text-[13px] text-muted">{t('app:approvals.bin', { bin: e.bin })} · {e.contactName} {e.contactSurname} · {e.email} · {fmtDate(e.createdAt)}</p></div>
              <div className="flex gap-2"><button type="button" className={btnPrimary} onClick={() => void act(e.id, 'approve')}>{t('app:approvals.approve')}</button><button type="button" className={btnDanger} onClick={() => void act(e.id, 'reject')}>{t('app:approvals.reject')}</button></div>
            </div>
          </Card></li>
        ))}
      </ul>
    </div>
  );
}
