import { AtSign, Briefcase, Building2, Fingerprint, Globe, Lock, MapPin, Phone, User, Users, Factory, FileText } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CITY_KEYS, COMPANY_SIZE_KEYS, INDUSTRY_KEYS, formatPhoneMask, validateEmployerRegistration } from '@sdu/shared';
import { CityField, PasswordChecklist, PasswordField, SelectField, SelectWithOtherField, TermsCheckbox, TermsModal } from '../components/Controls';
import { FieldShell, TextField } from '../components/Field';
import { RegisterLayout, type Cell, type Step } from '../components/RegisterLayout';
import { api, ApiError } from '../lib/api';
import { apiErrText, errText } from '../lib/errors';
import { useAppForm } from '../lib/form';
import type { PendingVerify } from './VerifyCode';

const DEFAULTS = {
  companyName: '', bin: '', industry: '', industryOther: '', size: '', city: '', cityOther: '', contactName: '', contactSurname: '', position: '', email: '', phone: '',
  website: '', description: '', password: '', confirmPassword: '', acceptTerms: false,
};
type V = typeof DEFAULTS;

export function DescriptionField({ label, value, onChange, onBlur, error, errLines, tall, icon }: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; error?: string; errLines?: 1 | 2 | 'r'; tall?: boolean; icon?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const n = Array.from(value).length;
  return (
    <FieldShell label={label} error={error ? errText(t, error) : undefined} valid={!error && value.trim() !== ''} icon={icon} errLines={errLines}
      labelRight={<span className={`text-[11px] font-semibold ${n > 500 ? 'text-danger-text' : 'text-muted'}`} aria-live="off">{t('auth:common.chars', { n, max: 500 })}</span>}
      boxClass={tall ? 'h-[60px]' : undefined}>
      {({ id, describedBy, invalid }) => (
        <textarea id={id} name="description" value={value} rows={tall ? 3 : 1} placeholder={t('auth:placeholders.description')} aria-invalid={invalid} aria-describedby={describedBy}
          className="min-w-0 flex-1 resize-none bg-transparent px-2.5 py-1.5 text-[14px] leading-5 text-ink outline-none placeholder:text-slate-500 focus-visible:!outline-none"
          onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
      )}
    </FieldShell>
  );
}

