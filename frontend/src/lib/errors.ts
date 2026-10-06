import type { TFunction } from 'i18next';
import type { ErrorCode } from '@sdu/shared';
import { ApiError } from './api';

/** Translates a machine-readable error code (never server-provided text). */
export function errText(t: TFunction, code: ErrorCode | string | undefined, params?: Record<string, unknown>): string {
  if (!code) return '';
  return t(`errors:${code}`, { defaultValue: t('errors:SERVER_ERROR'), ...params }) as string;
}
export function apiErrText(t: TFunction, e: unknown): string {
  if (e instanceof ApiError) return errText(t, e.code, { minutes: Math.max(1, Math.ceil((e.retryAfter ?? 900) / 60)) });
  return errText(t, 'SERVER_ERROR');
}
