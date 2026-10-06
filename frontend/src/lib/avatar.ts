import { useSyncExternalStore } from 'react';
import { api, uploadAvatar } from './api';

/** The signed-in user's picture version (`updated_at`, used as the cache-buster) shared by the header and the profile page. */
let version: string | null | undefined; // undefined = not loaded yet
const subs = new Set<() => void>();
const set = (v: string | null) => { version = v; subs.forEach((f) => f()); };

export const loadAvatar = () => api<{ updatedAt: string | null }>('GET', '/api/avatar/me').then((r) => set(r.updatedAt)).catch(() => set(null));
export const clearAvatarState = () => { version = undefined; subs.forEach((f) => f()); };
export const useAvatarVersion = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version);
export const avatarUrl = (userId: string, v: string) => `/api/avatar/${userId}?v=${encodeURIComponent(v)}`;
export const removeAvatar = async () => { await api('DELETE', '/api/avatar'); set(null); };

/** Centre-crops to a 256×256 square and re-encodes as WebP (JPEG fallback) so uploads are ~10–30 KB regardless of the original. */
export async function resizeToAvatar(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  bmp.close();
  for (const [type, q] of [['image/webp', 0.85], ['image/jpeg', 0.85], ['image/jpeg', 0.6]] as const) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
    if (blob && blob.size <= 150 * 1024) return blob;
  }
  throw new Error('too large');
}
export async function saveAvatar(file: File): Promise<void> { set(await uploadAvatar(await resizeToAvatar(file))); }
