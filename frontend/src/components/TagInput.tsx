import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { validateTag } from '@sdu/shared';
import { api } from '../lib/api';
import { errText } from '../lib/errors';

export function TagInput({ label, value, onChange, max, placeholder, hint, error, suggest, duplicateHint, tooManyCode }: {
  label: string; value: string[]; onChange: (v: string[]) => void; max: number; placeholder: string; hint: string; error?: string; suggest?: boolean; duplicateHint?: string; tooManyCode?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const [local, setLocal] = useState<string | undefined>();
  const [sugg, setSugg] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!suggest || text.trim().length < 1) { setSugg([]); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api<{ skills: string[] }>('GET', `/api/profile/skills?q=${encodeURIComponent(text.trim())}`)
        .then((r) => setSugg(r.skills.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))))
        .catch(() => setSugg([]));
    }, 180);
    return () => clearTimeout(timer.current);
  }, [text, suggest, value]);

  const add = (raw: string) => {
    const r = validateTag(raw);
    if (!r.ok) { setLocal(r.code); return; }
    if (value.some((v) => v.toLowerCase() === r.value.toLowerCase())) { setText(''); setLocal(undefined); return; }
    if (value.length >= max) { setLocal(tooManyCode ?? (max === 30 ? 'TAGS_TOO_MANY' : 'INTERESTS_TOO_MANY')); return; }
    onChange([...value, r.value]); setText(''); setLocal(undefined); setSugg([]); setActive(-1);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(active >= 0 && sugg[active] ? sugg[active] : text); }
    else if (e.key === 'ArrowDown' && sugg.length) { e.preventDefault(); setActive((a) => Math.min(a + 1, sugg.length - 1)); }
    else if (e.key === 'ArrowUp' && sugg.length) { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
    else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
    else if (e.key === 'Escape') setSugg([]);
  };
  const err = local ?? error;
  return (
    <div className="min-w-0">
      <div className="mb-0.5 flex items-end justify-between">
        <label htmlFor={id} className="text-[12px] font-bold leading-4 text-navy">{label}</label>
        <span className="text-[11px] font-semibold text-muted">{t('profile:skills.count', { n: value.length, max })}</span>
      </div>
      <div className={`relative rounded-xl border-[1.5px] bg-white p-1.5 focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-1 focus-within:outline-brand ${err ? 'border-danger' : 'border-slate-300'}`}>
        <ul className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <li key={v} className="flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-[12px] font-bold text-brand-dark ring-1 ring-brand/20">
              {v}
              <button type="button" aria-label={t('profile:skills.remove', { name: v })} onClick={() => onChange(value.filter((x) => x !== v))} className="grid h-4 w-4 place-items-center rounded-full hover:bg-brand/20"><X size={11} aria-hidden /></button>
            </li>
          ))}
          <li className="min-w-[8rem] flex-1">
            <input id={id} value={text} maxLength={40} placeholder={placeholder} aria-invalid={!!err} aria-describedby={`${id}-h`} autoComplete="off" role={suggest ? 'combobox' : undefined}
              aria-expanded={suggest ? sugg.length > 0 : undefined} aria-autocomplete={suggest ? 'list' : undefined}
              className="h-7 w-full bg-transparent px-1 text-[14px] text-ink outline-none placeholder:text-slate-500 focus-visible:!outline-none"
              onChange={(e) => { setText(e.target.value); setLocal(undefined); setActive(-1); }} onKeyDown={onKey}
              onBlur={() => setTimeout(() => setSugg([]), 120)} />
          </li>
        </ul>
        {sugg.length > 0 && (
          <ul role="listbox" aria-label={t('profile:skills.suggestions')} className="absolute left-0 right-0 top-full z-30 mt-1 max-h-44 overflow-auto rounded-xl border border-slate-200 bg-white py-1 text-[14px] shadow-xl">
            {sugg.map((s, i) => (
              <li key={s} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); add(s); }} className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-brand-50' : ''}`}>{s}</li>
            ))}
          </ul>
        )}
      </div>
      <p id={`${id}-h`} aria-live="polite" className={`mt-0.5 min-h-[13px] text-[11px] leading-[13px] ${err ? 'text-danger-text' : 'text-muted'}`}>{err ? errText(t, err) : (duplicateHint ?? hint)}</p>
    </div>
  );
}
