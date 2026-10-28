import { Banknote, Building2, Calendar, Factory, Loader2, MapPin, Plus, Send, TrendingUp, Type } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { CITY_KEYS, INDUSTRY_KEYS, VACANCY_KINDS, WORK_FORMATS, sanitizeGpaInput, skillKey, validateTag, validateVacancy } from '@sdu/shared';
import { CityField, SelectField, SelectWithOtherField } from '../../components/Controls';
import { TextAreaField, TextField } from '../../components/Field';
import { TagInput } from '../../components/TagInput';
import { VacancyAutofill, type VacancyDraft } from '../../components/VacancyAutofill';
import { Card, LoadState, PageHeader, btnGhost, btnPrimary } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { apiErrText } from '../../lib/errors';
import { useAppForm } from '../../lib/form';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';
import type { VacancyDto } from './VacancyCard';

const MAX_SKILLS = 15;
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
  const [busy, setBusy] = useState<'' | 'save' | 'publish'>('');
  const [requested, setRequested] = useState(false);
  const [banner, setBanner] = useState('');
  const [status, setStatus] = useState('draft');
  // only an approved company (active account) can publish; the API enforces it too
  const canPublish = useAuth().user?.status === 'active';
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
      setStatus(x.status); setRequested(!!x.publishRequested); setLoaded(true);
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

  /** Saves the vacancy; with `publish` it is then published, so students see it (a draft is never shown to them). */
  const submit = async (publish = false) => {
    form.markSubmitted();
    if (!form.valid || busy) return;
    setBusy(publish ? 'publish' : 'save'); setBanner('');
    try {
      const body = { ...v, minGpa: v.minGpa || undefined, deadline: v.deadline || undefined, salaryMin: v.salaryMin || undefined, salaryMax: v.salaryMax || undefined };
      const r = await (edit ? api<{ vacancy: VacancyDto }>('PUT', `/api/vacancies/${id}`, body) : api<{ vacancy: VacancyDto }>('POST', '/api/vacancies', body));
      if (!edit) form.reset();
      if (publish && canPublish) {
        try {
          const p = await api<{ matches: number; queued?: boolean }>('POST', `/api/vacancies/${r.vacancy.id}/publish`);
          toast(p.queued ? t('app:mine.publishedQueued') : t('app:mine.published', { n: p.matches }));
        } catch (e) { toast(t('app:form.publishFailed', { reason: apiErrText(t, e) }), 'error'); }
      } else if (publish) {
        // the company is still waiting: the draft goes live automatically when an admin approves the company
        try { await api('POST', `/api/vacancies/${r.vacancy.id}/publish-request`); toast(t('app:form.requestedToast')); }
        catch (e) { toast(t('app:form.publishFailed', { reason: apiErrText(t, e) }), 'error'); }
      } else toast(r.vacancy.status === 'draft' ? t(r.vacancy.publishRequested ? 'app:form.savedRequested' : 'app:form.savedDraft') : t('app:saved'));
      navigate('/vacancies/mine');
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) form.setServerErrors(e.fields); else setBanner(apiErrText(t, e));
    } finally { setBusy(''); }
  };
  const spin = (k: 'save' | 'publish') => (busy === k ? <Loader2 className="animate-spin" size={16} aria-hidden /> : null);
  const draft = !edit || status === 'draft';
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
          <div className="sm:col-span-2">
            <TagInput label={t('app:form.skills')} value={v.requiredSkills} onChange={(x) => { set('requiredSkills', x); touch('requiredSkills'); }} max={MAX_SKILLS} suggest tooManyCode="VACANCY_SKILLS_TOO_MANY" placeholder={t('app:form.skillsPh')} hint={t('app:form.skillsHint')} error={shown('requiredSkills')} />
            <SkillSuggestions industry={v.industry} value={v.requiredSkills} max={MAX_SKILLS} onAdd={(x) => { set('requiredSkills', x); touch('requiredSkills'); }} />
          </div>
          {draft && <p className="mt-2 text-[12px] text-muted sm:col-span-2">{t(canPublish ? 'app:form.draftHint' : requested ? 'app:form.requestedHint' : 'app:form.draftHintPending')}</p>}
          <div className="mt-2 flex flex-wrap justify-end gap-2 sm:col-span-2">
            {draft && (canPublish || !requested) ? (
              <>
                <button type="submit" disabled={!!busy || !form.valid} className={btnGhost}>{spin('save')}{t(edit ? 'app:form.save' : 'app:form.saveDraft')}</button>
                <button type="button" disabled={!!busy || !form.valid} onClick={() => void submit(true)} className={btnPrimary}>{spin('publish') ?? <Send size={15} aria-hidden />}{t(canPublish ? 'app:form.saveAndPublish' : 'app:form.saveAndRequest')}</button>
              </>
            ) : (
              <button type="submit" disabled={!!busy || !form.valid} className={btnPrimary}>{spin('save')}{t(edit ? 'app:form.save' : 'app:form.saveDraft')}</button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}

/**
 * Clickable skills suggested for the chosen industry (industry_skills, same vocabulary as student profiles). Already added skills are hidden;
 * changing the industry only changes the suggestions, never the skills already chosen. "Other"/no industry → popular general skills.
 */
function SkillSuggestions({ industry, value, max, onAdd }: { industry: string; value: string[]; max: number; onAdd: (next: string[]) => void }) {
  const { t } = useTranslation();
  const { data } = useApi<{ industry: string; skills: string[] }>(`/api/profile/skills/suggested?industry=${encodeURIComponent(industry)}`);
  // the form re-renders after a short delay: two quick clicks must both land, so additions build on the latest list, not on this render's props
  const latest = useRef(value);
  latest.current = value;
  if (!data || data.skills.length === 0) return null;
  const have = new Set(value.map(skillKey));
  const list = data.skills.filter((s) => !have.has(skillKey(s)));
  const full = value.length >= max;
  const add = (name: string) => {
    const r = validateTag(name);
    const cur = latest.current;
    if (!r.ok || cur.length >= max || cur.some((x) => skillKey(x) === skillKey(r.value))) return;
    latest.current = [...cur, r.value];
    onAdd(latest.current);
  };
  return (
    <div className="mb-2" data-testid="skill-suggestions">
      <p className="mb-1 text-[12px] font-bold text-navy">{t(data.industry === 'general' ? 'app:form.suggestedGeneral' : 'app:form.suggested')}</p>
      {list.length === 0 ? <p className="text-[12px] text-muted">{t('app:form.suggestedAllAdded')}</p> : (
        <ul className="flex flex-wrap gap-1.5" aria-label={t(data.industry === 'general' ? 'app:form.suggestedGeneral' : 'app:form.suggested')}>
          {list.map((s) => (
            <li key={s}>
              <button type="button" disabled={full} onClick={() => add(s)} aria-label={t('app:form.suggestAdd', { name: s })}
                className="flex items-center gap-1 rounded-full border border-dashed border-brand/50 bg-white py-0.5 pl-1.5 pr-2.5 text-[12px] font-bold text-brand-dark transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50">
                <Plus size={11} aria-hidden />{s}
              </button>
            </li>
          ))}
        </ul>
      )}
      {full && list.length > 0 && <p className="mt-1 text-[11px] text-muted">{t('app:form.suggestedFull', { max })}</p>}
    </div>
  );
}
