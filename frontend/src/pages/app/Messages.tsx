import { CalendarCheck, CalendarPlus, Download, Loader2, MessageSquare, Send, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { INTERVIEW_FORMATS } from '@sdu/shared';
import { Card, LoadState, PageHeader, btnDanger, btnGhost, btnPrimary } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { apiErrText } from '../../lib/errors';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';

const ALMATY = 'Asia/Almaty';
const LOCALES: Record<string, string> = { en: 'en-GB', ru: 'ru-RU', kk: 'kk-KZ' };
function useFmt() {
  const { i18n } = useTranslation();
  const loc = LOCALES[i18n.language] ?? 'en-GB';
  return {
    when: (iso: string) => new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short', timeZone: ALMATY }).format(new Date(iso)),
    time: (iso: string) => new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', timeZone: ALMATY }).format(new Date(iso)),
    day: (iso: string) => new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeZone: ALMATY }).format(new Date(iso)),
  };
}

interface Thread { applicationId: string; status: string; vacancy: { id: string; title: string }; counterpart: string; last: { body: string; at: string; mine: boolean }; unread: number }

export function MessagesList() {
  const { t } = useTranslation();
  usePageTitle('nav.messages');
  const fmt = useFmt();
  const { data, error, loading, reload } = useApi<{ threads: Thread[] }>('/api/messages/threads');
  useEffect(() => { const h = setInterval(() => void reload(), 20_000); return () => clearInterval(h); }, [reload]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('app:chat.title')} subtitle={t('app:chat.subtitle')} />
      <LoadState loading={loading && !data} error={error} empty={!!data && data.threads.length === 0} emptyText={t('app:chat.empty')} />
      <ul className="space-y-2">
        {data?.threads.map((th) => (
          <li key={th.applicationId}>
            <Link to={`/messages/${th.applicationId}`} className="block rounded-2xl border border-line bg-white p-4 shadow-sm transition hover:bg-brand-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="truncate text-[15px] font-extrabold text-navy">{th.counterpart}</p><p className="truncate text-[12px] text-muted">{th.vacancy.title}</p></div>
                <div className="flex shrink-0 flex-col items-end gap-1"><span className="text-[12px] text-muted">{fmt.day(th.last.at)}</span>{th.unread > 0 && <span className="rounded-full bg-orange-dark px-2 py-0.5 text-[11px] font-extrabold text-white" aria-label={t('app:chat.unread', { n: th.unread })}>{th.unread}</span>}</div>
              </div>
              <p className={`mt-1 truncate text-[14px] ${th.unread > 0 ? 'font-bold text-ink' : 'text-muted'}`}>{th.last.mine ? `${t('app:chat.you')}: ` : ''}{th.last.body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Msg { id: string; mine: boolean; body: string; at: string; read: boolean }
interface ThreadData { messages: Msg[]; counterpart: string; role: 'student' | 'employer'; status: string; canSend: boolean; vacancy: { id: string; title: string } }
interface Interview { id: string; applicationId: string; startsAt: string; durationMin: number; format: string; location: string; note: string | null; status: string; proposedByMe: boolean; counterpart: string }

export function MessageThread() {
  const { t } = useTranslation();
  const { applicationId } = useParams();
  usePageTitle('nav.messages');
  const fmt = useFmt();
  const toast = useToast();
  const [meta, setMeta] = useState<Omit<ThreadData, 'messages'> | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [err, setErr] = useState<string>('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const last = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const load = useCallback(async (initial: boolean) => {
    try {
      const r = await api<ThreadData>('GET', `/api/messages/${applicationId}${!initial && last.current ? `?after=${last.current}` : ''}`);
      setMeta({ counterpart: r.counterpart, role: r.role, status: r.status, canSend: r.canSend, vacancy: r.vacancy });
      if (initial) setMsgs(r.messages); else if (r.messages.length) setMsgs((m) => [...m, ...r.messages.filter((x) => !m.some((y) => y.id === x.id))]);
      if (r.messages.length) last.current = r.messages[r.messages.length - 1].id;
      setErr('');
    } catch (e) { if (initial) setErr(apiErrText(t, e)); }
  }, [applicationId, t]);
  useEffect(() => { last.current = null; setMsgs([]); setMeta(null); void load(true); const h = setInterval(() => { if (!document.hidden) void load(false); }, 8000); return () => clearInterval(h); }, [load]);
  useEffect(() => { if (stick.current) box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const r = await api<{ message: Msg }>('POST', `/api/messages/${applicationId}`, { body });
      setMsgs((m) => [...m, r.message]); last.current = r.message.id; setText(''); stick.current = true;
    } catch (e) { toast(apiErrText(t, e), 'error'); } finally { setBusy(false); }
  };
  if (err) return <p role="alert" className="rounded-2xl bg-white p-4 font-semibold text-danger-text">{err}</p>;
  if (!meta) return <LoadState loading error={null} />;
  let prevDay = '';
  return (
    <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_340px]">
      <div>
        <Link to="/messages" className="mb-2 inline-block text-[13px] font-bold text-brand hover:underline">{t('app:chat.back')}</Link>
        <Card className="!p-0">
          <div className="border-b border-line px-4 py-3"><h1 className="text-[18px] font-extrabold text-navy">{meta.counterpart}</h1><p className="text-[12px] text-muted">{meta.vacancy.title}</p></div>
          <div ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }} role="log" aria-live="polite" aria-label={t('app:chat.title')} className="h-[52vh] space-y-2 overflow-y-auto bg-page px-4 py-3">
            {msgs.length === 0 && <p className="py-8 text-center text-[14px] text-muted">{t('app:chat.noMessages')}</p>}
            {msgs.map((m) => {
              const day = fmt.day(m.at); const sep = day !== prevDay; prevDay = day;
              return (
                <div key={m.id}>
                  {sep && <p className="my-2 text-center text-[11px] font-bold uppercase tracking-wide text-muted">{day}</p>}
                  <div className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[14px] ${m.mine ? 'bg-navy text-white' : 'bg-white text-ink ring-1 ring-line'}`}>{m.body}
                      <span className={`mt-0.5 block text-right text-[10.5px] ${m.mine ? 'text-white/70' : 'text-muted'}`}>{fmt.time(m.at)}{m.mine && (m.read ? ` · ${t('app:chat.seen')}` : '')}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="border-t border-line p-3">
            {meta.canSend ? (
              <div className="flex items-end gap-2">
                <label className="sr-only" htmlFor="chat-input">{t('app:chat.placeholder')}</label>
                <textarea id="chat-input" value={text} rows={2} maxLength={2000} placeholder={t('app:chat.placeholder')} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} className="min-h-[44px] flex-1 rounded-xl border-[1.5px] border-slate-300 bg-white p-2.5 text-[14px]" />
                <button type="submit" disabled={busy || !text.trim()} className={btnPrimary} aria-label={t('app:chat.send')}>{busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}{t('app:chat.send')}</button>
              </div>
            ) : <p className="text-center text-[13px] font-semibold text-muted">{t('app:chat.closed')}</p>}
          </form>
        </Card>
      </div>
      <InterviewPanel applicationId={applicationId!} role={meta.role} status={meta.status} />
    </div>
  );
}

function InterviewPanel({ applicationId, role, status }: { applicationId: string; role: 'student' | 'employer'; status: string }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const toast = useToast();
  const { user } = useAuth();
  const { data, reload } = useApi<{ interviews: Interview[] }>('/api/interviews');
  const mine = (data?.interviews ?? []).filter((i) => i.applicationId === applicationId);
  const live = mine.find((i) => i.status === 'proposed' || i.status === 'accepted');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ at: '', dur: '45', format: 'online', location: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const act = async (path: string, body?: unknown, ok?: string) => { try { await api('POST', path, body); if (ok) toast(ok); await reload(); } catch (e) { toast(apiErrText(t, e), 'error'); } };
  const propose = async () => {
    setBusy(true); setErr('');
    try {
      // the employer types a local (Almaty, UTC+05:00) wall-clock time; the API stores an unambiguous instant
      await api('POST', '/api/interviews', { applicationId, startsAt: `${f.at}:00+05:00`, durationMin: Number(f.dur), format: f.format, location: f.location, note: f.note || undefined });
      setOpen(false); setF({ at: '', dur: '45', format: 'online', location: '', note: '' }); toast(t('app:interviews.proposed')); await reload();
    } catch (e) { setErr(apiErrText(t, e)); } finally { setBusy(false); }
  };
  const field = 'h-9 w-full rounded-xl border-[1.5px] border-slate-300 bg-white px-2.5 text-[14px] font-normal';
  void user;
  return (
    <aside aria-label={t('app:interviews.title')}>
      <Card>
        <h2 className="mb-2 flex items-center gap-1.5 text-[15px] font-extrabold text-navy"><CalendarCheck size={16} aria-hidden />{t('app:interviews.title')}</h2>
        {live ? (
          <div className="space-y-1.5 text-[13px]">
            <p className="text-[16px] font-extrabold text-navy">{fmt.when(live.startsAt)} <span className="text-[12px] font-semibold text-muted">({t('app:interviews.almaty')})</span></p>
            <p>{t(`app:interviews.format.${live.format}`)} · {t('app:interviews.minutes', { n: live.durationMin })}</p>
            <p className="break-all">{/^https:\/\//.test(live.location) ? <a className="text-brand underline" href={live.location} target="_blank" rel="noopener noreferrer nofollow">{live.location}</a> : live.location}</p>
            {live.note && <p className="rounded-lg bg-slate-50 px-2 py-1 text-muted">{live.note}</p>}
            <p className={`inline-block rounded-full px-2 py-0.5 text-[12px] font-bold ${live.status === 'accepted' ? 'bg-ok/15 text-ok-text' : 'bg-amber-100 text-amber-900'}`}>{t(`app:interviews.state.${live.status}`)}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {role === 'student' && live.status === 'proposed' && <><button type="button" className={btnPrimary} onClick={() => void act(`/api/interviews/${live.id}/respond`, { accept: true }, t('app:interviews.accepted'))}>{t('app:interviews.accept')}</button>
                <button type="button" className={btnGhost} onClick={() => void act(`/api/interviews/${live.id}/respond`, { accept: false })}>{t('app:interviews.decline')}</button></>}
              {(role === 'employer' || live.status === 'accepted') && <button type="button" className={btnDanger} onClick={() => window.confirm(t('app:confirm')) && void act(`/api/interviews/${live.id}/cancel`, undefined, t('app:interviews.cancelled'))}><X size={14} aria-hidden />{t('app:interviews.cancel')}</button>}
              <a className={btnGhost} href={`/api/interviews/${live.id}/ics`} download><Download size={14} aria-hidden />{t('app:interviews.ics')}</a>
            </div>
          </div>
        ) : <p className="text-[13px] text-muted">{t('app:interviews.none')}</p>}
        {role === 'employer' && !live && ['applied', 'viewed', 'shortlisted', 'interview', 'accepted'].includes(status) && !open && <button type="button" className={`${btnPrimary} mt-2`} onClick={() => setOpen(true)}><CalendarPlus size={16} aria-hidden />{t('app:interviews.propose')}</button>}
        {open && (
          <form onSubmit={(e) => { e.preventDefault(); void propose(); }} className="mt-3 space-y-2">
            <label className="block text-[12px] font-bold text-navy">{t('app:interviews.when')} ({t('app:interviews.almaty')})<input type="datetime-local" required value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} className={`${field} mt-0.5`} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[12px] font-bold text-navy">{t('app:interviews.duration')}<select value={f.dur} onChange={(e) => setF({ ...f, dur: e.target.value })} className={`${field} mt-0.5`}>{[30, 45, 60, 90].map((n) => <option key={n} value={n}>{t('app:interviews.minutes', { n })}</option>)}</select></label>
              <label className="block text-[12px] font-bold text-navy">{t('app:interviews.formatLabel')}<select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })} className={`${field} mt-0.5`}>{INTERVIEW_FORMATS.map((k) => <option key={k} value={k}>{t(`app:interviews.format.${k}`)}</option>)}</select></label>
            </div>
            <label className="block text-[12px] font-bold text-navy">{t('app:interviews.location')}<input required maxLength={200} value={f.location} placeholder={f.format === 'online' ? 'https://…' : ''} onChange={(e) => setF({ ...f, location: e.target.value })} className={`${field} mt-0.5`} /></label>
            <label className="block text-[12px] font-bold text-navy">{t('app:interviews.note')}<textarea maxLength={500} rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className="mt-0.5 w-full rounded-xl border-[1.5px] border-slate-300 bg-white p-2 text-[14px] font-normal" /></label>
            {err && <p role="alert" className="text-[13px] font-semibold text-danger-text">{err}</p>}
            <div className="flex gap-2"><button type="submit" disabled={busy} className={btnPrimary}>{busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <CalendarPlus size={15} aria-hidden />}{t('app:interviews.send')}</button><button type="button" className={btnGhost} onClick={() => setOpen(false)}>{t('app:account.cancel')}</button></div>
          </form>
        )}
        {mine.filter((i) => i !== live).length > 0 && (
          <details className="mt-3 text-[12px] text-muted"><summary className="cursor-pointer font-bold">{t('app:interviews.history')}</summary>
            <ul className="mt-1 space-y-0.5">{mine.filter((i) => i !== live).map((i) => <li key={i.id}>{fmt.when(i.startsAt)} — {t(`app:interviews.state.${i.status}`)}</li>)}</ul></details>
        )}
      </Card>
    </aside>
  );
}

export const MessageIcon = MessageSquare;
