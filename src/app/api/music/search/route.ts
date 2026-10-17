import { NextResponse } from "next/server";
import { matchStationsIn, stationToTrack } from "@/lib/sources/radio";
import { searchPlaylists } from "@/lib/sources/youtube";
import {
  searchDeezerAlbums,
  searchDeezerArtists,
} from "@/lib/sources/deezer";
import { searchArtists, hasYoutubeKey } from "@/lib/sources/youtube";
import { allStations, search } from "@/lib/sources";
import type { RadioRegion, SearchTab } from "@/lib/types";

const TABS: SearchTab[] = [
  "all",
  "songs",
  "videos",
  "artists",
  "albums",
  "playlists",
  "radio",
];

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Search, scoped to one tab.
 *
 * Each tab is answered independently so a failing source degrades to an empty
 * section with an explanation rather than an error page — the client renders
 * whatever did succeed.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 200).trim();
  const raw = (url.searchParams.get("tab") ?? "all").toLowerCase();
  const tab = (TABS.find((t) => t === raw) ?? "all") as SearchTab;
  const regionRaw = (url.searchParams.get("region") ?? "").toLowerCase();
  const region = (["international", "india"] as const).find((r) => r === regionRaw);

  if (!q) return NextResponse.json({ tab, results: [], errors: [] });

  try {
    switch (tab) {
      case "artists":
        return NextResponse.json(await artists(q));
      case "albums":
        return NextResponse.json(await albums(q));
      case "playlists":
        return NextResponse.json(await playlists(q));
      case "radio":
        return NextResponse.json(await radio(q, region));
      case "videos":
        return NextResponse.json(await videos(q));
      default:
        return NextResponse.json(await songs(q));
    }
  } catch (e) {
    return NextResponse.json({ tab, results: [], errors: [message(e)] }, { status: 502 });
  }
}

async function songs(q: string) {
  return search(q, "auto");
}

async function videos(q: string) {
  if (!hasYoutubeKey()) return { tab: "videos", results: [], errors: ["youtube: API key missing"] };
  const { results, errors } = await search(q, "youtube");
  return { tab: "videos", results, errors };
}

async function artists(q: string) {
  const results: unknown[] = [];
  const errors: string[] = [];

  if (hasYoutubeKey()) {
    try {
      const { results: channels, verified } = await searchArtists(q, 10);
      results.push(
        ...channels.map((c) => ({
          source: "youtube",
          id: c.id,
          name: c.title,
          image: c.image,
          followers: c.followers,
          description: c.description,
          videoCount: c.videoCount,
        })),
      );
      // Say so rather than presenting an unfiltered channel list as artists.
      if (!verified && channels.length > 0) {
        errors.push(
          "youtube: no channel could be confirmed as a music channel, so these results are unfiltered",
        );
      }
    } catch (e) {
      errors.push(`youtube: ${message(e)}`);
    }
  } else {
    errors.push("youtube: API key missing");
  }

  try {
    const found = await searchDeezerArtists(q, 10);
    results.push(
      ...found.map((a) => ({
        source: "deezer",
        id: String(a.id),
        name: a.name,
        image: a.picture,
        followers: a.followers,
      })),
    );
  } catch (e) {
    errors.push(`deezer: ${message(e)}`);
  }

  return { tab: "artists", results, errors };
}

async function albums(q: string) {
  const results: unknown[] = [];
  const errors: string[] = [];
  try {
    const found = await searchDeezerAlbums(q, 20);
    results.push(...found);
  } catch (e) {
    errors.push(`deezer: ${message(e)}`);
  }
  return { tab: "albums", results, errors };
}

async function playlists(q: string) {
  if (!hasYoutubeKey()) {
    return { tab: "playlists", results: [], errors: ["youtube: API key missing"] };
  }
  const results: unknown[] = [];
  const errors: string[] = [];
  try {
    results.push(...(await searchPlaylists(q, 20)));
  } catch (e) {
    errors.push(`youtube: ${message(e)}`);
  }
  return { tab: "playlists", results, errors };
}

async function radio(q: string, region?: RadioRegion) {
  const { stations, errors } = await allStations();
  return {
    tab: "radio",
    results: matchStationsIn(q, stations, region).map(stationToTrack),
    errors,
  };
}