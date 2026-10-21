/**
 * Pure field validators. Each takes `unknown` (the backend receives arbitrary JSON) and returns
 * either a normalized value or a machine-readable error code. Shared by frontend (UX) and backend (authority).
 */
import { COMMON_PASSWORDS } from './commonPasswords';
import type { ErrorCode } from './errors';
import {
  CITY_KEYS, COMPANY_SIZE_KEYS, INDUSTRY_KEYS, INTEREST_KEYS, LANGUAGES, MAJOR_KEYS, RELOCATION_KEYS, YEAR_KEYS,
  type CityKey, type CompanySizeKey, type IndustryKey, type InterestKey, type Language, type MajorKey,
  type RelocationKey, type YearKey,
} from './options';

export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (code: ErrorCode): Result<never> => ({ ok: false, code });

/** Zero-width, bidi, control and other invisible characters. */
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￹-￼]/g;

/** NFC + trim. Returns null when the value is not a string. */
function clean(v: unknown): string | null {
  return typeof v === 'string' ? v.normalize('NFC').trim() : null;
}
/** Trim only (no Unicode normalization): for ASCII-only fields, so compatibility look-alikes (e.g. U+212A Kelvin sign) stay invalid. */
function trimOnly(v: unknown): string | null {
  return typeof v === 'string' ? v.trim() : null;
}
/** True if the string has no visible content (empty, whitespace or invisible chars only). */
function isBlank(s: string): boolean {
  return s.replace(INVISIBLE, '').trim() === '';
}
const cpLen = (s: string) => Array.from(s).length;

// ───────────────────────── Student ID ─────────────────────────
export function validateStudentId(v: unknown, invalid: ErrorCode = 'STUDENT_ID_INVALID'): Result<string> {
  if (v === undefined || v === null) return fail('REQUIRED');
  const s = trimOnly(v);
  if (s === null) return fail(invalid);
  if (isBlank(s)) return fail('REQUIRED');
  return /^[0-9]{9}$/.test(s) ? ok(s) : fail(invalid); // [0-9] = ASCII only (no Arabic-Indic / full-width digits)
}

// ───────────────────────── Names ─────────────────────────
const LATIN_WORD = /^[A-Za-zÀ-ÖØ-öø-ɏ]+$/;
const CYRILLIC_WORD = /^[Ѐ-ӿ]+$/; // Russian + Kazakh (ә ғ қ ң ө ұ ү һ і)
const ALL_LETTERS = /^\p{L}+$/u;
const isSingleScriptLetters = (w: string) => ALL_LETTERS.test(w) && (LATIN_WORD.test(w) || CYRILLIC_WORD.test(w));

export function capitalize(s: string): string {
  const chars = Array.from(s);
  if (chars.length === 0) return s;
  return chars[0].toLocaleUpperCase() + chars.slice(1).join('').toLocaleLowerCase();
}

/** Letters only (Latin OR Cyrillic, never mixed), 2–50 chars. No digits, symbols, emoji, spaces. */
export function validatePersonName(v: unknown): Result<string> {
  if (v === undefined || v === null) return fail('REQUIRED');
  const s = clean(v);
  if (s === null) return fail('NAME_INVALID_CHARS');
  if (isBlank(s)) return fail('REQUIRED');
  if (s.length > 200) return fail('NAME_TOO_LONG'); // never run regexes on 10k payloads
  const len = cpLen(s);
  if (len > 50) return fail('NAME_TOO_LONG');
  if (!isSingleScriptLetters(s)) return fail('NAME_INVALID_CHARS');
  if (len < 2) return fail('NAME_TOO_SHORT');
  return ok(capitalize(s));
}

// ───────────────────────── Email ─────────────────────────
const LOCAL_SDU = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
// ASCII-case-insensitive on purpose: toLowerCase() maps U+212A (Kelvin sign) to "k".
const SDU_DOMAIN = /^[sS][dD][uU]\.[eE][dD][uU]\.[kK][zZ]$/;

