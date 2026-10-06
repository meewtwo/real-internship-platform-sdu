import { Hono } from 'hono';
import {
  MAX_RESUME_DOCS, MAX_RESUME_VERSIONS, emptyResumeDoc, resumeKeywordGap, reviewResume, validateResumeDoc, validateResumeMeta,
  type ResumeDoc, type ResumeLang,
} from '@sdu/shared';
import { buildDocx } from '../lib/docx';
import { iso, uniqueStamp } from '../lib/sql';
import { randomToken } from '../lib/crypto';
import { requireAuth } from '../lib/guard';
import { apiError, readJson, UUID_RE, type AppEnv, type Ctx } from '../lib/http';
import { fence, redactPii, SYSTEM_RULES, cleanText, type Lang } from '../services/ai';
import { langOf, needConsent, publishedVacancy, tryAi, vacancyFacts } from './ai';

export const resumeDocs = new Hono<AppEnv>();
resumeDocs.use('*', requireAuth('student'));

interface Row { id: string; title: string; template: string; language: ResumeLang; data: ResumeDoc; version: number; public_slug: string | null; public_contact: boolean; created_at: string; updated_at: string }
const full = (r: Row) => ({ id: r.id, title: r.title, template: r.template, language: r.language, version: r.version, data: r.data, publicSlug: r.public_slug, publicContact: r.public_contact, createdAt: r.created_at, updatedAt: r.updated_at });
const item = (r: Row) => ({ id: r.id, title: r.title, template: r.template, language: r.language, version: r.version, shared: r.public_slug !== null, updatedAt: r.updated_at });
const COLS = 'id, title, template, language, data, version, public_slug, public_contact, created_at, updated_at';

async function owned(c: Ctx, id: string): Promise<Row | null> {
  if (!UUID_RE.test(id)) return null;
  return (await c.var.db.query<Row>(`SELECT ${COLS} FROM resume_docs WHERE id = $1 AND user_id = $2`, [id, c.var.auth!.user.id])).rows[0] ?? null;
}
const bodyObj = async (c: Ctx, allowed: string[]) => {
  const b = await readJson(c);
  if (!b.ok) return { res: b.res } as const;
  if (typeof b.body !== 'object' || b.body === null || Array.isArray(b.body)) return { res: apiError(c, 400, 'VALIDATION_FAILED') } as const;
  if (Object.keys(b.body).some((k) => !allowed.includes(k))) return { res: apiError(c, 400, 'UNKNOWN_FIELDS') } as const;
  return { body: b.body as Record<string, unknown> } as const;
};

