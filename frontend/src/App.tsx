import { Navigate, Route, Routes, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shell } from './components/Shell';
import type { Role } from '@sdu/shared';
import { lazy, Suspense, type ReactNode } from 'react';
import { useAuth } from './lib/auth';

function Only({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  return user && roles.includes(user.role) ? <>{children}</> : <Navigate to="/dashboard" replace />;
}

import { usePageTitle } from './lib/usePageTitle';

const AppLayout = lazy(() => import('./pages/AppLayout').then((m) => ({ default: m.AppLayout })));
const AuthPage = lazy(() => import('./pages/AuthPage').then((m) => ({ default: m.AuthPage })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const Analytics = lazy(() => import('./pages/app/Analytics').then((m) => ({ default: m.Analytics })));
const Companies = lazy(() => import('./pages/app/Admin').then((m) => ({ default: m.Companies })));
const Applicants = lazy(() => import('./pages/app/Applicants').then((m) => ({ default: m.Applicants })));
const Candidates = lazy(() => import('./pages/app/Applicants').then((m) => ({ default: m.Candidates })));
const CvPage = lazy(() => import('./pages/app/CvPage').then((m) => ({ default: m.CvPage })));
const Favorites = lazy(() => import('./pages/app/Favorites').then((m) => ({ default: m.Favorites })));
const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const MyApplications = lazy(() => import('./pages/app/MyApplications').then((m) => ({ default: m.MyApplications })));
const MyVacancies = lazy(() => import('./pages/app/MyVacancies').then((m) => ({ default: m.MyVacancies })));
const Notifications = lazy(() => import('./pages/app/Notifications').then((m) => ({ default: m.Notifications })));
const Recommendations = lazy(() => import('./pages/app/Recommendations').then((m) => ({ default: m.Recommendations })));
const VacancyDetail = lazy(() => import('./pages/app/VacancyDetail').then((m) => ({ default: m.VacancyDetail })));
const VacancyForm = lazy(() => import('./pages/app/VacancyForm').then((m) => ({ default: m.VacancyForm })));
const AiStudio = lazy(() => import('./pages/app/AiStudio').then((m) => ({ default: m.AiStudio })));
const ResumeBuilder = lazy(() => import('./pages/app/ResumeBuilder').then((m) => ({ default: m.ResumeBuilder })));
const ResumeEditor = lazy(() => import('./pages/app/ResumeEditor').then((m) => ({ default: m.ResumeEditor })));
const PublicResume = lazy(() => import('./pages/PublicResume').then((m) => ({ default: m.PublicResume })));
const Unsubscribe = lazy(() => import('./pages/Unsubscribe').then((m) => ({ default: m.Unsubscribe })));
const MessagesList = lazy(() => import('./pages/app/Messages').then((m) => ({ default: m.MessagesList })));
const MessageThread = lazy(() => import('./pages/app/Messages').then((m) => ({ default: m.MessageThread })));
const VacancySearch = lazy(() => import('./pages/app/VacancySearch').then((m) => ({ default: m.VacancySearch })));

function PageFallback() {
  return <div role="status" aria-busy="true" className="flex min-h-[40vh] items-center justify-center"><span className="h-8 w-8 animate-spin rounded-full border-4 border-navy/20 border-t-navy" /></div>;
}

function NotFound() {
  const { t } = useTranslation();
  usePageTitle('titles.notFound');
  return (
    <Shell>
      <div className="glass max-w-md rounded-[28px] p-8 text-center">
        <h1 className="mb-2 text-2xl font-extrabold text-navy">{t('titles.notFound')}</h1>
        <p className="mb-4 text-muted">{t('notFound.text')}</p>
        <Link to="/login" className="inline-flex h-11 items-center rounded-full bg-navy hover:bg-navy-deep btn-press px-6 font-extrabold text-white">{t('notFound.home')}</Link>
      </div>
    </Shell>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<AuthPage tab="login" />} />
      <Route path="/register" element={<AuthPage tab="register" />} />
      <Route path="/unsubscribe" element={<Unsubscribe />} />
      <Route path="/r/:slug" element={<PublicResume />} />
      <Route path="/recover" element={<AuthPage tab="recover" />} />
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/profile" element={<Only roles={['student', 'employer']}><Profile /></Only>} />
        <Route path="/favorites" element={<Only roles={['student']}><Favorites /></Only>} />
        {/* the former "My résumé" (transcript import) tab was removed: its URL now opens the Builder */}
        <Route path="/resume" element={<Navigate to="/resume/builder" replace />} />
        <Route path="/resume/builder" element={<Only roles={['student']}><ResumeBuilder /></Only>} />
        <Route path="/resume/builder/:id" element={<Only roles={['student']}><ResumeEditor /></Only>} />
        <Route path="/messages" element={<Only roles={['student', 'employer']}><MessagesList /></Only>} />
        <Route path="/messages/:applicationId" element={<Only roles={['student', 'employer']}><MessageThread /></Only>} />
        <Route path="/ai" element={<Only roles={['student']}><AiStudio /></Only>} />
        <Route path="/cv" element={<Only roles={['student']}><CvPage /></Only>} />
        <Route path="/vacancies" element={<Only roles={['student']}><VacancySearch /></Only>} />
        <Route path="/recommendations" element={<Only roles={['student']}><Recommendations /></Only>} />
        <Route path="/applications" element={<Only roles={['student']}><MyApplications /></Only>} />
        <Route path="/vacancies/mine" element={<Only roles={['employer']}><MyVacancies /></Only>} />
        <Route path="/vacancies/new" element={<Only roles={['employer']}><VacancyForm /></Only>} />
        <Route path="/vacancies/:id" element={<Only roles={['student', 'employer']}><VacancyDetail /></Only>} />
        <Route path="/vacancies/:id/edit" element={<Only roles={['employer']}><VacancyForm /></Only>} />
        <Route path="/vacancies/:id/applicants" element={<Only roles={['employer']}><Applicants /></Only>} />
        <Route path="/candidates" element={<Only roles={['employer']}><Candidates /></Only>} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/admin/companies" element={<Only roles={['admin']}><Companies /></Only>} />
        <Route path="/approvals" element={<Navigate to="/admin/companies" replace />} />
        <Route path="/analytics" element={<Only roles={['admin']}><Analytics /></Only>} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}
