import type { Language } from '@sdu/shared';
import type { Env } from '../env';
import { asDbError, type Db, type Queryable } from '../lib/db';
import { iso } from '../lib/sql';
import { randomToken, sha256Hex } from '../lib/crypto';
import { NOTIFY_KINDS_TELEGRAM, plainNotification } from './emailText';
import { SQL_TODAY } from './matching';

export const telegramConfigured = (env: Env) => !!env.TELEGRAM_BOT_TOKEN && !!env.TELEGRAM_WEBHOOK_SECRET;
const LINK_TTL_MIN = 15;
const MAX_ATTEMPTS = 5;

/** Calls the Bot API. `blocked` = the user blocked the bot / deleted the chat (we must stop sending, not retry). */
export async function tgSend(env: Env, chatId: number | string, text: string): Promise<'ok' | 'blocked' | 'fail'> {
  try {
    const r = await fetch(`${(env.TELEGRAM_API_BASE ?? 'https://api.telegram.org').replace(/\/+$/, '')}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      // no parse_mode: user-provided titles are sent as plain text, so nothing can be interpreted as markup
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
    });
    if (r.ok) return 'ok';
    if (r.status === 403 || r.status === 400) {
      const j = (await r.json().catch(() => null)) as { description?: string } | null;
      if (r.status === 403 || /chat not found|bot was blocked|user is deactivated/i.test(j?.description ?? '')) return 'blocked';
    }
    return 'fail';
  } catch { return 'fail'; }
}
export async function tgSetWebhook(env: Env, url: string): Promise<boolean> {
  try {
    const r = await fetch(`${(env.TELEGRAM_API_BASE ?? 'https://api.telegram.org').replace(/\/+$/, '')}/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'], drop_pending_updates: true }),
    });
    return r.ok;
  } catch { return false; }
}

/** One live token per user; only its hash is stored. */
export async function createLinkToken(db: Queryable, userId: string): Promise<string> {
  const token = randomToken(18);
  await db.query(
    `INSERT INTO telegram_link_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET token_hash = $1, expires_at = $3`, [await sha256Hex(token), userId, iso(LINK_TTL_MIN * 60_000)]);
  return token;
}

// ───────────────────────── bot texts ─────────────────────────
type Txt = { linked: string; already: string; badToken: string; stopped: string; notLinked: string; help: string; noMatches: string; matchesHead: string; employer: (n: number) => string };
const TX: Record<Language, Txt> = {
  en: { linked: '✅ Connected! You will get SDU Career Match notifications here. Commands: /matches, /stop', already: 'This Telegram chat is already linked to another account. Send /stop there first.', badToken: 'This link is invalid or expired. Create a new one in your SDU Career Match profile.', stopped: 'Disconnected. You will not receive notifications here any more.', notLinked: 'This chat is not connected. Open your SDU Career Match profile and press “Connect Telegram”.', help: 'Commands: /matches — your best matches, /stop — disconnect.', noMatches: 'No new matches right now.', matchesHead: 'Your best matches:', employer: (n) => `Applications waiting for your decision: ${n}` },
  ru: { linked: '✅ Подключено! Уведомления SDU Career Match будут приходить сюда. Команды: /matches, /stop', already: 'Этот чат Telegram уже привязан к другому аккаунту. Сначала отправьте там /stop.', badToken: 'Ссылка недействительна или устарела. Создайте новую в профиле SDU Career Match.', stopped: 'Отключено. Уведомления здесь больше не приходят.', notLinked: 'Чат не подключён. Откройте профиль SDU Career Match и нажмите «Подключить Telegram».', help: 'Команды: /matches — лучшие совпадения, /stop — отключить.', noMatches: 'Новых совпадений пока нет.', matchesHead: 'Ваши лучшие совпадения:', employer: (n) => `Откликов, ожидающих решения: ${n}` },
  kk: { linked: '✅ Қосылды! SDU Career Match хабарландырулары осында келеді. Командалар: /matches, /stop', already: 'Бұл Telegram чаты басқа аккаунтқа байланған. Алдымен онда /stop жіберіңіз.', badToken: 'Сілтеме жарамсыз немесе мерзімі өткен. SDU Career Match профиліңізде жаңасын жасаңыз.', stopped: 'Ажыратылды. Бұл жерге хабарландырулар келмейді.', notLinked: 'Чат қосылмаған. SDU Career Match профиліңізді ашып, «Telegram қосу» түймесін басыңыз.', help: 'Командалар: /matches — үздік сәйкестіктер, /stop — ажырату.', noMatches: 'Жаңа сәйкестіктер әзірше жоқ.', matchesHead: 'Үздік сәйкестіктеріңіз:', employer: (n) => `Шешіміңізді күтіп тұрған өтініштер: ${n}` },
};
const lang = (code?: string): Language => (code?.startsWith('ru') ? 'ru' : code?.startsWith('kk') ? 'kk' : 'en');