// ───────────────────────── seeding a new document ─────────────────────────
const humanize = (k: string) => k.replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase());
async function seed(c: Ctx, from: 'blank' | 'profile' | 'cv' | 'portal'): Promise<ResumeDoc> {
  const uid = c.var.auth!.user.id;
  const p = (await c.var.db.query<{ name: string; surname: string; email: string; phone: string | null; city_key: string; city_other: string | null; major_key: string; gpa: string; graduation: string }>(
    `SELECT sp.name, sp.surname, u.email, u.phone, sp.city_key, sp.city_other, sp.major_key, sp.gpa AS gpa, substr(sp.graduation_date, 1, 7) AS graduation
     FROM student_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = $1`, [uid])).rows[0];
  const doc = emptyResumeDoc();
  doc.personal = { fullName: `${p.name} ${p.surname}`, headline: '', email: p.email, phone: p.phone ?? '', city: p.city_key === 'other' ? (p.city_other ?? '') : humanize(p.city_key), links: [] };
  const skills = (await c.var.db.query<{ name: string }>('SELECT s.name FROM student_skills ss JOIN skills s ON s.id = ss.skill_id WHERE ss.user_id = $1 ORDER BY s.name', [uid])).rows.map((r) => r.name);
  if (from !== 'blank') {
    doc.education = [{ institution: 'SDU University', degree: humanize(p.major_key), start: '', end: p.graduation, details: `GPA ${p.gpa}` }];
    if (skills.length) doc.skills = [{ group: '', items: skills.slice(0, 20) }];
  }
  if (from === 'cv') {
    const cv = (await c.var.db.query<{ extracted_skills: string[]; experience_items: { line: string }[] }>('SELECT extracted_skills, experience_items FROM cvs WHERE user_id = $1', [uid])).rows[0];
    if (cv) {
      const merged = [...new Set([...skills, ...cv.extracted_skills])].slice(0, 20);
      if (merged.length) doc.skills = [{ group: '', items: merged }];
      doc.experience = (cv.experience_items ?? []).slice(0, 5).map((e) => ({ role: String(e.line).slice(0, 100), company: '', location: '', start: '', end: '', bullets: [] }));
    }
  }
  if (from === 'portal') {
    const r = (await c.var.db.query<{ about: string; inferred_skills: string[] }>('SELECT about, inferred_skills FROM resumes WHERE user_id = $1', [uid])).rows[0];
    if (r) {
      doc.summary = r.about.slice(0, 600);
      const merged = [...new Set([...skills, ...r.inferred_skills])].slice(0, 20);
      if (merged.length) doc.skills = [{ group: '', items: merged }];
    }
  }
  const v = validateResumeDoc(doc);
  if (v.ok) return v.data;
  // a seed value that fails validation (e.g. an unusual stored phone) is dropped, never blocks creating a document
  const safe = emptyResumeDoc();
  safe.personal.fullName = doc.personal.fullName.slice(0, 80);
  return safe;
}

// ───────────────────────── CRUD ─────────────────────────
resumeDocs.get('/', async (c) => {
  const { rows } = await c.var.db.query<Row>(`SELECT ${COLS} FROM resume_docs WHERE user_id = $1 ORDER BY updated_at DESC, id`, [c.var.auth!.user.id]);
  return c.json({ docs: rows.map(item), max: MAX_RESUME_DOCS });
});

resumeDocs.post('/', async (c) => {
  const b = await bodyObj(c, ['title', 'template', 'language', 'from']);
  if ('res' in b) return b.res;
  const meta = validateResumeMeta(b.body);
  const from = b.body.from === undefined ? 'profile' : b.body.from;
  const fields = !meta.ok ? { ...meta.fields } : {};
  if (!['blank', 'profile', 'cv', 'portal'].includes(from as string)) (fields as Record<string, string>).from = 'RESUME_FIELD_INVALID';
  if (Object.keys(fields).length) return apiError(c, 400, 'VALIDATION_FAILED', { fields: fields as never });
  const m = (meta as { ok: true; data: { title?: string; template?: string; language?: string } }).data;
  const uid = c.var.auth!.user.id;
  const data = await seed(c, from as 'blank');
  // the 5-document limit is checked INSIDE the INSERT (atomic), and the first version snapshot rides in the same batch
  const id = crypto.randomUUID();
  const dataJson = JSON.stringify(data);
  const [ins] = await c.var.db.batch([
    { sql: `INSERT INTO resume_docs (id, user_id, title, template, language, data) SELECT $1, $2, $3, $4, $5, $6 WHERE (SELECT count(*) FROM resume_docs WHERE user_id = $2) < $7 RETURNING ${COLS}`,
      params: [id, uid, m.title, m.template ?? 'classic', m.language ?? c.var.auth!.user.preferredLanguage, dataJson, MAX_RESUME_DOCS] },
    { sql: 'INSERT INTO resume_versions (doc_id, version, template, data) SELECT id, 1, template, data FROM resume_docs WHERE id = $1', params: [id] },
  ]);
  const row = ins.rows[0] as unknown as Row | undefined;
  return row ? c.json({ doc: full(row) }, 201) : apiError(c, 409, 'RESUME_DOC_LIMIT');
});

resumeDocs.get('/:id', async (c) => {
  const r = await owned(c, c.req.param('id'));
  return r ? c.json({ doc: full(r) }) : apiError(c, 404, 'RESUME_DOC_NOT_FOUND');
});

