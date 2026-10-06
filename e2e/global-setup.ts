import { closeSqlite, openSqlite } from '../backend/src/lib/dbNode';
import { migrate } from '../backend/src/cli/migrate';

export const E2E_DB = '/tmp/sdu_e2e.sqlite';

/**
 * Playwright starts the API server BEFORE this runs, and the server keeps the SQLite file open — so the file must never be deleted or replaced.
 * Instead the schema is ensured (idempotent) and all user-generated data is wiped; the vocabulary (skills, courses) from the migration stays.
 */
export default async function globalSetup() {
  await migrate(E2E_DB, () => undefined);
  const { db } = openSqlite(E2E_DB);
  db.exec('PRAGMA busy_timeout = 5000');
  for (const t of ['users', 'rate_limits', 'audit_log', 'ai_cache']) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM skills WHERE id > (SELECT max(id) FROM skills WHERE name_key IN ('law', 'contract law', 'customer service', 'sales', 'management'))");
  closeSqlite(E2E_DB);
}
