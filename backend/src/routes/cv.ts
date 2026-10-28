import { Hono } from 'hono';
import { extractExperience, extractSkills, skillKey } from '@sdu/shared';
import { requireAuth } from '../lib/guard';
import { apiError, clientIp, type AppEnv } from '../lib/http';
import { MAX_CV_BYTES, parseCv, safeFilename } from '../lib/cvParse';
import { rateLimit } from '../lib/ratelimit';
import { addStudentSkills } from '../services/skills';
import { iso } from '../lib/sql';
import { afterResponse, embedStudent } from '../services/embeddings';
import { cvChunkStmts, loadCvBytes, removeCvObjects, storeCvBytes } from '../services/cvStore';

export const cv = new Hono<AppEnv>();
cv.use('*', requireAuth('student'));

const meta = (r: Record<string, unknown>) => ({
  filename: r.filename, size: r.size_bytes, mime: r.mime, uploadedAt: r.uploaded_at, skills: r.extracted_skills,
  experienceYears: Number(r.experience_years), experienceItems: r.experience_items,
});

cv.get('/', async (c) => {
  const { rows } = await c.var.db.query('SELECT filename, size_bytes, mime, uploaded_at, extracted_skills, experience_years, experience_items FROM cvs WHERE user_id = $1', [c.var.auth!.user.id]);
  return c.json({ cv: rows[0] ? meta(rows[0]) : null });
});

cv.post('/', async (c) => {
  const a = c.var.auth!;
  const rl = await rateLimit(c.var.db, c.env, `cv:${a.user.id}:${clientIp(c)}`, 10, 3600);
  if (!rl.allowed) return apiError(c, 429, 'RATE_LIMITED', { retryAfter: rl.retryAfter });
  if (!/^multipart\/form-data/i.test(c.req.header('content-type') ?? '')) return apiError(c, 415, 'UNSUPPORTED_MEDIA_TYPE');
  let file: unknown;
  try { file = (await c.req.parseBody())['file']; } catch { return apiError(c, 400, 'CV_MISSING_FILE'); }
  if (!(file instanceof File) || file.size === 0) return apiError(c, 400, 'CV_MISSING_FILE');
  // the same 2 MB everywhere: without R2, a file too big for one D1 row is stored in parts (cv_chunks)
  if (file.size > MAX_CV_BYTES) return apiError(c, 413, 'CV_TOO_LARGE');
  const filename = safeFilename(file.name);
  if (!filename) return apiError(c, 400, 'CV_TYPE_INVALID');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = await parseCv(bytes);
  if (!parsed.ok) return apiError(c, 400, parsed.code);
  // the extension must agree with the real content
  if ((parsed.mime === 'application/pdf') !== /\.pdf$/i.test(filename)) return apiError(c, 400, 'CV_TYPE_INVALID');
  const vocab = (await c.var.db.query<{ name: string }>('SELECT name FROM skills')).rows.map((r) => r.name);
  const skills = extractSkills(parsed.text, vocab).slice(0, 60);
  const exp = extractExperience(parsed.text);
  const stored = await storeCvBytes(c.env, a.user.id, bytes);
  const old = (await c.var.db.query<{ storage_key: string | null }>('SELECT storage_key FROM cvs WHERE user_id = $1', [a.user.id])).rows[0]?.storage_key;
  try {
    // one batch: the row and its parts (or the removal of an older CV's parts) commit together
    await c.var.db.batch([{
      sql: `INSERT INTO cvs (user_id, filename, mime, size_bytes, content, storage_key, text_content, extracted_skills, experience_years, experience_items, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (user_id) DO UPDATE SET filename = $2, mime = $3, size_bytes = $4, content = $5, storage_key = $6, text_content = $7, extracted_skills = $8,
         experience_years = $9, experience_items = $10, uploaded_at = $11`,
      params: [a.user.id, filename, parsed.mime, bytes.length, stored.content, stored.key, parsed.text, JSON.stringify(skills), exp.years, JSON.stringify(exp.items), iso()],
    }, ...cvChunkStmts(a.user.id, stored)]);
  } catch (e) { await removeCvObjects(c.env, [stored.key]); throw e; } // never leave an orphaned object behind a failed write
  if (old && old !== stored.key) await removeCvObjects(c.env, [old]);
  await afterResponse(c, async (db) => { await embedStudent(db, c.env, a.user.id); });
  const { rows } = await c.var.db.query('SELECT filename, size_bytes, mime, uploaded_at, extracted_skills, experience_years, experience_items FROM cvs WHERE user_id = $1', [a.user.id]);
  return c.json({ cv: meta(rows[0]) }, 201);
});

cv.get('/file', async (c) => {
  const { rows } = await c.var.db.query<{ user_id: string; filename: string; mime: string; size_bytes: number; content: Uint8Array | null; storage_key: string | null }>(
    'SELECT user_id, filename, mime, size_bytes, content, storage_key FROM cvs WHERE user_id = $1', [c.var.auth!.user.id]);
  if (!rows[0]) return apiError(c, 404, 'CV_NOT_FOUND');
  const bytes = await loadCvBytes(c.env, c.var.db, rows[0]);
  return bytes ? cvResponse({ ...rows[0], content: bytes }) : apiError(c, 404, 'CV_NOT_FOUND');
});

export function cvResponse(r: { filename: string; mime: string; content: Uint8Array }) {
  return new Response(new Uint8Array(r.content), {
    headers: {
      'content-type': r.mime, 'content-length': String(r.content.length),
      'content-disposition': `attachment; filename="cv${/\.pdf$/i.test(r.filename) ? '.pdf' : '.docx'}"; filename*=UTF-8''${encodeURIComponent(r.filename)}`,
      'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store',
    },
  });
}

cv.delete('/', async (c) => {
  const r = await c.var.db.query<{ storage_key: string | null }>('DELETE FROM cvs WHERE user_id = $1 RETURNING storage_key', [c.var.auth!.user.id]);
  if (!r.rowCount) return apiError(c, 404, 'CV_NOT_FOUND');
  await removeCvObjects(c.env, [r.rows[0].storage_key]);
  await afterResponse(c, async (db) => { await embedStudent(db, c.env, c.var.auth!.user.id); });
  return c.json({ ok: true });
});

/** Merges CV-extracted skills into the profile (existing first, max 30). */
cv.post('/apply-skills', async (c) => {
  const id = c.var.auth!.user.id;
  const { rows } = await c.var.db.query<{ extracted_skills: string[] }>('SELECT extracted_skills FROM cvs WHERE user_id = $1', [id]);
  if (!rows[0]) return apiError(c, 404, 'CV_NOT_FOUND');
  const cur = (await c.var.db.query<{ name: string }>('SELECT s.name FROM student_skills ss JOIN skills s ON s.id = ss.skill_id WHERE ss.user_id = $1 ORDER BY s.name', [id])).rows.map((r) => r.name);
  const have = new Set(cur.map(skillKey));
  const added = rows[0].extracted_skills.filter((s) => !have.has(skillKey(s))).slice(0, Math.max(0, 30 - cur.length));
  await addStudentSkills(c.var.db, id, added);
  await afterResponse(c, async (db) => { await embedStudent(db, c.env, id); });
  return c.json({ ok: true, added });
});
