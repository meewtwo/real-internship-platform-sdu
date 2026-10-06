import { Loader2, Mail, MapPin, Phone, Printer, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Course } from '@sdu/shared';
import { Emblem } from '../../components/Brand';
import { TextAreaField } from '../../components/Field';
import { SubTabs, useResumeTabs } from '../../components/SubTabs';
import { useToast } from '../../components/Toast';
import { Card, LoadState, PageHeader, SkillChips, btnDanger, btnGhost, btnPrimary } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { apiErrText } from '../../lib/errors';
import { cityLabel } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';

interface ResumeData {
  resume: { source: string; about: string; courses: Course[]; inferredSkills: string[]; gpa: number | null; credits: number; updatedAt: string } | null;
  profile: { name: string; surname: string; major: string; year: string; gpa: string; interestArea: string; city: string; cityOther: string | null; email: string; phone: string };
  skills: string[]; experience: { years: number; items: { line: string }[] } | null;
}

export function ResumePage() {
  const { t } = useTranslation();
  usePageTitle('nav.resume');
  const tabs = useResumeTabs();
  const toast = useToast();
  const { data, error, loading, setData } = useApi<ResumeData>('/api/resume');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [about, setAbout] = useState('');
  const [aboutErr, setAboutErr] = useState<string | undefined>();
  const [showAll, setShowAll] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const run = async (kind: string, fn: () => Promise<ResumeData>) => {
    setBusy(kind); setErr('');
    try { setData(await fn()); setText(''); } catch (e) { setErr(apiErrText(t, e)); } finally { setBusy(''); }
  };
  const uploadFile = async (f: File | undefined) => {
    if (!f) return;
    await run('file', async () => {
      const fd = new FormData(); fd.append('file', f);
      const tok = ((await (await fetch('/api/auth/csrf', { credentials: 'same-origin' })).json()) as { token: string }).token;
      const res = await fetch('/api/resume/import', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'x-csrf-token': tok } });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'SERVER_ERROR');
      return body;
    });
    if (file.current) file.current.value = '';
  };
  const saveAbout = async () => {
    try { setData(await api<ResumeData>('PUT', '/api/resume', { about })); setEditing(false); setAboutErr(undefined); toast(t('app:resume.saved')); }
    catch (e) { if (e instanceof ApiError && e.fields.about) setAboutErr(e.fields.about); else toast(apiErrText(t, e), 'error'); }
  };
  const addSkills = async () => {
    try { const r = await api<{ added: string[] }>('POST', '/api/resume/apply-skills'); toast(r.added.length ? t('app:resume.added', { n: r.added.length }) : t('app:resume.nothing')); setData(await api<ResumeData>('GET', '/api/resume')); }
    catch (e) { toast(apiErrText(t, e), 'error'); }
  };
  const remove = async () => {
    if (!window.confirm(t('app:confirm'))) return;
    try { await api('DELETE', '/api/resume'); setData(await api<ResumeData>('GET', '/api/resume')); toast(t('app:resume.deleted')); } catch (e) { toast(apiErrText(t, e), 'error'); }
  };

  const r = data?.resume, p = data?.profile;
  const missing = r ? r.inferredSkills.filter((s) => !data!.skills.some((x) => x.toLowerCase() === s.toLowerCase())) : [];
  return (
    <div className="mx-auto max-w-4xl">
      <SubTabs items={tabs} />
      <PageHeader title={t('app:resume.title')} subtitle={t('app:resume.subtitle')} actions={r ? <button type="button" className={`${btnGhost} no-print`} onClick={() => window.print()}><Printer size={15} aria-hidden />{t('app:resume.print')}</button> : undefined} />
      <LoadState loading={loading && !data} error={error} />
      {data && (
        <div className="space-y-4">
          <Card className="no-print">
            <h2 className="flex items-center gap-2 text-[17px] font-bold text-navy"><Sparkles size={18} className="text-orange" aria-hidden />{t('app:resume.importTitle')}</h2>
            <p className="mb-3 mt-1 text-[13.5px] text-muted">{t('app:resume.importText')}</p>
            <TextAreaField name="transcript" label={t('app:resume.paste')} value={text} onChange={setText} max={40000} rows={5} placeholder={t('app:resume.pastePh')} />
            {err && <p role="alert" className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-[13px] font-semibold text-danger-text">{err}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button type="button" disabled={!text.trim() || !!busy} className={btnPrimary} onClick={() => void run('text', () => api<ResumeData>('POST', '/api/resume/import', { text }))}>{busy === 'text' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Wand2 size={16} aria-hidden />}{t('app:resume.build')}</button>
              <input ref={file} id="resume-file" type="file" accept=".pdf,.txt,application/pdf,text/plain" className="sr-only" onChange={(e) => void uploadFile(e.target.files?.[0])} />
              <label htmlFor="resume-file" className={`${btnGhost} cursor-pointer has-[:focus-visible]:outline`}><Upload size={15} aria-hidden />{t('app:resume.upload')}</label>
              <button type="button" disabled={!!busy} className={btnGhost} onClick={() => void run('demo', () => api<ResumeData>('POST', '/api/resume/demo'))}>{busy === 'demo' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}{t('app:resume.demo')}</button>
            </div>
            <p className="mt-2 text-[12px] text-muted">{t('app:resume.demoNote')}</p>
          </Card>

          {r && p && (
            <article className="print-sheet fade-up overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
              <div className="flex items-center gap-4 bg-navy px-6 py-5 text-white">
                <Emblem className="hidden h-14 w-12 text-white/90 sm:block" />
                <div className="min-w-0 flex-1"><h2 className="text-2xl font-extrabold">{p.name} {p.surname}</h2>
                  <p className="text-[14px] text-white/80">{t(`options:majors.${p.major}`)} · {t(`options:years.${p.year}`)} · SDU University</p></div>
                <span className="no-print hidden rounded-full bg-orange-dark px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide sm:block">{t(`app:resume.src.${r.source}`)}</span>
              </div>
              <div className="grid gap-6 p-6 md:grid-cols-[1fr_240px]">
                <div className="space-y-6">
                  <section><div className="mb-1.5 flex items-center justify-between"><h3 className="text-[13px] font-extrabold uppercase tracking-wider text-orange-dark">{t('app:resume.about')}</h3>{!editing && <button type="button" className="no-print text-[13px] font-bold text-brand hover:underline" onClick={() => { setAbout(r.about); setEditing(true); }}>{t('app:resume.edit')}</button>}</div>
                    {editing ? <div className="no-print"><TextAreaField name="about" label={t('app:resume.about')} value={about} onChange={setAbout} max={1000} rows={5} error={aboutErr} />
                      <div className="flex gap-2"><button type="button" className={btnPrimary} onClick={() => void saveAbout()}>{t('save')}</button><button type="button" className={btnGhost} onClick={() => setEditing(false)}>{t('cancel')}</button></div></div>
                      : <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">{r.about}</p>}</section>
                  <section><h3 className="mb-1.5 text-[13px] font-extrabold uppercase tracking-wider text-orange-dark">{t('app:resume.education')}</h3>
                    <p className="font-bold text-navy">SDU University</p><p className="text-[14px] text-muted">{t(`options:majors.${p.major}`)} · {t(`options:years.${p.year}`)}</p>
                    <p className="mt-0.5 text-[14px] font-semibold text-ink">{t('app:resume.gpa', { gpa: p.gpa, credits: r.credits })}</p></section>
                  <section><h3 className="mb-2 text-[13px] font-extrabold uppercase tracking-wider text-orange-dark">{t('app:resume.courses')}</h3>
                    <div className="overflow-x-auto"><table className="w-full text-left text-[13.5px]"><thead className="text-[11px] uppercase tracking-wide text-muted"><tr><th className="pb-1 pr-3 font-bold">{t('app:resume.code')}</th><th className="pb-1 pr-3 font-bold">{t('app:resume.course')}</th><th className="pb-1 pr-3 text-right font-bold">{t('app:resume.credits')}</th><th className="pb-1 text-right font-bold">{t('app:resume.grade')}</th></tr></thead>
                      <tbody>{(showAll ? r.courses : r.courses.slice(0, 6)).map((c) => <tr key={c.code} className="border-t border-line"><td className="py-1.5 pr-3 font-mono text-[12px] text-muted">{c.code}</td><td className="py-1.5 pr-3 font-semibold text-ink">{c.name}</td><td className="py-1.5 pr-3 text-right tabular-nums">{c.credits}</td><td className="py-1.5 text-right font-extrabold text-navy">{c.grade}</td></tr>)}</tbody></table></div>
                    {r.courses.length > 6 && <button type="button" className="no-print mt-2 text-[13px] font-bold text-brand hover:underline" onClick={() => setShowAll((x) => !x)}>{showAll ? '−' : t('app:resume.allCourses', { n: r.courses.length })}</button>}</section>
                  {data.experience && data.experience.years > 0 && <section><h3 className="mb-1.5 text-[13px] font-extrabold uppercase tracking-wider text-orange-dark">{t('app:resume.experience')}</h3><p className="mb-1 text-[14px] font-bold text-navy">{t('app:cv.years', { n: data.experience.years })}</p><ul className="space-y-1 text-[13.5px]">{data.experience.items.map((i, n) => <li key={n}>{i.line}</li>)}</ul></section>}
                </div>
                <aside className="space-y-5 border-t border-line pt-5 md:border-l md:border-t-0 md:pl-5 md:pt-0">
                  <section><h3 className="mb-2 text-[13px] font-extrabold uppercase tracking-wider text-orange-dark">{t('app:resume.contacts')}</h3>
                    <ul className="space-y-1.5 break-all text-[13.5px]"><li className="flex items-center gap-2"><Mail size={14} aria-hidden className="shrink-0 text-muted" />{p.email}</li><li className="flex items-center gap-2"><Phone size={14} aria-hidden className="shrink-0 text-muted" />{p.phone}</li><li className="flex items-center gap-2"><MapPin size={14} aria-hidden className="shrink-0 text-muted" />{cityLabel(t, p.city, p.cityOther)}</li></ul></section>
                  <section><h3 className="mb-2 text-[13px] font-extrabold uppercase tracking-wider text-orange-dark">{t('app:resume.skills')}</h3>
                    <SkillChips neutral={r.inferredSkills} />
                    {missing.length > 0 && <button type="button" onClick={() => void addSkills()} className={`${btnPrimary} no-print mt-3 !h-9 w-full !px-3 !text-[13px]`}>{t('app:resume.addSkills')}</button>}</section>
                </aside>
              </div>
              <div className="no-print flex justify-end border-t border-line bg-page px-6 py-3"><button type="button" className={btnDanger} onClick={() => void remove()}><Trash2 size={14} aria-hidden />{t('app:resume.delete')}</button></div>
            </article>
          )}
        </div>
      )}
    </div>
  );
}
