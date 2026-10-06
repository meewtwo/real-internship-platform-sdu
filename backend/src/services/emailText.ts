/** Localised e-mail bodies for instant notifications and the weekly digest. Every dynamic value is HTML-escaped; plain text mirrors the HTML. */
import type { Language } from '@sdu/shared';
import { escapeHtml as h } from '../lib/mail';

type P = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

const STATUS: Record<Language, Record<string, string>> = {
  en: { applied: 'Applied', viewed: 'Viewed', shortlisted: 'Shortlisted', interview: 'Interview', accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Withdrawn' },
  ru: { applied: 'Отклик отправлен', viewed: 'Просмотрен', shortlisted: 'В шорт-листе', interview: 'Собеседование', accepted: 'Принят', rejected: 'Отказ', withdrawn: 'Отозван' },
  kk: { applied: 'Жіберілді', viewed: 'Қаралды', shortlisted: 'Шорт-листте', interview: 'Сұхбат', accepted: 'Қабылданды', rejected: 'Бас тартылды', withdrawn: 'Қайтарып алынды' },
};

const INT: Record<Language, Record<string, string>> = {
  en: { proposed: 'proposed', accepted: 'confirmed', declined: 'declined', cancelled: 'cancelled' },
  ru: { proposed: 'предложено', accepted: 'подтверждено', declined: 'отклонено', cancelled: 'отменено' },
  kk: { proposed: 'ұсынылды', accepted: 'расталды', declined: 'қабылданбады', cancelled: 'бас тартылды' },
};
const INT_BODY: Record<Language, Record<string, (p: P) => string>> = {
  en: { proposed: (p) => `${s(p.from)} proposed an interview for “${s(p.title)}” on ${s(p.when)}.`, accepted: (p) => `${s(p.from)} confirmed the interview for “${s(p.title)}” on ${s(p.when)}.`, declined: (p) => `${s(p.from)} declined the interview for “${s(p.title)}” (${s(p.when)}).`, cancelled: (p) => `${s(p.from)} cancelled the interview for “${s(p.title)}” (${s(p.when)}).` },
  ru: { proposed: (p) => `${s(p.from)} предлагает собеседование по «${s(p.title)}»: ${s(p.when)}.`, accepted: (p) => `${s(p.from)} подтвердил(а) собеседование по «${s(p.title)}»: ${s(p.when)}.`, declined: (p) => `${s(p.from)} отклонил(а) собеседование по «${s(p.title)}» (${s(p.when)}).`, cancelled: (p) => `${s(p.from)} отменил(а) собеседование по «${s(p.title)}» (${s(p.when)}).` },
  kk: { proposed: (p) => `${s(p.from)} «${s(p.title)}» бойынша сұхбатты ұсынады: ${s(p.when)}.`, accepted: (p) => `${s(p.from)} «${s(p.title)}» бойынша сұхбатты растады: ${s(p.when)}.`, declined: (p) => `${s(p.from)} «${s(p.title)}» бойынша сұхбаттан бас тартты (${s(p.when)}).`, cancelled: (p) => `${s(p.from)} «${s(p.title)}» бойынша сұхбатты болдырмады (${s(p.when)}).` },
};
const interviewBody = (lang: Language, p: P) => (INT_BODY[lang][s(p.state)] ?? (() => `${s(p.title)}: ${s(p.state)}`))(p);

interface Strings {
  brand: string; hello: (n: string) => string; open: string; unsub: string; unsubDigest: string; manage: string;
  instant: Record<string, { subject: (p: P, st: Record<string, string>) => string; body: (p: P, st: Record<string, string>) => string }>;
  digest: { subject: string; intro: string; matches: string; saved: string; status: string; deadlines: string; newApplicants: string; pending: (n: number) => string; match: (p: number) => string; deadline: (d: string) => string; apps: (n: number) => string; footer: string };
}
const T: Record<Language, Strings> = {
  en: {
    brand: 'SDU Career Match', hello: (n) => `Hello${n ? ', ' + n : ''}!`, open: 'Open in SDU Career Match', unsub: 'Unsubscribe from instant e-mails', unsubDigest: 'Unsubscribe from the weekly digest', manage: 'Manage notification settings',
    instant: {
      status_changed: { subject: (p, st) => `${s(p.title)}: ${st[s(p.status)] ?? s(p.status)}`, body: (p, st) => `Your application for “${s(p.title)}” at ${s(p.company)} is now: ${st[s(p.status)] ?? s(p.status)}.` },
      invitation: { subject: (p) => `${s(p.company)} invites you to apply`, body: (p) => `${s(p.company)} invites you to apply for “${s(p.title)}”.` },
      new_application: { subject: (p) => `New application: ${s(p.title)}`, body: (p) => `${s(p.student)} applied to “${s(p.title)}” (${s(p.percent)}% match).` },
      employer_approved: { subject: () => 'Your company was approved', body: () => 'Your company was approved — you can publish vacancies now.' },
      new_message: { subject: (p) => `New message: ${s(p.title)}`, body: (p) => `${s(p.from)} wrote to you about “${s(p.title)}”.` },
      interview_update: { subject: (p) => `Interview ${INT.en[s(p.state)] ?? s(p.state)}: ${s(p.title)}`, body: (p) => interviewBody('en', p) },
    },
    digest: { subject: 'Your weekly SDU Career Match digest', intro: 'Here is what happened this week.', matches: 'New matches for you', saved: 'From your saved searches', status: 'Application updates', deadlines: 'Closing soon', newApplicants: 'New applicants', pending: (n) => `${n} application(s) are waiting for your decision.`, match: (p) => `${p}% match`, deadline: (d) => `deadline ${d}`, apps: (n) => `${n} new`, footer: 'You receive this because the weekly digest is on in your account.' },
  },
  ru: {
    brand: 'SDU Career Match', hello: (n) => `Здравствуйте${n ? ', ' + n : ''}!`, open: 'Открыть в SDU Career Match', unsub: 'Отписаться от мгновенных писем', unsubDigest: 'Отписаться от еженедельной сводки', manage: 'Настройки уведомлений',
    instant: {
      status_changed: { subject: (p, st) => `${s(p.title)}: ${st[s(p.status)] ?? s(p.status)}`, body: (p, st) => `Статус вашего отклика на «${s(p.title)}» (${s(p.company)}): ${st[s(p.status)] ?? s(p.status)}.` },
      invitation: { subject: (p) => `${s(p.company)} приглашает откликнуться`, body: (p) => `${s(p.company)} приглашает вас откликнуться на «${s(p.title)}».` },
      new_application: { subject: (p) => `Новый отклик: ${s(p.title)}`, body: (p) => `${s(p.student)} откликнулся на «${s(p.title)}» (совпадение ${s(p.percent)}%).` },
      employer_approved: { subject: () => 'Ваша компания одобрена', body: () => 'Ваша компания одобрена — теперь можно публиковать вакансии.' },
      new_message: { subject: (p) => `Новое сообщение: ${s(p.title)}`, body: (p) => `${s(p.from)} написал(а) вам по поводу «${s(p.title)}».` },
      interview_update: { subject: (p) => `Собеседование — ${INT.ru[s(p.state)] ?? s(p.state)}: ${s(p.title)}`, body: (p) => interviewBody('ru', p) },
    },
    digest: { subject: 'Ваша еженедельная сводка SDU Career Match', intro: 'Что произошло за неделю.', matches: 'Новые совпадения', saved: 'По вашим сохранённым поискам', status: 'Обновления по откликам', deadlines: 'Скоро закрываются', newApplicants: 'Новые отклики', pending: (n) => `Откликов, ожидающих вашего решения: ${n}.`, match: (p) => `совпадение ${p}%`, deadline: (d) => `дедлайн ${d}`, apps: (n) => `новых: ${n}`, footer: 'Вы получаете это письмо, потому что в вашем аккаунте включена еженедельная сводка.' },
  },
  kk: {
    brand: 'SDU Career Match', hello: (n) => `Сәлеметсіз бе${n ? ', ' + n : ''}!`, open: 'SDU Career Match-те ашу', unsub: 'Лезде келетін хаттардан бас тарту', unsubDigest: 'Апталық шолудан бас тарту', manage: 'Хабарландыру параметрлері',
    instant: {
      status_changed: { subject: (p, st) => `${s(p.title)}: ${st[s(p.status)] ?? s(p.status)}`, body: (p, st) => `«${s(p.title)}» (${s(p.company)}) бойынша өтінішіңіздің мәртебесі: ${st[s(p.status)] ?? s(p.status)}.` },
      invitation: { subject: (p) => `${s(p.company)} өтініш беруге шақырады`, body: (p) => `${s(p.company)} сізді «${s(p.title)}» вакансиясына өтініш беруге шақырады.` },
      new_application: { subject: (p) => `Жаңа өтініш: ${s(p.title)}`, body: (p) => `${s(p.student)} «${s(p.title)}» вакансиясына өтініш берді (сәйкестік ${s(p.percent)}%).` },
      employer_approved: { subject: () => 'Компанияңыз мақұлданды', body: () => 'Компанияңыз мақұлданды — енді вакансия жариялай аласыз.' },
      new_message: { subject: (p) => `Жаңа хабарлама: ${s(p.title)}`, body: (p) => `${s(p.from)} сізге «${s(p.title)}» бойынша жазды.` },
      interview_update: { subject: (p) => `Сұхбат — ${INT.kk[s(p.state)] ?? s(p.state)}: ${s(p.title)}`, body: (p) => interviewBody('kk', p) },
    },
    digest: { subject: 'SDU Career Match апталық шолуыңыз', intro: 'Осы аптада болған оқиғалар.', matches: 'Жаңа сәйкестіктер', saved: 'Сақталған іздеулеріңіз бойынша', status: 'Өтініш жаңартулары', deadlines: 'Жақында жабылады', newApplicants: 'Жаңа өтініштер', pending: (n) => `Шешіміңізді күтіп тұрған өтініштер: ${n}.`, match: (p) => `сәйкестік ${p}%`, deadline: (d) => `мерзімі ${d}`, apps: (n) => `жаңа: ${n}`, footer: 'Бұл хатты аккаунтыңызда апталық шолу қосулы болғандықтан аласыз.' },
  },
};

const wrap = (lang: Language, inner: string, links: { unsub: string; unsubLabel: string; manage: string; manageLabel: string }, footer = '') =>
  `<!doctype html><html lang="${lang}"><body style="font-family:Arial,sans-serif;color:#1b2036;background:#f4f5f8;padding:24px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:16px;padding:28px">` +
  `<h2 style="margin:0 0 12px;color:#2f345c">${h(T[lang].brand)}</h2>${inner}` +
  `<hr style="border:0;border-top:1px solid #e3e6ec;margin:24px 0 12px"><p style="color:#566074;font-size:12px;line-height:1.6">${footer ? h(footer) + '<br>' : ''}<a href="${h(links.manage)}">${h(links.manageLabel)}</a> · <a href="${h(links.unsub)}">${h(links.unsubLabel)}</a></p></div></body></html>`;

export interface Links { open: string; unsub: string; unsubPostUrl: string; manage: string }

export function instantEmail(lang: Language, kind: string, params: P, name: string, links: Links) {
  const t = T[lang] ?? T.en, st = STATUS[lang] ?? STATUS.en;
  const k = t.instant[kind];
  if (!k) return null;
  const subject = k.subject(params, st), body = k.body(params, st);
  const text = `${t.hello(name)}\n\n${body}\n\n${t.open}: ${links.open}\n\n— ${t.brand}\n${t.manage}: ${links.manage}\n${t.unsub}: ${links.unsub}`;
  const html = wrap(lang, `<p>${h(t.hello(name))}</p><p style="font-size:16px">${h(body)}</p><p><a href="${h(links.open)}" style="display:inline-block;background:#2f345c;color:#fff;text-decoration:none;padding:10px 20px;border-radius:10px;font-weight:700">${h(t.open)}</a></p>`,
    { unsub: links.unsub, unsubLabel: t.unsub, manage: links.manage, manageLabel: t.manage });
  return { subject, text, html, headers: { 'List-Unsubscribe': `<${links.unsubPostUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

export interface DigestItem { title: string; sub?: string; url: string }
export interface DigestData {
  role: 'student' | 'employer';
  matches: DigestItem[]; saved: DigestItem[]; status: DigestItem[]; deadlines: DigestItem[]; applicants: DigestItem[]; pending: number;
}
export const digestIsEmpty = (d: DigestData) => !d.matches.length && !d.saved.length && !d.status.length && !d.deadlines.length && !d.applicants.length && d.pending === 0;

export function digestEmail(lang: Language, name: string, d: DigestData, links: Links) {
  const t = T[lang] ?? T.en;
  const sections: [string, DigestItem[]][] = [[t.digest.matches, d.matches], [t.digest.saved, d.saved], [t.digest.status, d.status], [t.digest.deadlines, d.deadlines], [t.digest.newApplicants, d.applicants]];
  const text = [`${t.hello(name)}`, '', t.digest.intro, '',
    ...sections.filter(([, i]) => i.length).flatMap(([title, items]) => [title.toUpperCase(), ...items.map((i) => `• ${i.title}${i.sub ? ` — ${i.sub}` : ''}\n  ${i.url}`), '']),
    ...(d.pending ? [t.digest.pending(d.pending), ''] : []), `${t.open}: ${links.open}`, '', t.digest.footer, `${t.manage}: ${links.manage}`, `${t.unsubDigest}: ${links.unsub}`].join('\n');
  const html = wrap(lang,
    `<p>${h(t.hello(name))}</p><p>${h(t.digest.intro)}</p>` +
    sections.filter(([, i]) => i.length).map(([title, items]) => `<h3 style="margin:18px 0 6px;color:#2f345c;font-size:15px">${h(title)}</h3><ul style="padding-left:18px;margin:0">${items.map((i) => `<li style="margin:4px 0"><a href="${h(i.url)}" style="color:#2b4fd0;font-weight:700">${h(i.title)}</a>${i.sub ? ` <span style="color:#566074">— ${h(i.sub)}</span>` : ''}</li>`).join('')}</ul>`).join('') +
    (d.pending ? `<p style="margin-top:14px;font-weight:700">${h(t.digest.pending(d.pending))}</p>` : '') +
    `<p style="margin-top:18px"><a href="${h(links.open)}" style="display:inline-block;background:#2f345c;color:#fff;text-decoration:none;padding:10px 20px;border-radius:10px;font-weight:700">${h(t.open)}</a></p>`,
    { unsub: links.unsub, unsubLabel: t.unsubDigest, manage: links.manage, manageLabel: t.manage }, t.digest.footer);
  return { subject: t.digest.subject, text, html, headers: { 'List-Unsubscribe': `<${links.unsubPostUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}
export const digestLabels = (lang: Language) => { const t = T[lang] ?? T.en; return { match: t.digest.match, deadline: t.digest.deadline, apps: t.digest.apps, status: STATUS[lang] ?? STATUS.en }; };

// ───────────────────────── plain-text notification (Telegram) ─────────────────────────
const EXTRA: Record<Language, { new_match: (p: P) => string; saved_search: (p: P) => string }> = {
  en: { new_match: (p) => `New ${s(p.percent)}% match: “${s(p.title)}” at ${s(p.company)}`, saved_search: (p) => `New in your saved search “${s(p.search)}”: “${s(p.title)}” at ${s(p.company)}` },
  ru: { new_match: (p) => `Новое совпадение ${s(p.percent)}%: «${s(p.title)}», ${s(p.company)}`, saved_search: (p) => `Новая вакансия по поиску «${s(p.search)}»: «${s(p.title)}», ${s(p.company)}` },
  kk: { new_match: (p) => `Жаңа сәйкестік ${s(p.percent)}%: «${s(p.title)}», ${s(p.company)}`, saved_search: (p) => `«${s(p.search)}» іздеуі бойынша жаңа: «${s(p.title)}», ${s(p.company)}` },
};
export const NOTIFY_KINDS_TELEGRAM = ['status_changed', 'invitation', 'new_application', 'employer_approved', 'new_match', 'saved_search', 'new_message', 'interview_update'] as const;
export function plainNotification(lang: Language, kind: string, params: P): string | null {
  const t = T[lang] ?? T.en, st = STATUS[lang] ?? STATUS.en;
  if (kind === 'new_match' || kind === 'saved_search') return EXTRA[lang][kind](params);
  return t.instant[kind]?.body(params, st) ?? null;
}
