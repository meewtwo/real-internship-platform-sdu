/** node:sqlite driver for the local server, CLI jobs and tests. Imported ONLY from Node entry points (never from the Worker bundle). */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Env } from '../env';
import { registerNodeDriver, type Driver } from './db';

const handles = new Map<string, { db: DatabaseSync; stmts: Map<string, StatementSync> }>();

export function openSqlite(path: string) {
  let h = handles.get(path);
  if (!h) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
    h = { db, stmts: new Map() };
    handles.set(path, h);
  }
  return h;
}
export function closeSqlite(path: string) { const h = handles.get(path); if (h) { h.db.close(); handles.delete(path); } }

const RETURNS = /^\s*(select|with|pragma)\b|\breturning\b/i;
export function nodeDriver(env: Env): Driver {
  const path = env.SQLITE_PATH ?? new URL('../../.data/dev.sqlite', import.meta.url).pathname;
  // opened lazily: a missing/unwritable database must fail the QUERY (so readiness probes and error handling see it), not the constructor
  const handle = () => openSqlite(path);
  const stmt = (sql: string) => { const h = handle(); let s = h.stmts.get(sql); if (!s) { s = h.db.prepare(sql); if (h.stmts.size > 500) h.stmts.clear(); h.stmts.set(sql, s); } return s; };
  // SQLite rejects more bindings than the statement has placeholders; our SQL can reuse $n freely, so bind only what is used
  const used = (sql: string) => { let m = 0; for (const x of sql.matchAll(/\?(\d+)/g)) m = Math.max(m, Number(x[1])); return m; };
  const exec = (sql: string, params: unknown[]) => {
    const s = stmt(sql);
    const p = params.slice(0, used(sql)) as never[];
    if (RETURNS.test(sql)) return { rows: s.all(...p).map((r) => ({ ...r })) as Record<string, unknown>[], changes: 0 };
    return { rows: [], changes: Number(s.run(...p).changes) };
  };
  return {
    run: async (sql, params) => exec(sql, params),
    batch: async (stmts) => {
      const h = handle();
      h.db.exec('BEGIN IMMEDIATE');
      try { const out = stmts.map((s) => exec(s.sql, s.params)); h.db.exec('COMMIT'); return out; }
      catch (e) { try { h.db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
    },
  };
}
registerNodeDriver(nodeDriver);
