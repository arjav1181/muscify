import { NextResponse } from "next/server";
import { browse } from "@/lib/sources";
import type { BrowseKind, RadioRegion, SourceResult, Track } from "@/lib/types";

const KINDS: BrowseKind[] = ["trending", "charts", "radio"];
const REGIONS: RadioRegion[] = ["international", "india"];

/**
 * Browse shelves and the radio directory.
 *
 * `region` scopes the radio directory (and only that — charts and trending are
 * global). Omitting it returns everything, SomaFM first.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("kind") ?? "trending").toLowerCase();
  const kind = KINDS.find((k) => k === raw) ?? "trending";

  const regionRaw = (url.searchParams.get("region") ?? "").toLowerCase();
  const region = REGIONS.find((r) => r === regionRaw);

  try {
    return NextResponse.json(await browse(kind, region));
  } catch (e) {
    return NextResponse.json<SourceResult<Track>>(
      { results: [], errors: [e instanceof Error ? e.message : String(e)] },
      { status: 502 },
    );
  }
}