export function validateSduEmail(v: unknown): Result<string> {
  if (v === undefined || v === null) return fail('REQUIRED');
  const s = trimOnly(v);
  if (s === null) return fail('EMAIL_INVALID');
  if (isBlank(s)) return fail('REQUIRED');
  if (s.length > 254) return fail('EMAIL_TOO_LONG');
  const parts = s.split('@');
  if (parts.length !== 2) return fail('EMAIL_INVALID');
  const [local, domain] = parts;
  if (!local || !LOCAL_SDU.test(local) || local.includes('..')) return fail('EMAIL_INVALID');
  if (!SDU_DOMAIN.test(domain)) return fail(/^[A-Za-z0-9.-]+$/.test(domain) && domain.includes('.') && !domain.endsWith('.') && !domain.includes('..') ? 'EMAIL_DOMAIN_NOT_SDU' : 'EMAIL_INVALID');
  return ok(`${local.toLowerCase()}@sdu.edu.kz`);
}

export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'internet.ru', 'ya.ru', 'rambler.ru',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'gmx.net', 'zoho.com', 'mail.com', 'yandex.com',
  'mail.kz', 'inbox.kz', 'bk.kz', 'list.kz', 'tut.by', 'ukr.net', 'qq.com', '163.com', '126.com', 'yeah.net',
]);
const FREE_EMAIL_PATTERNS = [/^yandex\.[a-z.]+$/, /^yahoo\.[a-z.]+$/, /^ymail\.com$/, /^hotmail\.[a-z.]+$/, /^outlook\.[a-z.]+$/, /^live\.[a-z.]+$/];
export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', 'yopmail.com', 'yopmail.fr',
  'tempmail.com', 'temp-mail.org', 'temp-mail.io', '10minutemail.com', '10minutemail.net', 'trashmail.com',
  'throwawaymail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'mohmal.com',
  'emailondeck.com', 'mintemail.com', 'spamgourmet.com', 'tempail.com', 'tempr.email', 'burnermail.io',
  'moakt.com', 'mailnesia.com', 'mytemp.email', 'tmpmail.org', 'tmpmail.net', 'discard.email', 'spam4.me',
]);
const DISPOSABLE_PATTERN = /tempmail|temp-mail|trashmail|throwaway|10minutemail|guerrillamail|mailinator|yopmail|disposable|fakemail|fakeinbox|sharklasers|getnada|dispostable|tmpmail/;

const LOCAL_GENERIC = /^[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** Generic syntactic email check. Returns lowercase local and domain. */
export function parseEmailSyntax(v: unknown): Result<{ local: string; domain: string; email: string }> {
  if (v === undefined || v === null) return fail('REQUIRED');
  const s = trimOnly(v);
  if (s === null) return fail('EMAIL_INVALID');
  if (isBlank(s)) return fail('REQUIRED');
  if (s.length > 254) return fail('EMAIL_TOO_LONG');
  const parts = s.split('@');
  if (parts.length !== 2) return fail('EMAIL_INVALID');
  const [local, domain] = parts;
  if (!LOCAL_GENERIC.test(local) || local.includes('..')) return fail('EMAIL_INVALID');
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((l) => DOMAIN_LABEL.test(l))) return fail('EMAIL_INVALID');
  if (!/^[A-Za-z]{2,24}$/.test(labels[labels.length - 1])) return fail('EMAIL_INVALID');
  const d = domain.toLowerCase();
  return ok({ local: local.toLowerCase(), domain: d, email: `${local.toLowerCase()}@${d}` });
}

const domainMatches = (domain: string, set: Set<string>) => {
  const labels = domain.split('.');
  for (let i = 0; i < labels.length - 1; i++) if (set.has(labels.slice(i).join('.'))) return true;
  return false;
};

/** Corporate email: valid syntax, not a free provider, not disposable, not the student domain. */
export function validateWorkEmail(v: unknown): Result<string> {
  const p = parseEmailSyntax(v);
  if (!p.ok) return p;
  const { domain, email } = p.value;
  if (domain === 'sdu.edu.kz' || domain.endsWith('.sdu.edu.kz')) return fail('EMAIL_DOMAIN_NOT_ALLOWED');
  if (domainMatches(domain, DISPOSABLE_EMAIL_DOMAINS) || DISPOSABLE_PATTERN.test(domain)) return fail('EMAIL_DISPOSABLE');
  if (domainMatches(domain, FREE_EMAIL_DOMAINS) || FREE_EMAIL_PATTERNS.some((re) => re.test(domain))) return fail('EMAIL_NOT_CORPORATE');
  return ok(email);
}

