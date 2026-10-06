/**
 * Cloudflare Turnstile, zero-touch: the guarded auth calls ask for a token right before they are sent. The widget is created on demand,
 * is invisible unless Cloudflare needs an interaction, and is destroyed after use (tokens are single-use). If the server did not enable the
 * captcha (/api/public/config → null) nothing is loaded at all.
 */
interface TurnstileApi { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void }
declare global { interface Window { turnstile?: TurnstileApi } }

export const GUARDED_PATHS = new Set(['/api/auth/register/student', '/api/auth/register/employer', '/api/auth/login', '/api/auth/forgot', '/api/auth/resend-code']);
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let keyPromise: Promise<string | null> | null = null;
export const siteKey = () => (keyPromise ??= fetch('/api/public/config', { credentials: 'same-origin' }).then((r) => r.json()).then((j: { turnstileSiteKey?: string | null }) => j.turnstileSiteKey ?? null).catch(() => null));
export const resetCaptchaConfigForTests = () => { keyPromise = null; };

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return (scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { scriptPromise = null; reject(new Error('turnstile script failed')); };
    document.head.appendChild(s);
  }));
}

/** Resolves a fresh token, `null` when the captcha is disabled, and rejects when verification could not be completed. */
export async function captchaToken(): Promise<string | null> {
  const key = await siteKey();
  if (!key) return null;
  await loadScript();
  return new Promise<string>((resolve, reject) => {
    const host = document.createElement('div');
    host.setAttribute('data-captcha-host', '');
    document.body.appendChild(host);
    let id: string | undefined;
    const done = (fn: () => void) => { try { if (id) window.turnstile?.remove(id); } catch { /* already gone */ } host.remove(); fn(); };
    try {
      id = window.turnstile!.render(host, {
        sitekey: key, appearance: 'interaction-only', theme: 'light',
        callback: (token: string) => done(() => resolve(token)),
        'error-callback': () => done(() => reject(new Error('captcha error'))),
        'timeout-callback': () => done(() => reject(new Error('captcha timeout'))),
      });
    } catch (e) { done(() => reject(e)); }
  });
}
