/**
 * Podcasts on YouTube.
 *
 * YouTube is not a podcast catalogue, but a large and active part of the podcast
 * world publishes there, and for search-by-title it behaves well enough:
 *
 *   "joe rogan experience"  ->  "Joe Rogan Experience #2567 - Maria"
 *                              from channel "PowerfulJRE"
 *
 * The structural point is what makes this cheap rather than a new subsystem: an
 * episode is already a `Track` (id, title, publisher as artist, artwork,
 * duration) and a show is already a `ChannelResult`. Nothing new needs storing,
 * queueing or playing. What changes is the presentation and the curation.
 *
 * What is honest about the limits, because they are not small:
 *
 *  - A show is a YouTube channel. Shows that publish only on their own site and
 *    only syndicate excerpts here are not discoverable here.
 *  - YouTube exposes no show, season or episode-number metadata. Nothing in the
 *    API response identifies a thing as a podcast, so shows and episodes are
 *    derived from search and channel grouping, not read from a field. Episodes
 *    are therefore "videos from a channel we believe publishes episodes", and
 *    the UI should not imply otherwise.
 *  - There is no shelf ordering, no "new episode" flag and no subscription
 *    feed. Ordering is by recency and that is a real difference from a podcast
 *    app.
 *  - Playback goes through the ordinary YouTube embed, so an episode gets the
 *    same third-party-frame constraints as a song: no pause API, no volume, and
 *    no audio analysis.
 *
 * Audiobooks are deliberately NOT built on this. There is audiobook content on
 * YouTube but it is unverified user uploads with no rights signal, and a
 * catalogue of unknown provenance presented as a feature is worse than not
 * offering one. Spotify removed its own audiobook surface for related reasons.
 */


import type { Track } from "../types.ts";
import { hasYoutubeKey, isQuotaExhausted } from "./youtube.ts";

export type { Show } from "./podcast-shows.ts";

/**
 * Podcast-shaped search.
 *
 * `videoCategoryId=22` is YouTube's "People & Blogs", which is where podcast
 * publishers land. It is not a podcast category — plenty of vlogs live there and
 * plenty of podcasts are categorised elsewhere — so it is used to *widen* a
 * query, never to filter it. Getting this wrong would silently empty results,
 * which is the same failure as the channel-category filter that shipped earlier.
 */
export async function searchPodcasts(query: string, max = 20): Promise<Track[]> {
  return searchPodcastQuery(query, max, false);
}

/** Same, biased toward long-form: an episode is rarely under ten minutes. */
export async function searchPodcastEpisodes(query: string, max = 30): Promise<Track[]> {
  return searchPodcastQuery(query, max, true);
}

async function searchPodcastQuery(
  query: string,
  max: number,
  longForm: boolean,
): Promise<Track[]> {
  if (!hasYoutubeKey()) return [];

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    q: query,
    maxResults: String(Math.min(max, 50)),
    videoEmbeddable: "true",
  });
  if (longForm) params.set("videoCategoryId", "22");

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${params}&key=${process.env.YOUTUBE_API_KEY}`,
    { next: { revalidate: 6 * 3600 } },
  );
  if (!res.ok) return [];

  const data = (await res.json()) as {
    items?: {
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        channelId?: string;
        publishedAt?: string;
        description?: string;
        thumbnails?: Record<string, { url?: string; width?: number }>;
      };
    }[];
  };

  const seen = new Set<string>();
  const out: Track[] = [];
  for (const item of data.items ?? []) {
    const id = item.id?.videoId;
    const sn = item.snippet;
    // Shorts use a different id shape and cannot be embedded; skip rather than
    // offer an episode that cannot be played.
    if (!id || id.length !== 11 || !sn?.title || seen.has(id)) continue;
    seen.add(id);

    const thumbs = sn.thumbnails;
    let cover = "";
    let width = 0;
    for (const t of Object.values(thumbs ?? {})) {
      if ((t.width ?? 0) > width) {
        width = t.width ?? 0;
        cover = t.url ?? "";
      }
    }

    out.push({
      source: "youtube",
      id,
      title: decode(sn.title),
      artist: sn.channelTitle ?? "",
      artistId: sn.channelId,
      cover,
      // Not carried: YouTube's duration lives in contentDetails, which costs a
      // second batched call. The player bar shows an elapsed timer instead, and
      // pretending a zero duration is a known length would be worse.
      duration: undefined,
    });
  }
  return out;
}

/** Newest episodes for a channel, which is how a show page is built. */
export async function showEpisodes(channelId: string, max = 20): Promise<Track[]> {
  if (!hasYoutubeKey() || !channelId) return [];

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    channelId,
    order: "date",
    videoEmbeddable: "true",
    maxResults: String(Math.min(max, 50)),
  });

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${params}&key=${process.env.YOUTUBE_API_KEY}`,
    { next: { revalidate: 6 * 3600 } },
  );
  if (!res.ok) return [];

  const data = (await res.json()) as {
    items?: {
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        channelId?: string;
        thumbnails?: Record<string, { url?: string; width?: number }>;
      };
    }[];
  };

  const out: Track[] = [];
  const seen = new Set<string>();
  for (const item of data.items ?? []) {
    const id = item.id?.videoId;
    const sn = item.snippet;
    if (!id || id.length !== 11 || !sn?.title || seen.has(id)) continue;
    seen.add(id);

    let cover = "";
    let width = 0;
    for (const t of Object.values(sn.thumbnails ?? {})) {
      if ((t.width ?? 0) > width) {
        width = t.width ?? 0;
        cover = t.url ?? "";
      }
    }

    out.push({
      source: "youtube",
      id,
      title: decode(sn.title),
      artist: sn.channelTitle ?? "",
      artistId: sn.channelId,
      cover,
    });
  }
  return out;
}

/** True when podcasts can be shown at all. */
export function podcastsAvailable(): boolean {
  return hasYoutubeKey() && !isQuotaExhausted();
}

/** YouTube HTML-escapes titles as `&amp;`. */
function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}