/** Writes a new version of a document (optimistic concurrency on `version`). Returns null when the version is stale. */
async function writeVersion(c: Ctx, id: string, baseVersion: number, patch: { title?: string; template?: string; language?: string; data?: ResumeDoc }) {
  // optimistic concurrency in ONE statement (WHERE version = base); the stamp in updated_at proves to the snapshot statements that this batch won
  const stamp = uniqueStamp();
  const [upd] = await c.var.db.batch([
    { sql: `UPDATE resume_docs SET title = COALESCE($3, title), template = COALESCE($4, template), language = COALESCE($5, language), data = COALESCE($6, data), version = version + 1, updated_at = $8
            WHERE id = $1 AND user_id = $2 AND version = $7 RETURNING ${COLS}`,
      params: [id, c.var.auth!.user.id, patch.title ?? null, patch.template ?? null, patch.language ?? null, patch.data ? JSON.stringify(patch.data) : null, baseVersion, stamp] },
    { sql: 'INSERT INTO resume_versions (doc_id, version, template, data) SELECT id, version, template, data FROM resume_docs WHERE id = $1 AND updated_at = $2', params: [id, stamp] },
    { sql: `DELETE FROM resume_versions WHERE doc_id = $1 AND version <= (SELECT version FROM resume_docs WHERE id = $1 AND updated_at = $2) - $3`, params: [id, stamp, MAX_RESUME_VERSIONS] },
  ]);
  return (upd.rows[0] as unknown as Row | undefined) ?? null;
}

resumeDocs.put('/:id', async (c) => {
  const id = c.req.param('id');
  const b = await bodyObj(c, ['baseVersion', 'title', 'template', 'language', 'data']);
  if ('res' in b) return b.res;
  const bv = b.body.baseVersion;
  if (typeof bv !== 'number' || !Number.isInteger(bv) || bv < 1 || bv > 1_000_000) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { baseVersion: 'REQUIRED' } });
  const meta = validateResumeMeta(b.body, true);
  if (!meta.ok) return apiError(c, 400, 'VALIDATION_FAILED', { fields: meta.fields });
  let data: ResumeDoc | undefined;
  if (b.body.data !== undefined) {
    const v = validateResumeDoc(b.body.data);
    if (!v.ok) return apiError(c, 400, v.formError ?? 'VALIDATION_FAILED', { fields: v.fields });
    data = v.data;
  }
  if (!UUID_RE.test(id)) return apiError(c, 404, 'RESUME_DOC_NOT_FOUND');
  const r = await writeVersion(c, id, bv, { ...meta.data, data });
  if (r) return c.json({ doc: full(r) });
  return (await owned(c, id)) ? apiError(c, 409, 'RESUME_CONFLICT') : apiError(c, 404, 'RESUME_DOC_NOT_FOUND');
});

resumeDocs.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return apiError(c, 404, 'RESUME_DOC_NOT_FOUND');
  const r = await c.var.db.query('DELETE FROM resume_docs WHERE id = $1 AND user_id = $2', [id, c.var.auth!.user.id]);
  return r.rowCount ? c.json({ ok: true }) : apiError(c, 404, 'RESUME_DOC_NOT_FOUND');
});

// ───────────────────────── versions ─────────────────────────
resumeDocs.get('/:id/versions', async (c) => {
  const r = await owned(c, c.req.param('id'));
  if (!r) return apiError(c, 404, 'RESUME_DOC_NOT_FOUND');
  const { rows } = await c.var.db.query<{ version: number; created_at: string; template: string }>('SELECT version, created_at, template FROM resume_versions WHERE doc_id = $1 ORDER BY version DESC', [r.id]);
  return c.json({ versions: rows.map((v) => ({ version: v.version, createdAt: v.created_at, template: v.template })), current: r.version });
});

