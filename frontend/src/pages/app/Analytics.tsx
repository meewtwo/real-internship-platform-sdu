import { useTranslation } from 'react-i18next';
import { Card, LoadState, PageHeader } from '../../components/ui';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';

interface A {
  users: { students: number; employersActive: number; employersPending: number; unverified: number };
  vacancies: { published: number; draft: number; closed: number }; applications: { total: number; accepted: number };
  matches: { total: number; average: number | null; strong: number }; funnel: { status: string; n: number }[];
  series: { day: string; registrations: number; applications: number; vacancies: number }[];
  topSkillsWanted: { name: string; n: number }[]; topSkillsHeld: { name: string; n: number }[];
}

const Kpi = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-2xl bg-white p-4 shadow ring-1 ring-brand/10"><p className="text-[12px] font-bold uppercase tracking-wide text-muted">{label}</p><p className="mt-1 text-3xl font-extrabold text-navy">{value}</p></div>
);

function HBars({ rows, label }: { rows: { name: string; n: number }[]; label: string }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="text-[13px] text-muted">{t('app:an.noData')}</p>;
  return (
    <ul aria-label={label} className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-2 text-[13px]">
          <span className="truncate font-semibold text-navy" title={r.name}>{r.name}</span>
          <span className="h-3 rounded-full bg-slate-200" aria-hidden><span className="block h-3 rounded-full bg-brand" style={{ width: `${(r.n / max) * 100}%` }} /></span>
          <span className="text-right font-extrabold text-navy">{r.n}</span>
        </li>
      ))}
    </ul>
  );
}

const SERIES = [
  { key: 'registrations', color: '#0b5ed7', dash: '', label: 'an.registrations' },
  { key: 'applications', color: '#14764d', dash: '6 4', label: 'an.appsSeries' },
  { key: 'vacancies', color: '#b8860b', dash: '2 3', label: 'an.vacSeries' },
] as const;

function Lines({ data }: { data: A['series'] }) {
  const { t } = useTranslation();
  const W = 640, H = 220, P = { l: 34, r: 10, t: 12, b: 24 };
  const max = Math.max(1, ...data.flatMap((d) => SERIES.map((s) => d[s.key])));
  const x = (i: number) => P.l + (i / Math.max(1, data.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('app:an.activity')} className="h-auto w-full">
        {[0, 0.5, 1].map((g) => <g key={g}><line x1={P.l} x2={W - P.r} y1={y(max * g)} y2={y(max * g)} stroke="#e2e8f0" /><text x={P.l - 6} y={y(max * g) + 4} textAnchor="end" fontSize="11" fill="#475569">{Math.round(max * g)}</text></g>)}
        {SERIES.map((s) => <polyline key={s.key} fill="none" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} strokeLinejoin="round" points={data.map((d, i) => `${x(i)},${y(d[s.key])}`).join(' ')} />)}
        {[0, 14, 29].filter((i) => data[i]).map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === 29 ? 'end' : 'middle'} fontSize="11" fill="#475569">{data[i].day.slice(5)}</text>)}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-semibold text-navy">
        {SERIES.map((s) => <span key={s.key} className="flex items-center gap-1.5"><svg width="26" height="8" aria-hidden><line x1="0" y1="4" x2="26" y2="4" stroke={s.color} strokeWidth="3" strokeDasharray={s.dash} /></svg>{t(`app:${s.label}`)}</span>)}
      </figcaption>
      <details className="mt-2 text-[12px]"><summary className="cursor-pointer font-bold text-brand">{t('app:an.tableView')}</summary>
        <div className="max-h-48 overflow-auto"><table className="mt-1 w-full text-left"><thead><tr><th scope="col">&nbsp;</th>{SERIES.map((s) => <th scope="col" key={s.key}>{t(`app:${s.label}`)}</th>)}</tr></thead>
          <tbody>{data.map((d) => <tr key={d.day}><th scope="row" className="font-semibold">{d.day}</th>{SERIES.map((s) => <td key={s.key}>{d[s.key]}</td>)}</tr>)}</tbody></table></div></details>
    </figure>
  );
}

export function Analytics() {
  const { t } = useTranslation();
  usePageTitle('nav.analytics');
  const { data: a, error, loading } = useApi<A>('/api/admin/analytics');
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('app:an.title')} />
      <LoadState loading={loading && !a} error={error} />
      {a && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label={t('app:an.students')} value={a.users.students} /><Kpi label={t('app:an.employers')} value={a.users.employersActive} />
            <Kpi label={t('app:an.pending')} value={a.users.employersPending} /><Kpi label={t('app:an.published')} value={a.vacancies.published} />
            <Kpi label={t('app:an.applications')} value={a.applications.total} /><Kpi label={t('app:an.accepted')} value={a.applications.accepted} />
            <Kpi label={t('app:an.matches')} value={a.matches.total} /><Kpi label={t('app:an.avg')} value={a.matches.average === null ? '—' : `${a.matches.average}%`} />
          </div>
          <Card><h2 className="mb-2 text-lg font-extrabold text-navy">{t('app:an.activity')}</h2><Lines data={a.series} /></Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><h2 className="mb-2 text-lg font-extrabold text-navy">{t('app:an.topWanted')}</h2><HBars rows={a.topSkillsWanted} label={t('app:an.topWanted')} /></Card>
            <Card><h2 className="mb-2 text-lg font-extrabold text-navy">{t('app:an.topHeld')}</h2><HBars rows={a.topSkillsHeld} label={t('app:an.topHeld')} /></Card>
          </div>
          <Card><h2 className="mb-2 text-lg font-extrabold text-navy">{t('app:an.funnel')} · {t('app:an.strong')}: {a.matches.strong}</h2>
            <HBars rows={a.funnel.map((f) => ({ name: t(`options:appStatuses.${f.status}`), n: f.n }))} label={t('app:an.funnel')} /></Card>
        </div>
      )}
    </div>
  );
}
