/**
 * zod schemas for every API payload. Field validators (validators.ts) are wrapped into zod so that
 * strictness (unknown keys → UNKNOWN_FIELDS, mass-assignment protection) and error collection are uniform.
 * Cross-field rules (confirm password, password vs personal data, graduation vs year) run in `finish*`.
 */
import { z } from 'zod';
import type { ErrorCode, FieldErrors } from './errors';
import type { CityKey, CompanySizeKey, IndustryKey, InterestKey, Language, MajorKey, RelocationKey, YearKey } from './options';
import * as V from './validators';

type Validator<T> = (v: unknown) => V.Result<T>;

function field<T>(fn: Validator<T>) {
  return z.unknown().transform((v, ctx) => {
    const r = fn(v);
    if (!r.ok) {
      ctx.addIssue({ code: 'custom', message: r.code });
      return z.NEVER;
    }
    return r.value;
  });
}
/** Passes the raw value through (cross-field validators run later). */
const raw = () => z.unknown().optional();

export type ParseResult<T> = { ok: true; data: T } | { ok: false; formError?: ErrorCode; fields: FieldErrors };

function collect(error: z.ZodError): { formError?: ErrorCode; fields: FieldErrors } {
  const fields: FieldErrors = {};
  let formError: ErrorCode | undefined;
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') { formError = 'UNKNOWN_FIELDS'; continue; }
    const key = issue.path[0];
    if (typeof key === 'string') { if (!(key in fields)) fields[key] = issue.message as ErrorCode; }
    else formError = 'VALIDATION_FAILED';
  }
  return { formError, fields };
}

function run<S extends z.ZodTypeAny, T>(
  schema: S,
  input: unknown,
  finish: (parsed: Record<string, unknown> | null, fields: FieldErrors) => FieldErrors,
  build: (parsed: z.infer<S>) => T,
): ParseResult<T> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, formError: 'VALIDATION_FAILED', fields: {} };
  const res = schema.safeParse(input);
  const base = res.success ? { fields: {} as FieldErrors, formError: undefined } : collect(res.error);
  const extra = finish(input as Record<string, unknown>, base.fields);
  const fields = { ...extra, ...base.fields };
  // field-level errors win over cross-field ones, but cross-field fills gaps
  for (const [k, c] of Object.entries(extra)) if (!(k in base.fields)) fields[k] = c;
  if (Object.keys(fields).length > 0 || base.formError) return { ok: false, formError: base.formError, fields };
  return { ok: true, data: build((res as { data: z.infer<S> }).data) };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

// ───────────────── Student registration ─────────────────
export const studentRegisterSchema = z.strictObject({
  studentId: field((v) => V.validateStudentId(v)),
  name: field(V.validatePersonName),
  surname: field(V.validatePersonName),
  email: field(V.validateSduEmail),
  phone: field(V.validatePhone),
  city: field(V.validateCityKey),
  cityOther: raw().optional(),
  major: field(V.validateMajor),
  yearOfStudy: field(V.validateYear),
  gpa: field(V.validateGpa),
  graduation: raw(),
  interestArea: field(V.validateInterest),
  relocation: field(V.validateRelocation),
  password: raw(),
  confirmPassword: raw(),
  acceptTerms: field(V.validateTerms),
  language: field(V.validateLanguage).optional(),
});

export interface StudentRegistration {
  studentId: string; name: string; surname: string; email: string; phone: string;
  city: CityKey; cityOther: string | null; major: MajorKey; yearOfStudy: YearKey; gpa: string; graduation: string;
  interestArea: InterestKey; relocation: RelocationKey; password: string; acceptTerms: true; language: Language;
}

function cityCross(input: Record<string, unknown>, fields: FieldErrors, out: FieldErrors) {
  const c = V.validateCity(input.city, input.cityOther);
  if (!c.cityOther.ok && !('cityOther' in fields)) out.cityOther = c.cityOther.code;
}