// ───────────────────────── Phone ─────────────────────────
/** Accepts "+77XXXXXXXXX" or the exact mask "+7 (7XX) XXX-XX-XX". Returns +77XXXXXXXXX. */
export function validatePhone(v: unknown): Result<string> {
  if (v === undefined || v === null) return fail('REQUIRED');
  const s = trimOnly(v);
  if (s === null) return fail('PHONE_INVALID');
  if (isBlank(s)) return fail('REQUIRED');
  if (s.length > 30) return fail('PHONE_INVALID');
  if (/^\+77[0-9]{9}$/.test(s)) return ok(s);
  const m = /^\+7 \((7[0-9]{2})\) ([0-9]{3})-([0-9]{2})-([0-9]{2})$/.exec(s);
  return m ? ok(`+7${m[1]}${m[2]}${m[3]}${m[4]}`) : fail('PHONE_INVALID');
}

/** Formats up to 10 national digits into the mask "+7 (7XX) XXX-XX-XX" (for the input control). */
export function formatPhoneMask(rawInput: string): string {
  let d = rawInput.replace(/[^0-9]/g, '');
  if (d.startsWith('7') && rawInput.trim().startsWith('+')) d = d.slice(1);
  else if (d.startsWith('8') && d.length > 10) d = d.slice(1);
  else if (d.startsWith('7') && d.length > 10) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return '';
  let out = '+7 (' + d.slice(0, 3);
  if (d.length >= 3) out += ')';
  if (d.length > 3) out += ' ' + d.slice(3, 6);
  if (d.length > 6) out += '-' + d.slice(6, 8);
  if (d.length > 8) out += '-' + d.slice(8, 10);
  return out;
}

// ───────────────────────── Enumerations ─────────────────────────
function enumValidator<T extends string>(keys: readonly T[], invalid: ErrorCode) {
  return (v: unknown): Result<T> => {
    if (v === undefined || v === null) return fail('REQUIRED');
    if (typeof v !== 'string') return fail(invalid);
    const s = v.trim();
    if (s === '') return fail('REQUIRED');
    return (keys as readonly string[]).includes(s) ? ok(s as T) : fail(invalid);
  };
}
export const validateMajor = enumValidator<MajorKey>(MAJOR_KEYS, 'MAJOR_INVALID');
export const validateYear = enumValidator<YearKey>(YEAR_KEYS, 'YEAR_INVALID');
export const validateInterest = enumValidator<InterestKey>(INTEREST_KEYS, 'INTEREST_INVALID');
export const validateRelocation = enumValidator<RelocationKey>(RELOCATION_KEYS, 'RELOCATION_INVALID');
export const validateIndustry = enumValidator<IndustryKey>(INDUSTRY_KEYS, 'INDUSTRY_INVALID');
export const validateCompanySize = enumValidator<CompanySizeKey>(COMPANY_SIZE_KEYS, 'SIZE_INVALID');
export const validateCityKey = enumValidator<CityKey>(CITY_KEYS, 'CITY_INVALID');
export const validateLanguage = enumValidator<Language>(LANGUAGES, 'LANGUAGE_INVALID');

/** Free-text city (when "Other" is chosen): letters, single spaces and hyphens, 2–60 chars. */
export function validateCityOther(v: unknown): Result<string> {
  if (v === undefined || v === null) return fail('REQUIRED');
  const s = clean(v);
  if (s === null) return fail('CITY_OTHER_INVALID');
  if (isBlank(s)) return fail('REQUIRED');
  if (s.length > 200) return fail('CITY_OTHER_INVALID');
  const len = cpLen(s);
  if (len < 2 || len > 60) return fail('CITY_OTHER_INVALID');
  const words = s.split(/[ -]/);
  if (words.some((w) => w === '') || !words.every(isSingleScriptLetters) || /[ -]{2}/.test(s)) return fail('CITY_OTHER_INVALID');
  return ok(s);
}

