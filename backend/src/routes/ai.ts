import { Hono } from 'hono';
import { matchScore, skillKey, validateTags } from '@sdu/shared';
import { requireAuth } from '../lib/guard';
import { apiError, readJson, UUID_RE, type AppEnv, type Ctx } from '../lib/http';
import { aiAvailable, aiJson, AiError, fence, redactPii, SYSTEM_RULES, type Lang } from '../services/ai';
import {
  heuristicCvAnalysis, heuristicVacancy, matchFacts, missingDraftFields, NAME_TOKEN, sanitizeVacancyDraft, templateExplanation, templateLetter, templateQuestions,
  validateCvAnalysis, validateExplanation, validateFeedback, validateLetter, validateQuestions, withName, type VacancyDraft,
} from '../services/aiLogic';
import { audit, auditStmt } from '../services/audit';
import { afterResponse, embedStudent } from '../services/embeddings';
import { loadStudentSignal, SQL_TODAY, VACANCY_SELECT, vacancySignal, type VacancyRow } from '../services/matching';
import { addStudentSkills } from '../services/skills';
import { iso } from '../lib/sql';

export const ai = new Hono<AppEnv>();
ai.use('*', requireAuth('student', 'employer'));

export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ru' || v === 'kk';
export const langOf = (c: Ctx, requested?: unknown): Lang => (isLang(requested) ? requested : c.var.auth!.user.preferredLanguage);

async function hasConsent(c: Ctx) {
  const r = await c.var.db.query<{ ai_consent_at: string | null }>('SELECT ai_consent_at FROM users WHERE id = $1', [c.var.auth!.user.id]);
  return r.rows[0]?.ai_consent_at ?? null;
}
/** Nothing is sent to an AI provider (nor even prepared for it) before the user has explicitly opted in. */
export const needConsent = async (c: Ctx, next: () => Promise<void>) => ((await hasConsent(c)) ? next() : apiError(c, 403, 'AI_CONSENT_REQUIRED'));

ai.get('/consent', async (c) => {
  const at = await hasConsent(c);
  return c.json({ consent: at !== null, at, available: aiAvailable(c.env) });
});

ai.put('/consent', async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const o = body.body;
  if (typeof o !== 'object' || o === null || Array.isArray(o) || Object.keys(o).some((k) => k !== 'accept') || typeof (o as { accept?: unknown }).accept !== 'boolean') return apiError(c, 400, 'VALIDATION_FAILED');
  const accept = (o as { accept: boolean }).accept;
  const u = c.var.auth!.user;
  await c.var.db.batch([
    { sql: 'UPDATE users SET ai_consent_at = $2 WHERE id = $1', params: [u.id, accept ? iso() : null] },
    auditStmt({ id: u.id, role: u.role }, 'ai.consent', { type: 'user', id: u.id }, { accepted: accept }),
  ]);
  return c.json({ consent: accept, at: accept ? (await hasConsent(c)) : null, available: aiAvailable(c.env) });
});

ai.use('*', async (c, next) => (c.req.path.endsWith('/consent') ? next() : needConsent(c, next)));

type Source = 'ai' | 'rules';
/** Runs a model call; any AI failure becomes `null` (→ caller uses its rule-based fallback) plus a machine-readable notice. */
export async function tryAi<T>(c: Ctx, o: Parameters<typeof aiJson<T>>[2]): Promise<{ data: T; cached: boolean; notice: null } | { data: null; cached: false; notice: 'AI_LIMIT' | 'AI_UNAVAILABLE' }> {
  try { return { ...(await aiJson<T>(c.var.db, c.env, o)), notice: null }; }
  catch (e) {
    if (!(e instanceof AiError)) throw e;
    if (e.kind === 'disabled') return { data: null, cached: false, notice: 'AI_UNAVAILABLE' };
    console.error(JSON.stringify({ level: 'warn', msg: 'ai fallback', feature: o.feature, kind: e.kind, requestId: c.get('requestId') ?? null }));
    return { data: null, cached: false, notice: e.kind === 'budget' || e.kind === 'user_limit' ? 'AI_LIMIT' : 'AI_UNAVAILABLE' };
  }
}
const vocab = async (c: Ctx) => (await c.var.db.query<{ name: string }>('SELECT name FROM skills')).rows.map((r) => r.name);

