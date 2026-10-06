import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { PublicRole } from '@sdu/shared';
import { Segmented } from '../components/Controls';
import { Shell } from '../components/Shell';
import { useAuth, type User } from '../lib/auth';
import { usePageTitle } from '../lib/usePageTitle';
import { useWizardMode } from '../lib/useWizard';
import { EmployerRegister } from './EmployerRegister';
import { LoginForm } from './LoginForm';
import { Recover } from './Recover';
import { StudentRegister } from './StudentRegister';
import { VerifyCode, type PendingVerify } from './VerifyCode';

type Tab = 'login' | 'register' | 'recover';
const PENDING_KEY = 'pendingVerify';

function loadPending(): PendingVerify | null {
  try { const r = sessionStorage.getItem(PENDING_KEY); return r ? (JSON.parse(r) as PendingVerify) : null; } catch { return null; }
}
function savePending(p: PendingVerify | null) {
  try { if (p) sessionStorage.setItem(PENDING_KEY, JSON.stringify(p)); else sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}

export function AuthPage({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const role: PublicRole = params.get('role') === 'employer' ? 'employer' : 'student';
  const wizard = useWizardMode();
  const [pending, setPendingState] = useState<PendingVerify | null>(loadPending);
  const setPending = (p: PendingVerify | null) => { savePending(p); setPendingState(p); };
  usePageTitle(pending ? 'titles.verify' : tab === 'login' ? 'titles.login' : tab === 'register' ? 'titles.register' : 'titles.recover');
  useEffect(() => { /* keep ?role stable across tab switches */ }, []);

  if (user) return <Navigate to="/dashboard" replace />;

  const done = (u: User) => { setPending(null); setUser(u); navigate('/dashboard', { replace: true }); };
  const wide = tab === 'register' && !pending;
  const setRole = (r: PublicRole) => setParams({ role: r }, { replace: true });
  const q = `?role=${role}`;
  const tabCls = (on: boolean) => `flex h-9 min-w-0 flex-auto items-center justify-center rounded-md px-2 text-center text-[12.5px] font-extrabold leading-none transition-colors sm:text-[13px] ${on ? 'bg-brand-dark text-white shadow' : 'text-navy hover:bg-white/80'}`;

  return (
    <Shell wide={wide}>
      <div className={`flex w-full items-center justify-center ${wide ? 'max-w-[720px]' : 'max-w-[520px]'}`}>
        <div className={`glass fade-up w-full rounded-2xl ${wide ? 'max-w-[680px] p-3.5 sm:p-6' : 'field-lg max-w-[440px] p-3 sm:p-7'}`}>
          {!pending && (
            <>
              {tab === 'recover' ? (
                <Link to={`/login${q}`} className="mb-4 inline-block text-[13.5px] font-bold text-brand hover:underline">{t('app:auth.backToLogin')}</Link>
              ) : (
              <nav aria-label={t('auth:tabs.label')} className={`${wide ? "mb-2.5" : "mb-4"} flex gap-0.5 rounded-lg bg-brand-50 p-0.5 ring-1 ring-inset ring-navy/10`}>
                <Link to={`/login${q}`} aria-current={tab === 'login' ? 'page' : undefined} className={tabCls(tab === 'login')}>{t('auth:tabs.signIn')}</Link>
                <Link to={`/register${q}`} aria-current={tab === 'register' ? 'page' : undefined} className={tabCls(tab === 'register')}>{t('auth:tabs.signUp')}</Link>
              </nav>
              )}
              <div className={`mb-2.5 flex items-center gap-3 ${tab === 'register' ? 'justify-between' : ''}`}>
                {tab === 'register' && <h1 className="sr-only min-w-0 truncate text-[17px] font-extrabold leading-tight text-navy sm:not-sr-only">{t(role === 'student' ? 'auth:register.titleStudent' : 'auth:register.titleEmployer')}</h1>}
                <Segmented name="role" label={t('auth:role.label')} value={role} onChange={setRole} size="sm" className={tab === 'register' ? 'max-w-[15rem] shrink-0' : ''}
                  options={[{ value: 'student', label: t('auth:role.student') }, { value: 'employer', label: t('auth:role.employer') }]} />
              </div>
            </>
          )}
          {pending ? (
            <VerifyCode pending={pending} onVerified={done} onPendingChange={setPending} onBack={() => setPending(null)} />
          ) : tab === 'login' ? (
            <LoginForm key={role} role={role} onLoggedIn={done} onNeedVerify={setPending} />
          ) : tab === 'register' ? (
            role === 'student' ? <StudentRegister onRegistered={setPending} /> : <EmployerRegister onRegistered={setPending} />
          ) : (
            <Recover key={role} role={role} />
          )}
          {tab === 'register' && !pending && !wizard && (
            <p className="mt-2 text-center text-[12px] text-muted">{t('auth:register.haveAccount')}{' '}
              <Link to={`/login${q}`} className="font-bold text-brand underline-offset-2 hover:underline">{t('auth:register.signInLink')}</Link>
              {role === 'employer' && <span className="mt-0.5 block text-[11px]">{t('auth:register.employerPending')}</span>}
            </p>
          )}
        </div>
      </div>
    </Shell>
  );
}
