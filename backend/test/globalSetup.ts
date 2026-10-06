import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeSqlite } from '../src/lib/dbNode';
import { migrate } from '../src/cli/migrate';

export const TEST_DB = join(tmpdir(), 'sdu_career_test.sqlite');

/** A fresh SQLite file with the production schema (database/d1/*.sql — the same files `wrangler d1 migrations apply` uses). */
export default async function setup() {
  for (const ext of ['', '-wal', '-shm']) rmSync(TEST_DB + ext, { force: true });
  await migrate(TEST_DB, () => undefined);
  closeSqlite(TEST_DB);
}
