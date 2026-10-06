import { beforeEach, describe, expect, it } from 'vitest';
import { Client, makeEmployer, makeStudent, resetDb, sql } from './helpers';

beforeEach(resetDb);

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const WEBP = Uint8Array.from([...'RIFF'].map((c) => c.charCodeAt(0)).concat([1, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0)), [9, 9, 9, 9]));
const me = async (c: Client) => (await c.get('/api/auth/me')).body.user.id as string;
const put = async (c: Client, bytes: Uint8Array, type = 'image/png') => c.raw('PUT', '/api/avatar', { body: bytes as BodyInit, headers: { 'content-type': type, 'x-csrf-token': await c.ensureCsrf() } });

describe('profile pictures', () => {
  it('upload → metadata → fetched by the owner AND by another signed-in user with safe headers; replace; delete', async () => {
    const s = await makeStudent();
    const e = await makeEmployer();
    const sid = await me(s.client);
    expect((await s.client.get('/api/avatar/me')).body.updatedAt).toBeNull();
    const up = await put(s.client, PNG);
    expect(up.status).toBe(200);
    expect((await s.client.get('/api/avatar/me')).body.updatedAt).toBe(up.body.updatedAt);
    for (const who of [s.client, e.client]) {
      const d = await who.download(`/api/avatar/${sid}`);
      expect(d.status).toBe(200);
      expect(d.headers.get('content-type')).toBe('image/png');
      expect(d.headers.get('x-content-type-options')).toBe('nosniff');
      expect([...d.bytes]).toEqual([...PNG]);
    }
    expect((await put(s.client, WEBP, 'image/webp')).status).toBe(200); // replace
    expect((await sql('SELECT mime FROM avatars'))).toEqual([{ mime: 'image/webp' }]);
    expect((await s.client.delete('/api/avatar')).status).toBe(200);
    expect((await e.client.download(`/api/avatar/${sid}`)).status).toBe(404);
  });
  it('rejects non-images (content sniffed, not the declared type), oversize files, anonymous callers, and missing CSRF', async () => {
    const s = await makeStudent();
    const sid = await me(s.client);
    const html = new TextEncoder().encode('<script>alert(1)</script>');
    expect((await put(s.client, html, 'image/png')).body.error.code).toBe('AVATAR_TYPE_INVALID');
    expect((await put(s.client, new Uint8Array(0))).body.error.code).toBe('AVATAR_TYPE_INVALID');
    const big = new Uint8Array(160 * 1024); big.set(PNG);
    expect((await put(s.client, big)).status).toBe(413);
    expect((await sql('SELECT 1 FROM avatars')).length).toBe(0);
    expect((await new Client().get('/api/avatar/me')).status).toBe(401);
    expect((await new Client().download(`/api/avatar/${sid}`)).status).toBe(401);
    const noCsrf = await s.client.raw('PUT', '/api/avatar', { body: PNG as BodyInit, headers: { 'content-type': 'image/png' } });
    expect(noCsrf.status).toBe(403);
  });
  it('deleting the account removes the picture', async () => {
    const s = await makeStudent();
    await put(s.client, PNG);
    expect((await s.client.json('DELETE', '/api/profile', { password: s.payload.password })).status).toBe(200);
    expect(await sql('SELECT 1 FROM avatars')).toEqual([]);
  });
});
