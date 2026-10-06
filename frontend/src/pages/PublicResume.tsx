import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import type { ResumeDoc, ResumeLang, ResumeTemplate } from '@sdu/shared';
import { ResumePreview } from '../components/ResumePreview';
import { api, ApiError } from '../lib/api';
import { errText } from '../lib/errors';

interface Pub { resume: { title: string; template: ResumeTemplate; language: ResumeLang; data: ResumeDoc } }

/** Public, unlisted résumé page (/r/:slug). No login; search engines are told not to index it. */
export function PublicResume() {
  const { t } = useTranslation();
  const { slug } = useParams();
  const [data, setData] = useState<Pub | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const m = document.createElement('meta');
    m.name = 'robots'; m.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(m);
    return () => { m.remove(); };
  }, []);
  useEffect(() => {
    api<Pub>('GET', `/api/public/resume/${encodeURIComponent(slug ?? '')}`).then((r) => { setData(r); document.title = `${r.resume.data.personal.fullName} · ${t('appName')}`; })
      .catch((e) => setErr(errText(t, e instanceof ApiError && e.status === 404 ? 'RESUME_DOC_NOT_FOUND' : e instanceof ApiError ? e.code : 'SERVER_ERROR')));
  }, [slug, t]);
  return (
    <div className="min-h-dvh bg-page px-3 py-6 print:bg-white print:p-0">
      <main id="main" className="mx-auto w-full max-w-[860px]">
        {err && <p role="alert" className="rounded-2xl bg-white p-6 text-center font-semibold text-danger-text shadow">{err}</p>}
        {data && (
          <>
            <div className="no-print mb-3 flex items-center justify-between gap-2">
              <Link to="/" className="text-[13px] font-bold text-brand hover:underline">{t('appName')}</Link>
              <button type="button" onClick={() => window.print()} className="btn-press inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-4 text-[13px] font-bold text-navy ring-1 ring-inset ring-line hover:bg-brand-50"><Printer size={15} aria-hidden />{t('app:builder.export.print')}</button>
            </div>
            <ResumePreview doc={data.resume.data} template={data.resume.template} language={data.resume.language} />
          </>
        )}
      </main>
    </div>
  );
}
