import { Download, Mail, Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ExplainPanel } from '../../components/ExplainPanel';
import { Card, LoadState, MatchBadge, PageHeader, SkillChips, StatusBadge, btnGhost, btnPrimary } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { apiErrText } from '../../lib/errors';
import { cityLabel, fmtDate } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';
import { EMPLOYER_SET_STATUSES } from '@sdu/shared';

export interface Applicant {
  id: string; vacancyId: string; vacancyTitle: string; status: string; matchPercent: number; coverNote: string | null; appliedAt: string;
  student: { name: string; surname: string; email: string; phone: string; major: string; year: string; gpa: string; city: string; cityOther: string | null; hasCv: boolean; experienceYears: number };
  matchedSkills: string[]; missingSkills: string[];
}

export function ApplicantList({ items, showVacancy, reload }: { items: Applicant[]; showVacancy?: boolean; reload: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const setStatus = async (id: string, status: string) => {
    try { await api('PATCH', `/api/applications/${id}/status`, { status }); toast(t('app:appl.statusChanged')); reload(); } catch (e) { toast(apiErrText(t, e), 'error'); }
  };
  return (
    <ol className="space-y-3">
      {items.map((a, i) => (
        <li key={a.id}>
          <Card>
            <div className="flex flex-wrap items-start gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy text-[12px] font-extrabold text-white" aria-label={`#${i + 1}`}>{i + 1}</span>
              <MatchBadge percent={a.matchPercent} />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-extrabold text-navy">{a.student.name} {a.student.surname}</h2>
                <p className="text-[13px] text-muted">{t(`options:majors.${a.student.major}`)} · {t(`options:years.${a.student.year}`)} · {t('app:appl.gpa', { gpa: a.student.gpa })} · {cityLabel(t, a.student.city, a.student.cityOther)} · {t('app:appl.exp', { n: a.student.experienceYears })}</p>
                {showVacancy && <p className="text-[13px] font-semibold text-navy"><Link className="hover:underline" to={`/vacancies/${a.vacancyId}/applicants`}>{t('app:appl.forVacancy')}: {a.vacancyTitle}</Link></p>}
                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]"><a className="flex items-center gap-1 text-brand hover:underline" href={`mailto:${a.student.email}`}><Mail size={13} aria-hidden />{a.student.email}</a><a className="flex items-center gap-1 text-brand hover:underline" href={`tel:${a.student.phone}`}><Phone size={13} aria-hidden />{a.student.phone}</a></p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusBadge status={a.status} label={t(`options:appStatuses.${a.status}`)} />
                <label className="sr-only" htmlFor={`st-${a.id}`}>{t('app:appl.setStatus')}</label>
                <select id={`st-${a.id}`} value="" onChange={(e) => e.target.value && void setStatus(a.id, e.target.value)} className="h-9 rounded-xl border-[1.5px] border-slate-300 bg-white px-2 text-[13px] font-semibold">
                  <option value="">{t('app:appl.setStatus')}</option>
                  {EMPLOYER_SET_STATUSES.filter((s) => s !== a.status).map((s) => <option key={s} value={s}>{t(`options:appStatuses.${s}`)}</option>)}
                </select>
                <Link className="flex items-center gap-1 text-[13px] font-bold text-brand hover:underline" to={`/messages/${a.id}`}>{t('app:chat.open')}</Link>
                {a.student.hasCv ? <a className="flex items-center gap-1 text-[13px] font-bold text-brand hover:underline" href={`/api/applications/${a.id}/cv`} download><Download size={13} aria-hidden />{t('app:appl.cv')}</a> : <span className="text-[12px] text-muted">{t('app:appl.noCv')}</span>}
              </div>
            </div>
            <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2">
              <div><p className="mb-1 text-[12px] font-extrabold text-ok-text">{t('app:appl.has')}</p><SkillChips matched={a.matchedSkills} /></div>
              <div><p className="mb-1 text-[12px] font-extrabold text-slate-600">{t('app:appl.lacks')}</p><SkillChips missing={a.missingSkills} /></div>
            </div>
            <div className="mt-3"><ExplainPanel url={`/api/ai/candidate-explain/${a.id}`} /></div>
            {a.coverNote && <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2 text-[14px] text-ink"><span className="mb-0.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">{t('app:appl.cover')} · {fmtDate(a.appliedAt)}</span>{a.coverNote}</blockquote>}
          </Card>
        </li>
      ))}
    </ol>
  );
}

interface Talent { studentId: string; name: string; surname: string; major: string; year: string; gpa: string; city: string; cityOther: string | null; matchPercent: number; matchedSkills: string[]; missingSkills: string[]; invited: boolean }
function TalentPool({ id, published }: { id: string; published: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, reload } = useApi<{ candidates: Talent[] }>(published ? `/api/vacancies/${id}/talent` : null);
  const invite = async (sid: string) => { try { await api('POST', `/api/vacancies/${id}/invite`, { studentId: sid }); toast(t('app:talent.sent')); await reload(); } catch (e) { toast(apiErrText(t, e), 'error'); } };
  return (
    <section className="mt-8" aria-label={t('app:talent.title')}>
      <h2 className="text-xl font-extrabold text-navy">{t('app:talent.title')}</h2>
      <p className="mb-3 text-[13px] text-muted">{t('app:talent.text')}</p>
      {!published ? <p className="rounded-xl border border-line bg-white p-4 text-muted">{t('app:talent.publishFirst')}</p>
        : !data ? <div className="skeleton h-24" /> : data.candidates.length === 0 ? <p className="rounded-xl border border-line bg-white p-4 text-muted">{t('app:talent.none')}</p> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.candidates.map((c, i) => (
            <li key={c.studentId} className="fade-up card-hover rounded-2xl border border-line bg-white p-4" style={{ ['--i' as string]: i }}>
              <div className="flex items-start gap-3"><MatchBadge percent={c.matchPercent} size={52} />
                <div className="min-w-0 flex-1"><h3 className="font-bold text-navy">{c.name} {c.surname}</h3><p className="text-[12.5px] text-muted">{t(`options:majors.${c.major}`)} · {t(`options:years.${c.year}`)} · {t('app:appl.gpa', { gpa: c.gpa })} · {cityLabel(t, c.city, c.cityOther)}</p></div>
                <button type="button" disabled={c.invited} onClick={() => void invite(c.studentId)} className={c.invited ? btnGhost : btnPrimary + ' !h-9 !px-3 !text-[13px]'}>{c.invited ? t('app:talent.invited') : t('app:talent.invite')}</button></div>
              <div className="mt-2.5"><SkillChips matched={c.matchedSkills} missing={c.missingSkills} /></div>
            </li>
          ))}
        </ul>)}
    </section>
  );
}

