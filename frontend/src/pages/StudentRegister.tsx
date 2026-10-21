import { AtSign, BookOpen, Calendar, GraduationCap, Hash, Lock, MapPin, Phone, Target, TrendingUp, User } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CITY_KEYS, INTEREST_KEYS, MAJOR_KEYS, RELOCATION_KEYS, YEAR_KEYS, formatPhoneMask, sanitizeGpaInput, validateStudentRegistration } from '@sdu/shared';
import { CityField, MonthYearField, PasswordChecklist, PasswordField, SelectField, SelectWithOtherField, TermsCheckbox, TermsModal } from '../components/Controls';
import { TextField } from '../components/Field';
import { RegisterLayout, type Cell, type Step } from '../components/RegisterLayout';
import { SegmentedField } from '../components/SegmentedField';
import { api, ApiError } from '../lib/api';
import { apiErrText } from '../lib/errors';
import { useAppForm } from '../lib/form';
import type { PendingVerify } from './VerifyCode';

const DEFAULTS = {
  studentId: '', name: '', surname: '', email: '', phone: '', city: '', cityOther: '', major: '', yearOfStudy: '', gpa: '', graduation: '',
  interestArea: '', interestOther: '', relocation: '', password: '', confirmPassword: '', acceptTerms: false,
};
type V = typeof DEFAULTS;

