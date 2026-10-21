-- 1) Company review (admin approval) is tracked on the company itself, separately from the login account status:
--    pending (default on registration) → approved | rejected. A rejected employer can still sign in and see the reason;
--    publishing stays blocked until approval (users.status remains 'pending' until then, 'active' after).
ALTER TABLE employer_profiles ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE employer_profiles ADD COLUMN rejection_reason TEXT CHECK (rejection_reason IS NULL OR length(rejection_reason) BETWEEN 1 AND 500);
ALTER TABLE employer_profiles ADD COLUMN reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE employer_profiles ADD COLUMN reviewed_at TEXT;
UPDATE employer_profiles SET review_status = 'approved' WHERE user_id IN (SELECT id FROM users WHERE status = 'active');
UPDATE employer_profiles SET review_status = 'rejected' WHERE user_id IN (SELECT id FROM users WHERE status = 'blocked');
CREATE INDEX employer_profiles_review_idx ON employer_profiles (review_status, created_at);

-- 2) Free-text value when "Other" is chosen in a dropdown (the pairing with the key is enforced by the API validators,
--    so existing 'other' rows stay valid and are asked for the text on their next save).
ALTER TABLE student_profiles ADD COLUMN interest_other TEXT CHECK (interest_other IS NULL OR length(interest_other) BETWEEN 2 AND 100);
ALTER TABLE employer_profiles ADD COLUMN industry_other TEXT CHECK (industry_other IS NULL OR length(industry_other) BETWEEN 2 AND 100);
ALTER TABLE vacancies ADD COLUMN industry_other TEXT CHECK (industry_other IS NULL OR length(industry_other) BETWEEN 2 AND 100);

-- 3) New notification kind 'employer_rejected' (SQLite cannot alter a CHECK constraint: rebuild the table; nothing references it).
CREATE TABLE notifications_new (
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
  CONSTRAINT notifications_kind_chk CHECK (kind IN ('new_application', 'status_changed', 'new_match', 'employer_approved', 'employer_rejected', 'invitation', 'saved_search', 'new_message', 'interview_update')),
  CONSTRAINT notifications_params_chk CHECK (json_valid(params)),
  CONSTRAINT notifications_link_chk CHECK (link IS NULL OR (link LIKE '/%' AND link NOT GLOB '*[^A-Za-z0-9/_-]*'))
);
INSERT INTO notifications_new (id, user_id, kind, params, link, read_at, created_at, emailed_at, email_attempts, email_claimed_at, tg_sent_at, tg_attempts, tg_claimed_at)
  SELECT id, user_id, kind, params, link, read_at, created_at, emailed_at, email_attempts, email_claimed_at, tg_sent_at, tg_attempts, tg_claimed_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_unemailed_idx ON notifications (id) WHERE emailed_at IS NULL;
CREATE INDEX notifications_untg_idx ON notifications (id) WHERE tg_sent_at IS NULL;
