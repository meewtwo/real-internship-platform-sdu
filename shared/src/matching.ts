/**
 * Explainable hybrid matcher (no external AI service): weighted skill overlap + TF cosine similarity of CV/profile text vs
 * vacancy text + interest/industry fit + location/relocation, with a GPA penalty. Returns a 0–100 score and the breakdown.
 * The interface (`matchScore`) is the only thing the rest of the app depends on, so an embedding model can replace `textSimilarity` later.
 */
import type { CityKey, IndustryKey, InterestKey, RelocationKey, WorkFormat } from './options';
import { partialCredit, type PartialSkill } from './skillGraph';
import { cosineQ, semanticScore, type QVec } from './embedding';

export interface StudentSignal {
  skills: string[]; cvSkills: string[]; interests: string[]; cvText: string; majorKey: string; interestArea: InterestKey;
  city: CityKey; cityOther: string | null; relocation: RelocationKey; gpa: number; experienceYears: number;
  /** Optional quantised text embedding (semantic matching). Absent → lexical similarity. */
  vec?: QVec | null;
}
export interface VacancySignal {
  title: string; description: string; requiredSkills: string[]; industry: IndustryKey; city: CityKey; cityOther: string | null;
  workFormat: WorkFormat; minGpa: number | null;
  vec?: QVec | null;
}
export interface MatchResult {
  percent: number;
  skill: number; text: number; fit: number; location: number;
  matchedSkills: string[]; missingSkills: string[]; gpaBelowMin: boolean;
  /** Missing skills for which the student owns a related one (partial credit, already included in `skill`). Subset of `missingSkills`. */
  partialSkills: PartialSkill[];
  /** How the text sub-score was computed: meaning (embeddings, both sides available) or word overlap. */
  textSource: 'semantic' | 'lexical';
}

export const WEIGHTS = { skill: 0.55, text: 0.2, fit: 0.15, location: 0.1 } as const;
export const GPA_PENALTY = 0.75;
export const MATCH_NOTIFY_THRESHOLD = 60;

const STOP = new Set(('the and for with you your are our will this that from have has was were not but all can who they their into over more than about work team ' +
  'experience years year skills knowledge ability strong good must should able including etc and или для что это как все при его она они наш наша быть будет опыт работы работа знание умение навыки').split(' '));

export const skillKey = (s: string) => s.normalize('NFC').trim().toLocaleLowerCase();

export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLocaleLowerCase().matchAll(/c\+\+|c#|[\p{L}\p{N}][\p{L}\p{N}.+#]*[\p{L}\p{N}+#]|[\p{L}]{2}/gu)) {
    const t = m[0].replace(/\.+$/, '');
    if (t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t)) out.push(t);
  }
  return out;
}

