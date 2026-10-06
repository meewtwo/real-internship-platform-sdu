import { ArrowDown, ArrowLeft, ArrowUp, Copy, Download, History, Loader2, Plus, Printer, RefreshCw, Share2, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { RESUME_LANGS, RESUME_TEMPLATES, emptyResumeDoc, validateResumeDoc, type ResumeDoc, type ResumeLang, type ResumeTemplate, type ReviewItem, type ReviewStrength } from '@sdu/shared';
import { AiGate } from '../../components/AiGate';
import { ResumePreview } from '../../components/ResumePreview';
import { Card, LoadState, MatchBadge, btnGhost, btnPrimary } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import { apiErrText, errText } from '../../lib/errors';
import { fmtDate } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';

interface DocDto { id: string; title: string; template: ResumeTemplate; language: ResumeLang; version: number; data: ResumeDoc; publicSlug: string | null; publicContact: boolean }
type Status = 'saved' | 'dirty' | 'saving' | 'invalid' | 'conflict' | 'error';
const inp = 'h-9 w-full rounded-xl border-[1.5px] border-slate-300 bg-white px-2.5 text-[14px] aria-[invalid=true]:border-danger';
const area = 'w-full rounded-xl border-[1.5px] border-slate-300 bg-white p-2.5 text-[14px] leading-6 aria-[invalid=true]:border-danger';

function F({ label, err, className = '', children }: { label: string; err?: string; className?: string; children: (p: { 'aria-invalid': boolean; 'aria-label': string }) => ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="mb-0.5 block text-[12px] font-bold text-navy">{label}</span>
      {children({ 'aria-invalid': !!err, 'aria-label': label })}
      {err && <p role="alert" className="mt-0.5 text-[12px] font-semibold text-danger-text">{errText(t, err)}</p>}
    </div>
  );
}
const Section = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => (
  <Card><div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-[15px] font-extrabold text-navy">{title}</h2>{action}</div>{children}</Card>
);
const Row = ({ children, onUp, onDown, onRemove }: { children: ReactNode; onUp?: () => void; onDown?: () => void; onRemove: () => void }) => {
  const { t } = useTranslation();
  return (
    <div className="mb-3 rounded-xl bg-slate-50 p-3 ring-1 ring-line">
      {children}
      <div className="mt-2 flex gap-1.5">
        {onUp && <button type="button" onClick={onUp} className={`${btnGhost} !h-7 !px-2`} aria-label={t('app:builder.up')}><ArrowUp size={13} aria-hidden /></button>}
        {onDown && <button type="button" onClick={onDown} className={`${btnGhost} !h-7 !px-2`} aria-label={t('app:builder.down')}><ArrowDown size={13} aria-hidden /></button>}
        <button type="button" onClick={onRemove} className={`${btnGhost} !h-7 !px-2 !text-danger-text`}><Trash2 size={13} aria-hidden />{t('app:builder.remove')}</button>
      </div>
    </div>
  );
};
const AddBtn = ({ onClick, label }: { onClick: () => void; label: string }) => <button type="button" onClick={onClick} className={btnGhost}><Plus size={14} aria-hidden />{label}</button>;

export function ResumeEditor() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  usePageTitle('nav.builder');
  const toast = useToast();
  const { data: loaded, error, loading, reload } = useApi<{ doc: DocDto }>(`/api/resume-docs/${id}`);
  const { data: consent } = useApi<{ consent: boolean; available: boolean }>('/api/ai/consent');
  const ai = !!consent?.consent && consent.available;

  const [doc, setDoc] = useState<ResumeDoc>(emptyResumeDoc());
  const [meta, setMeta] = useState<{ title: string; template: ResumeTemplate; language: ResumeLang }>({ title: '', template: 'classic', language: 'en' });
  const [share, setShare] = useState<{ slug: string | null; contact: boolean }>({ slug: null, contact: false });
  const [version, setVersion] = useState(1);
  const [status, setStatus] = useState<Status>('saved');
  const [panel, setPanel] = useState<'preview' | 'review' | 'tailor' | 'history' | 'share'>('preview');
  const rev = useRef(0), savedRev = useRef(0), ready = useRef(false);
  const latest = useRef({ doc, meta, version });
  latest.current = { doc, meta, version };

  // hydrate once the document arrives
  useEffect(() => {
    if (!loaded) return;
    const d = loaded.doc;
    setDoc(d.data); setMeta({ title: d.title, template: d.template, language: d.language }); setVersion(d.version); setShare({ slug: d.publicSlug, contact: d.publicContact });
    rev.current = savedRev.current = 0; ready.current = true; setStatus('saved');
  }, [loaded]);

  const errs = useMemo(() => { const r = validateResumeDoc(doc); return r.ok ? ({} as Record<string, string>) : (r.fields as Record<string, string>); }, [doc]);
  const metaErr = meta.title.trim() === '' ? 'REQUIRED' : undefined;
  const invalid = Object.keys(errs).length > 0 || !!metaErr;

  const touch = () => { rev.current += 1; setStatus(invalid ? 'invalid' : 'dirty'); };
  const edit = (fn: (d: ResumeDoc) => void) => { setDoc((d) => { const n = structuredClone(d); fn(n); return n; }); touch(); };
  const editMeta = (patch: Partial<typeof meta>) => { setMeta((m) => ({ ...m, ...patch })); touch(); };

  const save = useCallback(async () => {
    const { doc: d, meta: m, version: v } = latest.current;
    const check = validateResumeDoc(d);
    if (!check.ok || !m.title.trim()) { setStatus('invalid'); return; }
    const myRev = rev.current;
    setStatus('saving');
    try {
      const r = await api<{ doc: DocDto }>('PUT', `/api/resume-docs/${id}`, { baseVersion: v, title: m.title.trim(), template: m.template, language: m.language, data: check.data });
      setVersion(r.doc.version); savedRev.current = myRev;
      setStatus(rev.current === myRev ? 'saved' : 'dirty');
    } catch (e) { setStatus(e instanceof ApiError && e.code === 'RESUME_CONFLICT' ? 'conflict' : 'error'); }
  }, [id]);

  // debounced autosave (only valid documents are sent; the server validates again)
  const [tick, setTick] = useState(0);
  useEffect(() => { if (ready.current && rev.current > savedRev.current) setTick((x) => x + 1); }, [doc, meta]);
  useEffect(() => {
    if (!tick || status === 'conflict' || status === 'saving') return;
    const h = setTimeout(() => { if (rev.current > savedRev.current) void save(); }, 1200);
    return () => clearTimeout(h);
  }, [tick, save, status]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => { if (rev.current > savedRev.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  const e = (path: string) => errs[path];
  const move = <T,>(list: T[], i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; };
  const [undo, setUndo] = useState<{ ei: number; bi: number; prev: string } | null>(null);
  const [busyAi, setBusyAi] = useState('');
  const rewrite = async (ei: number, bi: number, mode: 'stronger' | 'shorter' | 'quantify') => {
    const ex = doc.experience[ei]; const text = ex.bullets[bi];
    setBusyAi(`${ei}.${bi}`);
    try {
      const r = await api<{ text: string }>('POST', `/api/resume-docs/${id}/ai/rewrite`, { text, mode, context: [ex.role, ex.company].filter(Boolean).join(' @ '), language: meta.language });
      edit((d) => { d.experience[ei].bullets[bi] = r.text; }); setUndo({ ei, bi, prev: text });
    } catch (er) { toast(apiErrText(t, er), 'error'); } finally { setBusyAi(''); }
  };

  const [review, setReview] = useState<{ score: number; issues: ReviewItem[]; strengths: ReviewStrength[] } | null>(null);
  useEffect(() => { if (panel === 'review' && status === 'saved') api<typeof review>('GET', `/api/resume-docs/${id}/review`).then(setReview).catch(() => setReview(null)); }, [panel, status, version, id]);

  const dateInput = (label: string, value: string, set: (v: string) => void, err?: string, allowPresent = false) => (
    <F label={label} err={err}>{(a) => (
      <div className="flex items-center gap-2">
        <input {...a} type="month" value={value === 'present' ? '' : value} disabled={value === 'present'} onChange={(ev) => set(ev.target.value)} className={inp} />
        {allowPresent && <label className="flex shrink-0 items-center gap-1 text-[12px] font-semibold"><input type="checkbox" checked={value === 'present'} onChange={(ev) => set(ev.target.checked ? 'present' : '')} />{t('app:builder.f.present')}</label>}
      </div>
    )}</F>
  );

  if (loading && !loaded) return <LoadState loading error={null} />;
  if (error) return <LoadState loading={false} error={error} />;
  const statusCls = status === 'saved' ? 'bg-white text-ok-text ring-1 ring-ok/40' : status === 'conflict' || status === 'error' ? 'bg-danger/10 text-danger-text' : status === 'invalid' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700';
  const invalidPaths = Object.keys(errs);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="no-print">
        <Link to="/resume/builder" className="mb-3 inline-flex items-center gap-1 text-[13px] font-bold text-brand hover:underline"><ArrowLeft size={14} aria-hidden />{t('app:builder.back')}</Link>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="block min-w-[200px] flex-1 text-[12px] font-bold text-navy">{t('app:builder.name')}<input value={meta.title} maxLength={80} aria-invalid={!!metaErr} onChange={(ev) => editMeta({ title: ev.target.value })} className={`${inp} mt-0.5 !h-10 text-[16px] font-extrabold`} /></label>
          <label className="block text-[12px] font-bold text-navy">{t('app:builder.template.label')}
            <select value={meta.template} onChange={(ev) => editMeta({ template: ev.target.value as ResumeTemplate })} className={`${inp} mt-0.5 !h-10`}>{RESUME_TEMPLATES.map((k) => <option key={k} value={k}>{t(`app:builder.template.${k}`)}</option>)}</select></label>
          <label className="block text-[12px] font-bold text-navy">{t('app:builder.docLanguage')}
            <select value={meta.language} onChange={(ev) => editMeta({ language: ev.target.value as ResumeLang })} className={`${inp} mt-0.5 !h-10`}>{RESUME_LANGS.map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}</select></label>
          <p role="status" aria-live="polite" className={`rounded-full px-3 py-1 text-[12px] font-bold ${statusCls}`}>{status === 'saving' && <Loader2 size={12} className="mr-1 inline animate-spin" aria-hidden />}{t(`app:builder.status.${status}`)}</p>
        </div>
        {status === 'conflict' && (
          <p role="alert" className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-danger/10 px-3 py-2 text-[13px] font-semibold text-danger-text">{errText(t, 'RESUME_CONFLICT')}
            <button type="button" className={btnGhost} onClick={() => void reload()}><RefreshCw size={14} aria-hidden />{t('app:builder.reload')}</button></p>
        )}
        {status === 'invalid' && invalidPaths.length > 0 && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-900 ring-1 ring-amber-300">{t('app:builder.invalidHint', { n: invalidPaths.length })}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="no-print space-y-4">
          <Section title={t('app:builder.sections.personal')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <F label={t('app:builder.f.fullName')} err={e('personal.fullName')}>{(a) => <input {...a} value={doc.personal.fullName} maxLength={80} onChange={(ev) => edit((d) => { d.personal.fullName = ev.target.value; })} className={inp} />}</F>
              <F label={t('app:builder.f.headline')} err={e('personal.headline')}>{(a) => <input {...a} value={doc.personal.headline} maxLength={100} onChange={(ev) => edit((d) => { d.personal.headline = ev.target.value; })} className={inp} />}</F>
              <F label={t('app:builder.f.email')} err={e('personal.email')}>{(a) => <input {...a} type="email" value={doc.personal.email} maxLength={120} onChange={(ev) => edit((d) => { d.personal.email = ev.target.value; })} className={inp} />}</F>
              <F label={t('app:builder.f.phone')} err={e('personal.phone')}>{(a) => <input {...a} type="tel" value={doc.personal.phone} maxLength={30} onChange={(ev) => edit((d) => { d.personal.phone = ev.target.value; })} className={inp} />}</F>
              <F label={t('app:builder.f.city')} err={e('personal.city')} className="sm:col-span-2">{(a) => <input {...a} value={doc.personal.city} maxLength={60} onChange={(ev) => edit((d) => { d.personal.city = ev.target.value; })} className={inp} />}</F>
            </div>
            <h3 className="mb-1 mt-3 text-[13px] font-extrabold text-navy">{t('app:builder.f.links')}</h3>
            {doc.personal.links.map((l, i) => (
              <Row key={i} onRemove={() => edit((d) => { d.personal.links.splice(i, 1); })}>
                <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                  <F label={t('app:builder.f.linkLabel')} err={e(`personal.links.${i}.label`)}>{(a) => <input {...a} value={l.label} maxLength={30} onChange={(ev) => edit((d) => { d.personal.links[i].label = ev.target.value; })} className={inp} />}</F>
                  <F label={t('app:builder.f.linkUrl')} err={e(`personal.links.${i}.url`)}>{(a) => <input {...a} type="url" inputMode="url" placeholder="https://" value={l.url} maxLength={200} onChange={(ev) => edit((d) => { d.personal.links[i].url = ev.target.value; })} className={inp} />}</F>
                </div>
              </Row>
            ))}
            {doc.personal.links.length < 5 && <AddBtn label={t('app:builder.add.link')} onClick={() => edit((d) => { d.personal.links.push({ label: '', url: '' }); })} />}
          </Section>

          <Section title={t('app:builder.sections.summary')}>
            <F label={t('app:builder.sections.summary')} err={e('summary')}>{(a) => <textarea {...a} rows={4} value={doc.summary} maxLength={600} onChange={(ev) => edit((d) => { d.summary = ev.target.value; })} className={area} />}</F>
            <p className="mt-0.5 text-right text-[11px] text-muted">{Array.from(doc.summary).length}/600</p>
          </Section>

          <Section title={t('app:builder.sections.experience')} action={doc.experience.length < 10 ? <AddBtn label={t('app:builder.add.experience')} onClick={() => edit((d) => { d.experience.push({ role: '', company: '', location: '', start: '', end: '', bullets: [''] }); })} /> : undefined}>
            {doc.experience.map((x, i) => (
              <Row key={i} onUp={() => edit((d) => move(d.experience, i, -1))} onDown={() => edit((d) => move(d.experience, i, 1))} onRemove={() => edit((d) => { d.experience.splice(i, 1); })}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <F label={t('app:builder.f.role')} err={e(`experience.${i}.role`)}>{(a) => <input {...a} value={x.role} maxLength={100} onChange={(ev) => edit((d) => { d.experience[i].role = ev.target.value; })} className={inp} />}</F>
                  <F label={t('app:builder.f.company')} err={e(`experience.${i}.company`)}>{(a) => <input {...a} value={x.company} maxLength={100} onChange={(ev) => edit((d) => { d.experience[i].company = ev.target.value; })} className={inp} />}</F>
                  <F label={t('app:builder.f.location')} err={e(`experience.${i}.location`)} className="sm:col-span-2">{(a) => <input {...a} value={x.location} maxLength={60} onChange={(ev) => edit((d) => { d.experience[i].location = ev.target.value; })} className={inp} />}</F>
                  {dateInput(t('app:builder.f.start'), x.start, (v) => edit((d) => { d.experience[i].start = v; }), e(`experience.${i}.start`))}
                  {dateInput(t('app:builder.f.end'), x.end, (v) => edit((d) => { d.experience[i].end = v; }), e(`experience.${i}.end`), true)}
                </div>
                <h3 className="mb-1 mt-2 text-[12px] font-extrabold text-navy">{t('app:builder.f.bullets')}</h3>
                {x.bullets.map((b, j) => (
                  <div key={j} className="mb-2">
                    <div className="flex gap-1.5">
                      <F label={`${t('app:builder.f.bullet')} ${j + 1}`} err={e(`experience.${i}.bullets.${j}`)} className="flex-1">{(a) => <textarea {...a} rows={2} value={b} maxLength={240} onChange={(ev) => edit((d) => { d.experience[i].bullets[j] = ev.target.value.replace(/\n/g, ' '); })} className={area} />}</F>
                      <button type="button" aria-label={`${t('app:builder.remove')} ${j + 1}`} onClick={() => edit((d) => { d.experience[i].bullets.splice(j, 1); })} className={`${btnGhost} mt-5 !h-7 !px-2`}><Trash2 size={13} aria-hidden /></button>
                    </div>
                    {ai && b.trim().length >= 5 && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {busyAi === `${i}.${j}` ? <Loader2 size={14} className="animate-spin text-brand" aria-hidden /> : <Sparkles size={13} className="text-brand" aria-hidden />}
                        {(['stronger', 'shorter', 'quantify'] as const).map((m) => <button key={m} type="button" disabled={!!busyAi} onClick={() => void rewrite(i, j, m)} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[12px] font-bold text-brand-dark hover:bg-brand/20 disabled:opacity-50">{t(`app:builder.ai.${m}`)}</button>)}
                        {undo && undo.ei === i && undo.bi === j && <button type="button" onClick={() => { edit((d) => { d.experience[i].bullets[j] = undo.prev; }); setUndo(null); }} className="text-[12px] font-bold text-brand underline">{t('app:builder.ai.undo')}</button>}
                      </div>
                    )}
                  </div>
                ))}
                {x.bullets.length < 6 && <AddBtn label={t('app:builder.add.bullet')} onClick={() => edit((d) => { d.experience[i].bullets.push(''); })} />}
              </Row>
            ))}
            {!ai && consent && !consent.consent && doc.experience.length > 0 && <p className="text-[12px] text-muted"><Link className="font-bold text-brand hover:underline" to="/ai">{t('app:builder.ai.enable')}</Link></p>}
          </Section>

          <Section title={t('app:builder.sections.education')} action={doc.education.length < 6 ? <AddBtn label={t('app:builder.add.education')} onClick={() => edit((d) => { d.education.push({ institution: '', degree: '', start: '', end: '', details: '' }); })} /> : undefined}>
            {doc.education.map((x, i) => (
              <Row key={i} onUp={() => edit((d) => move(d.education, i, -1))} onDown={() => edit((d) => move(d.education, i, 1))} onRemove={() => edit((d) => { d.education.splice(i, 1); })}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <F label={t('app:builder.f.institution')} err={e(`education.${i}.institution`)}>{(a) => <input {...a} value={x.institution} maxLength={120} onChange={(ev) => edit((d) => { d.education[i].institution = ev.target.value; })} className={inp} />}</F>
                  <F label={t('app:builder.f.degree')} err={e(`education.${i}.degree`)}>{(a) => <input {...a} value={x.degree} maxLength={120} onChange={(ev) => edit((d) => { d.education[i].degree = ev.target.value; })} className={inp} />}</F>
                  {dateInput(t('app:builder.f.start'), x.start, (v) => edit((d) => { d.education[i].start = v; }), e(`education.${i}.start`))}
                  {dateInput(t('app:builder.f.end'), x.end, (v) => edit((d) => { d.education[i].end = v; }), e(`education.${i}.end`), true)}
                  <F label={t('app:builder.f.details')} err={e(`education.${i}.details`)} className="sm:col-span-2">{(a) => <input {...a} value={x.details} maxLength={240} onChange={(ev) => edit((d) => { d.education[i].details = ev.target.value; })} className={inp} />}</F>
                </div>
              </Row>
            ))}
          </Section>

          <Section title={t('app:builder.sections.projects')} action={doc.projects.length < 8 ? <AddBtn label={t('app:builder.add.project')} onClick={() => edit((d) => { d.projects.push({ name: '', url: '', description: '', tech: [] }); })} /> : undefined}>
            {doc.projects.map((x, i) => (
              <Row key={i} onUp={() => edit((d) => move(d.projects, i, -1))} onDown={() => edit((d) => move(d.projects, i, 1))} onRemove={() => edit((d) => { d.projects.splice(i, 1); })}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <F label={t('app:builder.f.projectName')} err={e(`projects.${i}.name`)}>{(a) => <input {...a} value={x.name} maxLength={100} onChange={(ev) => edit((d) => { d.projects[i].name = ev.target.value; })} className={inp} />}</F>
                  <F label={t('app:builder.f.linkUrl')} err={e(`projects.${i}.url`)}>{(a) => <input {...a} type="url" placeholder="https://" value={x.url} maxLength={200} onChange={(ev) => edit((d) => { d.projects[i].url = ev.target.value; })} className={inp} />}</F>
                  <F label={t('app:builder.f.projectDesc')} err={e(`projects.${i}.description`)} className="sm:col-span-2">{(a) => <textarea {...a} rows={2} value={x.description} maxLength={300} onChange={(ev) => edit((d) => { d.projects[i].description = ev.target.value.replace(/\n/g, ' '); })} className={area} />}</F>
                  <F label={t('app:builder.f.tech')} err={e(`projects.${i}.tech`)} className="sm:col-span-2">{(a) => <input {...a} value={x.tech.join(', ')} onChange={(ev) => edit((d) => { d.projects[i].tech = ev.target.value.split(',').map((s) => s.trimStart()).slice(0, 8); })} className={inp} />}</F>
                </div>
              </Row>
            ))}
          </Section>

          <Section title={t('app:builder.sections.skills')} action={doc.skills.length < 8 ? <AddBtn label={t('app:builder.add.skillGroup')} onClick={() => edit((d) => { d.skills.push({ group: '', items: [] }); })} /> : undefined}>
            {doc.skills.map((x, i) => (
              <Row key={i} onRemove={() => edit((d) => { d.skills.splice(i, 1); })}>
                <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                  <F label={t('app:builder.f.group')} err={e(`skills.${i}.group`)}>{(a) => <input {...a} value={x.group} maxLength={40} onChange={(ev) => edit((d) => { d.skills[i].group = ev.target.value; })} className={inp} />}</F>
                  <F label={t('app:builder.f.items')} err={e(`skills.${i}.items`)}>{(a) => <input {...a} value={x.items.join(', ')} onChange={(ev) => edit((d) => { d.skills[i].items = ev.target.value.split(',').map((s) => s.trimStart()).slice(0, 20); })} className={inp} />}</F>
                </div>
              </Row>
            ))}
          </Section>

          <Section title={t('app:builder.sections.languages')} action={doc.languages.length < 8 ? <AddBtn label={t('app:builder.add.language')} onClick={() => edit((d) => { d.languages.push({ name: '', level: '' }); })} /> : undefined}>
            {doc.languages.map((x, i) => (
              <Row key={i} onRemove={() => edit((d) => { d.languages.splice(i, 1); })}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <F label={t('app:builder.f.langName')} err={e(`languages.${i}.name`)}>{(a) => <input {...a} value={x.name} maxLength={30} onChange={(ev) => edit((d) => { d.languages[i].name = ev.target.value; })} className={inp} />}</F>
                  <F label={t('app:builder.f.level')} err={e(`languages.${i}.level`)}>{(a) => <input {...a} value={x.level} maxLength={30} onChange={(ev) => edit((d) => { d.languages[i].level = ev.target.value; })} className={inp} />}</F>
                </div>
              </Row>
            ))}
          </Section>

          <Section title={t('app:builder.sections.certificates')} action={doc.certificates.length < 8 ? <AddBtn label={t('app:builder.add.certificate')} onClick={() => edit((d) => { d.certificates.push({ name: '', issuer: '', year: '' }); })} /> : undefined}>
            {doc.certificates.map((x, i) => (
              <Row key={i} onRemove={() => edit((d) => { d.certificates.splice(i, 1); })}>
                <div className="grid gap-2 sm:grid-cols-3">
                  <F label={t('app:builder.f.certName')} err={e(`certificates.${i}.name`)}>{(a) => <input {...a} value={x.name} maxLength={100} onChange={(ev) => edit((d) => { d.certificates[i].name = ev.target.value; })} className={inp} />}</F>
                  <F label={t('app:builder.f.issuer')} err={e(`certificates.${i}.issuer`)}>{(a) => <input {...a} value={x.issuer} maxLength={80} onChange={(ev) => edit((d) => { d.certificates[i].issuer = ev.target.value; })} className={inp} />}</F>
                  <F label={t('app:builder.f.year')} err={e(`certificates.${i}.year`)}>{(a) => <input {...a} inputMode="numeric" value={x.year} maxLength={4} onChange={(ev) => edit((d) => { d.certificates[i].year = ev.target.value; })} className={inp} />}</F>
                </div>
              </Row>
            ))}
          </Section>
        </div>

        <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <div className="no-print flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label={t('app:builder.panels.label')} className="flex flex-wrap gap-1">
              {(['preview', 'review', 'tailor', 'history', 'share'] as const).map((k) => <button key={k} role="tab" type="button" aria-selected={panel === k} onClick={() => setPanel(k)} className={`rounded-full px-3 py-1 text-[13px] font-bold ${panel === k ? 'bg-navy text-white' : 'bg-white text-navy ring-1 ring-line hover:bg-brand-50'}`}>{t(`app:builder.panels.${k}`)}</button>)}
            </div>
            <div className="ml-auto flex gap-1.5">
              <a href={`/api/resume-docs/${id}/export.docx`} download className={btnGhost}><Download size={14} aria-hidden />{t('app:builder.export.docx')}</a>
              <button type="button" onClick={() => window.print()} className={btnGhost}><Printer size={14} aria-hidden />{t('app:builder.export.print')}</button>
            </div>
          </div>
          <div className="no-print" role="tabpanel">
            {panel === 'preview' && <div className="max-h-[calc(100dvh-9rem)] overflow-auto rounded-2xl"><ResumePreview doc={doc} template={meta.template} language={meta.language} /></div>}
            {panel === 'review' && <ReviewPanel review={review} saved={status === 'saved'} />}
            {panel === 'tailor' && <TailorPanel id={id!} lang={meta.language} onSummary={(s) => edit((d) => { d.summary = s.slice(0, 600); })} />}
            {panel === 'history' && <HistoryPanel id={id!} version={version} baseVersion={version} onRestored={(d) => { setDoc(d.data); setMeta({ title: d.title, template: d.template, language: d.language }); setVersion(d.version); rev.current = savedRev.current; setStatus('saved'); toast(t('app:builder.history.restored')); }} />}
            {panel === 'share' && <SharePanel id={id!} share={share} onChange={(s) => setShare(s)} />}
          </div>
        </div>
      </div>
      {/* the only thing that prints: the rendered résumé (everything else is .no-print) */}
      <div className="hidden print:block"><ResumePreview doc={doc} template={meta.template} language={meta.language} /></div>
      <span className="sr-only">{i18n.language}</span>
    </div>
  );
}

function ReviewPanel({ review, saved }: { review: { score: number; issues: ReviewItem[]; strengths: ReviewStrength[] } | null; saved: boolean }) {
  const { t } = useTranslation();
  if (!review) return <Card><p className="text-[13px] text-muted">{saved ? t('app:builder.review.loading') : t('app:builder.review.wait')}</p></Card>;
  const groups = new Map<string, number>();
  for (const i of review.issues) groups.set(i.issue, (groups.get(i.issue) ?? 0) + 1);
  return (
    <Card>
      <div className="flex items-center gap-3"><MatchBadge percent={review.score} size={72} /><div><h2 className="text-[16px] font-extrabold text-navy">{t('app:builder.review.score')}</h2><p className="text-[12px] text-muted">{t('app:builder.review.note')}</p></div></div>
      {review.strengths.length > 0 && <ul className="mt-3 space-y-1 text-[13px] text-ok-text">{review.strengths.map((s) => <li key={s}>✓ {t(`app:builder.strength.${s}`)}</li>)}</ul>}
      {groups.size === 0 ? <p className="mt-3 text-[13px] font-semibold text-ok-text">{t('app:builder.review.none')}</p> : (
        <ul className="mt-3 space-y-1.5 text-[13px] text-ink">{[...groups].map(([k, n]) => <li key={k} className="rounded-lg bg-amber-50 px-3 py-1.5 ring-1 ring-amber-200">{t(`app:builder.issue.${k}`)}{n > 1 && <span className="ml-1 font-bold text-amber-900">×{n}</span>}</li>)}</ul>
      )}
    </Card>
  );
}

function TailorPanel({ id, lang, onSummary }: { id: string; lang: ResumeLang; onSummary: (s: string) => void }) {
  const { t } = useTranslation();
  const { data } = useApi<{ items: { id: string; title: string; company: { name: string } }[] }>('/api/vacancies?sort=match');
  const [vid, setVid] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<{ gap: { present: string[]; missing: string[] }; suggestion: { summary: string; tips: string[] } | null; source: 'ai' | 'rules' } | null>(null);
  const run = async () => { setBusy(true); setErr(''); try { setRes(await api('POST', `/api/resume-docs/${id}/ai/tailor`, { vacancyId: vid, language: lang })); } catch (e) { setErr(apiErrText(t, e)); } finally { setBusy(false); } };
  return (
    <AiGate compact>
      <Card>
        <p className="mb-2 text-[13px] text-muted">{t('app:builder.tailor.hint')}</p>
        <label className="block text-[12px] font-bold text-navy">{t('app:ai.vacancy')}
          <select value={vid} onChange={(e) => setVid(e.target.value)} className={`${inp} mt-0.5 font-normal`}><option value="">{t('app:ai.pick')}</option>{data?.items.map((v) => <option key={v.id} value={v.id}>{v.title} — {v.company.name}</option>)}</select></label>
        <button type="button" disabled={!vid || busy} onClick={() => void run()} className={`${btnPrimary} mt-2`}>{busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Wand2 size={15} aria-hidden />}{t('app:builder.tailor.run')}</button>
        {err && <p role="alert" className="mt-2 text-[13px] font-semibold text-danger-text">{err}</p>}
        {res && (
          <div className="mt-3 space-y-2 text-[13px]">
            <p><b className="text-ok-text">{t('app:builder.tailor.present')}:</b> {res.gap.present.join(', ') || '—'}</p>
            <p><b className="text-danger-text">{t('app:builder.tailor.missing')}:</b> {res.gap.missing.join(', ') || '—'}</p>
            {res.suggestion?.summary && <div className="rounded-xl bg-brand-50/60 p-3"><p className="text-[12px] font-extrabold text-navy">{t('app:builder.tailor.summary')}</p><p>{res.suggestion.summary}</p><button type="button" className={`${btnGhost} mt-1.5`} onClick={() => onSummary(res.suggestion!.summary)}>{t('app:builder.tailor.use')}</button></div>}
            {res.suggestion && res.suggestion.tips.length > 0 && <ul className="list-disc space-y-0.5 pl-5">{res.suggestion.tips.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            {!res.suggestion && <p className="text-muted">{t('app:builder.tailor.noAi')}</p>}
          </div>
        )}
      </Card>
    </AiGate>
  );
}

function HistoryPanel({ id, version, baseVersion, onRestored }: { id: string; version: number; baseVersion: number; onRestored: (d: DocDto) => void }) {
  const { t } = useTranslation();
  const { data, reload } = useApi<{ versions: { version: number; createdAt: string }[]; current: number }>(`/api/resume-docs/${id}/versions`);
  const [err, setErr] = useState('');
  useEffect(() => { void reload(); }, [version, reload]);
  const restore = async (v: number) => {
    if (!window.confirm(t('app:builder.history.confirm', { n: v }))) return;
    try { const r = await api<{ doc: DocDto }>('POST', `/api/resume-docs/${id}/restore`, { version: v, baseVersion }); onRestored(r.doc); } catch (e) { setErr(apiErrText(t, e)); }
  };
  return (
    <Card>
      <h2 className="mb-2 flex items-center gap-1.5 text-[15px] font-extrabold text-navy"><History size={16} aria-hidden />{t('app:builder.panels.history')}</h2>
      {err && <p role="alert" className="mb-2 text-[13px] font-semibold text-danger-text">{err}</p>}
      <ul className="max-h-80 space-y-1 overflow-auto text-[13px]">
        {data?.versions.map((v) => (
          <li key={v.version} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5">
            <span>{t('app:builder.history.version', { n: v.version })} · <span className="text-muted">{fmtDate(v.createdAt)} {new Date(v.createdAt).toLocaleTimeString().slice(0, 5)}</span></span>
            {v.version === data.current ? <span className="text-[12px] font-bold text-ok-text">{t('app:builder.history.current')}</span> : <button type="button" className={`${btnGhost} !h-7`} onClick={() => void restore(v.version)}>{t('app:builder.history.restore')}</button>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SharePanel({ id, share, onChange }: { id: string; share: { slug: string | null; contact: boolean }; onChange: (s: { slug: string | null; contact: boolean }) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { const r = await api<{ doc: DocDto }>('POST', `/api/resume-docs/${id}/share`, body); onChange({ slug: r.doc.publicSlug, contact: r.doc.publicContact }); }
    catch (e) { toast(apiErrText(t, e), 'error'); } finally { setBusy(false); }
  };
  const url = share.slug ? `${window.location.origin}/r/${share.slug}` : '';
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-1.5 text-[15px] font-extrabold text-navy"><Share2 size={16} aria-hidden />{t('app:builder.panels.share')}</h2>
      <p className="mb-3 text-[13px] text-muted">{t('app:builder.share.warn')}</p>
      {!share.slug ? <button type="button" disabled={busy} className={btnPrimary} onClick={() => void call({ enabled: true })}>{t('app:builder.share.enable')}</button> : (
        <div className="space-y-2">
          <div className="flex gap-2"><input readOnly aria-label={t('app:builder.share.link')} value={url} onFocus={(e) => e.currentTarget.select()} className={`${inp} font-mono text-[12px]`} />
            <button type="button" className={btnGhost} onClick={async () => { try { await navigator.clipboard.writeText(url); toast(t('app:builder.share.copied')); } catch { /* blocked */ } }}><Copy size={14} aria-hidden />{t('app:builder.share.copy')}</button></div>
          <label className="flex items-center gap-2 text-[13px] font-semibold"><input type="checkbox" checked={share.contact} disabled={busy} onChange={(e) => void call({ enabled: true, showContact: e.target.checked })} />{t('app:builder.share.showContact')}</label>
          <div className="flex gap-2"><button type="button" disabled={busy} className={btnGhost} onClick={() => void call({ enabled: true, rotate: true })}><RefreshCw size={14} aria-hidden />{t('app:builder.share.rotate')}</button>
            <button type="button" disabled={busy} className={btnGhost} onClick={() => void call({ enabled: false })}>{t('app:builder.share.disable')}</button></div>
        </div>
      )}
    </Card>
  );
}
