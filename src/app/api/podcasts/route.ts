import { NextResponse } from "next/server";

import { searchPodcastEpisodes, showEpisodes } from "@/lib/sources/podcasts";
import { groupShows } from "@/lib/sources/podcast-shows";
import { hasYoutubeKey } from "@/lib/sources/youtube";
import type { Track } from "@/lib/types";

/**
 * Podcast browsing over YouTube.
 *
 * Separate from /api/music because a show and an episode are a different
 * relationship than a track and a playlist: episodes belong to a channel, they
 * are ordered by recency, and there is no per-show duration or season data to
 * reconcile. See lib/sources/podcasts.ts for what this can and cannot do.
 *
 * No `revalidate` route export: this project runs with `cacheComponents`, which
 * rejects it. Caching is set per-fetch with `next: { revalidate }` inside the
 * source module instead, which is the supported mechanism in this version.
 */

const NOT_AVAILABLE = () =>
  NextResponse.json(
    { ok: false, results: [], shows: [], errors: ["podcasts: unavailable without a YouTube key"] },
    { status: 501 },
  );

export async function GET(req: Request) {
  if (!hasYoutubeKey()) return NOT_AVAILABLE();

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "search";
  const q = (url.searchParams.get("q") ?? "").slice(0, 120).trim();
  const channel = (url.searchParams.get("channel") ?? "").slice(0, 64).trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 24) || 24, 50);

  try {
    switch (action) {
      case "episodes": {
        if (!channel) {
          return NextResponse.json(
            { ok: false, errors: ["podcasts: missing channel"] },
            { status: 400 },
          );
        }
        const episodes = await showEpisodes(channel, limit);
        return NextResponse.json({ ok: true, action, episodes, errors: [] });
      }

      case "search":
      default: {
        if (!q) {
          return NextResponse.json({ ok: true, action, episodes: [], shows: [], errors: [] });
        }
        const episodes = await searchPodcastEpisodes(q, limit);
        return NextResponse.json({
          ok: true,
          action,
          episodes: episodes as Track[],
          // Grouped on the channel, so a show is only offered when the query
          // actually matched something it published.
          shows: groupShows(episodes),
          errors: episodes.length
            ? []
            : [`podcasts: nothing on YouTube matched “${q}”`],
        });
      }
    }
  } catch (e) {
    console.error("[muscify] podcasts failed", e);
    return NextResponse.json(
      { ok: false, results: [], errors: ["podcasts: lookup failed"] },
      { status: 502 },
    );
  }
}