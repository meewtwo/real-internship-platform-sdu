import { ArrowLeft, Building2, Globe, Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import type { MatchResult } from '@sdu/shared';
import { ExplainPanel } from '../../components/ExplainPanel';
import { Card, LoadState, MatchBadge, SkillChips, StatusBadge, btnPrimary } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { TextAreaField } from '../../components/Field';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { apiErrText } from '../../lib/errors';
import { cityLabel, fmtDate } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';
import { FavoriteStar, type VacancyDto } from './VacancyCard';
import { useSalary } from '../../lib/useSalary';

interface WhatIf { current: number; all: number; options: { skill: string; percent: number; delta: number }[] }
interface Detail { favorite: boolean; vacancy: VacancyDto; match: MatchResult | null; application: { id: string; status: string; matchPercent: number; createdAt: string } | null }

const Bar = ({ label, v }: { label: string; v: number }) => (
  <div>
    <div className="mb-0.5 flex justify-between text-[12px] font-bold text-navy"><span>{label}</span><span>{Math.round(v * 100)}%</span></div>
    <div className="h-2 rounded-full bg-slate-200" role="presentation"><div className="h-2 rounded-full bg-brand" style={{ width: `${Math.round(v * 100)}%` }} /></div>
  </div>
);

function WhatIfPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data } = useApi<WhatIf>(`/api/vacancies/${id}/whatif`);
  if (!data) return null;
  return (
    <Card className="fade-up">
      <h2 className="text-[17px] font-bold text-navy">{t('app:whatif.title')}</h2>
      <p className="mb-3 text-[13px] text-muted">{t('app:whatif.text')}</p>
      {data.options.length === 0 ? <p className="text-[13px] font-semibold text-ok-text">{t('app:whatif.none')}</p> : (
        <ul className="space-y-2">
          {data.options.map((o, i) => (
            <li key={o.skill} className="pop-in flex items-center justify-between gap-2 rounded-lg bg-brand-50 px-3 py-2" style={{ ['--i' as string]: i }}>
              <span className="text-[14px] font-semibold text-navy">+ {o.skill}</span>
              <span className="text-[14px] font-extrabold tabular-nums text-ok-text">{o.percent}% <span className="text-[12px]">(+{o.delta})</span></span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-2 rounded-lg bg-navy px-3 py-2 text-white"><span className="text-[13px] font-semibold">{t('app:whatif.all')}</span><span className="font-extrabold tabular-nums">{data.all}%</span></li>
        </ul>
      )}
    </Card>
  );
}

export function VacancyDetail() {
  const { t } = useTranslation();
  const salary = useSalary();
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  usePageTitle('nav.vacancies');
  const { data, error, loading, reload } = useApi<Detail>(`/api/vacancies/${id}`);
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const apply = async () => {
    setBusy(true); setErr(''); setNoteErr(undefined);
    try {
      await api('POST', `/api/vacancies/${id}/apply`, note.trim() ? { coverNote: note } : undefined);
      toast(t('app:detail.sent')); await reload();
    } catch (e) {
      if (e instanceof ApiError && e.fields.coverNote) setNoteErr(e.fields.coverNote); else setErr(apiErrText(t, e));
    } finally { setBusy(false); }
  };
  const v = data?.vacancy, m = data?.match;
  const isStudent = user?.role === 'student';
  return (
    <div className="mx-auto max-w-4xl">
      <Link to={isStudent ? '/vacancies' : '/vacancies/mine'} className="mb-3 inline-flex items-center gap-1 text-[13px] font-bold text-brand hover:underline"><ArrowLeft size={14} aria-hidden />{t('app:back')}</Link>
      <LoadState loading={loading && !data} error={error} />
      {v && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card>
            <div className="flex items-start justify-between gap-3"><h1 className="text-[26px] font-extrabold leading-tight text-navy">{v.title}</h1>{isStudent && <FavoriteStar id={v.id} initial={data.favorite} />}</div>
            {(() => { const sl = salary(v.salaryMin, v.salaryMax); return <p className={`mt-1 ${sl.has ? 'text-[22px] font-extrabold text-navy' : 'text-[14px] text-muted'}`}>{sl.text}{sl.has && <span className="ml-2 text-[13px] font-medium text-muted">{t('app:salary.perMonth')}</span>}</p>; })()}
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-muted">
              <span className="flex items-center gap-1"><Building2 size={14} aria-hidden />{v.company.name}</span>
              {v.company.website && <a className="flex items-center gap-1 text-brand hover:underline" href={v.company.website} target="_blank" rel="noopener noreferrer nofollow"><Globe size={14} aria-hidden />{v.company.website.replace(/^https?:\/\//, '')}</a>}
            </p>
            <p className="mt-2 flex flex-wrap gap-1.5 text-[12px] font-bold">
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-dark">{t(`options:kinds.${v.kind}`)}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5">{t(`options:formats.${v.workFormat}`)} · {v.workFormat === 'remote' ? t('app:remoteOnly') : cityLabel(t, v.city, v.cityOther)}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5">{t(`options:industries.${v.industry}`)}</span>
              {v.minGpa && <span className="rounded-full bg-slate-100 px-2 py-0.5">{t('app:minGpa', { gpa: v.minGpa })}</span>}
              <span className="rounded-full bg-slate-100 px-2 py-0.5">{v.deadline ? t('app:deadline', { date: fmtDate(v.deadline) }) : t('app:noDeadline')}</span>
            </p>
            <h2 className="mb-1 mt-5 text-[13px] font-extrabold uppercase tracking-wide text-muted">{t('app:detail.description')}</h2>
            <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-ink">{v.description}</p>
            <h2 className="mb-1.5 mt-5 text-[13px] font-extrabold uppercase tracking-wide text-muted">{t('app:detail.required')}</h2>
            <SkillChips matched={m?.matchedSkills} missing={m?.missingSkills} neutral={m ? [] : v.requiredSkills} />
          </Card>
          <div className="space-y-4">
            {m && (
              <Card>
                <div className="mb-3 flex items-center gap-3"><MatchBadge percent={m.percent} size={72} /><h2 className="text-lg font-extrabold leading-tight text-navy">{t('app:detail.why')}</h2></div>
                <div className="space-y-2.5">
                  <Bar label={t('app:detail.skill')} v={m.skill} /><Bar label={t('app:detail.text')} v={m.text} /><Bar label={t('app:detail.fit')} v={m.fit} /><Bar label={t('app:detail.location')} v={m.location} />
                </div>
                {m.textSource === 'semantic' && <p className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-[12px] font-semibold text-brand-dark">{t('app:detail.semantic')}</p>}
                {m.gpaBelowMin && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900 ring-1 ring-amber-300">{t('app:detail.gpaBelow')}</p>}
              </Card>
            )}
            {isStudent && m && v.status === 'published' && <WhatIfPanel id={v.id} />}
            {isStudent && m && v.status === 'published' && <Card><ExplainPanel url={`/api/ai/match-explain/${v.id}`} /></Card>}
            {isStudent ? (
              <Card>
                {data.application && data.application.status !== 'withdrawn' ? (
                  <div className="space-y-2" role="status">
                    <StatusBadge status={data.application.status} label={t(`options:appStatuses.${data.application.status}`)} />
                    <p className="text-[14px] font-semibold text-navy">{t('app:detail.youApplied', { date: fmtDate(data.application.createdAt) })}</p>
                    <Link to="/applications" className="text-[13px] font-bold text-brand hover:underline">{t('nav.applications')}</Link>
                  </div>
                ) : v.status !== 'published' ? <p className="font-semibold text-muted">{t('app:detail.closed')}</p> : (
                  <form onSubmit={(e) => { e.preventDefault(); void apply(); }} noValidate>
                    <TextAreaField name="coverNote" label={t('app:detail.cover')} value={note} onChange={setNote} max={1000} rows={4} placeholder={t('app:detail.coverPh')} error={noteErr} />
                    {err && <p role="alert" className="mb-2 mt-1 rounded-xl bg-danger/10 px-3 py-1.5 text-[12px] font-semibold text-danger-text">{err}</p>}
                    <button type="submit" disabled={busy || Array.from(note).length > 1000} className={`${btnPrimary} mt-2 w-full`}>{busy ? <><Loader2 className="animate-spin" size={16} aria-hidden />{t('app:detail.applying')}</> : <><Send size={16} aria-hidden />{t('app:detail.apply')}</>}</button>
                  </form>
                )}
              </Card>
            ) : <p className="rounded-2xl bg-brand-50 p-3 text-[12px] font-semibold text-navy">{t('app:detail.employerView')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
