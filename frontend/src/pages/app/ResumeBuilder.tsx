import { FilePlus2, Globe, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { RESUME_LANGS, RESUME_TEMPLATES } from '@sdu/shared';
import { SubTabs, useResumeTabs } from '../../components/SubTabs';
import { Card, LoadState, PageHeader, btnDanger, btnPrimary } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { apiErrText } from '../../lib/errors';
import { fmtDate } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';
import { useApi } from '../../lib/useApi';

interface Item { id: string; title: string; template: string; language: string; shared: boolean; updatedAt: string }
const sel = 'h-10 w-full rounded-xl border-[1.5px] border-slate-300 bg-white px-3 text-[14px]';

export function ResumeBuilder() {
  const { t, i18n } = useTranslation();
  usePageTitle('nav.builder');
  const tabs = useResumeTabs();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<{ docs: Item[]; max: number }>('/api/resume-docs');
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState('profile');
  const [template, setTemplate] = useState('classic');
  const [language, setLanguage] = useState(i18n.language.slice(0, 2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const full = !!data && data.docs.length >= data.max;
  const create = async () => {
    setBusy(true); setErr('');
    try { const r = await api<{ doc: { id: string } }>('POST', '/api/resume-docs', { title: title.trim() || t('app:builder.defaultTitle'), from, template, language }); navigate(`/resume/builder/${r.doc.id}`); }
    catch (e) { setErr(apiErrText(t, e)); } finally { setBusy(false); }
  };
  const remove = async (d: Item) => {
    if (!window.confirm(t('app:builder.confirmDelete', { title: d.title }))) return;
    try { await api('DELETE', `/api/resume-docs/${d.id}`); toast(t('app:builder.deleted')); void reload(); } catch (e) { toast(apiErrText(t, e), 'error'); }
  };
  return (
    <div className="mx-auto max-w-4xl">
      <SubTabs items={tabs} />
      <PageHeader title={t('app:builder.title')} subtitle={t('app:builder.subtitle')} />
      <Card className="mb-4">
        <h2 className="mb-2 text-[15px] font-extrabold text-navy">{t('app:builder.new')}</h2>
        <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[12px] font-bold text-navy sm:col-span-2">{t('app:builder.name')}<input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={t('app:builder.defaultTitle')} className={`${sel} mt-0.5 font-normal`} /></label>
          <label className="block text-[12px] font-bold text-navy">{t('app:builder.fromLabel')}
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={`${sel} mt-0.5 font-normal`}>{['profile', 'cv', 'portal', 'blank'].map((k) => <option key={k} value={k}>{t(`app:builder.from.${k}`)}</option>)}</select></label>
          <label className="block text-[12px] font-bold text-navy">{t('app:builder.template.label')}
            <select value={template} onChange={(e) => setTemplate(e.target.value)} className={`${sel} mt-0.5 font-normal`}>{RESUME_TEMPLATES.map((k) => <option key={k} value={k}>{t(`app:builder.template.${k}`)}</option>)}</select></label>
          <label className="block text-[12px] font-bold text-navy">{t('app:builder.docLanguage')}
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={`${sel} mt-0.5 font-normal`}>{RESUME_LANGS.map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}</select></label>
          <div className="flex items-end"><button type="submit" disabled={busy || full} className={`${btnPrimary} w-full`}><FilePlus2 size={16} aria-hidden />{t('app:builder.create')}</button></div>
          {full && <p className="text-[12px] font-semibold text-muted sm:col-span-2">{t('app:builder.limit', { n: data!.max })}</p>}
          {err && <p role="alert" className="text-[13px] font-semibold text-danger-text sm:col-span-2">{err}</p>}
        </form>
      </Card>
      <LoadState loading={loading && !data} error={error} empty={!!data && data.docs.length === 0} emptyText={t('app:builder.empty')} />
      {data && data.docs.length > 0 && (
        <ul className="space-y-2">
          {data.docs.map((d) => (
            <li key={d.id}>
              <Card className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/resume/builder/${d.id}`} className="block truncate text-[16px] font-extrabold text-navy hover:underline">{d.title}</Link>
                  <p className="text-[12px] text-muted">{t(`app:builder.template.${d.template}`)} · {d.language.toUpperCase()} · {t('app:builder.updated', { date: fmtDate(d.updatedAt) })}</p>
                </div>
                {d.shared && <span className="flex items-center gap-1 rounded-full bg-ok/15 px-2 py-0.5 text-[12px] font-bold text-ok-text"><Globe size={12} aria-hidden />{t('app:builder.shared')}</span>}
                <Link to={`/resume/builder/${d.id}`} className={btnPrimary}>{t('app:builder.open')}</Link>
                <button type="button" onClick={() => void remove(d)} className={btnDanger} aria-label={`${t('app:builder.delete')}: ${d.title}`}><Trash2 size={15} aria-hidden /></button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
