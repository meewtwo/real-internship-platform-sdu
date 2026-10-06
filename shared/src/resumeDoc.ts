/**
 * Résumé builder document: strict schema + validation (used by the API AND the editor), a deterministic "résumé review" score and
 * a keyword-gap check against a vacancy. Everything is plain text (never HTML); links must be https.
 */
import type { ErrorCode } from './errors';
import { skillKey } from './matching';

export const RESUME_TEMPLATES = ['classic', 'modern', 'compact'] as const;
export type ResumeTemplate = (typeof RESUME_TEMPLATES)[number];
export const RESUME_LANGS = ['en', 'ru', 'kk'] as const;
export type ResumeLang = (typeof RESUME_LANGS)[number];
export const MAX_RESUME_DOCS = 5;
export const MAX_RESUME_VERSIONS = 20;

export interface ResumeDoc {
  personal: { fullName: string; headline: string; email: string; phone: string; city: string; links: { label: string; url: string }[] };
  summary: string;
  experience: { role: string; company: string; location: string; start: string; end: string; bullets: string[] }[];
  education: { institution: string; degree: string; start: string; end: string; details: string }[];
  projects: { name: string; url: string; description: string; tech: string[] }[];
  skills: { group: string; items: string[] }[];
  languages: { name: string; level: string }[];
  certificates: { name: string; issuer: string; year: string }[];
}

export const emptyResumeDoc = (): ResumeDoc => ({
  personal: { fullName: '', headline: '', email: '', phone: '', city: '', links: [] },
  summary: '', experience: [], education: [], projects: [], skills: [], languages: [], certificates: [],
});

export type ResumeErrors = Record<string, ErrorCode>;
export type ResumeResult<T> = { ok: true; data: T } | { ok: false; fields: ResumeErrors; formError?: ErrorCode };

const CTRL = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g;
const cp = (s: string) => Array.from(s).length;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

class Ctx {
  fields: ResumeErrors = {};
  err(path: string, code: ErrorCode) { if (!this.fields[path]) this.fields[path] = code; }
  /** Single-line text: control characters become spaces, whitespace is collapsed. Over-long → error (never silently truncated). */
  line(v: unknown, max: number, path: string, required = false): string {
    if (v === undefined || v === null) { if (required) this.err(path, 'REQUIRED'); return ''; }
    if (typeof v !== 'string') { this.err(path, 'RESUME_FIELD_INVALID'); return ''; }
    if (v.length > max * 4) { this.err(path, 'RESUME_TEXT_TOO_LONG'); return ''; }
    const s = v.normalize('NFC').replace(CTRL, ' ').replace(/\s+/g, ' ').trim();
    if (cp(s) > max) { this.err(path, 'RESUME_TEXT_TOO_LONG'); return ''; }
    if (required && !s) this.err(path, 'REQUIRED');
    return s;
  }
  /** Multi-line text (summary): newlines kept (max 6 lines), other control characters removed. */
  block(v: unknown, max: number, path: string): string {
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') { this.err(path, 'RESUME_FIELD_INVALID'); return ''; }
    if (v.length > max * 4) { this.err(path, 'RESUME_TEXT_TOO_LONG'); return ''; }
    const s = v.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (cp(s) > max) { this.err(path, 'RESUME_TEXT_TOO_LONG'); return ''; }
    return s;
  }
  keys(o: Record<string, unknown>, allowed: string[], path: string) {
    if (Object.keys(o).some((k) => !allowed.includes(k))) this.err(path || '_', 'UNKNOWN_FIELDS');
  }
  list<T>(v: unknown, max: number, path: string, each: (item: unknown, p: string) => T | null): T[] {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) { this.err(path, 'RESUME_FIELD_INVALID'); return []; }
    if (v.length > max * 2) { this.err(path, 'RESUME_TOO_MANY_ITEMS'); return []; }
    const out: T[] = [];
    v.forEach((item, i) => { const r = each(item, `${path}.${i}`); if (r !== null) out.push(r); });
    if (out.length > max) { this.err(path, 'RESUME_TOO_MANY_ITEMS'); return out.slice(0, max); }
    return out;
  }
  strings(v: unknown, max: number, maxLen: number, path: string): string[] {
    return this.list(v, max, path, (x, p) => { const s = this.line(x, maxLen, p); return s ? s : null; });
  }
}

