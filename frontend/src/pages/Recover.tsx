import { AtSign, CheckCircle2, Hash, Loader2, Lock } from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { validateIdentifier, validateReset, type PublicRole } from '@sdu/shared';
import { CodeBoxes, PasswordChecklist, PasswordField } from '../components/Controls';
import { TextField } from '../components/Field';
import { api, ApiError } from '../lib/api';
import { apiErrText, errText } from '../lib/errors';
import { useAppForm } from '../lib/form';

const DEFAULTS = { password: '', confirmPassword: '' };
type V = typeof DEFAULTS;

export function Recover({ role }: { role: PublicRole }) {
  const { t, i18n } = useTranslation();
  const [stage, setStage] = useState<'id' | 'reset' | 'done'>('id');
  const [identifier, setIdentifier] = useState('');
  const [touched, setTouched] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const idCheck = validateIdentifier(role, identifier);
  const validate = useCallback((v: V) => validateReset({ role, identifier: idCheck.ok ? idCheck.value : identifier, code: code.length === 6 ? code : '000000', ...v }, { studentId: role === 'student' && idCheck.ok ? idCheck.value : undefined, email: role === 'employer' && idCheck.ok ? idCheck.value : undefined }), [role, identifier, idCheck, code]);
  const form = useAppForm<V>({ defaults: DEFAULTS, validate });
  const { values: v } = form;

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!idCheck.ok || busy) return;
    setBusy(true); setError('');
    try {
      await api('POST', '/api/auth/forgot', { role, identifier: idCheck.value, language: i18n.language });
      setStage('reset');
    } catch (err) { setError(apiErrText(t, err)); } finally { setBusy(false); }
  };

  const reset = async (e: FormEvent) => {
    e.preventDefault();
    form.markSubmitted();
    if (busy || !idCheck.ok || code.length !== 6 || !form.valid) return;
    setBusy(true); setError('');
    try {
      await api('POST', '/api/auth/reset', { role, identifier: idCheck.value, code, password: v.password, confirmPassword: v.confirmPassword });
      form.reset(); setStage('done');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) { form.setServerErrors(err.fields); if (err.fields.code) setError(errText(t, err.fields.code)); }
      else setError(apiErrText(t, err));
    } finally { setBusy(false); }
  };

  if (stage === 'done') {
    return (
      <div className="py-4 text-center">
        <span className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-full bg-lime text-navy"><CheckCircle2 size={30} aria-hidden /></span>
        <p role="status" className="mb-4 text-[14px] font-semibold text-navy">{t('auth:recover.done')}</p>
        <Link to={`/login?role=${role}`} className="inline-flex h-11 items-center justify-center rounded-lg bg-navy hover:bg-navy-deep btn-press px-6 text-[15px] font-extrabold text-white">{t('auth:recover.toLogin')}</Link>
      </div>
    );
  }
  const idErr = touched && !idCheck.ok ? idCheck.code : undefined;
  const idField = role === 'student'
    ? <TextField name="studentId" label={t('auth:fields.identifierStudent')} value={identifier} icon={<Hash size={16} />} inputMode="numeric" maxLength={9} autoComplete="username" placeholder={t('auth:placeholders.studentId')} onChange={(x) => setIdentifier(x.replace(/[^0-9]/g, '').slice(0, 9))} onBlur={() => setTouched(true)} error={idErr} valid={idCheck.ok} errLines={1} disabled={stage === 'reset'} />
    : <TextField name="email" label={t('auth:fields.identifierEmployer')} value={identifier} icon={<AtSign size={16} />} type="email" inputMode="email" maxLength={254} autoComplete="username" placeholder={t('auth:placeholders.workEmail')} onChange={(x) => setIdentifier(x.replace(/\s/g, ''))} onBlur={() => setTouched(true)} error={idErr} valid={idCheck.ok} errLines={1} disabled={stage === 'reset'} />;

  return (
    <div>
      <h1 className="font-display text-[28px] font-bold leading-tight text-navy sm:text-[36px]">{t('auth:recover.title')}</h1>
      <p className="mb-3 mt-1 text-[14.5px] text-muted sm:mb-5">{t(stage === 'id' ? (role === 'student' ? 'auth:recover.subtitleStudent' : 'auth:recover.subtitleEmployer') : 'auth:recover.step2')}</p>
      {error && <p role="alert" className="mb-2 rounded-xl bg-danger/10 px-3 py-1.5 text-[12px] font-semibold text-danger-text">{error}</p>}
      {stage === 'id' ? (
        <form onSubmit={(e) => void sendCode(e)} noValidate>
          {idField}
          <button type="submit" disabled={!idCheck.ok || busy} className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-navy hover:bg-navy-deep btn-press text-[15px] font-extrabold text-white   disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none">
            {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden />{t('auth:recover.sending')}</> : t('auth:recover.sendCode')}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void reset(e)} noValidate>
          <p role="status" className="mb-2 rounded-xl bg-brand-50 px-3 py-1.5 text-[12px] text-navy">{t('auth:recover.generic')}</p>
          {idField}
          <div className="mb-2"><CodeBoxes value={code} onChange={(c) => { setCode(c); setError(''); }} invalid={!!error} /></div>
          <PasswordField name="password" label={t('auth:fields.newPassword')} value={v.password} icon={<Lock size={16} />} autoComplete="new-password" errLines={1} onChange={(x) => { form.set('password', x); if (v.confirmPassword) form.touch('confirmPassword'); }} onBlur={() => form.touch('password')} error={form.shown('password')} valid={!form.errors.password} />
          <PasswordField name="confirmPassword" label={t('auth:fields.confirmPassword')} value={v.confirmPassword} icon={<Lock size={16} />} autoComplete="new-password" errLines={1} onChange={(x) => form.set('confirmPassword', x)} onBlur={() => form.touch('confirmPassword')} error={form.shown('confirmPassword')} valid={!form.errors.confirmPassword && v.password !== ''} />
          <div className="mb-3"><PasswordChecklist password={v.password} ctx={{ email: role === 'employer' ? identifier : undefined, studentId: role === 'student' ? identifier : undefined }} compact /></div>
          <button type="submit" disabled={busy || code.length !== 6 || !form.valid} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-navy hover:bg-navy-deep btn-press text-[15px] font-extrabold text-white   disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none">
            {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden />{t('auth:recover.submitting')}</> : t('auth:recover.submit')}
          </button>
          <button type="button" onClick={() => { setStage('id'); setCode(''); setError(''); }} className="mx-auto mt-2 block text-[12px] font-semibold text-muted underline underline-offset-2 hover:text-navy">{t('auth:recover.back')}</button>
        </form>
      )}
    </div>
  );
}
