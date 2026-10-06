import { Building2, CalendarClock, MapPin, Star } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { MatchResult } from '@sdu/shared';
import { MatchBadge, SkillChips } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { cityLabel, fmtDate } from '../../lib/format';
import { useSalary } from '../../lib/useSalary';

export interface VacancyDto {
  id: string; title: string; description: string; kind: string; industry: string; city: string; cityOther: string | null; workFormat: string; minGpa: string | null;
  deadline: string | null; status: string; publishedAt: string | null; requiredSkills: string[]; company: { id: string; name: string; website: string | null }; applicants?: number;
  salaryMin: number | null; salaryMax: number | null; match?: MatchResult | null; applied?: boolean; favorite?: boolean;
}

export function FavoriteStar({ id, initial, onChange }: { id: string; initial: boolean; onChange?: (v: boolean) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [on, setOn] = useState(initial);
  const [pop, setPop] = useState(0);
  if (user?.role !== 'student') return null;
  const toggle = async () => {
    const next = !on; setOn(next); setPop((n) => n + 1);
    try { await (next ? api('PUT', `/api/favorites/${id}`) : api('DELETE', `/api/favorites/${id}`)); onChange?.(next); } catch { setOn(!next); }
  };
  const label = t(on ? 'app:fav.remove' : 'app:fav.add');
  return (
    <button type="button" onClick={() => void toggle()} aria-pressed={on} aria-label={label} title={label} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition hover:bg-orange-50 hover:text-orange">
      <Star key={pop} size={20} className={`${pop > 0 ? 'star-pop' : ''} ${on ? 'fill-orange text-orange' : ''}`} aria-hidden />
    </button>
  );
}

/** hh-style vacancy row: blue title, bold salary, company · city, short text, skills, actions. */
export function VacancyCard({ v, index = 0, onFavorite }: { v: VacancyDto; index?: number; onFavorite?: (id: string, on: boolean) => void }) {
  const { t } = useTranslation();
  const salary = useSalary()(v.salaryMin, v.salaryMax);
  const m = v.match;
  return (
    <li className="fade-up card-hover rounded-2xl border border-line bg-white p-4 sm:p-5" style={{ ['--i' as string]: Math.min(index, 8) }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] font-bold leading-snug"><Link to={`/vacancies/${v.id}`} className="text-brand hover:underline">{v.title}</Link></h2>
          <p className={`mt-1 text-[17px] font-extrabold ${salary.has ? 'text-navy' : 'text-muted/80 text-[14px] font-medium'}`}>{salary.text}{salary.has && <span className="ml-1.5 text-[12px] font-medium text-muted">{t('app:salary.perMonth')}</span>}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13.5px] text-muted">
            <span className="flex items-center gap-1 font-semibold text-ink"><Building2 size={14} aria-hidden />{v.company.name}</span>
            <span className="flex items-center gap-1"><MapPin size={14} aria-hidden />{v.workFormat === 'remote' ? t('options:formats.remote') : cityLabel(t, v.city, v.cityOther)}</span>
            {v.deadline && <span className="flex items-center gap-1"><CalendarClock size={14} aria-hidden />{t('app:deadline', { date: fmtDate(v.deadline) })}</span>}
          </p>
        </div>
        {m && <MatchBadge percent={m.percent} />}
        <FavoriteStar id={v.id} initial={!!v.favorite} onChange={(on) => onFavorite?.(v.id, on)} />
      </div>
      <p className="mt-2.5 line-clamp-2 text-[14px] leading-6 text-ink/90">{v.description}</p>
      <p className="mt-2.5 flex flex-wrap gap-1.5 text-[12px] font-semibold">
        <span className="rounded-md bg-orange-50 px-2 py-0.5 text-orange-dark">{t(`options:kinds.${v.kind}`)}</span>
        <span className="rounded-md bg-brand-50 px-2 py-0.5 text-navy">{t(`options:formats.${v.workFormat}`)}</span>
        <span className="rounded-md bg-brand-50 px-2 py-0.5 text-navy">{t(`options:industries.${v.industry}`)}</span>
        {v.minGpa && <span className="rounded-md bg-brand-50 px-2 py-0.5 text-navy">{t('app:minGpa', { gpa: v.minGpa })}</span>}
        {v.applied && <span className="rounded-md bg-lime px-2 py-0.5 text-navy">{t('app:search.applied')}</span>}
      </p>
      <div className="mt-3"><SkillChips matched={m?.matchedSkills} missing={m?.missingSkills} neutral={m ? [] : v.requiredSkills} /></div>
    </li>
  );
}
