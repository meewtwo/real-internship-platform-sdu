import i18n from '../i18n';

const LOCALES: Record<string, string> = { en: 'en-GB', ru: 'ru-RU', kk: 'kk-KZ' };
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(LOCALES[i18n.language] ?? 'en-GB', { dateStyle: 'medium' }).format(d);
}
export const cityLabel = (t: (k: string) => string, city: string, other: string | null) => (city === 'other' ? other ?? '' : t(`options:cities.${city}`));