export function validateStudentRegistration(input: unknown, now: Date = new Date()): ParseResult<StudentRegistration> {
  return run(
    studentRegisterSchema,
    input,
    (i, fields) => {
      const out: FieldErrors = {};
      if (!i) return out;
      cityCross(i, fields, out);
      const year = V.validateYear(i.yearOfStudy);
      const g = V.validateGraduation(i.graduation, year.ok ? year.value : null, now);
      if (!g.ok) out.graduation = g.code;
      const email = V.validateSduEmail(i.email);
      const name = V.validatePersonName(i.name);
      const surname = V.validatePersonName(i.surname);
      const sid = V.validateStudentId(i.studentId);
      const pw = V.validatePassword(i.password, {
        studentId: sid.ok ? sid.value : str(i.studentId).trim(),
        name: name.ok ? name.value : str(i.name),
        surname: surname.ok ? surname.value : str(i.surname),
        email: email.ok ? email.value : str(i.email),
      });
      if (!pw.ok) out.password = pw.code;
      const cf = V.validateConfirmPassword(i.confirmPassword, i.password);
      if (!cf.ok) out.confirmPassword = cf.code;
      return out;
    },
    (d) => {
      const p = d as Record<string, unknown>;
      const c = V.validateCity(p.city, (p as { cityOther?: unknown }).cityOther);
      return {
        studentId: p.studentId as string, name: p.name as string, surname: p.surname as string,
        email: p.email as string, phone: p.phone as string, city: p.city as CityKey,
        cityOther: c.cityOther.ok ? c.cityOther.value : null,
        major: p.major as MajorKey, yearOfStudy: p.yearOfStudy as YearKey, gpa: p.gpa as string,
        graduation: String(p.graduation).trim(), interestArea: p.interestArea as InterestKey,
        relocation: p.relocation as RelocationKey, password: p.password as string, acceptTerms: true as const,
        language: ((p.language as Language | undefined) ?? 'en'),
      };
    },
  );
}

// ───────────────── Employer registration ─────────────────
export const employerRegisterSchema = z.strictObject({
  companyName: field(V.validateCompanyName),
  bin: field(V.validateBin),
  industry: field(V.validateIndustry),
  size: field(V.validateCompanySize),
  city: field(V.validateCityKey),
  cityOther: raw().optional(),
  contactName: field(V.validatePersonName),
  contactSurname: field(V.validatePersonName),
  position: field(V.validatePosition),
  email: field(V.validateWorkEmail),
  phone: field(V.validatePhone),
  website: field(V.validateWebsite).optional(),
  description: field(V.validateDescription).optional(),
  password: raw(),
  confirmPassword: raw(),
  acceptTerms: field(V.validateTerms),
  language: field(V.validateLanguage).optional(),
});

export interface EmployerRegistration {
  companyName: string; bin: string; industry: IndustryKey; size: CompanySizeKey; city: CityKey; cityOther: string | null;
  contactName: string; contactSurname: string; position: string; email: string; phone: string;
  website: string | null; description: string | null; password: string; acceptTerms: true; language: Language;
}

export function validateEmployerRegistration(input: unknown): ParseResult<EmployerRegistration> {
  return run(
    employerRegisterSchema,
    input,
    (i, fields) => {
      const out: FieldErrors = {};
      if (!i) return out;
      cityCross(i, fields, out);
      const email = V.validateWorkEmail(i.email);
      const cn = V.validatePersonName(i.contactName);
      const cs = V.validatePersonName(i.contactSurname);
      const pw = V.validatePassword(i.password, {
        name: cn.ok ? cn.value : str(i.contactName),
        surname: cs.ok ? cs.value : str(i.contactSurname),
        email: email.ok ? email.value : str(i.email),
      });
      if (!pw.ok) out.password = pw.code;
      const cf = V.validateConfirmPassword(i.confirmPassword, i.password);
      if (!cf.ok) out.confirmPassword = cf.code;
      return out;
    },
    (d) => {
      const p = d as Record<string, unknown>;
      const c = V.validateCity(p.city, p.cityOther);
      return {
        companyName: p.companyName as string, bin: p.bin as string, industry: p.industry as IndustryKey,
        size: p.size as CompanySizeKey, city: p.city as CityKey, cityOther: c.cityOther.ok ? c.cityOther.value : null,
        contactName: p.contactName as string, contactSurname: p.contactSurname as string, position: p.position as string,
        email: p.email as string, phone: p.phone as string, website: (p.website as string | null | undefined) ?? null,
        description: (p.description as string | null | undefined) ?? null, password: p.password as string,
        acceptTerms: true as const, language: ((p.language as Language | undefined) ?? 'en'),
      };
    },
  );
}

