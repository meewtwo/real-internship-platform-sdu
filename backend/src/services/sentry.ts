/**
 * Minimal Sentry client over the public envelope API (no SDK: it must run on Workers and weigh nothing). Privacy by construction:
 * only the error type/message/stack, a normalised route, method, request id and environment are sent — never bodies, headers, cookies,
 * query strings, IPs or user ids. Every failure here is swallowed: error reporting must never cause an error.
 */
import type { Env } from '../env';

interface Dsn { key: string; host: string; project: string; protocol: string }
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+|\/+$/g, '');
    if (!u.username || !/^[0-9]+$/.test(project) || (u.protocol !== 'https:' && u.protocol !== 'http:')) return null;
    return { key: u.username, host: u.host, project, protocol: u.protocol };
  } catch { return null; }
}

/** /api/vacancies/3f2c…-uuid/apply → /api/vacancies/:id/apply ; long hex/digit segments too. Keeps events groupable and free of identifiers. */
export const normalisePath = (p: string) => p.split('?')[0].replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id').replace(/\/\d{4,}(?=\/|$)/g, '/:n').replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, '/:token');

const hex32 = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
// per-isolate flood guard: at most 20 events a minute
let windowStart = 0, count = 0;
const allow = () => { const now = Date.now(); if (now - windowStart > 60_000) { windowStart = now; count = 0; } return ++count <= 20; };
export const resetSentryGuard = () => { windowStart = 0; count = 0; };

export async function reportError(env: Env, err: unknown, ctx: { method?: string; path?: string; requestId?: string | null } = {}): Promise<void> {
  try {
    const dsn = parseDsn(env.SENTRY_DSN);
    if (!dsn || !allow()) return;
    const e = err instanceof Error ? err : new Error(String(err));
    const id = hex32();
    const event = {
      event_id: id, timestamp: new Date().toISOString(), platform: 'javascript', level: 'error', environment: env.ENVIRONMENT ?? 'development', release: env.RELEASE,
      exception: { values: [{ type: e.name || 'Error', value: e.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[db-url]').slice(0, 500), stacktrace: e.stack ? { frames: e.stack.split('\n').slice(1, 30).map((l) => ({ filename: l.trim().slice(0, 300) })).reverse() } : undefined }] },
      tags: { route: ctx.path ? normalisePath(ctx.path) : undefined, method: ctx.method, request_id: ctx.requestId ?? undefined },
    };
    const body = `${JSON.stringify({ event_id: id, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}`;
    await fetch(`${dsn.protocol}//${dsn.host}/api/${dsn.project}/envelope/?sentry_key=${dsn.key}&sentry_version=7`, { method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope' }, body });
  } catch { /* never throw from the error reporter */ }
}