/** Free text that replaces a dropdown's "Other" (custom interest / industry): 2–100 visible characters, no control/invisible characters. */
export const OTHER_TEXT_MAX = 100;
export function validateOtherText(v: unknown): Result<string> {
  if (v === undefined || v === null) return fail('REQUIRED');
  const s = clean(v);
  if (s === null) return fail('OTHER_TEXT_INVALID');
  if (isBlank(s)) return fail('REQUIRED');
  if (s.length > 4 * OTHER_TEXT_MAX || s.replace(INVISIBLE, '') !== s) return fail('OTHER_TEXT_INVALID');
  const len = cpLen(s);
  if (len < 2 || len > OTHER_TEXT_MAX || /\s{2}/.test(s)) return fail('OTHER_TEXT_INVALID');
  return ok(s);
}
/** `other` is only validated (and kept) when the dropdown value is "other"; otherwise it is dropped. */
export function validateWithOther(key: string | undefined, other: unknown): Result<string | null> {
  return key === 'other' ? validateOtherText(other) : ok(null);
}

export interface CityValue { city: CityKey; cityOther: string | null }
export function validateCity(city: unknown, cityOther: unknown): { city: Result<CityKey>; cityOther: Result<string | null> } {
  const c = validateCityKey(city);
  if (!c.ok) return { city: c, cityOther: ok(null) };
  if (c.value !== 'other') return { city: c, cityOther: ok(null) };
  return { city: c, cityOther: validateCityOther(cityOther) };
}

// ───────────────────────── GPA ─────────────────────────
/** 0.00–4.00, ≤2 decimals. Accepts "3.5", "3,5", 3.5. Returns "3.50". */
export function validateGpa(v: unknown): Result<string> {
  if (v === undefined || v === null) return fail('REQUIRED');
  let s: string;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || Object.is(v, -0)) return fail('GPA_INVALID');
    s = String(v);
  } else if (typeof v === 'string') {
    s = v.normalize('NFC').trim();
    if (isBlank(s)) return fail('REQUIRED');
  } else return fail('GPA_INVALID');
  if (s.length > 12) return fail('GPA_INVALID');
  if ((s.match(/,/g) ?? []).length === 1 && !s.includes('.')) s = s.replace(',', '.');
  const m = /^([0-9])(?:\.([0-9]+))?$/.exec(s);
  if (!m) return fail('GPA_INVALID');
  if ((m[2] ?? '').length > 2) return fail('GPA_TOO_MANY_DECIMALS');
  const n = Number(s);
  if (n < 0 || n > 4) return fail('GPA_OUT_OF_RANGE');
  return ok(n.toFixed(2));
}

/** Sanitizes GPA typing: digits and a single dot (comma → dot), max 2 decimals. */
export function sanitizeGpaInput(raw: string): string {
  let s = raw.replace(',', '.').replace(/[^0-9.]/g, '');
  const i = s.indexOf('.');
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
  const [a, b] = s.split('.');
  return b === undefined ? a.slice(0, 1) : `${a.slice(0, 1)}.${b.slice(0, 2)}`;
}

// ───────────────────────── Graduation ─────────────────────────
/** Remaining years of study (including the current one) per year-of-study key. */
export const REMAINING_YEARS: Record<YearKey, number> = { '1': 4, '2': 3, '3': 2, '4': 1, m1: 2, m2: 1 };
const ALMATY_OFFSET_MS = 5 * 3600 * 1000;

export function currentMonthIndex(now: Date = new Date()): number {
  const d = new Date(now.getTime() + ALMATY_OFFSET_MS);
  return d.getUTCFullYear() * 12 + d.getUTCMonth(); // month index, 0-based month
}

/** Returns [minMonthsAhead, maxMonthsAhead] allowed for the given year of study. */
export function graduationWindow(year: YearKey): [number, number] {
  const r = REMAINING_YEARS[year];
  return [Math.max(1, (r - 1) * 12), (r + 1) * 12];
}

/**
 * Format "YYYY-MM". Must be a later month than the current one (Asia/Almaty), ≤72 months ahead and, when
 * the year of study is known, consistent with it (see graduationWindow).
 */
