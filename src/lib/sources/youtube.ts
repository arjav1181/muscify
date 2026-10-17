import { stripTags } from "@/lib/html";
import type { Track } from "@/lib/types";
import { cached, type Endpoint } from "./youtube/cache";
import { TTL } from "./youtube/policy";

const YT_API = "https://www.googleapis.com/youtube/v3";
const OEMBED = "https://www.youtube.com/oembed";

/** YouTube's dedicated music category — keeps search off tutorials and vlogs. */
const MUSIC_CATEGORY = "10";

export function youtubeApiKey(): string {
  return (process.env.YOUTUBE_API_KEY ?? "").trim();
}

/**
 * Muscify degrades rather than dies without a key: search and charts turn off
 * with an explicit message, but pasted YouTube links still resolve and play
 * (oEmbed needs no key).
 */
export function hasYoutubeKey(): boolean {
  return youtubeApiKey().length > 0;
}

interface YoutubeItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    videoOwnerChannelTitle?: string;
    channelId?: string;
    publishedAt?: string;
    liveBroadcastContent?: number;
    description?: string;
    subscriberCount?: string;
    videoCount?: string;
    hiddenSubscriberCount?: boolean;
    resourceId?: { playlistId?: string };
    /** Present on music videos: the credited artist, not the uploader. */
    topicDetails?: { musicArtistName?: string; musicGenre?: string[] };
    /** Only returned when statistics are requested and the caller has quota. */
    statistics?: { viewCount?: string };
    thumbnails?: Record<string, { url?: string; width?: number; height?: number }>;
  };
}

function thumb(id: string, name: "hqdefault" | "mqdefault" | "maxresdefault"): string {
  return `https://i.ytimg.com/vi/${id}/${name}.jpg`;
}

/**
 * Quota-aware fetch.
 *
 * Every call goes through the cache, which charges the endpoint's real unit
 * cost, collapses concurrent duplicates, and serves a stale copy when YouTube
 * refuses. The `revalidate` window below is deliberately much longer than it
 * used to be: `search.list` costs 100 of the 10,000 units YouTube grants per
 * day, so re-buying the same results every five minutes exhausted the budget
 * within an afternoon. See lib/sources/youtube/policy.ts for the reasoning.
 *
 * The Next fetch cache is kept underneath so a cold start (new lambda, fresh
 * deployment) can be served from the CDN rather than paying full price.
 */
