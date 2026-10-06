## QA scripts from the team

| # | Script | Automated check(s) | Result |
|---|---|---|---|
| 1 | Valid 9-digit ID + valid name + valid e-mail + matching passwords → account created | e2e `QA: valid ID + name + email + matching passwords → account created, verified by emailed code, persisted in DB`; API `QA: valid data creates an unverified account, password hashed, code emailed` | PASS |
| 2 | ID with letters / not 9 digits → blocked with an error | e2e `QA: letters in Student ID are stripped and a wrong length is blocked…`; API rows `ID with letters`, `ID 8 digits`, `ID 10 digits`, `ID with spaces`, `ID dashes`, `ID Arabic-Indic digits`; unit `Student ID` (20 cases) | PASS |
| 3 | Passwords don't match → blocked with an error | e2e `QA: passwords that do not match block submit; error re-checked when the first field changes`; API row `password mismatch`; unit `QA script: mismatch` | PASS |
| 4 | All fields and errors switch correctly between EN / RU / KZ | e2e `QA: switching language keeps entered values and re-translates visible errors immediately`; `npm run i18n:check`; no-scroll matrix runs every page in all 3 languages | PASS |

## Adversarial inputs → where each is tested

Legend: **U** = `shared/test/validators.test.ts`, **A** = `backend/test/api.test.ts` (real PostgreSQL), **E** = `e2e/*.spec.ts` (real browser).

| Input / attack | Tests | Result |
|---|---|---|
| Empty, whitespace-only, zero-width-only values | U (every validator), A `empty payload reports every required field`, A rows `empty name`, `whitespace name`, `GPA empty` | PASS |
| Very long strings (10 000 chars) | U name/password/ID/e-mail, A `name 10k chars`, API body > 64 KiB → 413 (A `oversized JSON`, E `API rejects … 413`) | PASS |
| Emoji, RTL text, zero-width characters | U `Names`, A rows `name emoji`, `name RTL`, `name zero-width` | PASS |
| Unicode look-alike letters / digits (Cyrillic "А" in Latin names, full-width, Arabic-Indic digits, Kelvin sign in e-mail) | U `Names`, `Student ID`, `SDU email`, A rows `name lookalike mix`, `ID Arabic-Indic digits` | PASS |
| Leading zeros in Student ID (`000123456`) | U `keeps leading zeros (string)`, A `QA: valid data creates…` (stored as `000123456`) | PASS |
| ID with letters / spaces / dashes / 8 or 10 digits / Unicode digits / number type | U, A (6 rows), E `letters in Student ID are stripped…` (typed + pasted-style input) | PASS |
| SQL injection (`' OR 1=1 --`, `'); DROP TABLE users;--`) | A `injection attempts in credentials never authenticate`, `SQL injection strings are stored inertly or rejected; tables survive`, A rows `ID SQLi`, `name SQLi`; every query is parameterised | PASS |
| XSS (`<script>`, `<img onerror>`), HTML in name fields | A rows `name XSS script/img`, `company XSS`, tag XSS; E `student: … XSS stays inert`, E `employer: … description XSS is escaped` (asserts `window.__xss` stays undefined); mail HTML escaping A `verification emails … HTML-escape user data` | PASS |
| E-mail in upper case, with spaces, trailing dot, double `@`, other domain / look-alike domain / sub-domain | U `SDU email` (40 cases), A rows `email …`, E `email domain rules…`, A duplicate test uses upper-cased e-mail | PASS |
| Duplicate ID / e-mail / phone | A `duplicates: ID, email (case-insensitive) and phone → clean 409`, E `duplicate Student ID / email are rejected with clean field errors`, DB constraints A `student id / email / phone / status checks` | PASS |
| Race: two parallel identical registrations | A `race: two parallel identical registrations → exactly one succeeds` (201 + 409), A `race on BIN: one wins` (4 parallel) | PASS |
| Double-clicking submit | A `double-click: 8 parallel identical submits → one account`, E `double-click on submit creates exactly one account (one code email)` | PASS |
| GPA 4.01 / -0 / 1e2 / 3.999 / comma decimal / e,+,- / letters | U `GPA` (28 cases), A rows `GPA …`, E `GPA control blocks e, +, -, letters…`, DB `GPA range and graduation day` | PASS |
| Graduation date in the past / 20 years ahead / inconsistent with year of study | U `Graduation date` (24 cases), A rows `graduation …`, E `graduation date rules…` | PASS |
| Mismatched passwords; password equals ID / name / e-mail; common passwords | U `Password`, `Registration schemas`; A rows `password mismatch`, `password = ID`, `password common`; E QA script 3 | PASS |
| Pasting invalid data, autofill | E (typed/pasted non-digits are stripped; code boxes accept paste); `autocomplete` attributes set on all fields (autofill itself not machine-tested) | PASS / partial |
| Browser Back / Refresh during the wizard (data kept, passwords never stored) | E `wizard draft survives refresh (values + step) but passwords are never stored`; E `refresh keeps the verification screen` | PASS |
| Expired / incorrect / reused verification code; attempts; resend cooldown / hourly cap | A `email verification` (6 tests: reuse, 5 attempts, expiry, format, resend 60 s + 5/h, unverified login), E `wrong code…`, `paste fills all 6 boxes` | PASS |
| Direct API calls with modified payloads / extra fields (mass assignment: role, status, id) | A `mass assignment: role/status/id/extra fields are rejected`, `cannot change Student ID, email, role, status`, `admin cannot be created through registration`, E `API rejects a missing CSRF token and mass-assignment…` | PASS |
| Missing / invalid CSRF token, foreign Origin | A `rejects state-changing requests without CSRF token / with a wrong token / cross-origin`, `profile PUT requires CSRF`, E security test | PASS |
| Oversized JSON body, malformed JSON, wrong content-type | A `oversized JSON → 413, bad JSON → 400, wrong content-type → 415` | PASS |
| Brute force / enumeration | A `lockout after 5 failures…` (existing **and** unknown IDs), `wrong password and unknown account produce identical responses`, `forgot` generic response, rate-limit tests for login and registration | PASS |
| Session hygiene | A `logs in, sets httpOnly cookie, never leaks the hash, logout kills the session`; reset invalidates every session | PASS |
| Constraints bypassing the API (direct SQL) | A `database constraints hold even when the API is bypassed` (4 tests incl. 30-skill trigger) | PASS |

