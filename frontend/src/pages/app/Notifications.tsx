import { Bell, Briefcase, CalendarCheck, CheckCircle2, MailPlus, MessageSquare, Sparkles, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Card, LoadState, PageHeader, btnGhost } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';

interface N { id: string; kind: string; params: Record<string, unknown>; link: string | null; read: boolean; createdAt: string }
const ICON: Record<string, React.ReactNode> = { new_application: <UserPlus size={18} />, status_changed: <Briefcase size={18} />, new_match: <Sparkles size={18} />, employer_approved: <CheckCircle2 size={18} />, invitation: <MailPlus size={18} />, new_message: <MessageSquare size={18} />, interview_update: <CalendarCheck size={18} /> };

export function Notifications() {
  const ctx = useOutletContext<{ refreshUnread?: () => void } | undefined>();
  const onChange = ctx?.refreshUnread;
  const { t } = useTranslation();
  usePageTitle('nav.notifications');
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<{ unread: number; items: N[] }>('/api/notifications');
  const text = (n: N) => {
    const p = { ...n.params } as Record<string, unknown>;
    if (typeof p.status === 'string') p.status = t(`options:appStatuses.${p.status}`);
    if (n.kind === 'interview_update' && typeof p.state === 'string') return t(`app:notif.interview_${p.state}`, p);
    return t(`app:notif.${n.kind}`, p);
  };
  const open = async (n: N) => {
    if (!n.read) { await api('POST', `/api/notifications/${n.id}/read`).catch(() => undefined); onChange?.(); }
    if (n.link) navigate(n.link); else await reload();
  };
  const readAll = async () => { await api('POST', '/api/notifications/read-all'); onChange?.(); await reload(); };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('app:notif.title')} actions={data && data.unread > 0 ? <button type="button" className={btnGhost} onClick={() => void readAll()}>{t('app:notif.markAll')}</button> : undefined} />
      <LoadState loading={loading && !data} error={error} empty={!!data && data.items.length === 0} emptyText={t('app:notif.empty')} />
      <ul className="space-y-2">
        {data?.items.map((n) => (
          <li key={n.id}>
            <Card className={`!p-0 ${n.read ? '' : 'ring-2 ring-brand/40'}`}>
              <button type="button" onClick={() => void open(n)} className="flex w-full items-start gap-3 rounded-3xl p-4 text-left hover:bg-brand-50">
                <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${n.read ? 'bg-slate-100 text-slate-600' : 'bg-brand text-white'}`} aria-hidden>{ICON[n.kind] ?? <Bell size={18} />}</span>
                <span className="min-w-0"><span className={`block break-words text-[14px] ${n.read ? 'text-ink' : 'font-extrabold text-navy'}`}>{text(n)}</span><span className="text-[12px] text-muted">{fmtDate(n.createdAt)}</span></span>
              </button>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
