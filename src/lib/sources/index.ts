import type { BrowseKind, RadioRegion, SourceFilter, SourceResult, Track } from "@/lib/types";
import { chartDeezer, extractDeezerTrackId, searchDeezer } from "./deezer";
import { allStations, stationToTrack } from "./radio";
import {
  extractPlaylistId,
  extractVideoId,
  hasYoutubeKey,
  oEmbed,
  searchYoutube,
  trendingYoutube,
} from "./youtube";

export { allStations, stationToTrack };

/**
 * Aggregated search across the track sources.
 *
 * Sources are attempted independently and failures are collected rather than
 * thrown, so one rate-limited provider can't blank out the whole page.
 */
export async function search(query: string, source: SourceFilter = "auto"): Promise<SourceResult<Track>> {
  const q = (query ?? "").trim();
  if (!q) return { results: [], errors: [] };

  const results: Track[] = [];
  const errors: string[] = [];

  if (source === "auto" || source === "youtube") {
    try {
      results.push(...(await searchYoutube(q)));
    } catch (e) {
      errors.push(`youtube: ${message(e)}`);
    }
  }
  if (source === "auto" || source === "deezer") {
    try {
      results.push(...(await searchDeezer(q)));
    } catch (e) {
      errors.push(`deezer: ${message(e)}`);
    }
  }
  return { results, errors };
}

export async function browse(
  kind: BrowseKind = "trending",
  region?: RadioRegion,
): Promise<SourceResult<Track>> {
  const results: Track[] = [];
  const errors: string[] = [];

  if (kind === "radio") {
    try {
      const { stations, errors: dirErrors } = await allStations();
      errors.push(...dirErrors);
      const scoped = region ? stations.filter((s) => s.region === region) : stations;
      // Default ordering puts the chill station first so "next" cycles sensibly,
      // matching the original's behaviour.
      const sorted = [...scoped].sort(
        (a, b) => Number(b.id === "groovesalad") - Number(a.id === "groovesalad"),
      );
      results.push(...sorted.map(stationToTrack));
    } catch (e) {
      errors.push(`radio: ${message(e)}`);
    }
    return { results, errors };
  }

  if (kind === "charts") {
    try {
      results.push(...(await chartDeezer()));
    } catch (e) {
      errors.push(`deezer: ${message(e)}`);
    }
    return { results, errors };
  }

  // trending: the YouTube music chart, falling back to Deezer charts.
  if (hasYoutubeKey()) {
    try {
      results.push(...(await trendingYoutube()));
      return { results, errors };
    } catch (e) {
      errors.push(`youtube: ${message(e)}`);
    }
  } else {
    errors.push("youtube: API key missing");
  }
  try {
    results.push(...(await chartDeezer()));
  } catch (e) {
    errors.push(`deezer: ${message(e)}`);
  }
  return { results, errors };
}

/**
 * Resolve a pasted link into a playable track, or null when the URL isn't a
 * supported source. This is the one path that works with no API key at all,
 * since oEmbed needs none.
 */
export async function resolveUrl(url: string): Promise<Track | null> {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");

  if (host.includes("youtu")) {
    const list = extractPlaylistId(raw);
    if (list) {
      const meta = await safeOEmbed(raw, "youtube");
      return { source: "youtube", id: list, list, title: meta.title || "YouTube playlist", artist: meta.artist, cover: "" };
    }
    const id = extractVideoId(raw);
    if (!id) return null;
    const meta = await safeOEmbed(raw, "youtube");
    return { source: "youtube", id, title: meta.title || "YouTube video", artist: meta.artist, cover: "" };
  }

  if (host.includes("deezer")) {
    const id = extractDeezerTrackId(raw);
    if (!id) return null;
    const meta = await safeOEmbed(raw, "deezer");
    return { source: "deezer", id, title: meta.title || "Deezer track", artist: meta.artist, cover: "" };
  }

  if (host.includes("soundcloud")) {
    const meta = await safeOEmbed(raw, "soundcloud");
    const slug = u.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
    return {
      source: "soundcloud",
      id: raw,
      url: raw,
      title: meta.title || slug.replace(/-/g, " ") || "SoundCloud track",
      artist: meta.artist,
      cover: "",
    };
  }

  return null;
}

async function safeOEmbed(url: string, provider: "youtube" | "soundcloud" | "deezer") {
  try {
    return await oEmbed(url, provider);
  } catch {
    return { title: "", artist: "" };
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}