/** Generates VALIDATION.md (field → rule → error code → DB constraint → EN/RU/KZ message). Run: npx tsx scripts/gen-validation-md.ts */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const L = fileURLToPath(new URL('../frontend/src/locales/', import.meta.url));
const msg = (lang: string, code: string): string => (JSON.parse(readFileSync(`${L}${lang}/errors.json`, 'utf8')) as Record<string, string>)[code] ?? '❌ MISSING';
const esc = (s: string) => s.replace(/\|/g, '\\|');

type Row = [field: string, rule: string, code: string, db: string];
const S = 'Student registration';
const rows: [string, Row[]][] = [
  [`${S} (POST /api/auth/register/student) and profile`, [
    ['studentId', 'required; exactly 9 chars, ASCII `[0-9]` only (Arabic-Indic / full-width digits rejected); stored as TEXT (leading zeros kept); UI strips non-digits, `maxlength=9`, numeric keyboard', 'STUDENT_ID_INVALID', '`users_student_id_format_chk` (`~ ^[0-9]{9}$`), `users_student_rules_chk`'],
    ['studentId', 'unique (also under parallel requests)', 'STUDENT_ID_TAKEN', '`users_student_id_uq` UNIQUE'],
    ['name / surname', 'required; trimmed; whitespace/zero-width-only → REQUIRED', 'REQUIRED', '`sp_name_chk`, `sp_surname_chk`'],
    ['name / surname', 'min 2 letters', 'NAME_TOO_SHORT', '`char_length BETWEEN 2 AND 50`'],
    ['name / surname', 'max 50 letters (10 000-char payloads are cut off before any regex runs)', 'NAME_TOO_LONG', '`char_length BETWEEN 2 AND 50`'],
    ['name / surname', 'letters only: Latin **or** Cyrillic (incl. ә ғ қ ң ө ұ ү һ і), never mixed (look-alike defence); no digits, symbols, spaces, emoji, RTL/zero-width chars; first letter capitalised on save', 'NAME_INVALID_CHARS', '`name !~ \'[0-9<>&"\'\\s]\'`'],
    ['email', 'required; ≤254 chars', 'EMAIL_TOO_LONG', '`users_email_lower_chk` (`char_length ≤ 254`)'],
    ['email', 'syntax: one `@`, local part `[A-Za-z0-9._-]` (no leading/trailing/double dot, ≤64), no spaces/quotes; compared ASCII-case-insensitively (Kelvin sign U+212A is **not** folded to "k"); stored lowercase', 'EMAIL_INVALID', '`users_email_lower_chk`, `users_student_rules_chk`'],
    ['email', 'domain must be exactly `sdu.edu.kz` (rejects `sdu.edu.kz.evil.com`, `sdu-edu.kz`, `xsdu.edu.kz`, `a@mail.sdu.edu.kz`, other providers)', 'EMAIL_DOMAIN_NOT_SDU', '`users_student_rules_chk` (`~ …@sdu\\.edu\\.kz$`)'],
    ['email', 'unique (case-insensitive)', 'EMAIL_TAKEN', '`users_email_uq` UNIQUE + `email = lower(email)` check'],
    ['email', 'DNS MX lookup via DoH (skipped gracefully when offline)', 'EMAIL_DOMAIN_NO_MX', '—'],
    ['phone', 'required; `+7 (7XX) XXX-XX-XX` mask or `+77XXXXXXXXX`; exactly 10 digits after +7; stored normalised `+77XXXXXXXXX`', 'PHONE_INVALID', '`users_phone_format_chk` (`~ ^\\+77[0-9]{9}$`)'],
    ['phone', 'unique', 'PHONE_TAKEN', '`users_phone_uq` UNIQUE'],
    ['city', 'one of 23 Kazakhstan cities or `other` (stored as stable key)', 'CITY_INVALID', '`sp_city_key_chk`'],
    ['cityOther', 'required when city=`other`; letters (Latin/Cyrillic), single spaces/hyphens, 2–60; ignored otherwise', 'CITY_OTHER_INVALID', '`sp_city_other_chk` (`(city_key=\'other\') = (city_other IS NOT NULL)`)'],
    ['major', 'one of 19 SDU programme keys', 'MAJOR_INVALID', '`sp_major_chk`'],
    ['yearOfStudy', '`1 2 3 4 m1 m2`', 'YEAR_INVALID', '`sp_year_chk`'],
    ['gpa', 'string/number `d` or `d.dd`: digits + one dot (comma→dot); blocks `e + -` letters; `-0`, `1e2` rejected; stored `NUMERIC(3,2)`', 'GPA_INVALID', '`sp_gpa_chk`, `numeric(3,2)`'],
    ['gpa', '0.00 ≤ GPA ≤ 4.00 (4.01 rejected)', 'GPA_OUT_OF_RANGE', '`sp_gpa_chk` (`gpa >= 0 AND gpa <= 4`)'],
    ['gpa', 'max 2 decimals (3.999 rejected)', 'GPA_TOO_MANY_DECIMALS', '`numeric(3,2)`'],
    ['graduation', '`YYYY-MM` (month+year picker)', 'GRADUATION_INVALID', '`sp_grad_chk` (day = 1)'],
    ['graduation', 'must be a later month than now (Asia/Almaty)', 'GRADUATION_PAST', '—'],
    ['graduation', 'at most 72 months ahead', 'GRADUATION_TOO_FAR', '—'],
    ['graduation', 'consistent with year of study: allowed window = [max(1,(R−1)·12), (R+1)·12] months, R = remaining years (1st→4, 2nd→3, 3rd→2, 4th→1, M1→2, M2→1)', 'GRADUATION_INCONSISTENT', '—'],
    ['interestArea', 'one of 12 keys', 'INTEREST_INVALID', '`sp_interest_chk`'],
    ['relocation', '`yes` / `no` / `remote`', 'RELOCATION_INVALID', '`sp_relocation_chk`'],
    ['password', 'min 8', 'PASSWORD_TOO_SHORT', 'only a PBKDF2 hash is stored (`password_hash`)'],
    ['password', 'max 64 (checked first, so 10 000-char input is cheap)', 'PASSWORD_TOO_LONG', '—'],
    ['password', 'no whitespace', 'PASSWORD_HAS_SPACE', '—'],
    ['password', 'printable ASCII only', 'PASSWORD_INVALID_CHARS', '—'],
    ['password', '≥1 uppercase', 'PASSWORD_NO_UPPER', '—'],
    ['password', '≥1 lowercase', 'PASSWORD_NO_LOWER', '—'],
    ['password', '≥1 digit', 'PASSWORD_NO_DIGIT', '—'],
    ['password', '≥1 special symbol', 'PASSWORD_NO_SPECIAL', '—'],
    ['password', 'must not contain Student ID, name, surname or e-mail local part (≥3 chars, case-insensitive)', 'PASSWORD_CONTAINS_PERSONAL', '—'],
    ['password', 'not in top-1000 common passwords (also catches `Password1!`, `P@ssw0rd!` via suffix-stripping + leet normalisation)', 'PASSWORD_COMMON', '—'],
    ['confirmPassword', 'exact match; re-checked whenever the first field changes', 'PASSWORD_MISMATCH', '—'],
    ['acceptTerms', 'must be literally `true`', 'TERMS_REQUIRED', '—'],
    ['language', '`en` / `ru` / `kk`', 'LANGUAGE_INVALID', '`users_language_chk`'],
  ]],
  ['Employer registration / company profile', [
    ['companyName', '2–100 chars; letters, digits, space and `. , & \' " « » ( ) - + / #`; no `<>`', 'COMPANY_NAME_INVALID', '`ep_company_chk`'],
    ['companyName', 'max 100', 'COMPANY_NAME_TOO_LONG', '`ep_company_chk`'],
    ['bin', 'exactly 12 ASCII digits', 'BIN_INVALID', '`ep_bin_chk`'],
    ['bin', 'unique (race-safe)', 'BIN_TAKEN', '`employer_bin_uq` UNIQUE'],
    ['industry', 'one of 16 keys', 'INDUSTRY_INVALID', '`ep_industry_chk`'],
    ['size', '`s1_10 s11_50 s51_200 s201_1000 s1000_plus`', 'SIZE_INVALID', '`ep_size_chk`'],
    ['contactName / contactSurname', 'same rules as student names', 'NAME_INVALID_CHARS', '`ep_contact_name_chk`, `ep_contact_surname_chk`'],
    ['position', '2–80 chars; letters, digits, space, `. , & \' / ( ) -`', 'POSITION_INVALID', '`ep_position_chk`'],
    ['position', 'max 80', 'POSITION_TOO_LONG', '`ep_position_chk`'],
    ['email (work)', 'free providers rejected (gmail, mail.ru, yandex.*, yahoo.*, outlook, hotmail, icloud, bk/inbox/list.ru …)', 'EMAIL_NOT_CORPORATE', '—'],
    ['email (work)', 'disposable / temp-mail domains rejected', 'EMAIL_DISPOSABLE', '—'],
    ['email (work)', '`sdu.edu.kz` and subdomains rejected (student domain)', 'EMAIL_DOMAIN_NOT_ALLOWED', '—'],
    ['phone', 'same as student', 'PHONE_INVALID', '`users_phone_format_chk`'],
    ['website', 'optional; http(s) URL, ASCII only (IDN look-alikes rejected), dotted host, no credentials, ≤200', 'WEBSITE_INVALID', '`ep_website_chk`'],
    ['description', 'optional; ≤500 code points; control/zero-width chars stripped; always rendered escaped', 'DESCRIPTION_TOO_LONG', '`ep_description_chk`'],
  ]],
  ['Skills / interests (profile)', [
    ['skills[]', 'each 2–40 chars: letters, digits, space, `. + # & / -`; deduped case-insensitively', 'TAG_INVALID', '`skills_name_chk`, `skills_name_key_uq`'],
    ['skills[]', 'max 30 per student', 'TAGS_TOO_MANY', '`student_skills_max` trigger'],
    ['interests[]', 'max 10, same tag rules', 'INTERESTS_TOO_MANY', '`sp_interests_chk` (`cardinality ≤ 10`)'],
  ]],
  ['CV upload, vacancies, applications (phases 2–6)', [
    ['cv file', 'multipart field `file`; present and non-empty', 'CV_MISSING_FILE', '—'],
    ['cv file', '≤ 2 MiB (request body hard-capped at 3 MiB)', 'CV_TOO_LARGE', '`cvs_size_chk`'],
    ['cv file', 'real PDF or DOCX decided by **magic bytes**, extension must agree, name sanitised (no path/control chars)', 'CV_TYPE_INVALID', '`cvs_mime_chk`, `cvs_filename_chk`'],
    ['cv file', 'parses (PDF ≤ 30 pages; DOCX inflated ≤ 8 MiB — zip-bomb guard)', 'CV_UNREADABLE', '—'],
    ['cv file', 'contains extractable text (scanned images rejected)', 'CV_EMPTY_TEXT', '`cvs_text_chk`'],
    ['cv', 'no CV stored', 'CV_NOT_FOUND', '—'],
    ['title (vacancy)', '3–120 chars; letters, digits, space, `. , & \' ( ) / # + : ! –`', 'VACANCY_TITLE_INVALID', '`vac_title_chk`'],
    ['description (vacancy)', 'min 20 chars', 'VACANCY_DESCRIPTION_INVALID', '`vac_desc_chk`'],
    ['description (vacancy)', 'max 4000 chars', 'VACANCY_DESCRIPTION_TOO_LONG', '`vac_desc_chk`'],
    ['kind', '`internship` / `full_time` / `part_time`', 'VACANCY_KIND_INVALID', '`vac_kind_chk`'],
    ['workFormat', '`onsite` / `hybrid` / `remote`', 'WORK_FORMAT_INVALID', '`vac_format_chk`'],
    ['requiredSkills', '≥ 1 skill', 'VACANCY_SKILLS_REQUIRED', '—'],
    ['requiredSkills', '≤ 15 skills (2–40 chars each, deduped)', 'VACANCY_SKILLS_TOO_MANY', '`vacancy_skills_max` trigger'],
    ['minGpa', 'optional; same rules as GPA (0.00–4.00)', 'GPA_OUT_OF_RANGE', '`vac_gpa_chk`'],
    ['deadline', 'optional real date `YYYY-MM-DD`, ≤ 1 year ahead', 'DEADLINE_INVALID', '—'],
    ['deadline', 'not in the past (Asia/Almaty)', 'DEADLINE_PAST', '—'],
    ['coverNote', 'optional, ≤ 1000 chars (stored raw, always rendered escaped)', 'COVER_NOTE_TOO_LONG', '`applications_note_chk`'],
    ['status (employer)', '`viewed shortlisted interview accepted rejected` only', 'STATUS_INVALID', '`applications_status_chk`'],
    ['status transition', 'withdrawn applications cannot be changed', 'INVALID_TRANSITION', '—'],
    ['publish', 'only **approved** (active) employers may publish', 'EMPLOYER_NOT_APPROVED', '`users_status_chk`'],
    ['apply', 'vacancy closed or deadline passed', 'VACANCY_CLOSED', '`vac_status_chk`'],
    ['apply', 'one active application per student and vacancy (race-safe)', 'ALREADY_APPLIED', '`applications_once_uq` UNIQUE'],
    ['delete vacancy', 'vacancies with applications cannot be deleted', 'VACANCY_HAS_APPLICATIONS', '`applications.vacancy_id` FK'],
    ['salaryMin / salaryMax', 'optional whole KZT/month, 1–100 000 000', 'SALARY_INVALID', '`vac_salary_chk`'],
    ['salaryMax', 'must be ≥ salaryMin', 'SALARY_RANGE_INVALID', '`vac_salary_chk`'],
    ['transcript (portal import)', 'pasted text or PDF/TXT must contain recognisable course lines (code, name, credits, grade)', 'TRANSCRIPT_INVALID', '`resumes_courses_chk` (≤ 80 courses)'],
    ['transcript (portal import)', 'empty text / missing file', 'TRANSCRIPT_EMPTY', '—'],
    ['résumé about', '1–1000 chars, plain text', 'RESUME_ABOUT_TOO_LONG', '`resumes_about_chk`'],
    ['résumé', 'none imported yet', 'RESUME_NOT_FOUND', '—'],
    ['invite', 'one invitation per student and vacancy; 20 per day', 'ALREADY_INVITED', '`invitations` PK'],
    ['invite', 'rate limit', 'INVITE_LIMIT', '`rate_limits`'],
    ['invite', 'unknown / inactive student', 'STUDENT_NOT_FOUND', '—'],
    ['search', 'any invalid `industry/kind/format/city/sort/page/q` (q ≤ 60) is rejected, never ignored', 'SEARCH_INVALID', '—'],
  ]],
  ['Authentication, verification and transport', [
    ['role / identifier', 'student → 9-digit ID; employer → valid e-mail; unknown role rejected', 'IDENTIFIER_INVALID / ROLE_INVALID', '—'],
    ['login', 'generic error for unknown ID **and** wrong password (same body, same timing work)', 'INVALID_CREDENTIALS', '—'],
    ['login', '5 failures → locked 15 min, also for non-existent IDs; correct password does not unlock early', 'ACCOUNT_LOCKED', '`users.failed_login_count`, `users.locked_until`'],
    ['login', 'unverified account cannot sign in (offers a new code)', 'EMAIL_NOT_VERIFIED', '`users_status_chk`'],
    ['login', 'blocked account', 'ACCOUNT_BLOCKED', '`users_status_chk`'],
    ['code', '6 ASCII digits', 'CODE_FORMAT_INVALID', '—'],
    ['code', 'wrong code', 'CODE_INVALID', '`email_verifications.code_hash` (HMAC, never plaintext)'],
    ['code', 'expires after 10 min', 'CODE_EXPIRED', '`email_verifications.expires_at`'],
    ['code', 'max 5 attempts per code, single use', 'CODE_TOO_MANY_ATTEMPTS', '`email_verifications.attempts`, `consumed_at`'],
    ['resend', '60 s cooldown', 'RESEND_COOLDOWN', '—'],
    ['resend', 'max 5 sends / hour; resend invalidates old codes', 'RESEND_LIMIT', '—'],
    ['any JSON', 'unknown / extra fields (mass assignment: role, status, id …) rejected', 'UNKNOWN_FIELDS', '—'],
    ['any JSON', 'malformed JSON', 'INVALID_JSON', '—'],
    ['any JSON', 'body > 64 KiB', 'PAYLOAD_TOO_LARGE', '—'],
    ['any JSON', 'content-type must be application/json', 'UNSUPPORTED_MEDIA_TYPE', '—'],
    ['any write', 'double-submit CSRF token (+ Origin check)', 'CSRF_INVALID', '—'],
    ['any', 'per-IP rate limits (register 10/h, login 30/15 min, forgot 10/h, verify 30/10 min …)', 'RATE_LIMITED', '`rate_limits`'],
    ['session', 'no/expired session', 'UNAUTHORIZED', '`sessions.expires_at`'],
    ['role guard', 'wrong role for the endpoint', 'FORBIDDEN', '—'],
  ]],
];

