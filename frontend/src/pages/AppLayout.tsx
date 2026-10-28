import { Bell, ChevronDown, LogOut, UserRound } from 'lucide-react';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { Role } from '@sdu/shared';
import { Logo } from '../components/Brand';
import { LangSwitcher } from '../components/LangSwitcher';
import { MyAvatar } from '../components/Avatar';
import { api } from '../lib/api';
import { clearAvatarState, loadAvatar } from '../lib/avatar';
import { useAuth } from '../lib/auth';

interface Item { key: string; to: string; matches: string[] }
/** Short main navigation: related pages are grouped behind section tabs (SubTabs). Profile lives in the account menu. */
const NAV: Record<Role, Item[]> = {
  student: [
    { key: 'dashboard', to: '/dashboard', matches: ['/dashboard'] },
    { key: 'vacancies', to: '/vacancies', matches: ['/vacancies', '/recommendations', '/favorites'] },
    { key: 'applications', to: '/applications', matches: ['/applications'] },
    { key: 'resume', to: '/resume/builder', matches: ['/resume', '/cv'] },
    { key: 'messages', to: '/messages', matches: ['/messages'] },
    { key: 'ai', to: '/ai', matches: ['/ai'] },
  ],
  employer: [
    { key: 'dashboard', to: '/dashboard', matches: ['/dashboard'] },
    { key: 'myVacancies', to: '/vacancies/mine', matches: ['/vacancies'] },
    { key: 'candidates', to: '/candidates', matches: ['/candidates'] },
    { key: 'messages', to: '/messages', matches: ['/messages'] },
  ],
  admin: [
    { key: 'dashboard', to: '/dashboard', matches: ['/dashboard'] },
    { key: 'companies', to: '/admin/companies', matches: ['/admin/companies', '/admin/vacancies'] },
    { key: 'analytics', to: '/analytics', matches: ['/analytics'] },
  ],
};

function AccountMenu({ userId, initial, email, onLogout }: { userId: string; initial: string; email: string; onLogout: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('app:menu.account')} onClick={() => setOpen((o) => !o)}
        className="btn-press flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white pl-1 pr-2 hover:bg-brand-50">
        <MyAvatar userId={userId} initial={initial} />
        <ChevronDown size={14} aria-hidden className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className="pop-in absolute right-0 top-11 z-40 w-60 overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          <p className="truncate border-b border-line px-3.5 py-2.5 text-[12px] text-muted">{email}</p>
          {user?.role !== 'admin' && <Link role="menuitem" to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3.5 py-2.5 text-[14px] font-semibold text-ink hover:bg-brand-50"><UserRound size={16} aria-hidden />{t('nav.profile')}</Link>}
          <button role="menuitem" type="button" onClick={onLogout} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[14px] font-semibold text-danger-text hover:bg-danger/5"><LogOut size={16} aria-hidden />{t('logout')}</button>
        </div>
      )}
    </div>
  );
}

/** App shell (hh-style): white header, 3–4 main sections with an orange active marker, bell, language, account menu. */
export function AppLayout() {
  const { t } = useTranslation();
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [unread, setUnread] = useState(0);
  const [initial, setInitial] = useState('');
  const refreshUnread = useCallback(() => {
    api<{ unread: number }>('GET', '/api/notifications/count').then((r) => setUnread(r.unread)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!user) return;
    refreshUnread();
    const id = setInterval(refreshUnread, 30_000);
    return () => clearInterval(id);
  }, [user, refreshUnread, loc.pathname]);
  useEffect(() => { if (user) void loadAvatar(); else clearAvatarState(); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!user) return;
    api<{ profile: { name?: string; contactName?: string } | null }>('GET', '/api/profile').then((r) => setInitial((r.profile?.name ?? r.profile?.contactName ?? user.email).charAt(0).toUpperCase())).catch(() => setInitial(user.email.charAt(0).toUpperCase()));
  }, [user]);

  if (loading) return <div className="grid min-h-dvh place-items-center bg-page"><div className="skeleton h-10 w-48" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  const active = (i: Item) => i.matches.some((m) => loc.pathname === m || loc.pathname.startsWith(`${m}/`));
  return (
    <div className="min-h-dvh bg-page">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 sm:px-6">
          <NavLink to="/dashboard" aria-label={t('appName')} className="py-2"><Logo /></NavLink>
          <nav aria-label={t('nav.menu')} className="ml-3 hidden flex-1 gap-1 md:flex">
            {NAV[user.role].map((i) => (
              <NavLink key={i.key} to={i.to} aria-current={active(i) ? 'page' : undefined}
                className={`relative px-3.5 py-[1.1rem] text-[14.5px] font-semibold transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:origin-left after:rounded-full after:bg-orange after:transition-transform ${active(i) ? 'text-navy after:scale-x-100' : 'text-muted after:scale-x-0 hover:text-navy hover:after:scale-x-50'}`}>{t(`nav.${i.key}`)}</NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LangSwitcher dark={false} />
            <NavLink to="/notifications" aria-label={t('app:notif.bell', { n: unread })} className="relative grid h-9 w-9 place-items-center rounded-lg border border-line bg-white text-navy hover:bg-brand-50">
              <Bell size={17} aria-hidden className={unread > 0 ? 'origin-top animate-[wiggle_1.2s_ease-in-out_2]' : ''} />
              {unread > 0 && <span className="pop-in absolute -right-1.5 -top-1.5 grid min-w-[1.15rem] place-items-center rounded-full bg-orange-dark px-1 text-[11px] font-extrabold leading-[1.15rem] text-white">{unread > 99 ? '99+' : unread}</span>}
            </NavLink>
            <AccountMenu userId={user.id} initial={initial || '·'} email={user.email} onLogout={async () => { await logout(); navigate('/'); }} />
          </div>
        </div>
        <nav aria-label={`${t('nav.menu')} (mobile)`} className="flex gap-1 overflow-x-auto border-t border-line px-3 md:hidden">
          {NAV[user.role].map((i) => (
            <NavLink key={i.key} to={i.to} className={`whitespace-nowrap border-b-[3px] px-3 py-2.5 text-[14px] font-semibold ${active(i) ? 'border-orange text-navy' : 'border-transparent text-muted'}`}>{t(`nav.${i.key}`)}</NavLink>
          ))}
        </nav>
      </header>
      <main id="main" key={loc.pathname} className="page-enter mx-auto max-w-6xl px-3 py-6 sm:px-6"><Suspense fallback={<div role="status" aria-busy="true" className="flex min-h-[40vh] items-center justify-center"><span className="h-8 w-8 animate-spin rounded-full border-4 border-navy/20 border-t-navy" /></div>}><Outlet context={{ refreshUnread }} /></Suspense></main>
    </div>
  );
}
