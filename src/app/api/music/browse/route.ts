import { NextResponse } from "next/server";
import { browse } from "@/lib/sources";
import type { BrowseKind } from "@/lib/types";

const KINDS: BrowseKind[] = ["trending", "charts", "radio"];

export async function GET(req: Request) {
  const raw = (new URL(req.url).searchParams.get("kind") ?? "trending").toLowerCase();
  const kind = KINDS.find((k) => k === raw) ?? "trending";

  try {
    return NextResponse.json(await browse(kind));
  } catch (e) {
    return NextResponse.json(
      { results: [], errors: [e instanceof Error ? e.message : String(e)] },
      { status: 502 },
    );
  }
}