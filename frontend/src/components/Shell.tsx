import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from './Brand';
import { LangSwitcher } from './LangSwitcher';

/**
 * Auth pages: the SDU campus photo, blurred and veiled in navy, fills the whole screen; a single clean card sits in the
 * middle. Everything must fit in ≤ 100dvh (see e2e/no-scroll.spec.ts).
 */
export function Shell({ children }: { children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="on-dark relative flex min-h-dvh flex-col bg-navy-deep">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -inset-10 scale-105 bg-cover bg-center blur-[14px]" style={{ backgroundImage: "url('/brand/campus.jpg')" }} />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(28,32,72,.72),rgba(28,32,72,.86))]" />
      </div>
      <a href="#main" className="absolute left-2 top-2 z-50 -translate-y-14 rounded-full bg-white px-3 py-1 text-sm font-bold text-navy focus:translate-y-0">{t('skip')}</a>
      <header className="relative z-10 flex h-12 shrink-0 items-center justify-between px-3 sm:px-6">
        <Logo dark />
        <LangSwitcher />
      </header>
      <main id="main" className="relative z-10 flex flex-1 items-center justify-center px-2 pb-3 sm:px-4">{children}</main>
    </div>
  );
}
