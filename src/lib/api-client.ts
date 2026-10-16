"use client";

import type { BrowseKind, SourceFilter, SourceResult, Track } from "@/lib/types";

type Payload<T> = SourceResult<T>;

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export async function browseMusic(
  kind: BrowseKind,
  signal?: AbortSignal,
): Promise<SourceResult<Track>> {
  const data = await getJson<Payload<Track>>(`/api/music/browse?kind=${kind}`, signal);
  return { results: data.results ?? [], errors: data.errors ?? [] };
}

export async function searchMusic(
  query: string,
  source: SourceFilter = "auto",
  signal?: AbortSignal,
): Promise<SourceResult<Track>> {
  const params = new URLSearchParams({ q: query, source, tab: "songs" });
  const data = await getJson<Payload<Track>>(`/api/music/search?${params}`, signal);
  return { results: data.results ?? [], errors: data.errors ?? [] };
}

/** Match a free-text query against SomaFM station names and tags. */
export async function searchStations(
  query: string,
  signal?: AbortSignal,
): Promise<SourceResult<Track>> {
  const params = new URLSearchParams({ q: query });
  const data = await getJson<Payload<Track>>(`/api/music/stations?${params}`, signal);
  return { results: data.results ?? [], errors: data.errors ?? [] };
}

/**
 * Resolve a pasted link. This is the one path that works with no API key at
 * all, since oEmbed requires none — so link playback survives a missing key.
 */
export async function resolveMusicUrl(url: string, signal?: AbortSignal): Promise<Track> {
  const params = new URLSearchParams({ url });
  const data = await getJson<{ track: Track }>(`/api/music/resolve?${params}`, signal);
  return data.track;
}

export async function fetchAlbum(
  id: string,
  signal?: AbortSignal,
): Promise<{ album: Record<string, unknown>; tracks: Track[] }> {
  return getJson(`/api/music/album?id=${encodeURIComponent(id)}`, signal);
}

export async function fetchArtistTracks(
  id: string,
  source: string,
  signal?: AbortSignal,
): Promise<Track[]> {
  const params = new URLSearchParams({ id, source });
  const data = await getJson<{ results: Track[] }>(`/api/music/artist?${params}`, signal);
  return data.results ?? [];
}

export async function fetchPlaylistTracks(
  id: string,
  signal?: AbortSignal,
): Promise<Track[]> {
  const params = new URLSearchParams({ id });
  const data = await getJson<{ results: Track[] }>(`/api/music/playlist?${params}`, signal);
  return data.results ?? [];
}