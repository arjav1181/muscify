import { NextResponse } from "next/server";
import { Innertube } from "youtubei.js";

/**
 * Audio stream proxy for YouTube.
 *
 * ## Why this exists
 *
 * The equaliser, loudness normalisation and the rest of the DSP chain are built on
 * `AudioContext.createMediaElementSource`, which needs a real `<audio>` element in
 * *this* document. YouTube's IFrame player plays inside a cross-origin iframe, and
 * no web standard lets a page route iframe audio into its own AudioContext. So
 * with the iframe, the EQ silently did nothing on three of four sources.
 *
 * This route makes the audio reachable: resolve a video to an audio-only stream,
 * fetch it here, and re-serve it same-origin. The browser then plays it through
 * an `<audio>` element the page owns, `createMediaElementSource` attaches, and
 * the existing DSP chain applies unchanged -- none of it needs rewriting.
 *
 * ## Why a proxy and not a direct URL
 *
 * `*.googlevideo.com` sends no `Access-Control-Allow-Origin`, so a browser
 * cannot fetch it directly no matter how the URL was obtained. `Range` is
 * forwarded because `<audio>` seeking depends on it.
 *
 * ## Diagnostics
 *
 * This route reports what it found at every stage, because YouTube's refusal is
 * silent and shapeless: it returns perfectly good format metadata -- itag,
 * bitrate, mime type -- with the `url` field simply absent. That is what a
 * blocked client sees, and it is indistinguishable from a library bug unless the
 * response says so explicitly. Every failure path below names its stage.
 */

export const maxDuration = 30;

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Resolved URLs carry signature params that expire, so keep them briefly. */
const RESOLVE_TTL_MS = 30 * 60 * 1000;
interface Resolved {
  url: string;
  contentType: string;
  contentLength: number | null;
  at: number;
}
const resolvedCache = new Map<string, Resolved>();

/**
 * One client for the lifetime of the warm instance.
 *
 * Building an Innertube per request re-fetches and re-parses the player script
 * every time, which is the expensive part. `generate_session_locally` avoids a
 * round trip for the session cookie.
 */
let clientPromise: Promise<Innertube> | null = null;
function client(): Promise<Innertube> {
  clientPromise ??= Innertube.create({ fetch: globalThis.fetch, lang: "en" });
  return clientPromise;
}

interface ResolveOutcome {
  ok: boolean;
  stage: string;
  detail: string;
  stream?: Resolved;
}

async function resolveAudio(videoId: string): Promise<ResolveOutcome> {
  const yt = await client();
  const info = await yt.getBasicInfo(videoId);

  const status = info.playability_status?.status;
  if (status && status !== "OK") {
    return {
      ok: false,
      stage: "playability",
      detail: `YouTube says ${status}${
        info.playability_status?.reason ? `: ${info.playability_status.reason}` : ""
      }`,
    };
  }

  const formats = (info.streaming_data?.adaptive_formats ?? []).filter((f) =>
    (f.mime_type ?? "").startsWith("audio"),
  );
  if (formats.length === 0) {
    return { ok: false, stage: "formats", detail: "no audio-only formats returned" };
  }

  // itag 140 is m4a at ~128kbps: plays everywhere, small enough to proxy. The
  // webm/opus ones are smaller but Safari and the iOS player bar behave poorly
  // with opus, and this app is used on phones.
  const chosen = formats.find((f) => f.itag === 140) ?? formats[0];

  // The URL may already be plain, or may be inside `signature_cipher`.
  let url = chosen.url;
  if (!url && chosen.signature_cipher) {
    try {
      await chosen.decipher(yt.session.player);
      url = chosen.url;
    } catch {
      // Reported below, with the rest.
    }
  }

  if (!url) {
    // The exact failure worth naming: YouTube returned the format but withheld
    // the stream. Seen from datacenter IPs, where it declines to hand over a URL
    // while still describing what exists.
    const withUrl = formats.filter((f) => f.url || f.signature_cipher).length;
    return {
      ok: false,
      stage: "stream-url",
      detail:
        `YouTube returned ${formats.length} audio format(s) but ${withUrl} of them ` +
        `with a stream URL. The URL field is withheld, which is what bot detection ` +
        `does to a non-residential client -- not a cipher failure.`,
    };
  }

  return {
    ok: true,
    stage: "ok",
    detail: `itag ${chosen.itag}`,
    stream: {
      url,
      contentType: chosen.mime_type ?? "audio/mp4",
      contentLength: chosen.content_length ?? null,
      at: Date.now(),
    },
  };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) {
    return NextResponse.json({ ok: false, stage: "input", error: "bad video id" }, { status: 400 });
  }

  let entry = resolvedCache.get(id);
  if (entry && Date.now() - entry.at < RESOLVE_TTL_MS) {
    return proxy(req, entry);
  }

  let outcome: ResolveOutcome;
  try {
    outcome = await resolveAudio(id);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        stage: "resolve",
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  if (!outcome.ok || !outcome.stream) {
    // 501 rather than 502: nothing is broken, this deployment simply cannot reach
    // YouTube's streams. The caller falls back to the IFrame player.
    return NextResponse.json(
      { ok: false, stage: outcome.stage, error: outcome.detail, videoId: id },
      { status: 501 },
    );
  }

  resolvedCache.set(id, outcome.stream);
  return proxy(req, outcome.stream);
}

/**
 * Re-serves the stream, forwarding Range.
 *
 * Without Range forwarding, seeking does nothing: `<audio>` asks for byte
 * ranges and a 200 response for the whole file makes the scrubber inert.
 */
async function proxy(req: Request, stream: Resolved): Promise<Response> {
  const range = req.headers.get("range");
  const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0" };
  if (range) headers["Range"] = range;

  let upstream: Response;
  try {
    upstream = await fetch(stream.url, { headers });
  } catch (e) {
    // An expired signature lands here. Drop the cache entry so the next request
    // re-resolves instead of retrying a dead URL for half an hour.
    resolvedCache.clear();
    return NextResponse.json(
      { ok: false, stage: "fetch", error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const out = new Headers();
  out.set("Content-Type", upstream.headers.get("content-type") ?? stream.contentType);
  out.set("Accept-Ranges", "bytes");
  const cr = upstream.headers.get("content-range");
  if (cr) out.set("Content-Range", cr);
  const len = upstream.headers.get("content-length");
  if (len) out.set("Content-Length", len);
  // The stream is for this origin only, and must never be cached past its
  // signature's life.
  out.set("Cache-Control", "private, max-age=600");

  return new Response(upstream.body, { status: upstream.status, headers: out });
}