// ───────────────────────── student: CV analysis ─────────────────────────
ai.post('/cv/analyze', requireAuth('student'), async (c) => {
  const u = c.var.auth!.user;
  const row = (await c.var.db.query<{ text_content: string; name: string; surname: string }>(
    'SELECT cv.text_content, sp.name, sp.surname FROM cvs cv JOIN student_profiles sp ON sp.user_id = cv.user_id WHERE cv.user_id = $1', [u.id])).rows[0];
  if (!row) return apiError(c, 404, 'CV_NOT_FOUND');
  const v = await vocab(c);
  const lang = langOf(c);
  const text = redactPii(row.text_content.slice(0, 12_000), [row.name, row.surname]);
  const r = await tryAi(c, {
    feature: 'cv.analyze', userId: u.id, maxTokens: 1400,
    system: SYSTEM_RULES(lang),
    user: `Analyse the CV below for a student looking for an internship or first job. Reply as JSON: {"headline": string(<=100), "summary": string(<=500, 2-3 sentences), "skills": string[](technical and soft skills explicitly present, <=40), ` +
      `"experience": [{"role","company","period","highlights": string[]}], "education": [{"institution","degree","period"}], "languages": string[], "strengths": string[](<=5), "improvements": string[](<=6, concrete advice to improve this CV)}.\n${fence('CV', text)}`,
    validate: (raw) => validateCvAnalysis(raw, v),
  });
  const source: Source = r.data ? 'ai' : 'rules';
  return c.json({ analysis: r.data ?? heuristicCvAnalysis(row.text_content, v), source, cached: r.cached, notice: r.notice });
});

/** Adds the chosen (AI-found) skills to the profile; same caps and validation as editing the profile by hand. */
ai.post('/cv/apply-skills', requireAuth('student'), async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const o = body.body;
  if (typeof o !== 'object' || o === null || Array.isArray(o) || Object.keys(o).some((k) => k !== 'skills')) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { skills: 'TAG_INVALID' } });
  if (!Array.isArray((o as { skills?: unknown }).skills)) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { skills: 'TAG_INVALID' } });
  const t = validateTags((o as { skills?: unknown }).skills, 30, 'TAGS_TOO_MANY');
  if (!t.ok) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { skills: t.code } });
  const id = c.var.auth!.user.id;
  const cur = (await c.var.db.query<{ name: string }>('SELECT s.name FROM student_skills ss JOIN skills s ON s.id = ss.skill_id WHERE ss.user_id = $1 ORDER BY s.name', [id])).rows.map((r) => r.name);
  const have = new Set(cur.map(skillKey));
  const added = t.value.filter((s) => !have.has(skillKey(s))).slice(0, Math.max(0, 30 - cur.length));
  await addStudentSkills(c.var.db, id, added);
  await afterResponse(c, async (db) => { await embedStudent(db, c.env, id); });
  return c.json({ ok: true, added });
});

