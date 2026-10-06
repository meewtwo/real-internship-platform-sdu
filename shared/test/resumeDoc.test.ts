import { describe, expect, it } from 'vitest';
import { emptyResumeDoc, httpsUrl, resumeKeywordGap, reviewResume, validateResumeDoc, validateResumeMeta, type ResumeDoc } from '../src';

const GOOD: ResumeDoc = {
  personal: { fullName: 'Aigerim Nurlanova', headline: 'Data analyst', email: 'aigerim@example.com', phone: '+7 701 123 45 67', city: 'Almaty', links: [{ label: 'GitHub', url: 'https://github.com/aigerim' }] },
  summary: 'Final-year student with hands-on experience in Python and SQL, building dashboards that cut reporting time for analytics teams.',
  experience: [{ role: 'Data intern', company: 'Acme', location: 'Almaty', start: '2024-06', end: 'present', bullets: ['Built 12 dashboards used by 40 analysts', 'Automated weekly reports, saving 6 hours per week'] }],
  education: [{ institution: 'SDU University', degree: 'BSc Computer Science', start: '2022-09', end: '2026-06', details: 'GPA 3.65' }],
  projects: [{ name: 'Churn model', url: 'https://example.com/churn', description: 'Predicts churn with 0.87 AUC', tech: ['Python', 'scikit-learn'] }],
  skills: [{ group: 'Languages', items: ['Python', 'SQL', 'JavaScript'] }, { group: 'Tools', items: ['Docker', 'Git', 'Power BI'] }],
  languages: [{ name: 'English', level: 'B2' }], certificates: [{ name: 'Google Data Analytics', issuer: 'Coursera', year: '2024' }],
};
const ok = (x: unknown) => { const r = validateResumeDoc(x); if (!r.ok) throw new Error(JSON.stringify(r)); return r.data; };
const bad = (x: unknown) => { const r = validateResumeDoc(x); expect(r.ok).toBe(false); return r.ok ? {} : r.fields; };

