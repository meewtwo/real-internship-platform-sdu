import { ArrowRight, Check, CircleDashed, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { MatchResult } from '@sdu/shared';
import { CompanyStatusBanner } from '../components/CompanyStatusBanner';
import { MatchBadge, StatusBadge, btnPrimary } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { useCountUp } from '../lib/useMotion';
import { usePageTitle } from '../lib/usePageTitle';
import { useApi } from '../lib/useApi';
import { useSalary } from '../lib/useSalary';
import { useToast } from '../components/Toast';
import { apiErrText } from '../lib/errors';
import type { Applicant } from './app/Applicants';
import type { VacancyDto } from './app/VacancyCard';

/** Big number with a count-up, label under it (hh-style stat strip). */
function Tile({ n, label, hint, i = 0 }: { n: number | string; label: string; hint?: string; i?: number }) {
  const v = useCountUp(typeof n === 'number' ? n : 0, 800);
  return (
    <div className="fade-up rounded-xl border border-line bg-white px-4 py-3.5" style={{ ['--i' as string]: i }}>
      <p className="text-[28px] font-extrabold leading-none tabular-nums text-navy">{typeof n === 'number' ? v : n}{hint && <span className="ml-1.5 text-[12px] font-semibold text-muted">{hint}</span>}</p>
      <p className="mt-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
    </div>
  );
}
const Panel = ({ title, action, children, className = '' }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={`rounded-xl border border-line bg-white ${className}`}>
    <header className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="text-[15px] font-bold text-navy">{title}</h2>{action}</header>
    <div className="p-4">{children}</div>
  </section>
);
const More = ({ to, label }: { to: string; label: string }) => <Link to={to} className="flex items-center gap-1 text-[13px] font-bold text-brand hover:underline">{label}<ArrowRight size={13} aria-hidden /></Link>;

function Header({ name, sub, role, right }: { name: string; sub: string; role: string; right?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div><p className="fade-up text-[12px] font-bold uppercase tracking-[0.16em] text-orange-dark">{role}</p>
        <h1 className="fade-up font-display mt-1 text-[34px] font-bold leading-tight text-navy sm:text-[42px]" style={{ ['--i' as string]: 1 }}>{t('app:dash.hello', { name })}</h1>
        <p className="fade-up mt-1 text-[14.5px] text-muted" style={{ ['--i' as string]: 2 }}>{sub}</p></div>
      {right}
    </div>
  );
}

function StudentDashboard({ name }: { name: string }) {
  const { t } = useTranslation();
  const salaryOf = useSalary();
  const prof = useApi<{ profile: { skills: string[] } }>('/api/profile');
  const docs = useApi<{ docs: unknown[] }>('/api/resume-docs');
  const cv = useApi<{ cv: unknown }>('/api/cv');
  const apps = useApi<{ applications: { id: string; status: string; matchPercent: number; createdAt: string; vacancy: { id: string; title: string; company: string } }[] }>('/api/applications');
  const favs = useApi<{ items: unknown[] }>('/api/favorites');
  const rec = useApi<{ recommendations: (VacancyDto & { match: MatchResult })[] }>('/api/recommendations');
  const notes = useApi<{ unread: number; items: { id: string; kind: string; params: Record<string, unknown>; link: string | null; read: boolean; createdAt: string }[] }>('/api/notifications');
  const steps = [
    { done: (prof.data?.profile.skills.length ?? 0) >= 3, label: t('app:dash.stepSkills'), to: '/profile' },
    { done: (docs.data?.docs.length ?? 0) > 0, label: t('app:dash.stepResume'), to: '/resume/builder' },
    { done: !!cv.data?.cv, label: t('app:dash.stepCv'), to: '/cv' },
    { done: (apps.data?.applications.length ?? 0) > 0, label: t('app:dash.stepApply'), to: '/vacancies' },
  ];
  const pct = Math.round(25 + (steps.filter((s) => s.done).length / steps.length) * 75);
  const list = apps.data?.applications ?? [];
  const best = Math.max(0, ...(rec.data?.recommendations.map((r) => r.match.percent) ?? [0]));
  const note = (n: { kind: string; params: Record<string, unknown> }) => { const p = { ...n.params } as Record<string, unknown>; if (typeof p.status === 'string') p.status = t(`options:appStatuses.${p.status}`); return t(`app:notif.${n.kind}`, p); };
  return (
    <>
      <Header name={name} role={t('dashboard.roleStudent')} sub={t('app:dash.studentSub')} right={<div className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-2.5"><MatchBadge percent={pct} size={52} /><div><p className="text-[13px] font-bold text-navy">{t('app:dash.profileReady')}</p><p className="text-[12px] text-muted">{steps.filter((s) => s.done).length}/{steps.length}</p></div></div>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile i={0} n={list.length} label={t('app:dash.tileApps')} hint={`${list.filter((a) => !['rejected', 'withdrawn', 'accepted'].includes(a.status)).length} ${t('app:dash.tileActive')}`} />
        <Tile i={1} n={favs.data?.items.length ?? 0} label={t('app:dash.tileFav')} />
        <Tile i={2} n={best ? `${best}%` : '—'} label={t('app:dash.tileBest')} />
        <Tile i={3} n={notes.data?.unread ?? 0} label={t('app:dash.tileNew')} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Panel title={t('app:dash.topMatches')} action={<More to="/recommendations" label={t('app:dash.seeAll')} />}>
            {!rec.data ? <div className="skeleton h-32" /> : rec.data.recommendations.length === 0 ? <p className="text-[14px] text-muted">{t('app:dash.noMatches')}</p> : (
              <ul className="divide-y divide-line">
                {rec.data.recommendations.slice(0, 3).map((v) => { const s = salaryOf(v.salaryMin, v.salaryMax); return (
                  <li key={v.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <MatchBadge percent={v.match.percent} size={46} />
                    <div className="min-w-0 flex-1"><Link to={`/vacancies/${v.id}`} className="block truncate text-[16px] font-bold text-brand hover:underline">{v.title}</Link>
                      <p className="truncate text-[13px] text-muted"><span className="font-semibold text-ink">{v.company.name}</span> · <span className={s.has ? 'font-bold text-navy' : ''}>{s.text}</span></p></div>
                    <Link to={`/vacancies/${v.id}`} className="hidden rounded-lg border border-line px-3 py-1.5 text-[13px] font-bold text-navy hover:bg-brand-50 sm:block">{t('app:search.open')}</Link>
                  </li>); })}
              </ul>)}
          </Panel>
          <Panel title={t('app:dash.recentApps')} action={<More to="/applications" label={t('app:dash.seeAll')} />}>
            {!apps.data ? <div className="skeleton h-20" /> : list.length === 0 ? <p className="text-[14px] text-muted">{t('app:dash.noApps')}</p> : (
              <ul className="divide-y divide-line">{list.slice(0, 3).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"><div className="min-w-0"><Link to={`/vacancies/${a.vacancy.id}`} className="block truncate font-semibold text-ink hover:text-brand">{a.vacancy.title}</Link><p className="text-[12.5px] text-muted">{a.vacancy.company} · {fmtDate(a.createdAt)}</p></div><StatusBadge status={a.status} label={t(`options:appStatuses.${a.status}`)} /></li>))}</ul>)}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title={t('app:dash.steps')}>
            <ul className="space-y-1">{steps.map((s) => (
              <li key={s.to + s.label}><Link to={s.to} className={`group flex items-center gap-2.5 rounded-lg px-2 py-2 text-[14px] ${s.done ? 'text-muted' : 'font-semibold text-navy hover:bg-brand-50'}`}>
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${s.done ? 'bg-ok text-white' : 'border-2 border-line text-transparent group-hover:border-orange'}`}>{s.done ? <Check size={12} strokeWidth={3} aria-hidden /> : <CircleDashed size={10} aria-hidden />}</span>
                <span className={s.done ? 'line-through decoration-line' : ''}>{s.label}</span>{!s.done && <ArrowRight size={14} aria-hidden className="ml-auto text-orange opacity-0 transition group-hover:opacity-100" />}</Link></li>))}</ul>
          </Panel>
          <Panel title={t('app:dash.activity')} action={<More to="/notifications" label={t('app:dash.seeAll')} />}>
            {!notes.data ? <div className="skeleton h-20" /> : notes.data.items.length === 0 ? <p className="text-[14px] text-muted">{t('app:dash.noActivity')}</p> : (
              <ul className="space-y-3">{notes.data.items.slice(0, 4).map((n) => (
                <li key={n.id} className="flex gap-2.5 text-[13.5px]"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-line' : 'bg-orange'}`} aria-hidden /><div className="min-w-0"><p className={`break-words ${n.read ? 'text-ink' : 'font-semibold text-navy'}`}>{note(n)}</p><p className="text-[12px] text-muted">{fmtDate(n.createdAt)}</p></div></li>))}</ul>)}
          </Panel>
        </div>
      </div>
    </>
  );
}

function EmployerDashboard({ name }: { name: string }) {
  const { t } = useTranslation();
  const mine = useApi<{ vacancies: VacancyDto[] }>('/api/vacancies/mine');
  const ap = useApi<{ applicants: Applicant[] }>('/api/applications/employer');
  const vs = mine.data?.vacancies ?? [], as = ap.data?.applicants ?? [];
  return (
    <>
      <Header name={name} role={t('dashboard.roleEmployer')} sub={t('app:dash.employerSub')} right={<Link to="/vacancies/new" className={btnPrimary}><Plus size={16} aria-hidden />{t('app:mine.new')}</Link>} />
      <CompanyStatusBanner pendingKey="dashboard.pending" className="mb-5" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile i={0} n={vs.filter((v) => v.status === 'published').length} label={t('app:dash.eTilePub')} /><Tile i={1} n={as.length} label={t('app:dash.eTileApps')} />
        <Tile i={2} n={as.filter((a) => a.status === 'applied').length} label={t('app:dash.eTileNew')} /><Tile i={3} n={vs.filter((v) => v.status === 'draft').length} label={t('app:dash.eTileDraft')} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={t('app:dash.latestApplicants')} action={<More to="/candidates" label={t('app:dash.seeAll')} />}>
          {!ap.data ? <div className="skeleton h-32" /> : as.length === 0 ? <p className="text-[14px] text-muted">{t('app:dash.noApplicants')}</p> : (
            <ul className="divide-y divide-line">{as.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"><MatchBadge percent={a.matchPercent} size={44} /><div className="min-w-0 flex-1"><Link to={`/vacancies/${a.vacancyId}/applicants`} className="block truncate font-bold text-navy hover:text-brand">{a.student.name} {a.student.surname}</Link><p className="truncate text-[12.5px] text-muted">{a.vacancyTitle}</p></div><StatusBadge status={a.status} label={t(`options:appStatuses.${a.status}`)} /></li>))}</ul>)}
        </Panel>
        <Panel title={t('app:dash.myVacancies')} action={<More to="/vacancies/mine" label={t('app:dash.seeAll')} />}>
          {!mine.data ? <div className="skeleton h-32" /> : vs.length === 0 ? <Link to="/vacancies/new" className="text-[14px] font-bold text-brand hover:underline">{t('app:dash.createFirst')} →</Link> : (
            <ul className="divide-y divide-line">{vs.slice(0, 5).map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"><div className="min-w-0"><Link to={`/vacancies/${v.id}`} className="block truncate font-semibold text-ink hover:text-brand">{v.title}</Link><p className="text-[12.5px] text-muted">{t('app:mine.applicants', { n: v.applicants ?? 0 })}</p></div><StatusBadge status={v.status} label={t(`app:mine.status.${v.status}`)} /></li>))}</ul>)}
        </Panel>
      </div>
    </>
  );
}

function AdminDashboard({ name }: { name: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const an = useApi<{ users: { students: number; employersActive: number; employersPending: number }; vacancies: { published: number }; applications: { total: number } }>('/api/admin/analytics');
  const pend = useApi<{ employers: { id: string; companyName: string; email: string; bin: string }[] }>('/api/admin/employers?status=pending');
  const decide = async (id: string, kind: 'approve' | 'reject') => { try { await api('POST', `/api/admin/employers/${id}/${kind}`); toast(t(kind === 'approve' ? 'app:approvals.approved' : 'app:approvals.rejected')); await pend.reload(); await an.reload(); } catch (e) { toast(apiErrText(t, e), 'error'); } };
  return (
    <>
      <Header name={name} role={t('dashboard.roleAdmin')} sub={t('app:dash.adminSub')} right={<Link to="/analytics" className={btnPrimary}>{t('nav.analytics')}<ArrowRight size={16} aria-hidden /></Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile i={0} n={an.data?.users.students ?? 0} label={t('app:an.students')} /><Tile i={1} n={an.data?.users.employersActive ?? 0} label={t('app:an.employers')} />
        <Tile i={2} n={an.data?.vacancies.published ?? 0} label={t('app:an.published')} /><Tile i={3} n={an.data?.applications.total ?? 0} label={t('app:an.applications')} />
      </div>
      <Panel title={t('app:dash.pendingEmployers')} action={<More to="/admin/companies" label={t('app:dash.seeAll')} />}>
        {!pend.data ? <div className="skeleton h-20" /> : pend.data.employers.length === 0 ? <p className="text-[14px] text-muted">{t('app:dash.nothingPending')}</p> : (
          <ul className="divide-y divide-line">{pend.data.employers.slice(0, 5).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"><div className="min-w-0"><p className="truncate font-bold text-navy">{e.companyName}</p><p className="text-[12.5px] text-muted">{t('app:approvals.bin', { bin: e.bin })} · {e.email}</p></div>
              <div className="flex gap-2"><button type="button" className={btnPrimary + ' !h-9 !px-3 !text-[13px]'} onClick={() => void decide(e.id, 'approve')}>{t('app:approvals.approve')}</button><button type="button" className="btn-press h-9 rounded-lg border border-line px-3 text-[13px] font-bold text-danger-text hover:bg-danger/5" onClick={() => void decide(e.id, 'reject')}>{t('app:approvals.reject')}</button></div></li>))}</ul>)}
      </Panel>
    </>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  usePageTitle('titles.dashboard');
  const prof = useApi<{ profile: { name?: string; contactName?: string } | null }>('/api/profile');
  if (!user) return null;
  const name = prof.data?.profile?.name ?? prof.data?.profile?.contactName ?? user.email.split('@')[0];
  return user.role === 'student' ? <StudentDashboard name={name} /> : user.role === 'employer' ? <EmployerDashboard name={name} /> : <AdminDashboard name={name} />;
}
