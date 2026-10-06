import { isProd, isTest, type Env } from '../env';
import type { Language } from '@sdu/shared';

type Purpose = 'register' | 'reset';

const T: Record<Language, { subject: Record<Purpose, string>; hello: (n: string) => string; intro: Record<Purpose, string>; expires: string; ignore: string; brand: string }> = {
  en: {
    subject: { register: 'Your SDU Career Match verification code', reset: 'Your SDU Career Match password reset code' },
    hello: (n) => `Hello${n ? ', ' + n : ''}!`,
    intro: { register: 'Use this code to verify your email address:', reset: 'Use this code to reset your password:' },
    expires: 'The code is valid for 10 minutes. Never share it with anyone.',
    ignore: 'If you did not request this, you can safely ignore this email.',
    brand: 'SDU Career Match',
  },
  ru: {
    subject: { register: 'Код подтверждения SDU Career Match', reset: 'Код сброса пароля SDU Career Match' },
    hello: (n) => `Здравствуйте${n ? ', ' + n : ''}!`,
    intro: { register: 'Используйте этот код, чтобы подтвердить адрес электронной почты:', reset: 'Используйте этот код, чтобы сбросить пароль:' },
    expires: 'Код действителен 10 минут. Никому не сообщайте его.',
    ignore: 'Если вы не запрашивали это письмо, просто проигнорируйте его.',
    brand: 'SDU Career Match',
  },
  kk: {
    subject: { register: 'SDU Career Match растау коды', reset: 'SDU Career Match құпия сөзді қалпына келтіру коды' },
    hello: (n) => `Сәлеметсіз бе${n ? ', ' + n : ''}!`,
    intro: { register: 'Электрондық поштаңызды растау үшін осы кодты пайдаланыңыз:', reset: 'Құпия сөзді қалпына келтіру үшін осы кодты пайдаланыңыз:' },
    expires: 'Код 10 минут жарамды. Оны ешкімге айтпаңыз.',
    ignore: 'Егер сіз бұл хатты сұрамаған болсаңыз, оған назар аудармаңыз.',
    brand: 'SDU Career Match',
  },
};

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function buildCodeEmail(lang: Language, purpose: Purpose, code: string, name: string) {
  const t = T[lang] ?? T.en;
  const text = `${t.hello(name)}\n\n${t.intro[purpose]}\n\n    ${code}\n\n${t.expires}\n${t.ignore}\n\n— ${t.brand}`;
  const html = `<!doctype html><html lang="${lang}"><body style="font-family:Arial,sans-serif;color:#002B5C;background:#f2f7ff;padding:24px">
<div style="max-width:480px;margin:auto;background:#fff;border-radius:16px;padding:28px">
<h2 style="margin:0 0 12px;color:#0B5ED7">${escapeHtml(t.brand)}</h2>
<p>${escapeHtml(t.hello(name))}</p><p>${escapeHtml(t.intro[purpose])}</p>
<p style="font-size:34px;letter-spacing:10px;font-weight:700;margin:20px 0">${escapeHtml(code)}</p>
<p style="color:#475569;font-size:14px">${escapeHtml(t.expires)}<br>${escapeHtml(t.ignore)}</p></div></body></html>`;
  return { subject: t.subject[purpose], text, html };
}

/** `Name <addr@host>` → { email, name } (the Email Sending binding wants the parts separately). */
export function parseFrom(from: string): { email: string; name?: string } {
  const m = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(from);
  return m ? { email: m[2], ...(m[1] ? { name: m[1].replace(/^"|"$/g, '') } : {}) } : { email: from.trim() };
}

export interface SentMail { to: string; subject: string; text: string; code: string; purpose: Purpose; lang: Language; at: number }
const outbox: SentMail[] = ((globalThis as { __outbox?: SentMail[] }).__outbox ??= []);
export const getOutbox = () => outbox;

export async function sendCodeEmail(env: Env, args: { to: string; lang: Language; purpose: Purpose; code: string; name: string }): Promise<void> {
  const { subject, text, html } = buildCodeEmail(args.lang, args.purpose, args.code, args.name);
  if (isTest(env)) {
    outbox.push({ to: args.to, subject, text, code: args.code, purpose: args.purpose, lang: args.lang, at: Date.now() });
    if (outbox.length > 500) outbox.shift();
  }
  if (!isProd(env)) console.log(`[mail] ${args.purpose} code for ${args.to} (${args.lang}): ${args.code}`);
  const from = env.MAIL_FROM ?? 'SDU Career Match <no-reply@localhost>';
  try {
    if (env.EMAIL) {
      await env.EMAIL.send({ from: parseFrom(from), to: args.to, subject, text, html });
    } else if (env.RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [args.to], subject, text, html }),
      });
      if (!r.ok) console.error('[mail] resend failed', r.status);
    } else if (env.MAILPIT_URL) {
      const m = /^(.*)<(.+)>$/.exec(from);
      const r = await fetch(`${env.MAILPIT_URL}/api/v1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ From: { Email: (m ? m[2] : from).trim(), Name: m ? m[1].trim() : '' }, To: [{ Email: args.to }], Subject: subject, Text: text, HTML: html }),
      });
      if (!r.ok) console.error('[mail] mailpit failed', r.status);
    } else if (isProd(env)) {
      console.error('[mail] no mail provider configured (set RESEND_API_KEY)');
    }
  } catch (e) {
    console.error('[mail] send error', (e as Error).message); // never log code/password
  }
}

// ───────────────────────── generic mail (notifications, digest) ─────────────────────────
export interface MailMessage { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }
export interface SentGeneric extends MailMessage { kind: string; at: number }
const mailbox: SentGeneric[] = ((globalThis as { __mailbox?: SentGeneric[] }).__mailbox ??= []);
export const getMailbox = () => mailbox;
let forcedFailure = false;
/** Test hook: make every generic send report failure. */
export const setMailFailure = (v: boolean) => { forcedFailure = v; };

/** Sends one mail through the configured provider. Returns true when the provider accepted it (or in dev/test), false on failure. Never throws. */
export async function sendMail(env: Env, msg: MailMessage & { kind: string }): Promise<boolean> {
  if (isTest(env)) {
    if (forcedFailure) return false;
    mailbox.push({ ...msg, at: Date.now() });
    if (mailbox.length > 1000) mailbox.shift();
  }
  if (!isProd(env)) console.log(`[mail] ${msg.kind} to ${msg.to}: ${msg.subject}`);
  const from = env.MAIL_FROM ?? 'SDU Career Match <no-reply@localhost>';
  try {
    if (env.EMAIL) {
      await env.EMAIL.send({ from: parseFrom(from), to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, ...(msg.headers ? { headers: msg.headers } : {}) });
      return true;
    }
    if (env.RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html, headers: msg.headers }),
      });
      if (!r.ok) { console.error('[mail] resend failed', r.status); return false; }
      return true;
    }
    if (env.MAILPIT_URL) {
      const m = /^(.*)<(.+)>$/.exec(from);
      const r = await fetch(`${env.MAILPIT_URL}/api/v1/send`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ From: { Email: (m ? m[2] : from).trim(), Name: m ? m[1].trim() : '' }, To: [{ Email: msg.to }], Subject: msg.subject, Text: msg.text, HTML: msg.html, Headers: msg.headers }),
      });
      if (!r.ok) { console.error('[mail] mailpit failed', r.status); return false; }
      return true;
    }
    if (isProd(env)) { console.error('[mail] no mail provider configured (set RESEND_API_KEY)'); return false; }
    return true;
  } catch (e) {
    console.error('[mail] send error', (e as Error).message);
    return false;
  }
}