export function Applicants() {
  const { t } = useTranslation();
  const { id } = useParams();
  usePageTitle('nav.candidates');
  const { data, error, loading, reload } = useApi<{ vacancy: { title: string; status: string }; applicants: Applicant[] }>(`/api/vacancies/${id}/applicants`);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('app:appl.titleFor', { title: data?.vacancy.title ?? '' })} subtitle={t('app:appl.ranked')} />
      <LoadState loading={loading && !data} error={error} empty={!!data && data.applicants.length === 0} emptyText={t('app:appl.none')} />
      {data && data.applicants.length > 0 && <ApplicantList items={data.applicants} reload={() => void reload()} />}
      {data && id && <TalentPool id={id} published={data.vacancy.status === 'published'} />}
    </div>
  );
}

export function Candidates() {
  const { t } = useTranslation();
  usePageTitle('nav.candidates');
  const { data, error, loading, reload } = useApi<{ applicants: Applicant[] }>('/api/applications/employer');
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('app:cand.title')} subtitle={t('app:cand.subtitle')} />
      <LoadState loading={loading && !data} error={error} empty={!!data && data.applicants.length === 0} emptyText={t('app:appl.none')} />
      {data && data.applicants.length > 0 && <ApplicantList items={data.applicants} showVacancy reload={() => void reload()} />}
    </div>
  );
}
