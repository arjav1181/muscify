import { NextResponse } from "next/server";
import { resolveUrl } from "@/lib/sources";

/**
 * Resolve a pasted link into a playable track.
 *
 * This path works with no API key configured, because every provider's oEmbed
 * endpoint is unauthenticated — so link playback survives a missing key, which
 * is what makes the "paste a link" feature work out of the box.
 */
export async function GET(req: Request) {
  const url = (new URL(req.url).searchParams.get("url") ?? "").slice(0, 500);
  if (!url.trim()) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  try {
    const track = await resolveUrl(url);
    if (!track) {
      return NextResponse.json(
        { error: "Unsupported link — YouTube, Deezer and SoundCloud only." },
        { status: 404 },
      );
    }
    return NextResponse.json({ track });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}