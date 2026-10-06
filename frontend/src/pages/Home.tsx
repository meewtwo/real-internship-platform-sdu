import { ArrowRight, ArrowUpRight, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Emblem, Logo } from '../components/Brand';
import { LangSwitcher } from '../components/LangSwitcher';
import { useAuth } from '../lib/auth';
import { cityLabel } from '../lib/format';
import { useCountUp, useReveal } from '../lib/useMotion';
import { usePageTitle } from '../lib/usePageTitle';
import { useApi } from '../lib/useApi';
import { useSalary } from '../lib/useSalary';
import type { VacancyDto } from './app/VacancyCard';

const Stat = ({ n, label }: { n: number; label: string }) => {
  const v = useCountUp(n, 1200);
  return <div><p className="font-display text-[44px] font-light leading-none tabular-nums text-white sm:text-[56px]">{v}</p><p className="kicker mt-2 text-[10.5px] text-white/60">{label}</p></div>;
};

function Reveal({ children, i = 0, className = '' }: { children: React.ReactNode; i?: number; className?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return <div ref={ref} className={`reveal ${className}`} style={{ ['--i' as string]: i }}>{children}</div>;
}

/** Public landing page: editorial typography (serif display + sans body), hh-style search first. */
export function Home() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const salaryOf = useSalary();
  const [q, setQ] = useState('');
  usePageTitle('appName');
  const { data } = useApi<{ vacancies: VacancyDto[]; stats: { vacancies: number; employers: number; students: number } }>(user ? null : '/api/public/home');
  const tape = ['Python', 'SQL', 'React', 'Docker', 'Figma', 'Excel', 'Java', 'Marketing', 'Cybersecurity', 'Data Analysis', 'TypeScript', 'Kubernetes', 'SEO', 'Power BI'];
  if (!loading && user) return <Navigate to="/dashboard" replace />;
  const go = (e: React.FormEvent) => { e.preventDefault(); navigate('/register?role=student'); };
  const steps = [['s1t', 's1'], ['s2t', 's2'], ['s3t', 's3']];
  const feats = [['f1t', 'f1'], ['f2t', 'f2'], ['f3t', 'f3'], ['f4t', 'f4']];
  return (
    <div className="min-h-dvh bg-page">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-3 py-2.5 sm:px-6">
          <Logo />
          <div className="flex items-center gap-2"><LangSwitcher dark={false} /><Link to="/login" className="btn-press rounded-lg border border-line px-4 py-2 text-[14px] font-bold text-navy hover:bg-brand-50">{t('app:home.signin')}</Link></div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-navy text-white">
        <div className="hero-photo absolute inset-y-0 right-0 hidden w-[44%] md:block [mask-image:linear-gradient(90deg,transparent,#000_52%)]" aria-hidden />
        <Emblem className="float-slow absolute -bottom-16 left-[42%] hidden h-80 w-72 text-white/[0.05] lg:block" />
        <div className="relative mx-auto max-w-6xl px-3 pb-14 pt-12 sm:px-6 sm:pb-20 sm:pt-16 lg:pt-24">
          <p className="fade-up kicker mb-5 flex items-center gap-3 text-[#ff9a55]"><span className="h-px w-10 bg-[#ff9a55]" />{t('app:home.kicker')} · SDU University</p>
          <h1 className="font-display fade-up max-w-3xl text-[44px] font-semibold leading-[1.02] sm:text-[68px] lg:text-[80px]" style={{ ['--i' as string]: 1 }}>
            {t('app:home.h1a')}<br /><em className="underline-sweep pb-1 font-medium text-white">{t('app:home.h1b')}</em>
          </h1>
          <p className="fade-up mt-6 max-w-xl text-[17px] leading-8 text-white/75" style={{ ['--i' as string]: 2 }}>{t('app:home.sub')}</p>
          <form onSubmit={go} role="search" className="fade-up mt-8 flex max-w-2xl gap-2 rounded-xl bg-white p-1.5 shadow-2xl" style={{ ['--i' as string]: 3 }}>
            <label className="sr-only" htmlFor="home-q">{t('app:home.search')}</label>
            <span className="grid w-10 place-items-center text-muted" aria-hidden><Search size={18} /></span>
            <input id="home-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} placeholder={t('app:home.search')} className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-slate-500" />
            <button type="submit" className="btn-press btn-lift rounded-lg bg-orange-dark px-5 text-[14px] font-extrabold text-white hover:bg-[#8f3f08]">{t('app:home.find')}</button>
          </form>
          <div className="fade-up mt-6 flex flex-wrap gap-3" style={{ ['--i' as string]: 4 }}>
            <Link to="/register?role=student" className="btn-press btn-lift inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-[14px] font-bold text-navy hover:bg-brand-50">{t('app:home.ctaS')} <ArrowRight size={16} aria-hidden /></Link>
            <Link to="/register?role=employer" className="btn-press btn-lift inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-[14px] font-bold text-white ring-1 ring-white/40 hover:bg-white/10">{t('app:home.ctaE')}</Link>
          </div>
          <div className="mt-14 grid max-w-xl grid-cols-3 gap-6 border-t border-white/15 pt-7">
            <Stat n={data?.stats.vacancies ?? 0} label={t('app:home.statV')} /><Stat n={data?.stats.employers ?? 0} label={t('app:home.statE')} /><Stat n={data?.stats.students ?? 0} label={t('app:home.statS')} />
          </div>
        </div>
        <div className="marquee relative overflow-hidden border-t border-white/10 bg-navy-deep py-3" aria-hidden>
          <div className="marquee-track flex w-max gap-6 font-display text-[18px] italic text-white/70">{[...tape, ...tape].map((s, i) => <span key={i} className="flex items-center gap-6">{s}<span className="text-orange">✦</span></span>)}</div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-3 py-14 sm:px-6">
        <Reveal><div className="mb-6 flex items-end justify-between gap-4"><div><p className="kicker text-orange-dark">01</p><h2 className="font-display text-[34px] font-bold leading-tight text-navy sm:text-[44px]">{t('app:home.latest')}</h2></div><Link to="/login" className="mb-2 flex items-center gap-1 text-[14px] font-bold text-brand hover:underline">{t('app:home.all')}<ArrowUpRight size={15} aria-hidden /></Link></div></Reveal>
        {!data ? <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-40" />)}</div>
          : data.vacancies.length === 0 ? <p className="rounded-xl border border-line bg-white p-6 text-center text-muted">{t('app:home.empty')}</p>
          : <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{data.vacancies.map((v, i) => {
            const s = salaryOf(v.salaryMin, v.salaryMax);
            return <li key={v.id} className="fade-up card-hover group rounded-xl border border-line bg-white p-4" style={{ ['--i' as string]: i }}>
              <Link to="/login" className="block"><h3 className="font-display wght-hover text-[20px] leading-snug text-brand">{v.title}</h3>
                <p className={`mt-1 ${s.has ? 'text-[16px] font-extrabold text-navy' : 'text-[13px] text-muted'}`}>{s.text}</p>
                <p className="mt-1 text-[13px] text-muted"><span className="font-semibold text-ink">{v.company.name}</span> · {v.workFormat === 'remote' ? t('options:formats.remote') : cityLabel(t, v.city, v.cityOther)}</p>
                <p className="mt-2 line-clamp-2 text-[13.5px] leading-6 text-ink/85">{v.description}</p>
                <p className="mt-2 flex flex-wrap gap-1.5">{v.requiredSkills.slice(0, 4).map((k) => <span key={k} className="rounded-md bg-brand-50 px-2 py-0.5 text-[12px] font-semibold text-navy">{k}</span>)}</p></Link></li>;
          })}</ul>}
      </section>

      <section className="border-y border-line bg-white">
        <div className="mx-auto max-w-6xl px-3 py-14 sm:px-6">
          <Reveal><p className="kicker text-orange-dark">02</p><h2 className="font-display mb-10 text-[34px] font-bold text-navy sm:text-[44px]">{t('app:home.how')}</h2></Reveal>
          <ol className="grid gap-10 md:grid-cols-3 md:gap-8">
            {steps.map(([a, b], i) => (
              <li key={a}><Reveal i={i} className="border-t-2 border-navy pt-5"><span className="numeral block text-[84px]">{`0${i + 1}`}</span>
                <h3 className="font-display mt-3 text-[24px] font-bold text-navy">{t(`app:home.${a}`)}</h3><p className="mt-2 text-[15px] leading-7 text-muted">{t(`app:home.${b}`)}</p></Reveal></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-3 py-14 sm:px-6">
        <Reveal><p className="kicker text-orange-dark">03</p><h2 className="font-display mb-8 text-[34px] font-bold text-navy sm:text-[44px]">{t('app:home.why')}</h2></Reveal>
        <div className="grid gap-x-10 gap-y-2 md:grid-cols-2">
          {feats.map(([a, b], i) => (
            <Reveal key={a} i={i}><div className="group flex gap-4 border-b border-line py-5"><span className="font-display text-[34px] font-light italic leading-none text-orange">{i + 1}</span>
              <div><h3 className="font-display wght-hover text-[22px] text-navy">{t(`app:home.${a}`)}</h3><p className="mt-1 text-[15px] leading-7 text-muted">{t(`app:home.${b}`)}</p></div></div></Reveal>
          ))}
        </div>
      </section>

      <section className="relative overflow-hidden bg-navy text-white">
        <Emblem className="absolute -right-6 -top-6 h-64 w-56 text-white/[0.06]" />
        <Reveal className="relative mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-3 py-14 sm:px-6">
          <div><h2 className="font-display max-w-xl text-[34px] font-semibold leading-tight sm:text-[46px]">{t('app:home.ctaTitle')}</h2><p className="mt-2 text-white/70">{t('app:home.ctaText')}</p></div>
          <div className="flex flex-wrap gap-3"><Link to="/register?role=student" className="btn-press btn-lift rounded-lg bg-orange px-6 py-3 text-[15px] font-extrabold text-white hover:bg-orange-dark">{t('app:home.ctaS')}</Link><Link to="/register?role=employer" className="btn-press btn-lift rounded-lg px-6 py-3 text-[15px] font-bold ring-1 ring-white/40 hover:bg-white/10">{t('app:home.ctaE')}</Link></div>
        </Reveal>
      </section>
      <footer className="bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-3 py-5 sm:px-6"><Logo /><p className="flex items-center gap-2 text-[12px] font-semibold text-muted"><img src="/brand/anniversary-30.png" alt="" className="h-9 w-9 object-contain" />{t('app:home.anniv')}</p></div></footer>
    </div>
  );
}