// ───────────────── Profiles ─────────────────
export const studentProfileSchema = z.strictObject({
  name: field(V.validatePersonName),
  surname: field(V.validatePersonName),
  phone: field(V.validatePhone),
  city: field(V.validateCityKey),
  cityOther: raw().optional(),
  major: field(V.validateMajor),
  yearOfStudy: field(V.validateYear),
  gpa: field(V.validateGpa),
  graduation: raw(),
  interestArea: field(V.validateInterest),
  relocation: field(V.validateRelocation),
  skills: field((v) => V.validateTags(v, 30, 'TAGS_TOO_MANY')),
  interests: field((v) => V.validateTags(v, 10, 'INTERESTS_TOO_MANY')),
});

export interface StudentProfileInput {
  name: string; surname: string; phone: string; city: CityKey; cityOther: string | null; major: MajorKey;
  yearOfStudy: YearKey; gpa: string; graduation: string; interestArea: InterestKey; relocation: RelocationKey;
  skills: string[]; interests: string[];
}

export function validateStudentProfile(input: unknown, now: Date = new Date()): ParseResult<StudentProfileInput> {
  return run(
    studentProfileSchema,
    input,
    (i, fields) => {
      const out: FieldErrors = {};
      if (!i) return out;
      cityCross(i, fields, out);
      const year = V.validateYear(i.yearOfStudy);
      const g = V.validateGraduation(i.graduation, year.ok ? year.value : null, now);
      if (!g.ok) out.graduation = g.code;
      return out;
    },
    (d) => {
      const p = d as Record<string, unknown>;
      const c = V.validateCity(p.city, p.cityOther);
      return {
        name: p.name as string, surname: p.surname as string, phone: p.phone as string, city: p.city as CityKey,
        cityOther: c.cityOther.ok ? c.cityOther.value : null, major: p.major as MajorKey, yearOfStudy: p.yearOfStudy as YearKey,
        gpa: p.gpa as string, graduation: String(p.graduation).trim(), interestArea: p.interestArea as InterestKey,
        relocation: p.relocation as RelocationKey, skills: p.skills as string[], interests: p.interests as string[],
      };
    },
  );
}

export const employerProfileSchema = z.strictObject({
  companyName: field(V.validateCompanyName),
  industry: field(V.validateIndustry),
  size: field(V.validateCompanySize),
  city: field(V.validateCityKey),
  cityOther: raw().optional(),
  contactName: field(V.validatePersonName),
  contactSurname: field(V.validatePersonName),
  position: field(V.validatePosition),
  phone: field(V.validatePhone),
  website: field(V.validateWebsite).optional(),
  description: field(V.validateDescription).optional(),
});

export interface EmployerProfileInput {
  companyName: string; industry: IndustryKey; size: CompanySizeKey; city: CityKey; cityOther: string | null;
  contactName: string; contactSurname: string; position: string; phone: string; website: string | null; description: string | null;
}

export function validateEmployerProfile(input: unknown): ParseResult<EmployerProfileInput> {
  return run(
    employerProfileSchema,
    input,
    (i, fields) => {
      const out: FieldErrors = {};
      if (i) cityCross(i, fields, out);
      return out;
    },
    (d) => {
      const p = d as Record<string, unknown>;
      const c = V.validateCity(p.city, p.cityOther);
      return {
        companyName: p.companyName as string, industry: p.industry as IndustryKey, size: p.size as CompanySizeKey,
        city: p.city as CityKey, cityOther: c.cityOther.ok ? c.cityOther.value : null, contactName: p.contactName as string,
        contactSurname: p.contactSurname as string, position: p.position as string, phone: p.phone as string,
        website: (p.website as string | null | undefined) ?? null, description: (p.description as string | null | undefined) ?? null,
      };
    },
  );
}

