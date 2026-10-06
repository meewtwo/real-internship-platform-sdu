import { vacancyMatchesFilters, type FilterableVacancy, type SavedFilters } from '@sdu/shared';
import type { Db } from '../lib/db';
import type { VacancyRow } from './matching';

export const toFilterable = (v: VacancyRow): FilterableVacancy => ({
  title: v.title, description: v.description, companyName: v.company_name, requiredSkills: v.skills, industry: v.industry_key, kind: v.kind,
  workFormat: v.work_format, city: v.city_key, salaryMin: v.salary_min, salaryMax: v.salary_max,
});

const MAX_ALERTS = 1000;

/**
 * After a vacancy is published: notify every student whose saved search matches it — once per (search, vacancy) and at most once per
 * student (several matching searches → one notification naming the first). Students who already got a "new match" notification
 * for this vacancy are skipped so nobody is pinged twice. Returns the number of students notified.
 */
export async function alertSavedSearches(db: Db, v: VacancyRow): Promise<number> {
  const link = `/vacancies/${v.id}`;
  const { rows } = await db.query<{ id: string; user_id: string; name: string; filters: SavedFilters }>(
    `SELECT ss.id, ss.user_id, ss.name, ss.filters FROM saved_searches ss JOIN users u ON u.id = ss.user_id AND u.status = 'active'
     WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = ss.user_id AND n.kind = 'new_match' AND n.link = $1)
     ORDER BY ss.created_at, ss.id LIMIT 20000`,
    [link],
  );
  const fv = toFilterable(v);
  const hits = rows.filter((r) => r.filters && typeof r.filters === 'object' && vacancyMatchesFilters(r.filters, fv));
  if (!hits.length) return 0;
  const inserted = await db.query<{ search_id: string }>(
    'INSERT OR IGNORE INTO saved_search_hits (search_id, vacancy_id) SELECT value, $2 FROM json_each($1) RETURNING search_id',
    [JSON.stringify(hits.map((h) => h.id)), v.id],
  );
  const fresh = new Set(inserted.rows.map((r) => r.search_id));
  const perUser = new Map<string, string>();
  for (const h of hits) if (fresh.has(h.id) && !perUser.has(h.user_id)) perUser.set(h.user_id, h.name);
  const users = [...perUser.entries()].slice(0, MAX_ALERTS);
  if (!users.length) return 0;
  await db.query(
    `INSERT INTO notifications (user_id, kind, params, link)
     SELECT json_extract(j.value, '$.u'), 'saved_search', json_object('title', $1, 'company', $2, 'search', json_extract(j.value, '$.n')), $3 FROM json_each($4) j`,
    [v.title, v.company_name, link, JSON.stringify(users.map(([u, n]) => ({ u, n })))],
  );
  return users.length;
}
