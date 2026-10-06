import { Loader2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { apiErrText } from '../lib/errors';
import { AiGate, AiNotice } from './AiGate';
import { btnGhost } from './ui';

export interface VacancyDraft {
  title?: string; description?: string; kind?: string; industry?: string; city?: string; workFormat?: string; requiredSkills?: string[];
  salaryMin?: number; salaryMax?: number; minGpa?: string;
}
interface Res { draft: VacancyDraft; missing: string[]; source: 'ai' | 'rules'; notice: string | null }

function Box({ onDraft }: { onDraft: (d: VacancyDraft) => void }) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<Res | null>(null);
  const n = Array.from(text.trim()).length;
  const run = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api<Res>('POST', '/api/ai/vacancy/parse', { text, language: i18n.language.slice(0, 2) });
      setRes(r); onDraft(r.draft);
    } catch (e) { setErr(apiErrText(t, e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-muted">{t('app:ai.autofill.hint')}</p>
      <label className="sr-only" htmlFor="autofill-text">{t('app:ai.autofill.title')}</label>
      <textarea id="autofill-text" value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={8000} placeholder={t('app:ai.autofill.placeholder')} className="w-full rounded-xl border-[1.5px] border-slate-300 bg-white p-3 text-[14px]" />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void run()} disabled={busy || n < 40} className={btnGhost}>{busy ? <Loader2 className="animate-spin" size={15} aria-hidden /> : <Wand2 size={15} aria-hidden />}{busy ? t('app:ai.autofill.working') : t('app:ai.autofill.button')}</button>
        {n < 40 && <span className="text-[12px] text-muted">{t('app:ai.autofill.tooShort')}</span>}
      </div>
      {err && <p role="alert" className="text-[13px] font-semibold text-danger-text">{err}</p>}
      {res && (
        <div role="status" className="rounded-xl bg-brand-50/60 p-3">
          <AiNotice source={res.source} notice={res.notice} />
          <p className="text-[13px] font-semibold text-navy">{t('app:ai.autofill.done')}</p>
          {res.missing.length > 0 && <p className="mt-0.5 text-[12px] text-muted">{t('app:ai.autofill.missing', { fields: res.missing.map((f) => t(`app:ai.autofill.f.${f}`)).join(', ') })}</p>}
        </div>
      )}
    </div>
  );
}

/** Employer: paste a job posting → the form is pre-filled (every field is still validated and editable before saving). */
export function VacancyAutofill({ onDraft }: { onDraft: (d: VacancyDraft) => void }) {
  const { t } = useTranslation();
  return (
    <details className="mb-4 rounded-2xl border border-line bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-[15px] font-extrabold text-navy">{t('app:ai.autofill.title')}</summary>
      <div className="mt-3"><AiGate compact><Box onDraft={onDraft} /></AiGate></div>
    </details>
  );
}
