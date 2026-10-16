import { NextResponse } from "next/server";
import {
  MOODS,
  relatedArtists,
  seededTracks,
  stationSeededTracks,
} from "@/lib/sources/recommend";
import { allStations } from "@/lib/sources";
import type { SourceId, Station } from "@/lib/types";

/**
 * Recommendations.
 *
 * Three strategies, each with a different data source behind it:
 *
 *   seeded     — a track as the seed. Uses Deezer's curated artist radio where
 *                the track carries a Deezer artist id, otherwise a text search
 *                built from artist/album/title.
 *   related    — similar artists from Deezer's similarity graph.
 *   station    — a radio station as the seed. Uses the station's own genre and
 *                language tags as the query, which is the only strategy that
 *                needs no API key at all.
 *
 * `moods` returns the curated shelf definitions, which the client renders.
 *
 * None of this is Spotify's recommendation engine — that is collaborative
 * filtering over billions of streams and the data only exists inside Spotify.
 * The `strategy` field in each response says which real source was used.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") ?? "seeded").toLowerCase();

  try {
    switch (mode) {
      case "moods":
        return NextResponse.json({ moods: MOODS });

      case "related": {
        const artistId = url.searchParams.get("artistId") ?? "";
        const { artists, errors } = await relatedArtists(artistId);
        return NextResponse.json({ artists, errors });
      }

      case "station": {
        const stationId = url.searchParams.get("stationId") ?? "";
        const { stations } = await allStations();
        const station = stations.find((s) => s.id === stationId);
        if (!station) {
          return NextResponse.json(
            { results: [], errors: ["station not found"], strategy: "none" },
            { status: 404 },
          );
        }
        const set = await stationSeededTracks(station as Station, 20);
        return NextResponse.json(set);
      }

      case "seeded":
      default: {
        const source = (url.searchParams.get("source") ?? "deezer") as SourceId;
        const seed = {
          source,
          id: url.searchParams.get("id") ?? "",
          title: url.searchParams.get("title") ?? "",
          artist: url.searchParams.get("artist") ?? "",
          artistId: url.searchParams.get("artistId") ?? undefined,
          album: url.searchParams.get("album") ?? undefined,
        };
        if (!seed.title && !seed.artist) {
          return NextResponse.json(
            { results: [], errors: ["a seed track is required"], strategy: "none" },
            { status: 400 },
          );
        }
        return NextResponse.json(await seededTracks(seed));
      }
    }
  } catch (e) {
    return NextResponse.json(
      {
        results: [],
        errors: [e instanceof Error ? e.message : String(e)],
        strategy: "none",
      },
      { status: 502 },
    );
  }
}