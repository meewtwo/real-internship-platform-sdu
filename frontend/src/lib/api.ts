import type { ApiErrorBody, ErrorCode, FieldErrors } from '@sdu/shared';
import { GUARDED_PATHS, captchaToken } from './captcha';

export class ApiError extends Error {
  constructor(public status: number, public code: ErrorCode, public fields: FieldErrors = {}, public retryAfter?: number) {
    super(code);
  }
}

let csrfToken: string | null = null;
async function csrf(force = false): Promise<string> {
  if (!csrfToken || force) {
    const r = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    csrfToken = ((await r.json()) as { token: string }).token;
  }
  return csrfToken;
}

/** Raw image upload (PUT /api/avatar) with the same CSRF handling; resolves to the new `updatedAt`. */
export async function uploadAvatar(blob: Blob, retried = false): Promise<string> {
  let res: Response;
  try { res = await fetch('/api/avatar', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': blob.type, 'x-csrf-token': await csrf() }, body: blob }); } catch { throw new ApiError(0, 'NETWORK_ERROR'); }
  let data: unknown = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.ok) return (data as { updatedAt: string }).updatedAt;
  const e = (data as ApiErrorBody | null)?.error;
  if (e?.code === 'CSRF_INVALID' && !retried) { await csrf(true); return uploadAvatar(blob, true); }
  throw new ApiError(res.status, e?.code ?? 'SERVER_ERROR', e?.fields ?? {}, e?.retryAfter);
}

/** JSON API client with CSRF double-submit handling. Throws ApiError with machine-readable codes. */
export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, retried = false): Promise<T> {
  let res: Response;
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = await csrf();
    if (method === 'POST' && GUARDED_PATHS.has(path)) {
      let token: string | null;
      try { token = await captchaToken(); } catch { throw new ApiError(0, 'CAPTCHA_FAILED'); }
      if (token) headers['x-captcha-token'] = token;
    }
    res = await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'NETWORK_ERROR');
  }
  let data: unknown = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.ok) return data as T;
  const e = (data as ApiErrorBody | null)?.error;
  if (e?.code === 'CSRF_INVALID' && !retried) {
    await csrf(true);
    return api<T>(method, path, body, true);
  }
  throw new ApiError(res.status, e?.code ?? 'SERVER_ERROR', e?.fields ?? {}, e?.retryAfter);
}
