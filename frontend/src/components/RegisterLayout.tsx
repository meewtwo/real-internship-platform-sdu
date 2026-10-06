import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppForm } from '../lib/form';
import { useWizardMode } from '../lib/useWizard';

export interface Cell { name: string; span: 1 | 2 | 3 | 4; half?: boolean; pair?: boolean; render: (errLines: 1 | 2 | 'r', wizard: boolean) => ReactNode }
export interface Step { title: string; fields: string[] }
export interface FooterItem { key: string; span: 1 | 2 | 3 | 4; node: ReactNode; className?: string }

const SPAN = { 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3', 4: 'col-span-4' } as const;

/**
 * Desktop (>=1024x700): every field in one compact 4-column grid, no scrolling.
 * Smaller: 3-step wizard with progress indicator; every step also fits the viewport.
 * The submit/next button stays disabled until the (step's) fields are valid; Enter cannot bypass it.
 */
export function RegisterLayout({ stepKey, steps, cells, form, desktopFooter, wizardExtras, submitLabel, submittingLabel, submitting, onSubmit, banner }: {
  stepKey: string; steps: Step[]; cells: Cell[]; form: AppForm<never>; desktopFooter: (submit: ReactNode) => FooterItem[]; wizardExtras: ReactNode;
  submitLabel: string; submittingLabel: string; submitting: boolean; onSubmit: () => void; banner?: ReactNode;
}) {
  const { t } = useTranslation();
  const wizard = useWizardMode();
  const storageKey = `step:${stepKey}`;
  const [step, setStepState] = useState(() => {
    try { return Math.min(Number(sessionStorage.getItem(storageKey)) || 0, steps.length - 1); } catch { return 0; }
  });
  const setStep = (n: number) => { setStepState(n); try { sessionStorage.setItem(storageKey, String(n)); } catch { /* ignore */ } };
  const byName = new Map(cells.map((c) => [c.name, c]));
  const last = step === steps.length - 1;

  // jump to the first step that holds a server-side error
  useEffect(() => {
    if (!wizard) return;
    const i = steps.findIndex((s) => s.fields.some((f) => form.shown(f) && !form.errors[f]));
    if (i >= 0 && i !== step) setStep(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.shown]);

  const current = steps[step];
  const submitDisabled = submitting || !form.valid;
  const nextDisabled = !form.stepValid(current.fields);

  const handle = (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!wizard || last) {
      form.markSubmitted();
      if (form.valid) onSubmit(); // backend re-checks everything anyway
      return;
    }
    form.touchAll(current.fields);
    if (!nextDisabled) setStep(step + 1);
  };

  const submitBtn = (
    <button type="submit" disabled={submitDisabled} aria-disabled={submitDisabled}
      className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-navy hover:bg-navy-deep btn-press px-3 text-[14px] font-extrabold text-white  transition  disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none">
      {submitting ? <><Loader2 size={16} className="animate-spin" aria-hidden />{submittingLabel}</> : submitLabel}
    </button>
  );

  if (!wizard) {
    return (
      <form onSubmit={handle} noValidate className="min-w-0">
        {banner}
        <div className="grid grid-cols-4 gap-x-3">
          {cells.map((c) => <div key={c.name} className={`${SPAN[c.span]} min-w-0`}>{c.render(2, false)}</div>)}
          {desktopFooter(submitBtn).map((f) => <div key={f.key} className={`${SPAN[f.span]} min-w-0 ${f.className ?? ''}`}>{f.node}</div>)}
        </div>
      </form>
    );
  }
  const pct = steps.length > 1 ? (step / (steps.length - 1)) * 100 : 0;
  return (
    <form onSubmit={handle} noValidate className="min-w-0">
      <div className="flex gap-2.5 sm:gap-4">
        {/* vertical stepper: filled line + numbered nodes (done = check, current = orange) */}
        <ol aria-label={t('step', { current: step + 1, total: steps.length })} className="relative flex shrink-0 flex-col justify-between py-0.5">
          <span aria-hidden className="absolute bottom-3 left-[11px] top-3 w-0.5 rounded bg-line" />
          <span aria-hidden className="absolute left-[11px] top-3 w-0.5 rounded bg-navy transition-[height] duration-500" style={{ height: `calc((100% - 1.5rem) * ${pct / 100})` }} />
          {steps.map((s, i) => {
            const done = i < step, cur = i === step;
            return (
              <li key={s.title} className="relative z-10 flex items-center gap-2.5">
                <button type="button" disabled={!done} onClick={() => setStep(i)} aria-current={cur ? 'step' : undefined} aria-label={s.title}
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-[11px] font-extrabold transition-colors ${done ? 'border-navy bg-navy text-white hover:bg-navy-deep' : cur ? 'pulse-dot border-orange bg-white text-orange-dark' : 'border-line bg-white text-muted'}`}>
                  {done ? <Check size={12} strokeWidth={3.5} aria-hidden /> : i + 1}
                </button>
                <span className={`hidden max-w-[7.5rem] text-[12px] font-bold leading-tight md:block ${cur ? 'text-navy' : 'text-muted'}`}>{s.title}</span>
              </li>
            );
          })}
        </ol>
        <div className="min-w-0 flex-1">
          <p className="mb-1.5 flex items-center justify-between text-[12px] font-bold text-navy"><span>{t('step', { current: step + 1, total: steps.length })}</span><span className="truncate pl-2 text-orange-dark md:hidden">{current.title}</span></p>
          {banner}
          <div className="grid grid-cols-2 gap-x-3">
            {current.fields.filter((n) => byName.has(n)).map((n) => {
              const c = byName.get(n)!;
              return <div key={n} className={`${c.half ? 'col-span-1' : c.pair ? 'col-span-2 md:col-span-1' : 'col-span-2'} min-w-0`}>{c.render(c.half ? 2 : c.pair ? 'r' : 1, true)}</div>;
            })}
          </div>
          {last && <div className="mb-2 space-y-1.5">{wizardExtras}</div>}
          <div className="flex gap-2">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="btn-press flex h-10 shrink-0 items-center justify-center gap-1 rounded-lg border border-line bg-white px-3 text-[14px] font-bold text-navy hover:bg-brand-50">
                <ArrowLeft size={16} aria-hidden />{t('back')}
              </button>
            )}
            <div className="min-w-0 flex-1">
              {last ? submitBtn : (
                <button type="submit" disabled={nextDisabled} aria-disabled={nextDisabled}
                  className="btn-press flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-navy px-3 text-[14px] font-extrabold text-white hover:bg-navy-deep disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">
                  {t('next')}<ArrowRight size={16} aria-hidden />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
