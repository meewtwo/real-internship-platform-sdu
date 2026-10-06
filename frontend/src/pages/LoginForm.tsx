import { AtSign, Hash, Loader2, Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { validateIdentifier, type PublicRole } from '@sdu/shared';
import { PasswordField } from '../components/Controls';
import { TextField } from '../components/Field';
import { api, ApiError } from '../lib/api';
import type { User } from '../lib/auth';
import { apiErrText } from '../lib/errors';
import type { PendingVerify } from './VerifyCode';

export function LoginForm({ role, onLoggedIn, onNeedVerify }: { role: PublicRole; onLoggedIn: (u: User) => void; onNeedVerify: (p: PendingVerify) => void }) {
  const { t, i18n } = useTranslation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [touched, setTouched] = useState({ id: false, pw: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);

  const idCheck = validateIdentifier(role, identifier);
  const idError = touched.id && !idCheck.ok ? idCheck.code : undefined;
  const pwError = touched.pw && password === '' ? 'REQUIRED' : undefined;
  const canSubmit = idCheck.ok && password !== '' && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) { setTouched({ id: true, pw: true }); return; }
    setBusy(true); setError(''); setUnverified(false);
    try {
      const r = await api<{ user: User }>('POST', '/api/auth/login', { role, identifier: idCheck.ok ? idCheck.value : identifier, password, remember });
      onLoggedIn(r.user);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') setUnverified(true);
      else setError(apiErrText(t, err));
    } finally { setBusy(false); }
  };

  const sendNewCode = async () => {
    if (!idCheck.ok) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ resendAfter: number }>('POST', '/api/auth/resend-code', { role, identifier: idCheck.value, language: i18n.language });
      onNeedVerify({ role, identifier: idCheck.value, email: role === 'employer' ? idCheck.value : undefined, resendAt: Date.now() + r.resendAfter * 1000 });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RESEND_COOLDOWN') onNeedVerify({ role, identifier: idCheck.value, email: role === 'employer' ? idCheck.value : undefined, resendAt: Date.now() + (err.retryAfter ?? 60) * 1000 });
      else setError(apiErrText(t, err));
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <h1 className="font-display text-[28px] font-bold leading-tight text-navy sm:text-[36px]">{t(role === 'student' ? 'auth:login.titleStudent' : 'auth:login.titleEmployer')}</h1>
      <p className="mb-3 mt-1 text-[14.5px] text-muted sm:mb-5">{t('auth:login.subtitle')}</p>
      {(error || unverified) && (
        <div role="alert" className={`mb-2 rounded-xl px-3 py-2 text-[12px] leading-4 ${unverified ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-300' : 'bg-danger/10 font-semibold text-danger-text'}`}>
          {unverified ? (
            <>
              <strong className="block">{t('auth:login.unverifiedTitle')}</strong>
              {t('auth:login.unverifiedText')}
              <button type="button" onClick={() => void sendNewCode()} disabled={busy} className="mt-1 block font-bold text-brand underline underline-offset-2">{t('auth:login.sendCode')}</button>
            </>
          ) : error}
        </div>
      )}
      {role === 'student' ? (
        <TextField name="studentId" label={t('auth:fields.identifierStudent')} value={identifier} icon={<Hash size={16} />} inputMode="numeric" maxLength={9} autoComplete="username" placeholder={t('auth:placeholders.studentId')}
          onChange={(v) => setIdentifier(v.replace(/[^0-9]/g, '').slice(0, 9))} onBlur={() => setTouched((s) => ({ ...s, id: true }))} error={idError} valid={idCheck.ok} errLines={1} />
      ) : (
        <TextField name="email" label={t('auth:fields.identifierEmployer')} value={identifier} icon={<AtSign size={16} />} type="email" inputMode="email" maxLength={254} autoComplete="username" placeholder={t('auth:placeholders.workEmail')}
          onChange={(v) => setIdentifier(v.replace(/\s/g, ''))} onBlur={() => setTouched((s) => ({ ...s, id: true }))} error={idError} valid={idCheck.ok} errLines={1} />
      )}
      <PasswordField name="password" label={t('auth:fields.password')} value={password} icon={<Lock size={16} />} autoComplete="current-password" maxLength={128}
        onChange={setPassword} onBlur={() => setTouched((s) => ({ ...s, pw: true }))} error={pwError} errLines={1} />
      <label className="mb-4 mt-1 flex cursor-pointer items-center gap-2 text-[14px] text-navy">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-navy" />{t('auth:login.remember')}
      </label>
      <button type="submit" disabled={!canSubmit} aria-disabled={!canSubmit}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-navy hover:bg-navy-deep btn-press text-[15px] font-extrabold text-white   disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none">
        {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden />{t('auth:login.submitting')}</> : t('auth:login.submit')}
      </button>
      {role === 'employer' && <p className="mt-2 text-center text-[11px] text-muted">{t('auth:login.adminHint')}</p>}
      <div className="mt-5 space-y-2 border-t border-line pt-4 text-center text-[14px]">
        <p className="text-muted">{t('auth:login.noAccount')}{' '}<Link to={`/register?role=${role}`} className="font-bold text-brand underline-offset-2 hover:underline">{t('auth:login.registerLink')}</Link></p>
        <p><Link to={`/recover?role=${role}`} className="font-semibold text-muted underline decoration-line underline-offset-4 hover:text-navy">{t('auth:login.forgot')}</Link></p>
      </div>
    </form>
  );
}
