import { Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CITY_KEYS, INDUSTRY_KEYS, VACANCY_KINDS, WORK_FORMATS } from '@sdu/shared';
import { SubTabs, useVacancyTabs } from '../../components/SubTabs';
import { LoadState, btnGhost } from '../../components/ui';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';
import { VacancyCard, type VacancyDto } from './VacancyCard';

const sel = 'h-10 w-full min-w-0 rounded-lg border border-line bg-white px-2.5 text-[14px] text-ink focus:border-brand';
const EMPTY = { q: '', industry: '', kind: '', format: '', city: '', sort: 'match', page: 1, salaryFrom: '', withSalary: false };

export function VacancySearch() {
  const { t } = useTranslation();
  usePageTitle('nav.vacancies');
  const tabs = useVacancyTabs();
  const [f, setF] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState({ q: '', salaryFrom: '' });
  useEffect(() => { const id = setTimeout(() => setDebounced({ q: f.q, salaryFrom: f.salaryFrom }), 300); return () => clearTimeout(id); }, [f.q, f.salaryFrom]);
  const qs = new URLSearchParams({ q: debounced.q, industry: f.industry, kind: f.kind, format: f.format, city: f.city, sort: f.sort, page: String(f.page), salaryFrom: debounced.salaryFrom.replace(/\D/g, ''), withSalary: f.withSalary ? '1' : '0' }).toString();
  const { data, error, loading } = useApi<{ total: number; page: number; pageSize: number; items: VacancyDto[] }>(`/api/vacancies?${qs}`);
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v, page: 1 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const opt = (g: string, keys: readonly string[]) => keys.map((k) => <option key={k} value={k}>{t(`options:${g}.${k}`)}</option>);
  const field = (id: string, label: string, el: React.ReactNode) => <div className="min-w-0"><label htmlFor={id} className="mb-1 block text-[12px] font-bold uppercase tracking-wide text-muted">{label}</label>{el}</div>;
  return (
    <div>
      <SubTabs items={tabs} />
      <form role="search" onSubmit={(e) => e.preventDefault()} className="mb-4 flex gap-2 rounded-xl border border-line bg-white p-1.5 shadow-sm">
        <span className="grid w-10 place-items-center text-muted" aria-hidden><Search size={18} /></span>
        <label className="sr-only" htmlFor="f-q">{t('app:search.q')}</label>
        <input id="f-q" value={f.q} maxLength={60} onChange={(e) => set('q', e.target.value)} placeholder={t('app:search.q')} autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-500" />
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`${btnGhost} lg:hidden`}><SlidersHorizontal size={15} aria-hidden />{t('app:search.filters')}</button>
      </form>
      <div className="grid gap-5 lg:grid-cols-[270px_1fr]">
        <aside aria-label={t('app:search.filters')} className={`${open ? 'block' : 'hidden'} h-fit space-y-3.5 rounded-2xl border border-line bg-white p-4 lg:sticky lg:top-28 lg:block`}>
          {field('f-ind', t('app:search.industry'), <select id="f-ind" value={f.industry} onChange={(e) => set('industry', e.target.value)} className={sel}><option value="">{t('app:all')}</option>{opt('industries', INDUSTRY_KEYS)}</select>)}
          {field('f-kind', t('app:search.kind'), <select id="f-kind" value={f.kind} onChange={(e) => set('kind', e.target.value)} className={sel}><option value="">{t('app:all')}</option>{opt('kinds', VACANCY_KINDS)}</select>)}
          {field('f-fmt', t('app:search.format'), <select id="f-fmt" value={f.format} onChange={(e) => set('format', e.target.value)} className={sel}><option value="">{t('app:all')}</option>{opt('formats', WORK_FORMATS)}</select>)}
          {field('f-city', t('app:search.city'), <select id="f-city" value={f.city} onChange={(e) => set('city', e.target.value)} className={sel}><option value="">{t('app:all')}</option>{opt('cities', CITY_KEYS.filter((c) => c !== 'other'))}</select>)}
          {field('f-sal', t('app:search.salaryFrom'), <input id="f-sal" inputMode="numeric" maxLength={9} value={f.salaryFrom} onChange={(e) => set('salaryFrom', e.target.value.replace(/\D/g, ''))} placeholder="200000" className={sel} />)}
          <label className="flex cursor-pointer items-center gap-2 text-[14px] font-semibold text-ink"><input type="checkbox" checked={f.withSalary} onChange={(e) => set('withSalary', e.target.checked)} className="h-4 w-4 accent-navy" />{t('app:search.withSalary')}</label>
          {field('f-sort', t('app:search.sort'), <select id="f-sort" value={f.sort} onChange={(e) => set('sort', e.target.value)} className={sel}><option value="match">{t('app:search.sortMatch')}</option><option value="newest">{t('app:search.sortNewest')}</option><option value="salary">{t('app:search.sortSalary')}</option></select>)}
          <button type="button" className={`${btnGhost} w-full`} onClick={() => setF(EMPTY)}>{t('app:search.reset')}</button>
        </aside>
        <section aria-live="polite">
          {data && <h1 className="mb-3 text-[22px] font-extrabold text-navy" role="status">{t('app:search.found', { n: data.total })}</h1>}
          <LoadState loading={loading && !data} error={error} empty={!!data && data.items.length === 0} emptyText={t('app:search.none')} />
          {data && data.items.length > 0 && (
            <>
              <ul className="space-y-3">{data.items.map((v, i) => <VacancyCard key={v.id} v={v} index={i} />)}</ul>
              {pages > 1 && (
                <nav className="mt-5 flex items-center justify-center gap-3" aria-label={t('app:page', { page: f.page, pages })}>
                  <button type="button" className={btnGhost} disabled={f.page <= 1} onClick={() => setF((s) => ({ ...s, page: s.page - 1 }))}>{t('app:prev')}</button>
                  <span className="text-[13px] font-bold text-navy">{t('app:page', { page: f.page, pages })}</span>
                  <button type="button" className={btnGhost} disabled={f.page >= pages} onClick={() => setF((s) => ({ ...s, page: s.page + 1 }))}>{t('app:next')}</button>
                </nav>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
