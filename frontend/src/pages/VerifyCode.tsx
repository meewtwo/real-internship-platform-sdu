import { Loader2, MailCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeBoxes } from '../components/Controls';
import { api, ApiError } from '../lib/api';
import type { User } from '../lib/auth';
import { apiErrText, errText } from '../lib/errors';

export interface PendingVerify { role: 'student' | 'employer'; identifier: string; email?: string; resendAt: number }

export function VerifyCode({ pending, onVerified, onBack, onPendingChange }: {
  pending: PendingVerify; onVerified: (u: User) => void; onBack: () => void; onPendingChange: (p: PendingVerify) => void;
}) {
  const { t, i18n } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const busyRef = useRef(false);
  const secondsLeft = Math.max(0, Math.ceil((pending.resendAt - now) / 1000));

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const verify = useCallback(async (c: string) => {
    if (busyRef.current || c.length !== 6) return;
    busyRef.current = true; setBusy(true); setError(''); setInfo('');
    try {
      const r = await api<{ user: User }>('POST', '/api/auth/verify', { role: pending.role, identifier: pending.identifier, code: c });
      onVerified(r.user);
    } catch (e) {
      setError(e instanceof ApiError && e.fields.code ? errText(t, e.fields.code) : apiErrText(t, e));
      if (e instanceof ApiError && e.code !== 'CODE_INVALID') setCode('');
    } finally { busyRef.current = false; setBusy(false); }
  }, [pending, onVerified, t]);

  const resend = async () => {
    if (secondsLeft > 0 || busy) return;
    setError(''); setInfo(''); setCode('');
    try {
      const r = await api<{ resendAfter: number }>('POST', '/api/auth/resend-code', { role: pending.role, identifier: pending.identifier, language: i18n.language });
      onPendingChange({ ...pending, resendAt: Date.now() + r.resendAfter * 1000 });
      setNow(Date.now()); setInfo(t('auth:verify.sent'));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RESEND_COOLDOWN' && e.retryAfter) onPendingChange({ ...pending, resendAt: Date.now() + e.retryAfter * 1000 });
      setError(apiErrText(t, e));
    }
  };

  return (
    <div className="mx-auto w-full max-w-sm text-center">
      <span className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand"><MailCheck size={26} aria-hidden /></span>
      <h1 className="text-xl font-extrabold text-navy">{t('auth:verify.title')}</h1>
      <p className="mx-auto mb-4 mt-1 max-w-xs text-[13px] leading-5 text-muted">
        {pending.email ? t('auth:verify.subtitle', { email: pending.email }) : t('auth:verify.subtitleNoEmail')}
      </p>
      <form onSubmit={(e) => { e.preventDefault(); if (code.length === 6) void verify(code); }} noValidate>
        <CodeBoxes value={code} onChange={(c) => { setCode(c); setError(''); }} invalid={!!error} disabled={busy} onComplete={(c) => void verify(c)} />
        <p role="alert" aria-live="assertive" className={`mt-2 min-h-[2.2rem] text-[12px] leading-[15px] ${error ? 'font-semibold text-danger-text' : 'text-ok-text'}`}>{error || info}</p>
        <button type="submit" disabled={code.length !== 6 || busy}
          className="mx-auto flex h-11 w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-navy hover:bg-navy-deep btn-press text-[15px] font-extrabold text-white   disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none">
          {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden />{t('auth:verify.submitting')}</> : t('auth:verify.submit')}
        </button>
      </form>
      <p className="mt-3 text-[13px] text-muted">
        {t('auth:verify.didntGet')}{' '}
        <button type="button" onClick={() => void resend()} disabled={secondsLeft > 0 || busy} aria-live="polite"
          className="font-bold text-brand underline underline-offset-2 enabled:hover:text-brand-dark disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline">
          {secondsLeft > 0 ? t('auth:verify.resendIn', { s: secondsLeft }) : t('auth:verify.resend')}
        </button>
      </p>
      <button type="button" onClick={onBack} className="mt-1 text-[12px] font-semibold text-muted underline underline-offset-2 hover:text-navy">{t('auth:verify.changeData')}</button>
    </div>
  );
}
