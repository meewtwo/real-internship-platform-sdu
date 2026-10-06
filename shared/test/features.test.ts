import { describe, expect, it } from 'vitest';
import {
  matchScore, partialCredit, validateSavedSearch, vacancyMatchesFilters, vacancySimilarity, skillKey,
  CLUSTER_CREDIT, IMPLIES_CREDIT, SKILL_CLUSTERS, SKILL_IMPLIES, CITY_KEYS, INDUSTRY_KEYS,
  type StudentSignal, type VacancySignal, type SavedFilters, type FilterableVacancy,
} from '../src';

// deterministic PRNG so a failing property test is reproducible
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
const ALL_SKILLS = [...new Set([...SKILL_CLUSTERS.flat(), ...Object.keys(SKILL_IMPLIES), 'python', 'java', 'rust'])];
const title = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());

const student = (over: Partial<StudentSignal> = {}): StudentSignal => ({
  skills: [], cvSkills: [], interests: [], cvText: '', majorKey: 'computer_science', interestArea: 'software_development', city: 'almaty', cityOther: null,
  relocation: 'yes', gpa: 3.5, experienceYears: 0, ...over,
});
const vacancy = (over: Partial<VacancySignal> = {}): VacancySignal => ({
  title: 'Frontend intern', description: 'Build user interfaces', requiredSkills: ['React'], industry: 'it_software', city: 'almaty', cityOther: null,
  workFormat: 'onsite', minGpa: null, ...over,
});

describe('skill graph', () => {
  it('related skills give partial credit, implications give more, exact/unrelated give none', () => {
    expect(partialCredit('react', new Set(['vue.js']))).toEqual({ via: 'vue.js', credit: CLUSTER_CREDIT });
    expect(partialCredit('sql', new Set(['postgresql']))).toEqual({ via: 'postgresql', credit: IMPLIES_CREDIT });
    expect(partialCredit('react', new Set(['react']))).toBeNull();
    expect(partialCredit('react', new Set(['accounting', 'teaching']))).toBeNull();
    expect(partialCredit('react', new Set())).toBeNull();
  });
  it('picks the best credit and breaks ties deterministically', () => {
    expect(partialCredit('sql', new Set(['mysql', 'postgresql']))).toEqual({ via: 'mysql', credit: IMPLIES_CREDIT });
    expect(partialCredit('python', new Set(['pandas', 'numpy']))?.via).toBe('numpy');
  });
  it('credits stay strictly below a full match, and clusters are symmetric', () => {
    expect(IMPLIES_CREDIT).toBeLessThan(1);
    for (const cl of SKILL_CLUSTERS) for (const a of cl) for (const b of cl) if (a !== b) {
      expect(partialCredit(a, new Set([b]))).not.toBeNull();
      expect(partialCredit(b, new Set([a]))).not.toBeNull();
    }
  });
});

describe('matchScore with partial skills', () => {
  it('Vue.js raises a React match above nothing, but below owning React', () => {
    const none = matchScore(student(), vacancy());
    const related = matchScore(student({ skills: ['Vue.js'] }), vacancy());
    const exact = matchScore(student({ skills: ['React'] }), vacancy());
    expect(related.percent).toBeGreaterThan(none.percent);
    expect(related.percent).toBeLessThan(exact.percent);
    expect(related.matchedSkills).toEqual([]);
    expect(related.missingSkills).toEqual(['React']);
    expect(related.partialSkills).toEqual([{ skill: 'React', via: 'vue.js', credit: CLUSTER_CREDIT }]);
    expect(exact.partialSkills).toEqual([]);
  });
  it('a vacancy without required skills keeps the neutral 0.5 and no partials', () => {
    const r = matchScore(student({ skills: ['Vue.js'] }), vacancy({ requiredSkills: [] }));
    expect(r.skill).toBe(0.5);
    expect(r.partialSkills).toEqual([]);
  });
  it('property: 0 ≤ percent ≤ 100, deterministic, partialSkills ⊆ missingSkills, skill score never decreases when a skill is added', () => {
    const rand = rng(42);
    const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
    const some = (n: number) => Array.from({ length: Math.floor(rand() * n) }, () => title(pick(ALL_SKILLS)));
    for (let i = 0; i < 600; i++) {
      const s = student({ skills: some(8), cvSkills: some(4), gpa: Math.round(rand() * 400) / 100, city: pick(CITY_KEYS), relocation: pick(['yes', 'no', 'remote'] as const) });
      const v = vacancy({ requiredSkills: some(7), industry: pick(INDUSTRY_KEYS), minGpa: rand() < 0.5 ? null : Math.round(rand() * 400) / 100, workFormat: pick(['onsite', 'hybrid', 'remote'] as const) });
      const r = matchScore(s, v);
      expect(Number.isInteger(r.percent) && r.percent >= 0 && r.percent <= 100).toBe(true);
      for (const x of [r.skill, r.text, r.fit, r.location]) expect(x >= 0 && x <= 1).toBe(true);
      expect(matchScore(s, v)).toEqual(r);
      const missing = new Set(r.missingSkills);
      for (const p of r.partialSkills) { expect(missing.has(p.skill)).toBe(true); expect(p.credit).toBeLessThan(1); expect(p.credit).toBeGreaterThan(0); }
      expect(new Set(r.matchedSkills.map(skillKey)).size + missing.size).toBe(new Set(v.requiredSkills.map(skillKey)).size);
      const more = matchScore({ ...s, skills: [...s.skills, title(pick(ALL_SKILLS))] }, v);
      expect(more.skill).toBeGreaterThanOrEqual(r.skill);
    }
  });
});

