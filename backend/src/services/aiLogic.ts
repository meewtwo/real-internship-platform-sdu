/** Pure, testable logic around the AI features: validators for model output, rule-based fallbacks, templates. No I/O. */
import {
  CITY_KEYS, INDUSTRY_KEYS, VACANCY_KINDS, WORK_FORMATS, extractExperience, extractSkills, skillKey, validateMinGpa, validateTags, validateTag,
  validateVacancyDescription, validateVacancyTitle, validateSalary,
  type CityKey, type IndustryKey, type MatchResult, type VacancyKind, type WorkFormat,
} from '@sdu/shared';
import { cleanText, intIn, isObj, pickEnum, strField, strList, type Lang } from './ai';

// ───────────────────────── vacancy text → draft ─────────────────────────
export interface VacancyDraft {
  title?: string; description?: string; kind?: VacancyKind; industry?: IndustryKey; city?: CityKey; workFormat?: WorkFormat;
  requiredSkills?: string[]; salaryMin?: number; salaryMax?: number; minGpa?: string;
}
export const VACANCY_DRAFT_FIELDS = ['title', 'description', 'kind', 'industry', 'city', 'workFormat', 'requiredSkills', 'salaryMin', 'salaryMax', 'minGpa'] as const;

const CITY_WORDS: [CityKey, RegExp][] = [
  ['almaty', /almaty|алматы|алмат[аы]/i], ['astana', /astana|nur-?sultan|астан[аыу]|нур-?султан/i], ['shymkent', /shymkent|шымкент/i],
  ['karaganda', /karaganda|қарағанды|караганд/i], ['aktobe', /aktobe|ақтөбе|актобе|актюбинск/i], ['atyrau', /atyrau|атырау/i], ['aktau', /aktau|ақтау|актау/i],
  ['pavlodar', /pavlodar|павлодар/i], ['kostanay', /kostanay|қостанай|костанай/i], ['oskemen', /oskemen|ust-?kamenogorsk|өскемен|усть-?каменогорск/i],
];
const parseMoney = (s: string) => Number(s.replace(/[\s ,.]/g, ''));
const MONEY = String.raw`(\d{1,3}(?:[  ,.]\d{3})+|\d{5,9})`;

