import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

/** Section switcher shown at the top of grouped pages (keeps the main navigation short). */
export function SubTabs({ items }: { items: { to: string; label: string; end?: boolean }[] }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('app:menu.sections')} className="no-print mb-4 flex gap-1 border-b border-line">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `-mb-px border-b-[3px] px-3.5 py-2 text-[14px] font-bold transition-colors ${isActive ? 'border-orange text-navy' : 'border-transparent text-muted hover:text-navy'}`}>{i.label}</NavLink>
      ))}
    </nav>
  );
}

export const useVacancyTabs = () => {
  const { t } = useTranslation();
  return [{ to: '/vacancies', label: t('nav.vacancies'), end: true }, { to: '/recommendations', label: t('nav.recommendations') }, { to: '/favorites', label: t('nav.favorites') }];
};
export const useResumeTabs = () => {
  const { t } = useTranslation();
  return [{ to: '/resume/builder', label: t('nav.builder') }, { to: '/cv', label: t('nav.cv') }];
};