const NOW_YEAR = () => new Date().getUTCFullYear();
/** "YYYY-MM" (1960 … current year + 8) or '' ; `allowPresent` additionally accepts "present". */
function date(c: Ctx, v: unknown, path: string, allowPresent = false): string {
  const s = c.line(v, 12, path);
  if (!s) return '';
  if (allowPresent && s === 'present') return s;
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
  if (!m || +m[1] < 1960 || +m[1] > NOW_YEAR() + 8) { c.err(path, 'RESUME_DATE_INVALID'); return ''; }
  return s;
}
function year(c: Ctx, v: unknown, path: string): string {
  const s = c.line(v, 4, path);
  if (!s) return '';
  if (!/^\d{4}$/.test(s) || +s < 1960 || +s > NOW_YEAR() + 8) { c.err(path, 'RESUME_DATE_INVALID'); return ''; }
  return s;
}
function range(c: Ctx, start: string, end: string, path: string) {
  if (start && end && end !== 'present' && end < start) c.err(`${path}.end`, 'RESUME_DATE_INVALID');
}
export function httpsUrl(raw: string): string | null {
  if (raw.length > 200 || /\s/.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch { return null; }
}
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d][\d\s().-]{5,28}$/;

export function validateResumeDoc(input: unknown): ResumeResult<ResumeDoc> {
  const c = new Ctx();
  if (!isObj(input)) return { ok: false, fields: {}, formError: 'VALIDATION_FAILED' };
  c.keys(input, ['personal', 'summary', 'experience', 'education', 'projects', 'skills', 'languages', 'certificates'], '');
  const out = emptyResumeDoc();
  const p = isObj(input.personal) ? input.personal : (input.personal === undefined ? {} : (c.err('personal', 'RESUME_FIELD_INVALID'), {}));
  c.keys(p, ['fullName', 'headline', 'email', 'phone', 'city', 'links'], 'personal');
  out.personal.fullName = c.line(p.fullName, 80, 'personal.fullName', true);
  out.personal.headline = c.line(p.headline, 100, 'personal.headline');
  out.personal.email = c.line(p.email, 120, 'personal.email');
  if (out.personal.email && !EMAIL.test(out.personal.email)) { c.err('personal.email', 'EMAIL_INVALID'); out.personal.email = ''; }
  out.personal.phone = c.line(p.phone, 30, 'personal.phone');
  if (out.personal.phone && !PHONE.test(out.personal.phone)) { c.err('personal.phone', 'PHONE_INVALID'); out.personal.phone = ''; }
  out.personal.city = c.line(p.city, 60, 'personal.city');
  out.personal.links = c.list(p.links, 5, 'personal.links', (x, path) => {
    if (!isObj(x)) { c.err(path, 'RESUME_FIELD_INVALID'); return null; }
    c.keys(x, ['label', 'url'], path);
    const label = c.line(x.label, 30, `${path}.label`), raw = c.line(x.url, 200, `${path}.url`);
    if (!label && !raw) return null;
    if (!label) c.err(`${path}.label`, 'REQUIRED');
    const url = raw ? httpsUrl(raw) : null;
    if (!url) { c.err(`${path}.url`, raw ? 'RESUME_URL_INVALID' : 'REQUIRED'); return null; }
    return { label, url };
  });
  out.summary = c.block(input.summary, 600, 'summary');
  out.experience = c.list(input.experience, 10, 'experience', (x, path) => {
    if (!isObj(x)) { c.err(path, 'RESUME_FIELD_INVALID'); return null; }
    c.keys(x, ['role', 'company', 'location', 'start', 'end', 'bullets'], path);
    const e = { role: c.line(x.role, 100, `${path}.role`), company: c.line(x.company, 100, `${path}.company`), location: c.line(x.location, 60, `${path}.location`),
      start: date(c, x.start, `${path}.start`), end: date(c, x.end, `${path}.end`, true), bullets: c.strings(x.bullets, 6, 240, `${path}.bullets`) };
    if (!e.role && !e.company && !e.location && !e.start && !e.end && !e.bullets.length) return null;
    if (!e.role) c.err(`${path}.role`, 'REQUIRED');
    range(c, e.start, e.end, path);
    return e;
  });
  out.education = c.list(input.education, 6, 'education', (x, path) => {
    if (!isObj(x)) { c.err(path, 'RESUME_FIELD_INVALID'); return null; }
    c.keys(x, ['institution', 'degree', 'start', 'end', 'details'], path);
    const e = { institution: c.line(x.institution, 120, `${path}.institution`), degree: c.line(x.degree, 120, `${path}.degree`), start: date(c, x.start, `${path}.start`), end: date(c, x.end, `${path}.end`, true), details: c.line(x.details, 240, `${path}.details`) };
    if (!e.institution && !e.degree && !e.start && !e.end && !e.details) return null;
    if (!e.institution) c.err(`${path}.institution`, 'REQUIRED');
    range(c, e.start, e.end, path);
    return e;
  });
  out.projects = c.list(input.projects, 8, 'projects', (x, path) => {
    if (!isObj(x)) { c.err(path, 'RESUME_FIELD_INVALID'); return null; }
    c.keys(x, ['name', 'url', 'description', 'tech'], path);
    const name = c.line(x.name, 100, `${path}.name`), rawUrl = c.line(x.url, 200, `${path}.url`), description = c.line(x.description, 300, `${path}.description`), tech = c.strings(x.tech, 8, 30, `${path}.tech`);
    if (!name && !rawUrl && !description && !tech.length) return null;
    if (!name) c.err(`${path}.name`, 'REQUIRED');
    let url = '';
    if (rawUrl) { const u = httpsUrl(rawUrl); if (u) url = u; else c.err(`${path}.url`, 'RESUME_URL_INVALID'); }
    return { name, url, description, tech };
  });
  out.skills = c.list(input.skills, 8, 'skills', (x, path) => {
    if (!isObj(x)) { c.err(path, 'RESUME_FIELD_INVALID'); return null; }
    c.keys(x, ['group', 'items'], path);
    const group = c.line(x.group, 40, `${path}.group`), items = c.strings(x.items, 20, 40, `${path}.items`);
    if (!group && !items.length) return null;
    const seen = new Set<string>();
    return { group, items: items.filter((i) => { const k = skillKey(i); if (seen.has(k)) return false; seen.add(k); return true; }) };
  });
  out.languages = c.list(input.languages, 8, 'languages', (x, path) => {
    if (!isObj(x)) { c.err(path, 'RESUME_FIELD_INVALID'); return null; }
    c.keys(x, ['name', 'level'], path);
    const name = c.line(x.name, 30, `${path}.name`), level = c.line(x.level, 30, `${path}.level`);
    if (!name && !level) return null;
    if (!name) c.err(`${path}.name`, 'REQUIRED');
    return { name, level };
  });
  out.certificates = c.list(input.certificates, 8, 'certificates', (x, path) => {
    if (!isObj(x)) { c.err(path, 'RESUME_FIELD_INVALID'); return null; }
    c.keys(x, ['name', 'issuer', 'year'], path);
    const e = { name: c.line(x.name, 100, `${path}.name`), issuer: c.line(x.issuer, 80, `${path}.issuer`), year: year(c, x.year, `${path}.year`) };
    if (!e.name && !e.issuer && !e.year) return null;
    if (!e.name) c.err(`${path}.name`, 'REQUIRED');
    return e;
  });
  return Object.keys(c.fields).length ? { ok: false, fields: c.fields } : { ok: true, data: out };
}

