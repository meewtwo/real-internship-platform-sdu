import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../src/lib/db';
import { sha256Hex } from '../src/lib/crypto';
import { flushTelegram } from '../src/services/telegram';
import { Client, app, makeAdmin, makeEmployer, makeStudent, resetDb, setProfile, sql, testEnv, vacancyPayload, seedSkills, ago } from './helpers';

const SECRET = 'whsec-test-secret-0123456789abcdef';
interface Sent { method: string; body: any; url: string }
let sent: Sent[] = [];
let respond: (s: Sent) => Response = () => new Response('{"ok":true}', { status: 200 });
const realFetch = globalThis.fetch;
const BASE = 'http://localhost';

beforeEach(async () => {
  await resetDb();
  await sql('DELETE FROM audit_log');
  await seedSkills('Python', 'SQL');
  Object.assign(testEnv, { TELEGRAM_BOT_TOKEN: '123:TESTTOKEN', TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_USERNAME: 'SduTestBot', TELEGRAM_API_BASE: 'https://tg.test' });
  sent = [];
  respond = () => new Response('{"ok":true}', { status: 200 });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const s = { url, method: url.split('/').pop()!, body: JSON.parse(String(init?.body ?? '{}')) };
    sent.push(s);
    return respond(s);
  }) as never;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_API_BASE'] as const) delete testEnv[k];
});

let ipn = 0;
const hook = (update: unknown, secret: string | null = SECRET, raw?: string) =>
  app.request(`${BASE}/api/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.20.${Math.floor(ipn / 250)}.${ipn++ % 250}`, ...(secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }) }, body: raw ?? JSON.stringify(update) }, testEnv);
const msg = (chat: number, text: string, extra: Record<string, unknown> = {}) => ({ update_id: 1, message: { message_id: 1, chat: { id: chat, type: 'private' }, from: { id: chat, language_code: 'en' }, text, ...extra } });
const replies = () => sent.filter((s) => s.method === 'sendMessage');
async function linkToken(c: Client) { return /start=([\w-]+)$/.exec((await c.post('/api/telegram/link')).body.url)![1]; }
async function linked(c: Client, chat: number) { const t = await linkToken(c); await hook(msg(chat, `/start ${t}`)); sent = []; return t; }
const uid = async (c: Client) => (await c.get('/api/profile')).body.user.id as string;
async function publish(emp: Awaited<ReturnType<typeof makeEmployer>>, over: Record<string, unknown> = {}) {
  const c = await emp.client.post('/api/vacancies', vacancyPayload(over));
  const id = c.body.vacancy.id as string;
  await emp.client.post(`/api/vacancies/${id}/publish`);
  return id;
}
const flush = () => flushTelegram(new Db(testEnv), testEnv, BASE, 50);

describe('availability', () => {
  it('without bot secrets everything is off and nothing leaves the server', async () => {
    delete testEnv.TELEGRAM_BOT_TOKEN;
    const s = await makeStudent();
    expect((await s.client.get('/api/telegram/status')).body).toMatchObject({ configured: false, linked: false });
    const r = await s.client.post('/api/telegram/link');
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('TELEGRAM_UNAVAILABLE');
    expect((await hook(msg(1, '/start x'))).status).toBe(404);
    expect(sent).toHaveLength(0);
  });
});

describe('webhook authentication', () => {
  it('only the exact secret header is accepted; everything else is an opaque 404 with no side effects', async () => {
    const s = await makeStudent();
    const tok = await linkToken(s.client);
    for (const secret of [null, '', 'wrong', SECRET + 'x', SECRET.slice(0, -1), SECRET.toUpperCase()]) {
      const r = await hook(msg(5, `/start ${tok}`), secret);
      expect(r.status, String(secret)).toBe(404);
      expect(await r.json()).toEqual({ error: { code: 'NOT_FOUND' } });
    }
    expect(sent).toHaveLength(0);
    expect(await sql('SELECT 1 FROM telegram_links')).toHaveLength(0);
    expect(await sql('SELECT 1 FROM telegram_link_tokens')).toHaveLength(1);
  });
  it('needs no cookies/CSRF, always answers 200 to authentic input (even junk), and ignores non-private chats and non-message updates', async () => {
    expect((await hook(null, SECRET, 'not json')).status).toBe(200);
    for (const u of [null, 5, 'x', [], {}, { message: null }, { message: { chat: { id: 'x', type: 'private' }, text: '/help' } }, { message: { chat: { id: 1, type: 'group' }, text: '/help' } }, { message: { chat: { id: 1.5, type: 'private' }, text: '/help' } }, { message: { chat: { id: 1, type: 'private' } } }, { edited_message: msg(1, '/help').message }, { message: { chat: { id: 1, type: 'private' }, text: { a: 1 } } }]) {
      expect((await hook(u)).status, JSON.stringify(u)).toBe(200);
    }
    expect(sent).toHaveLength(0);
  });
});

