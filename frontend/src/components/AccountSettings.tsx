import { Download, ImagePlus, Loader2, Send, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { removeAvatar, saveAvatar, useAvatarVersion } from '../lib/avatar';
import { MyAvatar } from './Avatar';
import { apiErrText } from '../lib/errors';
import { useApi } from '../lib/useApi';
import { useToast } from './Toast';
import { Card, btnDanger, btnGhost } from './ui';

interface Prefs { digest: boolean; instant: boolean }
interface Tg { configured: boolean; linked: boolean; enabled: boolean; username: string | null }

function TelegramCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, setData, reload } = useApi<Tg>('/api/telegram/status');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  if (!data || !data.configured) return null;
  const connect = async () => { setBusy(true); try { setUrl((await api<{ url: string }>('POST', '/api/telegram/link')).url); } catch (e) { toast(apiErrText(t, e), 'error'); } finally { setBusy(false); } };
  const disconnect = async () => { try { await api('DELETE', '/api/telegram/link'); setUrl(''); await reload(); } catch (e) { toast(apiErrText(t, e), 'error'); } };
  const toggle = async (enabled: boolean) => { try { await api('PUT', '/api/telegram/settings', { enabled }); setData({ ...data, enabled }); } catch (e) { toast(apiErrText(t, e), 'error'); } };
  return (
    <Card className="md:col-span-2">
      <h2 className="text-[16px] font-extrabold text-navy">{t('app:account.tgTitle')}</h2>
      <p className="mb-2 text-[13px] text-muted">{t('app:account.tgHint')}</p>
      {data.linked ? (
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[14px] font-semibold"><input type="checkbox" checked={data.enabled} onChange={(e) => void toggle(e.target.checked)} />{t('app:account.tgEnabled')}</label>
          <button type="button" className={btnGhost} onClick={() => void disconnect()}>{t('app:account.tgDisconnect')}</button>
        </div>
      ) : url ? (
        <div className="space-y-2"><a href={url} target="_blank" rel="noopener noreferrer" className={btnGhost}><Send size={14} aria-hidden />{t('app:account.tgOpen')}</a>
          <p className="text-[12px] text-muted">{t('app:account.tgWait')} <button type="button" className="font-bold text-brand underline" onClick={() => void reload()}>{t('app:account.tgRefresh')}</button></p></div>
      ) : <button type="button" disabled={busy} className={btnGhost} onClick={() => void connect()}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Send size={14} aria-hidden />}{t('app:account.tgConnect')}</button>}
    </Card>
  );
}

function AvatarCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();
  const version = useAvatarVersion();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try { await saveAvatar(f); toast(t('app:account.saved')); } catch (e) { toast(e instanceof Error && !('status' in e) ? t('errors:AVATAR_TYPE_INVALID') : apiErrText(t, e), 'error'); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return (
    <Card className="md:col-span-2">
      <div className="flex flex-wrap items-center gap-4">
        <MyAvatar userId={user.id} initial={user.email.charAt(0).toUpperCase()} className="h-16 w-16 text-2xl" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-extrabold text-navy">{t('app:account.avatarTitle')}</h2>
          <p className="text-[13px] text-muted">{t('app:account.avatarHint')}</p>
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={t('app:account.avatarUpload')} tabIndex={-1} onChange={(e) => void pick(e.target.files?.[0])} />
        <button type="button" disabled={busy} className={btnGhost} onClick={() => input.current?.click()}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ImagePlus size={14} aria-hidden />}{t('app:account.avatarUpload')}</button>
        {version && <button type="button" className={btnGhost} onClick={() => void removeAvatar().catch((e) => toast(apiErrText(t, e), 'error'))}><Trash2 size={14} aria-hidden />{t('app:account.avatarRemove')}</button>}
      </div>
    </Card>
  );
}

/** E-mail preferences, data export and account erasure — what the API offers for privacy, reachable from the profile page. */
export function AccountSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { setUser, user } = useAuth();
  const { data, setData } = useApi<Prefs>('/api/email/prefs');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const toggle = async (k: keyof Prefs, v: boolean) => {
    try { setData(await api<Prefs>('PUT', '/api/email/prefs', { [k]: v })); toast(t('app:account.saved')); } catch (e) { toast(apiErrText(t, e), 'error'); }
  };
  const del = async () => {
    setBusy(true); setErr('');
    try { await api('DELETE', '/api/profile', { password: pw }); setUser(null); navigate('/'); } catch (e) { setErr(apiErrText(t, e)); } finally { setBusy(false); }
  };
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <AvatarCard />
      <Card>
        <h2 className="text-[16px] font-extrabold text-navy">{t('app:account.emailTitle')}</h2>
        <p className="mb-2 text-[13px] text-muted">{t('app:account.emailHint')}</p>
        {data && (
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-[14px] font-semibold"><input type="checkbox" className="mt-1" checked={data.instant} onChange={(e) => void toggle('instant', e.target.checked)} /><span>{t('app:account.instant')}<span className="block text-[12px] font-normal text-muted">{t('app:account.instantHint')}</span></span></label>
            <label className="flex items-start gap-2 text-[14px] font-semibold"><input type="checkbox" className="mt-1" checked={data.digest} onChange={(e) => void toggle('digest', e.target.checked)} /><span>{t('app:account.digest')}<span className="block text-[12px] font-normal text-muted">{t('app:account.digestHint')}</span></span></label>
          </div>
        )}
      </Card>
      <Card>
        <h2 className="text-[16px] font-extrabold text-navy">{t('app:account.dataTitle')}</h2>
        <p className="mb-2 text-[13px] text-muted">{t('app:account.dataHint')}</p>
        <a href="/api/profile/export" download className={btnGhost}><Download size={14} aria-hidden />{t('app:account.export')}</a>
        {user?.role !== 'admin' && (
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="text-[14px] font-extrabold text-danger-text">{t('app:account.deleteTitle')}</h3>
            <p className="mb-2 text-[12px] text-muted">{t('app:account.deleteHint')}</p>
            {!confirming ? <button type="button" className={btnDanger} onClick={() => setConfirming(true)}><Trash2 size={14} aria-hidden />{t('app:account.delete')}</button> : (
              <form onSubmit={(e) => { e.preventDefault(); void del(); }} className="space-y-2">
                <label className="block text-[12px] font-bold text-navy">{t('app:account.password')}<input type="password" autoComplete="current-password" value={pw} maxLength={128} onChange={(e) => setPw(e.target.value)} className="mt-0.5 h-9 w-full rounded-xl border-[1.5px] border-slate-300 bg-white px-2.5 text-[14px] font-normal" /></label>
                {err && <p role="alert" className="text-[13px] font-semibold text-danger-text">{err}</p>}
                <div className="flex gap-2"><button type="submit" disabled={busy || !pw} className={btnDanger}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Trash2 size={14} aria-hidden />}{t('app:account.confirmDelete')}</button>
                  <button type="button" className={btnGhost} onClick={() => { setConfirming(false); setPw(''); setErr(''); }}>{t('app:account.cancel')}</button></div>
              </form>
            )}
          </div>
        )}
      </Card>
      <TelegramCard />
    </div>
  );
}
