import { ShieldCheck, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { apiErrText } from '../lib/errors';
import { useApi } from '../lib/useApi';
import { Card, btnGhost, btnPrimary } from './ui';

interface Consent { consent: boolean; available: boolean }

/** Nothing AI-related renders (or is requested) until the user has explicitly opted in; consent can be withdrawn at any time. */
export function AiGate({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  const { t } = useTranslation();
  const { data, loading, setData } = useApi<Consent>('/api/ai/consent');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = async (accept: boolean) => {
    setBusy(true); setErr('');
    try { setData(await api<Consent>('PUT', '/api/ai/consent', { accept })); } catch (e) { setErr(apiErrText(t, e)); } finally { setBusy(false); }
  };
  if (loading && !data) return <div role="status" aria-label={t('loading')} className="skeleton h-24" />;
  if (!data) return null;
  if (!data.consent) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand"><ShieldCheck size={20} aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-extrabold text-navy">{t('app:ai.consent.title')}</h2>
            <p className="mt-1 text-[14px] text-ink">{t('app:ai.consent.text')}</p>
            <p className="mt-1 text-[12px] text-muted">{data.available ? t('app:ai.consent.privacy') : t('app:ai.consent.rulesMode')}</p>
            {err && <p role="alert" className="mt-2 text-[13px] font-semibold text-danger-text">{err}</p>}
            <button type="button" disabled={busy} onClick={() => void set(true)} className={`${btnPrimary} mt-3`}><Sparkles size={16} aria-hidden />{t('app:ai.consent.allow')}</button>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <div>
      {!compact && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span className={`rounded-full px-2 py-0.5 font-bold ${data.available ? 'bg-ok/15 text-ok-text' : 'bg-slate-100 text-slate-700'}`}>{data.available ? t('app:ai.consent.on') : t('app:ai.consent.rulesMode')}</span>
          <button type="button" disabled={busy} onClick={() => void set(false)} className={`${btnGhost} !h-7 !px-2.5 !text-[12px]`}>{t('app:ai.consent.revoke')}</button>
        </p>
      )}
      {children}
    </div>
  );
}

export function AiNotice({ source, notice }: { source: 'ai' | 'rules'; notice: string | null }) {
  const { t } = useTranslation();
  return (
    <p className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
      <span className={`rounded-full px-2 py-0.5 font-bold ${source === 'ai' ? 'bg-brand-50 text-brand-dark' : 'bg-slate-100 text-slate-700'}`}>{t(`app:ai.source.${source}`)}</span>
      {notice && <span className="text-muted">{t(`app:ai.notice.${notice}`)}</span>}
    </p>
  );
}
