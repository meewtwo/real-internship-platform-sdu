// Local / test server (Node). Same Hono app as the Worker.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app';
import { nodeEnv } from './envNode';
import './lib/dbNode';
import { migrate } from './cli/migrate';

const api = createApp();
const env = nodeEnv();
await migrate(env.SQLITE_PATH, () => undefined); // local SQLite file: always up to date on start (production D1 is migrated with wrangler)
const app = new Hono();
app.route('/', api);
if (process.env.SERVE_STATIC === '1') {
  // Same-origin static hosting for `docker compose up` (on Cloudflare this is done by Workers Assets + public/_headers).
  const dir = process.env.STATIC_DIR ?? '../frontend/dist';
  const CSP = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  app.use('*', async (c, next) => {
    await next();
    if (!c.req.path.startsWith('/api/')) {
      c.res.headers.set('Content-Security-Policy', CSP);
      c.res.headers.set('X-Content-Type-Options', 'nosniff');
      c.res.headers.set('X-Frame-Options', 'DENY');
      c.res.headers.set('Referrer-Policy', 'no-referrer');
    }
  });
  app.all('/api/*', (c) => c.json({ error: { code: 'NOT_FOUND' } }, 404)); // unmatched API routes never fall through to the SPA
  app.use('*', serveStatic({ root: dir }));
  app.get('*', serveStatic({ path: `${dir}/index.html` }));
}
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: (req) => app.fetch(req, env), port, hostname: process.env.HOST ?? '127.0.0.1' }, (i) => console.log(`API listening on http://127.0.0.1:${i.port} (${env.ENVIRONMENT})`));
