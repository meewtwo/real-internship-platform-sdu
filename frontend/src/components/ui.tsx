import { Check, Minus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useCountUp } from '../lib/useMotion';
import { useTranslation } from 'react-i18next';
import { errText } from '../lib/errors';
import type { ApiError } from '../lib/api';

/** Circular match gauge: arc animates in and the number counts up (both skipped for reduced motion). */
export function MatchBadge({ percent, size = 56 }: { percent: number; size?: number }) {
  const { t } = useTranslation();
  const n = useCountUp(percent);
  const color = percent >= 80 ? '#22a06b' : percent >= 60 ? '#2b4fd0' : percent >= 40 ? '#d98a0b' : '#64748b';
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  return (
    <span role="img" aria-label={t('app:matchAria', { n: percent })} className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e8f0" strokeWidth="5" />
        <circle className="gauge-arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={shown ? c * (1 - percent / 100) : c} />
      </svg>
      <span className="absolute font-extrabold tabular-nums text-navy" style={{ fontSize: size * 0.27 }}>{n}%</span>
    </span>
  );
}

export function SkillChips({ matched = [], missing = [], neutral = [] }: { matched?: string[]; missing?: string[]; neutral?: string[] }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-1.5">
      {matched.map((s) => <li key={`m${s}`} className="flex items-center gap-1 rounded-md bg-ok/15 px-2.5 py-0.5 text-[12px] font-bold text-ok-text ring-1 ring-ok/30"><Check size={12} aria-hidden /><span className="sr-only">{t('app:detail.have')}: </span>{s}</li>)}
      {missing.map((s) => <li key={`x${s}`} className="flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-0.5 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-300"><Minus size={12} aria-hidden /><span className="sr-only">{t('app:detail.missing')}: </span>{s}</li>)}
      {neutral.map((s) => <li key={`n${s}`} className="rounded-md bg-brand-50 px-2.5 py-0.5 text-[12px] font-bold text-brand-dark ring-1 ring-brand/20">{s}</li>)}
    </ul>
  );
}

const STATUS_COLOR: Record<string, string> = {
  applied: 'bg-brand-50 text-brand-dark ring-brand/30', viewed: 'bg-slate-100 text-slate-700 ring-slate-300', shortlisted: 'bg-lime/60 text-navy ring-lime',
  interview: 'bg-amber-100 text-amber-900 ring-amber-300', accepted: 'bg-ok/15 text-ok-text ring-ok/40', rejected: 'bg-danger/10 text-danger-text ring-danger/30', withdrawn: 'bg-slate-100 text-slate-500 ring-slate-300',
  draft: 'bg-slate-100 text-slate-700 ring-slate-300', published: 'bg-ok/15 text-ok-text ring-ok/40', closed: 'bg-slate-200 text-slate-700 ring-slate-300',
};
export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`inline-block rounded-md px-2.5 py-0.5 text-[12px] font-bold ring-1 ${STATUS_COLOR[status] ?? STATUS_COLOR.viewed}`}>{label}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0"><h1 className="font-display text-[28px] font-bold text-navy sm:text-[34px]">{title}</h1>{subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}</div>
      {actions}
    </div>
  );
}

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <section className={`rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-5 ${className}`}>{children}</section>
);

export function LoadState({ loading, error, empty, emptyText }: { loading: boolean; error: ApiError | null; empty?: boolean; emptyText?: string }) {
  const { t } = useTranslation();
  if (loading) return <div role="status" aria-label={t('loading')} className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-28" style={{ opacity: 1 - i * 0.2 }} />)}</div>;
  if (error) return <p role="alert" className="rounded-2xl bg-danger/10 p-4 font-semibold text-danger-text">{errText(t, error.code)}</p>;
  if (empty) return <p className="rounded-2xl bg-white p-6 text-center text-muted shadow ring-1 ring-brand/10">{emptyText}</p>;
  return null;
}

export const btnPrimary = 'btn-lift btn-press inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-navy hover:bg-navy-deep btn-press px-5 text-[14px] font-extrabold text-white  transition  disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none';
export const btnGhost = 'btn-press btn-lift inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-white px-4 text-[13px] font-bold text-navy ring-1 ring-inset ring-line transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50';
export const btnDanger = 'btn-press inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-white px-4 text-[13px] font-bold text-danger-text ring-1 ring-inset ring-danger/40 transition hover:bg-danger/10 disabled:opacity-50';
