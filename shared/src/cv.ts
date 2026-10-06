/** Skill and experience extraction from CV plain text (heuristics, language-agnostic, no external service). */
import { skillKey } from './matching';

const ALIASES: Record<string, string> = {
  js: 'JavaScript', ts: 'TypeScript', k8s: 'Kubernetes', postgres: 'PostgreSQL', node: 'Node.js', nodejs: 'Node.js', 'react.js': 'React', reactjs: 'React',
  'vue': 'Vue.js', ml: 'Machine Learning', golang: 'Go', 'scikit-learn': 'Machine Learning', 'power bi': 'Power BI', 'ms excel': 'Excel', ux: 'UI/UX Design',
  'ci cd': 'CI/CD', gcp: 'Google Cloud', 'rest': 'REST API', 'restful': 'REST API', 'oop': 'Java', 'smm': 'SMM', 'machine-learning': 'Machine Learning',
  'машинное обучение': 'Machine Learning', 'анализ данных': 'Data Analysis', 'английский': 'English', 'русский': 'Russian', 'казахский': 'Kazakh', 'turkish language': 'Turkish',
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Finds vocabulary skills (and aliases) in `text`. Very short names (≤3 letters, e.g. "Go", "SQL") must match case-sensitively. */
export function extractSkills(text: string, vocabulary: string[]): string[] {
  const vocab = new Map(vocabulary.map((v) => [skillKey(v), v]));
  const found = new Set<string>();
  const test = (needle: string, canonical: string) => {
    const short = Array.from(needle).length <= 3;
    const re = new RegExp(`(?<![\\p{L}\\p{N}+#])${esc(needle)}(?![\\p{L}\\p{N}+#]|\\.[\\p{L}\\p{N}])`, short ? 'u' : 'iu');
    if (re.test(text)) found.add(canonical);
  };
  for (const v of vocabulary) test(v, v);
  for (const [alias, target] of Object.entries(ALIASES)) {
    const canonical = vocab.get(skillKey(target));
    if (canonical && !found.has(canonical)) test(alias, canonical);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

export interface ExperienceItem { line: string; months: number }
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  янв: 1, фев: 2, мар: 3, апр: 4, май: 5, мая: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12 };
const EDU = /university|college|bachelor|master|degree|gpa|school|университет|колледж|бакалавр|магистр|школ|институт/i;
const RANGE = /(?:(\p{L}{3,9})\.?\s+)?((?:19|20)\d{2})\s*(?:[-–—]|to|по|до)\s*(?:(?:(\p{L}{3,9})\.?\s+)?((?:19|20)\d{2})|(present|current|now|ongoing|настоящее время|по настоящее время|н\.в\.|қазір))/iu;

export function extractExperience(text: string, now: Date = new Date()): { years: number; items: ExperienceItem[] } {
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const items: ExperienceItem[] = [];
  const spans: [number, number][] = [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const m = RANGE.exec(line);
    if (!m || EDU.test(line) || EDU.test(lines[i - 1] ?? '') && !/(intern|engineer|developer|analyst|manager|assistant|специалист|разработчик|стажер|стажёр)/i.test(line)) return;
    const mon = (x?: string) => (x ? MONTHS[x.slice(0, 3).toLowerCase()] ?? 1 : 1);
    const start = Number(m[2]) * 12 + mon(m[1]) - 1;
    const end = m[5] ? nowIdx : Number(m[4]) * 12 + mon(m[3]) - 1;
    if (end < start || start > nowIdx || end - start > 12 * 45) return;
    const e = Math.min(end, nowIdx);
    spans.push([start, e]);
    items.push({ line: line.slice(0, 140), months: Math.max(1, e - start) });
  });
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0, cur: [number, number] | null = null;
  for (const s of spans) {
    if (!cur) cur = [...s];
    else if (s[0] <= cur[1]) cur[1] = Math.max(cur[1], s[1]);
    else { total += cur[1] - cur[0]; cur = [...s]; }
  }
  if (cur) total += Math.max(1, cur[1] - cur[0]);
  let explicit = 0;
  for (const m of text.matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?|лет|года|год)\b[^.\n]{0,25}(?:experience|опыт)/giu)) explicit = Math.max(explicit, Number(m[1]));
  const years = Math.min(60, Math.round(Math.max(explicit, total / 12) * 10) / 10);
  return { years, items: items.slice(0, 12) };
}