let out = `# VALIDATION — field rules, error codes, DB constraints, translations

> Generated by \`npx tsx scripts/gen-validation-md.ts\` from the real locale files — do not edit by hand.

**How to read it.** The backend returns *only* machine-readable codes (\`{"error":{"code":"VALIDATION_FAILED","fields":{"studentId":"STUDENT_ID_INVALID"}}}\`).
The **frontend error key** is \`errors:<CODE>\` in the i18n files (\`frontend/src/locales/{en,ru,kk}/errors.json\`); the same shared validators
(\`shared/src/validators.ts\`) run in the browser (UX) and on the server (authority). Every rule is also enforced by a PostgreSQL constraint where it can be expressed in SQL.
\`scripts/check-i18n.ts\` (also run by vitest) fails if any code, option or key is missing in any of EN / RU / KZ.

`;
for (const [title, list] of rows) {
  out += `## ${title}\n\n| Field | Rule | Backend code | Frontend key | DB constraint | EN | RU | KZ |\n|---|---|---|---|---|---|---|---|\n`;
  for (const [field, rule, code, db] of list) {
    const first = code.split(' / ')[0];
    const codes = code.split(' / ');
    out += `| \`${field}\` | ${esc(rule)} | ${codes.map((c) => `\`${c}\``).join(', ')} | ${codes.map((c) => `\`errors:${c}\``).join(', ')} | ${esc(db)} | ${esc(msg('en', first))} | ${esc(msg('ru', first))} | ${esc(msg('kk', first))} |\n`;
  }
  out += '\n';
}
writeFileSync(fileURLToPath(new URL('../VALIDATION.md', import.meta.url)), out + readFileSync(fileURLToPath(new URL('./validation-tests.md', import.meta.url)), 'utf8'));
console.log('VALIDATION.md written');