export function StudentRegister({ onRegistered }: { onRegistered: (p: PendingVerify) => void }) {
  const { t, i18n } = useTranslation();
  const [termsOpen, setTermsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState('');
  const validate = useCallback((v: V) => validateStudentRegistration(v), []);
  const form = useAppForm<V>({ defaults: DEFAULTS, validate, draftKey: 'draft:student', neverPersist: ['password', 'confirmPassword', 'acceptTerms'] });
  const { values: v, shown, set, touch } = form;
  const blur = (n: string) => () => touch(n);
  const ok = (n: string) => !form.errors[n];
  const opt = (group: string, keys: readonly string[]) => keys.map((k) => ({ value: k, label: t(`options:${group}.${k}`) }));

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true); setBanner('');
    try {
      const r = await api<{ role: 'student'; identifier: string; email: string; resendAfter: number }>('POST', '/api/auth/register/student', { ...v, language: i18n.language });
      try { sessionStorage.removeItem('draft:student'); sessionStorage.removeItem('step:student'); } catch { /* ignore */ }
      onRegistered({ role: 'student', identifier: r.identifier, email: r.email, resendAt: Date.now() + r.resendAfter * 1000 });
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) form.setServerErrors(e.fields);
      else setBanner(apiErrText(t, e));
    } finally { setSubmitting(false); }
  };

  const cells: Cell[] = [
    { name: 'studentId', span: 1, pair: true, render: (l) => (
      <TextField name="studentId" label={t('auth:fields.studentId')} value={v.studentId} errLines={l} icon={<Hash size={16} />} inputMode="numeric" maxLength={9} autoComplete="username" placeholder={t('auth:placeholders.studentId')}
        onChange={(x) => set('studentId', x.replace(/[^0-9]/g, '').slice(0, 9))} onBlur={blur('studentId')} error={shown('studentId')} valid={ok('studentId')} />) },
    { name: 'name', span: 1, half: true, render: (l) => (
      <TextField name="name" label={t('auth:fields.name')} value={v.name} errLines={l} icon={<User size={16} />} maxLength={50} autoComplete="given-name" placeholder={t('auth:placeholders.name')}
        onChange={(x) => set('name', x)} onBlur={blur('name')} error={shown('name')} valid={ok('name')} />) },
    { name: 'surname', span: 1, half: true, render: (l) => (
      <TextField name="surname" label={t('auth:fields.surname')} value={v.surname} errLines={l} icon={<User size={16} />} maxLength={50} autoComplete="family-name" placeholder={t('auth:placeholders.surname')}
        onChange={(x) => set('surname', x)} onBlur={blur('surname')} error={shown('surname')} valid={ok('surname')} />) },
    { name: 'phone', span: 1, pair: true, render: (l) => (
      <TextField name="phone" label={t('auth:fields.phone')} value={v.phone} errLines={l} icon={<Phone size={16} />} type="tel" inputMode="tel" maxLength={18} autoComplete="tel" placeholder={t('auth:placeholders.phone')}
        onChange={(x) => set('phone', formatPhoneMask(x))} onFocus={() => { if (!v.phone) set('phone', '+7 (7', { silent: true }); }}
        onBlur={() => { if (v.phone === '+7 (7') set('phone', ''); touch('phone'); }} error={shown('phone')} valid={ok('phone')} />) },
    { name: 'email', span: 2, render: (l) => (
      <TextField name="email" label={t('auth:fields.email')} value={v.email} errLines={l} icon={<AtSign size={16} />} type="email" inputMode="email" maxLength={254} autoComplete="email" placeholder={t('auth:placeholders.email')}
        onChange={(x) => set('email', x.replace(/\s/g, ''))} onBlur={blur('email')} error={shown('email')} valid={ok('email')} />) },
    { name: 'city', span: 1, pair: true, render: (l) => (
      <CityField label={t('auth:fields.city')} city={v.city} cityOther={v.cityOther} keys={CITY_KEYS} errLines={l} icon={<MapPin size={16} />}
        onChange={(c, o) => { set('city', c); set('cityOther', o); }} onBlur={blur('city')} error={shown('city')} errorOther={shown('cityOther')} />) },
    { name: 'major', span: 1, pair: true, render: (l) => (
      <SelectField name="major" label={t('auth:fields.major')} value={v.major} errLines={l} icon={<BookOpen size={16} />} placeholder={t('auth:placeholders.select')} options={opt('majors', MAJOR_KEYS)}
        onChange={(x) => set('major', x)} onBlur={blur('major')} error={shown('major')} valid={ok('major')} />) },
    { name: 'yearOfStudy', span: 1, half: true, render: (l) => (
      <SelectField name="yearOfStudy" label={t('auth:fields.year')} value={v.yearOfStudy} errLines={l} icon={<GraduationCap size={16} />} placeholder={t('auth:placeholders.select')} options={opt('years', YEAR_KEYS)}
        onChange={(x) => set('yearOfStudy', x)} onBlur={blur('yearOfStudy')} error={shown('yearOfStudy')} valid={ok('yearOfStudy')} />) },
    { name: 'gpa', span: 1, half: true, render: (l) => (
      <TextField name="gpa" label={t('auth:fields.gpa')} value={v.gpa} errLines={l} icon={<TrendingUp size={16} />} inputMode="decimal" maxLength={4} autoComplete="off" placeholder={t('auth:placeholders.gpa')}
        onChange={(x) => set('gpa', sanitizeGpaInput(x))} onBlur={blur('gpa')} error={shown('gpa')} valid={ok('gpa')} />) },
    { name: 'graduation', span: 1, render: (l) => (
      <MonthYearField label={t('auth:fields.graduation')} value={v.graduation} errLines={l} icon={<Calendar size={16} />} onChange={(x) => { set('graduation', x); touch('graduation'); }} onBlur={blur('graduation')} error={shown('graduation')} />) },
    { name: 'interestArea', span: 1, pair: true, render: (l) => (
      <SelectWithOtherField name="interestArea" otherName="interestOther" label={t('auth:fields.interestArea')} otherLabel={t('auth:fields.interestOther')} otherPlaceholder={t('auth:placeholders.interestOther')}
        value={v.interestArea} other={v.interestOther} errLines={l} icon={<Target size={16} />} placeholder={t('auth:placeholders.select')} options={opt('interests', INTEREST_KEYS)}
        onChange={(x, o) => { set('interestArea', x); set('interestOther', o); }} onBlur={blur('interestArea')} onBlurOther={blur('interestOther')}
        error={shown('interestArea')} errorOther={shown('interestOther')} valid={ok('interestArea')} validOther={ok('interestOther')} />) },
    { name: 'relocation', span: 2, pair: true, render: (l) => (
      <SegmentedField name="relocation" label={t('auth:fields.relocation')} value={v.relocation as never} errLines={l} options={opt('relocation', RELOCATION_KEYS) as never}
        onChange={(x) => { set('relocation', x); touch('relocation'); }} error={shown('relocation')} />) },
    { name: 'password', span: 1, pair: true, render: (l) => (
      <PasswordField name="password" label={t('auth:fields.password')} value={v.password} errLines={l} icon={<Lock size={16} />} autoComplete="new-password"
        onChange={(x) => { set('password', x); if (v.confirmPassword) touch('confirmPassword'); }} onBlur={blur('password')} error={shown('password')} valid={ok('password')} />) },
    { name: 'confirmPassword', span: 1, pair: true, render: (l) => (
      <PasswordField name="confirmPassword" label={t('auth:fields.confirmPassword')} value={v.confirmPassword} errLines={l} icon={<Lock size={16} />} autoComplete="new-password"
        onChange={(x) => set('confirmPassword', x)} onBlur={blur('confirmPassword')} error={shown('confirmPassword')} valid={ok('confirmPassword') && v.password !== ''} />) },
  ];
  const steps: Step[] = [
    { title: t('auth:register.steps.s1'), fields: ['studentId', 'phone', 'name', 'surname', 'email'] },
    { title: t('auth:register.steps.s2'), fields: ['city', 'major', 'yearOfStudy', 'gpa', 'graduation'] },
    { title: t('auth:register.steps.s3'), fields: ['interestArea', 'interestOther', 'relocation', 'password', 'confirmPassword', 'acceptTerms'] },
  ];
  const ctx = { studentId: v.studentId, name: v.name, surname: v.surname, email: v.email };
  const checklist = <PasswordChecklist password={v.password} ctx={ctx} compact />;
  const terms = <TermsCheckbox checked={v.acceptTerms} onChange={(c) => { set('acceptTerms', c); touch('acceptTerms'); }} error={shown('acceptTerms')} onOpen={() => setTermsOpen(true)} />;
  return (
    <>
      <RegisterLayout stepKey="student" steps={steps} cells={cells} form={form as never} submitLabel={t('auth:register.create')} submittingLabel={t('auth:register.creating')} submitting={submitting} onSubmit={() => void submit()}
        banner={banner ? <p role="alert" className="mb-2 rounded-xl bg-danger/10 px-3 py-1.5 text-[12px] font-semibold text-danger-text">{banner}</p> : null}
        wizardExtras={<>{checklist}{terms}</>}
        desktopFooter={(btn) => [
          { key: 'cl', span: 2, node: checklist, className: 'pb-1' },
          { key: 'tm', span: 1, node: terms, className: 'pt-0.5' },
          { key: 'bt', span: 1, node: btn },
        ]} />
      <TermsModal open={termsOpen} onClose={() => setTermsOpen(false)} />
    </>
  );
}
