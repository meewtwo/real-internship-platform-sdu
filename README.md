# SDU Career Match — all phases (1–6)

Smart Internship & Career Matching Platform (SDU project #8). Everything is persisted in SQLite (Cloudflare D1 in production) and validated on both sides.

| Phase | User stories | What it does |
|---|---|---|
| 1 | US-1/2/3 | Registration (student / employer), e-mail code verification, login with lockout, password recovery, student + company profiles, EN/RU/KZ |
| 2 | US-4/5 | **CV upload** (PDF/DOCX, real-type check, text → skills + experience extraction); employers create, edit, publish, close vacancies with required skills |
| 3 | US-6/7 | **Match %** student ↔ vacancy with an explanation (matched / missing skills, 4 sub-scores); keyword search + industry / type / format / city filters, sort, pagination |
| 4 | US-8/9 | **Recommendations**, skill gaps with learning resources; **one-click apply** and status tracking (applied → viewed → shortlisted → interview → accepted/rejected, withdraw) |
| 5 | US-10/11 | Employer **candidate ranking by match %** (per vacancy and across all vacancies), CV download for applicants; **notifications** (new application, status change, new match, employer approved) with a bell + unread count |
| + | extras | **hh-style redesign** on the official SDU palette/assets; public landing page; salary on vacancies (filter + sort); favourites; **"what if I learn X"** simulator; **résumé auto-built from SDU courses** (portal import) with print/PDF; **talent pool + invitations** for employers; animations (respect `prefers-reduced-motion`) |
| 6 | US-12 | Admin **analytics** (users, vacancies, applications, matches, 30-day activity, top skills wanted/held, funnel) and employer **approval UI** |

* Frontend: React 19 + TypeScript + Vite + Tailwind 4, react-i18next (EN / RU / KZ), react-hook-form + zod
* Backend: **Hono on Cloudflare Workers** (also runs on plain Node), zod, **SQLite / Cloudflare D1** (`database/d1/*.sql` — the same files for local dev, tests and production)
* Shared: `shared/` — validators, zod schemas, error codes and dropdown keys used by **both** sides
* Tests: vitest (validators, API against a real SQLite file, i18n completeness) + Playwright (e2e, no-scroll matrix) + `scripts/smoke.ts` (end-to-end journey against a running Worker / D1)

## Quick start (3 commands)

```bash
npm install
npm run db:up && npm run db:migrate && npm run db:seed   # Mailpit in Docker, SQLite schema (backend/.data/dev.sqlite), demo data
npm run dev                                              # API :8787 + web http://localhost:5173
```

* Verification e-mails appear in **Mailpit** at <http://localhost:8025> **and** the code is printed in the API log (`[mail] register code for …`).
* Everything in one container: `docker compose up --build` → <http://localhost:8787> (Mailpit on :8025, demo data seeded).
* Offline? MX lookups are skipped gracefully. No Docker? Skip `db:up`; the dev server writes codes to its log. The database is a plain file (`SQLITE_PATH`, default `backend/.data/dev.sqlite`) — nothing to install.

### Demo accounts (created by `npm run db:seed`)

| Role | Sign in with | Password | Status |
|---|---|---|---|
| Admin | **Employer tab** → `admin@careermatch.kz` | `ADMIN_PASSWORD` from `backend/.env` (default `Cm!Root2026#Safe` if unset) | active |
| Employer | `hr@kaspi-demo.kz` | `Demo!Pass2026a` | active |
| Employer | `talent@epam-demo.kz` | `Demo!Pass2026a` | active |
| Employer | `pending@startup-demo.kz` | `Demo!Pass2026a` | **pending** (awaiting admin) |
| Student | ID `230107001` | `Demo!Pass2026a` | active |
| Student | ID `230107002` | `Demo!Pass2026a` | active |
| Student | ID `230107003` | `Demo!Pass2026a` | active |

The admin exists **only** through the seed script — registration cannot create one (extra/`role` fields are rejected).
Review companies in the UI: sign in as admin on the **Employer** tab → **Companies** (`/admin/companies`, tabs Pending / Approved / Rejected; analytics are under **Analytics**).
**Approve** activates the account, which unlocks publishing (existing drafts stay drafts). **Reject** takes an optional reason (≤ 500 chars): the employer can still sign in,
sees the reason on *My vacancies* / the dashboard, gets an in-app + e-mail notification, and cannot publish (`EMPLOYER_REJECTED`) until an admin approves it from the Rejected tab.
The same actions exist in the API (`GET /api/admin/employers?status=pending|approved|rejected`, `POST /api/admin/employers/<user-id>/approve`, `POST …/reject` with optional `{ "reason": "…" }`).
The company's review state lives in `employer_profiles.review_status` (+ `rejection_reason`, `reviewed_by`, `reviewed_at`); the employer reads it from `GET /api/profile` → `review`.

## Tests

```bash
npm test                 # vitest: validators, extraction, matching, API tests against a real SQLite file, i18n completeness, React component tests (frontend/test, jsdom)
npm run i18n:check       # fails if any key / error code / dropdown option is missing in EN, RU or KZ
npm run test:e2e         # Playwright: builds the app, starts API + preview, browser tests incl. the no-scroll matrix, the full phase 2-6 flow and an axe WCAG A/AA scan (e2e/a11y.spec.ts) of the public pages in EN/RU/KZ
npm run typecheck
```

The no-scroll matrix (`e2e/no-scroll.spec.ts`) asserts `document.scrollingElement.scrollHeight <= innerHeight` (and no horizontal overflow, no
clipped error text) for the **register** pages (student and employer, every wizard step) at 1920×1080, 1366×768, 1280×720, 1024×768, 1024×700,
768×1024, 390×844 and 360×640 in EN, RU and KZ — both empty **and with an invalid value typed into every field so all error messages are visible**.

## Deploying to Cloudflare (one Worker = API + frontend)

The Worker serves `/api/*` itself and the built React app as static assets from the **same origin** (no CORS; `__Host-` session cookie works).

```bash
npx wrangler login
# 1. database (once): D1 is created and bound in backend/wrangler.toml ([[d1_databases]])
npx wrangler d1 create sdu-career-match            # paste the database_id into backend/wrangler.toml
npx wrangler d1 migrations apply sdu-career-match --remote   # applies database/d1/*.sql (same files as local dev and tests)

# 2. the admin account (demo users are never created in production)
cd backend && ENVIRONMENT=production ADMIN_PASSWORD='<new strong password>' npx tsx src/cli/seed.ts --sql /tmp/seed.sql
npx wrangler d1 execute sdu-career-match --remote --file /tmp/seed.sql && rm /tmp/seed.sql

# 3. secrets + deploy
npx wrangler secret put APP_SECRET        # ≥32 random chars (HMAC key for verification codes)
npx wrangler secret put RESEND_API_KEY    # transactional e-mail (https://resend.com), verify your sending domain
npx wrangler secret put DEEPSEEK_API_KEY  # optional: AI features
# set APP_URL / MAIL_FROM in wrangler.toml [vars], then:
cd .. && npm run deploy                   # builds the frontend, then `wrangler deploy`
npx tsx scripts/smoke.ts https://<your-worker>.workers.dev --remote   # optional journey test (needs ENVIRONMENT=test, so use it locally)
```

Then add your custom domain in the Cloudflare dashboard (Workers → your worker → Domains & Routes). Notes:

* `public/_headers` (CSP, HSTS, X-Frame-Options …) is applied by Workers Assets; API responses set their own security headers.
* The Worker is verified end to end with `wrangler dev --local` (miniflare's real D1 engine) via `scripts/smoke.ts` — 34 journey steps — plus the unit/API suites on SQLite and the Playwright suite.
* **D1 has no interactive transactions or row locks**, so every guard lives INSIDE one statement (`INSERT … SELECT … WHERE count < n`, `UPDATE … WHERE version = ?`, compare-and-set claims) and multi-step writes use `db.batch([...])` (atomic, no reads in between). Rate limits are one UPSERT; the client IP comes from `CF-Connecting-IP`.
* D1 limits worth knowing: 2 MB per row (so without R2 the CV upload cap is 1 MB), 100 bound parameters and 100 KB SQL per statement, 10 GB per database (free: 500 MB).
* SQLite has no regex operator and only ASCII case-folding: shape rules use `GLOB`/`LIKE` (the API validators remain the source of truth) and Cyrillic-safe search uses `title_lc` / `description_lc` / `company_lc` / `skills.name_key`, which the application fills.

## Extra API (all JSON, CSRF + session cookie like the rest)

| Endpoint | Who | What |
|---|---|---|
| `GET/POST /api/saved-searches`, `DELETE /api/saved-searches/:id` | student | Save up to 10 search filters (`q, industry, kind, format, city, salaryFrom, withSalary`). When an employer **publishes** a vacancy that matches, the student gets one `saved_search` notification (never twice per vacancy, and not on top of a `new_match` for the same vacancy). |
| `GET /api/vacancies/:id/insights` | owner employer | Unique viewers (one per student per day) + 30-day trend, applications by status, view→apply conversion, average match, match-pool size, and the requirements applicants lack most often. |
| `GET /api/vacancies/:id/similar` | student, employer | Top-5 similar published vacancies (skills incl. related skills, text, industry, kind) with similarity % and, for students, their match %. |
| `GET /api/profile/export` | any signed-in user | Data-portability JSON download (no password hash/tokens; employers get applicant *counts* only). 5/hour. |
| `DELETE /api/profile` `{ password }` | student, employer | Right to erasure: needs the current password, 5 attempts/hour, cascades all owned data and ends the session. Admin accounts cannot be deleted via the API. |
| `GET /api/admin/audit?limit&before&action` | admin | Append-only audit trail (employer approve/reject, vacancy publish/close/delete, application status changes, account export/delete), newest first, cursor pagination. |
| `GET /api/health/ready` | anyone | Readiness probe: `200 {ok:true}` if the database answers, else `503`. Every API response carries `X-Request-Id` (also in error logs). |

**Related-skill matching.** `shared/src/skillGraph.ts` gives partial credit for related skills (Vue.js → React 0.5, PostgreSQL → SQL 0.85, …). Credit is always < 1, so a related skill is still listed as *missing* and in learning recommendations; the response adds `match.partialSkills: [{ skill, via, credit }]` to explain the score.

Run `npm run db:migrate` after pulling: migration `006` adds `saved_searches`, `saved_search_hits`, `vacancy_views`, `audit_log` (immutable except for the "actor erased" `SET NULL`). The UI for these endpoints is not built yet; they are API-only for now.

## AI, résumé builder, notifications and integrations

After pulling run **`npm run db:migrate`** (the schema is one SQLite/D1 migration, `database/d1/0001_schema.sql`; the local file `backend/.data/dev.sqlite` is also created automatically when the dev server starts). Every integration below is **optional and off by default**; without its secret the app keeps working with a rule-based or in-database fallback.

| Feature | Where | Needs |
|---|---|---|
| **AI Studio** (CV analysis, cover letter, interview practice, "explain my match", vacancy autofill) | `/ai`, vacancy pages, new-vacancy form; API `/api/ai/*` | `DEEPSEEK_API_KEY` (any OpenAI-compatible API via `AI_BASE_URL`/`AI_MODEL`). Per-user **consent**, PII redaction, prompt-injection fencing, strict output validation, cache, daily budgets (`AI_USER_DAILY`, `AI_DAILY_BUDGET`). Every feature has a rule-based fallback except interview feedback and résumé rewrite. |
| **Résumé builder** (3 templates, EN/RU/KZ, autosave with conflict detection, version history, DOCX/PDF export, public unlisted link, rule-based review score, AI bullet rewrite + tailoring to a vacancy) | `/resume/builder`, public `/r/:slug`; API `/api/resume-docs` | none (AI parts need the key above) |
| **E-mail**: instant mails (status, invitation, new applicant, message, interview), weekly digest, one-click unsubscribe | Profile → notifications; API `/api/email/*` | `RESEND_API_KEY` + `APP_URL`; Cloudflare **Cron Triggers** (in `wrangler.toml`) or `npm run digest` / admin `POST /api/admin/digest/run` |
| **Telegram bot** (link by one-time token, notifications, `/matches`, `/stop`) | Profile → Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, then admin `POST /api/admin/telegram/webhook` once |
| **Semantic matching** (multilingual embeddings, int8-quantised, no pgvector) | automatic when configured; admin `POST /api/admin/embeddings/backfill` | Workers AI binding (`[ai]` in `wrangler.toml`) or `EMBED_BASE_URL`+`EMBED_API_KEY` |
| **Chat + interview scheduling** (propose → accept/decline, conflict detection, `.ics`) | `/messages` | none |
| **Sentry** error reporting (no bodies/cookies/IPs/ids) | automatic | `SENTRY_DSN` |
| **Turnstile captcha** on register/login/recovery | automatic | `TURNSTILE_SECRET` + `TURNSTILE_SITEKEY` |
| **R2** for CV files | automatic | `[[r2_buckets]] CV_BUCKET` (see `wrangler.toml`) |
| **Queues** for matching on publish | automatic | `[[queues.*]] JOBS` (see `wrangler.toml`) |

Privacy notes: AI features send redacted text to a third-party provider only after the user opts in (revocable in AI Studio); the public résumé link hides e-mail/phone unless allowed; the whole account can be exported or erased from the profile page.

## Project layout

```
shared/      validators, zod schemas, error codes, option keys (used by frontend AND backend)
backend/     Hono app: routes/{auth,profile,admin}.ts, services/{codes,sessions,users}.ts, lib/*, worker.ts (Cloudflare) / node.ts (local)
frontend/    React app: pages/, components/, lib/, locales/{en,ru,kk}/{common,auth,errors,options,profile}.json
database/    migrations/*.sql (schema + CHECK constraints, skills vocabulary)
e2e/         Playwright specs        scripts/   i18n check, VALIDATION.md generator
```

## Brand assets and the SDU portal

* Logo/emblem (vector `safari-pinned-tab.svg`), the 30th-anniversary mark and the graduate / campus photos in `frontend/public/brand/` are taken from **sdu.edu.kz** (the university's own site and admission banners). They are SDU's trademarks/photos — fine for this university project; ask SDU's PR office before public use. Photos of staff were deliberately not used.
* **Portal import is not a live connection.** (The student-facing transcript tab was removed — the Résumé section opens the Builder; the `/api/resume` endpoints and the Builder's "SDU portal résumé" source still exist.) SDU has no public portal API/SSO, and we never ask for students' portal passwords. Instead the student pastes the transcript from the portal (or uploads its PDF/TXT) and the résumé is built from the passed courses (`shared/src/portal.ts`: line parser, credit-weighted GPA, course → skill rules). A *demo transcript* (per major) exists for presentations and is labelled "Demo data". If SDU IT gives you an OAuth/API, only `routes/resume.ts → build()` needs a new data source.

## How matching works (honest description)

"AI matching" here is an **explainable hybrid scorer, not an LLM/embedding service** (no external API, no cost, deterministic, testable): `shared/src/matching.ts`.
`match % = 55 % skill overlap (profile skills ∪ CV skills vs required skills) + 20 % TF-cosine similarity between profile/CV text and vacancy text + 15 % interest-area ↔ industry fit + 10 % location/relocation`,
multiplied by 0.75 when the student's GPA is below the vacancy minimum. The response always includes the breakdown and the matched / missing skills.
`textSimilarity()` is the single place to swap in an embedding model later. CV extraction (`shared/src/cv.ts`) is heuristic: vocabulary matching with aliases and date-range experience estimation.
Publishing a vacancy computes matches for all active students (capped at 5 000), stores those ≥ 60 % and notifies up to 300 of them.

## Assumptions and deliberate deviations (please read)

0. **Workers CPU:** parsing a PDF/DOCX takes tens of milliseconds of CPU — use the Workers *Paid* plan (or move the upload route to Node); the free plan's 10 ms CPU limit can reject it.
   CVs are stored in the database (`BLOB`, ≤ 1 MB on D1 because of the 2 MB row limit) unless an R2 bucket is bound (then ≤ 2 MiB). Course links are a curated catalogue (`courses` table) with a Coursera search fallback.

1. **Cloudflare Workers forced three substitutions** of the suggested stack: *Prisma → plain parameterised SQL with SQL migrations*
   (no string-built SQL anywhere), *argon2/bcrypt → PBKDF2-SHA-256 via WebCrypto* (Workers caps PBKDF2 at 100 000 iterations; native argon2 cannot run there),
   *nodemailer → HTTP e-mail APIs* (Resend in production, Mailpit in development; the code is also logged outside production).
   Express was replaced by Hono (same middleware model). `helmet`/`express-rate-limit` are re-implemented (secure-headers middleware, database fixed-window limiter).
2. Sessions: opaque random token in an `httpOnly; SameSite=Lax; Secure; __Host-` cookie, only its SHA-256 is stored. CSRF: double-submit token + `Origin` check.
3. An unverified registration older than 15 min (longer than the code TTL) may be re-registered by someone else, so nobody can squat a Student ID/e-mail
   forever; a *fresh* unverified account keeps its claim (→ "already registered"), which also makes parallel identical registrations race-safe.
4. Student/employer registration reveals "already registered" (the brief requires clean duplicate errors). Login, recovery and the e-mail-sending endpoints are generic.
5. Graduation window: later month than "now" (Asia/Almaty); max 72 months; relative to the year of study the allowed window is
   `[max(1,(R−1)·12), (R+1)·12]` months where R = remaining years (4th-year → at most 24 months; first-year → 36–60). Adjust `graduationWindow()` if SDU's rules differ.
6. Names are **letters only** exactly as specified (no hyphen/space/apostrophe), one script per name. Compound names ("Anna-Maria") are therefore rejected — easy to relax in `validatePersonName`.
7. Password special-symbol set = any printable ASCII non-alphanumeric; passwords are Latin-only ASCII. "Common password" = top-1000 of SecLists plus suffix-stripping/leet normalisation.
8. Company IIN (stored as `bin`) and e-mail are read-only after registration (identity data). The checksum digit is not verified.
9. Admin signs in on the **Employer** tab (same e-mail login); approvals and analytics are in the app (Phase 6). The demo seed also creates demo students/employers — seed production with care.
10. `ENVIRONMENT=test` exposes `GET /api/__test/outbox` (verification codes for e2e). It returns 404 in every other environment.

## Known limitations

* Verification e-mails in production need a verified sending domain at Resend (or swap `lib/mail.ts` for another HTTP provider).
* Browser autofill is supported through `autocomplete` attributes but is not covered by an automated test.
* Routes are code-split (`React.lazy`) and only the active language's translations are downloaded: the entry chunk is ~330 kB (~105 kB gzip), down from ~715 kB. A route chunk loads on first visit, so a spinner may flash on slow networks.
* Pending employers can log in and edit their profile; "cannot publish vacancies" is enforced when vacancies exist (Phase 2).
* Accessibility was designed in (labels, `aria-invalid`/`aria-describedby`, focus rings, keyboard use, AA contrast) and is machine-checked with axe on the public pages only; signed-in pages are not scanned yet.
* Errors are logged as one JSON line each (`level`, `path`, `ray`, no bodies/cookies); there is no Sentry-style aggregation or alerting configured.
* Scaling notes: rate limits are a database counter (one write per limited request), CVs are `BLOB`s in D1 unless R2 is bound, and publishing a vacancy scores all active students inside the request. All fine at university scale; for thousands of concurrent users move limits to Cloudflare Rate Limiting, CVs to R2 and publish-time matching to a queue.