/** Rule-based draft: used when AI is off/unavailable and to fill what the model leaves blank. Conservative: unknown stays unset. */
export function heuristicVacancy(text: string, vocabulary: string[]): VacancyDraft {
  const out: VacancyDraft = {};
  const t = text.normalize('NFC');
  const firstLine = t.split(/\n+/).map((l) => l.trim()).find((l) => l.length >= 3);
  if (firstLine) { const r = validateVacancyTitle(firstLine.replace(/^[#*\-•\s]+/, '').slice(0, 120)); if (r.ok) out.title = r.value; }
  const d = validateVacancyDescription(t.slice(0, 4000)); if (d.ok) out.description = d.value;
  const skills = extractSkills(t, vocabulary).slice(0, 15); if (skills.length) out.requiredSkills = skills;
  if (/intern|стаж[её]р|стажировк|тәжірибеден/i.test(t)) out.kind = 'internship';
  else if (/part[- ]?time|неполн\w+ (?:рабоч|занят)|подработк/i.test(t)) out.kind = 'part_time';
  else if (/full[- ]?time|полная занятость|полный день/i.test(t)) out.kind = 'full_time';
  if (/remote|удал[её]нн|қашықтан/i.test(t)) out.workFormat = 'remote';
  else if (/hybrid|гибрид/i.test(t)) out.workFormat = 'hybrid';
  else if (/on-?site|в офисе|офис\b/i.test(t)) out.workFormat = 'onsite';
  for (const [k, re] of CITY_WORDS) if (re.test(t)) { out.city = k; break; }
  const range = new RegExp(`${MONEY}\\s*(?:[-–—]|до|to)\\s*${MONEY}`, 'i').exec(t);
  if (range) {
    const a = parseMoney(range[1]), b = parseMoney(range[2]);
    const va = validateSalary(a), vb = validateSalary(b);
    if (va.ok && vb.ok && a >= 50_000 && a <= b) { out.salaryMin = a; out.salaryMax = b; }
  } else {
    const single = new RegExp(`(?:от|from|salary|зарплата|оклад|з/п)[^\\d\\n]{0,15}${MONEY}|${MONEY}\\s*(?:₸|тг|тенге|kzt|tenge)`, 'i').exec(t);
    const n = single ? parseMoney(single[1] ?? single[2]) : NaN;
    if (Number.isInteger(n) && n >= 50_000 && validateSalary(n).ok) out.salaryMin = n;
  }
  const gpa = /(?:gpa|средн\w+ балл)\D{0,12}([0-4](?:[.,]\d{1,2})?)/i.exec(t);
  if (gpa) { const g = validateMinGpa(gpa[1].replace(',', '.')); if (g.ok && g.value) out.minGpa = g.value; }
  return out;
}

/** Validates model output field by field: a bad field is dropped, never trusted. */
export function sanitizeVacancyDraft(raw: unknown): VacancyDraft | null {
  if (!isObj(raw)) return null;
  const out: VacancyDraft = {};
  const title = validateVacancyTitle(raw.title); if (title.ok) out.title = title.value;
  const desc = validateVacancyDescription(raw.description); if (desc.ok) out.description = desc.value;
  const kind = pickEnum(raw.kind, VACANCY_KINDS); if (kind) out.kind = kind;
  const ind = pickEnum(raw.industry, INDUSTRY_KEYS); if (ind) out.industry = ind;
  const city = pickEnum(raw.city, CITY_KEYS); if (city && city !== 'other') out.city = city;
  const wf = pickEnum(raw.workFormat, WORK_FORMATS); if (wf) out.workFormat = wf;
  if (Array.isArray(raw.requiredSkills)) {
    // dedupe case-insensitively first, then clamp to the vacancy limit (15) so the draft always passes the real validator
    const seen = new Set<string>();
    const cleaned = raw.requiredSkills.filter((s) => { const r = validateTag(s); if (!r.ok) return false; const k = skillKey(r.value); if (seen.has(k)) return false; seen.add(k); return true; });
    const tags = validateTags(cleaned.slice(0, 15), 15, 'TAGS_TOO_MANY');
    if (tags.ok && tags.value.length) out.requiredSkills = tags.value;
  }
  const a = intIn(raw.salaryMin, 1, 100_000_000), b = intIn(raw.salaryMax, 1, 100_000_000);
  if (a !== null && (b === null || a <= b)) out.salaryMin = a;
  if (b !== null && (a === null || a <= b)) out.salaryMax = b;
  if (raw.minGpa !== undefined && raw.minGpa !== null) { const g = validateMinGpa(typeof raw.minGpa === 'number' ? String(raw.minGpa) : raw.minGpa); if (g.ok && g.value) out.minGpa = g.value; }
  return out.title || out.description || out.requiredSkills ? out : null;
}

export const missingDraftFields = (d: VacancyDraft) => VACANCY_DRAFT_FIELDS.filter((f) => d[f] === undefined);

// ───────────────────────── CV analysis ─────────────────────────
export interface CvAnalysis {
  headline: string; summary: string; skills: string[];
  experience: { role: string; company: string; period: string; highlights: string[] }[];
  education: { institution: string; degree: string; period: string }[];
  languages: string[]; strengths: string[]; improvements: string[];
}
export function validateCvAnalysis(raw: unknown, vocabulary: string[]): CvAnalysis | null {
  if (!isObj(raw)) return null;
  const vocab = new Map(vocabulary.map((v) => [skillKey(v), v]));
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const s of Array.isArray(raw.skills) ? raw.skills : []) {
    const t = validateTag(s);
    if (!t.ok) continue;
    const k = skillKey(t.value);
    if (seen.has(k)) continue;
    seen.add(k); skills.push(vocab.get(k) ?? t.value);
    if (skills.length >= 40) break;
  }
  const objs = (v: unknown, n: number) => (Array.isArray(v) ? v.filter(isObj).slice(0, n) : []);
  const out: CvAnalysis = {
    headline: strField(raw.headline, 100), summary: strField(raw.summary, 500), skills,
    experience: objs(raw.experience, 8).map((e) => ({ role: strField(e.role, 100), company: strField(e.company, 100), period: strField(e.period, 40), highlights: strList(e.highlights, 4, 220) })).filter((e) => e.role || e.company),
    education: objs(raw.education, 4).map((e) => ({ institution: strField(e.institution, 120), degree: strField(e.degree, 120), period: strField(e.period, 40) })).filter((e) => e.institution || e.degree),
    languages: strList(raw.languages, 10, 40), strengths: strList(raw.strengths, 5, 200), improvements: strList(raw.improvements, 6, 240),
  };
  return out.summary || out.skills.length || out.experience.length ? out : null;
}
export function heuristicCvAnalysis(text: string, vocabulary: string[]): CvAnalysis {
  const exp = extractExperience(text);
  return {
    headline: '', summary: '', skills: extractSkills(text, vocabulary).slice(0, 40),
    experience: exp.items.slice(0, 8).map((i) => ({ role: i.line.slice(0, 100), company: '', period: '', highlights: [] })),
    education: [], languages: [], strengths: [], improvements: [],
  };
}

// ───────────────────────── match explanation ─────────────────────────
export interface Explanation { summary: string; strengths: string[]; gaps: string[]; nextSteps: string[] }
export function validateExplanation(raw: unknown): Explanation | null {
  if (!isObj(raw)) return null;
  const e = { summary: strField(raw.summary, 400), strengths: strList(raw.strengths, 4, 220), gaps: strList(raw.gaps, 4, 220), nextSteps: strList(raw.nextSteps, 4, 220) };
  return e.summary ? e : null;
}
/** Facts only (no names, emails or free text from the CV) — safe to send to a third-party model. */
export function matchFacts(m: MatchResult) {
  return { percent: m.percent, subScores: { skills: m.skill, textSimilarity: m.text, interestFit: m.fit, location: m.location }, matchedSkills: m.matchedSkills, missingSkills: m.missingSkills, relatedSkills: m.partialSkills.map((p) => ({ required: p.skill, has: p.via })), gpaBelowMinimum: m.gpaBelowMin };
}

// ───────────────────────── cover letter ─────────────────────────
export const NAME_TOKEN = '[NAME]';
export function validateLetter(raw: unknown): string | null {
  if (!isObj(raw)) return null;
  const t = typeof raw.text === 'string' ? raw.text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g, '').trim() : '';
  const n = Array.from(t).length;
  if (n < 80) return null;
  if (/https?:\/\/|www\./i.test(t)) return null; // a letter has no reason to carry links; also blocks injected phishing links
  return n > 1000 ? Array.from(t).slice(0, 1000).join('').trim() : t;
}
export const withName = (letter: string, name: string) => (letter.includes(NAME_TOKEN) ? letter.split(NAME_TOKEN).join(name) : `${letter}\n\n${name}`);

const LETTER: Record<Lang, (a: { title: string; company: string; skills: string[] }) => string> = {
  en: ({ title, company, skills }) => `Dear ${company} team,\n\nI am applying for the "${title}" position. ${skills.length ? `My background includes ${skills.slice(0, 4).join(', ')}, which matches what you are looking for.` : 'I am motivated to learn and contribute from day one.'} I would be glad to discuss how I can help your team.\n\nBest regards,\n${NAME_TOKEN}`,
  ru: ({ title, company, skills }) => `Здравствуйте, команда ${company}!\n\nЯ хочу откликнуться на вакансию «${title}». ${skills.length ? `У меня есть опыт и знания: ${skills.slice(0, 4).join(', ')} — это соответствует вашим требованиям.` : 'Я мотивирован учиться и приносить пользу с первого дня.'} Буду рад обсудить, чем могу быть полезен вашей команде.\n\nС уважением,\n${NAME_TOKEN}`,
  kk: ({ title, company, skills }) => `Құрметті ${company} командасы!\n\nМен «${title}» вакансиясына өтініш беремін. ${skills.length ? `Менің білімім мен тәжірибем: ${skills.slice(0, 4).join(', ')} — бұл сіздердің талаптарыңызға сәйкес.` : 'Мен үйренуге және алғашқы күннен пайда әкелуге дайынмын.'} Командаңызға қалай көмектесе алатынымды талқылауға қуаныштымын.\n\nҚұрметпен,\n${NAME_TOKEN}`,
};
export const templateLetter = (lang: Lang, a: { title: string; company: string; skills: string[] }) => LETTER[lang](a);

// ───────────────────────── interview ─────────────────────────
export interface Question { question: string; focus: string }
export function validateQuestions(raw: unknown): Question[] | null {
  if (!isObj(raw) || !Array.isArray(raw.questions)) return null;
  const out: Question[] = [];
  for (const q of raw.questions) {
    if (!isObj(q)) continue;
    const question = cleanText(q.question, 300);
    if (question && question.length >= 8) out.push({ question, focus: strField(q.focus, 60) });
    if (out.length >= 8) break;
  }
  return out.length >= 3 ? out : null;
}
const Q: Record<Lang, { skill: (s: string) => string; generic: string[] }> = {
  en: { skill: (s) => `Tell me about a project where you used ${s}. What was your role and the result?`, generic: ['Why are you interested in this role and company?', 'Describe a difficult problem you solved and how.', 'How do you organise your time when you have several deadlines?'] },
  ru: { skill: (s) => `Расскажите о проекте, где вы использовали ${s}. Какова была ваша роль и результат?`, generic: ['Почему вам интересна эта должность и компания?', 'Опишите сложную задачу, которую вы решили, и как именно.', 'Как вы планируете время, когда несколько дедлайнов?'] },
  kk: { skill: (s) => `${s} қолданған жобаңыз туралы айтып беріңіз. Рөліңіз бен нәтиже қандай болды?`, generic: ['Бұл лауазым мен компания неге қызықтырады?', 'Шешкен күрделі мәселеңізді және қалай шешкеніңізді сипаттаңыз.', 'Бірнеше дедлайн болғанда уақытты қалай жоспарлайсыз?'] },
};
export function templateQuestions(lang: Lang, skills: string[]): Question[] {
  const t = Q[lang];
  return [...skills.slice(0, 3).map((s) => ({ question: t.skill(s), focus: s })), ...t.generic.map((g) => ({ question: g, focus: '' }))];
}
export interface Feedback { score: number; strengths: string[]; improvements: string[]; sampleAnswer: string }
export function validateFeedback(raw: unknown): Feedback | null {
  if (!isObj(raw)) return null;
  const score = intIn(raw.score, 1, 5);
  if (score === null) return null;
  return { score, strengths: strList(raw.strengths, 4, 220), improvements: strList(raw.improvements, 4, 220), sampleAnswer: strField(raw.sampleAnswer, 700) };
}

// ───────────────────────── resume assistant (shared by phase 2) ─────────────────────────
export function validateRewrite(raw: unknown): { text: string } | null {
  if (!isObj(raw)) return null;
  const t = cleanText(raw.text, 400);
  return t && t.length >= 5 ? { text: t } : null;
}

const EXPL: Record<Lang, { summary: (p: number, got: number, total: number) => string }> = {
  en: { summary: (p, g, t) => `Match ${p}%. ${t ? `${g} of ${t} required skills are covered.` : 'The vacancy lists no required skills.'}` },
  ru: { summary: (p, g, t) => `Совпадение ${p}%. ${t ? `Покрыто ${g} из ${t} требуемых навыков.` : 'В вакансии не указаны обязательные навыки.'}` },
  kk: { summary: (p, g, t) => `Сәйкестік ${p}%. ${t ? `Қажетті ${t} дағдының ${g}-і қамтылған.` : 'Вакансияда міндетті дағдылар көрсетілмеген.'}` },
};
/** Deterministic explanation straight from the scorer, used when AI is unavailable. */
export function templateExplanation(lang: Lang, m: MatchResult): Explanation {
  const total = m.matchedSkills.length + m.missingSkills.length;
  return { summary: EXPL[lang].summary(m.percent, m.matchedSkills.length, total), strengths: m.matchedSkills.slice(0, 4), gaps: m.missingSkills.slice(0, 4), nextSteps: [] };
}