export function validateGraduation(v: unknown, year: YearKey | null, now: Date = new Date()): Result<string> {
  if (v === undefined || v === null) return fail('REQUIRED');
  if (typeof v !== 'string') return fail('GRADUATION_INVALID');
  const s = v.trim();
  if (s === '') return fail('REQUIRED');
  const m = /^(20[0-9]{2})-(0[1-9]|1[0-2])$/.exec(s);
  if (!m) return fail('GRADUATION_INVALID');
  const diff = Number(m[1]) * 12 + (Number(m[2]) - 1) - currentMonthIndex(now);
  if (diff < 1) return fail('GRADUATION_PAST');
  if (diff > 72) return fail('GRADUATION_TOO_FAR');
  if (year) {
    const [min, max] = graduationWindow(year);
    if (diff < min || diff > max) return fail('GRADUATION_INCONSISTENT');
  }
  return ok(s);
}

// ───────────────────────── Password ─────────────────────────
export interface PasswordContext { studentId?: string; name?: string; surname?: string; email?: string }

export type PasswordRule = 'length' | 'upper' | 'lower' | 'digit' | 'special' | 'noSpace' | 'noPersonal' | 'notCommon';
const SPECIAL = /[^A-Za-z0-9\s]/;
const PRINTABLE_ASCII = /^[\x21-\x7E]+$/;
const LEET: Record<string, string> = { '@': 'a', '4': 'a', '0': 'o', '3': 'e', '$': 's', '5': 's', '1': 'i', '!': 'i', '7': 't', '8': 'b' };

function isCommonPassword(pw: string): boolean {
  const lower = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return true;
  const stripEdges = (x: string) => x.replace(/^[^a-z]+|[^a-z]+$/g, '');
  const stripped = stripEdges(lower);
  const leet = (x: string, one: string) => x.replace(/[@4035$1!78]/g, (c) => (c === '1' ? one : LEET[c]));
  const variants = [stripped];
  for (const one of ['i', 'l']) {
    variants.push(leet(stripped, one), stripEdges(leet(lower, one)));
  }
  return variants.some((c) => c.length >= 4 && COMMON_PASSWORDS.has(c));
}

function containsPersonal(pw: string, ctx: PasswordContext): boolean {
  const lower = pw.toLowerCase();
  if (ctx.studentId && /^[0-9]{9}$/.test(ctx.studentId) && lower.includes(ctx.studentId)) return true;
  const local = ctx.email ? ctx.email.split('@')[0].toLowerCase() : '';
  for (const part of [ctx.name, ctx.surname, local]) {
    const p = (part ?? '').trim().toLowerCase();
    if (p.length >= 3 && lower.includes(p)) return true;
  }
  return false;
}

/** Per-rule pass/fail for the live checklist in the UI. */
export function passwordChecks(pw: string, ctx: PasswordContext = {}): Record<PasswordRule, boolean> {
  return {
    length: pw.length >= 8 && pw.length <= 64,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /[0-9]/.test(pw),
    special: SPECIAL.test(pw),
    noSpace: pw.length > 0 && !/\s/.test(pw),
    noPersonal: pw.length > 0 && !containsPersonal(pw, ctx),
    notCommon: pw.length > 0 && !isCommonPassword(pw),
  };
}

/** 0–4 score for the strength meter (purely presentational). */
export function passwordStrength(pw: string, ctx: PasswordContext = {}): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  const c = passwordChecks(pw, ctx);
  let score = 0;
  if (c.length) score++;
  if ([c.upper, c.lower, c.digit, c.special].filter(Boolean).length >= 3) score++;
  if (c.upper && c.lower && c.digit && c.special) score++;
  if (pw.length >= 12 && c.noPersonal && c.notCommon) score++;
  if (!c.notCommon || !c.noPersonal || !c.noSpace) score = Math.min(score, 1);
  return score as 0 | 1 | 2 | 3 | 4;
}

