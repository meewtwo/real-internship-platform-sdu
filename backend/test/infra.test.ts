import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalisePath, parseDsn, reportError, resetSentryGuard } from '../src/services/sentry';
import { Client, app, resetDb, studentPayload, testEnv } from './helpers';

const realFetch = globalThis.fetch;
interface Call { url: string; init: RequestInit }
let calls: Call[] = [];
let handler: (c: Call) => Response | Promise<Response> = () => new Response('{}', { status: 200 });
const install = () => { calls = []; globalThis.fetch = (async (url: string, init: RequestInit) => { const c = { url: String(url), init }; calls.push(c); return handler(c); }) as never; };
beforeEach(async () => { await resetDb(); resetSentryGuard(); handler = () => new Response('{}', { status: 200 }); });
afterEach(() => { globalThis.fetch = realFetch; delete testEnv.SENTRY_DSN; delete testEnv.TURNSTILE_SECRET; delete testEnv.TURNSTILE_SITEKEY; });

const DSN = 'https://abc123key@o99.ingest.sentry.test/4501';
const BROKEN = { ...testEnv, SQLITE_PATH: '/dev/null/db.sqlite' }; // cannot be created → every query fails

describe('Sentry reporter', () => {
  it('parses DSNs strictly', () => {
    expect(parseDsn(DSN)).toEqual({ key: 'abc123key', host: 'o99.ingest.sentry.test', project: '4501', protocol: 'https:' });
    for (const bad of [undefined, '', 'nope', 'ftp://k@h/1', 'https://h/1', 'https://k@h/', 'https://k@h/abc', 'javascript:alert(1)']) expect(parseDsn(bad as string), String(bad)).toBeNull();
  });
  it('normalises routes so events group and carry no identifiers', () => {
    expect(normalisePath('/api/vacancies/3f2c1a9e-1b2c-4d3e-8f90-aabbccddeeff/applicants?x=1')).toBe('/api/vacancies/:id/applicants');
    expect(normalisePath('/api/notifications/1234567/read')).toBe('/api/notifications/:n/read');
    expect(normalisePath('/api/public/resume/AAAAAAAAAAAAAAAAAAAAAA')).toBe('/api/public/resume/:token');
    expect(normalisePath('/api/auth/login')).toBe('/api/auth/login');
  });
  it('an unexpected server error is reported (envelope API) with request id — and with no cookies, bodies or credentials', async () => {
    install();
    const r = await app.request('http://localhost/api/vacancies/3f2c1a9e-1b2c-4d3e-8f90-aabbccddeeff/insights?secret=1', { headers: { cookie: 'sid=SUPERSECRETSESSION', 'x-request-id': 'req-abcdef123456', 'x-forwarded-for': '10.55.1.1', authorization: 'Bearer topsecret' } }, { ...BROKEN, SENTRY_DSN: DSN });
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: { code: 'SERVER_ERROR' } });
    await new Promise((res) => setTimeout(res, 50));
    const s = calls.filter((c) => c.url.includes('sentry.test'));
    expect(s).toHaveLength(1);
    expect(s[0].url).toBe('https://o99.ingest.sentry.test/api/4501/envelope/?sentry_key=abc123key&sentry_version=7');
    const [hdr, item, ev] = String(s[0].init.body).split('\n').map((l) => JSON.parse(l));
    expect(hdr.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(item).toEqual({ type: 'event' });
    expect(ev.level).toBe('error');
    expect(ev.tags).toMatchObject({ route: '/api/vacancies/:id/insights', method: 'GET', request_id: 'req-abcdef123456' });
    const text = String(s[0].init.body);
    for (const leak of ['SUPERSECRETSESSION', 'topsecret', '10.55.1.1', 'secret=1', '3f2c1a9e-1b2c']) expect(text, leak).not.toContain(leak);
  });
  it('is off without a DSN; a failing Sentry never changes the response; flood guard caps at 20/min', async () => {
    install();
    expect((await app.request('http://localhost/api/vacancies', { headers: { cookie: 'sid=x' } }, BROKEN)).status).toBe(500);
    await new Promise((res) => setTimeout(res, 20));
    expect(calls).toHaveLength(0);
    handler = () => { throw new Error('sentry down'); };
    const r = await app.request('http://localhost/api/vacancies', { headers: { cookie: 'sid=x' } }, { ...BROKEN, SENTRY_DSN: DSN });
    expect(r.status).toBe(500);
    handler = () => new Response('{}');
    calls.length = 0; resetSentryGuard();
    for (let i = 0; i < 30; i++) await reportError({ ...testEnv, SENTRY_DSN: DSN }, new Error('x'), { path: '/api/x' });
    expect(calls).toHaveLength(20);
  });
  it('4xx responses and handled errors are NOT reported', async () => {
    install();
    const c = new Client();
    expect((await c.get('/api/vacancies')).status).toBe(401);
    expect((await app.request('http://localhost/api/nope', {}, { ...testEnv, SENTRY_DSN: DSN })).status).toBe(404);
    expect((await app.request('http://localhost/api/health/ready', {}, { ...BROKEN, SENTRY_DSN: DSN })).status).toBe(503);
    await new Promise((res) => setTimeout(res, 20));
    expect(calls.filter((x) => x.url.includes('sentry.test'))).toHaveLength(0);
  });
});

