-- CVs up to the advertised 2 MB stay in D1. A D1 row is capped at 2,000,000 bytes, so a file that does not fit next to its extracted text in
-- `cvs.content` is split into ≤ 1,000,000-byte parts here; its `cvs` row then has content = NULL and storage_key = 'd1-chunks' (R2 keys start
-- with 'cv/'). Small files keep using `cvs.content` exactly as before. The parts go with the CV (and the account) through ON DELETE CASCADE.
CREATE TABLE cv_chunks (
  user_id TEXT    NOT NULL REFERENCES cvs(user_id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  data    BLOB    NOT NULL,
  PRIMARY KEY (user_id, seq),
  CONSTRAINT cv_chunks_seq_chk  CHECK (seq BETWEEN 0 AND 9),
  CONSTRAINT cv_chunks_data_chk CHECK (length(data) BETWEEN 1 AND 1000000)
);
