import { useTranslation } from 'react-i18next';

/** Official SDU University vector emblem (from sdu.edu.kz), recoloured via CSS mask so it works on light and dark. */
export function Emblem({ className = 'h-9 w-8', full = false }: { className?: string; full?: boolean }) {
  const url = full ? '/brand/sdu-logo-navy.svg' : '/brand/sdu-emblem-navy.svg';
  return <span role="img" aria-label="SDU University" className={`emblem-mask inline-block shrink-0 ${className}`} style={{ ['--mask' as string]: `url(${url})` }} />;
}

export function Logo({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={`flex items-center gap-2.5 ${dark ? 'text-white' : 'text-navy'}`} aria-label={t('appName')}>
      <Emblem className="h-9 w-[2.1rem]" />
      {!compact && (
        <span className="leading-none">
          <span className="block text-[17px] font-extrabold tracking-tight">SDU <span className="text-orange-dark">Career</span></span>
          <span className={`mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.18em] ${dark ? 'text-white/70' : 'text-muted'}`}>University</span>
        </span>
      )}
    </span>
  );
}
