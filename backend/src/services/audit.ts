import type { Queryable, Stmt } from '../lib/db';

export type AuditAction =
  | 'employer.approve' | 'employer.reject' | 'vacancy.publish' | 'vacancy.close' | 'vacancy.delete'
  | 'application.status' | 'account.export' | 'account.delete' | 'ai.consent' | 'digest.run';

/** Appends one audit row. Put `auditStmt(...)` in the same `db.batch` as the action so both commit or neither does. Never put PII or secrets in `meta`. */
export async function audit(
  q: Queryable,
  actor: { id: string; role: string } | null,
  action: AuditAction,
  target: { type: string; id: string } | null = null,
  meta: Record<string, string | number | boolean | null> = {},
) {
  await q.query(
    'INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta) VALUES ($1, $2, $3, $4, $5, $6)',
    [actor?.id ?? null, actor?.role ?? null, action, target?.type ?? null, target?.id ?? null, JSON.stringify(meta)],
  );
}

/** Audit row guarded like `notifyIf` (guard placeholders start at $7). */
export const auditIf = (
  guardSql: string, guardParams: unknown[], actor: { id: string; role: string } | null, action: AuditAction, target: { type: string; id: string } | null = null, meta: Record<string, string | number | boolean | null> = {},
): Stmt => ({
  sql: `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta) SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (${guardSql})`,
  params: [actor?.id ?? null, actor?.role ?? null, action, target?.type ?? null, target?.id ?? null, JSON.stringify(meta), ...guardParams],
});
export const auditStmt = (
  actor: { id: string; role: string } | null, action: AuditAction, target: { type: string; id: string } | null = null, meta: Record<string, string | number | boolean | null> = {},
): Stmt => ({
  sql: 'INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta) VALUES ($1, $2, $3, $4, $5, $6)',
  params: [actor?.id ?? null, actor?.role ?? null, action, target?.type ?? null, target?.id ?? null, JSON.stringify(meta)],
});
