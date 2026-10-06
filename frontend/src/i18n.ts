import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from '@sdu/shared';
export const LANG_KEY = 'lang';
export const LANGS: { code: Language; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'ru', label: 'RU' },
  { code: 'kk', label: 'KZ' },
];

function detect(): Language {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'ru' || saved === 'kk') return saved;
  } catch { /* storage unavailable */ }
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return nav === 'ru' ? 'ru' : nav === 'kk' ? 'kk' : 'en';
}

const NAMESPACES = ['common', 'auth', 'errors', 'options', 'profile', 'app'] as const;
const loaders = import.meta.glob<{ default: Record<string, unknown> }>('./locales/*/*.json');
const loaded = new Set<string>();

/** Loads one language's namespaces on demand, so only the active language is downloaded. */
async function loadLanguage(lng: string) {
  if (loaded.has(lng) || !(lng in { en: 1, ru: 1, kk: 1 })) return;
  await Promise.all(NAMESPACES.map(async (ns) => {
    const mod = await loaders[`./locales/${lng}/${ns}.json`]();
    i18n.addResourceBundle(lng, ns, mod.default, true, true);
  }));
  loaded.add(lng);
}

const initialLng = detect();

export const i18nReady: Promise<unknown> = i18n.use(initReactI18next).init({
  resources: {},
  lng: initialLng,
  fallbackLng: false,
  ns: [...NAMESPACES],
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React escapes
  returnNull: false,
  react: { useSuspense: false },
}).then(() => loadLanguage(initialLng)).then(() => i18n.changeLanguage(initialLng));

// every language switch (switcher, saved preference after sign-in) loads its bundle first
const changeLanguage = i18n.changeLanguage.bind(i18n);
i18n.changeLanguage = async (lng, callback) => {
  if (lng) await loadLanguage(lng);
  return changeLanguage(lng, callback);
};

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try { localStorage.setItem(LANG_KEY, lng); } catch { /* ignore */ }
});
document.documentElement.lang = i18n.language;

export default i18n;
