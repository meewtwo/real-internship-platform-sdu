/** Stable keys for every dropdown. Labels live in the i18n `options` namespace (EN/RU/KK). */
export const LANGUAGES = ['en', 'ru', 'kk'] as const;
export type Language = (typeof LANGUAGES)[number];

export const CITY_KEYS = [
  'almaty', 'astana', 'shymkent', 'karaganda', 'aktobe', 'taraz', 'pavlodar', 'oskemen', 'semey',
  'atyrau', 'kostanay', 'kyzylorda', 'oral', 'petropavlovsk', 'turkistan', 'aktau', 'taldykorgan',
  'kokshetau', 'temirtau', 'ekibastuz', 'rudny', 'zhezkazgan', 'konaev', 'other',
] as const;

export const MAJOR_KEYS = [
  'computer_science', 'information_systems', 'software_engineering', 'cybersecurity', 'data_science_ai',
  'mathematics', 'physics', 'economics', 'finance', 'management', 'marketing', 'tourism',
  'international_relations', 'law', 'philology', 'translation_studies', 'pedagogy', 'journalism', 'engineering',
] as const;

export const YEAR_KEYS = ['1', '2', '3', '4', 'm1', 'm2'] as const;

export const INTEREST_KEYS = [
  'software_development', 'data_ai', 'cybersecurity', 'finance_banking', 'marketing_smm', 'design_ux',
  'engineering', 'research', 'education', 'law', 'management', 'other',
] as const;

export const RELOCATION_KEYS = ['yes', 'no', 'remote'] as const;

export const INDUSTRY_KEYS = [
  'it_software', 'finance_banking', 'telecom', 'education', 'healthcare', 'retail', 'manufacturing',
  'energy_oil_gas', 'logistics_transport', 'construction', 'media_marketing', 'government', 'consulting',
  'tourism_hospitality', 'agriculture', 'other',
] as const;

export const COMPANY_SIZE_KEYS = ['s1_10', 's11_50', 's51_200', 's201_1000', 's1000_plus'] as const;

export const ROLES = ['student', 'employer', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export type PublicRole = 'student' | 'employer';

export type CityKey = (typeof CITY_KEYS)[number];
export type MajorKey = (typeof MAJOR_KEYS)[number];
export type YearKey = (typeof YEAR_KEYS)[number];
export type InterestKey = (typeof INTEREST_KEYS)[number];
export type RelocationKey = (typeof RELOCATION_KEYS)[number];
export type IndustryKey = (typeof INDUSTRY_KEYS)[number];
export type CompanySizeKey = (typeof COMPANY_SIZE_KEYS)[number];

export const VACANCY_KINDS = ['internship', 'full_time', 'part_time'] as const;
export const WORK_FORMATS = ['onsite', 'hybrid', 'remote'] as const;
export const VACANCY_STATUSES = ['draft', 'published', 'closed'] as const;
export const APPLICATION_STATUSES = ['applied', 'viewed', 'shortlisted', 'interview', 'accepted', 'rejected', 'withdrawn'] as const;
/** Statuses an employer may set. */
export const EMPLOYER_SET_STATUSES = ['viewed', 'shortlisted', 'interview', 'accepted', 'rejected'] as const;
export const SEARCH_SORTS = ['match', 'newest', 'salary'] as const;
export type VacancyKind = (typeof VACANCY_KINDS)[number];
export type WorkFormat = (typeof WORK_FORMATS)[number];
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const OPTION_GROUPS = {
  cities: CITY_KEYS,
  majors: MAJOR_KEYS,
  years: YEAR_KEYS,
  interests: INTEREST_KEYS,
  relocation: RELOCATION_KEYS,
  industries: INDUSTRY_KEYS,
  sizes: COMPANY_SIZE_KEYS,
  kinds: VACANCY_KINDS,
  formats: WORK_FORMATS,
  appStatuses: APPLICATION_STATUSES,
} as const;

