import { Banknote, Building2, Calendar, Factory, Loader2, MapPin, TrendingUp, Type } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { CITY_KEYS, INDUSTRY_KEYS, VACANCY_KINDS, WORK_FORMATS, sanitizeGpaInput, validateVacancy } from '@sdu/shared';
import { CityField, SelectField, SelectWithOtherField } from '../../components/Controls';
import { TextAreaField, TextField } from '../../components/Field';
import { TagInput } from '../../components/TagInput';
import { VacancyAutofill, type VacancyDraft } from '../../components/VacancyAutofill';
import { Card, LoadState, PageHeader, btnPrimary } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import { apiErrText } from '../../lib/errors';
import { useAppForm } from '../../lib/form';
import { usePageTitle } from '../../lib/usePageTitle';
import type { VacancyDto } from './VacancyCard';

const D = { title: '', description: '', kind: '', industry: '', industryOther: '', city: '', cityOther: '', workFormat: '', minGpa: '', deadline: '', salaryMin: '', salaryMax: '', requiredSkills: [] as string[] };
type V = typeof D;

export function VacancyForm() {
  const { t } = useTranslation();
  const { id } = useParams();
  const edit = !!id;
  usePageTitle('nav.myVacancies');
  const navigate = useNavigate();
  const toast = useToast();
  const [loaded, setLoaded] = useState(!edit);
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState('');
  const validate = useCallback((v: V) => validateVacancy({ ...v, minGpa: v.minGpa || undefined, deadline: v.deadline || undefined, salaryMin: v.salaryMin || undefined, salaryMax: v.salaryMax || undefined }), []);
  const form = useAppForm<V>({ defaults: D, validate, draftKey: edit ? undefined : 'draft:vacancy' });
  const { values: v, shown, set, touch } = form;
  const ok = (n: string) => !form.errors[n];
  const opt = (g: string, keys: readonly string[]) => keys.map((k) => ({ value: k, label: t(`options:${g}.${k}`) }));

  useEffect(() => {
    if (!edit) return;
    api<{ vacancy: VacancyDto }>('GET', `/api/vacancies/${id}`).then(({ vacancy: x }) => {
      const next: V = { title: x.title, description: x.description, kind: x.kind, industry: x.industry, industryOther: x.industryOther ?? '', city: x.city, cityOther: x.cityOther ?? '', workFormat: x.workFormat, minGpa: x.minGpa ?? '', deadline: x.deadline ?? '', salaryMin: x.salaryMin ? String(x.salaryMin) : '', salaryMax: x.salaryMax ? String(x.salaryMax) : '', requiredSkills: x.requiredSkills };
      for (const [k, val] of Object.entries(next)) set(k as keyof V & string, val as never);
      setLoaded(true);
    }).catch((e) => setLoadErr(apiErrText(t, e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const applyDraft = (d: VacancyDraft) => {
    const str = (x: unknown) => (typeof x === 'string' ? x : undefined);
    const put = <K extends keyof V & string>(k: K, val: V[K] | undefined) => { if (val !== undefined) { set(k, val as never); touch(k); } };
    put('title', str(d.title)?.slice(0, 120)); put('description', str(d.description)?.slice(0, 4000));
    put('kind', d.kind && (VACANCY_KINDS as readonly string[]).includes(d.kind) ? d.kind : undefined);
    put('workFormat', d.workFormat && (WORK_FORMATS as readonly string[]).includes(d.workFormat) ? d.workFormat : undefined);
    if (d.industry && (INDUSTRY_KEYS as readonly string[]).includes(d.industry)) { set('industry', d.industry); if (d.industry !== 'other') set('industryOther', ''); touch('industry'); }
    if (d.city && (CITY_KEYS as readonly string[]).includes(d.city)) { set('city', d.city); set('cityOther', ''); touch('city'); }
    put('minGpa', str(d.minGpa)); put('salaryMin', d.salaryMin ? String(d.salaryMin) : undefined); put('salaryMax', d.salaryMax ? String(d.salaryMax) : undefined);
    put('requiredSkills', d.requiredSkills?.slice(0, 15));
  };

  const submit = async () => {
    form.markSubmitted();
    if (!form.valid || busy) return;
    setBusy(true); setBanner('');
    try {
      const body = { ...v, minGpa: v.minGpa || undefined, deadline: v.deadline || undefined, salaryMin: v.salaryMin || undefined, salaryMax: v.salaryMax || undefined };
      await (edit ? api('PUT', `/api/vacancies/${id}`, body) : api('POST', '/api/vacancies', body));
      if (!edit) form.reset();
      toast(t('app:saved')); navigate('/vacancies/mine');
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) form.setServerErrors(e.fields); else setBanner(apiErrText(t, e));
    } finally { setBusy(false); }
  };
  if (loadErr) return <p role="alert" className="rounded-2xl bg-white p-4 font-semibold text-danger-text">{loadErr}</p>;
  if (!loaded) return <LoadState loading error={null} />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t(edit ? 'app:form.titleEdit' : 'app:form.titleNew')} />
      {!edit && <VacancyAutofill onDraft={applyDraft} />}
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="grid gap-x-4 sm:grid-cols-2">
          {banner && <p role="alert" className="mb-2 rounded-xl bg-danger/10 px-3 py-2 text-[13px] font-semibold text-danger-text sm:col-span-2">{banner}</p>}
          <div className="sm:col-span-2"><TextField name="title" label={t('app:form.title')} value={v.title} icon={<Type size={16} />} maxLength={120} errLines={1} onChange={(x) => set('title', x)} onBlur={() => touch('title')} error={shown('title')} valid={ok('title')} /></div>
          <div className="sm:col-span-2"><TextAreaField name="description" label={t('app:form.description')} value={v.description} max={4000} rows={7} onChange={(x) => set('description', x.slice(0, 4100))} onBlur={() => touch('description')} error={shown('description')} /></div>
          <SelectField name="kind" label={t('app:form.kind')} value={v.kind} icon={<Building2 size={16} />} errLines={1} placeholder={t('auth:placeholders.select')} options={opt('kinds', VACANCY_KINDS)} onChange={(x) => set('kind', x)} onBlur={() => touch('kind')} error={shown('kind')} valid={ok('kind')} />
          <SelectField name="workFormat" label={t('app:form.format')} value={v.workFormat} icon={<Building2 size={16} />} errLines={1} placeholder={t('auth:placeholders.select')} options={opt('formats', WORK_FORMATS)} onChange={(x) => set('workFormat', x)} onBlur={() => touch('workFormat')} error={shown('workFormat')} valid={ok('workFormat')} />
          <SelectWithOtherField name="industry" otherName="industryOther" label={t('app:form.industry')} otherLabel={t('auth:fields.industryOther')} otherPlaceholder={t('auth:placeholders.industryOther')}
            value={v.industry} other={v.industryOther} icon={<Factory size={16} />} errLines={1} placeholder={t('auth:placeholders.select')} options={opt('industries', INDUSTRY_KEYS)}
            onChange={(x, o) => { set('industry', x); set('industryOther', o); }} onBlur={() => touch('industry')} onBlurOther={() => touch('industryOther')}
            error={shown('industry')} errorOther={shown('industryOther')} valid={ok('industry')} validOther={ok('industryOther')} />
          <CityField label={t('app:form.city')} city={v.city} cityOther={v.cityOther} keys={CITY_KEYS} errLines={1} icon={<MapPin size={16} />} onChange={(c, o) => { set('city', c); set('cityOther', o); }} onBlur={() => touch('city')} error={shown('city')} errorOther={shown('cityOther')} />
          <TextField name="minGpa" label={t('app:form.minGpa')} value={v.minGpa} icon={<TrendingUp size={16} />} inputMode="decimal" maxLength={4} errLines={1} onChange={(x) => set('minGpa', sanitizeGpaInput(x))} onBlur={() => touch('minGpa')} error={shown('minGpa')} valid={ok('minGpa') && v.minGpa !== ''} />
          <TextField name="deadline" label={t('app:form.deadline')} value={v.deadline} icon={<Calendar size={16} />} type="date" errLines={1} onChange={(x) => set('deadline', x)} onBlur={() => touch('deadline')} error={shown('deadline')} valid={ok('deadline') && v.deadline !== ''} />
          <TextField name="salaryMin" label={t('app:form.salaryMin')} value={v.salaryMin} icon={<Banknote size={16} />} inputMode="numeric" maxLength={9} errLines={1} onChange={(x) => set('salaryMin', x.replace(/\D/g, ''))} onBlur={() => touch('salaryMin')} error={shown('salaryMin')} valid={ok('salaryMin') && v.salaryMin !== ''} />
          <TextField name="salaryMax" label={t('app:form.salaryMax')} value={v.salaryMax} icon={<Banknote size={16} />} inputMode="numeric" maxLength={9} errLines={1} onChange={(x) => set('salaryMax', x.replace(/\D/g, ''))} onBlur={() => touch('salaryMax')} error={shown('salaryMax')} valid={ok('salaryMax') && v.salaryMax !== ''} />
          <div className="sm:col-span-2"><TagInput label={t('app:form.skills')} value={v.requiredSkills} onChange={(x) => { set('requiredSkills', x); touch('requiredSkills'); }} max={15} suggest tooManyCode="VACANCY_SKILLS_TOO_MANY" placeholder={t('app:form.skillsPh')} hint={t('app:form.skillsHint')} error={shown('requiredSkills')} /></div>
          <div className="mt-2 flex justify-end sm:col-span-2">
            <button type="submit" disabled={busy || !form.valid} className={btnPrimary}>{busy ? <Loader2 className="animate-spin" size={16} aria-hidden /> : null}{t(edit ? 'app:form.save' : 'app:form.saveDraft')}</button>
          </div>
        </form>
      </Card>
    </div>
  );
}