export function EmployerRegister({ onRegistered }: { onRegistered: (p: PendingVerify) => void }) {
  const { t, i18n } = useTranslation();
  const [termsOpen, setTermsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState('');
  const validate = useCallback((v: V) => validateEmployerRegistration(v), []);
  const form = useAppForm<V>({ defaults: DEFAULTS, validate, draftKey: 'draft:employer', neverPersist: ['password', 'confirmPassword', 'acceptTerms'] });
  const { values: v, shown, set, touch } = form;
  const blur = (n: string) => () => touch(n);
  const ok = (n: string) => !form.errors[n];
  const opt = (group: string, keys: readonly string[]) => keys.map((k) => ({ value: k, label: t(`options:${group}.${k}`) }));

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true); setBanner('');
    try {
      const payload = { ...v, website: v.website.trim() === '' ? undefined : v.website, description: v.description.trim() === '' ? undefined : v.description, language: i18n.language };
      const r = await api<{ role: 'employer'; identifier: string; email: string; resendAfter: number }>('POST', '/api/auth/register/employer', payload);
      try { sessionStorage.removeItem('draft:employer'); sessionStorage.removeItem('step:employer'); } catch { /* ignore */ }
      onRegistered({ role: 'employer', identifier: r.identifier, email: r.email, resendAt: Date.now() + r.resendAfter * 1000 });
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) form.setServerErrors(e.fields);
      else setBanner(apiErrText(t, e));
    } finally { setSubmitting(false); }
  };

  const cells: Cell[] = [
    { name: 'companyName', span: 2, render: (l) => <TextField name="companyName" label={t('auth:fields.companyName')} value={v.companyName} errLines={l} icon={<Building2 size={16} />} maxLength={100} autoComplete="organization" placeholder={t('auth:placeholders.companyName')} onChange={(x) => set('companyName', x)} onBlur={blur('companyName')} error={shown('companyName')} valid={ok('companyName')} /> },
    { name: 'bin', span: 1, pair: true, render: (l) => <TextField name="bin" label={t('auth:fields.bin')} value={v.bin} errLines={l} icon={<Fingerprint size={16} />} inputMode="numeric" maxLength={12} placeholder={t('auth:placeholders.bin')} onChange={(x) => set('bin', x.replace(/[^0-9]/g, '').slice(0, 12))} onBlur={blur('bin')} error={shown('bin')} valid={ok('bin')} /> },
    { name: 'industry', span: 1, half: true, render: (l) => <SelectWithOtherField name="industry" otherName="industryOther" label={t('auth:fields.industry')} otherLabel={t('auth:fields.industryOther')} otherPlaceholder={t('auth:placeholders.industryOther')} value={v.industry} other={v.industryOther} errLines={l} icon={<Factory size={16} />} placeholder={t('auth:placeholders.select')} options={opt('industries', INDUSTRY_KEYS)}
      onChange={(x, o) => { set('industry', x); set('industryOther', o); }} onBlur={blur('industry')} onBlurOther={blur('industryOther')} error={shown('industry')} errorOther={shown('industryOther')} valid={ok('industry')} validOther={ok('industryOther')} /> },
    { name: 'size', span: 1, half: true, render: (l) => <SelectField name="size" label={t('auth:fields.size')} value={v.size} errLines={l} icon={<Users size={16} />} placeholder={t('auth:placeholders.select')} options={opt('sizes', COMPANY_SIZE_KEYS)} onChange={(x) => set('size', x)} onBlur={blur('size')} error={shown('size')} valid={ok('size')} /> },
    { name: 'city', span: 1, pair: true, render: (l) => <CityField label={t('auth:fields.city')} city={v.city} cityOther={v.cityOther} keys={CITY_KEYS} errLines={l} icon={<MapPin size={16} />} onChange={(c, o) => { set('city', c); set('cityOther', o); }} onBlur={blur('city')} error={shown('city')} errorOther={shown('cityOther')} /> },
    { name: 'contactName', span: 1, half: true, render: (l) => <TextField name="contactName" label={t('auth:fields.contactName')} value={v.contactName} errLines={l} icon={<User size={16} />} maxLength={50} autoComplete="given-name" placeholder={t('auth:placeholders.name')} onChange={(x) => set('contactName', x)} onBlur={blur('contactName')} error={shown('contactName')} valid={ok('contactName')} /> },
    { name: 'contactSurname', span: 1, half: true, render: (l) => <TextField name="contactSurname" label={t('auth:fields.contactSurname')} value={v.contactSurname} errLines={l} icon={<User size={16} />} maxLength={50} autoComplete="family-name" placeholder={t('auth:placeholders.surname')} onChange={(x) => set('contactSurname', x)} onBlur={blur('contactSurname')} error={shown('contactSurname')} valid={ok('contactSurname')} /> },
    { name: 'position', span: 1, pair: true, render: (l) => <TextField name="position" label={t('auth:fields.position')} value={v.position} errLines={l} icon={<Briefcase size={16} />} maxLength={80} autoComplete="organization-title" placeholder={t('auth:placeholders.position')} onChange={(x) => set('position', x)} onBlur={blur('position')} error={shown('position')} valid={ok('position')} /> },
    { name: 'email', span: 2, render: (l) => <TextField name="email" label={t('auth:fields.workEmail')} value={v.email} errLines={l} icon={<AtSign size={16} />} type="email" inputMode="email" maxLength={254} autoComplete="email" placeholder={t('auth:placeholders.workEmail')} onChange={(x) => set('email', x.replace(/\s/g, ''))} onBlur={blur('email')} error={shown('email')} valid={ok('email')} /> },
    { name: 'phone', span: 1, pair: true, render: (l) => <TextField name="phone" label={t('auth:fields.phone')} value={v.phone} errLines={l} icon={<Phone size={16} />} type="tel" inputMode="tel" maxLength={18} autoComplete="tel" placeholder={t('auth:placeholders.phone')} onChange={(x) => set('phone', formatPhoneMask(x))} onFocus={() => { if (!v.phone) set('phone', '+7 (7', { silent: true }); }} onBlur={() => { if (v.phone === '+7 (7') set('phone', ''); touch('phone'); }} error={shown('phone')} valid={ok('phone')} /> },
    { name: 'website', span: 1, render: (l) => <TextField name="website" label={t('auth:fields.website')} value={v.website} errLines={l} icon={<Globe size={16} />} type="url" inputMode="url" maxLength={200} autoComplete="url" placeholder={t('auth:placeholders.website')} onChange={(x) => set('website', x.replace(/\s/g, ''))} onBlur={blur('website')} error={shown('website')} valid={ok('website') && v.website !== ''} /> },
    { name: 'description', span: 2, render: (l, w) => <DescriptionField label={t('auth:fields.description')} value={v.description} errLines={l} tall={!w} icon={<FileText size={16} />} onChange={(x) => set('description', x.slice(0, 600))} onBlur={blur('description')} error={shown('description')} /> },
    { name: 'password', span: 1, pair: true, render: (l) => <PasswordField name="password" label={t('auth:fields.password')} value={v.password} errLines={l} icon={<Lock size={16} />} autoComplete="new-password" onChange={(x) => { set('password', x); if (v.confirmPassword) touch('confirmPassword'); }} onBlur={blur('password')} error={shown('password')} valid={ok('password')} /> },
    { name: 'confirmPassword', span: 1, pair: true, render: (l) => <PasswordField name="confirmPassword" label={t('auth:fields.confirmPassword')} value={v.confirmPassword} errLines={l} icon={<Lock size={16} />} autoComplete="new-password" onChange={(x) => set('confirmPassword', x)} onBlur={blur('confirmPassword')} error={shown('confirmPassword')} valid={ok('confirmPassword') && v.password !== ''} /> },
  ];
  const steps: Step[] = [
    { title: t('auth:register.steps.e1'), fields: ['companyName', 'bin', 'city', 'industry', 'industryOther', 'size'] },
    { title: t('auth:register.steps.e2'), fields: ['contactName', 'contactSurname', 'position', 'phone', 'email'] },
    { title: t('auth:register.steps.e3'), fields: ['website', 'description', 'password', 'confirmPassword', 'acceptTerms'] },
  ];
  const ctx = { name: v.contactName, surname: v.contactSurname, email: v.email };
  const checklist = <PasswordChecklist password={v.password} ctx={ctx} compact />;
  const terms = <TermsCheckbox checked={v.acceptTerms} onChange={(c) => { set('acceptTerms', c); touch('acceptTerms'); }} error={shown('acceptTerms')} onOpen={() => setTermsOpen(true)} />;
  return (
    <>
      <RegisterLayout stepKey="employer" steps={steps} cells={cells} form={form as never} submitLabel={t('auth:register.create')} submittingLabel={t('auth:register.creating')} submitting={submitting} onSubmit={() => void submit()}
        banner={banner ? <p role="alert" className="mb-2 rounded-xl bg-danger/10 px-3 py-1.5 text-[12px] font-semibold text-danger-text">{banner}</p> : null}
        wizardExtras={<>{checklist}{terms}</>}
        desktopFooter={(btn) => [
          { key: 'ct', span: 2, node: <div className="space-y-1">{checklist}{terms}</div> },
          { key: 'bt', span: 1, node: btn, className: 'self-start pt-5' },
        ]} />
      <TermsModal open={termsOpen} onClose={() => setTermsOpen(false)} />
    </>
  );
}
