import { AccountSettings } from '../components/AccountSettings';
import { AtSign, BookOpen, Briefcase, Building2, Calendar, Factory, Fingerprint, GraduationCap, Globe, Hash, Loader2, MapPin, Phone, Target, TrendingUp, User, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CITY_KEYS, COMPANY_SIZE_KEYS, INDUSTRY_KEYS, INTEREST_KEYS, MAJOR_KEYS, RELOCATION_KEYS, YEAR_KEYS, formatPhoneMask, sanitizeGpaInput, validateEmployerProfile, validateStudentProfile } from '@sdu/shared';
import { CityField, MonthYearField, SelectField } from '../components/Controls';
import { TextField } from '../components/Field';
import { SegmentedField } from '../components/SegmentedField';
import { TagInput } from '../components/TagInput';
import { useToast } from '../components/Toast';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { apiErrText } from '../lib/errors';
import { useAppForm } from '../lib/form';
import { usePageTitle } from '../lib/usePageTitle';
import { DescriptionField } from './EmployerRegister';

export function Profile() {
  const { user } = useAuth();
  usePageTitle('titles.profile');
  if (!user) return null;
  if (user.role === 'admin') return null;
  return <>{user.role === 'student' ? <StudentProfile /> : <EmployerProfile />}<AccountSettings /></>;
}

const opt = (t: (k: string) => string, group: string, keys: readonly string[]) => keys.map((k) => ({ value: k, label: t(`options:${group}.${k}`) }));

function SaveBar({ dirty, valid, busy, error }: { dirty: boolean; valid: boolean; busy: boolean; error: string }) {
  const { t } = useTranslation();
  return (
    <div className="sticky bottom-0 -mx-4 mt-2 flex items-center justify-between gap-3 rounded-b-3xl bg-white/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <p role="alert" className="min-w-0 text-[13px] font-semibold text-danger-text">{error}</p>
      <button type="submit" disabled={!dirty || !valid || busy} className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-navy hover:bg-navy-deep btn-press px-6 text-[14px] font-extrabold text-white   disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none">
        {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden />{t('saving')}</> : t('save')}
      </button>
    </div>
  );
}

// ───────────────────────── Student ─────────────────────────
const S_DEFAULTS = { name: '', surname: '', phone: '', city: '', cityOther: '', major: '', yearOfStudy: '', gpa: '', graduation: '', interestArea: '', relocation: '', skills: [] as string[], interests: [] as string[] };
type SV = typeof S_DEFAULTS;