// ───────────────────────── employer: vacancy text → draft ─────────────────────────
ai.post('/vacancy/parse', requireAuth('employer'), async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const o = body.body;
  if (typeof o !== 'object' || o === null || Array.isArray(o) || Object.keys(o).some((k) => k !== 'text' && k !== 'language')) return apiError(c, 400, 'UNKNOWN_FIELDS');
  const text = (o as { text?: unknown }).text;
  const t = typeof text === 'string' ? text.normalize('NFC').replace(/\r\n?/g, '\n').trim() : '';
  if (Array.from(t).length < 40 || Array.from(t).length > 8000) return apiError(c, 400, 'AI_INPUT_INVALID');
  const lang = langOf(c, (o as { language?: unknown }).language);
  const v = await vocab(c);
  const rules = heuristicVacancy(t, v);
  const r = await tryAi<VacancyDraft>(c, {
    feature: 'vacancy.parse', userId: c.var.auth!.user.id, maxTokens: 1500,
    system: SYSTEM_RULES(lang),
    user: `Turn the job posting below into a structured draft. Reply as JSON: {"title": string, "description": string(clean, well-structured, keep all requirements), "kind": "internship"|"full_time"|"part_time", ` +
      `"industry": one of ${JSON.stringify(['it_software', 'finance_banking', 'telecom', 'education', 'healthcare', 'retail', 'manufacturing', 'energy_oil_gas', 'logistics_transport', 'construction', 'media_marketing', 'government', 'consulting', 'tourism_hospitality', 'agriculture', 'other'])}, ` +
      `"city": lowercase latin city key such as "almaty"|"astana"|"shymkent" or null, "workFormat": "onsite"|"hybrid"|"remote", "requiredSkills": string[](<=15, short canonical names like "Python"), "salaryMin": integer KZT per month or null, "salaryMax": integer or null, "minGpa": number or null}. Use null when the posting does not say.\n${fence('POSTING', redactPii(t))}`,
    validate: sanitizeVacancyDraft,
  });
  const draft: VacancyDraft = { ...rules, ...(r.data ?? {}) };
  return c.json({ draft, missing: missingDraftFields(draft), source: (r.data ? 'ai' : 'rules') as Source, cached: r.cached, notice: r.notice });
});

// ───────────────────────── explanations ─────────────────────────
export async function publishedVacancy(c: Ctx, id: string): Promise<VacancyRow | null> {
  if (!UUID_RE.test(id)) return null;
  return (await c.var.db.query<VacancyRow>(`${VACANCY_SELECT} WHERE v.id = $1 AND v.status = 'published' AND (v.deadline IS NULL OR v.deadline >= ${SQL_TODAY})`, [id])).rows[0] ?? null;
}
export const vacancyFacts = (v: VacancyRow) => ({ title: v.title, company: v.company_name, kind: v.kind, industry: v.industry_key, workFormat: v.work_format, city: v.city_key, requiredSkills: v.skills, minGpa: v.min_gpa });

ai.get('/match-explain/:vacancyId', requireAuth('student'), async (c) => {
  const v = await publishedVacancy(c, c.req.param('vacancyId'));
  const s = await loadStudentSignal(c.var.db, c.var.auth!.user.id);
  if (!v || !s) return apiError(c, 404, 'NOT_FOUND');
  const m = matchScore(s, vacancySignal(v));
  const lang = langOf(c, c.req.query('language'));
  const r = await tryAi(c, {
    feature: 'match.explain.student', userId: c.var.auth!.user.id, maxTokens: 700, system: SYSTEM_RULES(lang),
    user: `Explain to a student, in plain encouraging language, why this vacancy matches them the way it does and what to do next. Reply as JSON: {"summary": string(<=400, 2 sentences), "strengths": string[](<=4), "gaps": string[](<=4), "nextSteps": string[](<=4 concrete actions)}. ` +
      `Use ONLY these facts.\n${fence('FACTS', JSON.stringify({ vacancy: vacancyFacts(v), match: matchFacts(m), student: { major: s.majorKey, gpa: s.gpa, experienceYears: s.experienceYears, skills: [...s.skills, ...s.cvSkills] } }))}`,
    validate: validateExplanation,
  });
  return c.json({ match: m, explanation: r.data ?? templateExplanation(lang, m), source: (r.data ? 'ai' : 'rules') as Source, cached: r.cached, notice: r.notice });
});