export function validatePassword(v: unknown, ctx: PasswordContext = {}): Result<string> {
  if (v === undefined || v === null || v === '') return fail('REQUIRED');
  if (typeof v !== 'string') return fail('PASSWORD_INVALID_CHARS');
  if (v.length > 64) return fail('PASSWORD_TOO_LONG');
  if (v.length < 8) return fail('PASSWORD_TOO_SHORT');
  if (/\s/.test(v)) return fail('PASSWORD_HAS_SPACE');
  if (!PRINTABLE_ASCII.test(v)) return fail('PASSWORD_INVALID_CHARS');
  if (!/[A-Z]/.test(v)) return fail('PASSWORD_NO_UPPER');
  if (!/[a-z]/.test(v)) return fail('PASSWORD_NO_LOWER');
  if (!/[0-9]/.test(v)) return fail('PASSWORD_NO_DIGIT');
  if (!SPECIAL.test(v)) return fail('PASSWORD_NO_SPECIAL');
  if (containsPersonal(v, ctx)) return fail('PASSWORD_CONTAINS_PERSONAL');
  if (isCommonPassword(v)) return fail('PASSWORD_COMMON');
  return ok(v);
}

export function validateConfirmPassword(confirm: unknown, password: unknown): Result<string> {
  if (confirm === undefined || confirm === null || confirm === '') return fail('REQUIRED');
  if (typeof confirm !== 'string' || typeof password !== 'string' || confirm !== password) return fail('PASSWORD_MISMATCH');
  return ok(confirm);
}

export function validateTerms(v: unknown): Result<true> {
  return v === true ? ok(true) : fail('TERMS_REQUIRED');
}

// ───────────────────────── Employer fields ─────────────────────────
const COMPANY_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,&'"«»()\-+/#]*$/u;
export function validateCompanyName(v: unknown): Result<string> {
  if (v === undefined || v === null) return fail('REQUIRED');
  const s = clean(v);
  if (s === null) return fail('COMPANY_NAME_INVALID');
  if (isBlank(s)) return fail('REQUIRED');
  if (s.length > 400 || cpLen(s) > 100) return fail('COMPANY_NAME_TOO_LONG');
  const collapsed = s.replace(/ {2,}/g, ' ');
  if (cpLen(collapsed) < 2 || !COMPANY_NAME_RE.test(collapsed)) return fail('COMPANY_NAME_INVALID');
  return ok(collapsed);
}

export function validateBin(v: unknown): Result<string> {
  if (v === undefined || v === null) return fail('REQUIRED');
  const s = trimOnly(v);
  if (s === null) return fail('BIN_INVALID');
  if (isBlank(s)) return fail('REQUIRED');
  return /^[0-9]{12}$/.test(s) ? ok(s) : fail('BIN_INVALID');
}

const POSITION_RE = /^\p{L}[\p{L}\p{N} .,&'/()\-]*$/u;
export function validatePosition(v: unknown): Result<string> {
  if (v === undefined || v === null) return fail('REQUIRED');
  const s = clean(v);
  if (s === null) return fail('POSITION_INVALID');
  if (isBlank(s)) return fail('REQUIRED');
  if (s.length > 300 || cpLen(s) > 80) return fail('POSITION_TOO_LONG');
  const collapsed = s.replace(/ {2,}/g, ' ');
  return cpLen(collapsed) >= 2 && POSITION_RE.test(collapsed) ? ok(collapsed) : fail('POSITION_INVALID');
}

/** Optional. Returns null for empty. Must be a http(s) URL with a dotted ASCII hostname, no credentials. */
export function validateWebsite(v: unknown): Result<string | null> {
  if (v === undefined || v === null) return ok(null);
  if (typeof v !== 'string') return fail('WEBSITE_INVALID');
  const s = v.trim();
  if (s === '' ) return ok(null);
  if (s.length > 200 || /[\s\u0000-\u001F\u007F-\u009F​-‏⁠﻿]/.test(s)) return fail('WEBSITE_INVALID');
  if (!/^https?:\/\//i.test(s) || /[^\x21-\x7E]/.test(s)) return fail('WEBSITE_INVALID'); // ASCII only: blocks IDN look-alike hosts
  let u: URL;
  try { u = new URL(s); } catch { return fail('WEBSITE_INVALID'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail('WEBSITE_INVALID');
  if (u.username || u.password) return fail('WEBSITE_INVALID');
  const host = u.hostname.toLowerCase();
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => DOMAIN_LABEL.test(l)) || !/^[a-z]{2,24}$/.test(labels[labels.length - 1])) return fail('WEBSITE_INVALID');
  return ok(s);
}

/** Optional, ≤500 chars (code points). Control/zero-width chars removed, newlines kept. */
export function validateDescription(v: unknown): Result<string | null> {
  if (v === undefined || v === null) return ok(null);
  if (typeof v !== 'string') return fail('DESCRIPTION_TOO_LONG');
  if (v.length > 5000) return fail('DESCRIPTION_TOO_LONG');
  const s = v
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁯﻿]/g, '')
    .trim();
  if (s === '') return ok(null);
  return cpLen(s) > 500 ? fail('DESCRIPTION_TOO_LONG') : ok(s);
}