interface Update { message?: { chat?: { id?: number; type?: string }; text?: string; from?: { language_code?: string } } }
const isUpdate = (v: unknown): v is Update => typeof v === 'object' && v !== null;

/** Handles one webhook update. Every path ends in at most one reply; unknown/odd updates are ignored (Telegram must always get a 200). */
export async function handleUpdate(db: Db, env: Env, base: string, raw: unknown): Promise<void> {
  if (!isUpdate(raw)) return;
  const m = raw.message;
  const chatId = m?.chat?.id;
  if (!m || typeof chatId !== 'number' || !Number.isSafeInteger(chatId) || m.chat?.type !== 'private' || typeof m.text !== 'string') return;
  const text = m.text.trim().slice(0, 200);
  const cmd = /^\/([a-z]+)(?:@\w+)?(?:\s+(\S+))?/i.exec(text);
  const link = (await db.query<{ user_id: string; l: Language; role: string }>(
    `SELECT t.user_id, u.preferred_language AS l, u.role FROM telegram_links t JOIN users u ON u.id = t.user_id WHERE t.chat_id = $1`, [chatId])).rows[0];
  const L = link ? link.l : lang(m.from?.language_code);
  const T = TX[L];
  const reply = (s: string) => tgSend(env, chatId, s);

  if (cmd?.[1].toLowerCase() === 'start' && cmd[2]) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(cmd[2])) { await reply(T.badToken); return; }
    // consuming the token is one atomic DELETE … RETURNING (single use); the chat→account link is one UPSERT whose UNIQUE(chat_id) rejects a hijack
    const t = (await db.query<{ user_id: string }>('DELETE FROM telegram_link_tokens WHERE token_hash = $1 AND expires_at > $2 RETURNING user_id', [await sha256Hex(cmd[2]), iso()])).rows[0];
    let res: { kind: 'bad' } | { kind: 'taken' } | { kind: 'ok'; l: Language } = { kind: 'bad' };
    if (t) {
      try {
        await db.query(`INSERT INTO telegram_links (user_id, chat_id) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET chat_id = $2, enabled = 1, linked_at = $3`, [t.user_id, chatId, iso()]);
        // a freshly linked chat only receives what happens from now on — never a backlog of earlier notifications
        await db.query('UPDATE notifications SET tg_sent_at = $2 WHERE user_id = $1 AND tg_sent_at IS NULL', [t.user_id, iso()]);
        const u = (await db.query<{ l: Language }>('SELECT preferred_language AS l FROM users WHERE id = $1', [t.user_id])).rows[0];
        res = { kind: 'ok', l: u?.l ?? L };
      } catch (e) { if (asDbError(e).code === '23505') res = { kind: 'taken' }; else throw e; }
    }
    await reply(res.kind === 'ok' ? TX[res.l].linked : res.kind === 'taken' ? T.already : T.badToken);
    return;
  }
  if (cmd?.[1].toLowerCase() === 'stop') {
    const r = await db.query('DELETE FROM telegram_links WHERE chat_id = $1', [chatId]);
    await reply(r.rowCount ? T.stopped : T.notLinked);
    return;
  }
  if (!link) { await reply(T.notLinked); return; }
  if (cmd?.[1].toLowerCase() === 'matches') {
    if (link.role === 'employer') {
      const n = (await db.query<{ n: number }>(`SELECT count(*) AS n FROM applications a JOIN vacancies v ON v.id = a.vacancy_id WHERE v.employer_id = $1 AND a.status = 'applied'`, [link.user_id])).rows[0].n;
      await reply(T.employer(n)); return;
    }
    const rows = (await db.query<{ id: string; title: string; company: string; percent: number }>(
      `SELECT v.id, v.title, ep.company_name AS company, m.percent FROM matches m JOIN vacancies v ON v.id = m.vacancy_id JOIN employer_profiles ep ON ep.user_id = v.employer_id
       WHERE m.student_id = $1 AND m.percent >= 60 AND v.status = 'published' AND (v.deadline IS NULL OR v.deadline >= ${SQL_TODAY})
         AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.vacancy_id = v.id AND a.student_id = $1 AND a.status <> 'withdrawn')
       ORDER BY m.percent DESC, v.id LIMIT 5`, [link.user_id])).rows;
    await reply(rows.length ? `${T.matchesHead}\n${rows.map((r) => `• ${r.percent}% — ${r.title}, ${r.company}\n${base}/vacancies/${r.id}`).join('\n')}` : T.noMatches);
    return;
  }
  await reply(T.help);
}