describe('validateResumeDoc', () => {
  it('accepts a complete document unchanged, and the empty document needs only a name', () => {
    expect(ok(GOOD)).toEqual(GOOD);
    expect(bad(emptyResumeDoc())).toEqual({ 'personal.fullName': 'REQUIRED' });
    expect(ok({ personal: { fullName: 'A B' } }).experience).toEqual([]);
  });
  it('is idempotent: validating validated output returns the same value', () => {
    const once = ok({ ...GOOD, summary: '  Hello\r\n\r\n\r\n\r\nworld\u0000  ', personal: { ...GOOD.personal, fullName: '  Aigerim \t Nurlanova​ ' } });
    expect(once.personal.fullName).toBe('Aigerim Nurlanova');
    expect(once.summary).toBe('Hello\n\nworld');
    expect(ok(once)).toEqual(once);
  });
  it('rejects wrong shapes at every level and never throws', () => {
    expect(validateResumeDoc(null)).toMatchObject({ ok: false, formError: 'VALIDATION_FAILED' });
    expect(validateResumeDoc([])).toMatchObject({ ok: false });
    expect(validateResumeDoc('x')).toMatchObject({ ok: false });
    expect(bad({ personal: 'x' }).personal).toBe('RESUME_FIELD_INVALID');
    expect(bad({ personal: { fullName: 5 } })['personal.fullName']).toBe('RESUME_FIELD_INVALID');
    expect(bad({ personal: { fullName: 'A' }, experience: 'x' }).experience).toBe('RESUME_FIELD_INVALID');
    expect(bad({ personal: { fullName: 'A' }, experience: [5] })['experience.0']).toBe('RESUME_FIELD_INVALID');
    expect(bad({ personal: { fullName: 'A' }, evil: 1 })._).toBe('UNKNOWN_FIELDS');
    expect(bad({ personal: { fullName: 'A', admin: true } }).personal).toBe('UNKNOWN_FIELDS');
    expect(bad({ personal: { fullName: 'A' }, experience: [{ role: 'x', __proto__: { a: 1 }, polluted: 1 }] })['experience.0']).toBe('UNKNOWN_FIELDS');
  });
  it('enforces lengths without silently truncating, and counts code points', () => {
    expect(bad({ personal: { fullName: 'x'.repeat(81) } })['personal.fullName']).toBe('RESUME_TEXT_TOO_LONG');
    expect(ok({ personal: { fullName: '😀'.repeat(80) } }).personal.fullName).toBe('😀'.repeat(80));
    expect(bad({ personal: { fullName: 'A' }, summary: 'x'.repeat(601) }).summary).toBe('RESUME_TEXT_TOO_LONG');
    expect(bad({ personal: { fullName: 'A' }, experience: [{ role: 'r', bullets: ['x'.repeat(241)] }] })['experience.0.bullets.0']).toBe('RESUME_TEXT_TOO_LONG');
  });
  it('caps list sizes (and drops fully empty rows so the UI can keep blank rows)', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ role: `Role ${i}` }));
    expect(ok({ personal: { fullName: 'A' }, experience: many(10) }).experience).toHaveLength(10);
    expect(bad({ personal: { fullName: 'A' }, experience: many(11) }).experience).toBe('RESUME_TOO_MANY_ITEMS');
    expect(bad({ personal: { fullName: 'A' }, experience: many(1000) }).experience).toBe('RESUME_TOO_MANY_ITEMS');
    expect(ok({ personal: { fullName: 'A' }, experience: [{}, { role: '', bullets: [''] }, { role: 'X' }], skills: [{ group: '', items: [] }], projects: [{ name: ' ' }] })).toMatchObject({ experience: [{ role: 'X' }], skills: [], projects: [] });
    expect(bad({ personal: { fullName: 'A' }, experience: [{ role: 'r', bullets: Array(7).fill('b') }] })['experience.0.bullets']).toBe('RESUME_TOO_MANY_ITEMS');
  });
  it('requires a role for an experience row that has other content', () => {
    expect(bad({ personal: { fullName: 'A' }, experience: [{ company: 'Acme' }] })['experience.0.role']).toBe('REQUIRED');
    expect(bad({ personal: { fullName: 'A' }, education: [{ degree: 'BSc' }] })['education.0.institution']).toBe('REQUIRED');
  });
  it('dates: YYYY-MM only, sane range, end ≥ start, "present" only for end', () => {
    const exp = (start: string, end: string) => ({ personal: { fullName: 'A' }, experience: [{ role: 'r', start, end }] });
    expect(ok(exp('2023-01', '2024-12')).experience[0]).toMatchObject({ start: '2023-01', end: '2024-12' });
    for (const [s, e] of [['2023-13', ''], ['23-01', ''], ['1959-12', ''], ['2023-1', ''], ['2023/01', ''], ['present', ''], ['', '2999-01'], ['2024-05', '2024-04']] as const) expect(Object.values(bad(exp(s, e))).includes('RESUME_DATE_INVALID'), `${s} ${e}`).toBe(true);
    expect(bad({ personal: { fullName: 'A' }, certificates: [{ name: 'c', year: '24' }] })['certificates.0.year']).toBe('RESUME_DATE_INVALID');
  });
  it('contact fields: email/phone formats; links must be https with a real host', () => {
    expect(bad({ personal: { fullName: 'A', email: 'nope' } })['personal.email']).toBe('EMAIL_INVALID');
    expect(bad({ personal: { fullName: 'A', phone: 'call me' } })['personal.phone']).toBe('PHONE_INVALID');
    for (const u of ['http://x.com', 'javascript:alert(1)', 'https://', 'https://localhost', 'https://u:p@x.com', 'ftp://x.com', 'x.com', 'https://a b.com', 'data:text/html,hi', `https://x.com/${'a'.repeat(200)}`]) expect(httpsUrl(u), u).toBeNull();
    expect(httpsUrl('https://github.com/a?b=1#c')).toBe('https://github.com/a?b=1#c');
    expect(bad({ personal: { fullName: 'A', links: [{ label: 'x', url: 'javascript:alert(1)' }] } })['personal.links.0.url']).toBe('RESUME_URL_INVALID');
    expect(bad({ personal: { fullName: 'A', links: [{ label: '', url: 'https://x.com' }] } })['personal.links.0.label']).toBe('REQUIRED');
    expect(bad({ personal: { fullName: 'A' }, projects: [{ name: 'p', url: 'http://x.com' }] })['projects.0.url']).toBe('RESUME_URL_INVALID');
  });
  it('skills are deduped case-insensitively within a group', () => {
    expect(ok({ personal: { fullName: 'A' }, skills: [{ group: 'g', items: ['Python', 'python', 'SQL', ' PYTHON '] }] }).skills[0].items).toEqual(['Python', 'SQL']);
  });
  it('markup is kept as inert text (rendering escapes it) and control characters never survive', () => {
    const d = ok({ personal: { fullName: '<img src=x onerror=alert(1)>' }, summary: '<script>alert(1)</script>\u0007' });
    expect(d.personal.fullName).toBe('<img src=x onerror=alert(1)>');
    expect(d.summary).toBe('<script>alert(1)</script>');
  });
  it('fuzz: random JSON-ish garbage never throws, and any accepted result re-validates to itself', () => {
    let seed = 99; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const atoms = [null, true, 0, -1, 1e9, 'x', '', ' ', '2024-01', 'present', 'https://a.com', '😀', 'a'.repeat(300), [], {}, ['a', 1], { role: 'r' }, { name: 'n' }];
    const gen = (d: number): unknown => (d <= 0 || rnd() < 0.3 ? atoms[Math.floor(rnd() * atoms.length)] : rnd() < 0.5 ? Array.from({ length: Math.floor(rnd() * 4) }, () => gen(d - 1)) : Object.fromEntries(['personal', 'summary', 'experience', 'education', 'projects', 'skills', 'languages', 'certificates', 'fullName', 'role', 'bullets', 'items', 'links', 'x'].filter(() => rnd() < 0.3).map((k) => [k, gen(d - 1)])));
    let accepted = 0;
    for (let i = 0; i < 3000; i++) {
      const r = validateResumeDoc(gen(4));
      if (r.ok) { accepted++; expect(validateResumeDoc(r.data)).toEqual({ ok: true, data: r.data }); expect(JSON.stringify(r.data)).not.toMatch(/[\u0000-\u0008\u000B-\u001F]/); }
    }
    expect(accepted).toBeGreaterThanOrEqual(0);
  });
});

