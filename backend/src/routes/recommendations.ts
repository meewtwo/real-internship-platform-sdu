import { Hono } from 'hono';
import { skillKey } from '@sdu/shared';
import { requireAuth } from '../lib/guard';
import type { AppEnv } from '../lib/http';
import { loadStudentSignal, matchFor, SQL_TODAY, toVacancyDto, VACANCY_SELECT, type VacancyRow } from '../services/matching';

export const recommendations = new Hono<AppEnv>();

/** Personalised vacancies + the skills the student is missing for them, each with learning resources (US-8). */
recommendations.get('/', requireAuth('student'), async (c) => {
  const sid = c.var.auth!.user.id;
  const s = await loadStudentSignal(c.var.db, sid);
  const { rows } = await c.var.db.query<VacancyRow>(
    `${VACANCY_SELECT} WHERE v.status = 'published' AND (v.deadline IS NULL OR v.deadline >= ${SQL_TODAY})
       AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.vacancy_id = v.id AND a.student_id = $1 AND a.status <> 'withdrawn') ORDER BY v.published_at DESC LIMIT 500`,
    [sid],
  );
  const ranked = rows.map((v) => ({ v, m: matchFor(s, v)! })).sort((a, b) => b.m.percent - a.m.percent);
  const top = ranked.slice(0, 10);
  const gapCount = new Map<string, { skill: string; count: number }>();
  for (const { m } of ranked.slice(0, 20)) for (const sk of m.missingSkills) { const k = skillKey(sk); const g = gapCount.get(k) ?? { skill: sk, count: 0 }; g.count++; gapCount.set(k, g); }
  const gaps = [...gapCount.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).slice(0, 8);
  const courses = gaps.length ? (await c.var.db.query<{ skill_key: string; title: string; provider: string; url: string; free: boolean }>('SELECT skill_key, title, provider, url, free FROM courses WHERE skill_key IN (SELECT value FROM json_each($1)) ORDER BY id', [JSON.stringify(gaps.map(([k]) => k))])).rows : [];
  return c.json({
    recommendations: top.map(({ v, m }) => ({ ...toVacancyDto(v), match: m })),
    gaps: gaps.map(([k, g]) => {
      const own = courses.filter((x) => x.skill_key === k).map((x) => ({ title: x.title, provider: x.provider, url: x.url, free: x.free }));
      return { skill: g.skill, count: g.count, courses: own.length ? own : [{ title: g.skill, provider: 'Coursera', url: `https://www.coursera.org/search?query=${encodeURIComponent(g.skill)}`, free: false }] };
    }),
  });
});