describe('linking', () => {
  it('start link → /start TOKEN links the chat, replies in the user language, and the token is single-use', async () => {
    const s = await makeStudent({ language: 'ru' });
    const url = (await s.client.post('/api/telegram/link')).body.url as string;
    expect(url).toMatch(/^https:\/\/t\.me\/SduTestBot\?start=[A-Za-z0-9_-]{20,}$/);
    const tok = url.split('=')[1];
    expect((await sql('SELECT token_hash FROM telegram_link_tokens'))[0].token_hash).toBe(await sha256Hex(tok)); // only the hash is stored
    expect((await hook(msg(777, `/start ${tok}`))).status).toBe(200);
    expect(replies()).toHaveLength(1);
    expect(replies()[0].body).toMatchObject({ chat_id: 777 });
    expect(replies()[0].body.text).toContain('Подключено');
    expect(replies()[0].body).not.toHaveProperty('parse_mode');
    expect(replies()[0].url).toBe('https://tg.test/bot123:TESTTOKEN/sendMessage');
    expect((await s.client.get('/api/telegram/status')).body).toEqual({ configured: true, linked: true, enabled: true, username: 'SduTestBot' });
    await hook(msg(778, `/start ${tok}`));
    expect(replies()[1].body.text).toContain('invalid or expired'); // an unlinked chat is answered in the language Telegram reports
    expect(await sql('SELECT chat_id FROM telegram_links')).toEqual([{ chat_id: 777 }]);
  });
  it('rejects expired, replaced, malformed and forged tokens', async () => {
    const s = await makeStudent();
    const old = await linkToken(s.client);
    const fresh = await linkToken(s.client); // replaces the old one
    await hook(msg(1, `/start ${old}`));
    expect(replies().at(-1)!.body.text).toContain('invalid or expired');
    await sql(`UPDATE telegram_link_tokens SET expires_at = ${ago(1, 'seconds')}`);
    await hook(msg(1, `/start ${fresh}`));
    expect(replies().at(-1)!.body.text).toContain('invalid or expired');
    for (const bad of ['short', 'a'.repeat(65), 'has space', 'x'.repeat(24) + '!!', "'; DROP TABLE users;--"]) { await hook(msg(1, `/start ${bad}`)); expect(replies().at(-1)!.body.text).toContain('invalid or expired'); }
    expect(await sql('SELECT 1 FROM telegram_links')).toHaveLength(0);
  });
  it('a chat cannot be hijacked by a second account; /stop frees it', async () => {
    const a = await makeStudent(), b = await makeStudent();
    await linked(a.client, 900);
    await hook(msg(900, `/start ${await linkToken(b.client)}`));
    expect(replies().at(-1)!.body.text).toContain('already linked');
    expect((await sql('SELECT user_id FROM telegram_links'))).toEqual([{ user_id: await uid(a.client) }]);
    await hook(msg(900, '/stop'));
    expect(replies().at(-1)!.body.text).toContain('Disconnected');
    await hook(msg(900, `/start ${await linkToken(b.client)}`));
    expect((await sql('SELECT user_id FROM telegram_links'))).toEqual([{ user_id: await uid(b.client) }]);
  });
  it('relinking the same account to a new chat moves it; @botname suffix is accepted', async () => {
    const a = await makeStudent();
    await linked(a.client, 1);
    await hook(msg(2, `/start@SduTestBot ${await linkToken(a.client)}`));
    expect(await sql('SELECT chat_id FROM telegram_links')).toEqual([{ chat_id: 2 }]);
  });
  it('web-side controls: status, disconnect, enable/disable; roles and auth enforced', async () => {
    const s = await makeStudent(), admin = await makeAdmin();
    await linked(s.client, 42);
    expect((await s.client.put('/api/telegram/settings', { enabled: false })).body).toEqual({ enabled: false });
    expect((await s.client.get('/api/telegram/status')).body).toMatchObject({ linked: true, enabled: false });
    for (const b of [{}, { enabled: 'no' }, { enabled: true, x: 1 }]) expect((await s.client.put('/api/telegram/settings', b)).status).toBe(400);
    expect((await s.client.delete('/api/telegram/link')).status).toBe(200);
    expect((await s.client.get('/api/telegram/status')).body).toMatchObject({ linked: false });
    expect((await s.client.put('/api/telegram/settings', { enabled: true })).status).toBe(404);
    expect((await admin.post('/api/telegram/link')).status).toBe(403);
    expect((await new Client().get('/api/telegram/status')).status).toBe(401);
  });
  it('deleting the account removes the link and pending tokens', async () => {
    const s = await makeStudent();
    await linked(s.client, 5); await linkToken(s.client);
    expect((await s.client.json('DELETE', '/api/profile', { password: 'Vk8#mQ2!zPw4' })).status).toBe(200);
    expect(await sql('SELECT 1 FROM telegram_links')).toHaveLength(0);
    expect(await sql('SELECT 1 FROM telegram_link_tokens')).toHaveLength(0);
  });
});

