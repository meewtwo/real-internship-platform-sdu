import { describe, expect, it } from 'vitest';
import { extractExperience, extractSkills, matchScore, parseSearchQuery, validateDeadline, validateVacancy, validateCoverNote, type StudentSignal, type VacancySignal } from '../src';

const VOCAB = ['Python', 'SQL', 'C++', 'C#', 'Go', 'JavaScript', 'Node.js', 'React', 'Machine Learning', 'Java', 'PostgreSQL', 'Kubernetes', 'CI/CD'];
const NOW = new Date('2026-10-05T10:00:00Z');

describe('skill extraction', () => {
  it('finds vocabulary skills and aliases, with sane boundaries', () => {
    const t = 'Built REST services in python and Node.js; wrote SQL (postgres), C++ tools; k8s, CI/CD pipelines. JavaScript, js.';
    expect(extractSkills(t, VOCAB)).toEqual(['C++', 'CI/CD', 'JavaScript', 'Kubernetes', 'Node.js', 'PostgreSQL', 'Python', 'SQL']);
  });
  it('does not match substrings or short lowercase words', () => {
    expect(extractSkills('We will go to the javascripting class; cpp; sqlite; Pythonic; business', VOCAB)).toEqual([]);
    expect(extractSkills('Experienced in Go and Java.', VOCAB)).toEqual(['Go', 'Java']);
    expect(extractSkills('go java', VOCAB)).toEqual(['Java']);
  });
  it('handles Cyrillic aliases and regex metacharacters safely', () => {
    expect(extractSkills('машинное обучение и python', VOCAB)).toEqual(['Machine Learning', 'Python']);
    expect(extractSkills('(a+b)*[c] .* ^$ \\', ['C++', '(a+b)'])).toEqual(['(a+b)']);
  });
});

describe('experience extraction', () => {
  it('sums merged date ranges, ignores education, handles "present"', () => {
    const t = 'Software Engineer, Acme\nJan 2022 - Mar 2023\nIntern, Beta 2021 - 2022\nBachelor, Some University 2018 - 2022\nDeveloper Jun 2023 – Present';
    const e = extractExperience(t, NOW);
    expect(e.items.length).toBe(3); // education line excluded
    expect(e.years).toBeGreaterThan(3.5);
    expect(e.years).toBeLessThan(6);
  });
  it('explicit claims and junk', () => {
    expect(extractExperience('5+ years of experience in backend', NOW).years).toBe(5);
    expect(extractExperience('2019 - 2010\n2050 - 2060', NOW).years).toBe(0);
    expect(extractExperience('', NOW)).toEqual({ years: 0, items: [] });
  });
});

const student = (o: Partial<StudentSignal> = {}): StudentSignal => ({
  skills: ['Python', 'SQL'], cvSkills: [], interests: [], cvText: 'data analysis python sql dashboards', majorKey: 'computer_science', interestArea: 'data_ai',
  city: 'almaty', cityOther: null, relocation: 'no', gpa: 3.5, experienceYears: 1, ...o,
});
const vacancy = (o: Partial<VacancySignal> = {}): VacancySignal => ({
  title: 'Data analyst intern', description: 'Analyse data with Python and SQL, build dashboards', requiredSkills: ['Python', 'SQL'], industry: 'it_software',
  city: 'almaty', cityOther: null, workFormat: 'onsite', minGpa: null, ...o,
});

