-- Profile pictures: one small (client-side resized, ≤ 150 KB) image per user, stored in the row (R2 is not required).
CREATE TABLE avatars (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  content    BLOB NOT NULL CHECK (length(content) BETWEEN 1 AND 153600),
  updated_at TEXT NOT NULL
);