ai.get('/candidate-explain/:applicationId', requireAuth('employer'), async (c) => {
  const id = c.req.param('applicationId');
  if (!UUID_RE.test(id)) return apiError(c, 404, 'NOT_FOUND');
  const a = (await c.var.db.query<{ student_id: string; vacancy_id: string }>(
    `SELECT a.student_id, a.vacancy_id FROM applications a JOIN vacancies v ON v.id = a.vacancy_id WHERE a.id = $1 AND v.employer_id = $2 AND a.status <> 'withdrawn'`, [id, c.var.auth!.user.id])).rows[0];
  if (!a) return apiError(c, 404, 'NOT_FOUND');
  const v = (await c.var.db.query<VacancyRow>(`${VACANCY_SELECT} WHERE v.id = $1`, [a.vacancy_id])).rows[0];
  const s = await loadStudentSignal(c.var.db, a.student_id);
  if (!v || !s) return apiError(c, 404, 'NOT_FOUND');
  const m = matchScore(s, vacancySignal(v));
  const lang = langOf(c, c.req.query('language'));
  const r = await tryAi(c, {
    feature: 'match.explain.employer', userId: c.var.auth!.user.id, maxTokens: 700, system: SYSTEM_RULES(lang),
    user: `Explain to a recruiter, neutrally and without guessing, how well this anonymous candidate fits the vacancy. Reply as JSON: {"summary": string(<=400), "strengths": string[](<=4), "gaps": string[](<=4), "nextSteps": string[](<=4, e.g. interview questions to probe the gaps)}. ` +
      `Use ONLY these facts; do not infer age, gender, ethnicity or nationality.\n${fence('FACTS', JSON.stringify({ vacancy: vacancyFacts(v), match: matchFacts(m), candidate: { major: s.majorKey, gpa: s.gpa, experienceYears: s.experienceYears, skills: [...s.skills, ...s.cvSkills] } }))}`,
    validate: validateExplanation,
  });
  return c.json({ match: m, explanation: r.data ?? templateExplanation(lang, m), source: (r.data ? 'ai' : 'rules') as Source, cached: r.cached, notice: r.notice });
});

// ───────────────────────── student: cover letter ─────────────────────────
const TONES = ['formal', 'friendly', 'concise'] as const;
ai.post('/cover-letter', requireAuth('student'), async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const o = body.body;
  if (typeof o !== 'object' || o === null || Array.isArray(o) || Object.keys(o).some((k) => !['vacancyId', 'tone', 'language'].includes(k))) return apiError(c, 400, 'UNKNOWN_FIELDS');
  const b = o as { vacancyId?: unknown; tone?: unknown; language?: unknown };
  const tone = b.tone === undefined ? 'formal' : (TONES as readonly unknown[]).includes(b.tone) ? (b.tone as (typeof TONES)[number]) : null;
  if (typeof b.vacancyId !== 'string' || !tone) return apiError(c, 400, 'VALIDATION_FAILED');
  const v = await publishedVacancy(c, b.vacancyId);
  const u = c.var.auth!.user;
  const s = await loadStudentSignal(c.var.db, u.id);
  const nm = (await c.var.db.query<{ name: string; surname: string }>('SELECT name, surname FROM student_profiles WHERE user_id = $1', [u.id])).rows[0];
  if (!v || !s || !nm) return apiError(c, 404, 'NOT_FOUND');
  const lang = langOf(c, b.language);
  const have = new Set([...s.skills, ...s.cvSkills].map(skillKey));
  const relevant = v.skills.filter((x) => have.has(skillKey(x)));
  const full = `${nm.name} ${nm.surname}`;
  const r = await tryAi(c, {
    feature: 'cover.letter', userId: u.id, maxTokens: 700, system: SYSTEM_RULES(lang),
    user: `Write a ${tone} cover letter (120-220 words, no placeholders other than ${NAME_TOKEN} for the signature, no links, no invented achievements) from a university student to the employer. ` +
      `Mention only skills from "studentSkillsRelevant" or "studentSkills". Reply as JSON: {"text": string}.\n${fence('FACTS', JSON.stringify({ vacancy: { ...vacancyFacts(v), description: redactPii(v.description.slice(0, 1500)) }, studentSkillsRelevant: relevant, studentSkills: [...s.skills, ...s.cvSkills].slice(0, 20), experienceYears: s.experienceYears, major: s.majorKey }))}`,
    validate: (raw) => { const t = validateLetter(raw); return t === null ? null : { text: t }; },
  });
  const text = r.data ? withName(r.data.text, full) : withName(templateLetter(lang, { title: v.title, company: v.company_name, skills: relevant }), full);
  return c.json({ letter: text, source: (r.data ? 'ai' : 'rules') as Source, cached: r.cached, notice: r.notice });
});