describe('matching', () => {
  it('perfect fit scores high and explains matched/missing skills', () => {
    const m = matchScore(student(), vacancy());
    expect(m.percent).toBeGreaterThanOrEqual(90);
    expect(m.matchedSkills).toEqual(['Python', 'SQL']);
    expect(m.missingSkills).toEqual([]);
  });
  it('missing skills lower the score monotonically', () => {
    const full = matchScore(student(), vacancy()).percent;
    const half = matchScore(student({ skills: ['Python'], cvText: '' }), vacancy()).percent;
    const none = matchScore(student({ skills: [], cvText: '' }), vacancy()).percent;
    expect(full).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(none);
    expect(matchScore(student({ skills: ['Python'] }), vacancy()).missingSkills).toEqual(['SQL']);
  });
  it('CV skills count, case-insensitively', () => {
    expect(matchScore(student({ skills: [], cvSkills: ['python', 'sql'] }), vacancy()).matchedSkills).toEqual(['Python', 'SQL']);
  });
  it('location: remote vacancy beats relocation refusal; remote-only student cannot take on-site', () => {
    const far = vacancy({ city: 'astana' });
    expect(matchScore(student({ relocation: 'no' }), far).location).toBe(0.15);
    expect(matchScore(student({ relocation: 'yes' }), far).location).toBe(0.7);
    expect(matchScore(student({ relocation: 'remote' }), far).location).toBe(0);
    expect(matchScore(student({ relocation: 'remote' }), vacancy({ workFormat: 'remote', city: 'astana' })).location).toBe(1);
  });
  it('GPA below the minimum is penalised and flagged', () => {
    const ok = matchScore(student({ gpa: 3.5 }), vacancy({ minGpa: 3.0 }));
    const low = matchScore(student({ gpa: 2.5 }), vacancy({ minGpa: 3.0 }));
    expect(low.gpaBelowMin).toBe(true);
    expect(low.percent).toBeLessThan(ok.percent);
  });
  it('always within 0..100, even for empty/odd input', () => {
    for (const s of [student({ skills: [], cvText: '', interests: [] }), student({ cvText: 'x'.repeat(100_000) })])
      for (const v of [vacancy({ requiredSkills: [] }), vacancy({ description: '' })]) {
        const p = matchScore(s, v).percent;
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(100);
      }
  });
});

describe('vacancy validation', () => {
  const ok = { title: 'Backend Intern', description: 'Build APIs with TypeScript and PostgreSQL for our platform.', kind: 'internship', industry: 'it_software', city: 'astana', workFormat: 'hybrid', requiredSkills: ['TypeScript'] };
  it('valid', () => expect(validateVacancy(ok, NOW).ok).toBe(true));
  it.each([
    [{ title: 'ab' }, 'title', 'VACANCY_TITLE_INVALID'], [{ title: '<script>' }, 'title', 'VACANCY_TITLE_INVALID'], [{ title: '  ' }, 'title', 'REQUIRED'],
    [{ description: 'too short' }, 'description', 'VACANCY_DESCRIPTION_INVALID'], [{ description: 'x'.repeat(4001) }, 'description', 'VACANCY_DESCRIPTION_TOO_LONG'],
    [{ kind: 'slave' }, 'kind', 'VACANCY_KIND_INVALID'], [{ workFormat: 'moon' }, 'workFormat', 'WORK_FORMAT_INVALID'],
    [{ requiredSkills: [] }, 'requiredSkills', 'VACANCY_SKILLS_REQUIRED'], [{ requiredSkills: Array.from({ length: 16 }, (_, i) => `Skill ${i}`) }, 'requiredSkills', 'VACANCY_SKILLS_TOO_MANY'],
    [{ requiredSkills: ['<b>'] }, 'requiredSkills', 'TAG_INVALID'], [{ minGpa: '4.5' }, 'minGpa', 'GPA_OUT_OF_RANGE'], [{ deadline: '2020-01-01' }, 'deadline', 'DEADLINE_PAST'],
    [{ deadline: '2026-02-30' }, 'deadline', 'DEADLINE_INVALID'], [{ deadline: '2031-01-01' }, 'deadline', 'DEADLINE_INVALID'], [{ city: 'other' }, 'cityOther', 'REQUIRED'],
  ])('%j → %s %s', (over, field, code) => {
    const r = validateVacancy({ ...ok, ...over }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fields[field]).toBe(code);
  });
  it('rejects unknown fields (mass assignment)', () => {
    expect(validateVacancy({ ...ok, status: 'published', employerId: 'x' }, NOW)).toMatchObject({ ok: false, formError: 'UNKNOWN_FIELDS' });
  });
  it('deadline today is allowed', () => expect(validateDeadline('2026-10-05', NOW).ok).toBe(true));
  it('cover note limits', () => {
    expect(validateCoverNote('x'.repeat(1000)).ok).toBe(true);
    expect(validateCoverNote('x'.repeat(1001))).toEqual({ ok: false, code: 'COVER_NOTE_TOO_LONG' });
    expect(validateCoverNote('   ')).toEqual({ ok: true, value: null });
  });
});

