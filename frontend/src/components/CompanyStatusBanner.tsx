import { Ban, Hourglass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/useApi';

interface Review { status: 'pending' | 'approved' | 'rejected'; reason: string | null }

/**
 * Employer's company review state: nothing once approved (account active), the "awaiting approval" text while pending,
 * and the admin's reason + how to get help when rejected. Publishing is enforced by the API either way.
 */
export function CompanyStatusBanner({ pendingKey, className = '' }: { pendingKey: string; className?: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const waiting = user?.role === 'employer' && user.status !== 'active';
  const { data } = useApi<{ review?: Review | null }>(waiting ? '/api/profile' : null);
  if (!waiting) return null;
  const review = data?.review;
  if (review?.status === 'rejected') {
    return (
      <div role="status" className={`flex gap-3 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger-text ${className}`}>
        <Ban className="shrink-0" size={20} aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="font-extrabold">{t('app:company.rejectedTitle')}</p>
          {review.reason && <p className="break-words"><b>{t('app:company.reason')}:</b> {review.reason}</p>}
          <p className="font-semibold">{t('app:company.rejectedHelp')}</p>
        </div>
      </div>
    );
  }
  return (
    <p role="status" className={`flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900 ${className}`}>
      <Hourglass className="shrink-0" size={20} aria-hidden />{t(pendingKey)}
    </p>
  );
}