resumeDocs.post('/:id/restore', async (c) => {
  const id = c.req.param('id');
  const b = await bodyObj(c, ['version', 'baseVersion']);
  if ('res' in b) return b.res;
  const { version, baseVersion } = b.body;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 1) return apiError(c, 400, 'VALIDATION_FAILED', { fields: { version: 'REQUIRED' } });
  const cur = await owned(c, id);
  if (!cur) return apiError(c, 404, 'RESUME_DOC_NOT_FOUND');
  const snap = (await c.var.db.query<{ data: ResumeDoc; template: string }>('SELECT data, template FROM resume_versions WHERE doc_id = $1 AND version = $2', [cur.id, version])).rows[0];
  if (!snap) return apiError(c, 404, 'RESUME_DOC_NOT_FOUND');
  const r = await writeVersion(c, cur.id, baseVersion, { data: snap.data, template: snap.template });
  return r ? c.json({ doc: full(r) }) : apiError(c, 409, 'RESUME_CONFLICT');
});

// ───────────────────────── sharing ─────────────────────────
resumeDocs.post('/:id/share', async (c) => {
  const id = c.req.param('id');
  const b = await bodyObj(c, ['enabled', 'showContact', 'rotate']);
  if ('res' in b) return b.res;
  const { enabled, showContact, rotate } = b.body;
  if (typeof enabled !== 'boolean' || (showContact !== undefined && typeof showContact !== 'boolean') || (rotate !== undefined && typeof rotate !== 'boolean')) return apiError(c, 400, 'VALIDATION_FAILED');
  const cur = await owned(c, id);
  if (!cur) return apiError(c, 404, 'RESUME_DOC_NOT_FOUND');
  const slug = !enabled ? null : cur.public_slug && !rotate ? cur.public_slug : randomToken(16);
  const r = (await c.var.db.query<Row>(
    `UPDATE resume_docs SET public_slug = $2, public_contact = $3 WHERE id = $1 RETURNING ${COLS}`, [cur.id, slug, enabled ? (showContact ?? cur.public_contact) : false])).rows[0];
  return c.json({ doc: full(r) });
});

// ───────────────────────── export ─────────────────────────
resumeDocs.get('/:id/export.docx', async (c) => {
  const r = await owned(c, c.req.param('id'));
  if (!r) return apiError(c, 404, 'RESUME_DOC_NOT_FOUND');
  const bytes = buildDocx(r.data, r.language);
  const ascii = r.title.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'resume';
  return new Response(bytes as BodyInit, { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-length': String(bytes.length),
    'content-disposition': `attachment; filename="${ascii}.docx"; filename*=UTF-8''${encodeURIComponent(r.title)}.docx`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store',
  } });
});

// ───────────────────────── review + tailoring ─────────────────────────
resumeDocs.get('/:id/review', async (c) => {
  const r = await owned(c, c.req.param('id'));
  return r ? c.json(reviewResume(r.data)) : apiError(c, 404, 'RESUME_DOC_NOT_FOUND');
});

const numbersOf = (s: string) => new Set(s.match(/\d+(?:[.,]\d+)?/g) ?? []);
/** Model rewrites may reshape wording but must not invent figures: every number in the output has to appear in the input. */
function noNewNumbers(input: string, output: string) { const have = numbersOf(input); for (const n of numbersOf(output)) if (!have.has(n)) return false; return true; }

resumeDocs.use('/:id/ai/*', (c, next) => needConsent(c, next));

