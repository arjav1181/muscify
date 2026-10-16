import { stripTags } from "@/lib/html";
import type { Track } from "@/lib/types";

const DEEZER = "https://api.deezer.com";

interface DeezerItem {
  id?: number;
  title?: string;
  duration?: number;
  artist?: { id?: number; name?: string };
  album?: { id?: number; title?: string; cover_big?: string; cover_medium?: string };
}

interface DeezerResponse {
  data?: DeezerItem[];
  total?: number;
  error?: { message?: string };
}

function toTrack(item: DeezerItem, fallbackTitle: string): Track {
  return {
    source: "deezer",
    id: String(item.id ?? ""),
    kind: "track",
    title: stripTags(item.title ?? fallbackTitle),
    artist: stripTags(item.artist?.name ?? ""),
    artistId: item.artist?.id != null ? String(item.artist.id) : undefined,
    album: stripTags(item.album?.title ?? ""),
    albumId: item.album?.id != null ? String(item.album.id) : undefined,
    cover: item.album?.cover_big ?? item.album?.cover_medium ?? "",
    // Seconds, already normalised by the API.
    duration: item.duration && item.duration > 0 ? item.duration : undefined,
  };
}

async function deezerFetch(path: string, revalidate: number): Promise<DeezerResponse> {
  const res = await fetch(`${DEEZER}${path}`, { next: { revalidate } });
  if (!res.ok) throw new Error(`Deezer ${path.split("?")[0]} failed (${res.status})`);
  const json = (await res.json()) as DeezerResponse;
  if (json.error?.message) throw new Error(json.error.message);
  return json;
}

/**
 * Deezer withholds track payloads in some territories: the response comes back
 * with a populated `total` but an empty `data` array. That's a geo restriction,
 * not a failed search, and telling the two apart is the difference between a
 * user retrying and a user filing a bug.
 */
function unwrap(response: DeezerResponse, emptyMessage: string): DeezerItem[] {
  const items = (response.data ?? []).filter((i) => i.id != null);
  if (!items.length) {
    if ((response.total ?? 0) > 0) {
      throw new Error(
        `results are geo-restricted from this network (${response.total} matched upstream)`,
      );
    }
    throw new Error(emptyMessage);
  }
  return items;
}

export async function searchDeezer(query: string, limit = 24): Promise<Track[]> {
  const qs = new URLSearchParams({ q: query, limit: String(Math.min(limit, 100)) });
  const data = await deezerFetch(`/search?${qs}`, 300);
  return unwrap(data, "no results").map((i) => toTrack(i, query));
}

/** The YouTube-less path: this chart backs the app whenever YouTube is unavailable. */
export async function chartDeezer(limit = 24): Promise<Track[]> {
  const qs = new URLSearchParams({ limit: String(Math.min(limit, 100)) });
  const data = await deezerFetch(`/chart/0/tracks?${qs}`, 900);
  return unwrap(data, "empty chart").map((i) => toTrack(i, "Top track"));
}

export interface DeezerArtist {
  id: number;
  name: string;
  picture: string;
  followers: number;
  nbAlbum: number;
}

interface DeezerArtistItem {
  id?: number;
  name?: string;
  picture_medium?: string;
  picture_big?: string;
  nb_album?: number;
  nb_fan?: number;
}

export async function searchDeezerArtists(query: string, limit = 12): Promise<DeezerArtist[]> {
  const qs = new URLSearchParams({ q: query, limit: String(Math.min(limit, 50)) });
  const res = await fetch(`${DEEZER}/search/artist?${qs}`, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`Deezer artist search failed (${res.status})`);
  const json = (await res.json()) as { data?: DeezerArtistItem[]; error?: { message?: string } };
  if (json.error?.message) throw new Error(json.error.message);
  return (json.data ?? [])
    .filter((a) => a.id != null)
    .map((a) => ({
      id: a.id as number,
      name: stripTags(a.name ?? ""),
      picture: a.picture_big ?? a.picture_medium ?? "",
      followers: a.nb_fan ?? 0,
      nbAlbum: a.nb_album ?? 0,
    }));
}

export interface DeezerAlbum {
  id: number;
  title: string;
  cover: string;
  artist: string;
  artistId: number;
  releaseDate: string;
  trackCount: number;
}

interface DeezerAlbumItem {
  id?: number;
  title?: string;
  cover_big?: string;
  cover_medium?: string;
  release_date?: string;
  nb_tracks?: number;
  artist?: { id?: number; name?: string };
}

function toAlbum(item: DeezerAlbumItem): DeezerAlbum | null {
  if (item.id == null) return null;
  return {
    id: item.id,
    title: stripTags(item.title ?? ""),
    cover: item.cover_big ?? item.cover_medium ?? "",
    artist: stripTags(item.artist?.name ?? ""),
    artistId: item.artist?.id ?? 0,
    releaseDate: item.release_date ?? "",
    trackCount: item.nb_tracks ?? 0,
  };
}

export async function searchDeezerAlbums(query: string, limit = 12): Promise<DeezerAlbum[]> {
  const qs = new URLSearchParams({ q: query, limit: String(Math.min(limit, 50)) });
  const res = await fetch(`${DEEZER}/search/album?${qs}`, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`Deezer album search failed (${res.status})`);
  const json = (await res.json()) as { data?: DeezerAlbumItem[]; error?: { message?: string } };
  if (json.error?.message) throw new Error(json.error.message);
  return (json.data ?? []).map(toAlbum).filter((a): a is DeezerAlbum => a !== null);
}

/**
 * Album metadata plus its tracks.
 *
 * Deezer splits this across two calls — `/album/{id}` for metadata and
 * `/album/{id}/tracks` for the tracklist — so they're fetched together here.
 */
export async function deezerAlbum(id: number): Promise<{
  album: DeezerAlbum;
  tracks: Track[];
}> {
  const res = await fetch(`${DEEZER}/album/${id}`, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`Deezer album failed (${res.status})`);
  const raw = (await res.json()) as DeezerAlbumItem & { tracks?: { data?: DeezerItem[] } };
  const album = toAlbum(raw);
  if (!album) throw new Error("album not found");

  // The embedded track list is sufficient and saves a second request.
  const tracks = (raw.tracks?.data ?? []).filter((t) => t.id != null).map((t) => toTrack(t, ""));
  return { album, tracks };
}

export async function deezerArtistTracks(artistId: number, limit = 24): Promise<Track[]> {
  const qs = new URLSearchParams({ limit: String(Math.min(limit, 100)) });
  const res = await fetch(`${DEEZER}/artist/${artistId}/top?${qs}`, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`Deezer artist tracks failed (${res.status})`);
  const json = (await res.json()) as { data?: DeezerItem[]; error?: { message?: string } };
  if (json.error?.message) throw new Error(json.error.message);
  const items = (json.data ?? []).filter((t) => t.id != null);
  if (!items.length) throw new Error("no results");
  return items.map((t) => toTrack(t, ""));
}

export function extractDeezerTrackId(url: string): string | null {
  try {
    const m = /\/track\/(\d+)/.exec(new URL(url).pathname);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}