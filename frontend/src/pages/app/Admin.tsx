import { Building2, Check, Globe, Mail, MapPin, Phone, User, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextAreaField } from '../../components/Field';
import { Card, LoadState, PageHeader, btnDanger, btnGhost, btnPrimary } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import { apiErrText } from '../../lib/errors';
import { cityLabel, fmtDate, optionLabel } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';

type ReviewStatus = 'pending' | 'approved' | 'rejected';
const TABS: ReviewStatus[] = ['pending', 'approved', 'rejected'];
const REASON_MAX = 500;

interface Company {
  id: string; email: string; phone: string | null; createdAt: string; companyName: string; bin: string; industry: string; industryOther: string | null;
  size: string; city: string; cityOther: string | null; contactName: string; contactSurname: string; position: string; website: string | null; description: string | null;
  reviewStatus: ReviewStatus; rejectionReason: string | null; reviewedAt: string | null; reviewedBy: string | null;
}

/** Admin: companies by review status (pending / approved / rejected) with approve / reject (optional reason). */
export function Companies() {
  const { t } = useTranslation();
  usePageTitle('nav.companies');
  const [tab, setTab] = useState<ReviewStatus>('pending');
  const { data, error, loading, reload } = useApi<{ employers: Company[]; counts: Record<ReviewStatus, number> }>(`/api/admin/employers?status=${tab}`);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('app:approvals.title')} subtitle={t('app:approvals.subtitle')} />
      <div role="tablist" aria-label={t('app:approvals.filter')} className="mb-4 flex gap-1 border-b border-line">
        {TABS.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={tab === s} onClick={() => setTab(s)}
            className={`-mb-px flex items-center gap-1.5 border-b-[3px] px-3.5 py-2 text-[14px] font-bold transition-colors ${tab === s ? 'border-orange text-navy' : 'border-transparent text-muted hover:text-navy'}`}>
            {t(`app:approvals.tabs.${s}`)}
            {data?.counts && <span className={`rounded-full px-1.5 text-[11px] font-extrabold ${s === 'pending' && data.counts.pending > 0 ? 'bg-orange-dark text-white' : 'bg-slate-100 text-muted'}`}>{data.counts[s]}</span>}
          </button>
        ))}
      </div>
      <LoadState loading={loading && !data} error={error} empty={!!data && data.employers.length === 0} emptyText={t(`app:approvals.empty.${tab}`)} />
      <ul className="space-y-3">
        {data?.employers.map((e) => <li key={e.id}><CompanyCard c={e} onDone={() => void reload()} /></li>)}
      </ul>
    </div>
  );
}

function CompanyCard({ c, onDone }: { c: Company; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const decide = async (kind: 'approve' | 'reject') => {
    if (busy) return;
    if (kind === 'reject' && Array.from(reason.trim()).length > REASON_MAX) { setReasonErr('REJECTION_REASON_TOO_LONG'); return; }
    setBusy(true);
    try {
      await api('POST', `/api/admin/employers/${c.id}/${kind}`, kind === 'reject' ? { reason: reason.trim() || null } : undefined);
      toast(t(kind === 'approve' ? 'app:approvals.approved' : 'app:approvals.rejected'));
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.fields.reason) setReasonErr(e.fields.reason); else toast(apiErrText(t, e), 'error');
    } finally { setBusy(false); }
  };
  const row = (icon: React.ReactNode, text: React.ReactNode) => <li className="flex min-w-0 items-center gap-2"><span aria-hidden className="shrink-0 text-muted">{icon}</span><span className="min-w-0 break-words">{text}</span></li>;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold text-navy">{c.companyName}</h2>
          <p className="text-[13px] text-muted">{t('app:approvals.bin', { bin: c.bin })} · {t('app:approvals.registered', { date: fmtDate(c.createdAt) })}</p>
        </div>
        {!rejecting && (
          <div className="flex flex-wrap gap-2">
            {c.reviewStatus !== 'approved' && <button type="button" disabled={busy} className={btnPrimary} onClick={() => void decide('approve')}><Check size={16} aria-hidden />{t('app:approvals.approve')}</button>}
            {c.reviewStatus === 'pending' && <button type="button" disabled={busy} className={btnDanger} onClick={() => setRejecting(true)}><X size={15} aria-hidden />{t('app:approvals.reject')}</button>}
          </div>
        )}
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-[13.5px] text-ink sm:grid-cols-2">
        {row(<Building2 size={14} />, `${optionLabel(t, 'industries', c.industry, c.industryOther)} · ${t(`options:sizes.${c.size}`)}`)}
        {row(<MapPin size={14} />, cityLabel(t, c.city, c.cityOther))}
        {row(<User size={14} />, `${c.contactName} ${c.contactSurname} · ${c.position}`)}
        {row(<Mail size={14} />, <a href={`mailto:${c.email}`} className="text-brand hover:underline">{c.email}</a>)}
        {c.phone && row(<Phone size={14} />, c.phone)}
        {c.website && row(<Globe size={14} />, <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className="text-brand hover:underline">{c.website}</a>)}
      </ul>
      {c.description && <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-page px-3 py-2 text-[13.5px] text-ink">{c.description}</p>}
      {c.reviewStatus !== 'pending' && (
        <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted"><Users size={13} aria-hidden />
          {t(`app:approvals.reviewed.${c.reviewStatus}`, { date: c.reviewedAt ? fmtDate(c.reviewedAt) : '—', by: c.reviewedBy ?? '—' })}
        </p>
      )}
      {c.reviewStatus === 'rejected' && c.rejectionReason && <p className="mt-1 rounded-lg bg-danger/5 px-3 py-2 text-[13px] text-danger-text"><b>{t('app:approvals.reason')}:</b> {c.rejectionReason}</p>}
      {rejecting && (
        <div className="mt-3 border-t border-line pt-3">
          <TextAreaField name="reason" label={t('app:approvals.reasonLabel')} value={reason} onChange={(x) => { setReason(x); setReasonErr(undefined); }} max={REASON_MAX} rows={3} placeholder={t('app:approvals.reasonPh')} error={reasonErr} />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} className={btnDanger} onClick={() => void decide('reject')}>{t('app:approvals.confirmReject')}</button>
            <button type="button" disabled={busy} className={btnGhost} onClick={() => { setRejecting(false); setReason(''); setReasonErr(undefined); }}>{t('cancel')}</button>
          </div>
        </div>
      )}
    </Card>
  );
}
