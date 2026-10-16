import { NextResponse } from "next/server";
import { deezerAlbum } from "@/lib/sources/deezer";

/** Album metadata plus its full tracklist, from Deezer's public API. */
export async function GET(req: Request) {
  const raw = (new URL(req.url).searchParams.get("id") ?? "").trim();
  if (!/^\d+$/.test(raw)) {
    return NextResponse.json({ error: "invalid album id" }, { status: 400 });
  }

  try {
    const { album, tracks } = await deezerAlbum(Number(raw));
    return NextResponse.json({ album, tracks });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}