export interface ResumeMeta { title: string; template: ResumeTemplate; language: ResumeLang }
/** `partial` (update): only the given keys are validated. */
export function validateResumeMeta(input: Record<string, unknown>, partial = false): ResumeResult<Partial<ResumeMeta>> {
  const c = new Ctx();
  const out: Partial<ResumeMeta> = {};
  if (!partial || input.title !== undefined) out.title = c.line(input.title, 80, 'title', true);
  if (input.template !== undefined) { if ((RESUME_TEMPLATES as readonly unknown[]).includes(input.template)) out.template = input.template as ResumeTemplate; else c.err('template', 'RESUME_FIELD_INVALID'); }
  if (input.language !== undefined) { if ((RESUME_LANGS as readonly unknown[]).includes(input.language)) out.language = input.language as ResumeLang; else c.err('language', 'RESUME_FIELD_INVALID'); }
  return Object.keys(c.fields).length ? { ok: false, fields: c.fields } : { ok: true, data: out };
}

// ───────────────────────── review (deterministic, no AI) ─────────────────────────
export const REVIEW_ISSUES = [
  'no_summary', 'summary_short', 'summary_long', 'no_experience', 'no_bullets', 'bullet_no_numbers', 'bullet_weak_start', 'bullet_long',
  'few_skills', 'no_education', 'no_email', 'no_phone', 'no_links', 'no_headline',
] as const;
export type ReviewIssue = (typeof REVIEW_ISSUES)[number];
export const REVIEW_STRENGTHS = ['quantified', 'rich_skills', 'has_links', 'complete_contact'] as const;
export type ReviewStrength = (typeof REVIEW_STRENGTHS)[number];
const PENALTY: Record<ReviewIssue, number> = { no_summary: 8, summary_short: 4, summary_long: 4, no_experience: 14, no_bullets: 8, bullet_no_numbers: 3, bullet_weak_start: 3, bullet_long: 2, few_skills: 8, no_education: 8, no_email: 10, no_phone: 4, no_links: 3, no_headline: 3 };
const WEAK = /^(responsible for|worked on|helped|assisted|participated in|duties included|отвечал за|занимался|помогал|участвовал в|выполнял|жауапты болдым|көмектестім)(?![\p{L}\p{N}])/iu;

