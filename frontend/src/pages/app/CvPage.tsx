import { Download, FileUp, Loader2, Trash2, Wand2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SubTabs, useResumeTabs } from '../../components/SubTabs';
import { Card, LoadState, PageHeader, SkillChips, btnDanger, btnGhost, btnPrimary } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import { apiErrText } from '../../lib/errors';
import { fmtDate } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';

interface Cv { filename: string; size: number; uploadedAt: string; skills: string[]; experienceYears: number; experienceItems: { line: string; months: number }[] }

export function CvPage() {
  const { t } = useTranslation();
  usePageTitle('nav.cv');
  const tabs = useResumeTabs();
  const toast = useToast();
  const { data, error, loading, setData } = useApi<{ cv: Cv | null }>('/api/cv');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const fd = new FormData(); fd.append('file', file);
      // multipart upload (the JSON client does not apply); CSRF token comes from the same endpoint
      const tok = ((await (await fetch('/api/auth/csrf', { credentials: 'same-origin' })).json()) as { token: string }).token;
      const res = await fetch('/api/cv', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'x-csrf-token': tok } });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'SERVER_ERROR');
      setData(body); toast(t('app:cv.uploaded'));
    } catch (e) { setErr(apiErrText(t, e instanceof ApiError ? e : new ApiError(0, 'NETWORK_ERROR'))); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const applySkills = async () => {
    try {
      const r = await api<{ added: string[] }>('POST', '/api/cv/apply-skills');
      toast(r.added.length ? t('app:cv.added', { n: r.added.length }) : t('app:cv.nothingToAdd'));
    } catch (e) { toast(apiErrText(t, e), 'error'); }
  };
  const remove = async () => {
    if (!window.confirm(t('app:confirm'))) return;
    try { await api('DELETE', '/api/cv'); setData({ cv: null }); toast(t('app:cv.deleted')); } catch (e) { toast(apiErrText(t, e), 'error'); }
  };
  const cv = data?.cv;
  return (
    <div className="mx-auto max-w-4xl">
      <SubTabs items={tabs} />
      <PageHeader title={t('app:cv.title')} subtitle={t('app:cv.subtitle')} />
      <LoadState loading={loading} error={error} />
      {data && (
        <div className="space-y-4">
          <Card>
            <input ref={input} id="cv-file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} disabled={busy} />
            <label htmlFor="cv-file" className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-brand/40 bg-brand-50 px-4 py-8 text-center transition hover:bg-white has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-brand ${busy ? 'opacity-70' : ''}`}>
              {busy ? <Loader2 className="animate-spin text-brand" size={30} aria-hidden /> : <FileUp className="text-brand" size={30} aria-hidden />}
              <span className="font-extrabold text-navy">{busy ? t('app:cv.uploading') : cv ? t('app:cv.replace') : t('app:cv.choose')}</span>
              <span className="text-[13px] text-muted">{t('app:cv.hint')}</span>
            </label>
            {err && <p role="alert" className="mt-2 rounded-xl bg-danger/10 px-3 py-2 text-[13px] font-semibold text-danger-text">{err}</p>}
          </Card>
          {!cv ? <p className="text-center text-muted">{t('app:cv.none')}</p> : (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><h2 className="text-sm font-bold uppercase tracking-wide text-muted">{t('app:cv.current')}</h2>
                  <p className="truncate text-lg font-extrabold text-navy">{cv.filename}</p>
                  <p className="text-[13px] text-muted">{t('app:cv.uploadedAt', { date: fmtDate(cv.uploadedAt) })} · {t('app:cv.size', { kb: Math.max(1, Math.round(cv.size / 1024)) })}</p></div>
                <div className="flex gap-2">
                  <a className={btnGhost} href="/api/cv/file" download><Download size={15} aria-hidden />{t('app:cv.download')}</a>
                  <button type="button" onClick={() => void remove()} className={btnDanger}><Trash2 size={15} aria-hidden />{t('app:cv.delete')}</button>
                </div>
              </div>
              <h3 className="mb-1.5 mt-4 text-[13px] font-extrabold text-navy">{t('app:cv.skills')}</h3>
              {cv.skills.length ? <SkillChips neutral={cv.skills} /> : <p className="text-[13px] text-muted">{t('app:cv.noSkills')}</p>}
              {cv.skills.length > 0 && <button type="button" onClick={() => void applySkills()} className={`${btnPrimary} mt-3`}><Wand2 size={16} aria-hidden />{t('app:cv.applySkills')}</button>}
              <h3 className="mb-1.5 mt-5 text-[13px] font-extrabold text-navy">{t('app:cv.experience')}</h3>
              {cv.experienceYears > 0 ? <p className="mb-1 text-[14px] font-bold text-brand-dark">{t('app:cv.years', { n: cv.experienceYears })}</p> : <p className="text-[13px] text-muted">{t('app:cv.noExperience')}</p>}
              <ul className="space-y-1 text-[13px] text-ink">{cv.experienceItems.map((i, n) => <li key={n} className="rounded-lg bg-slate-50 px-3 py-1.5">{i.line}</li>)}</ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