describe('vacancySimilarity', () => {
  const a = { ...vacancy({ title: 'Python data intern', description: 'Analyse data with Python and SQL', requiredSkills: ['Python', 'SQL'] }), kind: 'internship' };
  const b = { ...vacancy({ title: 'Data analyst intern', description: 'Python SQL dashboards and analysis', requiredSkills: ['Python', 'Power BI'] }), kind: 'internship' };
  const far = { ...vacancy({ title: 'Marketing manager', description: 'Run social media campaigns', requiredSkills: ['SMM', 'SEO'], industry: 'media_marketing' }), kind: 'full_time' };
  it('identical → ~1, similar > different, symmetric, bounded', () => {
    expect(vacancySimilarity(a, a)).toBeGreaterThan(0.99);
    expect(vacancySimilarity(a, b)).toBeGreaterThan(vacancySimilarity(a, far));
    expect(vacancySimilarity(a, b)).toBeCloseTo(vacancySimilarity(b, a), 10);
  });
  it('property: symmetric and within [0,1] for random vacancies; handles empty skill lists', () => {
    const rand = rng(7);
    const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
    const mk = () => ({ ...vacancy({ title: pick(['Intern', 'Analyst', 'Engineer', 'Designer']), description: pick(['build things', 'analyse data', 'write copy', '']), requiredSkills: Array.from({ length: Math.floor(rand() * 5) }, () => title(pick(ALL_SKILLS))), industry: pick(INDUSTRY_KEYS) }), kind: pick(['internship', 'full_time', 'part_time']) });
    for (let i = 0; i < 400; i++) {
      const x = mk(), y = mk();
      const s = vacancySimilarity(x, y);
      expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThanOrEqual(1);
      expect(s).toBeCloseTo(vacancySimilarity(y, x), 10);
    }
  });
});

describe('validateSavedSearch', () => {
  const ok = (filters: unknown, name: unknown = 'My search') => validateSavedSearch({ name, filters });
  it('accepts a real filter, trims/collapses the name and normalises types', () => {
    const r = ok({ q: ' python ', industry: 'it_software', salaryFrom: 300000, withSalary: true }, '  Dev   jobs  ');
    expect(r).toEqual({ ok: true, data: { name: 'Dev jobs', filters: { q: 'python', industry: 'it_software', kind: null, format: null, city: null, salaryFrom: 300000, withSalary: true } } });
  });
  it.each([
    ['empty filter (would alert on everything)', {}],
    ['only null/empty values', { q: '', industry: null }],
    ['unknown key', { q: 'x', sort: 'match' }],
    ['bad option', { industry: 'nope' }],
    ['bad salary', { q: 'x', salaryFrom: -5 }],
    ['object value', { q: { a: 1 } }],
    ['array filters', [1]],
    ['too long q', { q: 'x'.repeat(61) }],
  ])('rejects %s', (_n, f) => { const r = ok(f); expect(r.ok).toBe(false); if (!r.ok) expect(r.fields.filters).toBe('SEARCH_INVALID'); });
  it('rejects bad names and wrong shapes', () => {
    expect(ok({ q: 'x' }, '').ok).toBe(false);
    expect(ok({ q: 'x' }, '   ').ok).toBe(false);
    expect(ok({ q: 'x' }, 'a'.repeat(61))).toMatchObject({ ok: false, fields: { name: 'NAME_TOO_LONG' } });
    expect(ok({ q: 'x' }, 5)).toMatchObject({ ok: false, fields: { name: 'REQUIRED' } });
    expect(validateSavedSearch(null)).toMatchObject({ ok: false });
    expect(validateSavedSearch([])).toMatchObject({ ok: false });
    expect(validateSavedSearch({ name: 'a', filters: { q: 'x' }, extra: 1 })).toMatchObject({ ok: false, formError: 'UNKNOWN_FIELDS' });
    expect(validateSavedSearch(JSON.parse('{"name":"a","filters":{"q":"x"},"__proto__":{"admin":true}}'))).toMatchObject({ ok: false, formError: 'UNKNOWN_FIELDS' });
  });
});

describe('vacancyMatchesFilters', () => {
  const v: FilterableVacancy = { title: 'Junior Python Developer', description: 'Build data tools', companyName: 'Acme Technologies', requiredSkills: ['Python', 'SQL'], industry: 'it_software', kind: 'internship', workFormat: 'remote', city: 'almaty', salaryMin: 200000, salaryMax: 400000 };
  const f = (o: Partial<SavedFilters>): SavedFilters => ({ q: '', industry: null, kind: null, format: null, city: null, salaryFrom: null, withSalary: false, ...o });
  it('text search covers title, description, company and skills, case-insensitively', () => {
    for (const q of ['python', 'PYTHON', 'data tools', 'acme', 'sql']) expect(vacancyMatchesFilters(f({ q }), v)).toBe(true);
    expect(vacancyMatchesFilters(f({ q: 'java' }), v)).toBe(false);
  });
  it('exact filters and salary bounds', () => {
    expect(vacancyMatchesFilters(f({ industry: 'it_software', kind: 'internship', format: 'remote', city: 'almaty' }), v)).toBe(true);
    expect(vacancyMatchesFilters(f({ city: 'astana' }), v)).toBe(false);
    expect(vacancyMatchesFilters(f({ salaryFrom: 400000 }), v)).toBe(true);
    expect(vacancyMatchesFilters(f({ salaryFrom: 400001 }), v)).toBe(false);
    expect(vacancyMatchesFilters(f({ withSalary: true }), { ...v, salaryMin: null, salaryMax: null })).toBe(false);
    expect(vacancyMatchesFilters(f({ salaryFrom: 100 }), { ...v, salaryMin: null, salaryMax: null })).toBe(false);
  });
});
