import { useTranslation } from 'react-i18next';
import type { Language } from '@sdu/shared';
import { LANGS } from '../i18n';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/** Always-visible EN/RU/KZ switcher. Persists to localStorage (i18n) and, when signed in, to users.preferred_language. */
export function LangSwitcher({ dark = true }: { dark?: boolean }) {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const choose = async (code: Language) => {
    if (code === i18n.language) return;
    await i18n.changeLanguage(code); // keeps all form values; visible errors re-translate on re-render
    if (user) api('PATCH', '/api/auth/language', { language: code }).catch(() => undefined);
  };
  return (
    <div role="group" aria-label={t('language')} className={`inline-flex rounded-md p-0.5 ${dark ? 'bg-white/15 ring-1 ring-white/40' : 'bg-brand-50 ring-1 ring-brand/20'}`}>
      {LANGS.map((l) => {
        const on = i18n.language === l.code;
        return (
          <button key={l.code} type="button" lang={l.code} aria-pressed={on} onClick={() => void choose(l.code)}
            className={`h-8 min-w-10 rounded-md px-2.5 text-[12px] font-extrabold tracking-wide transition-colors ${on ? (dark ? 'bg-white text-brand-dark' : 'bg-brand-dark text-white') : (dark ? 'text-white hover:bg-white/20' : 'text-navy hover:bg-white')}`}>
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
