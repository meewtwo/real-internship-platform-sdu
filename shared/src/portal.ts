/**
 * "SDU portal" import: turns a transcript (list of completed courses with grades) into a draft résumé.
 * There is no public SDU portal API, so the input is (a) a transcript the student exports/copies from the portal
 * (PDF text or pasted text) or (b) a demo transcript for presentations. Everything here is deterministic and offline.
 */
import { skillKey } from './matching';

export interface Course { code: string; name: string; credits: number; grade: string; points: number | null; semester: string | null }

const GRADE_POINTS: Record<string, number> = { 'A': 4, 'A-': 3.67, 'B+': 3.33, 'B': 3, 'B-': 2.67, 'C+': 2.33, 'C': 2, 'C-': 1.67, 'D+': 1.33, 'D': 1, 'F': 0 };
const PASSED = (g: string) => g.toUpperCase() !== 'F' && g.toUpperCase() !== 'W' && g.toUpperCase() !== 'I';

/** Course-name keywords → skills (names must exist in the skills vocabulary to be used). */
const COURSE_SKILLS: [RegExp, string[]][] = [
  [/programming|algorithm|data structure|computer science|cs50|oop|object[- ]oriented/i, ['Python', 'Java']],
  [/\bweb\b|front[- ]?end|html|internet technolog/i, ['HTML', 'CSS', 'JavaScript']],
  [/javascript|node|react|full[- ]?stack/i, ['JavaScript', 'Node.js', 'React']],
  [/database|sql|dbms|information systems/i, ['SQL', 'PostgreSQL']],
  [/machine learning|artificial intelligence|data mining|neural|deep learning/i, ['Machine Learning', 'Python']],
  [/data (science|analysis|analytics)|statistic|probability|econometric/i, ['Data Analysis', 'Statistics', 'Python']],
  [/network|operating system|linux|unix|system administration/i, ['Linux']],
  [/cyber|security|cryptograph|forensic|penetration/i, ['Cybersecurity', 'Cryptography', 'Network Security']],
  [/cloud|devops|distributed|container/i, ['Docker', 'AWS', 'CI/CD']],
  [/software engineering|software (design|development|testing)|agile|project management/i, ['Git', 'Agile', 'Scrum', 'Project Management']],
  [/java\b/i, ['Java']], [/c\+\+/i, ['C++']], [/c#|\.net/i, ['C#']], [/python/i, ['Python']],
  [/design|ux|ui\b|human[- ]computer/i, ['UI/UX Design', 'Figma']],
  [/financ|account|bank|audit|invest/i, ['Financial Analysis', 'Accounting', 'Banking', 'Excel']],
  [/econom/i, ['Economics', 'Excel']],
  [/marketing|advertis|brand|smm|social media/i, ['Marketing', 'SMM', 'SEO']],
  [/management|leadership|organi[sz]ation/i, ['Management', 'Leadership', 'Project Management']],
  [/law|legal|jurisprudence|contract/i, ['Law', 'Contract Law']],
  [/translat|linguistic|philolog|interpret/i, ['Translation', 'English', 'Communication']],
  [/english|academic writing|writing|rhetoric/i, ['English', 'Academic Writing']],
  [/public speaking|communication|presentation/i, ['Public Speaking', 'Communication']],
  [/teach|pedagog|didactic/i, ['Teaching']],
  [/research method|thesis|capstone/i, ['Research', 'Academic Writing']],
];

export function inferSkills(courses: Course[], vocabulary: string[]): string[] {
  const vocab = new Map(vocabulary.map((v) => [skillKey(v), v]));
  const weight = new Map<string, number>();
  for (const c of courses) {
    if (!PASSED(c.grade)) continue;
    const w = 1 + (c.points ?? 2) / 4;
    for (const [re, skills] of COURSE_SKILLS) if (re.test(c.name)) for (const s of skills) {
      const canon = vocab.get(skillKey(s));
      if (canon) weight.set(canon, (weight.get(canon) ?? 0) + w);
    }
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s).slice(0, 20);
}

const LINE = /^\s*(?:(\d{4}[\/\- ]?(?:\d{2,4})?\s*(?:fall|spring|summer|autumn|f|s)?|fall\s*\d{4}|spring\s*\d{4}|summer\s*\d{4})\s+)?([A-Z]{2,5}\s?-?\d{3,4}[A-Z]?)\s+(.{3,80}?)\s+(\d{1,2}(?:[.,]\d)?)\s+(A-?|B[+-]?|C[+-]?|D[+-]?|F|P|W|I|[0-9]{2,3})\s*$/i;

/** Parses transcript text lines like "CSC 101  Introduction to Programming  3  A" (optionally prefixed by a semester). */
export function parseTranscript(text: string): Course[] {
  const out: Course[] = [];
  const seen = new Set<string>();
  for (const raw of text.normalize('NFC').split(/\r?\n/)) {
    const m = LINE.exec(raw.replace(/\t+/g, '  ').replace(/\s{3,}/g, '  ').trim());
    if (!m) continue;
    const code = m[2].replace(/\s+/g, ' ').toUpperCase();
    if (seen.has(code)) continue;
    let grade = m[5].toUpperCase();
    let points: number | null = null;
    if (/^\d+$/.test(grade)) { const n = Number(grade); points = n >= 95 ? 4 : n >= 90 ? 3.67 : n >= 85 ? 3.33 : n >= 80 ? 3 : n >= 75 ? 2.67 : n >= 70 ? 2.33 : n >= 65 ? 2 : n >= 60 ? 1.67 : n >= 55 ? 1.33 : n >= 50 ? 1 : 0; grade = n >= 95 ? 'A' : n >= 90 ? 'A-' : n >= 85 ? 'B+' : n >= 80 ? 'B' : n >= 75 ? 'B-' : n >= 70 ? 'C+' : n >= 65 ? 'C' : n >= 60 ? 'C-' : n >= 50 ? 'D' : 'F'; }
    else points = GRADE_POINTS[grade] ?? null;
    const credits = Number(m[4].replace(',', '.'));
    if (!(credits > 0 && credits <= 30)) continue;
    seen.add(code);
    out.push({ code, name: m[3].trim().replace(/\s{2,}/g, ' '), credits, grade, points, semester: m[1]?.trim() || null });
    if (out.length >= 80) break;
  }
  return out;
}

export function weightedGpa(courses: Course[]): number | null {
  const graded = courses.filter((c) => c.points !== null && PASSED(c.grade));
  const cr = graded.reduce((a, c) => a + c.credits, 0);
  return cr ? Math.round((graded.reduce((a, c) => a + c.credits * (c.points as number), 0) / cr) * 100) / 100 : null;
}

export function topCourses(courses: Course[], n = 6): Course[] {
  return [...courses].filter((c) => PASSED(c.grade) && c.points !== null).sort((a, b) => (b.points! - a.points!) || b.credits - a.credits).slice(0, n);
}

/** Demo transcripts per major, so the portal import can be shown without a real account. */
export const DEMO_TRANSCRIPTS: Record<string, string> = {
  default: `2024 Fall   CSC 101   Introduction to Programming   6   A
2024 Fall   MAT 101   Calculus I   6   B+
2024 Fall   ENG 101   Academic Writing   4   A-
2025 Spring CSC 102   Object Oriented Programming   6   A
2025 Spring CSC 201   Data Structures and Algorithms   6   A-
2025 Spring MAT 201   Probability and Statistics   5   B+
2025 Fall   CSC 210   Database Systems   6   A
2025 Fall   CSC 230   Web Programming   6   A
2025 Fall   CSC 240   Operating Systems and Linux   5   B+
2026 Spring CSC 310   Machine Learning   6   A-
2026 Spring CSC 320   Software Engineering and Agile Methods   6   A
2026 Spring CSC 330   Cloud Computing and DevOps   5   B+`,
  finance: `2024 Fall   FIN 101   Principles of Finance   6   A
2024 Fall   ECO 101   Microeconomics   6   A-
2025 Spring ACC 201   Financial Accounting   6   B+
2025 Spring MAT 201   Probability and Statistics   5   A
2025 Fall   FIN 301   Corporate Finance and Investment   6   A
2025 Fall   FIN 310   Banking and Financial Markets   6   A-
2026 Spring MGT 201   Management and Leadership   5   B+
2026 Spring ENG 201   Business English and Presentation   4   A`,
  marketing: `2024 Fall   MKT 101   Principles of Marketing   6   A
2025 Spring MKT 210   Social Media Marketing and SMM   6   A
2025 Fall   MKT 310   Brand Management and Advertising   6   A-
2025 Fall   DES 201   Visual Design and UX   5   B+
2026 Spring MKT 330   Digital Marketing Analytics and SEO   6   A
2026 Spring ENG 201   Public Speaking and Communication   4   A`,
  law: `2024 Fall   LAW 101   Introduction to Jurisprudence   6   A
2025 Spring LAW 201   Contract Law   6   A-
2025 Fall   LAW 301   Civil and Commercial Law   6   B+
2026 Spring LAW 320   Legal Writing and Research Methods   5   A
2026 Spring ENG 201   Academic Writing   4   A-`,
};
export const demoTranscriptFor = (major: string) =>
  ({ finance: 'finance', economics: 'finance', management: 'finance', marketing: 'marketing', journalism: 'marketing', law: 'law', international_relations: 'law' } as Record<string, string>)[major] ?? 'default';

export interface ResumeDraft { about: string; highlights: string[] }
/** Short, factual summary text (no invented claims): only what the transcript and profile state. */
export function draftResume(p: { name: string; major: string; year: string; gpa: string; interestArea: string }, courses: Course[], skills: string[], lang: 'en' | 'ru' | 'kk', t: { major: string; interest: string; year: string }): ResumeDraft {
  const top = topCourses(courses, 3).map((c) => c.name);
  const g = weightedGpa(courses);
  const sk = skills.slice(0, 6).join(', ');
  const tpl = {
    en: `${t.year} student of ${t.major} at SDU University (GPA ${p.gpa}). Seeking an internship in ${t.interest}. Completed ${courses.length} courses, including ${top.join(', ')}.${sk ? ` Practical skills from coursework: ${sk}.` : ''}`,
    ru: `Студент(ка) ${t.year} университета SDU, направление «${t.major}» (GPA ${p.gpa}). Ищу стажировку: ${t.interest}. Пройдено курсов: ${courses.length}, в том числе ${top.join(', ')}.${sk ? ` Навыки по итогам курсов: ${sk}.` : ''}`,
    kk: `SDU университетінің ${t.year} студенті, бағыты «${t.major}» (GPA ${p.gpa}). Тағылымдама іздеймін: ${t.interest}. Өтілген курстар: ${courses.length}, оның ішінде ${top.join(', ')}.${sk ? ` Курстардан алынған дағдылар: ${sk}.` : ''}`,
  }[lang];
  const cap = (x: string) => x.charAt(0).toLocaleUpperCase() + x.slice(1);
  const highlights = topCourses(courses, 5).map((c) => `${c.name} — ${c.grade}`);
  if (g !== null) highlights.unshift(`GPA: ${g.toFixed(2)} (${courses.reduce((a, c) => a + c.credits, 0)} credits)`);
  return { about: cap(tpl), highlights };
}
