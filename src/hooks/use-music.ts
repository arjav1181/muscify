"use client";

import { useCallback, useEffect, useState } from "react";
import { browseMusic } from "@/lib/api-client";
import type { BrowseKind, Track } from "@/lib/types";

export interface Result {
  results: Track[];
  errors: string[];
  loading: boolean;
  failed: string | null;
}

/**
 * Fetch-with-lifecycle for the browse endpoints.
 *
 * Loading state is *derived* from which request key the stored data belongs to
 * rather than set inside the effect body. That keeps the effect free of
 * synchronous setState (no cascading renders) and makes out-of-order replies
 * harmless: a late response for a superseded key is simply ignored.
 */
function useRequest(key: string | null, run: (signal: AbortSignal) => Promise<{ results: Track[]; errors: string[] }>): Result {
  const [settled, setSettled] = useState<{ key: string; data: Result } | null>(null);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    run(controller.signal)
      .then((data) => setSettled({ key, data: { ...data, loading: false, failed: null } }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({
          key,
          data: {
            results: [],
            errors: [],
            loading: false,
            failed: e instanceof Error ? e.message : String(e),
          },
        });
      });
    return () => controller.abort();
  }, [key, run]);

  if (!key) return { results: [], errors: [], loading: false, failed: null };
  if (!settled || settled.key !== key) return { results: [], errors: [], loading: true, failed: null };
  return settled.data;
}

const IDLE: Result = { results: [], errors: [], loading: false, failed: null };

/** Debounce a query without calling setState synchronously in an effect body. */
function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value.trim());
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function useBrowse(kind: BrowseKind | string | null): Result {
  const run = useCallback(
    (signal: AbortSignal) => {
      // "curated:<query>" shelves resolve through search, not browse.
      if (typeof kind === "string" && kind.startsWith("curated:")) {
        const query = kind.slice("curated:".length);
        return searchShelf(query, signal);
      }
      return browseMusic(kind as BrowseKind, signal);
    },
    [kind],
  );
  return useRequest(kind, run);
}

async function searchShelf(query: string, signal: AbortSignal) {
  const res = await fetch(
    `/api/music/search?${new URLSearchParams({ q: query, tab: "songs" })}`,
    { signal },
  );
  const json = (await res.json()) as { results?: Track[]; errors?: string[] };
  if (!res.ok) throw new Error(json.errors?.[0] ?? `Shelf failed (${res.status})`);
  return { results: (json.results ?? []).slice(0, 10), errors: json.errors ?? [] };
}

export function useSearch(query: string, source: "auto" | "youtube" | "deezer", delay = 350): Result {
  const debounced = useDebounced(query, delay);
  const run = useCallback(
    (signal: AbortSignal) => {
      const params = new URLSearchParams({ q: debounced, tab: "songs", source });
      return fetch(`/api/music/search?${params}`, { signal }).then(async (res) => {
        const json = (await res.json()) as { results?: Track[]; errors?: string[] };
        if (!res.ok) throw new Error(json.errors?.[0] ?? `Search failed (${res.status})`);
        return { results: json.results ?? [], errors: json.errors ?? [] };
      });
    },
    [debounced, source],
  );
  return useRequest(debounced ? `${source}:${debounced}` : null, run);
}

export { IDLE };