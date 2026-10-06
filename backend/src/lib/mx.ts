import type { Env } from '../env';

const cache = new Map<string, { at: number; ok: boolean | null }>();

async function doh(name: string, type: 'MX' | 'A'): Promise<{ status: number; answers: number } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
      signal: ctl.signal,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { Status: number; Answer?: { type: number }[] };
    const want = type === 'MX' ? 15 : 1;
    return { status: j.Status, answers: (j.Answer ?? []).filter((a) => a.type === want).length };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * true  = domain can receive mail; false = definitely cannot (NXDOMAIN / no MX and no A);
 * null  = unknown (offline, timeout) → caller must skip gracefully.
 */
export async function domainAcceptsMail(env: Env, domain: string): Promise<boolean | null> {
  if (env.SKIP_MX === '1') return null;
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.ok;
  let ok: boolean | null;
  const mx = await doh(domain, 'MX');
  if (!mx) ok = null;
  else if (mx.status === 3) ok = false;
  else if (mx.status === 0 && mx.answers > 0) ok = true;
  else {
    const a = await doh(domain, 'A');
    ok = !a ? null : a.status === 0 && a.answers > 0;
  }
  cache.set(domain, { at: Date.now(), ok });
  return ok;
}
