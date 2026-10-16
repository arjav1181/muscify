import { NextResponse } from "next/server";
import { deezerArtistTracks } from "@/lib/sources/deezer";
import { channelVideos, hasYoutubeKey } from "@/lib/sources/youtube";

/**
 * Popular tracks for an artist.
 *
 * `source=youtube` treats the id as a channelId (these APIs have no shared
 * artist namespace); `source=deezer` treats it as a numeric Deezer artist id.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  const source = (url.searchParams.get("source") ?? "deezer").toLowerCase();

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    if (source === "youtube") {
      if (!hasYoutubeKey()) {
        return NextResponse.json({ error: "YouTube API key missing" }, { status: 503 });
      }
      return NextResponse.json({ results: await channelVideos(id, 30) });
    }
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "invalid artist id" }, { status: 400 });
    }
    return NextResponse.json({ results: await deezerArtistTracks(Number(id), 30) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}