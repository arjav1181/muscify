"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchTab, Track } from "@/lib/types";
import { useDebounced } from "./use-debounced";

interface ArtistsResponse {
  id: string;
  source: string;
  name: string;
  image?: string;
  followers?: number;
}

interface AlbumResponse {
  id: number;
  title: string;
  cover: string;
  artist: string;
}

export interface SearchResults {
  results: Track[];
  artists: ArtistsResponse[];
  albums: AlbumResponse[];
  playlists: Track[];
  errors: string[];
  loading: boolean;
  error: string | null;
}

const EMPTY: SearchResults = {
  results: [],
  artists: [],
  albums: [],
  playlists: [],
  errors: [],
  loading: false,
  error: null,
};

/**
 * Search, with "All" fanning out across every content tab.
 *
 * State is keyed by the request itself rather than reset imperatively, so the
 * effect body never calls setState synchronously. That also means a superseded
 * response can never overwrite newer state — which matters here because "All"
 * issues five concurrent requests the user can re-trigger by typing.
 */
export function useSearch(query: string, tab: SearchTab): SearchResults {
  const q = useDebounced(query, 300);
  const isAll = tab === "all";
  const contentKey = isAll ? CONTENT_TABS.join(",") : tab;
  const requestKey = q.trim() ? `${q.trim()}|${contentKey}` : "";

  const single = useSettled<SearchResults>(
    isAll ? null : requestKey,
    async (signal) => {
      const json = await fetchJson(q.trim(), tab, signal);
      return {
        ...EMPTY,
        results: (json.results as Track[]) ?? [],
        artists: tab === "artists" ? ((json.results as ArtistsResponse[]) ?? []) : [],
        errors: json.errors ?? [],
      };
    },
  );

  const combined = useSettled<SearchResults>(
    isAll ? requestKey : null,
    async (signal) => {
      const query = q.trim();
      const responses = await Promise.all(
        CONTENT_TABS.map((t) => fetchJson(query, t, signal)),
      );

      const tracks: Track[] = [];
      const errors: string[] = [];
      let artists: ArtistsResponse[] = [];
      let albums: AlbumResponse[] = [];
      let playlists: Track[] = [];

      responses.forEach((json, i) => {
        errors.push(...(json.errors ?? []));
        switch (CONTENT_TABS[i]) {
          case "songs":
          case "videos":
            tracks.push(...((json.results as Track[]) ?? []));
            break;
          case "artists":
            artists = (json.results as ArtistsResponse[]) ?? [];
            break;
          case "albums":
            albums = (json.results as AlbumResponse[]) ?? [];
            break;
          case "playlists":
            playlists = (json.results as Track[]) ?? [];
            break;
        }
      });

      return { ...EMPTY, results: tracks, artists, albums, playlists, errors };
    },
  );

  const data = isAll ? combined.data : single.data;

  return {
    results: data?.results ?? [],
    artists: data?.artists ?? [],
    albums: data?.albums ?? [],
    playlists: data?.playlists ?? [],
    errors: data?.errors ?? [],
    loading: (isAll ? combined.loading : single.loading) && Boolean(requestKey),
    error: (isAll ? combined.error : single.error) ?? null,
  };
}

const CONTENT_TABS: SearchTab[] = ["songs", "videos", "artists", "albums", "playlists"];

async function fetchJson(q: string, tab: SearchTab, signal: AbortSignal) {
  const res = await fetch(`/api/music/search?${new URLSearchParams({ q, tab })}`, { signal });
  const json = (await res.json()) as {
    results?: unknown[];
    errors?: string[];
    error?: string;
  };
  if (!res.ok) throw new Error(json.error ?? `Search failed (${res.status})`);
  return json;
}

interface Settled<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Runs `run` whenever `key` changes, storing the result *against its key*.
 *
 * Data for a stale key is ignored on read, so there's no need to clear state
 * in the effect body and out-of-order responses are harmless.
 */
function useSettled<T>(
  key: string | null,
  run: (signal: AbortSignal) => Promise<T>,
): Settled<T> {
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  const runRef = useRef(run);

  // Synced in its own effect so the ref is never written during render.
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
  }, [key]);

  if (!key) return { data: null, error: null, loading: false };
  if (!state || state.key !== key) return { data: null, error: null, loading: true };
  return { data: state.data ?? null, error: state.error ?? null, loading: false };
}