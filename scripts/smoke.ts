/**
 * End-to-end smoke test against a RUNNING deployment (local `wrangler dev` or production).
 *   npx tsx scripts/smoke.ts <base-url> [--local|--remote] [--admin-email e --admin-password p]
 * It creates throw-away users, drives the main user journeys through the real HTTP API and prints PASS/FAIL per step.
 * Needs ENVIRONMENT=test on the target for the e-mail code outbox (local); on production pass an existing admin and use --no-register.
 */
import { execFileSync } from 'node:child_process';
import { hashPassword } from '../backend/src/lib/crypto';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8799').replace(/\/$/, '');
const TARGET = process.argv.includes('--remote') ? '--remote' : '--local';
const PW = 'Vk8#mQ2!zPw4';
let ip = 1;

class Jar {
  cookies = new Map<string, string>(); csrf = '';
  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    if (method !== 'GET' && !this.csrf) this.csrf = (await this.call('GET', '/api/auth/csrf')).body.token; // first: it sets the csrf cookie the next request must carry
    const headers: Record<string, string> = { 'x-forwarded-for': `10.1.${Math.floor(ip / 250)}.${ip++ % 250 + 1}`, ...extra };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET') headers['x-csrf-token'] = this.csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const sc of res.headers.getSetCookie()) { const [pair] = sc.split(';'); const i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
    const text = await res.text();
    let json: any = text; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, headers: res.headers, text };
  }
}
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  → ' + JSON.stringify(detail).slice(0, 300)}`); if (!ok) failures++; };
const d1 = (sql: string) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'sdu-career-match', TARGET, '--command', sql, '--json'], { cwd: new URL('../backend/', import.meta.url).pathname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

async function register(role: 'student' | 'employer', n: string) {
  const j = new Jar();
  const payload = role === 'student'
    ? { studentId: `9${n}`.padEnd(9, '0').slice(0, 9), name: 'Aigerim', surname: 'Nurlanova', email: `smoke${n}@sdu.edu.kz`, phone: `+7701${n.padEnd(7, '1').slice(0, 7)}`, city: 'almaty', major: 'computer_science', yearOfStudy: '3', gpa: '3.65', graduation: `${new Date().getUTCFullYear() + 2}-06`, interestArea: 'data_ai', relocation: 'yes', password: PW, confirmPassword: PW, acceptTerms: true, language: 'en' }
    : { companyName: 'Smoke Technologies LLP', bin: `7${n}`.padEnd(12, '0').slice(0, 12), industry: 'it_software', size: 's51_200', city: 'astana', contactName: 'Timur', contactSurname: 'Ospanov', position: 'HR Manager', email: `hr${n}@smoke-co.kz`, phone: `+7702${n.padEnd(7, '2').slice(0, 7)}`, website: 'https://smoke-co.kz', description: 'We build things.', password: PW, confirmPassword: PW, acceptTerms: true, language: 'en' };
  const r = await j.call('POST', `/api/auth/register/${role}`, payload);
  if (r.status !== 201) throw new Error(`register ${role}: ${r.status} ${r.text}`);
  const mail = (await j.call('GET', `/api/__test/outbox?to=${encodeURIComponent(payload.email)}`)).body.mails.at(-1);
  const v = await j.call('POST', '/api/auth/verify', { role, identifier: role === 'student' ? (payload as any).studentId : payload.email, code: mail.code });
  if (v.status !== 200) throw new Error(`verify ${role}: ${v.status} ${v.text}`);
  return { j, payload };
}

async function main() {
  const n = String(Date.now()).slice(-7);
  const health = await (await fetch(`${BASE}/api/health/ready`)).json();
  check('readiness reports the database', health.ok === true && health.db === 'up', health);

  const stu = await register('student', n);
  check('student registered, verified, signed in', (await stu.j.call('GET', '/api/auth/me')).body.user?.role === 'student');
  const prof = (await stu.j.call('GET', '/api/profile')).body.profile;
  const put = await stu.j.call('PUT', '/api/profile/student', { ...prof, skills: ['Python', 'SQL', 'Docker'], interests: ['machine learning', 'аналитика данных'] });
  check('profile saved with skills (batch + json_each upsert)', put.status === 200 && put.body.profile.skills.join() === 'Docker,Python,SQL', put.body);
  const sk = await stu.j.call('GET', '/api/profile/skills?q=pyth');
  check('skill autocomplete (LIKE ESCAPE)', sk.body.skills?.includes('Python'), sk.body);

  const emp = await register('employer', n);
  d1(`UPDATE users SET status = 'active' WHERE email = 'hr${n}@smoke-co.kz'`);
  await emp.j.call('POST', '/api/auth/logout');
  const li = await emp.j.call('POST', '/api/auth/login', { role: 'employer', identifier: emp.payload.email, password: PW });
  check('employer approved and signed in', li.status === 200, li.body);
  await stu.j.call('POST', '/api/saved-searches', { name: 'python jobs', filters: { q: 'python' } });
  const vac = await emp.j.call('POST', '/api/vacancies', { title: 'Python SQL Data Analyst Intern', description: 'Analyse data with Python and SQL and build dashboards for our analytics team.', kind: 'internship', industry: 'it_software', city: 'almaty', workFormat: 'hybrid', requiredSkills: ['Python', 'SQL'], salaryMin: 250000, salaryMax: 400000, minGpa: '3.2' });
  check('vacancy created (title_lc/description_lc, skills batch)', vac.status === 201, vac.body);
  const pub = await emp.j.call('POST', `/api/vacancies/${vac.body.vacancy.id}/publish`);
  check('vacancy published, students matched (bulk json_each insert)', pub.status === 200 && pub.body.matches >= 1, pub.body);
  const list = await stu.j.call('GET', '/api/vacancies?q=%D0%B0%D0%BD%D0%B0%D0%BB%D0%B8%D1%82%D0%B8%D0%BA&sort=match');
  check('search runs (Cyrillic query, no crash)', list.status === 200, list.body);
  const found = await stu.j.call('GET', '/api/vacancies?q=PYTHON&sort=match');
  check('search is case-insensitive and returns match %', found.body.items?.[0]?.match?.percent > 0, found.body);
  const notes = await stu.j.call('GET', '/api/notifications');
  check('student notified (new_match / saved_search)', notes.body.items?.some((x: any) => ['new_match', 'saved_search'].includes(x.kind)), notes.body);

  const app = await stu.j.call('POST', `/api/vacancies/${vac.body.vacancy.id}/apply`, { coverNote: 'Hello' });
  check('application created (atomic upsert + event + notification)', app.status === 201, app.body);
  check('second application refused', (await stu.j.call('POST', `/api/vacancies/${vac.body.vacancy.id}/apply`)).status === 409);
  const appId = app.body.application.id;
  const st = await emp.j.call('PATCH', `/api/applications/${appId}/status`, { status: 'shortlisted' });
  check('status changed by employer (compare-and-set batch)', st.status === 200, st.body);
  const mine = await stu.j.call('GET', '/api/applications');
  check('student sees status history (json_group_array)', mine.body.applications?.[0]?.status === 'shortlisted' && mine.body.applications[0].events.length === 2, mine.body);
  const ranked = await emp.j.call('GET', `/api/vacancies/${vac.body.vacancy.id}/applicants`);
  check('employer sees ranked applicants', ranked.body.applicants?.length === 1, ranked.body);

  const m1 = await emp.j.call('POST', `/api/messages/${appId}`, { body: 'Hello! Free for a call?' });
  check('chat message sent', m1.status === 201, m1.body);
  check('thread list works (join on max id)', (await stu.j.call('GET', '/api/messages/threads')).body.threads?.[0]?.unread === 1);
  const start = new Date(Date.now() + 3 * 86400_000).toISOString();
  const iv = await emp.j.call('POST', '/api/interviews', { applicationId: appId, startsAt: start, durationMin: 45, format: 'online', location: 'https://meet.example.com/x' });
  check('interview proposed (overlap guard inside INSERT)', iv.status === 201, iv.body);
  const dup = await emp.j.call('POST', '/api/interviews', { applicationId: appId, startsAt: new Date(Date.now() + 5 * 86400_000).toISOString(), durationMin: 30, format: 'phone', location: '+77010000000' });
  check('second live interview refused (partial unique index)', dup.status === 409, dup.body);
  const acc = await stu.j.call('POST', `/api/interviews/${iv.body.interview.id}/respond`, { accept: true });
  check('interview accepted', acc.status === 200 && acc.body.interview.status === 'accepted', acc.body);
  const ics = await stu.j.call('GET', `/api/interviews/${iv.body.interview.id}/ics`);
  check('.ics exported', ics.text.startsWith('BEGIN:VCALENDAR') && ics.text.includes('STATUS:CONFIRMED'));

  const doc = await stu.j.call('POST', '/api/resume-docs', { title: 'My résumé', from: 'profile' });
  check('résumé created from profile (guarded insert + snapshot)', doc.status === 201, doc.body);
  const saved = await stu.j.call('PUT', `/api/resume-docs/${doc.body.doc.id}`, { baseVersion: 1, data: { ...doc.body.doc.data, summary: 'Student building analytics tools.' } });
  check('résumé saved (optimistic concurrency)', saved.status === 200 && saved.body.doc.version === 2, saved.body);
  check('stale save refused', (await stu.j.call('PUT', `/api/resume-docs/${doc.body.doc.id}`, { baseVersion: 1, title: 'x' })).status === 409);
  const docx = await stu.j.call('GET', `/api/resume-docs/${doc.body.doc.id}/export.docx`);
  check('DOCX exported', docx.status === 200 && docx.headers.get('content-type')!.includes('wordprocessingml'));
  const share = await stu.j.call('POST', `/api/resume-docs/${doc.body.doc.id}/share`, { enabled: true });
  const pub2 = await new Jar().call('GET', `/api/public/resume/${share.body.doc.publicSlug}`);
  check('public résumé link works without login', pub2.status === 200 && pub2.body.resume.data.personal.email === '', pub2.body);

  const ins = await emp.j.call('GET', `/api/vacancies/${vac.body.vacancy.id}/insights`);
  check('insights (recursive CTE, FILTER aggregates)', ins.status === 200 && ins.body.views.series.length === 30, ins.body);
  const sim = await stu.j.call('GET', `/api/vacancies/${vac.body.vacancy.id}/similar`);
  check('similar vacancies', sim.status === 200);
  const rec = await stu.j.call('GET', '/api/recommendations');
  check('recommendations + courses (json_each IN)', rec.status === 200, rec.body);
  const exp = await stu.j.call('GET', '/api/profile/export');
  check('data export', exp.status === 200 && !JSON.stringify(exp.body).toLowerCase().includes('password'));

  // admin analytics
  const admin = new Jar();
  d1(`DELETE FROM users WHERE email = 'smoke-admin@careermatch.kz'`);
  d1(`INSERT INTO users (role, email, password_hash, status) VALUES ('admin', 'smoke-admin@careermatch.kz', '${await hashPassword(PW)}', 'active')`);
  check('admin signs in', (await admin.call('POST', '/api/auth/login', { role: 'employer', identifier: 'smoke-admin@careermatch.kz', password: PW })).status === 200);
  const an = await admin.call('GET', '/api/admin/analytics');
  check('admin analytics (recursive CTE series)', an.status === 200 && an.body.series.length === 30 && an.body.users.students >= 1, an.body);
  const au = await admin.call('GET', '/api/admin/audit?limit=5');
  check('audit log readable', au.status === 200 && au.body.items.length >= 1, au.body);
  const del = await stu.j.call('DELETE', '/api/profile', { password: PW });
  check('account erasure cascades (FK + audit survives)', del.status === 200, del.body);
  check('erased account can no longer sign in', (await stu.j.call('GET', '/api/auth/me')).status === 401);
  d1(`DELETE FROM users WHERE email IN ('smoke-admin@careermatch.kz', 'hr${n}@smoke-co.kz')`);

  console.log(failures ? `\n${failures} step(s) FAILED` : '\nall smoke steps passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error('smoke aborted:', e); process.exit(2); });
