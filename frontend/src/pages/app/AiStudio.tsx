import { Copy, FileText, Loader2, MessagesSquare, ScanSearch, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AiGate, AiNotice } from '../../components/AiGate';
import { Card, PageHeader, SkillChips, btnGhost, btnPrimary } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { apiErrText } from '../../lib/errors';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';

type Source = 'ai' | 'rules';
const field = 'h-10 w-full rounded-xl border-[1.5px] border-slate-300 bg-white px-3 text-[14px]';

function useLang() { const { i18n } = useTranslation(); return i18n.language.slice(0, 2); }
function useRun() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true); setErr('');
    try { return await fn(); } catch (e) { setErr(apiErrText(t, e)); return null; } finally { setBusy(false); }
  };
  return { busy, err, run };
}
const Err = ({ msg }: { msg: string }) => (msg ? <p role="alert" className="mt-2 rounded-xl bg-danger/10 px-3 py-2 text-[13px] font-semibold text-danger-text">{msg}</p> : null);
const Busy = ({ on, children }: { on: boolean; children: React.ReactNode }) => <>{on ? <Loader2 className="animate-spin" size={16} aria-hidden /> : null}{children}</>;

function VacancyPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const { data } = useApi<{ items: { id: string; title: string; company: { name: string }; match: { percent: number } | null }[] }>('/api/vacancies?sort=match');
  return (
    <label className="block text-[12px] font-bold text-navy">{t('app:ai.vacancy')}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${field} mt-0.5 font-normal`}>
        <option value="">{t('app:ai.pick')}</option>
        {data?.items.map((v) => <option key={v.id} value={v.id}>{v.title} — {v.company.name}{v.match ? ` (${v.match.percent}%)` : ''}</option>)}
      </select>
    </label>
  );
}

interface CvAnalysis { headline: string; summary: string; skills: string[]; experience: { role: string; company: string; period: string; highlights: string[] }[]; education: { institution: string; degree: string; period: string }[]; languages: string[]; strengths: string[]; improvements: string[] }
function CvTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const { busy, err, run } = useRun();
  const [res, setRes] = useState<{ analysis: CvAnalysis; source: Source; notice: string | null } | null>(null);
  const analyze = async () => { const r = await run(() => api<{ analysis: CvAnalysis; source: Source; notice: string | null }>('POST', '/api/ai/cv/analyze', {})); if (r) setRes(r); };
  const add = async () => {
    const r = await run(() => api<{ added: string[] }>('POST', '/api/ai/cv/apply-skills', { skills: res!.analysis.skills }));
    if (r) toast(r.added.length ? t('app:cv.added', { n: r.added.length }) : t('app:cv.nothingToAdd'));
  };
  const a = res?.analysis;
  const list = (title: string, items: string[]) => items.length > 0 && <div className="mt-3"><h3 className="mb-1 text-[13px] font-extrabold text-navy">{title}</h3><ul className="list-disc space-y-0.5 pl-5 text-[14px]">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
  return (
    <Card>
      <p className="text-[14px] text-muted">{t('app:ai.cv.hint')}</p>
      <button type="button" onClick={() => void analyze()} disabled={busy} className={`${btnPrimary} mt-3`}><Busy on={busy}>{!busy && <ScanSearch size={16} aria-hidden />}{busy ? t('app:ai.cv.analyzing') : t('app:ai.cv.analyze')}</Busy></button>
      <p className="mt-2 text-[12px] text-muted"><Link className="font-bold text-brand hover:underline" to="/cv">{t('app:ai.cv.uploadLink')}</Link></p>
      <Err msg={err} />
      {res && a && (
        <div className="mt-4 border-t border-line pt-4">
          <AiNotice source={res.source} notice={res.notice} />
          {a.headline && <p className="text-[18px] font-extrabold text-navy">{a.headline}</p>}
          {a.summary && <p className="mt-1 text-[14px] text-ink">{a.summary}</p>}
          {a.skills.length > 0 && <div className="mt-3"><h3 className="mb-1.5 text-[13px] font-extrabold text-navy">{t('app:cv.skills')}</h3><SkillChips neutral={a.skills} /><button type="button" onClick={() => void add()} disabled={busy} className={`${btnGhost} mt-2`}><Wand2 size={15} aria-hidden />{t('app:cv.applySkills')}</button></div>}
          {a.experience.length > 0 && <div className="mt-3"><h3 className="mb-1 text-[13px] font-extrabold text-navy">{t('app:cv.experience')}</h3><ul className="space-y-1.5">{a.experience.map((e, i) => <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-[13px]"><span className="font-bold">{e.role}</span>{e.company && ` · ${e.company}`}{e.period && <span className="text-muted"> · {e.period}</span>}{e.highlights.length > 0 && <ul className="mt-1 list-disc pl-5">{e.highlights.map((h, j) => <li key={j}>{h}</li>)}</ul>}</li>)}</ul></div>}
          {list(t('app:ai.cv.strengths'), a.strengths)}
          {list(t('app:ai.cv.improvements'), a.improvements)}
        </div>
      )}
    </Card>
  );
}

function LetterTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const lang = useLang();
  const { busy, err, run } = useRun();
  const [vacancyId, setVacancyId] = useState('');
  const [tone, setTone] = useState('formal');
  const [res, setRes] = useState<{ letter: string; source: Source; notice: string | null } | null>(null);
  const [text, setText] = useState('');
  const gen = async () => { const r = await run(() => api<{ letter: string; source: Source; notice: string | null }>('POST', '/api/ai/cover-letter', { vacancyId, tone, language: lang })); if (r) { setRes(r); setText(r.letter); } };
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast(t('app:ai.letter.copied')); } catch { /* clipboard blocked */ } };
  return (
    <Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <VacancyPicker value={vacancyId} onChange={setVacancyId} />
        <label className="block text-[12px] font-bold text-navy">{t('app:ai.letter.tone')}
          <select value={tone} onChange={(e) => setTone(e.target.value)} className={`${field} mt-0.5 font-normal`}>{['formal', 'friendly', 'concise'].map((k) => <option key={k} value={k}>{t(`app:ai.letter.${k}`)}</option>)}</select>
        </label>
      </div>
      <button type="button" onClick={() => void gen()} disabled={busy || !vacancyId} className={`${btnPrimary} mt-3`}><Busy on={busy}>{!busy && <FileText size={16} aria-hidden />}{busy ? t('app:ai.letter.generating') : t('app:ai.letter.generate')}</Busy></button>
      <Err msg={err} />
      {res && (
        <div className="mt-4 border-t border-line pt-4">
          <AiNotice source={res.source} notice={res.notice} />
          <label className="block text-[12px] font-bold text-navy" htmlFor="letter">{t('app:ai.letter.result')}</label>
          <textarea id="letter" value={text} onChange={(e) => setText(e.target.value)} rows={12} maxLength={2000} className="mt-0.5 w-full rounded-xl border-[1.5px] border-slate-300 bg-white p-3 text-[14px] leading-6" />
          <p className="text-[12px] text-muted">{t('app:ai.letter.edit')}</p>
          <div className="mt-2 flex gap-2"><button type="button" onClick={() => void copy()} className={btnGhost}><Copy size={15} aria-hidden />{t('app:ai.letter.copy')}</button><Link className={btnGhost} to={`/vacancies/${vacancyId}`}>{t('app:ai.letter.open')}</Link></div>
        </div>
      )}
    </Card>
  );
}

interface Q { question: string; focus: string }
interface Fb { score: number; strengths: string[]; improvements: string[]; sampleAnswer: string }
function InterviewTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const { busy, err, run } = useRun();
  const fb = useRun();
  const [vacancyId, setVacancyId] = useState('');
  const [qs, setQs] = useState<{ questions: Q[]; source: Source; notice: string | null } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<Record<number, Fb>>({});
  const start = async () => { const r = await run(() => api<{ questions: Q[]; source: Source; notice: string | null }>('POST', '/api/ai/interview/questions', { vacancyId, language: lang })); if (r) { setQs(r); setResult({}); setOpen(null); } };
  const send = async (i: number) => { const r = await fb.run(() => api<{ feedback: Fb }>('POST', '/api/ai/interview/feedback', { vacancyId, question: qs!.questions[i].question, answer, language: lang })); if (r) setResult((x) => ({ ...x, [i]: r.feedback })); };
  const n = Array.from(answer.trim()).length;
  return (
    <Card>
      <VacancyPicker value={vacancyId} onChange={setVacancyId} />
      <button type="button" onClick={() => void start()} disabled={busy || !vacancyId} className={`${btnPrimary} mt-3`}><Busy on={busy}>{!busy && <MessagesSquare size={16} aria-hidden />}{t('app:ai.interview.start')}</Busy></button>
      <Err msg={err} />
      {qs && (
        <div className="mt-4 border-t border-line pt-4">
          <AiNotice source={qs.source} notice={qs.notice} />
          <ol className="space-y-2">
            {qs.questions.map((q, i) => (
              <li key={i} className="rounded-xl bg-slate-50 p-3">
                <button type="button" aria-expanded={open === i} onClick={() => { setOpen(open === i ? null : i); setAnswer(''); }} className="w-full text-left text-[14px] font-bold text-navy">{i + 1}. {q.question}{q.focus && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-dark">{q.focus}</span>}</button>
                {open === i && (
                  <div className="mt-2">
                    <label className="sr-only" htmlFor={`ans-${i}`}>{t('app:ai.interview.answer')}</label>
                    <textarea id={`ans-${i}`} value={answer} onChange={(e) => setAnswer(e.target.value)} rows={5} maxLength={2000} placeholder={t('app:ai.interview.answer')} className="w-full rounded-xl border-[1.5px] border-slate-300 bg-white p-3 text-[14px]" />
                    <div className="mt-1 flex items-center gap-3"><button type="button" onClick={() => void send(i)} disabled={fb.busy || n < 20} className={btnPrimary}><Busy on={fb.busy}>{t('app:ai.interview.getFeedback')}</Busy></button>{n < 20 && <span className="text-[12px] text-muted">{t('app:ai.interview.tooShort')}</span>}</div>
                    <Err msg={fb.err} />
                  </div>
                )}
                {result[i] && (
                  <div className="mt-2 space-y-1 rounded-xl bg-white p-3 text-[13px] ring-1 ring-line">
                    <p className="font-extrabold text-navy">{t('app:ai.interview.score', { n: result[i].score })}</p>
                    {result[i].strengths.length > 0 && <p><b>{t('app:ai.interview.strengths')}:</b> {result[i].strengths.join('; ')}</p>}
                    {result[i].improvements.length > 0 && <p><b>{t('app:ai.interview.improve')}:</b> {result[i].improvements.join('; ')}</p>}
                    {result[i].sampleAnswer && <p className="rounded-lg bg-brand-50 p-2"><b>{t('app:ai.interview.sample')}:</b> {result[i].sampleAnswer}</p>}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}

export function AiStudio() {
  const { t } = useTranslation();
  usePageTitle('nav.ai');
  const [tab, setTab] = useState<'cv' | 'letter' | 'interview'>('cv');
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('app:ai.title')} subtitle={t('app:ai.subtitle')} />
      <AiGate>
        <div role="tablist" aria-label={t('app:ai.title')} className="mb-4 flex gap-1 border-b border-line">
          {(['cv', 'letter', 'interview'] as const).map((k) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-[3px] px-3.5 py-2 text-[14px] font-bold ${tab === k ? 'border-orange text-navy' : 'border-transparent text-muted hover:text-navy'}`}>{t(`app:ai.tabs.${k}`)}</button>
          ))}
        </div>
        <div role="tabpanel">{tab === 'cv' ? <CvTab /> : tab === 'letter' ? <LetterTab /> : <InterviewTab />}</div>
      </AiGate>
    </div>
  );
}
