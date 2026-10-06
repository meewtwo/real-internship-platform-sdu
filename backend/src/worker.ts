// Cloudflare Workers entry. Static frontend is served by Workers Assets; only /api/* reaches this code.
import { createApp } from './app';
import type { Env } from './env';
import { Db } from './lib/db';
import { processJob } from './services/jobs';
import { runScheduled } from './services/scheduled';

interface QueueMessage { body: unknown; ack(): void; retry(): void }
const app = createApp();
export default {
  fetch: (req: Request, env: Env, ctx: unknown) => app.fetch(req, env, ctx as never),
  scheduled: (event: { cron: string }, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }) => { ctx.waitUntil(runScheduled(env, event.cron)); },
  /** Queue consumer: one connection for the batch; a failed message is retried (Cloudflare re-delivers up to max_retries, then dead-letters). */
  queue: async (batch: { messages: QueueMessage[] }, env: Env) => {
    const db = new Db(env);
    try {
      for (const m of batch.messages) {
        try { await processJob(db, env, m.body); m.ack(); }
        catch (e) { console.error(JSON.stringify({ level: 'error', msg: 'job failed', detail: (e as Error).message })); m.retry(); }
      }
    } finally { await db.close(); }
  },
};
