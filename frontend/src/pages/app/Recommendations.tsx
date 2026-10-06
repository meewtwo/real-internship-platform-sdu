import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SubTabs, useVacancyTabs } from '../../components/SubTabs';
import { Card, LoadState, PageHeader } from '../../components/ui';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';
import { VacancyCard, type VacancyDto } from './VacancyCard';

interface Gap { skill: string; count: number; courses: { title: string; provider: string; url: string; free: boolean }[] }

export function Recommendations() {
  const { t } = useTranslation();
  usePageTitle('nav.recommendations');
  const tabs = useVacancyTabs();
  const { data, error, loading } = useApi<{ recommendations: VacancyDto[]; gaps: Gap[] }>('/api/recommendations');
  return (
    <div className="mx-auto max-w-5xl">
      <SubTabs items={tabs} />
      <PageHeader title={t('app:rec.title')} subtitle={t('app:rec.subtitle')} />
      <LoadState loading={loading && !data} error={error} empty={!!data && data.recommendations.length === 0} emptyText={t('app:rec.none')} />
      {data && data.recommendations.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <ul className="space-y-3">{data.recommendations.map((v) => <VacancyCard key={v.id} v={v} />)}</ul>
          <aside aria-label={t('app:rec.gaps')} className="space-y-3">
            <Card>
              <h2 className="text-lg font-extrabold text-navy">{t('app:rec.gaps')}</h2>
              <p className="mb-3 text-[13px] text-muted">{t('app:rec.gapsText')}</p>
              {data.gaps.length === 0 ? <p className="text-[13px] text-muted">—</p> : (
                <ul className="space-y-3">
                  {data.gaps.map((g) => (
                    <li key={g.skill} className="rounded-2xl bg-slate-50 p-3">
                      <p className="flex items-baseline justify-between gap-2"><strong className="text-navy">{g.skill}</strong><span className="text-[11px] font-semibold text-muted">{t('app:rec.needed', { n: g.count })}</span></p>
                      <ul className="mt-1 space-y-1">
                        {g.courses.map((c) => (
                          <li key={c.url}><a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1.5 text-[13px] font-bold text-brand hover:underline">
                            <ExternalLink size={13} aria-hidden /><span className="min-w-0">{c.title} <span className="font-normal text-muted">· {c.provider}</span></span>{c.free && <span className="ml-auto shrink-0 rounded-full bg-lime px-1.5 text-[10px] font-extrabold text-navy">{t('app:rec.free')}</span>}
                          </a></li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
