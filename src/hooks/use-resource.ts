"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One-shot resource fetch with keyed state.
 *
 * Data is stored *against the key it was requested for*, so the effect body
 * never calls setState synchronously and a superseded response can never
 * overwrite newer state. That's what keeps the "load then render" views free of
 * cascading renders.
 *
 * `run` may be an inline closure — it's held in a ref (synced by its own
 * effect, never during render) so only a change to `key` re-triggers the fetch.
 * Whatever `run` closes over must therefore also change whenever `key` does.
 */
export function useResource<T>(
  key: string | null,
  run: (signal: AbortSignal) => Promise<T>,
): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const runRef = useRef(run);

  // Declared first so it commits before the fetch effect reads the ref.
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    runRef
      .current(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ key, data });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key, error: e instanceof Error ? e.message : String(e) });
      });
    return () => controller.abort();
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  if (!key) return { data: null, loading: false, error: null, reload };
  if (!state || state.key !== key) return { data: null, loading: true, error: null, reload };
  return {
    data: state.data ?? null,
    error: state.error ?? null,
    loading: false,
    reload,
  };
}