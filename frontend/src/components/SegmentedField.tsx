import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { errText } from '../lib/errors';
import { Segmented } from './Controls';

export function SegmentedField<T extends string>({ name, label, value, options, onChange, error, errLines = 2, className = '' }: {
  name: string; label: string; value: T | ''; options: { value: T; label: string }[]; onChange: (v: T) => void; error?: string; errLines?: 1 | 2 | 'r'; className?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className={`min-w-0 ${className}`}>
      <span id={id} className="mb-0.5 block truncate text-[12px] font-bold leading-4 text-navy" title={label}>{label}</span>
      <Segmented name={name} value={(value || '') as T} options={options} onChange={onChange} labelledBy={id} size="md" />
      <p aria-live="polite" className={`mt-0.5 overflow-hidden text-[11px] leading-[13px] text-danger-text ${errLines === 2 ? 'min-h-[26px]' : errLines === 'r' ? 'min-h-[13px] md:min-h-[26px]' : 'min-h-[13px]'}`}>{error ? errText(t, error) : ''}</p>
    </div>
  );
}
