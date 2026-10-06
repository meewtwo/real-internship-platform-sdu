import { Lightbulb, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { apiErrText } from '../lib/errors';
import { AiGate, AiNotice } from './AiGate';
import { btnGhost } from './ui';

interface Explain { explanation: { summary: string; strengths: string[]; gaps: string[]; nextSteps: string[] }; source: 'ai' | 'rules'; notice: string | null }

function Panel({ url }: { url: string }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Explain | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try { setData(await api<Explain>('GET', `${url}${url.includes('?') ? '&' : '?'}language=${i18n.language.slice(0, 2)}`)); } catch (e) { setErr(apiErrText(t, e)); } finally { setBusy(false); }
  };
  const list = (title: string, items: string[]) => items.length > 0 && <div><p className="mb-0.5 text-[12px] font-extrabold text-navy">{title}</p><ul className="list-disc space-y-0.5 pl-5 text-[13px] text-ink">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => void run()} disabled={busy} className={btnGhost}>{busy ? <Loader2 className="animate-spin" size={15} aria-hidden /> : <Lightbulb size={15} aria-hidden />}{busy ? t('app:ai.explain.loading') : t('app:ai.explain.button')}</button>
      {err && <p role="alert" className="text-[13px] font-semibold text-danger-text">{err}</p>}
      {data && (
        <div className="space-y-2 rounded-xl bg-brand-50/60 p-3" role="region" aria-label={t('app:ai.explain.button')}>
          <AiNotice source={data.source} notice={data.notice} />
          <p className="text-[14px] font-semibold text-navy">{data.explanation.summary}</p>
          {list(t('app:ai.explain.strengths'), data.explanation.strengths)}
          {list(t('app:ai.explain.gaps'), data.explanation.gaps)}
          {list(t('app:ai.explain.next'), data.explanation.nextSteps)}
        </div>
      )}
    </div>
  );
}
/** "Why this match?" in plain language (student: /match-explain/:vacancyId, employer: /candidate-explain/:applicationId). */
export const ExplainPanel = ({ url }: { url: string }) => <AiGate compact><Panel url={url} /></AiGate>;