// ───────────────────────── Tags (skills / interests) ─────────────────────────
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N} .+#&/-]*$/u;
export function validateTag(v: unknown): Result<string> {
  if (typeof v !== 'string') return fail('TAG_INVALID');
  const s = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (s.length > 200) return fail('TAG_INVALID');
  const len = cpLen(s);
  return len >= 2 && len <= 40 && TAG_RE.test(s) ? ok(s) : fail('TAG_INVALID');
}

/** Validates a list of tags: dedupes case-insensitively, enforces the maximum count. */
export function validateTags(v: unknown, max: number, tooMany: ErrorCode): Result<string[]> {
  if (v === undefined || v === null) return ok([]);
  if (!Array.isArray(v)) return fail('TAG_INVALID');
  if (v.length > max * 3) return fail(tooMany);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const r = validateTag(item);
    if (!r.ok) return r;
    const key = r.value.toLocaleLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(r.value); }
  }
  return out.length > max ? fail(tooMany) : ok(out);
}

// ───────────────────────── Auth helpers ─────────────────────────
export function validateCode(v: unknown): Result<string> {
  if (typeof v !== 'string') return fail('CODE_FORMAT_INVALID');
  const s = v.trim();
  return /^[0-9]{6}$/.test(s) ? ok(s) : fail('CODE_FORMAT_INVALID');
}

export function validateLoginPassword(v: unknown): Result<string> {
  if (typeof v !== 'string' || v === '') return fail('REQUIRED');
  if (v.length > 128) return fail('INVALID_CREDENTIALS');
  return ok(v);
}

// ───────────────────────── Vacancies / applications ─────────────────────────
import { VACANCY_KINDS, WORK_FORMATS, EMPLOYER_SET_STATUSES, SEARCH_SORTS, type VacancyKind, type WorkFormat } from './options';

const VAC_TITLE_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,&'()/#+:!–-]*$/u;
export function validateVacancyTitle(v: unknown): Result<string> {
  if (v === undefined || v === null) return fail('REQUIRED');
  const s = clean(v);
  if (s === null) return fail('VACANCY_TITLE_INVALID');
  if (isBlank(s)) return fail('REQUIRED');
  const c = s.replace(/ {2,}/g, ' ');
  if (c.length > 400 || cpLen(c) < 3 || cpLen(c) > 120 || !VAC_TITLE_RE.test(c)) return fail('VACANCY_TITLE_INVALID');
  return ok(c);
}
export function validateVacancyDescription(v: unknown): Result<string> {
  if (v === undefined || v === null) return fail('REQUIRED');
  if (typeof v !== 'string') return fail('VACANCY_DESCRIPTION_INVALID');
  if (v.length > 20_000) return fail('VACANCY_DESCRIPTION_TOO_LONG');
  const s = v.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁯﻿]/g, '').trim();
  if (s === '') return fail('REQUIRED');
  const n = cpLen(s);
  return n < 20 ? fail('VACANCY_DESCRIPTION_INVALID') : n > 4000 ? fail('VACANCY_DESCRIPTION_TOO_LONG') : ok(s);
}
export const validateVacancyKind = enumValidator<VacancyKind>(VACANCY_KINDS, 'VACANCY_KIND_INVALID');
export const validateWorkFormat = enumValidator<WorkFormat>(WORK_FORMATS, 'WORK_FORMAT_INVALID');

/** Optional minimum GPA (empty → null). */
export function validateMinGpa(v: unknown): Result<string | null> {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return ok(null);
  return validateGpa(v);
}