describe('bot commands', () => {
  it('/matches lists a student’s best matches with links; employers get the pending count; unlinked chats are told how to connect', async () => {
    const emp = await makeEmployer();
    const s = await makeStudent();
    await setProfile(s.client, { skills: ['Python', 'SQL'] });
    const vid = await publish(emp, { title: 'Python SQL analyst', requiredSkills: ['Python', 'SQL'] });
    await linked(s.client, 10);
    await hook(msg(10, '/matches'));
    expect(replies()[0].body.text).toContain('Your best matches:');
    expect(replies()[0].body.text).toMatch(/• \d+% — Python SQL analyst, Acme Technologies LLP/);
    expect(replies()[0].body.text).toContain(`${BASE}/vacancies/${vid}`);
    await s.client.post(`/api/vacancies/${vid}/apply`);
    sent = [];
    await hook(msg(10, '/matches'));
    expect(replies()[0].body.text).toBe('No new matches right now.');
    await linked(emp.client, 11);
    await hook(msg(11, '/matches'));
    expect(replies()[0].body.text).toBe('Applications waiting for your decision: 1');
    sent = [];
    await hook(msg(99, '/matches'));
    expect(replies()[0].body.text).toContain('not connected');
    await hook(msg(99, 'hello'));
    await hook(msg(10, 'hello'));
    expect(replies()[2].body.text).toContain('Commands:');
  });
});

