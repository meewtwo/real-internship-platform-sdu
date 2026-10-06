import { avatarUrl, useAvatarVersion } from '../lib/avatar';

/** Round-cornered square picture with the initial as a fallback. `version` null = no picture. */
export function Avatar({ userId, version, initial, className = 'h-7 w-7 text-[13px]' }: { userId: string; version: string | null | undefined; initial: string; className?: string }) {
  return version
    ? <img src={avatarUrl(userId, version)} alt="" width={256} height={256} className={`${className} rounded-md object-cover`} />
    : <span aria-hidden className={`${className} grid place-items-center rounded-md bg-navy font-extrabold text-white`}>{initial}</span>;
}
export function MyAvatar({ userId, initial, className }: { userId: string; initial: string; className?: string }) {
  return <Avatar userId={userId} version={useAvatarVersion()} initial={initial} className={className} />;
}