interface Row { id: number; user_id: string; kind: string; params: Record<string, unknown>; link: string | null; chat_id: string; l: Language }
/** Same outbox pattern as e-mail: batches are claimed by one atomic UPDATE, retried ≤5 times, and a blocked bot unlinks the chat. */
export async function flushTelegram(db: Db, env: Env, base: string, limit = 25): Promise<{ sent: number; failed: number; unlinked: number }> {
  const out = { sent: 0, failed: 0, unlinked: 0 };
  if (!telegramConfigured(env)) return out;
  const claimed = await db.query<{ id: number }>(
    `UPDATE notifications SET tg_claimed_at = $1 WHERE id IN (
       SELECT n.id FROM notifications n WHERE n.tg_sent_at IS NULL AND n.kind IN (SELECT value FROM json_each($2)) AND n.tg_attempts < $3 AND n.created_at > $4
         AND (n.tg_claimed_at IS NULL OR n.tg_claimed_at < $5)
         AND EXISTS (SELECT 1 FROM telegram_links t JOIN users u ON u.id = t.user_id WHERE t.user_id = n.user_id AND t.enabled = 1 AND u.status = 'active')
       ORDER BY n.id LIMIT $6) RETURNING id`,
    [iso(), JSON.stringify(NOTIFY_KINDS_TELEGRAM), MAX_ATTEMPTS, iso(-2 * 86400_000), iso(-120_000), limit]);
  if (!claimed.rows.length) return out;
  const { rows } = await db.query<Row>(
    `SELECT n.id, n.user_id, n.kind, n.params, n.link, CAST(t.chat_id AS TEXT) AS chat_id, u.preferred_language AS l
     FROM notifications n JOIN telegram_links t ON t.user_id = n.user_id JOIN users u ON u.id = n.user_id
     WHERE n.id IN (SELECT value FROM json_each($1)) ORDER BY n.id`, [JSON.stringify(claimed.rows.map((r) => r.id))]);
  for (const r of rows) {
    const body = plainNotification(r.l, r.kind, r.params);
    if (!body) { await db.query('UPDATE notifications SET tg_sent_at = $2 WHERE id = $1', [r.id, iso()]); continue; }
    const res = await tgSend(env, r.chat_id, `${body}\n${base}${r.link ?? '/notifications'}`);
    if (res === 'ok') { await db.query('UPDATE notifications SET tg_sent_at = $2 WHERE id = $1', [r.id, iso()]); out.sent++; }
    else if (res === 'blocked') { await db.batch([{ sql: 'DELETE FROM telegram_links WHERE user_id = $1', params: [r.user_id] }, { sql: 'UPDATE notifications SET tg_sent_at = $2 WHERE id = $1', params: [r.id, iso()] }]); out.unlinked++; }
    else { await db.query('UPDATE notifications SET tg_attempts = tg_attempts + 1, tg_claimed_at = NULL WHERE id = $1', [r.id]); out.failed++; }
  }
  return out;
}
