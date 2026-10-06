-- SDU Career Match — SQLite / Cloudflare D1 schema (single consolidated migration).
-- Conventions: ids are lower-case UUID text (or INTEGER AUTOINCREMENT for log-like tables); timestamps are ISO-8601 UTC text
-- ('YYYY-MM-DDTHH:MM:SS.sssZ', so they sort and compare correctly as strings); dates are 'YYYY-MM-DD'; booleans are 0/1;
-- arrays/objects are JSON text. SQLite has no regex operator and only ASCII case-folding, so (1) shape rules use GLOB/LIKE and the API
-- validators stay the source of truth, and (2) case-insensitive search uses *_lc / name_key columns that the application fills.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  role               TEXT NOT NULL,
  student_id         TEXT,
  email              TEXT NOT NULL,
  phone              TEXT,
  password_hash      TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'unverified',
  preferred_language TEXT NOT NULL DEFAULT 'en',
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until       TEXT,
  ai_consent_at      TEXT,
  last_digest_at     TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT users_student_id_uq UNIQUE (student_id),
  CONSTRAINT users_email_uq      UNIQUE (email),
  CONSTRAINT users_phone_uq      UNIQUE (phone),
  CONSTRAINT users_role_chk      CHECK (role IN ('student', 'employer', 'admin')),
  CONSTRAINT users_status_chk    CHECK (status IN ('unverified', 'active', 'pending', 'blocked')),
  CONSTRAINT users_language_chk  CHECK (preferred_language IN ('en', 'ru', 'kk')),
  CONSTRAINT users_failed_chk    CHECK (failed_login_count >= 0),
  CONSTRAINT users_email_lower_chk CHECK (email = lower(email) AND length(email) <= 254 AND email NOT LIKE '% %'),
  CONSTRAINT users_student_id_format_chk CHECK (student_id IS NULL OR (length(student_id) = 9 AND student_id NOT GLOB '*[^0-9]*')),
  CONSTRAINT users_phone_format_chk CHECK (phone IS NULL OR (length(phone) = 12 AND phone GLOB '+77[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]')),
  CONSTRAINT users_student_rules_chk CHECK (
    (role = 'student' AND student_id IS NOT NULL AND email LIKE '%@sdu.edu.kz' AND email NOT LIKE '%..%' AND status <> 'pending')
    OR (role <> 'student' AND student_id IS NULL))
);
CREATE TRIGGER users_updated_at AFTER UPDATE ON users FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN UPDATE users SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id; END;

CREATE TABLE student_profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  surname         TEXT NOT NULL,
  city_key        TEXT NOT NULL,
  city_other      TEXT,
  major_key       TEXT NOT NULL,
  year_of_study   TEXT NOT NULL,
  gpa             TEXT NOT NULL,
  graduation_date TEXT NOT NULL,
  interest_area   TEXT NOT NULL,
  relocation      TEXT NOT NULL,
  interests       TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT sp_name_chk    CHECK (length(name) BETWEEN 2 AND 50 AND name = trim(name)),
  CONSTRAINT sp_surname_chk CHECK (length(surname) BETWEEN 2 AND 50 AND surname = trim(surname)),
  CONSTRAINT sp_city_other_chk CHECK ((city_key = 'other') = (city_other IS NOT NULL) AND (city_other IS NULL OR length(city_other) BETWEEN 2 AND 60)),
  CONSTRAINT sp_year_chk    CHECK (year_of_study IN ('1', '2', '3', '4', 'm1', 'm2')),
  CONSTRAINT sp_gpa_chk     CHECK (CAST(gpa AS REAL) >= 0 AND CAST(gpa AS REAL) <= 4),
  CONSTRAINT sp_grad_chk    CHECK (graduation_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-01'),
  CONSTRAINT sp_relocation_chk CHECK (relocation IN ('yes', 'no', 'remote')),
  CONSTRAINT sp_interests_chk CHECK (json_valid(interests) AND json_array_length(interests) <= 10)
);
CREATE TRIGGER student_profiles_updated_at AFTER UPDATE ON student_profiles FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN UPDATE student_profiles SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE user_id = NEW.user_id; END;

