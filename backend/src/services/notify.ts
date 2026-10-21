import type { Queryable, Stmt } from '../lib/db';

export type NotifKind = 'new_application' | 'status_changed' | 'new_match' | 'employer_approved' | 'employer_rejected' | 'invitation' | 'new_message' | 'interview_update' | 'saved_search';
/** Stores machine-readable notification params; the client renders the text in the user's language. */
export async function notify(q: Queryable, userId: string, kind: NotifKind, params: Record<string, unknown>, link: string | null) {
  await q.query('INSERT INTO notifications (user_id, kind, params, link) VALUES ($1, $2, $3, $4)', [userId, kind, JSON.stringify(params), link]);
  (q as { markNotified?: () => void }).markNotified?.();
}

/** Same insert as a batch statement (so it commits atomically with the action that caused it). */
/**
 * Notification that is only created when `guardSql` (an EXISTS-able SELECT using placeholders from $5 on) returns a row — used to tie it to the
 * success of an earlier statement in the same batch (e.g. "the UPDATE I just made carries my claim stamp").
 */
export const notifyIf = (guardSql: string, guardParams: unknown[], userId: string, kind: NotifKind, params: Record<string, unknown>, link: string | null): Stmt => ({
  sql: `INSERT INTO notifications (user_id, kind, params, link) SELECT $1, $2, $3, $4 WHERE EXISTS (${guardSql})`,
  params: [userId, kind, JSON.stringify(params), link, ...guardParams],
});
export const notifyStmt = (userId: string, kind: NotifKind, params: Record<string, unknown>, link: string | null): Stmt =>
  ({ sql: 'INSERT INTO notifications (user_id, kind, params, link) VALUES ($1, $2, $3, $4)', params: [userId, kind, JSON.stringify(params), link] });
