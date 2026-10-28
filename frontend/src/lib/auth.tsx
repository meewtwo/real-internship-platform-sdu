import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Language, Role } from '@sdu/shared';
import i18n from '../i18n';
import { api, ApiError } from './api';

export interface User {
  id: string; role: Role; status: 'unverified' | 'active' | 'pending' | 'blocked'; email: string;
  studentId: string | null; phone: string | null; preferredLanguage: Language;
}
interface AuthCtx {
  user: User | null; loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api<{ user: User }>('GET', '/api/auth/me')
      .then((r) => { if (alive) { setUserState(r.user); void i18n.changeLanguage(r.user.preferredLanguage); } })
      .catch((e) => { if (!(e instanceof ApiError) || e.status !== 401) console.warn('me failed'); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  // the account status changes on the server (an admin approves the company): re-read it when the tab regains focus and, while the company
  // is waiting, once a minute — otherwise the employer keeps seeing "awaiting approval" and no Publish button until signing in again
  const waiting = user?.role === 'employer' && user.status !== 'active';
  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      api<{ user: User }>('GET', '/api/auth/me')
        .then((r) => setUserState((cur) => (cur && JSON.stringify(cur) === JSON.stringify(r.user) ? cur : r.user)))
        .catch((e) => { if (e instanceof ApiError && e.status === 401) setUserState(null); });
    };
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const timer = waiting ? setInterval(refresh, 60_000) : undefined;
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); clearInterval(timer); };
  }, [!!user, waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const setUser = useCallback((u: User | null) => {
    setUserState(u);
    if (u) void i18n.changeLanguage(u.preferredLanguage); // the saved preference wins after sign-in
  }, []);
  const logout = useCallback(async () => {
    try { await api('POST', '/api/auth/logout'); } catch { /* cookie may already be gone */ }
    setUserState(null);
  }, []);
  const value = useMemo(() => ({ user, loading, setUser, logout }), [user, loading, setUser, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