function StudentProfile() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [base, setBase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const validate = useCallback((v: SV) => validateStudentProfile(v), []);
  const form = useAppForm<SV>({ defaults: S_DEFAULTS, validate });
  const { values: v, shown, set, touch } = form;

  const apply = useCallback((p: Record<string, unknown>) => {
    const next: SV = {
      name: String(p.name ?? ''), surname: String(p.surname ?? ''), phone: formatPhoneMask(String(p.phone ?? '')), city: String(p.city ?? ''), cityOther: String(p.cityOther ?? ''),
      major: String(p.major ?? ''), yearOfStudy: String(p.yearOfStudy ?? ''), gpa: String(p.gpa ?? ''), graduation: String(p.graduation ?? ''),
      interestArea: String(p.interestArea ?? ''), relocation: String(p.relocation ?? ''), skills: (p.skills as string[]) ?? [], interests: (p.interests as string[]) ?? [],
    };
    for (const [k, val] of Object.entries(next)) set(k as keyof SV & string, val as never);
    setBase(JSON.stringify(next));
  }, [set]);

  useEffect(() => {
    api<{ profile: Record<string, unknown> }>('GET', '/api/profile').then((r) => { apply(r.profile); setLoaded(true); }).catch((e) => setLoadError(apiErrText(t, e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = useMemo(() => loaded && JSON.stringify(v) !== base, [v, base, loaded]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    form.markSubmitted();
    if (!form.valid || busy) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ profile: Record<string, unknown> }>('PUT', '/api/profile/student', v);
      apply(r.profile); toast(t('toast.saved'));
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) form.setServerErrors(err.fields); else setError(apiErrText(t, err));
    } finally { setBusy(false); }
  };
  const ok = (n: string) => !form.errors[n];
  if (loadError) return <p role="alert" className="rounded-2xl bg-white p-4 font-semibold text-danger-text">{loadError}</p>;
  if (!loaded) return <p className="p-4 text-muted">{t('loading')}</p>;
  return (
    <form onSubmit={(e) => void save(e)} noValidate className="rounded-3xl bg-white p-4 shadow-xl ring-1 ring-brand/10 sm:p-6">
      <h1 className="text-2xl font-extrabold text-navy">{t('profile:student.title')}</h1>
      <p className="mb-4 text-sm text-muted">{t('profile:student.subtitle')}</p>
      <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField name="studentId" label={t('profile:readonly.studentId')} value={user?.studentId ?? ''} icon={<Hash size={16} />} readOnly onChange={() => undefined} errLines={1} />
        <TextField name="email" label={t('profile:readonly.email')} value={user?.email ?? ''} icon={<AtSign size={16} />} readOnly onChange={() => undefined} errLines={1} className="lg:col-span-2" />
        <TextField name="name" label={t('auth:fields.name')} value={v.name} icon={<User size={16} />} maxLength={50} autoComplete="given-name" onChange={(x) => set('name', x)} onBlur={() => touch('name')} error={shown('name')} valid={ok('name')} />
        <TextField name="surname" label={t('auth:fields.surname')} value={v.surname} icon={<User size={16} />} maxLength={50} autoComplete="family-name" onChange={(x) => set('surname', x)} onBlur={() => touch('surname')} error={shown('surname')} valid={ok('surname')} />
        <TextField name="phone" label={t('auth:fields.phone')} value={v.phone} icon={<Phone size={16} />} type="tel" inputMode="tel" maxLength={18} autoComplete="tel" placeholder={t('auth:placeholders.phone')} onChange={(x) => set('phone', formatPhoneMask(x))} onBlur={() => touch('phone')} error={shown('phone')} valid={ok('phone')} />
        <CityField label={t('auth:fields.city')} city={v.city} cityOther={v.cityOther} keys={CITY_KEYS} icon={<MapPin size={16} />} onChange={(c, o) => { set('city', c); set('cityOther', o); }} onBlur={() => touch('city')} error={shown('city')} errorOther={shown('cityOther')} />
        <SelectField name="major" label={t('auth:fields.major')} value={v.major} icon={<BookOpen size={16} />} placeholder={t('auth:placeholders.select')} options={opt(t, 'majors', MAJOR_KEYS)} onChange={(x) => set('major', x)} onBlur={() => touch('major')} error={shown('major')} valid={ok('major')} />
        <SelectField name="yearOfStudy" label={t('auth:fields.year')} value={v.yearOfStudy} icon={<GraduationCap size={16} />} placeholder={t('auth:placeholders.select')} options={opt(t, 'years', YEAR_KEYS)} onChange={(x) => { set('yearOfStudy', x); touch('graduation'); }} onBlur={() => touch('yearOfStudy')} error={shown('yearOfStudy')} valid={ok('yearOfStudy')} />
        <TextField name="gpa" label={t('auth:fields.gpa')} value={v.gpa} icon={<TrendingUp size={16} />} inputMode="decimal" maxLength={4} onChange={(x) => set('gpa', sanitizeGpaInput(x))} onBlur={() => touch('gpa')} error={shown('gpa')} valid={ok('gpa')} />
        <MonthYearField label={t('auth:fields.graduation')} value={v.graduation} icon={<Calendar size={16} />} onChange={(x) => { set('graduation', x); touch('graduation'); }} onBlur={() => touch('graduation')} error={shown('graduation')} />
        <SelectField name="interestArea" label={t('auth:fields.interestArea')} value={v.interestArea} icon={<Target size={16} />} placeholder={t('auth:placeholders.select')} options={opt(t, 'interests', INTEREST_KEYS)} onChange={(x) => set('interestArea', x)} onBlur={() => touch('interestArea')} error={shown('interestArea')} valid={ok('interestArea')} />
        <SegmentedField name="relocation" label={t('auth:fields.relocation')} value={v.relocation as never} options={opt(t, 'relocation', RELOCATION_KEYS) as never} onChange={(x) => { set('relocation', x); touch('relocation'); }} error={shown('relocation')} />
        <div className="sm:col-span-2 lg:col-span-3">
          <TagInput label={t('profile:skills.label')} value={v.skills} onChange={(x) => { set('skills', x); touch('skills'); }} max={30} suggest placeholder={t('profile:skills.placeholder')} hint={t('profile:skills.hint')} error={shown('skills')} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <TagInput label={t('profile:interests.label')} value={v.interests} onChange={(x) => { set('interests', x); touch('interests'); }} max={10} placeholder={t('profile:interests.placeholder')} hint={t('profile:interests.hint')} error={shown('interests')} />
        </div>
      </div>
      <SaveBar dirty={dirty} valid={form.valid} busy={busy} error={error} />
    </form>
  );
}

// ───────────────────────── Employer ─────────────────────────
const E_DEFAULTS = { companyName: '', industry: '', size: '', city: '', cityOther: '', contactName: '', contactSurname: '', position: '', phone: '', website: '', description: '' };
type EV = typeof E_DEFAULTS;

function EmployerProfile() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [bin, setBin] = useState('');
  const [base, setBase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const validate = useCallback((v: EV) => validateEmployerProfile({ ...v, website: v.website.trim() || undefined, description: v.description.trim() || undefined }), []);
  const form = useAppForm<EV>({ defaults: E_DEFAULTS, validate });
  const { values: v, shown, set, touch } = form;

  const apply = useCallback((p: Record<string, unknown>) => {
    const next: EV = {
      companyName: String(p.companyName ?? ''), industry: String(p.industry ?? ''), size: String(p.size ?? ''), city: String(p.city ?? ''), cityOther: String(p.cityOther ?? ''),
      contactName: String(p.contactName ?? ''), contactSurname: String(p.contactSurname ?? ''), position: String(p.position ?? ''), phone: formatPhoneMask(String(p.phone ?? '')),
      website: String(p.website ?? ''), description: String(p.description ?? ''),
    };
    setBin(String(p.bin ?? ''));
    for (const [k, val] of Object.entries(next)) set(k as keyof EV & string, val as never);
    setBase(JSON.stringify(next));
  }, [set]);

  useEffect(() => {
    api<{ profile: Record<string, unknown> }>('GET', '/api/profile').then((r) => { apply(r.profile); setLoaded(true); }).catch((e) => setLoadError(apiErrText(t, e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = useMemo(() => loaded && JSON.stringify(v) !== base, [v, base, loaded]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    form.markSubmitted();
    if (!form.valid || busy) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ profile: Record<string, unknown> }>('PUT', '/api/profile/employer', { ...v, website: v.website.trim() || undefined, description: v.description.trim() || undefined });
      apply(r.profile); toast(t('toast.saved'));
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) form.setServerErrors(err.fields); else setError(apiErrText(t, err));
    } finally { setBusy(false); }
  };
  const ok = (n: string) => !form.errors[n];
  if (loadError) return <p role="alert" className="rounded-2xl bg-white p-4 font-semibold text-danger-text">{loadError}</p>;
  if (!loaded) return <p className="p-4 text-muted">{t('loading')}</p>;
  return (
    <form onSubmit={(e) => void save(e)} noValidate className="rounded-3xl bg-white p-4 shadow-xl ring-1 ring-brand/10 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-2xl font-extrabold text-navy">{t('profile:employer.title')}</h1><p className="mb-4 text-sm text-muted">{t('profile:employer.subtitle')}</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${user?.status === 'pending' ? 'bg-amber-100 text-amber-900' : 'bg-lime text-navy'}`}>{t('profile:status.label')}: {t(user?.status === 'pending' ? 'profile:status.pending' : 'profile:status.active')}</span>
      </div>
      <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField name="bin" label={t('profile:readonly.bin')} value={bin} icon={<Fingerprint size={16} />} readOnly onChange={() => undefined} errLines={1} />
        <TextField name="email" label={t('profile:readonly.email')} value={user?.email ?? ''} icon={<AtSign size={16} />} readOnly onChange={() => undefined} errLines={1} className="lg:col-span-2" />
        <TextField name="companyName" label={t('auth:fields.companyName')} value={v.companyName} icon={<Building2 size={16} />} maxLength={100} autoComplete="organization" onChange={(x) => set('companyName', x)} onBlur={() => touch('companyName')} error={shown('companyName')} valid={ok('companyName')} className="lg:col-span-2" />
        <SelectField name="industry" label={t('auth:fields.industry')} value={v.industry} icon={<Factory size={16} />} placeholder={t('auth:placeholders.select')} options={opt(t, 'industries', INDUSTRY_KEYS)} onChange={(x) => set('industry', x)} onBlur={() => touch('industry')} error={shown('industry')} valid={ok('industry')} />
        <SelectField name="size" label={t('auth:fields.size')} value={v.size} icon={<Users size={16} />} placeholder={t('auth:placeholders.select')} options={opt(t, 'sizes', COMPANY_SIZE_KEYS)} onChange={(x) => set('size', x)} onBlur={() => touch('size')} error={shown('size')} valid={ok('size')} />
        <CityField label={t('auth:fields.city')} city={v.city} cityOther={v.cityOther} keys={CITY_KEYS} icon={<MapPin size={16} />} onChange={(c, o) => { set('city', c); set('cityOther', o); }} onBlur={() => touch('city')} error={shown('city')} errorOther={shown('cityOther')} />
        <TextField name="contactName" label={t('auth:fields.contactName')} value={v.contactName} icon={<User size={16} />} maxLength={50} onChange={(x) => set('contactName', x)} onBlur={() => touch('contactName')} error={shown('contactName')} valid={ok('contactName')} />
        <TextField name="contactSurname" label={t('auth:fields.contactSurname')} value={v.contactSurname} icon={<User size={16} />} maxLength={50} onChange={(x) => set('contactSurname', x)} onBlur={() => touch('contactSurname')} error={shown('contactSurname')} valid={ok('contactSurname')} />
        <TextField name="position" label={t('auth:fields.position')} value={v.position} icon={<Briefcase size={16} />} maxLength={80} onChange={(x) => set('position', x)} onBlur={() => touch('position')} error={shown('position')} valid={ok('position')} />
        <TextField name="phone" label={t('auth:fields.phone')} value={v.phone} icon={<Phone size={16} />} type="tel" inputMode="tel" maxLength={18} placeholder={t('auth:placeholders.phone')} onChange={(x) => set('phone', formatPhoneMask(x))} onBlur={() => touch('phone')} error={shown('phone')} valid={ok('phone')} />
        <TextField name="website" label={t('auth:fields.website')} value={v.website} icon={<Globe size={16} />} type="url" inputMode="url" maxLength={200} placeholder={t('auth:placeholders.website')} onChange={(x) => set('website', x.replace(/\s/g, ''))} onBlur={() => touch('website')} error={shown('website')} valid={ok('website') && v.website !== ''} />
        <div className="sm:col-span-2 lg:col-span-3">
          <DescriptionField label={t('auth:fields.description')} value={v.description} tall onChange={(x) => set('description', x.slice(0, 600))} onBlur={() => touch('description')} error={shown('description')} />
        </div>
      </div>
      <SaveBar dirty={dirty} valid={form.valid} busy={busy} error={error} />
    </form>
  );
}
