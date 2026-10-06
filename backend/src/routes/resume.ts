import { Hono } from 'hono';
import { DEMO_TRANSCRIPTS, demoTranscriptFor, draftResume, inferSkills, parseTranscript, skillKey, weightedGpa, type Course } from '@sdu/shared';
import { MAX_CV_BYTES } from '../lib/cvParse';
import { requireAuth } from '../lib/guard';
import { apiError, clientIp, readJson, type AppEnv, type Ctx } from '../lib/http';
import { rateLimit } from '../lib/ratelimit';
import { addStudentSkills } from '../services/skills';
import { iso } from '../lib/sql';
import { afterResponse, embedStudent } from '../services/embeddings';

export const resume = new Hono<AppEnv>();
resume.use('*', requireAuth('student'));

const dto = (r: Record<string, any>) => ({ source: r.source, about: r.about, courses: r.courses as Course[], inferredSkills: r.inferred_skills as string[], gpa: weightedGpa(r.courses as Course[]), credits: (r.courses as Course[]).reduce((a, c) => a + c.credits, 0), updatedAt: r.updated_at });

async function load(c: Ctx) {
  const uid = c.var.auth!.user.id;
  const { rows } = await c.var.db.query('SELECT source, about, courses, inferred_skills, updated_at FROM resumes WHERE user_id = $1', [uid]);
  const prof = (await c.var.db.query<Record<string, any>>(`SELECT sp.name, sp.surname, sp.major_key, sp.year_of_study, sp.gpa AS gpa, sp.interest_area, sp.city_key, sp.city_other, u.email, u.phone, u.preferred_language FROM student_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = $1`, [uid])).rows[0];
  const skills = (await c.var.db.query<{ name: string }>('SELECT s.name FROM student_skills ss JOIN skills s ON s.id = ss.skill_id WHERE ss.user_id = $1 ORDER BY s.name', [uid])).rows.map((r) => r.name);
  const cv = (await c.var.db.query<{ experience_years: string; experience_items: unknown }>('SELECT experience_years, experience_items FROM cvs WHERE user_id = $1', [uid])).rows[0];
  return { resume: rows[0] ? dto(rows[0]) : null, profile: { name: prof.name, surname: prof.surname, major: prof.major_key, year: prof.year_of_study, gpa: prof.gpa, interestArea: prof.interest_area, city: prof.city_key, cityOther: prof.city_other, email: prof.email, phone: prof.phone }, skills, experience: cv ? { years: Number(cv.experience_years), items: cv.experience_items } : null };
}

resume.get('/', async (c) => c.json(await load(c)));

async function build(c: Ctx, source: 'portal_demo' | 'portal_transcript', text: string) {
  const courses = parseTranscript(text);
  if (!courses.length) return apiError(c, 400, 'TRANSCRIPT_INVALID');
  const uid = c.var.auth!.user.id;
  const vocab = (await c.var.db.query<{ name: string }>('SELECT name FROM skills')).rows.map((r) => r.name);
  const inferred = inferSkills(courses, vocab);
  const info = await load(c);
  const lang = (await c.var.db.query<{ l: 'en' | 'ru' | 'kk' }>('SELECT preferred_language AS l FROM users WHERE id = $1', [uid])).rows[0].l;
  // The text is language-neutral where it can be; the UI renders labels (major, year…) in the user's language, the stored "about" uses English keys' readable form.
  const label = (k: string) => k.replace(/_/g, ' ');
  const d = draftResume({ name: info.profile.name, major: info.profile.major, year: info.profile.year, gpa: info.profile.gpa, interestArea: info.profile.interestArea }, courses, inferred, lang,
    { major: label(info.profile.major), interest: label(info.profile.interestArea), year: info.profile.year.startsWith('m') ? `master ${info.profile.year.slice(1)}` : `year ${info.profile.year}` });
  await c.var.db.query(
    `INSERT INTO resumes (user_id, source, about, courses, inferred_skills, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET source = $2, about = $3, courses = $4, inferred_skills = $5, updated_at = $6`,
    [uid, source, d.about.slice(0, 1000), JSON.stringify(courses), JSON.stringify(inferred), iso()],
  );
  await afterResponse(c, async (db) => { await embedStudent(db, c.env, uid); });
  return c.json(await load(c), 201);
}

