import { NextResponse } from "next/server";
import { allStations } from "@/lib/sources";
import { matchStationsIn, stationToTrack } from "@/lib/sources/radio";
import type { RadioRegion, SourceResult, Track } from "@/lib/types";

const REGIONS: RadioRegion[] = ["international", "india"];

function regionParam(url: URL): RadioRegion | undefined {
  const raw = url.searchParams.get("region")?.toLowerCase();
  return REGIONS.find((r) => r === raw);
}

/**
 * Station search.
 *
 * A radio-ish word ("hindi radio", "bollywood radio") opens tag and language
 * matching; a bare word only matches distinctive station names. That heuristic
 * is inherited from the original JARVIS player and is what keeps a plain genre
 * search falling through to the track search instead of matching a station
 * that happens to share a word.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 120).trim();
  const region = regionParam(url);

  if (!q) return NextResponse.json<SourceResult<Track>>({ results: [], errors: [] });

  try {
    const { stations, errors } = await allStations();
    const matches = matchStationsIn(q, stations, region);
    return NextResponse.json<SourceResult<Track>>({
      results: matches.map(stationToTrack),
      errors,
    });
  } catch (e) {
    return NextResponse.json<SourceResult<Track>>(
      { results: [], errors: [e instanceof Error ? e.message : String(e)] },
      { status: 502 },
    );
  }
}