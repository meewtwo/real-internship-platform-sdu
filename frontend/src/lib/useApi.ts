import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';
import { api } from './api';

/** GET helper: { data, error (ApiError), loading, reload }. Pass `null` to skip. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (path === null) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const r = await api<T>('GET', path);
      if (my === seq.current) { setData(r); setError(null); }
    } catch (e) {
      if (my === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK_ERROR'));
    } finally { if (my === seq.current) setLoading(false); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
