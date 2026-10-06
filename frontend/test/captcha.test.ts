// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUARDED_PATHS, captchaToken, resetCaptchaConfigForTests } from '../src/lib/captcha';

const realFetch = globalThis.fetch;
beforeEach(() => { resetCaptchaConfigForTests(); document.head.innerHTML = ''; document.body.innerHTML = ''; delete (window as { turnstile?: unknown }).turnstile; });
afterEach(() => { globalThis.fetch = realFetch; });
const config = (key: string | null) => { globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ turnstileSiteKey: key }))) as never; };

describe('captchaToken', () => {
  it('does nothing when the server did not enable the captcha (no script, no widget)', async () => {
    config(null);
    expect(await captchaToken()).toBeNull();
    expect(document.head.querySelector('script')).toBeNull();
    expect(document.querySelector('[data-captcha-host]')).toBeNull();
  });
  it('config fetch failure means "disabled", never a crash', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as never;
    expect(await captchaToken()).toBeNull();
  });
  it('renders an invisible widget, resolves with its token and cleans up (single-use)', async () => {
    config('0xSITE');
    const remove = vi.fn();
    let opts: Record<string, any> = {};
    (window as any).turnstile = { render: (_el: HTMLElement, o: Record<string, unknown>) => { opts = o; queueMicrotask(() => (o.callback as (t: string) => void)('tok-123')); return 'w1'; }, remove };
    expect(await captchaToken()).toBe('tok-123');
    expect(opts).toMatchObject({ sitekey: '0xSITE', appearance: 'interaction-only' });
    expect(remove).toHaveBeenCalledWith('w1');
    expect(document.querySelector('[data-captcha-host]')).toBeNull();
  });
  it('rejects on widget error/timeout so the call fails with CAPTCHA_FAILED instead of hanging', async () => {
    config('0xSITE');
    for (const cb of ['error-callback', 'timeout-callback']) {
      (window as any).turnstile = { render: (_el: HTMLElement, o: Record<string, unknown>) => { queueMicrotask(() => (o[cb] as () => void)()); return 'w'; }, remove: vi.fn() };
      await expect(captchaToken()).rejects.toThrow();
      expect(document.querySelector('[data-captcha-host]')).toBeNull();
    }
  });
  it('guards exactly the abuse-prone unauthenticated POSTs', () => {
    expect([...GUARDED_PATHS].sort()).toEqual(['/api/auth/forgot', '/api/auth/login', '/api/auth/register/employer', '/api/auth/register/student', '/api/auth/resend-code']);
  });
});