describe('search query parsing', () => {
  it('defaults and valid filters', () => {
    expect(parseSearchQuery({})).toMatchObject({ ok: true, value: { q: '', sort: 'match', page: 1 } });
    expect(parseSearchQuery({ q: ' python ', industry: 'it_software', kind: 'internship', format: 'remote', city: 'almaty', sort: 'newest', page: '2' })).toMatchObject({ ok: true, value: { q: 'python', page: 2 } });
  });
  it.each([{ industry: 'x' }, { kind: 'x' }, { format: 'x' }, { city: 'x' }, { sort: 'x' }, { page: '0' }, { page: '-1' }, { page: '1e3' }, { q: 'a'.repeat(61) }])('%j → SEARCH_INVALID', (q) => {
    expect(parseSearchQuery(q as never)).toEqual({ ok: false, code: 'SEARCH_INVALID' });
  });
});

import { demoTranscriptFor, DEMO_TRANSCRIPTS, draftResume, inferSkills, parseTranscript, topCourses, validateSalary, weightedGpa } from '../src';

describe('portal transcript → résumé', () => {
  const vocab = ['Python', 'Java', 'SQL', 'PostgreSQL', 'HTML', 'CSS', 'JavaScript', 'Machine Learning', 'Linux', 'Docker', 'AWS', 'CI/CD', 'Git', 'Agile', 'Scrum', 'Project Management', 'Statistics', 'Data Analysis', 'Marketing', 'SMM', 'SEO'];
  it('parses semester-prefixed lines and weights GPA by credits', () => {
    const c = parseTranscript(DEMO_TRANSCRIPTS.default);
    expect(c).toHaveLength(12);
    expect(c[0]).toMatchObject({ code: 'CSC 101', name: 'Introduction to Programming', credits: 6, grade: 'A', points: 4 });
    expect(weightedGpa(c)).toBeGreaterThan(3.5);
    expect(topCourses(c, 2).map((x) => x.grade)).toEqual(['A', 'A']);
  });
  it('accepts numeric grades, comma credits, dedupes and ignores junk', () => {
    const c = parseTranscript('CSC101  Intro to Programming  3,0  92\nCSC101  Intro to Programming  3  A\nnot a course line\nFIN 201 Corporate Finance 6 F\n<script>alert(1)</script>');
    expect(c.map((x) => [x.code, x.grade])).toEqual([['CSC101', 'A-'], ['FIN 201', 'F']]);
    expect(parseTranscript('')).toEqual([]);
    expect(parseTranscript('x'.repeat(100_000))).toEqual([]);
  });
  it('infers skills only from passed courses and only from the vocabulary', () => {
    const skills = inferSkills(parseTranscript(DEMO_TRANSCRIPTS.default), vocab);
    for (const s of ['Python', 'SQL', 'HTML', 'JavaScript', 'Machine Learning', 'Linux', 'Docker']) expect(skills).toContain(s);
    expect(inferSkills(parseTranscript('CSC 310 Machine Learning 6 F'), vocab)).toEqual([]);
    expect(inferSkills(parseTranscript(DEMO_TRANSCRIPTS.marketing), vocab)).toEqual(expect.arrayContaining(['Marketing', 'SMM', 'SEO']));
  });
  it('demo transcript depends on the major; draft text states only facts', () => {
    expect(demoTranscriptFor('finance')).toBe('finance');
    expect(demoTranscriptFor('computer_science')).toBe('default');
    const c = parseTranscript(DEMO_TRANSCRIPTS.default);
    const d = draftResume({ name: 'A', major: 'computer science', year: '3', gpa: '3.65', interestArea: 'data ai' }, c, ['Python'], 'en', { major: 'computer science', interest: 'data ai', year: 'year 3' });
    expect(d.about).toContain('12 courses');
    expect(d.about).toContain('GPA 3.65');
    expect(d.highlights[0]).toMatch(/^GPA: \d\.\d\d/);
  });
});

describe('salary', () => {
  it.each([[undefined, null], ['', null], [null, null], [300000, 300000], ['450000', 450000]])('%j → %j', (v, e) => expect(validateSalary(v)).toEqual({ ok: true, value: e }));
  it.each([[0], [-5], ['abc'], ['1e6'], [1.5], [100000001], ['9999999999'], [{}]])('%j rejected', (v) => expect(validateSalary(v)).toEqual({ ok: false, code: 'SALARY_INVALID' }));
});
