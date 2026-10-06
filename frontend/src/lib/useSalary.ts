import { useTranslation } from 'react-i18next';

const LOCALES: Record<string, string> = { en: 'en-GB', ru: 'ru-RU', kk: 'kk-KZ' };
/** "250 000 – 400 000 ₸", "from … ₸", "up to … ₸" or the "not specified" text, in the UI language. */
export function useSalary() {
  const { t, i18n } = useTranslation();
  const nf = new Intl.NumberFormat(LOCALES[i18n.language] ?? 'en-GB');
  return (min: number | null | undefined, max: number | null | undefined): { text: string; has: boolean } => {
    if (min && max) return { text: min === max ? t('app:salary.exact', { v: nf.format(min) }) : t('app:salary.range', { min: nf.format(min), max: nf.format(max) }), has: true };
    if (min) return { text: t('app:salary.from', { min: nf.format(min) }), has: true };
    if (max) return { text: t('app:salary.upTo', { max: nf.format(max) }), has: true };
    return { text: t('app:salary.none'), has: false };
  };
}