CREATE TABLE employer_profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_name    TEXT NOT NULL,
  company_lc      TEXT NOT NULL,
  bin             TEXT NOT NULL,
  industry_key    TEXT NOT NULL,
  size_key        TEXT NOT NULL,
  city_key        TEXT NOT NULL,
  city_other      TEXT,
  contact_name    TEXT NOT NULL,
  contact_surname TEXT NOT NULL,
  position        TEXT NOT NULL,
  website         TEXT,
  description     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT employer_bin_uq UNIQUE (bin),
  CONSTRAINT ep_bin_chk      CHECK (length(bin) = 12 AND bin NOT GLOB '*[^0-9]*'),
  CONSTRAINT ep_company_chk  CHECK (length(company_name) BETWEEN 2 AND 100 AND company_name = trim(company_name)),
  CONSTRAINT ep_size_chk     CHECK (size_key IN ('s1_10', 's11_50', 's51_200', 's201_1000', 's1000_plus')),
  CONSTRAINT ep_city_other_chk CHECK ((city_key = 'other') = (city_other IS NOT NULL) AND (city_other IS NULL OR length(city_other) BETWEEN 2 AND 60)),
  CONSTRAINT ep_position_chk CHECK (length(position) BETWEEN 2 AND 80),
  CONSTRAINT ep_website_chk  CHECK (website IS NULL OR (length(website) <= 200 AND (website LIKE 'http://%' OR website LIKE 'https://%') AND website NOT LIKE '% %')),
  CONSTRAINT ep_description_chk CHECK (description IS NULL OR length(description) <= 500)
);
CREATE TRIGGER employer_profiles_updated_at AFTER UPDATE ON employer_profiles FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN UPDATE employer_profiles SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE user_id = NEW.user_id; END;

CREATE TABLE skills (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  name_key TEXT NOT NULL,
  CONSTRAINT skills_name_chk CHECK (length(name) BETWEEN 2 AND 40 AND name = trim(name)),
  CONSTRAINT skills_name_key_uq UNIQUE (name_key)
);
CREATE TABLE student_skills (
  user_id  TEXT    NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, skill_id)
);
CREATE INDEX student_skills_skill_idx ON student_skills (skill_id);
CREATE TRIGGER student_skills_max BEFORE INSERT ON student_skills FOR EACH ROW
  WHEN (SELECT count(*) FROM student_skills WHERE user_id = NEW.user_id) >= 30
  BEGIN SELECT RAISE(ABORT, 'TAGS_TOO_MANY'); END;

CREATE TABLE email_verifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ev_purpose_chk  CHECK (purpose IN ('register', 'reset')),
  CONSTRAINT ev_attempts_chk CHECK (attempts >= 0)
);
CREATE INDEX email_verifications_lookup_idx ON email_verifications (user_id, purpose, created_at DESC);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  remember   INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE rate_limits (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at TEXT NOT NULL
);
CREATE INDEX rate_limits_reset_idx ON rate_limits (reset_at);

