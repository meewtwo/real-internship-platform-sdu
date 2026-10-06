import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, type FieldValues } from 'react-hook-form';
import type { ErrorCode, FieldErrors, ParseResult } from '@sdu/shared';

type Validate<V> = (values: V) => ParseResult<unknown>;

const readDraft = <V,>(key: string | undefined, defaults: V): V => {
  if (!key) return defaults;
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<V>) } : defaults;
  } catch { return defaults; }
};

export interface AppForm<V extends FieldValues> {
  values: V;
  /** Current validation errors for ALL fields (error codes, translated at render time). */
  errors: FieldErrors;
  valid: boolean;
  set: <K extends keyof V & string>(name: K, value: V[K], opts?: { silent?: boolean }) => void;
  touch: (name: string) => void;
  /** Error to display for a field (after the user touched it / tried to submit / server said so). */
  shown: (name: string) => ErrorCode | undefined;
  stepValid: (names: readonly string[]) => boolean;
  markSubmitted: () => void;
  setServerErrors: (fields: FieldErrors) => void;
  touchAll: (names: readonly string[]) => void;
  reset: () => void;
}

/**
 * react-hook-form holds the values (and gives `isValid` through a resolver); the SAME shared validators the
 * backend uses produce the error codes. Passwords are never written to sessionStorage.
 */
export function useAppForm<V extends FieldValues>(opts: {
  defaults: V; validate: Validate<V>; draftKey?: string; neverPersist?: readonly string[];
}): AppForm<V> {
  const { defaults, validate, draftKey, neverPersist = [] } = opts;
  const rhf = useForm<V>({ defaultValues: readDraft(draftKey, defaults) as never, mode: 'onChange' });
  const values = rhf.watch() as V;
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [server, setServer] = useState<FieldErrors>({});

  const valuesKey = JSON.stringify(values);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => validate(values), [validate, valuesKey]);
  const errors = useMemo<FieldErrors>(() => (result.ok ? {} : result.fields), [result]);

  // persist non-sensitive values for Back/Refresh during the wizard
  const skip = useRef(neverPersist);
  useEffect(() => {
    if (!draftKey) return;
    const id = setTimeout(() => {
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(JSON.parse(valuesKey) as Record<string, unknown>)) if (!skip.current.includes(k)) safe[k] = v;
      try { sessionStorage.setItem(draftKey, JSON.stringify(safe)); } catch { /* quota / private mode */ }
    }, 250);
    return () => clearTimeout(id);
  }, [valuesKey, draftKey]);

  const set = useCallback(<K extends keyof V & string>(name: K, value: V[K], opts?: { silent?: boolean }) => {
    rhf.setValue(name as never, value as never, { shouldDirty: true });
    // a non-empty edit is shown as soon as it is invalid (empty fields only complain after blur/submit)
    const nonEmpty = Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;
    if (nonEmpty && !opts?.silent) setTouched((t) => (t[name] ? t : { ...t, [name]: true }));
    setServer((s) => { if (!(name in s)) return s; const n = { ...s }; delete n[name]; return n; });
    if (name === 'password') setServer((s) => { if (!('confirmPassword' in s)) return s; const n = { ...s }; delete n.confirmPassword; return n; });
  }, [rhf]);
  const touch = useCallback((name: string) => setTouched((t) => (t[name] ? t : { ...t, [name]: true })), []);
  const shown = useCallback((name: string): ErrorCode | undefined => {
    if (server[name]) return server[name];
    return touched[name] || submitted ? errors[name] : undefined;
  }, [server, touched, submitted, errors]);
  const stepValid = useCallback((names: readonly string[]) => names.every((n) => !errors[n]), [errors]);
  const touchAll = useCallback((names: readonly string[]) => setTouched((t) => ({ ...t, ...Object.fromEntries(names.map((n) => [n, true])) })), []);

  return {
    values, errors, valid: result.ok, set, touch, shown, stepValid, touchAll,
    markSubmitted: () => setSubmitted(true), setServerErrors: setServer,
    reset: () => { rhf.reset(defaults as never); setTouched({}); setSubmitted(false); setServer({}); if (draftKey) try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ } },
  };
}
