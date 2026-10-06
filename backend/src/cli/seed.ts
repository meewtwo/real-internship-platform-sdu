import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../lib/crypto';

try { process.loadEnvFile(new URL('../../.env', import.meta.url)); } catch { /* optional */ }

export const SEED_PASSWORDS = { admin: 'Cm!Root2026#Safe', demo: 'Demo!Pass2026a' };

// The published default admin password must never reach a real deployment: set ADMIN_PASSWORD (and in production it is mandatory).
const adminPassword = process.env.ADMIN_PASSWORD ?? SEED_PASSWORDS.admin;
if (process.env.ENVIRONMENT === 'production' || process.env.NODE_ENV === 'production') {
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === SEED_PASSWORDS.admin) {
    console.error('Refusing to seed in production: set ADMIN_PASSWORD to a new strong password (not the documented demo one).');
    process.exit(1);
  }
}


import { skillKey } from '@sdu/shared';
import { Db, type Stmt } from '../lib/db';
import { nodeEnv } from '../envNode';
import { migrate } from './migrate';
import '../lib/dbNode';

/** SQL literal for a bound value (used when the seed is written to a .sql file for `wrangler d1 execute`). */
const lit = (v: unknown): string => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`);
const inline = (s: Stmt) => s.sql.replace(/\$(\d+)/g, (_, n) => lit(s.params?.[Number(n) - 1])) + ';';
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

/**
 * Builds the demo data. `--sql <file>` writes it as SQL (for `wrangler d1 execute --remote --file`); otherwise it is applied to the local SQLite file.
 * With ENVIRONMENT=production only the admin account is created (never demo users with a public password).
 */
export async function buildSeed(): Promise<Stmt[]> {
  const prod = process.env.ENVIRONMENT === 'production';
  const out: Stmt[] = [];
  // DEMO_VACANCIES=1 + ENVIRONMENT=production: only showcase employers + vacancies (no students, no admin change, nobody can sign in as these employers).
  const demoOnly = prod && process.env.DEMO_VACANCIES === '1';
  out.push({ sql: `DELETE FROM users WHERE email IN (${demoOnly ? '' : "'admin@careermatch.kz',"}'hr@kaspi-demo.kz','talent@epam-demo.kz','pending@startup-demo.kz') OR student_id IN ('230107001','230107002','230107003')` });
  if (!demoOnly) {
    const adminHash = await hashPassword(adminPassword);
    out.push({ sql: `INSERT INTO users (role, email, password_hash, status, preferred_language) VALUES ('admin', 'admin@careermatch.kz', $1, 'active', 'en')`, params: [adminHash] });
  }
  if (prod && !demoOnly) return out;
  const demoHash = await hashPassword(demoOnly ? crypto.randomUUID() + crypto.randomUUID() : SEED_PASSWORDS.demo);
  const students: [string, string, string, string, string, string, string, string, string, string, string][] = [
    ['230107001', 'Aigerim', 'Nurlanova', 'aigerim.nurlanova@sdu.edu.kz', '+77011234501', 'almaty', 'computer_science', '3', '3.65', '2028-06', 'software_development'],
    ['230107002', 'Daniyar', 'Serikov', 'daniyar.serikov@sdu.edu.kz', '+77011234502', 'astana', 'cybersecurity', '4', '3.20', '2027-06', 'cybersecurity'],
    ['230107003', 'Madina', 'Akhmetova', 'madina.akhmetova@sdu.edu.kz', '+77011234503', 'shymkent', 'finance', '2', '3.90', '2029-06', 'finance_banking'],
  ];
  const sid: Record<string, string> = {};
  for (const s of demoOnly ? [] : students) {
    const id = uuid(); sid[s[0]] = id;
    out.push({ sql: `INSERT INTO users (id, role, student_id, email, phone, password_hash, status, preferred_language) VALUES ($1, 'student', $2, $3, $4, $5, 'active', 'en')`, params: [id, s[0], s[3], s[4], demoHash] });
    out.push({ sql: `INSERT INTO student_profiles (user_id, name, surname, city_key, major_key, year_of_study, gpa, graduation_date, interest_area, relocation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'yes')`, params: [id, s[1], s[2], s[5], s[6], s[7], s[8], `${s[9]}-01`, s[10]] });
  }
  const employers: [string, string, string, string, string, string, string, string, string, string, 'active' | 'pending'][] = [
    ['hr@kaspi-demo.kz', '+77021234501', 'Kaspi Demo LLP', '123456789012', 'finance_banking', 's1000_plus', 'almaty', 'Alua', 'Bekova', 'HR Manager', 'active'],
    ['talent@epam-demo.kz', '+77021234502', 'EPAM Demo', '123456789013', 'it_software', 's201_1000', 'astana', 'Timur', 'Ospanov', 'Talent Partner', 'active'],
    ['pending@startup-demo.kz', '+77021234503', 'Startup Demo', '123456789014', 'it_software', 's11_50', 'almaty', 'Dana', 'Iskakova', 'Founder', 'pending'],
  ];
  const eids: Record<string, string> = {};
  for (const e of demoOnly ? employers.filter((x) => x[10] === 'active') : employers) {
    const id = uuid(); eids[e[0]] = id;
    out.push({ sql: `INSERT INTO users (id, role, email, phone, password_hash, status, preferred_language) VALUES ($1, 'employer', $2, $3, $4, $5, 'en')`, params: [id, e[0], e[1], demoHash, e[10]] });
    out.push({ sql: `INSERT INTO employer_profiles (user_id, company_name, company_lc, bin, industry_key, size_key, city_key, contact_name, contact_surname, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, params: [id, e[2], e[2].toLocaleLowerCase(), e[3], e[4], e[5], e[6], e[7], e[8], e[9]] });
  }
  const V: [string, string, string, string, string, string, number | null, number | null, string[]][] = [
    ['hr@kaspi-demo.kz', 'Data Analyst Intern', 'Work with the analytics team on dashboards, SQL reports and A/B tests for our consumer products. You will own a small project from data collection to the final presentation.', 'internship', 'finance_banking', 'almaty', 250000, 350000, ['Python', 'SQL', 'Power BI', 'Data Analysis']],
    ['hr@kaspi-demo.kz', 'Junior Backend Developer (Java)', 'Build and support backend services used by millions of customers. Code reviews, tests and mentoring from senior engineers are part of the job.', 'full_time', 'finance_banking', 'almaty', 450000, 650000, ['Java', 'SQL', 'Git', 'Docker']],
    ['hr@kaspi-demo.kz', 'Marketing & SMM Intern', 'Plan and publish campaigns, analyse engagement and prepare weekly reports. Creative students with an eye for numbers are welcome.', 'internship', 'finance_banking', 'almaty', 180000, null, ['SMM', 'Marketing', 'SEO', 'Excel']],
    ['talent@epam-demo.kz', 'Frontend Engineer Intern (React)', 'Join a product team building web applications with React and TypeScript. You will pair with engineers and ship real features within the first month.', 'internship', 'it_software', 'astana', 300000, 400000, ['JavaScript', 'TypeScript', 'React', 'HTML', 'CSS']],
    ['talent@epam-demo.kz', 'DevOps Engineer Intern', 'Help us automate deployments and monitor cloud infrastructure. You will learn Kubernetes, CI/CD and Linux administration on live projects.', 'internship', 'it_software', 'astana', 320000, 420000, ['Docker', 'Kubernetes', 'Linux', 'CI/CD', 'AWS']],
    ['talent@epam-demo.kz', 'Machine Learning Engineer (Part-time)', 'Prototype models for text classification and recommendation, evaluate them and prepare them for production together with the data team.', 'part_time', 'it_software', 'astana', 500000, 700000, ['Python', 'Machine Learning', 'Statistics', 'Git']],
    ['talent@epam-demo.kz', 'UI/UX Designer Intern', 'Design interfaces in Figma, run small usability tests and hand over specifications to developers. Remote-friendly team.', 'internship', 'it_software', 'almaty', 200000, 300000, ['Figma', 'UI/UX Design', 'HTML', 'CSS']],
    ['talent@epam-demo.kz', 'Cybersecurity Analyst Intern', 'Monitor alerts, triage incidents and help run vulnerability scans. Training and certification support included.', 'internship', 'it_software', 'astana', 280000, 380000, ['Cybersecurity', 'Linux', 'Network Security', 'Penetration Testing']],
  ];
  for (const [i, v] of V.entries()) {
    const id = uuid();
    out.push({ sql: `INSERT INTO skills (name, name_key) SELECT json_extract(value, '$.n'), json_extract(value, '$.k') FROM json_each($1) WHERE true ON CONFLICT (name_key) DO NOTHING`, params: [JSON.stringify(v[8].map((n) => ({ n, k: skillKey(n) })))] });
    out.push({ sql: `INSERT INTO vacancies (id, employer_id, title, title_lc, description, description_lc, kind, industry_key, city_key, work_format, salary_min, salary_max, status, published_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'published', $13)`,
      params: [id, eids[v[0]], v[1], v[1].toLocaleLowerCase(), v[2], v[2].toLocaleLowerCase(), v[3], v[4], v[5], i % 3 === 0 ? 'hybrid' : i % 3 === 1 ? 'onsite' : 'remote', v[6], v[7], new Date(Date.now() - i * 7 * 3600_000).toISOString()] });
    out.push({ sql: `INSERT INTO vacancy_skills (vacancy_id, skill_id) SELECT $1, s.id FROM skills s WHERE s.name_key IN (SELECT value FROM json_each($2))`, params: [id, JSON.stringify(v[8].map(skillKey))] });
  }
  return out;
}

async function main() {
  const stmts = await buildSeed();
  const i = process.argv.indexOf('--sql');
  if (i > 0) { writeFileSync(process.argv[i + 1], stmts.map(inline).join('\n') + '\n'); console.log(`wrote ${stmts.length} statements to ${process.argv[i + 1]}`); return; }
  await migrate();
  await new Db(nodeEnv()).batch(stmts);
  console.log('seeded: admin + 3 students + 3 employers + 8 vacancies (see README for passwords)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
void now;
