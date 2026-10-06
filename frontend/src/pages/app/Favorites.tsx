import { useTranslation } from 'react-i18next';
import { SubTabs, useVacancyTabs } from '../../components/SubTabs';
import { LoadState, PageHeader } from '../../components/ui';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';
import { VacancyCard, type VacancyDto } from './VacancyCard';

export function Favorites() {
  const { t } = useTranslation();
  usePageTitle('nav.favorites');
  const tabs = useVacancyTabs();
  const { data, error, loading, reload } = useApi<{ items: VacancyDto[] }>('/api/favorites');
  return (
    <div className="mx-auto max-w-4xl">
      <SubTabs items={tabs} />
      <PageHeader title={t('app:fav.title')} />
      <LoadState loading={loading && !data} error={error} empty={!!data && data.items.length === 0} emptyText={t('app:fav.empty')} />
      <ul className="space-y-3">{data?.items.map((v, i) => <VacancyCard key={v.id} v={v} index={i} onFavorite={(_, on) => { if (!on) setTimeout(() => void reload(), 300); }} />)}</ul>
    </div>
  );
}