/** Student presses "Import from SDU portal" (demo transcript matching their major). */
resume.post('/demo', async (c) => {
  const major = (await c.var.db.query<{ m: string }>('SELECT major_key AS m FROM student_profiles WHERE user_id = $1', [c.var.auth!.user.id])).rows[0].m;
  return build(c, 'portal_demo', DEMO_TRANSCRIPTS[demoTranscriptFor(major)]);
});

/** Real import: transcript text pasted by the student, or a PDF/TXT exported from the portal. */
resume.post('/import', async (c) => {
  const rl = await rateLimit(c.var.db, c.env, `resume:${c.var.auth!.user.id}:${clientIp(c)}`, 20, 3600);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  const ct = c.req.header('content-type') ?? '';
  let text = '';
  if (/^multipart\/form-data/i.test(ct)) {
    const f = (await c.req.parseBody())['file'];
    if (!(f instanceof File) || f.size === 0) return apiError(c, 400, 'TRANSCRIPT_EMPTY');
    if (f.size > MAX_CV_BYTES) return apiError(c, 413, 'CV_TOO_LARGE');
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') {
      const { parseCv } = await import('../lib/cvParse');
      const r = await parseCv(bytes);
      if (!r.ok) return apiError(c, 400, r.code);
      text = r.text;
    } else if (/\.txt$/i.test(f.name)) text = new TextDecoder().decode(bytes);
    else return apiError(c, 400, 'CV_TYPE_INVALID');
  } else {
    const body = await readJson(c);
    if (!body.ok) return body.res;
    const b = body.body as Record<string, unknown> | null;
    if (!b || typeof b !== 'object' || Object.keys(b).some((k) => k !== 'text')) return apiError(c, 400, 'UNKNOWN_FIELDS');
    if (typeof b.text !== 'string' || b.text.trim() === '') return apiError(c, 400, 'TRANSCRIPT_EMPTY');
    text = b.text.slice(0, 40_000);
  }
  return build(c, 'portal_transcript', text);
});

resume.put('/', async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const b = body.body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || Object.keys(b).some((k) => k !== 'about')) return apiError(c, 400, 'UNKNOWN_FIELDS');
  const about = typeof b.about === 'string' ? b.about.normalize('NFC').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮﻿]/g, '').trim() : '';
  if (!about) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { about: 'REQUIRED' } });
  if (Array.from(about).length > 1000) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { about: 'RESUME_ABOUT_TOO_LONG' } });
  const r = await c.var.db.query('UPDATE resumes SET about = $2 WHERE user_id = $1', [c.var.auth!.user.id, about]);
  if (r.rowCount) await afterResponse(c, async (db) => { await embedStudent(db, c.env, c.var.auth!.user.id); });
  return r.rowCount ? c.json(await load(c)) : apiError(c, 404, 'RESUME_NOT_FOUND');
});

/** Adds the skills inferred from courses to the profile (max 30 in total). */
resume.post('/apply-skills', async (c) => {
  const info = await load(c);
  if (!info.resume) return apiError(c, 404, 'RESUME_NOT_FOUND');
  const have = new Set(info.skills.map(skillKey));
  const added = info.resume.inferredSkills.filter((s) => !have.has(skillKey(s))).slice(0, Math.max(0, 30 - info.skills.length));
  await addStudentSkills(c.var.db, c.var.auth!.user.id, added);
  await afterResponse(c, async (db) => { await embedStudent(db, c.env, c.var.auth!.user.id); });
  return c.json({ ok: true, added });
});

resume.delete('/', async (c) => {
  const r = await c.var.db.query('DELETE FROM resumes WHERE user_id = $1', [c.var.auth!.user.id]);
  if (r.rowCount) await afterResponse(c, async (db) => { await embedStudent(db, c.env, c.var.auth!.user.id); });
  return r.rowCount ? c.json({ ok: true }) : apiError(c, 404, 'RESUME_NOT_FOUND');
});