CREATE TABLE cvs (
  user_id          TEXT PRIMARY KEY REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  filename         TEXT NOT NULL,
  mime             TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL,
  content          BLOB,
  storage_key      TEXT,
  text_content     TEXT NOT NULL,
  extracted_skills TEXT NOT NULL DEFAULT '[]',
  experience_years REAL NOT NULL DEFAULT 0,
  experience_items TEXT NOT NULL DEFAULT '[]',
  uploaded_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT cvs_filename_chk CHECK (length(filename) BETWEEN 1 AND 120),
  CONSTRAINT cvs_mime_chk CHECK (mime IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  CONSTRAINT cvs_size_chk CHECK (size_bytes BETWEEN 1 AND 2097152 AND (content IS NULL OR length(content) = size_bytes)),
  CONSTRAINT cvs_storage_chk CHECK (content IS NOT NULL OR storage_key IS NOT NULL),
  CONSTRAINT cvs_text_chk CHECK (length(text_content) BETWEEN 1 AND 200000),
  CONSTRAINT cvs_skills_chk CHECK (json_valid(extracted_skills) AND json_array_length(extracted_skills) <= 60),
  CONSTRAINT cvs_exp_chk CHECK (experience_years >= 0 AND experience_years <= 60)
);

CREATE TABLE vacancies (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  employer_id    TEXT NOT NULL REFERENCES employer_profiles(user_id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  title_lc       TEXT NOT NULL,
  description    TEXT NOT NULL,
  description_lc TEXT NOT NULL,
  kind           TEXT NOT NULL,
  industry_key   TEXT NOT NULL,
  city_key       TEXT NOT NULL,
  city_other     TEXT,
  work_format    TEXT NOT NULL,
  min_gpa        TEXT,
  deadline       TEXT,
  salary_min     INTEGER,
  salary_max     INTEGER,
  status         TEXT NOT NULL DEFAULT 'draft',
  published_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT vac_title_chk  CHECK (length(title) BETWEEN 3 AND 120 AND title = trim(title)),
  CONSTRAINT vac_desc_chk   CHECK (length(description) BETWEEN 20 AND 4000),
  CONSTRAINT vac_kind_chk   CHECK (kind IN ('internship', 'full_time', 'part_time')),
  CONSTRAINT vac_format_chk CHECK (work_format IN ('onsite', 'hybrid', 'remote')),
  CONSTRAINT vac_status_chk CHECK (status IN ('draft', 'published', 'closed')),
  CONSTRAINT vac_gpa_chk    CHECK (min_gpa IS NULL OR (CAST(min_gpa AS REAL) >= 0 AND CAST(min_gpa AS REAL) <= 4)),
  CONSTRAINT vac_city_chk   CHECK ((city_key = 'other') = (city_other IS NOT NULL)),
  CONSTRAINT vac_published_chk CHECK (status = 'draft' OR published_at IS NOT NULL),
  CONSTRAINT vac_salary_chk CHECK (
    (salary_min IS NULL OR salary_min BETWEEN 1 AND 100000000) AND (salary_max IS NULL OR salary_max BETWEEN 1 AND 100000000)
    AND (salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max))
);
CREATE INDEX vacancies_status_idx ON vacancies (status, published_at DESC);
CREATE INDEX vacancies_employer_idx ON vacancies (employer_id, created_at DESC);
CREATE TRIGGER vacancies_updated_at AFTER UPDATE ON vacancies FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN UPDATE vacancies SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id; END;

CREATE TABLE vacancy_skills (
  vacancy_id TEXT    NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  skill_id   INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (vacancy_id, skill_id)
);
CREATE INDEX vacancy_skills_skill_idx ON vacancy_skills (skill_id);
CREATE TRIGGER vacancy_skills_max BEFORE INSERT ON vacancy_skills FOR EACH ROW
  WHEN (SELECT count(*) FROM vacancy_skills WHERE vacancy_id = NEW.vacancy_id) >= 15
  BEGIN SELECT RAISE(ABORT, 'VACANCY_SKILLS_TOO_MANY'); END;

CREATE TABLE matches (
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  percent    INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (vacancy_id, student_id),
  CONSTRAINT matches_percent_chk CHECK (percent BETWEEN 0 AND 100)
);
CREATE INDEX matches_student_idx ON matches (student_id, percent DESC);
CREATE INDEX matches_created_idx ON matches (created_at);

CREATE TABLE applications (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  vacancy_id    TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'applied',
  match_percent INTEGER NOT NULL,
  cover_note    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT applications_once_uq UNIQUE (vacancy_id, student_id),
  CONSTRAINT applications_status_chk CHECK (status IN ('applied', 'viewed', 'shortlisted', 'interview', 'accepted', 'rejected', 'withdrawn')),
  CONSTRAINT applications_percent_chk CHECK (match_percent BETWEEN 0 AND 100),
  CONSTRAINT applications_note_chk CHECK (cover_note IS NULL OR length(cover_note) <= 1000)
);
CREATE INDEX applications_student_idx ON applications (student_id, created_at DESC);
CREATE INDEX applications_vacancy_idx ON applications (vacancy_id, match_percent DESC);
CREATE TRIGGER applications_updated_at AFTER UPDATE ON applications FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN UPDATE applications SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id; END;

CREATE TABLE application_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  status         TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX application_events_idx ON application_events (application_id, id);

CREATE TABLE notifications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,
  params           TEXT NOT NULL DEFAULT '{}',
  link             TEXT,
  read_at          TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  emailed_at       TEXT,
  email_attempts   INTEGER NOT NULL DEFAULT 0,
  email_claimed_at TEXT,
  tg_sent_at       TEXT,
  tg_attempts      INTEGER NOT NULL DEFAULT 0,
  tg_claimed_at    TEXT,
  CONSTRAINT notifications_kind_chk CHECK (kind IN ('new_application', 'status_changed', 'new_match', 'employer_approved', 'invitation', 'saved_search', 'new_message', 'interview_update')),
  CONSTRAINT notifications_params_chk CHECK (json_valid(params)),
  CONSTRAINT notifications_link_chk CHECK (link IS NULL OR (link LIKE '/%' AND link NOT GLOB '*[^A-Za-z0-9/_-]*'))
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_unemailed_idx ON notifications (id) WHERE emailed_at IS NULL;
CREATE INDEX notifications_untg_idx ON notifications (id) WHERE tg_sent_at IS NULL;

CREATE TABLE courses (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_key TEXT NOT NULL,
  title     TEXT NOT NULL,
  provider  TEXT NOT NULL,
  url       TEXT NOT NULL,
  free      INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT courses_url_chk CHECK (url LIKE 'https://%' AND url NOT LIKE '% %'),
  CONSTRAINT courses_uq UNIQUE (skill_key, url)
);
CREATE INDEX courses_skill_idx ON courses (skill_key);

CREATE TABLE favorites (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, vacancy_id)
);
CREATE INDEX favorites_user_idx ON favorites (user_id, created_at DESC);

CREATE TABLE resumes (
  user_id         TEXT PRIMARY KEY REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  source          TEXT NOT NULL,
  about           TEXT NOT NULL,
  courses         TEXT NOT NULL DEFAULT '[]',
  inferred_skills TEXT NOT NULL DEFAULT '[]',
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT resumes_source_chk CHECK (source IN ('portal_demo', 'portal_transcript')),
  CONSTRAINT resumes_about_chk CHECK (length(about) BETWEEN 1 AND 1000),
  CONSTRAINT resumes_courses_chk CHECK (json_valid(courses) AND json_array_length(courses) <= 80),
  CONSTRAINT resumes_skills_chk CHECK (json_valid(inferred_skills) AND json_array_length(inferred_skills) <= 30)
);

CREATE TABLE invitations (
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (vacancy_id, student_id)
);

CREATE TABLE saved_searches (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  user_id    TEXT NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  filters    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT saved_searches_name_chk CHECK (length(name) BETWEEN 1 AND 60),
  CONSTRAINT saved_searches_filters_chk CHECK (json_valid(filters) AND json_type(filters) = 'object'),
  CONSTRAINT saved_searches_name_uq UNIQUE (user_id, name)
);
CREATE INDEX saved_searches_user_idx ON saved_searches (user_id, created_at);
CREATE TABLE saved_search_hits (
  search_id  TEXT NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (search_id, vacancy_id)
);

CREATE TABLE vacancy_views (
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  day        TEXT NOT NULL DEFAULT (date('now', '+5 hours')),
  PRIMARY KEY (vacancy_id, student_id, day)
);
CREATE INDEX vacancy_views_day_idx ON vacancy_views (vacancy_id, day);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  meta        TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT audit_action_chk CHECK (length(action) BETWEEN 1 AND 40 AND action NOT GLOB '*[^a-z_.]*'),
  CONSTRAINT audit_meta_chk CHECK (json_valid(meta))
);
CREATE INDEX audit_created_idx ON audit_log (created_at DESC, id DESC);
CREATE INDEX audit_action_idx ON audit_log (action, id DESC);
-- append-only: the ONLY permitted change is the FK action ON DELETE SET NULL (account erasure); every other column is frozen
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW
  WHEN NOT (OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL AND NEW.id = OLD.id AND NEW.actor_role IS OLD.actor_role AND NEW.action = OLD.action
            AND NEW.target_type IS OLD.target_type AND NEW.target_id IS OLD.target_id AND NEW.meta = OLD.meta AND NEW.created_at = OLD.created_at)
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TABLE ai_cache (
  key        TEXT PRIMARY KEY,
  feature    TEXT NOT NULL,
  response   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT ai_cache_response_chk CHECK (json_valid(response))
);
CREATE INDEX ai_cache_created_idx ON ai_cache (created_at);