const MODES = ['stronger', 'shorter', 'quantify'] as const;
const MODE_HELP: Record<(typeof MODES)[number], string> = {
  stronger: 'Rewrite it to start with a strong action verb and be specific, keeping every fact.',
  shorter: 'Make it shorter and tighter without losing any fact.',
  quantify: 'Keep every fact and show where a metric belongs by inserting a bracketed placeholder like [N] or [%] — never invent a number.',
};
resumeDocs.post('/:id/ai/rewrite', async (c) => {
  const cur = await owned(c, c.req.param('id'));
  if (!cur) return apiError(c, 404, 'RESUME_DOC_NOT_FOUND');
  const b = await bodyObj(c, ['text', 'mode', 'context', 'language']);
  if ('res' in b) return b.res;
  const text = typeof b.body.text === 'string' ? b.body.text.replace(/\s+/g, ' ').trim() : '';
  const context = typeof b.body.context === 'string' ? b.body.context.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
  const mode = (MODES as readonly unknown[]).includes(b.body.mode) ? (b.body.mode as (typeof MODES)[number]) : null;
  if (!mode || Array.from(text).length < 5 || Array.from(text).length > 240) return apiError(c, 400, 'AI_INPUT_INVALID');
  const lang = langOf(c, b.body.language ?? cur.language);
  const r = await tryAi<{ text: string }>(c, {
    feature: 'resume.rewrite', userId: c.var.auth!.user.id, maxTokens: 300, system: SYSTEM_RULES(lang),
    user: `Improve this résumé bullet. ${MODE_HELP[mode]} Stay under 220 characters, one line, no links. Reply as JSON: {"text": string}.\n${fence('ROLE', redactPii(context))}\n${fence('BULLET', redactPii(text))}`,
    validate: (raw) => {
      const t = typeof raw === 'object' && raw !== null ? cleanText((raw as { text?: unknown }).text, 240) : null;
      return t && t.length >= 5 && !/https?:\/\/|www\./i.test(t) && noNewNumbers(text, t) ? { text: t } : null;
    },
  });
  if (!r.data) return r.notice === 'AI_LIMIT' ? apiError(c, 429, 'AI_LIMIT') : apiError(c, 503, 'AI_UNAVAILABLE');
  return c.json({ text: r.data.text, cached: r.cached });
});

resumeDocs.post('/:id/ai/tailor', async (c) => {
  const cur = await owned(c, c.req.param('id'));
  if (!cur) return apiError(c, 404, 'RESUME_DOC_NOT_FOUND');
  const b = await bodyObj(c, ['vacancyId', 'language']);
  if ('res' in b) return b.res;
  if (typeof b.body.vacancyId !== 'string') return apiError(c, 400, 'VALIDATION_FAILED');
  const v = await publishedVacancy(c, b.body.vacancyId);
  if (!v) return apiError(c, 404, 'NOT_FOUND');
  const gap = resumeKeywordGap(cur.data, v.skills);
  const lang: Lang = langOf(c, b.body.language ?? cur.language);
  const d = cur.data;
  const r = await tryAi<{ summary: string; tips: string[] }>(c, {
    feature: 'resume.tailor', userId: c.var.auth!.user.id, maxTokens: 700, system: SYSTEM_RULES(lang),
    user: `Tailor this student's résumé to the vacancy. Reply as JSON: {"summary": string(<=500 chars, a rewritten professional summary), "tips": string[](<=5 concrete edits to the résumé for this vacancy)}. ` +
      `The summary may only claim skills and experience present in RESUME; never claim any of these missing skills: ${JSON.stringify(gap.missing)}.\n${fence('VACANCY', JSON.stringify(vacancyFacts(v)))}\n` +
      fence('RESUME', redactPii(JSON.stringify({ headline: d.personal.headline, summary: d.summary, skills: d.skills, experience: d.experience.map((e) => ({ role: e.role, bullets: e.bullets })), projects: d.projects.map((p) => ({ name: p.name, tech: p.tech })) }), [d.personal.fullName, ...d.personal.fullName.split(' ')])),
    validate: (raw) => {
      if (typeof raw !== 'object' || raw === null) return null;
      const o = raw as { summary?: unknown; tips?: unknown };
      const summary = cleanText(o.summary, 500) ?? '';
      const tips = (Array.isArray(o.tips) ? o.tips : []).map((x) => cleanText(x, 220)).filter((x): x is string => !!x).slice(0, 5);
      if (!summary && !tips.length) return null;
      // never let the model put a skill the résumé does not show into the summary
      if (summary && resumeKeywordGap({ ...emptyResumeDoc(), summary }, gap.missing).present.length) return null;
      return { summary, tips };
    },
  });
  return c.json({ gap, suggestion: r.data, source: r.data ? 'ai' : 'rules', cached: r.cached, notice: r.notice });
});
