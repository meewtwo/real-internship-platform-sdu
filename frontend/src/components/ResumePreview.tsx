import { Globe, Mail, MapPin, Phone } from 'lucide-react';
import type { ReactNode } from 'react';
import { RESUME_LABELS, type ResumeDoc, type ResumeLang, type ResumeTemplate } from '@sdu/shared';

const LOCALE: Record<ResumeLang, string> = { en: 'en-GB', ru: 'ru-RU', kk: 'kk-KZ' };
function ym(v: string, lang: ResumeLang): string {
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return v;
  return new Intl.DateTimeFormat(LOCALE[lang], { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, 1)));
}
const range = (s: string, e: string, lang: ResumeLang) => [s ? ym(s, lang) : '', e === 'present' ? RESUME_LABELS[lang].present : e ? ym(e, lang) : ''].filter(Boolean).join(' – ');
const safeHref = (u: string) => (/^https:\/\//i.test(u) ? u : undefined);
const keep = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties;

function Entry({ title, sub, meta, children }: { title: string; sub?: string; meta?: string; children?: ReactNode }) {
  return (
    <div className="mb-2.5 break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3"><p className="text-[13.5px] font-bold text-[#1b2036]">{title}{sub && <span className="font-semibold text-slate-700">, {sub}</span>}</p>{meta && <p className="text-[12px] text-slate-600">{meta}</p>}</div>
      {children}
    </div>
  );
}
const Bullets = ({ items }: { items: string[] }) => (items.length ? <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-[12.5px] leading-[1.45] text-[#1b2036]">{items.map((b, i) => <li key={i}>{b}</li>)}</ul> : null);

function Sections({ d, lang, accent, compact }: { d: ResumeDoc; lang: ResumeLang; accent: string; compact?: boolean }) {
  const L = RESUME_LABELS[lang];
  const H = ({ children }: { children: ReactNode }) => <h2 className={`mb-1.5 ${compact ? 'mt-3' : 'mt-4'} border-b pb-0.5 text-[12px] font-extrabold uppercase tracking-[0.12em]`} style={{ color: accent, borderColor: accent }}>{children}</h2>;
  return (
    <>
      {d.summary && <section><H>{L.summary}</H><p className="whitespace-pre-line text-[12.5px] leading-[1.5] text-[#1b2036]">{d.summary}</p></section>}
      {d.experience.length > 0 && <section><H>{L.experience}</H>{d.experience.map((e, i) => <Entry key={i} title={e.role} sub={[e.company, e.location].filter(Boolean).join(', ') || undefined} meta={range(e.start, e.end, lang)}><Bullets items={e.bullets} /></Entry>)}</section>}
      {d.education.length > 0 && <section><H>{L.education}</H>{d.education.map((e, i) => <Entry key={i} title={e.institution} sub={e.degree || undefined} meta={range(e.start, e.end, lang)}>{e.details && <p className="text-[12.5px] text-slate-700">{e.details}</p>}</Entry>)}</section>}
      {d.projects.length > 0 && <section><H>{L.projects}</H>{d.projects.map((p, i) => <Entry key={i} title={p.name}>{p.url && safeHref(p.url) && <a className="text-[12px] text-brand underline" href={safeHref(p.url)} target="_blank" rel="noopener noreferrer nofollow">{p.url.replace(/^https:\/\//, '')}</a>}{p.description && <p className="text-[12.5px] text-[#1b2036]">{p.description}</p>}{p.tech.length > 0 && <p className="text-[12px] italic text-slate-600">{p.tech.join(', ')}</p>}</Entry>)}</section>}
      {d.certificates.length > 0 && <section><H>{L.certificates}</H>{d.certificates.map((c, i) => <Entry key={i} title={c.name} sub={c.issuer || undefined} meta={c.year || undefined} />)}</section>}
    </>
  );
}

function Contact({ d, light }: { d: ResumeDoc; light?: boolean }) {
  const c = d.personal;
  const cls = `flex items-center gap-1.5 break-all text-[12px] ${light ? 'text-white/90' : 'text-slate-700'}`;
  return (
    <ul className="space-y-1">
      {c.email && <li className={cls}><Mail size={12} aria-hidden />{c.email}</li>}
      {c.phone && <li className={cls}><Phone size={12} aria-hidden />{c.phone}</li>}
      {c.city && <li className={cls}><MapPin size={12} aria-hidden />{c.city}</li>}
      {c.links.map((l, i) => <li key={i} className={cls}><Globe size={12} aria-hidden />{safeHref(l.url) ? <a href={safeHref(l.url)} target="_blank" rel="noopener noreferrer nofollow" className="underline">{l.label}</a> : l.label}</li>)}
    </ul>
  );
}

/** One component renders every template; the same markup is shown on screen, in print/PDF and on the public page. All text is rendered as text (React escapes it). */
export function ResumePreview({ doc, template, language, className = '' }: { doc: ResumeDoc; template: ResumeTemplate; language: ResumeLang; className?: string }) {
  const L = RESUME_LABELS[language];
  const base = `resume-sheet mx-auto w-full max-w-[820px] bg-white text-[#1b2036] shadow-sm ring-1 ring-line print:shadow-none print:ring-0 ${className}`;
  const name = doc.personal.fullName;
  if (template === 'modern') {
    return (
      <article lang={language} className={`${base} grid grid-cols-[34%_1fr] overflow-hidden`}>
        <aside className="space-y-4 bg-[#2f345c] p-5 text-white" style={keep}>
          <div><h1 className="text-[22px] font-extrabold leading-tight">{name}</h1>{doc.personal.headline && <p className="mt-1 text-[13px] text-white/85">{doc.personal.headline}</p>}</div>
          <div><h2 className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#ff9a55]">{L.contact}</h2><Contact d={doc} light /></div>
          {doc.skills.length > 0 && <div><h2 className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#ff9a55]">{L.skills}</h2>{doc.skills.map((g, i) => <div key={i} className="mb-1.5">{g.group && <p className="text-[11.5px] font-bold text-white/90">{g.group}</p>}<p className="text-[12px] leading-[1.45] text-white/90">{g.items.join(' · ')}</p></div>)}</div>}
          {doc.languages.length > 0 && <div><h2 className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#ff9a55]">{L.languages}</h2><ul className="space-y-0.5 text-[12px] text-white/90">{doc.languages.map((l, i) => <li key={i}>{l.name}{l.level && <span className="text-white/70"> — {l.level}</span>}</li>)}</ul></div>}
        </aside>
        <div className="p-5"><Sections d={doc} lang={language} accent="#2f345c" /></div>
      </article>
    );
  }
  const compact = template === 'compact';
  return (
    <article lang={language} className={`${base} ${compact ? 'p-5' : 'p-8'}`}>
      <header className={compact ? 'flex flex-wrap items-end justify-between gap-2 border-b-2 border-[#2f345c] pb-2' : 'border-b-2 border-[#2f345c] pb-3'}>
        <div><h1 className={`${compact ? 'text-[20px]' : 'font-display text-[28px]'} font-extrabold leading-tight text-[#2f345c]`}>{name}</h1>{doc.personal.headline && <p className="text-[13px] text-slate-700">{doc.personal.headline}</p>}</div>
        <div className={compact ? '' : 'mt-2'}><Contact d={doc} /></div>
      </header>
      <Sections d={doc} lang={language} accent="#2f345c" compact={compact} />
      {(doc.skills.length > 0 || doc.languages.length > 0) && (
        <section>
          <h2 className="mb-1.5 mt-4 border-b border-[#2f345c] pb-0.5 text-[12px] font-extrabold uppercase tracking-[0.12em] text-[#2f345c]">{L.skills}{doc.languages.length > 0 && ` · ${L.languages}`}</h2>
          {doc.skills.map((g, i) => <p key={i} className="text-[12.5px] leading-[1.5]">{g.group && <b>{g.group}: </b>}{g.items.join(', ')}</p>)}
          {doc.languages.length > 0 && <p className="text-[12.5px]"><b>{L.languages}: </b>{doc.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(', ')}</p>}
        </section>
      )}
    </article>
  );
}
