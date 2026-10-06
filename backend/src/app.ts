import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { getCookie } from 'hono/cookie';
import { isProd, isTest, type Env } from './env';
import { Db } from './lib/db';
import { apiError, clientIp, constantTimeEqualStr, type AppEnv } from './lib/http';
import { getMailbox, getOutbox } from './lib/mail';
import { email } from './routes/email';
import { telegram } from './routes/telegram';
import { messages } from './routes/messages';
import { interviews } from './routes/interviews';
import { flushTelegram } from './services/telegram';
import { reportError } from './services/sentry';
import { captchaEnabled, verifyCaptcha } from './lib/turnstile';
import { appBase } from './services/emailLinks';
import { flushInstantEmails } from './services/emailQueue';
import { admin } from './routes/admin';
import { auth, CSRF_COOKIE } from './routes/auth';
import { profile } from './routes/profile';
import { applications } from './routes/applications';
import { cv } from './routes/cv';
import { avatar, MAX_AVATAR_BYTES } from './routes/avatar';
import { notifications } from './routes/notifications';
import { recommendations } from './routes/recommendations';
import { vacancies } from './routes/vacancies';
import { favorites } from './routes/favorites';
import { publicApi } from './routes/public';
import { savedSearches } from './routes/savedSearches';
import { ai } from './routes/ai';
import { resumeDocs } from './routes/resumeDocs';
import { resume } from './routes/resume';

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // CV upload only (file limit 2 MB + multipart overhead)

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('/api/*', secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    referrerPolicy: 'no-referrer',
    xFrameOptions: 'DENY',
  }));
  // correlation id: honour a sane incoming one (load balancer / client), else mint one; echoed back and written to error logs
  app.use('/api/*', async (c, next) => {
    const inc = c.req.header('x-request-id');
    const rid = inc && /^[A-Za-z0-9._-]{8,64}$/.test(inc) ? inc : crypto.randomUUID();
    c.set('requestId', rid);
    c.header('X-Request-Id', rid);
    await next();
  });
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const db = new Db(c.env);
    c.set('db', db);
    c.set('auth', null);
    try {
      await next();
      // e-mail the notifications this request created (outbox pattern: the rows are already committed; a failed send is retried later and never fails the request)
      if (db.notified && c.res.status < 400) {
        try { await flushInstantEmails(db, c.env, appBase(c.env, new URL(c.req.url).origin), 10); }
        catch (e) { console.error(JSON.stringify({ level: 'error', msg: 'instant e-mail flush failed', detail: (e as Error).message, requestId: c.get('requestId') ?? null })); }
        try { await flushTelegram(db, c.env, appBase(c.env, new URL(c.req.url).origin), 10); }
        catch (e) { console.error(JSON.stringify({ level: 'error', msg: 'telegram flush failed', detail: (e as Error).message, requestId: c.get('requestId') ?? null })); }
      }
    } finally {
      await db.close();
    }
  });
  app.use('/api/*', (c, next) => bodyLimit({ maxSize: c.req.path === '/api/avatar' ? MAX_AVATAR_BYTES + 1024 : (c.req.path === '/api/cv' || c.req.path === '/api/resume/import') ? MAX_UPLOAD_BYTES : MAX_BODY_BYTES, onError: (cc) => apiError(cc as never, 413, 'PAYLOAD_TOO_LARGE') })(c, next));

  // CSRF: double-submit cookie + Origin check for every state-changing request
  app.use('/api/*', async (c, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
    if (c.req.path === '/api/email/unsubscribe' || c.req.path === '/api/telegram/webhook') return next(); // mail-client one-click POST: authorised by its HMAC token, has no cookies
    const origin = c.req.header('origin');
    if (origin) {
      const allowed = new Set([new URL(c.req.url).origin, ...(c.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)]);
      if (!isProd(c.env) && !c.env.ALLOWED_ORIGINS) for (const o of ['http://localhost:5173', 'http://127.0.0.1:5173']) allowed.add(o);
      if (!allowed.has(origin)) return apiError(c, 403, 'CSRF_INVALID');
    }
    const cookie = getCookie(c, CSRF_COOKIE);
    const header = c.req.header('x-csrf-token');
    if (!cookie || !header || !constantTimeEqualStr(cookie, header)) return apiError(c, 403, 'CSRF_INVALID');
    return next();
  });

  // captcha on the abuse-prone unauthenticated POSTs (only when TURNSTILE_SECRET is set). The token travels in a header so request schemas stay strict.
  const CAPTCHA_PATHS = new Set(['/api/auth/register/student', '/api/auth/register/employer', '/api/auth/login', '/api/auth/forgot', '/api/auth/resend-code']);
  app.use('/api/auth/*', async (c, next) => {
    if (c.req.method !== 'POST' || !captchaEnabled(c.env) || !CAPTCHA_PATHS.has(c.req.path)) return next();
    return (await verifyCaptcha(c.env, c.req.header('x-captcha-token'), clientIp(c))) ? next() : apiError(c, 400, 'CAPTCHA_FAILED');
  });

  app.route('/api/auth', auth);
  app.route('/api/profile', profile);
  app.route('/api/admin', admin);
  app.route('/api/cv', cv);
  app.route('/api/avatar', avatar);
  app.route('/api/vacancies', vacancies);
  app.route('/api/applications', applications);
  app.route('/api/recommendations', recommendations);
  app.route('/api/notifications', notifications);
  app.route('/api/favorites', favorites);
  app.route('/api/resume', resume);
  app.route('/api/public', publicApi);
  app.route('/api/saved-searches', savedSearches);
  app.route('/api/ai', ai);
  app.route('/api/resume-docs', resumeDocs);
  app.route('/api/email', email);
  app.route('/api/telegram', telegram);
  app.route('/api/messages', messages);
  app.route('/api/interviews', interviews);
  app.get('/api/health', (c) => c.json({ ok: true }));
  // readiness: proves the database answers (liveness above does not). 503 lets a load balancer stop routing here.
  app.get('/api/health/ready', async (c) => {
    try { await c.var.db.query('SELECT 1'); return c.json({ ok: true, db: 'up' }); }
    catch { return c.json({ ok: false, db: 'down' }, 503); }
  });

  // Test-only outbox so e2e/API tests can read verification codes. Answers 404 unless ENVIRONMENT=test.
  app.get('/api/__test/outbox', (c) => {
    if (!isTest(c.env as Env)) return apiError(c, 404, 'NOT_FOUND');
    const to = c.req.query('to');
    return c.json({ mails: getOutbox().filter((m) => !to || m.to === to) });
  });

  app.get('/api/__test/mailbox', (c) => {
    if (!isTest(c.env as Env)) return apiError(c, 404, 'NOT_FOUND');
    const to = c.req.query('to');
    return c.json({ mails: getMailbox().filter((m) => !to || m.to === to) });
  });

  app.notFound((c) => (c.req.path.startsWith('/api/') ? apiError(c, 404, 'NOT_FOUND') : c.text('Not found', 404)));
  app.onError((err, c) => {
    // one JSON line per failure so Workers Logs / any log drain can filter and alert on it (never log bodies, cookies or codes)
    console.error(JSON.stringify({ level: 'error', msg: err.message, method: c.req.method, path: c.req.path, ray: c.req.header('cf-ray') ?? null, requestId: c.get('requestId') ?? null, at: new Date().toISOString() }));
    const report = reportError(c.env, err, { method: c.req.method, path: c.req.path, requestId: c.get('requestId') ?? null });
    try { (c.executionCtx as { waitUntil(p: Promise<unknown>): void }).waitUntil(report); } catch { /* not on Workers: the promise runs on its own */ }
    return apiError(c, 500, 'SERVER_ERROR');
  });
  return app;
}
