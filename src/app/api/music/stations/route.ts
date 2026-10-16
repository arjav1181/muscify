import { NextResponse } from "next/server";
import { stationToTrack } from "@/lib/sources";
import { matchStations } from "@/lib/sources/somafm";
import type { SourceResult, Track } from "@/lib/types";

/**
 * Station matching for the radio view.
 *
 * A radio-ish word ("jazz radio") opens tag matching so a genre lands on a
 * station; without one, only distinctive station names match — so a plain genre
 * query still reaches the track search instead of returning nothing.
 */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 120).trim();
  if (!q) return NextResponse.json<SourceResult<Track>>({ results: [], errors: [] });

  try {
    const stations = await matchStations(q);
    return NextResponse.json<SourceResult<Track>>({
      results: stations.map(stationToTrack),
      errors: [],
    });
  } catch (e) {
    return NextResponse.json<SourceResult<Track>>(
      { results: [], errors: [e instanceof Error ? e.message : String(e)] },
      { status: 502 },
    );
  }
}