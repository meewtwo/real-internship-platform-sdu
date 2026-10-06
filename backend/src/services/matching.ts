import { fromBytes, matchScore, type MatchResult, type StudentSignal, type VacancySignal, type CityKey, type IndustryKey, type InterestKey, type RelocationKey, type WorkFormat } from '@sdu/shared';
import type { Queryable } from '../lib/db';
import { TODAY } from '../lib/sql';

const SIGNAL_SELECT = `SELECT sp.user_id,
    COALESCE((SELECT json_group_array(name) FROM (SELECT s.name AS name FROM student_skills ss JOIN skills s ON s.id = ss.skill_id WHERE ss.user_id = sp.user_id ORDER BY s.name)), '[]') AS skills,
    cv.extracted_skills AS cv_skills, sp.interests,
    trim(COALESCE(substr(cv.text_content, 1, 20000), '') || ' ' || COALESCE(rs.about, '') || ' ' || COALESCE((SELECT group_concat(json_extract(c.value, '$.name'), ' ') FROM json_each(rs.courses) c), '')) AS cv_text,
    sp.major_key, sp.interest_area, sp.city_key, sp.city_other, sp.relocation, sp.gpa AS gpa, cv.experience_years AS exp, se.vec AS emb
  FROM student_profiles sp JOIN users u ON u.id = sp.user_id LEFT JOIN cvs cv ON cv.user_id = sp.user_id LEFT JOIN resumes rs ON rs.user_id = sp.user_id
  LEFT JOIN student_embeddings se ON se.user_id = sp.user_id`;
interface SignalRow {
  user_id: string; skills: string[]; cv_skills: string[] | null; interests: string[]; cv_text: string | null; major_key: string; interest_area: InterestKey;
  city_key: CityKey; city_other: string | null; relocation: RelocationKey; gpa: string; exp: number | string | null; emb: Uint8Array | null;
}
const toSignal = (r: SignalRow): StudentSignal => ({
  skills: r.skills, cvSkills: r.cv_skills ?? [], interests: r.interests, cvText: r.cv_text ?? '', majorKey: r.major_key, interestArea: r.interest_area,
  city: r.city_key, cityOther: r.city_other, relocation: r.relocation, gpa: Number(r.gpa), experienceYears: Number(r.exp ?? 0), vec: fromBytes(r.emb),
});

/** Loads signals in ONE query: all active students (capped) or the given ids. */
export async function loadStudentSignals(q: Queryable, ids?: string[]): Promise<Map<string, StudentSignal>> {
  const { rows } = ids
    ? await q.query<SignalRow>(`${SIGNAL_SELECT} WHERE sp.user_id IN (SELECT value FROM json_each($1))`, [JSON.stringify(ids)])
    : await q.query<SignalRow>(`${SIGNAL_SELECT} WHERE u.status = 'active' ORDER BY sp.user_id LIMIT 2000`);
  return new Map(rows.map((r) => [r.user_id, toSignal(r)]));
}
export async function loadStudentSignal(q: Queryable, userId: string): Promise<StudentSignal | null> {
  return (await loadStudentSignals(q, [userId])).get(userId) ?? null;
}

export interface VacancyRow {
  id: string; employer_id: string; title: string; description: string; kind: string; industry_key: IndustryKey; city_key: CityKey; city_other: string | null;
  work_format: WorkFormat; min_gpa: string | null; deadline: string | null; salary_min: number | null; salary_max: number | null; status: string; published_at: string | null; created_at: string;
  skills: string[]; company_name: string; company_website: string | null; applicants?: number; emb?: Uint8Array | null;
}

export const VACANCY_SELECT = `SELECT v.id, v.employer_id, v.title, v.description, v.kind, v.industry_key, v.city_key, v.city_other, v.work_format, v.min_gpa AS min_gpa,
  v.deadline AS deadline, v.salary_min, v.salary_max, v.status, v.published_at, v.created_at,
  COALESCE((SELECT json_group_array(name) FROM (SELECT s.name AS name FROM vacancy_skills vs JOIN skills s ON s.id = vs.skill_id WHERE vs.vacancy_id = v.id ORDER BY s.name)), '[]') AS skills,
  ep.company_name, ep.website AS company_website, ve.vec AS emb
  FROM vacancies v JOIN employer_profiles ep ON ep.user_id = v.employer_id LEFT JOIN vacancy_embeddings ve ON ve.vacancy_id = v.id`;

export const vacancySignal = (v: VacancyRow): VacancySignal => ({
  title: v.title, description: v.description, requiredSkills: v.skills, industry: v.industry_key, city: v.city_key, cityOther: v.city_other,
  workFormat: v.work_format, minGpa: v.min_gpa === null ? null : Number(v.min_gpa), vec: fromBytes(v.emb),
});

export const toVacancyDto = (v: VacancyRow) => ({
  id: v.id, title: v.title, description: v.description, kind: v.kind, industry: v.industry_key, city: v.city_key, cityOther: v.city_other,
  workFormat: v.work_format, minGpa: v.min_gpa, deadline: v.deadline, salaryMin: v.salary_min, salaryMax: v.salary_max, status: v.status, publishedAt: v.published_at, createdAt: v.created_at,
  requiredSkills: v.skills, company: { id: v.employer_id, name: v.company_name, website: v.company_website },
  ...(v.applicants !== undefined ? { applicants: Number(v.applicants) } : {}),
});

export const matchFor = (s: StudentSignal | null, v: VacancyRow): MatchResult | null => (s ? matchScore(s, vacancySignal(v)) : null);

/** Date in Asia/Almaty as YYYY-MM-DD, for "deadline not passed" checks. */
export const SQL_TODAY = TODAY;