// ───────────────── Auth payloads ─────────────────
const roleField = field((v): V.Result<'student' | 'employer'> =>
  v === 'student' || v === 'employer' ? { ok: true, value: v } : { ok: false, code: 'ROLE_INVALID' });

/** Student: 9-digit ID. Employer: syntactically valid email. */
export function validateIdentifier(role: 'student' | 'employer', v: unknown): V.Result<string> {
  if (role === 'student') {
    const r = V.validateStudentId(v, 'IDENTIFIER_INVALID');
    return r;
  }
  const r = V.parseEmailSyntax(v);
  return r.ok ? { ok: true, value: r.value.email } : r.code === 'REQUIRED' ? r : { ok: false, code: 'IDENTIFIER_INVALID' };
}

const identifierRaw = z.unknown();

function identifierIssues(i: Record<string, unknown>): FieldErrors {
  const out: FieldErrors = {};
  if (i.role === 'student' || i.role === 'employer') {
    const r = validateIdentifier(i.role, i.identifier);
    if (!r.ok) out.identifier = r.code;
  }
  return out;
}

export const loginSchema = z.strictObject({
  role: roleField,
  identifier: identifierRaw,
  password: field(V.validateLoginPassword),
  remember: z.boolean().optional(),
});
export interface LoginInput { role: 'student' | 'employer'; identifier: string; password: string; remember: boolean }
export function validateLogin(input: unknown): ParseResult<LoginInput> {
  return run(loginSchema, input, (i) => (i ? identifierIssues(i) : {}), (d) => {
    const p = d as Record<string, unknown>;
    const id = validateIdentifier(p.role as 'student' | 'employer', p.identifier);
    return { role: p.role as 'student' | 'employer', identifier: id.ok ? id.value : '', password: p.password as string, remember: p.remember === true };
  });
}

export const identifierOnlySchema = z.strictObject({ role: roleField, identifier: identifierRaw, language: field(V.validateLanguage).optional() });
export interface IdentifierInput { role: 'student' | 'employer'; identifier: string; language?: Language }
export function validateIdentifierPayload(input: unknown): ParseResult<IdentifierInput> {
  return run(identifierOnlySchema, input, (i) => (i ? identifierIssues(i) : {}), (d) => {
    const p = d as Record<string, unknown>;
    const id = validateIdentifier(p.role as 'student' | 'employer', p.identifier);
    return { role: p.role as 'student' | 'employer', identifier: id.ok ? id.value : '', language: p.language as Language | undefined };
  });
}

export const verifySchema = z.strictObject({
  role: roleField,
  identifier: identifierRaw,
  code: field(V.validateCode),
});
export interface VerifyInput { role: 'student' | 'employer'; identifier: string; code: string }
export function validateVerify(input: unknown): ParseResult<VerifyInput> {
  return run(verifySchema, input, (i) => (i ? identifierIssues(i) : {}), (d) => {
    const p = d as Record<string, unknown>;
    const id = validateIdentifier(p.role as 'student' | 'employer', p.identifier);
    return { role: p.role as 'student' | 'employer', identifier: id.ok ? id.value : '', code: p.code as string };
  });
}