function tf(words: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
  for (const [k, v] of m) m.set(k, 1 + Math.log(v));
  return m;
}
export function cosine(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = tf(a), B = tf(b);
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of A) { na += v * v; const w = B.get(k); if (w) dot += v * w; }
  for (const v of B.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
/** Maps raw cosine (typically 0–0.4 for CV vs job text) to 0–1. */
export const textSimilarity = (student: string[], vacancy: string[]) => Math.min(1, cosine(student, vacancy) / 0.35);

const INTEREST_INDUSTRIES: Record<string, readonly string[] | '*'> = {
  software_development: ['it_software', 'telecom', 'consulting'],
  data_ai: ['it_software', 'finance_banking', 'consulting', 'telecom'],
  cybersecurity: ['it_software', 'telecom', 'finance_banking', 'government'],
  finance_banking: ['finance_banking', 'consulting'],
  marketing_smm: ['media_marketing', 'retail'],
  design_ux: ['it_software', 'media_marketing'],
  engineering: ['manufacturing', 'energy_oil_gas', 'construction', 'logistics_transport', 'telecom'],
  research: ['education', 'healthcare', 'consulting'],
  education: ['education'],
  law: ['government', 'consulting'],
  management: ['consulting', 'retail', 'logistics_transport', 'manufacturing'],
  other: '*',
};
function fitScore(s: StudentSignal, v: VacancySignal): number {
  const m = INTEREST_INDUSTRIES[s.interestArea];
  if (m === '*') return 0.5;
  return m && m.includes(v.industry) ? 1 : v.industry === 'other' ? 0.4 : 0.15;
}
function locationScore(s: StudentSignal, v: VacancySignal): number {
  if (v.workFormat === 'remote') return 1;
  const sameCity = s.city === v.city && (s.city !== 'other' || (s.cityOther ?? '').toLocaleLowerCase() === (v.cityOther ?? '').toLocaleLowerCase());
  if (sameCity) return 1;
  return s.relocation === 'yes' ? 0.7 : s.relocation === 'remote' ? 0 : 0.15;
}

export function matchScore(s: StudentSignal, v: VacancySignal): MatchResult {
  const have = new Set([...s.skills, ...s.cvSkills].map(skillKey));
  const req = [...new Map(v.requiredSkills.map((x) => [skillKey(x), x])).values()];
  const matchedSkills = req.filter((x) => have.has(skillKey(x)));
  const missingSkills = req.filter((x) => !have.has(skillKey(x)));
  const partialSkills: PartialSkill[] = [];
  for (const x of missingSkills) {
    const p = partialCredit(skillKey(x), have);
    if (p) partialSkills.push({ skill: x, via: p.via, credit: p.credit });
  }
  const credit = matchedSkills.length + partialSkills.reduce((a, p) => a + p.credit, 0);
  const skill = req.length ? Math.min(1, credit / req.length) : 0.5;
  const studentWords = tokens([...s.skills, ...s.cvSkills, ...s.interests, s.majorKey.replace(/_/g, ' '), s.cvText].join(' '));
  const vacancyWords = tokens([v.title, v.title, v.requiredSkills.join(' '), v.description].join(' '));
  const semantic = !!(s.vec && v.vec && s.vec.length === v.vec.length && s.vec.length > 0);
  const text = semantic ? semanticScore(cosineQ(s.vec, v.vec)) : textSimilarity(studentWords, vacancyWords);
  const fit = fitScore(s, v);
  const location = locationScore(s, v);
  const gpaBelowMin = v.minGpa !== null && s.gpa < v.minGpa;
  let raw = WEIGHTS.skill * skill + WEIGHTS.text * text + WEIGHTS.fit * fit + WEIGHTS.location * location;
  if (gpaBelowMin) raw *= GPA_PENALTY;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { percent: Math.max(0, Math.min(100, Math.round(raw * 100))), skill: r(skill), text: r(text), fit: r(fit), location: r(location), matchedSkills, missingSkills, gpaBelowMin, partialSkills, textSource: semantic ? 'semantic' : 'lexical' };
}

// ───────────────────────── Vacancy ↔ vacancy similarity ("people also viewed") ─────────────────────────
export interface SimilaritySignal extends VacancySignal { kind: string }

/** 0–1: 50 % required-skill Jaccard (related skills count half), 30 % text cosine, 10 % same industry, 10 % same kind. Symmetric. */
export function vacancySimilarity(a: SimilaritySignal, b: SimilaritySignal): number {
  const A = new Set(a.requiredSkills.map(skillKey)), B = new Set(b.requiredSkills.map(skillKey));
  let skill = 0;
  if (A.size || B.size) {
    let inter = 0;
    for (const x of A) { if (B.has(x)) inter += 1; else { const p = partialCredit(x, B); if (p) inter += p.credit / 2; } }
    for (const x of B) { if (!A.has(x)) { const p = partialCredit(x, A); if (p) inter += p.credit / 2; } }
    skill = Math.min(1, inter / (A.size + B.size - [...A].filter((x) => B.has(x)).length));
  }
  const text = Math.min(1, cosine(tokens(`${a.title} ${a.title} ${a.description}`), tokens(`${b.title} ${b.title} ${b.description}`)) / 0.5);
  const raw = 0.5 * skill + 0.3 * text + 0.1 * (a.industry === b.industry ? 1 : 0) + 0.1 * (a.kind === b.kind ? 1 : 0);
  return Math.max(0, Math.min(1, raw));
}
