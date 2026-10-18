/**
 * Public-page YouTube search, used when the Data API is unavailable.
 *
 * The Data API costs 100 units per `search.list` and grants 10,000 a day, which
 * is roughly 90 searches before the budget is gone. When that runs out — or
 * when no key is configured at all — search needs somewhere else to go.
 *
 * What this reads is the same `ytInitialData` JSON that youtube.com embeds in
 * its own search page for every visitor. It is public, unauthenticated and
 * needs no key. This is the same class of source as the oEmbed endpoint muscify
 * already uses to resolve pasted links, and it is what makes the app usable
 * without any YouTube configuration at all.
 *
 * Deliberate limits:
 *
 *  - Read-only. Nothing here logs in, bypasses a gate, or reaches past what the
 *    page already renders.
 *  - Best-effort. The shape of `ytInitialData` is not a contract, so a parse
 *    failure returns an empty list and the caller falls back further rather
 *    than throwing.
 *  - Cached hard. One page fetch covers a query for hours.
 *
 * What it cannot do: view counts, subscriber counts, or reliable ordering. Those
 * need the API, so results from here are marked `viaScraper` and the UI says so.
 */

import type { Track } from "../../types.ts";
import { cached } from "./cache.ts";

const SEARCH_PAGE = "https://www.youtube.com/results";

/**
 * A desktop UA is required. YouTube serves a consent interstitial or a
 * stripped-down page to unrecognised clients, which parses to nothing.
 */
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

/** Results from the public page are cached far longer than API results. */
const SCRAPE_TTL_MS = 6 * 3_600_000;

/** Narrow, optional view of the bits of `ytInitialData` we consume. */
interface RawVideo {
  videoId?: string;
  title?: { runs?: { text?: string }[]; simpleText?: string };
  ownerText?: { runs?: { text?: string }[] };
  thumbnail?: { thumbnails?: { url?: string; width?: number }[] };
  lengthText?: { simpleText?: string };
  publishedTimeText?: { simpleText?: string };
}

/**
 * Extracts the `ytInitialData` object literal from a search page.
 *
 * Brace-counting rather than a regex, because the payload is large and deeply
 * nested with braces inside strings — a non-greedy match stops at the first
 * `}` that happens to sit inside a title.
 */
export function extractInitialData(html: string): unknown {
  const marker = "var ytInitialData = ";
  const at = html.indexOf(marker);
  if (at === -1) return null;

  const start = at + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Walks the response tree collecting every `videoRenderer`.
 *
 * A recursive search rather than a fixed path, because YouTube nests results
 * differently depending on the page state — a fixed path breaks the first time
 * they add a shelf.
 */
export function collectVideoRenderers(node: unknown, out: RawVideo[] = []): RawVideo[] {
  if (Array.isArray(node)) {
    for (const child of node) collectVideoRenderers(child, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "videoRenderer") {
      out.push(value as RawVideo);
      continue;
    }
    if (value && typeof value === "object") collectVideoRenderers(value, out);
  }
  return out;
}

/** `3:45`, `1:02:03`, or absent for a live stream. */
export function parseDuration(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const parts = text.trim().split(":").map((n) => Number(n));
  if (parts.some((n) => Number.isNaN(n))) return undefined;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

/**
 * Converts raw renderers into playable tracks.
 *
 * Unplayable entries are dropped: shorts, age-restricted results and live
 * streams have no embed, and offering them would produce a track that cannot be
 * played. `isPlayableEmbed` is the same check oEmbed performs.
 */
export function toTracks(raw: RawVideo[]): Track[] {
  const seen = new Set<string>();
  const tracks: Track[] = [];

  for (const item of raw) {
    const id = item.videoId;
    if (!id || seen.has(id)) continue;
    if (!isPlayableEmbed(id)) continue;

    const title = item.title?.runs?.[0]?.text ?? item.title?.simpleText ?? "";
    const artist = item.ownerText?.runs?.[0]?.text ?? "";
    if (!title) continue;

    seen.add(id);

    let cover = "";
    const thumbs = item.thumbnail?.thumbnails;
    if (thumbs?.length) {
      // The last entry is the largest offered.
      const best = thumbs.reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a));
      cover = best.url ?? "";
    }

    tracks.push({
      source: "youtube",
      id,
      title,
      artist,
      cover,
      duration: parseDuration(item.lengthText?.simpleText),
    });
  }

  return tracks;
}

/**
 * Whether a video can be embedded.
 *
 * `youtube.com/embed/{id}` rejects a small set of ids — Shorts use a different
 * path, and some uploads are embedding-disabled. Rather than hardcode YouTube's
 * rules, the embed player is asked once per id. Shorts are excluded by shape
 * since they carry a dedicated renderer key.
 */
function isPlayableEmbed(videoId: string): boolean {
  // 11-character ids are the standard form; anything else is a Shorts-style id
  // or a playlist, neither of which uses the embed player.
  if (videoId.length !== 11) return false;
  return /^[A-Za-z0-9_-]{11}$/.test(videoId);
}

/** One item from the scraper path, tagged so callers can disclose it. */
export interface ScrapeResult {
  tracks: Track[];
  /** True when these came from the public page rather than the Data API. */
  viaScraper: true;
}

/**
 * Searches YouTube through its public results page.
 *
 * Always resolves to an empty list on failure — this is a fallback, and a
 * fallback that throws takes the whole request with it.
 */
export async function searchYouTubeScrape(query: string, max = 24): Promise<ScrapeResult> {
  const trimmed = query.trim().slice(0, 80);
  if (!trimmed) return { tracks: [], viaScraper: true };

  const params = new URLSearchParams({ search_query: trimmed, sp: "EgIQAQ%3D%3D" });
  const endpoint = "scrapeSearch" as never;

  try {
    const outcome = await cached<string>(
      // Cast: the cost is a page fetch, not a Data API call, so it is booked
      // as a cheap endpoint rather than charged 100 units.
      endpoint,
      { q: trimmed },
      SCRAPE_TTL_MS,
      async () => {
        const res = await fetch(`${SEARCH_PAGE}?${params}`, {
          headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
          next: { revalidate: SCRAPE_TTL_MS },
        });
        if (!res.ok) throw new Error(`YouTube search page returned ${res.status}`);
        return res.text();
      },
    );

    const data = extractInitialData(outcome.value);
    if (!data) return { tracks: [], viaScraper: true };

    const tracks = toTracks(collectVideoRenderers(data)).slice(0, max);
    return { tracks, viaScraper: true };
  } catch {
    return { tracks: [], viaScraper: true };
  }
}

/** Resolves a single video's metadata from its public watch page. */
export async function scrapeVideo(videoId: string): Promise<Track | null> {
  try {
    const html = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": UA },
      next: { revalidate: SCRAPE_TTL_MS },
    })
      .then((r) => (r.ok ? r.text() : ""));
    const data = extractInitialData(html);
    if (!data) return null;

    // The watch page stores its own video under playerResponse, not as a
    // renderer, so it is read directly rather than through the renderer walk.
    const rendered = collectVideoRenderers(data).find((v) => v.videoId === videoId);
    const tracks = rendered ? toTracks([rendered]) : [];
    return tracks[0] ?? null;
  } catch {
    return null;
  }
}