## Layout / i18n / a11y checks

| Check | Test | Result |
|---|---|---|
| Register page (student + employer, every wizard step) fits the viewport: `scrollHeight <= innerHeight`, no horizontal overflow, no clipped error text, **with all error messages visible** — 1920×1080, 1366×768, 1280×720, 1024×768, 1024×700, 768×1024, 390×844, 360×640 × EN/RU/KZ | `e2e/no-scroll.spec.ts` (48 tests) | PASS |
| Login and recovery pages (both roles) fit the same viewports/languages | `e2e/no-scroll.spec.ts` (48 tests) | PASS |
| Every translation key exists in EN/RU/KZ; every API error code and dropdown option is translated; validation messages ≤ 64 chars; placeholders match | `scripts/i18n.test.ts`, `npm run i18n:check` | PASS |
| Create-account / Next buttons disabled until valid; Enter cannot bypass | E `Enter cannot bypass the disabled button…`, `complete 3-step registration at 360x640` | PASS |


## Phases 2–6 (CV, vacancies, matching, applications, notifications, analytics)

| Area | Tests | Result |
|---|---|---|
| Skill/experience extraction (boundaries, aliases, Cyrillic, regex metacharacters, date ranges, education excluded) | `shared/test/phase2.test.ts` (`skill extraction`, `experience extraction`) | PASS |
| Match algorithm (monotonic in skills, CV counts, location, GPA penalty, 0–100 bounds) | `shared/test/phase2.test.ts` (`matching`) | PASS |
| Vacancy / deadline / cover-note / search-query validators (incl. mass assignment) | `shared/test/phase2.test.ts` | PASS |
| CV upload: PDF + DOCX parsed; fake/renamed/corrupt/scanned/oversized files rejected; filename sanitised; role + CSRF guards; apply-skills | `backend/test/phases.test.ts` › `CV upload (US-4)` (14 tests) | PASS |
| Vacancies: pending employers cannot publish, drafts private, ownership, validation, DB constraints | `backend/test/phases.test.ts` › `vacancies (US-5)` | PASS |
| Search & filters, wildcard/SQL-injection-safe keyword, pagination, match explanation, CV improves match, expired deadline | `backend/test/phases.test.ts` › `search, filters and match %` | PASS |
| Apply (one click), 6 parallel applies → 1, withdraw/re-apply, employer ranking, status transitions, CV access control | `backend/test/phases.test.ts` › `applications, ranking, …` | PASS |
| Notifications (new application, status change, new match, employer approved) are per-user | `backend/test/phases.test.ts` | PASS |
| Recommendations + skill gaps + courses (catalogue and search fallback) | `backend/test/phases.test.ts` › `recommendations and skill gaps` | PASS |
| Admin approvals + analytics, role guards | `backend/test/phases.test.ts` › `admin` | PASS |
| Whole flow in a browser (admin approval → vacancy → match % → apply → ranking → status → notifications → analytics), CV upload UI, RU/KZ app pages free of raw keys | `e2e/phases.spec.ts` (3 tests) | PASS |