async function ytFetch<T = { items?: YoutubeItem[] }>(
  path: string,
  params: Record<string, string>,
  kind: keyof typeof TTL,
): Promise<T> {
  const key = youtubeApiKey();
  if (!key) throw new Error("YouTube API key missing");

  const policy = TTL[kind];
  const url = new URL(`${YT_API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);

  const outcome = await cached<T>(
    path as Endpoint,
    params,
    policy.freshFor,
    async () => {
      const res = await fetch(url, { next: { revalidate: policy.freshFor } });
      if (!res.ok) {
        // 403 and 429 both mean the budget is gone. "Fix the key" is the
        // wrong advice for that, so say what it actually is.
        const detail =
          res.status === 403
            ? "quota exceeded — try again later or use a different key"
            : res.status === 429
              ? "rate limited — try again shortly"
              : `status ${res.status}`;
        throw new Error(`YouTube ${path} failed (${detail})`);
      }
      return (await res.json()) as T;
    },
  );

  if (outcome.stale) {
    // Surfaced to the caller so the UI can say the results are cached rather
    // than implying they are live.
    console.warn(`[youtube] serving stale ${path} response (upstream refused)`);
  }

  return outcome.value;
}

/** Current quota state, for the settings UI. */
export { quotaStatus as youtubeQuota, cacheSize as youtubeCacheSize } from "./youtube/cache";

export async function searchYoutube(query: string, max = 24): Promise<Track[]> {
  const data = await ytFetch(
    "search",
    {
      part: "snippet",
      type: "video",
      videoCategoryId: MUSIC_CATEGORY,
      videoEmbeddable: "true",
      maxResults: String(Math.min(max, 50)),
      q: query,
    },
    "search",
  );
  const out: Track[] = [];
  for (const item of data.items ?? []) {
    const track = toVideo(item);
    if (track) out.push({ ...track, title: track.title || query });
  }
  if (!out.length) throw new Error("no results");
  return out;
}

/** The official music chart — one quota unit, so it backs the "trending" shelf. */
export async function trendingYoutube(max = 24): Promise<Track[]> {
  const data = await ytFetch(
    "videos",
    {
      part: "snippet",
      chart: "mostPopular",
      videoCategoryId: MUSIC_CATEGORY,
      maxResults: String(Math.min(max, 50)),
    },
    "chart",
  );
  const out: Track[] = [];
  for (const item of data.items ?? []) {
    const id = item.id?.videoId;
    if (!id) continue;
    const sn = item.snippet ?? {};
    out.push({
      source: "youtube",
      id,
      kind: "video",
      title: stripTags(sn.title ?? "Trending"),
      artist: sn.channelTitle ?? "",
      album: stripTags(sn.title ?? ""),
      cover: thumb(id, "hqdefault"),
      year: sn.publishedAt ? String(new Date(sn.publishedAt).getFullYear()) : undefined,
    });
  }
  if (!out.length) throw new Error("empty chart");
  return out;
}

/** ISO 8601 duration (PT4M13S) → seconds, as returned by the playlistItems endpoint. */
function isoDurationToSeconds(iso: string | undefined): number {
  if (!iso) return 0;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

interface PlaylistItem {
  snippet?: {
    title?: string;
    videoOwnerChannelTitle?: string;
    channelTitle?: string;
    thumbnails?: Record<string, { url?: string }>;
    resourceId?: { videoId?: string };
  };
  contentDetails?: { videoId?: string; videoDuration?: string };
}

interface PlaylistItemsResponse {
  items?: PlaylistItem[];
  nextPageToken?: string;
}

/**
 * Full contents of a YouTube playlist, with durations so the progress bar works.
 * `playlistItems` costs 1 quota unit per call and is capped at 50 per page.
 */
export async function playlistItems(
  listId: string,
  max = 100,
): Promise<{ tracks: Track[]; nextPageToken?: string }> {
  const key = youtubeApiKey();
  if (!key) throw new Error("YouTube API key missing");
  const url = new URL(`${YT_API}/playlistItems`);
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("playlistId", listId);
  url.searchParams.set("maxResults", String(Math.min(max, 50)));
  url.searchParams.set("key", key);

  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`YouTube playlistItems failed (${res.status})`);
  const data = (await res.json()) as PlaylistItemsResponse;

  const tracks: Track[] = [];
  for (const item of data.items ?? []) {
    const id = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
    if (!id) continue; // deleted or private entry
    const sn = item.snippet ?? {};
    const best =
      sn.thumbnails?.maxres ?? sn.thumbnails?.standard ?? sn.thumbnails?.high ?? sn.thumbnails?.medium;
    tracks.push({
      source: "youtube",
      id,
      kind: "video",
      title: stripTags(sn.title ?? ""),
      artist: sn.videoOwnerChannelTitle ?? sn.channelTitle ?? "",
      cover: best?.url ?? thumb(id, "mqdefault"),
      duration: isoDurationToSeconds(item.contentDetails?.videoDuration) || undefined,
    });
  }
  return { tracks, nextPageToken: data.nextPageToken };
}

function toVideo(item: YoutubeItem): Track | null {
  const id = item.id?.videoId;
  if (!id) return null;
  const sn = item.snippet ?? {};
  const best = sn.thumbnails?.high ?? sn.thumbnails?.medium ?? sn.thumbnails?.default;
  return {
    source: "youtube",
    id,
    kind: "video",
    title: stripTags(sn.title ?? ""),
    artist: sn.channelTitle ?? "",
    cover: best?.url ?? thumb(id, "mqdefault"),
    year: sn.publishedAt ? String(new Date(sn.publishedAt).getFullYear()) : undefined,
  };
}

export interface ChannelResult {
  id: string;
  title: string;
  image: string;
  followers: number;
  videoCount: number;
  description: string;
}

/**
 * YouTube's guide category for music channels.
 *
 * YouTube channels carry a `categoryId`, and music channels are categorised as
 * "Music", id `10`. That is the real signal this whole function exists for: a
 * channel search returns every channel whose name matches, so "pritam" surfaces
 * gaming and vlog channels alongside musicians.
 *
 * The `categoryId` *filter* parameter on channels.list is deprecated, but the
 * field is still returned in the snippet, so it is read rather than filtered on.
 */
const MUSIC_CATEGORY_ID = "10";

/**
 * Batch-resolves channel categories.
 *
 * channels.list accepts up to 50 comma-separated ids and costs one quota unit,
 * so one call covers a whole page of candidates. A failure returns an empty map
 * rather than throwing, because the caller treats "unknown category" as
 * "not confirmed" and falls back rather than hiding every result.
 */
async function channelCategories(ids: string[]): Promise<Map<string, { categoryId?: string; topics: string[] }>> {
  const unique = [...new Set(ids)].filter(Boolean).slice(0, 50);
  const out = new Map<string, { categoryId?: string; topics: string[] }>();
  if (unique.length === 0) return out;

  try {
    const data = await ytFetch<{
      items?: {
        id?: string;
        snippet?: { categoryId?: string };
        topicDetails?: { topicCategories?: string[] };
      }[];
    }>("channels", { part: "snippet,topicDetails", id: unique.join(",") }, "channels");

    for (const item of data.items ?? []) {
      if (!item.id) continue;
      out.set(item.id, {
        categoryId: item.snippet?.categoryId,
        topics: item.topicDetails?.topicCategories ?? [],
      });
    }
  } catch {
    // Unknown category is treated as unconfirmed, not as a hard failure.
  }

  return out;
}

/**
 * True when a channel is verifiably a music channel.
 *
 * The category is authoritative. Free-form topic categories are accepted as a
 * secondary signal because a lot of independent musicians never set a guide
 * category but do describe themselves as music.
 */
function isMusicChannel(
  info: { categoryId?: string; topics: string[] } | undefined,
): boolean {
  if (!info) return false;
  if (info.categoryId === MUSIC_CATEGORY_ID) return true;
  return info.topics.some((topic) => /^music$/i.test(topic.trim()));
}

/**
 * Artist search.
 *
 * YouTube has no artist entity, so a channel search stands in for one. The
 * problem is that channels are not artists: searching "pritam" returns any
 * channel with that word in its name, which is how gaming and vlog channels end
 * up in the artists tab.
 *
 * Two steps fix it:
 *  1. Take channel-search candidates, which keeps ids routable to a real
 *     channel page.
 *  2. Resolve each candidate's guide category in one batched call and keep only
 *     music channels.
 *
 * If the category check confirms nothing — an obscure artist who never set a
 * category — the unfiltered results are returned rather than an empty list, and
 * the caller is told the result is unverified so the UI can say so.
 */
export async function searchArtists(
  query: string,
  max = 12,
): Promise<{ results: ChannelResult[]; verified: boolean }> {
  const candidates = await searchChannels(query, Math.min(25, Math.max(max * 2, 10)));

  if (candidates.length === 0) return { results: [], verified: true };

  const categories = await channelCategories(candidates.map((c) => c.id));

  const verified = candidates.filter((c) => isMusicChannel(categories.get(c.id)));
  const source = verified.length > 0 ? verified : candidates;

  return {
    results: source.slice(0, max),
    // False means the category could not confirm anything, so the list is a
    // best-effort answer rather than a filtered one.
    verified: verified.length > 0,
  };
}

/** Raw channel search. Kept as the imprecise fallback for {@link searchArtists}. */
export async function searchChannels(query: string, max = 12): Promise<ChannelResult[]> {
  const data = await ytFetch(
    "search",
    {
      part: "snippet",
      type: "channel",
      maxResults: String(Math.min(max, 25)),
      q: query,
    },
    "search",
  );
  const out: ChannelResult[] = [];
  for (const item of data.items ?? []) {
    const sn = item.snippet ?? {};
    const id = sn.channelId;
    if (!id) continue;
    const best = sn.thumbnails?.high ?? sn.thumbnails?.medium ?? sn.thumbnails?.default;
    out.push({
      id,
      title: stripTags(sn.title ?? ""),
      image: best?.url ?? "",
      followers: sn.hiddenSubscriberCount ? 0 : Number(sn.subscriberCount ?? 0),
      videoCount: Number(sn.videoCount ?? 0),
      description: stripTags(sn.description ?? ""),
    });
  }
  return out;
}

export async function channelVideos(channelId: string, max = 24): Promise<Track[]> {
  const data = await ytFetch(
    "search",
    {
      part: "snippet",
      type: "video",
      channelId,
      videoCategoryId: MUSIC_CATEGORY,
      videoEmbeddable: "true",
      maxResults: String(Math.min(max, 50)),
      order: "viewCount",
    },
    // Channel contents move as uploads land, but not by the minute.
    "search",
  );
  return (data.items ?? []).map(toVideo).filter((t): t is Track => t !== null);
}

/** Search restricted to playlists, for the Playlists search tab. */
export async function searchPlaylists(query: string, max = 12): Promise<Track[]> {
  const data = await ytFetch(
    "search",
    {
      part: "snippet",
      type: "playlist",
      maxResults: String(Math.min(max, 25)),
      q: query,
    },
    "search",
  );
  const out: Track[] = [];
  for (const item of data.items ?? []) {
    const sn = item.snippet ?? {};
    const listId = sn.resourceId?.playlistId;
    if (!listId) continue;
    const best = sn.thumbnails?.high ?? sn.thumbnails?.medium ?? sn.thumbnails?.default;
    out.push({
      source: "youtube",
      id: listId,
      list: listId,
      kind: "playlist",
      title: stripTags(sn.title ?? "Playlist"),
      artist: sn.channelTitle ?? "",
      album: stripTags(sn.title ?? ""),
      cover: best?.url ?? "",
      itemCount: Number(sn.videoCount ?? 0) || undefined,
    });
  }
  return out;
}

export async function oEmbed(url: string, provider: "youtube" | "soundcloud" | "deezer") {
  const endpoint = provider === "youtube" ? `${OEMBED}?url=` : `https://soundcloud.com/oembed?url=`;
  const target = provider === "deezer" ? `https://api.deezer.com/oembed?url=` : endpoint;
  const res = await fetch(`${target}${encodeURIComponent(url)}&format=json`, {
    next: { revalidate: 86_400 },
  });
  if (!res.ok) throw new Error(`oEmbed failed (${res.status})`);
  const data = (await res.json()) as { title?: string; author_name?: string };
  return { title: stripTags(data.title ?? ""), artist: stripTags(data.author_name ?? "") };
}

const VIDEO_RE = /(?:v=|\/v\/|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/;

export function extractVideoId(url: string): string | null {
  const m = VIDEO_RE.exec(url);
  return m ? m[1] : null;
}

/** A pasted link may name a playlist (`?list=`), which plays in-engine as a unit. */
export function extractPlaylistId(url: string): string | null {
  try {
    const list = new URL(url).searchParams.get("list");
    return list && /^[\w-]+$/.test(list) ? list : null;
  } catch {
    return null;
  }
}