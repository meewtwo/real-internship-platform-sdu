import { type CityKey, type IndustryKey, type VacancyKind, type WorkFormat } from './options';
import { parseSearchQuery } from './validators';
import { skillKey } from './matching';
import type { ErrorCode, FieldErrors } from './errors';

/** Filters a student can save (sort/page are presentation, not part of "what I want to hear about"). */
export interface SavedFilters {
  q: string; industry: IndustryKey | null; kind: VacancyKind | null; format: WorkFormat | null; city: CityKey | null; salaryFrom: number | null; withSalary: boolean;
}
export const MAX_SAVED_SEARCHES = 10;
const ALLOWED = ['q', 'industry', 'kind', 'format', 'city', 'salaryFrom', 'withSalary'];

export type SavedSearchResult =
  | { ok: true; data: { name: string; filters: SavedFilters } }
  | { ok: false; formError?: ErrorCode; fields: FieldErrors };

/** Validates { name, filters }. Never trusts shapes: unknown keys, non-string values and invalid options are rejected, not ignored. */
export function validateSavedSearch(input: unknown): SavedSearchResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, formError: 'VALIDATION_FAILED', fields: {} };
  const o = input as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== 'name' && k !== 'filters')) return { ok: false, formError: 'UNKNOWN_FIELDS', fields: {} };
  const fields: FieldErrors = {};
  const rawName = typeof o.name === 'string' ? o.name.normalize('NFC').replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g, '').replace(/\s+/g, ' ').trim() : null;
  if (rawName === null || rawName === '') fields.name = 'REQUIRED';
  else if (Array.from(rawName).length > 60) fields.name = 'NAME_TOO_LONG';
  const f = o.filters;
  let filters: SavedFilters | null = null;
  if (typeof f !== 'object' || f === null || Array.isArray(f)) fields.filters = 'SEARCH_INVALID';
  else {
    const fo = f as Record<string, unknown>;
    if (Object.keys(fo).some((k) => !ALLOWED.includes(k)) || Object.values(fo).some((v) => v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')) fields.filters = 'SEARCH_INVALID';
    else {
      const asStr = (v: unknown) => (v === null || v === undefined ? undefined : typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
      const p = parseSearchQuery({ q: asStr(fo.q), industry: asStr(fo.industry), kind: asStr(fo.kind), format: asStr(fo.format), city: asStr(fo.city), salaryFrom: asStr(fo.salaryFrom), withSalary: asStr(fo.withSalary) });
      if (!p.ok) fields.filters = 'SEARCH_INVALID';
      else {
        const nf: SavedFilters = { q: p.value.q, industry: p.value.industry as SavedFilters['industry'], kind: p.value.kind as SavedFilters['kind'], format: p.value.format as SavedFilters['format'], city: p.value.city as SavedFilters['city'], salaryFrom: p.value.salaryFrom, withSalary: p.value.withSalary };
        if (!nf.q && !nf.industry && !nf.kind && !nf.format && !nf.city && nf.salaryFrom === null && !nf.withSalary) fields.filters = 'SEARCH_INVALID'; // an empty filter would alert on everything
        else filters = nf;
      }
    }
  }
  if (Object.keys(fields).length || !filters || rawName === null) return { ok: false, fields };
  return { ok: true, data: { name: rawName, filters } };
}

export interface FilterableVacancy {
  title: string; description: string; companyName: string; requiredSkills: string[]; industry: string; kind: string; workFormat: string; city: string;
  salaryMin: number | null; salaryMax: number | null;
}
/** Same semantics as GET /api/vacancies (substring search over title/description/company/skills; exact option filters; salary). */
export function vacancyMatchesFilters(f: SavedFilters, v: FilterableVacancy): boolean {
  if (f.q) {
    const q = f.q.toLocaleLowerCase();
    const hay = [v.title, v.description, v.companyName].map((x) => x.toLocaleLowerCase());
    if (!hay.some((x) => x.includes(q)) && !v.requiredSkills.some((s) => skillKey(s).includes(q))) return false;
  }
  if (f.industry && v.industry !== f.industry) return false;
  if (f.kind && v.kind !== f.kind) return false;
  if (f.format && v.workFormat !== f.format) return false;
  if (f.city && v.city !== f.city) return false;
  if (f.salaryFrom !== null && (v.salaryMax ?? v.salaryMin ?? -1) < f.salaryFrom) return false;
  if (f.withSalary && v.salaryMin === null && v.salaryMax === null) return false;
  return true;
}
