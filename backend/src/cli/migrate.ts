import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openSqlite } from '../lib/dbNode';

export const DEFAULT_DB = fileURLToPath(new URL('../../.data/dev.sqlite', import.meta.url));
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../database/d1/', import.meta.url));

/**
 * Applies database/d1/*.sql in order to a local SQLite file (dev server, tests). Production uses the SAME files through
 * `wrangler d1 migrations apply` (see backend/wrangler.toml → migrations_dir), so schema and tests never drift apart.
 */
export async function migrate(path = process.env.SQLITE_PATH ?? DEFAULT_DB, log = console.log) {
  const { db } = openSqlite(path);
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')))');
  const done = new Set((db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name));
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(MIGRATIONS_DIR + f, 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(f);
      db.exec('COMMIT');
      log(`applied ${f}`);
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) migrate().then(() => console.log('migrations up to date'), (e) => { console.error(e); process.exit(1); });
