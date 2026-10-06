import { Check, ChevronDown, ChevronLeft, Eye, EyeOff, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { passwordChecks, passwordStrength, type PasswordContext, type PasswordRule } from '@sdu/shared';
import { errText } from '../lib/errors';
import { FieldShell, TextField } from './Field';

// ───────────────────────── Segmented pill toggle (radio group) ─────────────────────────
export function Segmented<T extends string>({ name, value, options, onChange, label, size = 'md', className = '', labelledBy }: {
  name: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string; size?: 'sm' | 'md'; className?: string; labelledBy?: string;
}) {
  const h = size === 'sm' ? 'h-8 text-[12px]' : 'h-9 text-[12.5px]';
  return (
    <div role="radiogroup" aria-label={label} aria-labelledby={labelledBy} className={`inline-flex w-full rounded-lg bg-brand-50 p-0.5 ring-1 ring-inset ring-brand/15 ${className}`}>
      {options.map((o) => (
        <label key={o.value} className={`relative flex min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md px-1 text-center font-bold leading-none transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-brand ${h} ${value === o.value ? 'bg-brand-dark text-white shadow' : 'text-navy hover:bg-white/70'}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
          <span className="truncate">{o.label}</span>
        </label>
      ))}
    </div>
  );
}

// ───────────────────────── Native select inside the field shell ─────────────────────────
export function SelectField({ name, label, value, onChange, onBlur, options, error, valid, icon, placeholder, errLines, className, disabled }: {
  name: string; label: string; value: string; onChange: (v: string) => void; onBlur?: () => void;
  options: { value: string; label: string }[]; error?: string; valid?: boolean; icon?: ReactNode; placeholder: string; errLines?: 1 | 2 | 'r'; className?: string; disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <FieldShell label={label} error={error ? errText(t, error) : undefined} valid={valid && !error && value !== ''} icon={icon} errLines={errLines} className={className} disabled={disabled}
      trailing={<ChevronDown aria-hidden size={16} className="pointer-events-none -ml-6 mr-1.5 self-center text-slate-500" />}>
      {({ id, describedBy, invalid, cls }) => (
        <select id={id} name={name} value={value} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy} aria-required
          className={`${cls} cursor-pointer appearance-none pr-6 ${value === '' ? 'text-slate-500' : ''}`}
          onChange={(e) => onChange(e.target.value)} onBlur={onBlur}>
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </FieldShell>
  );
}

// ───────────────────────── Month + year picker ─────────────────────────
export function MonthYearField({ label, value, onChange, onBlur, error, icon, errLines, className }: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; error?: string; icon?: ReactNode; errLines?: 1 | 2 | 'r'; className?: string;
}) {
  const { t } = useTranslation();
  const [m0, y0] = [value.slice(5, 7).replace(/^0/, ''), value.slice(0, 4)];
  const [month, setMonth] = useState(m0);
  const [year, setYear] = useState(y0);
  useEffect(() => { setMonth(m0); setYear(y0); }, [m0, y0]); // external resets
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, i) => String(thisYear + i));
  const emit = (m: string, y: string) => onChange(m && y ? `${y}-${m.padStart(2, '0')}` : '');
  const sel = 'h-full min-w-0 flex-1 cursor-pointer appearance-none bg-transparent px-2 text-[14px] text-ink outline-none focus-visible:!outline-none';
  return (
    <FieldShell label={label} error={error ? errText(t, error) : undefined} valid={!error && value !== ''} icon={icon} errLines={errLines} className={className}>
      {({ id, describedBy, invalid }) => (
        <div role="group" aria-label={label} className="flex min-w-0 flex-1 divide-x divide-slate-200">
          <select id={id} aria-label={t('auth:fields.month')} aria-invalid={invalid} aria-describedby={describedBy} aria-required className={`${sel} ${month ? '' : 'text-slate-500'}`} value={month}
            onChange={(e) => { setMonth(e.target.value); emit(e.target.value, year); }} onBlur={onBlur}>
            <option value="">{t('auth:placeholders.month')}</option>
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={String(i + 1)}>{t(`options:months.${i + 1}`)}</option>)}
          </select>
          <select aria-label={t('auth:fields.yearShort')} aria-invalid={invalid} aria-describedby={describedBy} aria-required className={`${sel} max-w-[5.2rem] ${year ? '' : 'text-slate-500'}`} value={year}
            onChange={(e) => { setYear(e.target.value); emit(month, e.target.value); }} onBlur={onBlur}>
            <option value="">{t('auth:placeholders.year')}</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      )}
    </FieldShell>
  );
}

// ───────────────────────── Password input with eye toggle ─────────────────────────
export function PasswordField(props: {
  name: string; label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; error?: string; valid?: boolean;
  icon?: ReactNode; autoComplete: 'new-password' | 'current-password'; errLines?: 1 | 2 | 'r'; className?: string; maxLength?: number; placeholder?: string;
}) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const toggleLabel = t(show ? 'auth:common.hidePassword' : 'auth:common.showPassword');
  return (
    <TextField {...props} type={show ? 'text' : 'password'} maxLength={props.maxLength ?? 64} placeholder={props.placeholder ?? t('auth:placeholders.password')}
      trailing={
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={toggleLabel} aria-pressed={show} title={toggleLabel}
          className="grid w-8 shrink-0 place-items-center text-slate-600 hover:text-brand">
          {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      } />
  );
}

// ───────────────────────── Searchable city dropdown with "Other" free text ─────────────────────────
export function CityField({ label, city, cityOther, keys, onChange, onBlur, error, errorOther, icon, errLines, className }: {
  label: string; city: string; cityOther: string; keys: readonly string[];
  onChange: (city: string, other: string) => void; onBlur?: () => void; error?: string; errorOther?: string; icon?: ReactNode; errLines?: 1 | 2 | 'r'; className?: string;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const labelOf = (k: string) => t(`options:cities.${k}`);
  const items = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return keys.filter((k) => k === 'other' || !q || labelOf(k).toLocaleLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, keys, t]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const otherMode = city === 'other';
  const err = otherMode ? (errorOther ?? error) : error;
  const pick = (k: string) => { onChange(k, ''); setOpen(false); setQuery(''); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };
  return (
    <div ref={wrap} className={`relative min-w-0 ${className ?? ''}`}>
      <FieldShell label={label} error={err ? errText(t, err) : undefined} valid={!err && (otherMode ? cityOther !== '' : city !== '')} icon={icon} errLines={errLines}
        trailing={otherMode ? (
          <button type="button" onClick={() => { onChange('', ''); setQuery(''); }} aria-label={t('auth:common.useList')} title={t('auth:common.useList')} className="grid w-8 shrink-0 place-items-center text-slate-600 hover:text-brand">
            <ChevronLeft size={16} aria-hidden />
          </button>
        ) : <ChevronDown aria-hidden size={16} className="pointer-events-none -ml-6 mr-1.5 self-center text-slate-500" />}>
        {({ id, describedBy, invalid, cls }) => otherMode ? (
          <input id={id} name="cityOther" value={cityOther} maxLength={60} autoFocus placeholder={t('auth:placeholders.cityOther')} aria-invalid={invalid} aria-describedby={describedBy} aria-required
            className={cls} autoComplete="address-level2" onChange={(e) => onChange('other', e.target.value)} onBlur={onBlur} />
        ) : (
          <input id={id} name="city" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && items[active] ? `${listId}-${items[active]}` : undefined}
            aria-invalid={invalid} aria-describedby={describedBy} aria-required autoComplete="off" className={`${cls} pr-6`} maxLength={40}
            placeholder={t('auth:placeholders.search')} value={open ? query : city ? labelOf(city) : ''}
            onFocus={() => { setOpen(true); setQuery(''); setActive(0); }}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
            onKeyDown={onKey} onBlur={() => { setOpen(false); onBlur?.(); }} />
        )}
      </FieldShell>
      {open && !otherMode && (
        <ul id={listId} role="listbox" aria-label={label} className="absolute left-0 right-0 top-[3.1rem] z-30 max-h-48 overflow-auto rounded-xl border border-slate-200 bg-white py-1 text-[14px] shadow-xl">
          {items.length === 0 && <li className="px-3 py-2 text-muted">{t('auth:common.noResults')}</li>}
          {items.map((k, i) => (
            <li key={k} id={`${listId}-${k}`} role="option" aria-selected={city === k} onMouseDown={(e) => { e.preventDefault(); pick(k); }} onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between px-3 py-1.5 ${i === active ? 'bg-brand-50' : ''} ${k === 'other' ? 'border-t border-slate-100 font-semibold text-brand' : ''}`}>
              {labelOf(k)}{city === k && <Check size={14} aria-hidden className="text-brand" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────── 6-box verification code ─────────────────────────
export function CodeBoxes({ value, onChange, invalid, onComplete, disabled }: { value: string; onChange: (v: string) => void; invalid?: boolean; onComplete?: (v: string) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  const apply = (next: string, focus?: number) => {
    const clean = next.replace(/[^0-9]/g, '').slice(0, 6);
    onChange(clean);
    if (focus !== undefined) refs.current[Math.min(focus, 5)]?.focus();
    if (clean.length === 6) onComplete?.(clean);
  };
  return (
    <div role="group" aria-label={t('auth:verify.codeLabel')} className="flex justify-center gap-2 xs:gap-2.5">
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} value={d} disabled={disabled} inputMode="numeric" pattern="[0-9]*" maxLength={1}
          autoComplete={i === 0 ? 'one-time-code' : 'off'} aria-label={t('auth:verify.digit', { n: i + 1 })} aria-invalid={invalid}
          className={`h-12 w-10 rounded-2xl border-[1.5px] bg-white text-center text-xl font-extrabold text-navy outline-none transition-colors focus:border-brand focus:outline focus:outline-[3px] focus:outline-offset-1 focus:outline-brand xs:w-11 ${invalid ? 'border-danger' : d ? 'border-brand/60' : 'border-slate-300'}`}
          onChange={(e) => {
            const ch = e.target.value.replace(/[^0-9]/g, '');
            if (!ch) return;
            const arr = digits.slice(); arr[i] = ch.slice(-1);
            apply(arr.join('').slice(0, 6), i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              const arr = digits.slice();
              if (arr[i]) { arr[i] = ''; apply(arr.join('')); } else if (i > 0) { arr[i - 1] = ''; apply(arr.join('')); refs.current[i - 1]?.focus(); }
            } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 6);
            if (text) apply(text, text.length);
          }}
          onFocus={(e) => e.target.select()} />
      ))}
    </div>
  );
}

// ───────────────────────── Password checklist + strength meter ─────────────────────────
const RULES: PasswordRule[] = ['length', 'upper', 'lower', 'digit', 'special', 'noSpace', 'noPersonal', 'notCommon'];
export function PasswordChecklist({ password, ctx, compact }: { password: string; ctx: PasswordContext; compact?: boolean }) {
  const { t } = useTranslation();
  const ctxKey = `${ctx.studentId ?? ''}|${ctx.name ?? ''}|${ctx.surname ?? ''}|${ctx.email ?? ''}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { checks, score } = useMemo(() => ({ checks: passwordChecks(password, ctx), score: passwordStrength(password, ctx) }), [password, ctxKey]);
  const color = ['bg-slate-300', 'bg-danger', 'bg-amber-500', 'bg-lime-500', 'bg-ok'][score];
  return (
    <div aria-label={t('auth:password.checklist')} role="group" className="min-w-0">
      <div className="mb-1 flex items-center gap-2">
        <div className="flex h-1.5 w-24 gap-0.5" aria-hidden>
          {[1, 2, 3, 4].map((n) => <span key={n} className={`h-full flex-1 rounded-full ${score >= n ? color : 'bg-slate-300'}`} />)}
        </div>
        <span className="text-[11px] font-bold leading-none text-navy">{t('auth:password.strength.label')}: <span aria-live="polite">{t(`auth:password.strength.${score}`)}</span></span>
      </div>
      <ul className="flex flex-wrap gap-x-2.5 gap-y-0.5">
        {RULES.map((r) => (
          <li key={r} className={`flex items-center gap-1 ${compact ? 'text-[10.5px]' : 'text-[11px]'} leading-[14px] ${checks[r] ? 'font-semibold text-ok-text' : 'text-muted'}`}>
            <span aria-hidden className={`grid h-3 w-3 shrink-0 place-items-center rounded-full ${checks[r] ? 'bg-ok text-white' : 'bg-slate-300 text-slate-600'}`}>
              {checks[r] ? <Check size={9} strokeWidth={4} /> : <X size={9} strokeWidth={3} />}
            </span>
            {t(`auth:password.rules.${r}`)}
            <span className="sr-only">: {t(checks[r] ? 'auth:password.met' : 'auth:password.unmet')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────────────────── Terms checkbox + modal ─────────────────────────
export function TermsCheckbox({ checked, onChange, error, onOpen }: { checked: boolean; onChange: (v: boolean) => void; error?: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="min-w-0">
      <div className="flex items-start gap-2">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-invalid={!!error} aria-required aria-describedby={error ? `${id}-e` : undefined}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand-dark" />
        <label htmlFor={id} className="text-[12px] leading-4 text-navy">
          {t('auth:terms.prefix')}{' '}
          <button type="button" onClick={onOpen} className="font-bold text-brand underline underline-offset-2 hover:text-brand-dark">{t('auth:terms.link')}</button>
        </label>
      </div>
      {error && <p id={`${id}-e`} className="mt-0.5 text-[11px] leading-[13px] text-danger-text">{errText(t, error)}</p>}
    </div>
  );
}

export function TermsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy/60 p-4" role="presentation" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="terms-title" className="max-h-[90dvh] w-full max-w-md overflow-auto rounded-3xl bg-white p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="terms-title" className="mb-3 text-lg font-extrabold text-navy">{t('auth:terms.title')}</h2>
        <p className="mb-2 text-sm text-ink">{t('auth:terms.body1')}</p>
        <p className="mb-2 text-sm text-ink">{t('auth:terms.body2')}</p>
        <p className="mb-4 text-sm text-ink">{t('auth:terms.body3')}</p>
        <button ref={ref} type="button" onClick={onClose} className="h-10 w-full rounded-lg bg-navy hover:bg-navy-deep btn-press text-sm font-bold text-white">{t('auth:terms.accept')}</button>
      </div>
    </div>
  );
}
