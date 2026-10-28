import { ArrowLeft, Briefcase, Building2, Check, ChevronRight, Globe, Mail, MapPin, Phone, User, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { TextAreaField } from '../../components/Field';
import { Card, LoadState, PageHeader, StatusBadge, btnDanger, btnGhost, btnPrimary } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import { apiErrText } from '../../lib/errors';
import { cityLabel, fmtDate, optionLabel } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';
import type { VacancyDto } from './VacancyCard';

type ReviewStatus = 'pending' | 'approved' | 'rejected';
const TABS: ReviewStatus[] = ['pending', 'approved', 'rejected'];
const REASON_MAX = 500;

interface Company {
  id: string; email: string; phone: string | null; createdAt: string; companyName: string; bin: string; industry: string; industryOther: string | null;
  size: string; city: string; cityOther: string | null; contactName: string; contactSurname: string; position: string; website: string | null; description: string | null;
  reviewStatus: ReviewStatus; rejectionReason: string | null; reviewedAt: string | null; reviewedBy: string | null; vacancyCount: number; publishedCount: number;
}

/** Admin: companies by review status (pending / approved / rejected) with approve / reject (optional reason). */
export function Companies() {
  const { t } = useTranslation();
  usePageTitle('nav.companies');
  // the tab lives in the URL so "Back to companies" from a company's page returns to the same list
  const [sp, setSp] = useSearchParams();
  const tab: ReviewStatus = (TABS as string[]).includes(sp.get('tab') ?? '') ? (sp.get('tab') as ReviewStatus) : 'pending';
  const setTab = (s: ReviewStatus) => setSp(s === 'pending' ? {} : { tab: s }, { replace: true });
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

function CompanyCard({ c, onDone, detail = false }: { c: Company; onDone: () => void; detail?: boolean }) {
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
          {detail ? <h1 className="text-[24px] font-extrabold text-navy">{c.companyName}</h1>
            : <h2 className="text-lg font-extrabold text-navy"><Link to={`/admin/companies/${c.id}`} className="hover:text-brand hover:underline">{c.companyName}</Link></h2>}
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
        {row(<Briefcase size={14} />, t('app:company.vacancyCount', { count: c.vacancyCount, published: c.publishedCount }))}
      </ul>
      {c.description && <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-page px-3 py-2 text-[13.5px] text-ink">{c.description}</p>}
      {c.reviewStatus !== 'pending' && (
        <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted"><Users size={13} aria-hidden />
          {t(`app:approvals.reviewed.${c.reviewStatus}`, { date: c.reviewedAt ? fmtDate(c.reviewedAt) : '—', by: c.reviewedBy ?? '—' })}
        </p>
      )}
      {c.reviewStatus === 'rejected' && c.rejectionReason && <p className="mt-1 rounded-lg bg-danger/5 px-3 py-2 text-[13px] text-danger-text"><b>{t('app:approvals.reason')}:</b> {c.rejectionReason}</p>}
      {!detail && !rejecting && (
        <div className="mt-3 flex justify-end">
          <Link to={`/admin/companies/${c.id}`} className={btnGhost} aria-label={t('app:company.viewAria', { name: c.companyName })}>{t('app:company.view')}<ChevronRight size={15} aria-hidden /></Link>
        </div>
      )}
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

const VAC_FILTERS = ['', 'published', 'draft', 'closed', 'expired'] as const;
type VacFilter = (typeof VAC_FILTERS)[number];
const th = 'px-3 py-2 text-left text-[11.5px] font-extrabold uppercase tracking-wide text-muted';
const td = 'px-3 py-2 align-top';
/** Expired = still "published" in the database but the application deadline has passed (students no longer see it). */
const vacStatus = (v: VacancyDto) => (v.status === 'published' && v.expired ? 'expired' : v.status);

/** Admin: one company (details + review actions) and every vacancy it created, drafts included, filterable by status. */
export function CompanyDetail() {
  const { t } = useTranslation();
  usePageTitle('nav.companies');
  const { id } = useParams();
  const [status, setStatus] = useState<VacFilter>('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<{ company: Company; vacancies: VacancyDto[]; counts: Record<'all' | Exclude<VacFilter, ''>, number>; total: number; page: number; pageSize: number }>(
    `/api/admin/employers/${id}?${new URLSearchParams({ status, sort, page: String(page) })}`);
  const c = data?.company;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const pick = (s: VacFilter) => { setStatus(s); setPage(1); };
  const emptyText = !data ? '' : data.counts.all > 0 ? t('app:company.noneWithStatus')
    : c?.reviewStatus === 'approved' ? t('app:company.noVacancies') : t('app:company.noVacanciesUnapproved');
  return (
    <div className="mx-auto max-w-5xl">
      <Link to={c && c.reviewStatus !== 'pending' ? `/admin/companies?tab=${c.reviewStatus}` : '/admin/companies'} className="mb-3 inline-flex items-center gap-1 text-[13px] font-bold text-brand hover:underline"><ArrowLeft size={14} aria-hidden />{t('app:company.back')}</Link>
      <LoadState loading={loading && !data} error={error} />
      {c && <CompanyCard c={c} onDone={() => void reload()} detail />}
      {data && (
        <Card className="mt-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-[18px] font-extrabold text-navy">{t('app:company.vacancies')}</h2>
            <label className="text-[12px] font-bold text-navy">{t('app:company.sort')}
              <select value={sort} onChange={(e) => { setSort(e.target.value as 'newest' | 'oldest'); setPage(1); }} className="ml-2 h-9 rounded-lg border border-line bg-white px-2 text-[13px] font-normal">
                <option value="newest">{t('app:company.sortNewest')}</option><option value="oldest">{t('app:company.sortOldest')}</option>
              </select>
            </label>
          </div>
          <div role="tablist" aria-label={t('app:company.filter')} className="mb-3 flex flex-wrap gap-1 border-b border-line">
            {VAC_FILTERS.map((s) => (
              <button key={s || 'all'} type="button" role="tab" aria-selected={status === s} onClick={() => pick(s)}
                className={`-mb-px flex items-center gap-1.5 border-b-[3px] px-3 py-1.5 text-[13px] font-bold transition-colors ${status === s ? 'border-orange text-navy' : 'border-transparent text-muted hover:text-navy'}`}>
                {s ? t(`app:company.vacancyStatus.${s}`) : t('app:all')}
                <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-extrabold text-muted">{data.counts[s || 'all']}</span>
              </button>
            ))}
          </div>
          <LoadState loading={false} error={null} empty={data.vacancies.length === 0} emptyText={emptyText} />
          {data.vacancies.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[13.5px] text-ink">
                <thead className="border-b border-line"><tr>
                  <th className={th}>{t('app:form.title')}</th><th className={th}>{t('app:form.kind')}</th><th className={th}>{t('app:detail.status')}</th>
                  <th className={th}>{t('app:form.industry')}</th><th className={th}>{t('app:form.city')}</th><th className={th}>{t('app:form.format')}</th>
                  <th className={th}>{t('app:company.created')}</th><th className={th}>{t('app:company.deadline')}</th><th className={`${th} text-right`}>{t('app:company.applicants')}</th>
                </tr></thead>
                <tbody>
                  {data.vacancies.map((v) => (
                    <tr key={v.id} className="border-b border-line/60 last:border-0">
                      <td className={`${td} font-bold`}><Link to={`/admin/vacancies/${v.id}`} className="text-navy hover:text-brand hover:underline">{v.title}</Link></td>
                      <td className={td}>{t(`options:kinds.${v.kind}`)}</td>
                      <td className={td}><StatusBadge status={vacStatus(v)} label={t(`app:company.vacancyStatus.${vacStatus(v)}`)} /></td>
                      <td className={td}>{optionLabel(t, 'industries', v.industry, v.industryOther)}</td>
                      <td className={td}>{cityLabel(t, v.city, v.cityOther)}</td>
                      <td className={td}>{t(`options:formats.${v.workFormat}`)}</td>
                      <td className={`${td} whitespace-nowrap`}>{fmtDate(v.createdAt)}</td>
                      <td className={`${td} whitespace-nowrap`}>{v.deadline ? fmtDate(v.deadline) : '—'}</td>
                      <td className={`${td} text-right tabular-nums`}>{v.applicants ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-center gap-3" aria-label={t('app:page', { page, pages })}>
              <button type="button" className={btnGhost} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('app:prev')}</button>
              <span className="text-[13px] font-bold text-navy">{t('app:page', { page, pages })}</span>
              <button type="button" className={btnGhost} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('app:next')}</button>
            </nav>
          )}
        </Card>
      )}
    </div>
  );
}