describe('delivering notifications', () => {
  async function setup(lang = 'en') {
    const emp = await makeEmployer();
    const s = await makeStudent({ language: lang });
    await setProfile(s.client, { skills: ['Python', 'SQL'] });
    const vid = await publish(emp);
    const appId = (await s.client.post(`/api/vacancies/${vid}/apply`)).body.application.id as string;
    await linked(s.client, 321);
    return { emp, s, vid, appId };
  }
  it('a status change is pushed to Telegram once, as plain text with an absolute link', async () => {
    const { emp, appId } = await setup();
    expect((await emp.client.patch(`/api/applications/${appId}/status`, { status: 'shortlisted' })).status).toBe(200);
    expect(replies()).toHaveLength(1);
    expect(replies()[0].body).toMatchObject({ chat_id: '321', disable_web_page_preview: true });
    expect(replies()[0].body.text).toBe(`Your application for “Junior Python Developer Intern” at Acme Technologies LLP is now: Shortlisted.\n${BASE}/applications`);
    await flush();
    expect(replies()).toHaveLength(1); // never twice
  });
  it('is localised, covers matches and saved-search alerts, and ignores opted-out/disabled links', async () => {
    const emp = await makeEmployer();
    const s = await makeStudent({ language: 'ru' });
    await setProfile(s.client, { skills: ['Python', 'SQL'] });
    await s.client.post('/api/saved-searches', { name: 'sql', filters: { q: 'sql' } });
    await linked(s.client, 55);
    await publish(emp, { title: 'SQL аналитик', requiredSkills: ['SQL'] });
    expect(replies().map((r) => r.body.text).join('\n')).toMatch(/Новое совпадение \d+%: «SQL аналитик», Acme Technologies LLP/);
    await s.client.put('/api/telegram/settings', { enabled: false });
    sent = [];
    await publish(emp, { title: 'Python аналитик', requiredSkills: ['Python'] });
    expect(sent).toHaveLength(0);
  });
  it('failures are retried (≤5) without failing the request; a blocked bot unlinks the chat', async () => {
    const { emp, appId, s } = await setup();
    respond = () => new Response('{"ok":false}', { status: 500 });
    expect((await emp.client.patch(`/api/applications/${appId}/status`, { status: 'viewed' })).status).toBe(200);
    expect((await sql<{ tg_attempts: number; tg_sent_at: string | null }>(`SELECT tg_attempts, tg_sent_at FROM notifications WHERE kind = 'status_changed'`))[0]).toMatchObject({ tg_attempts: 1, tg_sent_at: null });
    for (let i = 0; i < 6; i++) await flush();
    expect((await sql<{ tg_attempts: number }>(`SELECT tg_attempts FROM notifications WHERE kind = 'status_changed'`))[0].tg_attempts).toBe(5);
    await sql(`UPDATE notifications SET tg_attempts = 0 WHERE kind = 'status_changed'`);
    sent = [];
    respond = () => new Response('{"ok":false,"description":"Forbidden: bot was blocked by the user"}', { status: 403 });
    const r = await flush();
    expect(r.unlinked).toBe(1);
    expect(await sql('SELECT 1 FROM telegram_links')).toHaveLength(0);
    expect((await s.client.get('/api/telegram/status')).body.linked).toBe(false);
    sent = [];
    await flush();
    expect(sent).toHaveLength(0);
  });
  it('network errors are retried; concurrent flushes send each message once', async () => {
    const { s } = await setup();
    const id = await uid(s.client);
    await sql(`UPDATE notifications SET tg_sent_at = ${ago(0, 'seconds')}`);
    for (let i = 0; i < 5; i++) await sql(`INSERT INTO notifications (user_id, kind, params, link) VALUES ($1, 'invitation', $2, '/applications')`, [id, JSON.stringify({ title: `V${i}`, company: 'A' })]);
    sent = [];
    await Promise.all([1, 2, 3, 4].map(() => flush()));
    expect(replies()).toHaveLength(5);
    expect(new Set(replies().map((r) => r.body.text)).size).toBe(5);
  });
  it('titles are sent as plain text (no markup interpretation) and over-long text is clipped', async () => {
    const { s } = await setup();
    const id = await uid(s.client);
    sent = [];
    await sql(`INSERT INTO notifications (user_id, kind, params, link) VALUES ($1, 'invitation', $2, '/applications')`, [id, JSON.stringify({ title: '*bold* <b>x</b> [link](http://evil)'.repeat(300), company: '_c_' })]);
    await flush();
    expect(replies()[0].body).not.toHaveProperty('parse_mode');
    expect(replies()[0].body.text.length).toBeLessThanOrEqual(4000);
  });
});

describe('admin webhook registration', () => {
  it('registers the webhook URL with the secret; admin only', async () => {
    const admin = await makeAdmin();
    const s = await makeStudent();
    expect((await s.client.post('/api/admin/telegram/webhook')).status).toBe(403);
    expect((await admin.post('/api/admin/telegram/webhook')).status).toBe(200);
    const w = sent.find((x) => x.method === 'setWebhook')!;
    expect(w.body).toMatchObject({ url: `${BASE}/api/telegram/webhook`, secret_token: SECRET, allowed_updates: ['message'] });
    respond = () => new Response('', { status: 500 });
    expect((await admin.post('/api/admin/telegram/webhook')).status).toBe(503);
  });
});