CREATE TABLE notification_prefs (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_digest  INTEGER NOT NULL DEFAULT 1,
  email_instant INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE telegram_links (
  user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chat_id   INTEGER NOT NULL,
  enabled   INTEGER NOT NULL DEFAULT 1,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT telegram_links_chat_uq UNIQUE (chat_id)
);
CREATE TABLE telegram_link_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE resume_docs (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  user_id        TEXT NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  template       TEXT NOT NULL DEFAULT 'classic',
  language       TEXT NOT NULL DEFAULT 'en',
  data           TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  public_slug    TEXT,
  public_contact INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT resume_docs_title_chk CHECK (length(title) BETWEEN 1 AND 80),
  CONSTRAINT resume_docs_template_chk CHECK (template IN ('classic', 'modern', 'compact')),
  CONSTRAINT resume_docs_lang_chk CHECK (language IN ('en', 'ru', 'kk')),
  CONSTRAINT resume_docs_data_chk CHECK (json_valid(data) AND json_type(data) = 'object' AND length(CAST(data AS BLOB)) <= 60000),
  CONSTRAINT resume_docs_slug_chk CHECK (public_slug IS NULL OR (length(public_slug) BETWEEN 16 AND 64 AND public_slug NOT GLOB '*[^A-Za-z0-9_-]*')),
  CONSTRAINT resume_docs_slug_uq UNIQUE (public_slug)
);
CREATE INDEX resume_docs_user_idx ON resume_docs (user_id, updated_at DESC);
CREATE TRIGGER resume_docs_updated_at AFTER UPDATE ON resume_docs FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN UPDATE resume_docs SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id; END;

CREATE TABLE resume_versions (
  doc_id     TEXT NOT NULL REFERENCES resume_docs(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  template   TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (doc_id, version)
);

CREATE TABLE student_embeddings (
  user_id      TEXT PRIMARY KEY REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  model        TEXT NOT NULL,
  dim          INTEGER NOT NULL,
  vec          BLOB NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT student_embeddings_dim_chk CHECK (dim BETWEEN 1 AND 4096 AND length(vec) = dim)
);
CREATE TABLE vacancy_embeddings (
  vacancy_id   TEXT PRIMARY KEY REFERENCES vacancies(id) ON DELETE CASCADE,
  model        TEXT NOT NULL,
  dim          INTEGER NOT NULL,
  vec          BLOB NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT vacancy_embeddings_dim_chk CHECK (dim BETWEEN 1 AND 4096 AND length(vec) = dim)
);

CREATE TABLE application_messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  sender_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at        TEXT,
  CONSTRAINT application_messages_body_chk CHECK (length(body) BETWEEN 1 AND 2000)
);
CREATE INDEX application_messages_idx ON application_messages (application_id, id);
CREATE INDEX application_messages_unread_idx ON application_messages (application_id, sender_id) WHERE read_at IS NULL;

CREATE TABLE interviews (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  proposed_by    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at      TEXT NOT NULL,
  duration_min   INTEGER NOT NULL,
  format         TEXT NOT NULL,
  location       TEXT NOT NULL,
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'proposed',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT interviews_duration_chk CHECK (duration_min BETWEEN 15 AND 240),
  CONSTRAINT interviews_format_chk CHECK (format IN ('onsite', 'online', 'phone')),
  CONSTRAINT interviews_status_chk CHECK (status IN ('proposed', 'accepted', 'declined', 'cancelled')),
  CONSTRAINT interviews_location_chk CHECK (length(location) BETWEEN 1 AND 200),
  CONSTRAINT interviews_note_chk CHECK (note IS NULL OR length(note) <= 500)
);
CREATE INDEX interviews_app_idx ON interviews (application_id, starts_at);
CREATE UNIQUE INDEX interviews_one_active_uq ON interviews (application_id) WHERE status IN ('proposed', 'accepted');
CREATE TRIGGER interviews_updated_at AFTER UPDATE ON interviews FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN UPDATE interviews SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = NEW.id; END;


-- Reference data -------------------------------------------------------------------------------------------------
INSERT INTO skills (name, name_key) VALUES
  ('JavaScript', 'javascript'),
  ('TypeScript', 'typescript'),
  ('Python', 'python'),
  ('Java', 'java'),
  ('C++', 'c++'),
  ('C#', 'c#'),
  ('Go', 'go'),
  ('Rust', 'rust'),
  ('Kotlin', 'kotlin'),
  ('Swift', 'swift'),
  ('PHP', 'php'),
  ('Ruby', 'ruby'),
  ('SQL', 'sql'),
  ('PostgreSQL', 'postgresql'),
  ('MySQL', 'mysql'),
  ('MongoDB', 'mongodb'),
  ('Redis', 'redis'),
  ('React', 'react'),
  ('Vue.js', 'vue.js'),
  ('Angular', 'angular'),
  ('Node.js', 'node.js'),
  ('Express', 'express'),
  ('Django', 'django'),
  ('Flask', 'flask'),
  ('Spring Boot', 'spring boot'),
  ('Docker', 'docker'),
  ('Kubernetes', 'kubernetes'),
  ('Git', 'git'),
  ('Linux', 'linux'),
  ('AWS', 'aws'),
  ('Azure', 'azure'),
  ('Google Cloud', 'google cloud'),
  ('CI/CD', 'ci/cd'),
  ('REST API', 'rest api'),
  ('GraphQL', 'graphql'),
  ('HTML', 'html'),
  ('CSS', 'css'),
  ('Tailwind CSS', 'tailwind css'),
  ('Figma', 'figma'),
  ('UI/UX Design', 'ui/ux design'),
  ('Machine Learning', 'machine learning'),
  ('Deep Learning', 'deep learning'),
  ('Data Analysis', 'data analysis'),
  ('Pandas', 'pandas'),
  ('NumPy', 'numpy'),
  ('TensorFlow', 'tensorflow'),
  ('PyTorch', 'pytorch'),
  ('Power BI', 'power bi'),
  ('Tableau', 'tableau'),
  ('Excel', 'excel'),
  ('Statistics', 'statistics'),
  ('Cybersecurity', 'cybersecurity'),
  ('Penetration Testing', 'penetration testing'),
  ('Network Security', 'network security'),
  ('Cryptography', 'cryptography'),
  ('Agile', 'agile'),
  ('Scrum', 'scrum'),
  ('Project Management', 'project management'),
  ('Product Management', 'product management'),
  ('Marketing', 'marketing'),
  ('SMM', 'smm'),
  ('SEO', 'seo'),
  ('Copywriting', 'copywriting'),
  ('Content Creation', 'content creation'),
  ('Financial Analysis', 'financial analysis'),
  ('Accounting', 'accounting'),
  ('Banking', 'banking'),
  ('Economics', 'economics'),
  ('Research', 'research'),
  ('Academic Writing', 'academic writing'),
  ('Teaching', 'teaching'),
  ('Public Speaking', 'public speaking'),
  ('Teamwork', 'teamwork'),
  ('Communication', 'communication'),
  ('Leadership', 'leadership'),
  ('Problem Solving', 'problem solving'),
  ('English', 'english'),
  ('Russian', 'russian'),
  ('Kazakh', 'kazakh'),
  ('Turkish', 'turkish'),
  ('Translation', 'translation'),
  ('Law', 'law'),
  ('Contract Law', 'contract law'),
  ('Customer Service', 'customer service'),
  ('Sales', 'sales'),
  ('Management', 'management');

INSERT INTO courses (skill_key, title, provider, url) VALUES
  ('python', 'Python (Kaggle Learn)', 'Kaggle', 'https://www.kaggle.com/learn/python'),
  ('sql', 'Intro to SQL (Kaggle Learn)', 'Kaggle', 'https://www.kaggle.com/learn/intro-to-sql'),
  ('machine learning', 'Intro to Machine Learning (Kaggle Learn)', 'Kaggle', 'https://www.kaggle.com/learn/intro-to-machine-learning'),
  ('deep learning', 'Intro to Deep Learning (Kaggle Learn)', 'Kaggle', 'https://www.kaggle.com/learn/intro-to-deep-learning'),
  ('pandas', 'Pandas (Kaggle Learn)', 'Kaggle', 'https://www.kaggle.com/learn/pandas'),
  ('data analysis', 'Data Visualization (Kaggle Learn)', 'Kaggle', 'https://www.kaggle.com/learn/data-visualization'),
  ('javascript', 'JavaScript guide', 'MDN Web Docs', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide'),
  ('html', 'Learn HTML', 'MDN Web Docs', 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Structuring_content'),
  ('css', 'Learn CSS', 'MDN Web Docs', 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics'),
  ('typescript', 'TypeScript Handbook', 'TypeScript', 'https://www.typescriptlang.org/docs/handbook/intro.html'),
  ('react', 'Learn React', 'React', 'https://react.dev/learn'),
  ('vue.js', 'Vue.js Introduction', 'Vue.js', 'https://vuejs.org/guide/introduction.html'),
  ('node.js', 'Learn Node.js', 'Node.js', 'https://nodejs.org/en/learn'),
  ('git', 'Pro Git book', 'Git', 'https://git-scm.com/book/en/v2'),
  ('docker', 'Docker Get Started', 'Docker', 'https://docs.docker.com/get-started/'),
  ('kubernetes', 'Kubernetes Tutorials', 'Kubernetes', 'https://kubernetes.io/docs/tutorials/'),
  ('linux', 'Linux Journey', 'Linux Journey', 'https://linuxjourney.com/'),
  ('go', 'A Tour of Go', 'Go', 'https://go.dev/tour/'),
  ('rust', 'The Rust Programming Language', 'Rust', 'https://doc.rust-lang.org/book/'),
  ('java', 'Learn Java', 'dev.java', 'https://dev.java/learn/'),
  ('c#', 'Tour of C#', 'Microsoft Learn', 'https://learn.microsoft.com/en-us/dotnet/csharp/tour-of-csharp/'),
  ('kotlin', 'Kotlin Getting Started', 'Kotlin', 'https://kotlinlang.org/docs/getting-started.html'),
  ('postgresql', 'PostgreSQL Tutorial', 'PostgreSQL', 'https://www.postgresql.org/docs/current/tutorial.html'),
  ('mongodb', 'MongoDB University', 'MongoDB', 'https://learn.mongodb.com/'),
  ('aws', 'AWS Skill Builder', 'AWS', 'https://explore.skillbuilder.aws/learn'),
  ('azure', 'Azure training', 'Microsoft Learn', 'https://learn.microsoft.com/en-us/training/azure/'),
  ('google cloud', 'Google Cloud Skills Boost', 'Google Cloud', 'https://www.cloudskillsboost.google/'),
  ('cybersecurity', 'TryHackMe learning paths', 'TryHackMe', 'https://tryhackme.com/'),
  ('penetration testing', 'TryHackMe learning paths', 'TryHackMe', 'https://tryhackme.com/'),
  ('power bi', 'Power BI documentation & learning', 'Microsoft Learn', 'https://learn.microsoft.com/en-us/power-bi/'),
  ('statistics', 'Statistics and probability', 'Khan Academy', 'https://www.khanacademy.org/math/statistics-probability'),
  ('scrum', 'The Scrum Guide', 'Scrum.org', 'https://scrumguides.org/'),
  ('seo', 'SEO Starter Guide', 'Google Search Central', 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide'),
  ('marketing', 'HubSpot Academy', 'HubSpot', 'https://academy.hubspot.com/'),
  ('figma', 'Figma learn design', 'Figma', 'https://help.figma.com/hc/en-us');
