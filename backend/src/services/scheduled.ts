import type { Env } from '../env';
import { Db } from '../lib/db';
import { runDigest } from './digest';
import { appBase } from './emailLinks';
import { flushInstantEmails } from './emailQueue';
import { flushTelegram } from './telegram';
import { backfillEmbeddings } from './embeddings';
import { publishRequestedDrafts } from './publish';

// Cron entry point (Cloudflare Cron Triggers and `npm run digest`): the every-15-minutes cron retries failed instant mails; the weekly cron also sends the digest.
export async function runScheduled(env: Env, cron: string): Promise<void> {
  const db = new Db(env);
  try {
    const base = appBase(env);
    // drafts requested for publication whose company is approved by now (and retries of a failed publish right after approval)
    const published = await publishRequestedDrafts(db, env).catch((e) => { console.error(JSON.stringify({ level: 'error', msg: 'requested publish sweep failed', detail: (e as Error).message })); return 0; });
    const instant = await flushInstantEmails(db, env, base, 100);
    const telegram = await flushTelegram(db, env, base, 100);
    const embeddings = await backfillEmbeddings(db, env, 50);
    const digest = cron === '*/15 * * * *' ? null : await runDigest(db, env, { base, limit: 500 });
    console.log(JSON.stringify({ level: 'info', msg: 'scheduled run', cron, published, instant, telegram, embeddings, digest }));
  } finally { await db.close(); }
}