/** Optional application deadline "YYYY-MM-DD": a real date, today or later, within one year. */
export function validateDeadline(v: unknown, now: Date = new Date()): Result<string | null> {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return ok(null);
  if (typeof v !== 'string') return fail('DEADLINE_INVALID');
  const s = v.trim();
  const m = /^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(s);
  if (!m) return fail('DEADLINE_INVALID');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return fail('DEADLINE_INVALID');
  const today = new Date(now.getTime() + ALMATY_OFFSET_MS);
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (d.getTime() < t0) return fail('DEADLINE_PAST');
  if (d.getTime() > t0 + 366 * 86400_000) return fail('DEADLINE_INVALID');
  return ok(s);
}

export function validateRequiredSkills(v: unknown): Result<string[]> {
  const r = validateTags(v, 15, 'VACANCY_SKILLS_TOO_MANY');
  if (!r.ok) return r;
  return r.value.length === 0 ? fail('VACANCY_SKILLS_REQUIRED') : r;
}
export function validateCoverNote(v: unknown): Result<string | null> {
  if (v === undefined || v === null) return ok(null);
  if (typeof v !== 'string') return fail('COVER_NOTE_TOO_LONG');
  if (v.length > 10_000) return fail('COVER_NOTE_TOO_LONG');
  const s = v.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g, '').trim();
  return s === '' ? ok(null) : cpLen(s) > 1000 ? fail('COVER_NOTE_TOO_LONG') : ok(s);
}
export const validateEmployerStatus = enumValidator<(typeof EMPLOYER_SET_STATUSES)[number]>(EMPLOYER_SET_STATUSES, 'STATUS_INVALID');

export interface SearchQuery {
  q: string; industry: string | null; kind: VacancyKind | null; format: WorkFormat | null; city: string | null;
  sort: 'match' | 'newest' | 'salary'; page: number; pageSize: number; salaryFrom: number | null; withSalary: boolean;
}
/** Parses ?q=&industry=&kind=&format=&city=&sort=&page= . Any invalid value → SEARCH_INVALID (never silently ignored). */
export function parseSearchQuery(p: Record<string, string | undefined>): Result<SearchQuery> {
  const q = (p.q ?? '').normalize('NFC').replace(INVISIBLE, '').trim();
  if (cpLen(q) > 60) return fail('SEARCH_INVALID');
  const pick = <T extends string>(val: string | undefined, keys: readonly T[]): T | null | undefined =>
    val === undefined || val === '' ? null : (keys as readonly string[]).includes(val) ? (val as T) : undefined;
  const industry = pick(p.industry, INDUSTRY_KEYS);
  const kind = pick(p.kind, VACANCY_KINDS);
  const format = pick(p.format, WORK_FORMATS);
  const city = pick(p.city, CITY_KEYS);
  const sort = p.sort === undefined || p.sort === '' ? 'match' : (SEARCH_SORTS as readonly string[]).includes(p.sort) ? (p.sort as 'match' | 'newest' | 'salary') : undefined;
  const sal = p.salaryFrom === undefined || p.salaryFrom === '' ? null : validateSalary(p.salaryFrom);
  if (sal && !sal.ok) return fail('SEARCH_INVALID');
  if (p.withSalary !== undefined && !['', '0', '1'].includes(p.withSalary)) return fail('SEARCH_INVALID');
  const page = p.page === undefined || p.page === '' ? 1 : /^[0-9]{1,4}$/.test(p.page) ? Number(p.page) : 0;
  if (industry === undefined || kind === undefined || format === undefined || city === undefined || sort === undefined || page < 1) return fail('SEARCH_INVALID');
  return ok({ q, industry, kind, format, city, sort, page, pageSize: 10, salaryFrom: sal && sal.ok ? sal.value : null, withSalary: p.withSalary === '1' });
}

export type VacancyKindT = VacancyKind;
export type WorkFormatT = WorkFormat;

/** Optional monthly salary in KZT: whole number 0 < n ≤ 100 000 000 (empty → null). */
export function validateSalary(v: unknown): Result<number | null> {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return ok(null);
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^[0-9]{1,9}$/.test(v.trim())) n = Number(v.trim());
  else return fail('SALARY_INVALID');
  return Number.isInteger(n) && n > 0 && n <= 100_000_000 ? ok(n) : fail('SALARY_INVALID');
}