describe('Turnstile captcha', () => {
  const verifyCalls = () => calls.filter((c) => c.url.includes('challenges.cloudflare.com'));
  const register = (c: Client, token?: string) => c.json('POST', '/api/auth/register/student', studentPayload(), { headers: token === undefined ? {} : { 'x-captcha-token': token } });
  it('is off by default: no verifier call, nothing required', async () => {
    install();
    expect((await register(new Client())).status).toBe(201);
    expect(verifyCalls()).toHaveLength(0);
    expect((await new Client().get('/api/public/config')).body).toEqual({ turnstileSiteKey: null });
  });
  it('when enabled it guards register/login/forgot/resend and fails closed', async () => {
    testEnv.TURNSTILE_SECRET = 'sekret';
    install();
    handler = async (c) => new Response(JSON.stringify({ success: new URLSearchParams(String(c.init.body)).get('response') === 'good-token' }), { status: 200 });
    for (const [path, body] of [['/api/auth/register/student', studentPayload()], ['/api/auth/login', { role: 'student', identifier: '230107999', password: 'x' }], ['/api/auth/forgot', { role: 'student', identifier: '230107999' }], ['/api/auth/resend-code', { role: 'student', identifier: '230107999', purpose: 'register' }]] as const) {
      const r = await new Client().json('POST', path, body);
      expect(r.status, `${path} without token`).toBe(400);
      expect(r.body.error.code).toBe('CAPTCHA_FAILED');
      const bad = await new Client().json('POST', path, body, { headers: { 'x-captcha-token': 'bad-token' } });
      expect(bad.body.error?.code, `${path} bad token`).toBe('CAPTCHA_FAILED');
    }
    expect((await register(new Client(), 'good-token')).status).toBe(201);
    const v = verifyCalls().at(-1)!;
    const form = new URLSearchParams(String(v.init.body));
    expect(form.get('secret')).toBe('sekret');
    expect(form.get('response')).toBe('good-token');
    expect(form.get('remoteip')).toBeTruthy();
    expect(v.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  });
  it('fails closed on verifier errors, oversize tokens and non-JSON answers; other endpoints are unaffected', async () => {
    testEnv.TURNSTILE_SECRET = 'sekret';
    install();
    for (const h of [() => { throw new Error('network'); }, () => new Response('', { status: 500 }), () => new Response('<html>', { status: 200 }), () => new Response('{"success":"true"}', { status: 200 })]) {
      handler = h as never;
      expect((await register(new Client(), 'whatever')).body.error?.code).toBe('CAPTCHA_FAILED');
    }
    handler = () => new Response('{"success":true}', { status: 200 });
    expect((await register(new Client(), 'x'.repeat(2049))).body.error?.code).toBe('CAPTCHA_FAILED');
    const c = new Client();
    expect((await c.get('/api/auth/csrf')).status).toBe(200);
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await c.json('POST', '/api/auth/verify', { role: 'student', identifier: '1', code: '123456' })).body.error?.code).not.toBe('CAPTCHA_FAILED');
  });
  it('publishes the site key only when both secret and key are set', async () => {
    const c = new Client();
    testEnv.TURNSTILE_SITEKEY = '0xSITE';
    expect((await c.get('/api/public/config')).body.turnstileSiteKey).toBeNull();
    testEnv.TURNSTILE_SECRET = 'sekret';
    expect((await c.get('/api/public/config')).body).toEqual({ turnstileSiteKey: '0xSITE' });
    expect(JSON.stringify((await c.get('/api/public/config')).body)).not.toContain('sekret');
  });
});
