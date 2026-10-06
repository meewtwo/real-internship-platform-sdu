import { Check, X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errText } from '../lib/errors';

export interface FieldShellProps {
  label: string;
  error?: string;
  valid?: boolean;
  icon?: ReactNode;
  hint?: ReactNode;
  /** Reserved lines for the error text, so the layout never jumps (and never grows past the viewport). */
  errLines?: 1 | 2 | 'r';
  labelRight?: ReactNode;
  disabled?: boolean;
  trailing?: ReactNode;
  className?: string;
  boxClass?: string;
  children: (a: { id: string; describedBy: string | undefined; invalid: boolean; cls: string }) => ReactNode;
}

export const inputCls =
  'h-9 w-full min-w-0 flex-1 bg-transparent px-2.5 text-[14px] text-ink outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:text-slate-500 focus-visible:!outline-none';

/** Label + icon block + input + valid/invalid indicator + error text under the field. */
export function FieldShell({ label, error, valid, icon, hint, errLines = 2, labelRight, disabled, trailing, className = '', boxClass, children }: FieldShellProps) {
  const id = useId();
  const errId = `${id}-err`;
  const invalid = !!error;
  const border = invalid ? 'border-danger' : valid ? 'border-ok' : 'border-slate-300 focus-within:border-brand';
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-0.5 flex items-end justify-between gap-2">
        <label htmlFor={id} className="block min-w-0 truncate text-[12px] font-bold leading-4 text-navy" title={label}>{label}</label>
        {labelRight}
      </div>
      <div className={`flex ${boxClass ?? 'h-9'} items-stretch overflow-hidden rounded-xl border-[1.5px] bg-white transition-colors focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-1 focus-within:outline-brand ${border} ${disabled ? 'bg-slate-100' : ''}`}>
        {icon && <span aria-hidden className={`grid w-9 shrink-0 place-items-center ${invalid ? 'bg-danger/10 text-danger-text' : 'bg-brand-50 text-brand'}`}>{icon}</span>}
        {children({ id, describedBy: error || hint ? errId : undefined, invalid, cls: inputCls })}
        {trailing}
        {invalid && <span aria-hidden className="mr-2 grid w-5 shrink-0 place-items-center self-center"><span className="grid h-4 w-4 place-items-center rounded-full bg-danger text-white"><X size={11} strokeWidth={3} /></span></span>}
        {!invalid && valid && <span aria-hidden className="mr-2 grid w-5 shrink-0 place-items-center self-center"><span className="grid h-4 w-4 place-items-center rounded-full bg-ok text-white"><Check size={11} strokeWidth={3} /></span></span>}
      </div>
      <p id={errId} aria-live="polite" className={`mt-0.5 overflow-hidden text-[11px] leading-[13px] ${invalid ? 'text-danger-text' : 'text-muted'} ${errLines === 2 ? 'min-h-[26px]' : errLines === 'r' ? 'min-h-[13px] md:min-h-[26px]' : 'min-h-[13px]'}`}>
        {error ?? hint}
      </p>
    </div>
  );
}

interface TextFieldProps {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  valid?: boolean;
  icon?: ReactNode;
  type?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url';
  maxLength?: number;
  placeholder?: string;
  autoComplete?: string;
  trailing?: ReactNode;
  disabled?: boolean;
  readOnly?: boolean;
  errLines?: 1 | 2 | 'r';
  className?: string;
  hint?: ReactNode;
  spellCheck?: boolean;
  onFocus?: () => void;
  enterKeyHint?: 'next' | 'done' | 'go';
}

/** Standard text input. `error` is an error CODE; it is translated here so language switches re-translate immediately. */
export function TextField({ name, label, value, onChange, onBlur, onFocus, error, valid, icon, type = 'text', inputMode, maxLength, placeholder, autoComplete, trailing, disabled, readOnly, errLines, className, hint, spellCheck = false, enterKeyHint }: TextFieldProps) {
  const { t } = useTranslation();
  return (
    <FieldShell label={label} error={error ? errText(t, error) : undefined} valid={valid && !error && value !== ''} icon={icon} errLines={errLines} trailing={trailing} disabled={disabled || readOnly} className={className} hint={hint}>
      {({ id, describedBy, invalid, cls }) => (
        <input
          id={id} name={name} type={type} value={value} inputMode={inputMode} maxLength={maxLength} placeholder={placeholder}
          autoComplete={autoComplete} disabled={disabled} readOnly={readOnly} spellCheck={spellCheck} enterKeyHint={enterKeyHint}
          aria-invalid={invalid} aria-describedby={describedBy} aria-required={!readOnly && !disabled ? true : undefined}
          className={cls} autoCapitalize="off"
          onChange={(e) => onChange(e.target.value)} onBlur={onBlur} onFocus={onFocus}
        />
      )}
    </FieldShell>
  );
}

/** Multi-line text with a live counter (box height is fixed; the text scrolls inside). */
export function TextAreaField({ name, label, value, onChange, onBlur, error, max, rows = 5, placeholder, hint }: {
  name: string; label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; error?: string; max: number; rows?: number; placeholder?: string; hint?: string;
}) {
  const { t } = useTranslation();
  const n = Array.from(value).length;
  return (
    <FieldShell label={label} error={error ? errText(t, error) : undefined} valid={!error && value.trim() !== ''} hint={hint} errLines={1}
      labelRight={<span className={`text-[11px] font-semibold ${n > max ? 'text-danger-text' : 'text-muted'}`}>{t('auth:common.chars', { n, max })}</span>}
      boxClass="!h-auto">
      {({ id, describedBy, invalid }) => (
        <textarea id={id} name={name} value={value} rows={rows} placeholder={placeholder} aria-invalid={invalid} aria-describedby={describedBy} aria-required
          className="min-w-0 flex-1 resize-y bg-transparent px-2.5 py-1.5 text-[14px] leading-5 text-ink outline-none placeholder:text-slate-500 focus-visible:!outline-none"
          onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
      )}
    </FieldShell>
  );
}
