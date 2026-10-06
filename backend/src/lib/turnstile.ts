import type { Env } from '../env';

export const captchaEnabled = (env: Env) => !!env.TURNSTILE_SECRET;

/** Verifies a Cloudflare Turnstile token. Fails CLOSED: no token, a bad token or an unreachable verifier all mean "not verified". */
export async function verifyCaptcha(env: Env, token: string | undefined, ip: string): Promise<boolean> {
  if (!captchaEnabled(env)) return true;
  if (!token || token.length > 2048) return false;
  try {
    const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET!, response: token });
    if (ip && ip !== 'local') form.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    if (!r.ok) return false;
    return ((await r.json()) as { success?: boolean }).success === true;
  } catch { return false; }
}
