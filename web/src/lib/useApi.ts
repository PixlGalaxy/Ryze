import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { errorMessage } from './format';

/** GET `path`, optionally re-fetching every `refreshMs`. */
export function useApi<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const result = await api<T>(p);
      if (pathRef.current === p) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
    if (!refreshMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, refreshMs);
    return () => clearInterval(timer);
  }, [path, refreshMs, reload]);

  return { data, setData, error, loading, reload };
}

/** Local copy of a settings object with dirty tracking. */
export function useDraft<T>(source: T) {
  const [draft, setDraft] = useState<T>(() => structuredClone(source));
  useEffect(() => setDraft(structuredClone(source)), [source]);
  const set = <K extends keyof T>(key: K, value: T[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(source);
  const reset = () => setDraft(structuredClone(source));
  return { draft, set, dirty, reset };
}