describe('validateResumeMeta', () => {
  it('validates title/template/language; partial for updates', () => {
    expect(validateResumeMeta({ title: ' My CV ', template: 'modern', language: 'ru' })).toEqual({ ok: true, data: { title: 'My CV', template: 'modern', language: 'ru' } });
    expect(validateResumeMeta({ title: '' })).toMatchObject({ ok: false, fields: { title: 'REQUIRED' } });
    expect(validateResumeMeta({ template: 'fancy' }, true)).toMatchObject({ ok: false, fields: { template: 'RESUME_FIELD_INVALID' } });
    expect(validateResumeMeta({ language: 'de' }, true)).toMatchObject({ ok: false });
    expect(validateResumeMeta({}, true)).toEqual({ ok: true, data: {} });
    expect(validateResumeMeta({ title: 'x'.repeat(81) })).toMatchObject({ ok: false, fields: { title: 'RESUME_TEXT_TOO_LONG' } });
  });
});

describe('reviewResume', () => {
  it('a strong résumé scores high with strengths', () => {
    const r = reviewResume(GOOD);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.strengths).toEqual(expect.arrayContaining(['quantified', 'has_links', 'complete_contact']));
    expect(r.issues.map((i) => i.issue)).toEqual(['few_skills'].filter((x) => r.issues.some((i) => i.issue === x)));
  });
  it('an empty résumé scores low, lists actionable issues; score stays within 0–100', () => {
    const r = reviewResume({ ...emptyResumeDoc(), personal: { ...emptyResumeDoc().personal, fullName: 'A' } });
    expect(r.score).toBeLessThan(50);
    expect(r.issues.map((i) => i.issue)).toEqual(expect.arrayContaining(['no_summary', 'no_experience', 'no_education', 'no_email', 'few_skills']));
  });
  it('flags weak bullet starts (EN/RU), missing numbers, missing bullets, with exact positions', () => {
    const r = reviewResume({ ...GOOD, experience: [{ role: 'x', company: '', location: '', start: '', end: '', bullets: ['Responsible for reports', 'Отвечал за отчёты', 'Built 3 tools'] }, { role: 'y', company: '', location: '', start: '', end: '', bullets: [] }] });
    expect(r.issues).toEqual(expect.arrayContaining([
      { issue: 'bullet_weak_start', section: 'experience', index: 0, bullet: 0 }, { issue: 'bullet_weak_start', section: 'experience', index: 0, bullet: 1 },
      { issue: 'bullet_no_numbers', section: 'experience', index: 0, bullet: 0 }, { issue: 'no_bullets', section: 'experience', index: 1 },
    ]));
    expect(r.issues).not.toContainEqual({ issue: 'bullet_no_numbers', section: 'experience', index: 0, bullet: 2 });
  });
  it('per-item penalties are capped so a long weak list cannot dominate; monotonic: fixing an issue never lowers the score', () => {
    const weak = { ...GOOD, experience: [{ role: 'x', company: '', location: '', start: '', end: '', bullets: Array(6).fill('did things') }] };
    const base = reviewResume(weak).score;
    expect(base).toBeGreaterThan(60);
    expect(reviewResume({ ...weak, summary: '' }).score).toBeLessThan(base);
    expect(reviewResume({ ...weak, personal: { ...weak.personal, headline: '' } }).score).toBeLessThan(base);
  });
});

describe('resumeKeywordGap', () => {
  it('finds required skills anywhere in the résumé with word boundaries and special characters', () => {
    const doc: ResumeDoc = { ...GOOD, skills: [{ group: 'x', items: ['C++', 'Node.js'] }], projects: [], experience: [{ role: 'dev', company: '', location: '', start: '', end: '', bullets: ['Wrote C# services and used Java 17'] }], summary: '' };
    const g = resumeKeywordGap(doc, ['C++', 'C#', 'Node.js', 'Java', 'JavaScript', 'Go', 'c++']);
    expect(g.present).toEqual(['C++', 'C#', 'Node.js', 'Java']);
    expect(g.missing).toEqual(['JavaScript', 'Go']);
  });
  it('"Java" does not match inside "JavaScript"; empty requirements → nothing', () => {
    const doc: ResumeDoc = { ...GOOD, skills: [{ group: '', items: ['JavaScript'] }], experience: [], projects: [], summary: '', personal: { ...GOOD.personal, headline: '' } };
    expect(resumeKeywordGap(doc, ['Java'])).toEqual({ present: [], missing: ['Java'] });
    expect(resumeKeywordGap(doc, [])).toEqual({ present: [], missing: [] });
  });
});