// ───────────────────────── student: interview practice ─────────────────────────
ai.post('/interview/questions', requireAuth('student'), async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const o = body.body;
  if (typeof o !== 'object' || o === null || Array.isArray(o) || Object.keys(o).some((k) => k !== 'vacancyId' && k !== 'language') || typeof (o as { vacancyId?: unknown }).vacancyId !== 'string') return apiError(c, 400, 'VALIDATION_FAILED');
  const v = await publishedVacancy(c, (o as { vacancyId: string }).vacancyId);
  if (!v) return apiError(c, 404, 'NOT_FOUND');
  const lang = langOf(c, (o as { language?: unknown }).language);
  const r = await tryAi(c, {
    feature: 'interview.questions', userId: c.var.auth!.user.id, maxTokens: 700, system: SYSTEM_RULES(lang),
    user: `Prepare 6 realistic interview questions (mix of technical and behavioural, ordered easy to hard) for this vacancy. Reply as JSON: {"questions": [{"question": string, "focus": string(skill or topic)}]}.\n${fence('FACTS', JSON.stringify(vacancyFacts(v)))}`,
    validate: validateQuestions,
  });
  return c.json({ questions: r.data ?? templateQuestions(lang, v.skills), source: (r.data ? 'ai' : 'rules') as Source, cached: r.cached, notice: r.notice });
});

ai.post('/interview/feedback', requireAuth('student'), async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.res;
  const o = body.body;
  if (typeof o !== 'object' || o === null || Array.isArray(o) || Object.keys(o).some((k) => !['vacancyId', 'question', 'answer', 'language'].includes(k))) return apiError(c, 400, 'UNKNOWN_FIELDS');
  const b = o as { vacancyId?: unknown; question?: unknown; answer?: unknown; language?: unknown };
  const q = typeof b.question === 'string' ? b.question.trim() : '', a = typeof b.answer === 'string' ? b.answer.trim() : '';
  if (typeof b.vacancyId !== 'string' || Array.from(q).length < 8 || Array.from(q).length > 300 || Array.from(a).length < 20 || Array.from(a).length > 2000) return apiError(c, 400, 'AI_INPUT_INVALID');
  const v = await publishedVacancy(c, b.vacancyId);
  if (!v) return apiError(c, 404, 'NOT_FOUND');
  const lang = langOf(c, b.language);
  const nm = (await c.var.db.query<{ name: string; surname: string }>('SELECT name, surname FROM student_profiles WHERE user_id = $1', [c.var.auth!.user.id])).rows[0];
  const r = await tryAi(c, {
    feature: 'interview.feedback', userId: c.var.auth!.user.id, maxTokens: 800, system: SYSTEM_RULES(lang),
    user: `Evaluate the candidate's answer to the interview question for this vacancy. Be specific and kind. Reply as JSON: {"score": integer 1-5, "strengths": string[](<=4), "improvements": string[](<=4), "sampleAnswer": string(<=700, a stronger version using only what the candidate said)}.\n${fence('VACANCY', JSON.stringify(vacancyFacts(v)))}\n${fence('QUESTION', q)}\n${fence('ANSWER', redactPii(a, nm ? [nm.name, nm.surname] : []))}`,
    validate: validateFeedback,
  });
  if (!r.data) return r.notice === 'AI_LIMIT' ? apiError(c, 429, 'AI_LIMIT') : apiError(c, 503, 'AI_UNAVAILABLE');
  return c.json({ feedback: r.data, cached: r.cached });
});

