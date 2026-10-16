import { NextResponse } from "next/server";
import { hasYoutubeKey } from "@/lib/sources/youtube";

/** 200 is far more than any playlist worth playing, and caps quota burn. */
const MAX_TRACKS = 200;
const PAGE_SIZE = 50;

interface PlaylistItem {
  snippet?: {
    title?: string;
    videoOwnerChannelTitle?: string;
    channelTitle?: string;
    thumbnails?: Record<string, { url?: string }>;
    resourceId?: { videoId?: string };
  };
  contentDetails?: { videoId?: string; videoDuration?: string };
}

const TIMESTAMP = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

function toSeconds(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const m = TIMESTAMP.exec(iso);
  if (!m) return undefined;
  const total = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return total > 0 ? total : undefined;
}

function bestThumb(thumbnails: Record<string, { url?: string }> | undefined): string {
  return (
    thumbnails?.maxres?.url ??
    thumbnails?.standard?.url ??
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    ""
  );
}

/**
 * Contents of a YouTube playlist.
 *
 * Pages at 50 (the API maximum) and stops at MAX_TRACKS, so a 10,000-item
 * playlist can't burn an unbounded amount of the user's daily quota.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();

  if (!/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: "invalid playlist id" }, { status: 400 });
  }
  if (!hasYoutubeKey()) {
    return NextResponse.json({ error: "YouTube API key missing" }, { status: 503 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  const results: unknown[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const endpoint = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
      endpoint.searchParams.set("part", "snippet,contentDetails");
      endpoint.searchParams.set("playlistId", id);
      endpoint.searchParams.set("maxResults", String(PAGE_SIZE));
      if (pageToken) endpoint.searchParams.set("pageToken", pageToken);
      endpoint.searchParams.set("key", apiKey!);

      const res = await fetch(endpoint, { next: { revalidate: 600 } });
      if (!res.ok) throw new Error(`YouTube playlistItems failed (status ${res.status})`);
      const data = (await res.json()) as {
        items?: PlaylistItem[];
        nextPageToken?: string;
      };

      for (const item of data.items ?? []) {
        const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
        // Deleted and private entries come back without a videoId.
        if (!videoId) continue;
        const sn = item.snippet ?? {};
        results.push({
          source: "youtube",
          id: videoId,
          kind: "video",
          title: sn.title ?? "",
          artist: sn.videoOwnerChannelTitle ?? sn.channelTitle ?? "",
          cover: bestThumb(sn.thumbnails) || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
          duration: toSeconds(item.contentDetails?.videoDuration),
        });
      }

      pageToken = data.nextPageToken;
    } while (pageToken && results.length < MAX_TRACKS);

    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}