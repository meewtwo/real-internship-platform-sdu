import type { MiddlewareHandler } from 'hono';
import type { Role } from '@sdu/shared';
import { loadAuth } from '../services/sessions';
import { apiError, type AppEnv } from './http';

/** Requires a session (and, if given, one of the roles). */
export const requireAuth = (...roles: Role[]): MiddlewareHandler<AppEnv> => async (c, next) => {
  const a = await loadAuth(c);
  if (!a) return apiError(c, 401, 'UNAUTHORIZED');
  if (roles.length && !roles.includes(a.user.role)) return apiError(c, 403, 'FORBIDDEN');
  c.set('auth', a);
  await next();
};
