import { stripTags } from "@/lib/html";
import type { Track } from "@/lib/types";
import { cached, quotaStatus, type Endpoint } from "./youtube/cache";
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
/**
 * Whether the Data API is unusable for now — no key configured, or the daily
 * budget spent. Callers use this to decide when to fall back to the public
 * search page rather than reporting a hard failure.
 */
export function isQuotaExhausted(): boolean {
  if (!hasYoutubeKey()) return true;
  return quotaStatus().exhausted;
}

/** Picks the largest thumbnail offered, by declared width. */
function bestThumb(
  thumbs: Record<string, { url?: string; width?: number }> | undefined,
): { url?: string; width?: number } | undefined {
  if (!thumbs) return undefined;
  let best: { url?: string; width?: number } | undefined;
  const order = ["maxresdefault", "standard", "high", "medium", "default"];
  for (const key of order) {
    const candidate = thumbs[key];
    if (!candidate?.url) continue;
    const width =
      candidate.width ??
      { maxresdefault: 1280, standard: 640, high: 480, medium: 320, default: 120 }[key] ??
      0;
    if (!best || width > (best.width ?? 0)) best = { url: candidate.url, width };
  }
  return best;
}

/**
 * Artist search.
 *
 * YouTube has no artist entity, so this used to search `type=channel` and treat
 * whatever came back as a musician. That is wrong in a way users noticed: a
 * channel search for "pritam" returns "Pritam - Topic", "Pritam Officeal61" and
 * "Pritam Bhartwan Official Channel" — uploads and impersonators, not the
 * composer.
 *
 * A channel's guide category looked like the fix and was not. `categoryId` is
 * auto-assigned and most musician channels land as "Entertainment", so filtering
 * on "10" rejected everything and fell straight back to the same broken channel
 * search — which is what shipped.
 *
 * What works is the one field YouTube populates from its content-identification
 * system rather than from the uploader: a music video carries
 * `topicDetails.musicArtistName`, the credited artist. Searching
 * `videoType=music` and reading it yields "Pritam" from the credits of his own
 * releases. The channel id from the same result routes to his channel page.
 */
export async function searchArtists(
  query: string,
  max = 12,
): Promise<{ results: ChannelResult[]; verified: boolean }> {
  try {
    const data = await ytFetch<{
      items?: {
        snippet?: {
          channelId?: string;
          thumbnails?: Record<string, { url?: string; width?: number }>;
          topicDetails?: { musicArtistName?: string };
        };
      }[];
    }>(
      "search",
      {
        part: "snippet",
        type: "video",
        videoType: "music",
        maxResults: String(Math.min(50, Math.max(max * 3, 15))),
        q: query,
      },
      "search",
    );

    const found = new Map<string, ChannelResult>();
    for (const item of data.items ?? []) {
      const sn = item.snippet;
      if (!sn) continue;
      const artist = sn.topicDetails?.musicArtistName?.trim();
      if (!artist) continue;

      const existing = found.get(artist);
      const best = bestThumb(sn.thumbnails);
      if (!existing) {
        found.set(artist, {
          id: sn.channelId ?? "",
          title: artist,
          image: best?.url ?? "",
          followers: 0,
          videoCount: 0,
          description: "",
        });
      } else if (best?.url && !existing.image) {
        existing.image = best.url;
      }
    }

    const results = [...found.values()].filter((a) => a.id).slice(0, max);
    if (results.length > 0) {
      await enrichChannels(results);
      return { results, verified: true };
    }
  } catch {
    // Falls through to the channel search below.
  }

  const channels = await searchChannels(query, max);
  return { results: channels, verified: false };
}

/** Adds channel images and subscriber counts in one batched call. */
async function enrichChannels(artists: ChannelResult[]): Promise<void> {
  const ids = [...new Set(artists.map((a) => a.id).filter(Boolean))];
  if (ids.length === 0) return;

  try {
    const data = await ytFetch<{
      items?: {
        id?: string;
        snippet?: { thumbnails?: Record<string, { url?: string; width?: number }> };
        statistics?: { subscriberCount?: string };
      }[];
    }>("channels", { part: "snippet,statistics", id: ids.join(",") }, "channels");

    const byId = new Map((data.items ?? []).map((item) => [item.id!, item]));
    for (const artist of artists) {
      const channel = byId.get(artist.id);
      if (!channel) continue;
      const best = bestThumb(channel.snippet?.thumbnails);
      if (best?.url && !artist.image) artist.image = best.url;
      if (channel.statistics?.subscriberCount) {
        artist.followers = Number(channel.statistics.subscriberCount);
      }
    }
  } catch {
    // Enrichment is optional; the credited name and video thumbnail suffice.
  }
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