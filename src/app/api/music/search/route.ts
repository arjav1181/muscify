import { NextResponse } from "next/server";
import { matchStationsIn, stationToTrack } from "@/lib/sources/radio";
import { searchPlaylists } from "@/lib/sources/youtube";
import {
  searchDeezerAlbums,
  searchDeezerArtists,
} from "@/lib/sources/deezer";
import { searchArtists, hasYoutubeKey } from "@/lib/sources/youtube";
import { searchYouTubeScrape } from "@/lib/sources/youtube/scrape";
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
  const set = await search(q, "auto");

  // If the Data API produced nothing and YouTube was the reason — no key, or
  // the daily budget spent — fall back to YouTube's own public search page.
  // Same source, same rights, same player; it just costs a page fetch instead
  // of 100 quota units.
  const ytError = set.errors.find((e) => e.startsWith("youtube"));
  if (set.results.length === 0 && ytError) {
    const scraped = await searchYouTubeScrape(q, 24);
    if (scraped.tracks.length > 0) {
      const seen = new Set(set.results.map((t) => `${t.source}:${t.id}`));
      const merged = [
        ...set.results,
        ...scraped.tracks.filter((t) => !seen.has(`${t.source}:${t.id}`)),
      ];
      return {
        ...set,
        results: merged,
        errors: [
          ...set.errors.filter((e) => e !== ytError),
          `youtube: showing public-page results — ${ytError.replace("youtube: ", "")}`,
        ],
      };
    }
  }

  return set;
}

async function videos(q: string) {
  if (hasYoutubeKey()) {
    const { results, errors } = await search(q, "youtube");
    if (results.length > 0 || !errors.some((e) => e.startsWith("youtube"))) {
      return { tab: "videos", results, errors };
    }
  }

  // No key, or the API failed. YouTube's public results page still works.
  const scraped = await searchYouTubeScrape(q, 24);
  return {
    tab: "videos",
    results: scraped.tracks,
    errors: scraped.tracks.length
      ? []
      : ["youtube: no key and the public-page fallback returned nothing"],
  };
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
      // Say what these are rather than what we wish they were. The fallback
      // path is a filtered channel search, so the entries are plausible artist
      // pages but not artist entities YouTube confirmed — and presenting the
      // two identically would be a claim the data does not support.
      if (!verified && channels.length > 0) {
        errors.push(
          "youtube: these are matching channel pages, not confirmed artist " +
            "records — auto-generated topic archives are filtered out, but " +
            "impersonators are not detectable",
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