export const resetSchema = z.strictObject({
  role: roleField,
  identifier: identifierRaw,
  code: field(V.validateCode),
  password: raw(),
  confirmPassword: raw(),
});
export interface ResetInput { role: 'student' | 'employer'; identifier: string; code: string; password: string }
/** `ctx` carries the account's personal data (looked up server-side) for the "no personal data" rule. */
export function validateReset(input: unknown, ctx: V.PasswordContext = {}): ParseResult<ResetInput> {
  return run(
    resetSchema,
    input,
    (i) => {
      if (!i) return {};
      const out = identifierIssues(i);
      const pw = V.validatePassword(i.password, ctx);
      if (!pw.ok) out.password = pw.code;
      const cf = V.validateConfirmPassword(i.confirmPassword, i.password);
      if (!cf.ok) out.confirmPassword = cf.code;
      return out;
    },
    (d) => {
      const p = d as Record<string, unknown>;
      const id = validateIdentifier(p.role as 'student' | 'employer', p.identifier);
      return { role: p.role as 'student' | 'employer', identifier: id.ok ? id.value : '', code: p.code as string, password: p.password as string };
    },
  );
}

export const languageSchema = z.strictObject({ language: field(V.validateLanguage) });
export function validateLanguagePayload(input: unknown): ParseResult<{ language: Language }> {
  return run(languageSchema, input, () => ({}), (d) => ({ language: (d as { language: Language }).language }));
}

// ───────────────── Vacancies / applications ─────────────────
export const vacancySchema = z.strictObject({
  title: field(V.validateVacancyTitle),
  description: field(V.validateVacancyDescription),
  kind: field(V.validateVacancyKind),
  industry: field(V.validateIndustry),
  city: field(V.validateCityKey),
  cityOther: raw().optional(),
  workFormat: field(V.validateWorkFormat),
  minGpa: field(V.validateMinGpa).optional(),
  deadline: raw().optional(),
  salaryMin: field(V.validateSalary).optional(),
  salaryMax: field(V.validateSalary).optional(),
  requiredSkills: field(V.validateRequiredSkills),
});
export interface VacancyInput {
  title: string; description: string; kind: V.VacancyKindT; industry: IndustryKey; city: CityKey; cityOther: string | null;
  workFormat: V.WorkFormatT; minGpa: string | null; deadline: string | null; requiredSkills: string[]; salaryMin: number | null; salaryMax: number | null;
}
export function validateVacancy(input: unknown, now: Date = new Date()): ParseResult<VacancyInput> {
  return run(
    vacancySchema,
    input,
    (i, fields) => {
      const out: FieldErrors = {};
      if (!i) return out;
      cityCross(i, fields, out);
      const d = V.validateDeadline(i.deadline, now);
      if (!d.ok) out.deadline = d.code;
      const a = V.validateSalary(i.salaryMin), b = V.validateSalary(i.salaryMax);
      if (a.ok && b.ok && a.value !== null && b.value !== null && a.value > b.value) out.salaryMax = 'SALARY_RANGE_INVALID';
      return out;
    },
    (d) => {
      const p = d as Record<string, unknown>;
      const c = V.validateCity(p.city, p.cityOther);
      return {
        title: p.title as string, description: p.description as string, kind: p.kind as V.VacancyKindT, industry: p.industry as IndustryKey,
        city: p.city as CityKey, cityOther: c.cityOther.ok ? c.cityOther.value : null, workFormat: p.workFormat as V.WorkFormatT,
        minGpa: (p.minGpa as string | null | undefined) ?? null, deadline: V.validateDeadline(p.deadline, now).ok ? (V.validateDeadline(p.deadline, now) as { value: string | null }).value : null,
        requiredSkills: p.requiredSkills as string[], salaryMin: (p.salaryMin as number | null | undefined) ?? null, salaryMax: (p.salaryMax as number | null | undefined) ?? null,
      };
    },
  );
}

export const applySchema = z.strictObject({ coverNote: field(V.validateCoverNote).optional() });
export function validateApply(input: unknown): ParseResult<{ coverNote: string | null }> {
  return run(applySchema, input ?? {}, () => ({}), (d) => ({ coverNote: ((d as { coverNote?: string | null }).coverNote) ?? null }));
}
export const statusSchema = z.strictObject({ status: field(V.validateEmployerStatus) });
export function validateStatusChange(input: unknown): ParseResult<{ status: (typeof import('./options').EMPLOYER_SET_STATUSES)[number] }> {
  return run(statusSchema, input, () => ({}), (d) => ({ status: (d as { status: never }).status }));
}