export interface ReviewItem { issue: ReviewIssue; section?: 'experience' | 'summary' | 'skills' | 'personal' | 'education'; index?: number; bullet?: number }
export function reviewResume(doc: ResumeDoc): { score: number; issues: ReviewItem[]; strengths: ReviewStrength[] } {
  const issues: ReviewItem[] = [];
  const add = (i: ReviewItem) => issues.push(i);
  const sumLen = cp(doc.summary);
  if (!sumLen) add({ issue: 'no_summary', section: 'summary' }); else if (sumLen < 80) add({ issue: 'summary_short', section: 'summary' }); else if (sumLen > 500) add({ issue: 'summary_long', section: 'summary' });
  if (!doc.personal.headline) add({ issue: 'no_headline', section: 'personal' });
  if (!doc.personal.email) add({ issue: 'no_email', section: 'personal' });
  if (!doc.personal.phone) add({ issue: 'no_phone', section: 'personal' });
  if (!doc.personal.links.length) add({ issue: 'no_links', section: 'personal' });
  if (!doc.experience.length) add({ issue: 'no_experience', section: 'experience' });
  let numbered = 0, bulletsTotal = 0;
  doc.experience.forEach((e, i) => {
    if (!e.bullets.length) add({ issue: 'no_bullets', section: 'experience', index: i });
    e.bullets.forEach((b, j) => {
      bulletsTotal++;
      if (/\d/.test(b)) numbered++; else add({ issue: 'bullet_no_numbers', section: 'experience', index: i, bullet: j });
      if (WEAK.test(b)) add({ issue: 'bullet_weak_start', section: 'experience', index: i, bullet: j });
      if (cp(b) > 200) add({ issue: 'bullet_long', section: 'experience', index: i, bullet: j });
    });
  });
  const skillCount = new Set(doc.skills.flatMap((g) => g.items.map(skillKey))).size;
  if (skillCount < 5) add({ issue: 'few_skills', section: 'skills' });
  if (!doc.education.length) add({ issue: 'no_education', section: 'education' });
  // per-bullet issues are capped so one weak section cannot zero the score
  const counts = new Map<ReviewIssue, number>();
  let score = 100;
  for (const it of issues) { const n = (counts.get(it.issue) ?? 0) + 1; counts.set(it.issue, n); if (n <= 3) score -= PENALTY[it.issue]; }
  const strengths: ReviewStrength[] = [];
  if (bulletsTotal >= 2 && numbered / bulletsTotal >= 0.5) strengths.push('quantified');
  if (skillCount >= 8) strengths.push('rich_skills');
  if (doc.personal.links.length) strengths.push('has_links');
  if (doc.personal.email && doc.personal.phone) strengths.push('complete_contact');
  return { score: Math.max(0, Math.min(100, score)), issues, strengths };
}

/** Which of a vacancy's required skills the résumé already shows (anywhere in skills, projects' tech, experience text) and which it lacks. */
export function resumeKeywordGap(doc: ResumeDoc, requiredSkills: string[]): { present: string[]; missing: string[] } {
  const haystack = [
    ...doc.skills.flatMap((g) => g.items), ...doc.projects.flatMap((p) => [...p.tech, p.name, p.description]),
    ...doc.experience.flatMap((e) => [e.role, ...e.bullets]), doc.summary, doc.personal.headline,
  ].join('\n').toLocaleLowerCase();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const present: string[] = [], missing: string[] = [];
  const firstSeen = new Map<string, string>();
  for (const x of requiredSkills) if (!firstSeen.has(skillKey(x))) firstSeen.set(skillKey(x), x);
  for (const r of firstSeen.values()) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}+#])${esc(r.toLocaleLowerCase())}(?![\\p{L}\\p{N}+#])`, 'u');
    (re.test(haystack) ? present : missing).push(r);
  }
  return { present, missing };
}

/** Section headings printed on the résumé itself — they follow the DOCUMENT's language, not the UI language. */
export const RESUME_LABELS: Record<ResumeLang, Record<'summary' | 'experience' | 'education' | 'projects' | 'skills' | 'languages' | 'certificates' | 'present' | 'contact', string>> = {
  en: { summary: 'Summary', experience: 'Experience', education: 'Education', projects: 'Projects', skills: 'Skills', languages: 'Languages', certificates: 'Certificates', present: 'Present', contact: 'Contact' },
  ru: { summary: 'О себе', experience: 'Опыт работы', education: 'Образование', projects: 'Проекты', skills: 'Навыки', languages: 'Языки', certificates: 'Сертификаты', present: 'по настоящее время', contact: 'Контакты' },
  kk: { summary: 'Өзім туралы', experience: 'Жұмыс тәжірибесі', education: 'Білімі', projects: 'Жобалар', skills: 'Дағдылар', languages: 'Тілдер', certificates: 'Сертификаттар', present: 'қазіргі уақытқа дейін', contact: 'Байланыс' },
};
