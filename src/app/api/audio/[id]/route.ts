import { NextResponse } from "next/server";

/**
 * Audio stream proxy for YouTube.
 *
 * ## Why this exists
 *
 * The equaliser, loudness normalisation and the rest of the DSP chain are built on
 * `AudioContext.createMediaElementSource`, which needs a real `<audio>` element in
 * *this* document. YouTube's IFrame player plays inside a cross-origin iframe, and
 * no web standard lets a page route iframe audio into its own AudioContext -- the
 * IFrame API's `postMessage` channel is control-only (`playVideo`, `setVolume`)
 * and exposes no audio tap at all, by design.
 *
 * So with the iframe, the EQ silently did nothing on three of the four sources: a
 * slider that appears to apply a setting and does not.
 *
 * This route makes the audio reachable. Resolve a video to an audio-only stream,
 * fetch it here, and re-serve it same-origin. The browser then plays it through
 * an `<audio>` element the page owns, `createMediaElementSource` attaches, and
 * the existing DSP chain applies unchanged. None of it needs rewriting -- all of
 * it is already written and correct, and only ever worked for radio because radio
 * is the one source that already owned a real element.
 *
 * ## Why a proxy rather than handing the URL to the browser
 *
 * `*.googlevideo.com` sends no `Access-Control-Allow-Origin`. Measured directly:
 * the header is absent. A browser cannot fetch a stream URL even when one has
 * been successfully obtained, so the proxy is mandatory and not a convenience.
 * `Range` is forwarded because `<audio>` seeking depends on it -- answering a
 * byte-range request with the whole file makes the scrubber inert.
 */

export const maxDuration = 30;

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const INNERTUBE_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const INNERTUBE_URL = `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`;

/**
 * Client identities, tried in order.
 *
 * The distinction that matters: `WEB` is subject to aggressive bot detection and
 * returns metadata with the stream URL withheld -- from a datacenter IP it
 * returns `LOGIN_REQUIRED: "Sign in to confirm you're not a bot"`, or describes
 * the audio formats fully (itag, bitrate, mime type) while leaving `url` absent.
 *
 * `ANDROID_VR` is not. It is a *device* client, not a browsing session, and it
 * is not behind the same gate: measured from a datacenter IP it returned 4
 * audio formats with working `googlevideo` stream URLs, where `WEB` returned
 * none. Its URLs also need no signature cipher, which is why this route calls
 * InnerTube directly and carries no YouTube library at all.
 *
 * The rest are fallbacks so that a rate limit on one identity does not take the
 * feature down; the order is cheapest-and-most-permissive first.
 */
const CLIENTS = [
  {
    name: "ANDROID_VR",
    ua: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; GB) gzip",
    context: {
      clientName: "ANDROID_VR",
      clientVersion: "1.60.19",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
      osName: "Android",
      osVersion: "12L",
      platform: "MOBILE",
      hl: "en",
      gl: "US",
    },
  },
  {
    name: "ANDROID",
    ua: "com.google.android.youtube/19.09.37 (Linux; U; Android 12) gzip",
    context: {
      clientName: "ANDROID",
      clientVersion: "19.09.37",
      androidSdkVersion: 32,
      osName: "Android",
      osVersion: "12",
      hl: "en",
      gl: "US",
    },
  },
] as const;

/**
 * Resolved URLs embed an `expire` parameter and are good for hours, so this cache
 * is the difference between one InnerTube call per track and one per play.
 * It is deliberately generous: re-resolving is both slow and, on a rate-limited
 * identity, risky.
 */
const RESOLVE_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_CACHED = 200;

interface Resolved {
  url: string;
  contentType: string;
  at: number;
}
const resolvedCache = new Map<string, Resolved>();

interface Attempt {
  client: string;
  stage: string;
  detail: string;
  ok: boolean;
}

async function resolveWith(
  videoId: string,
  c: (typeof CLIENTS)[number],
): Promise<{ ok: true; stream: Resolved } | { ok: false; stage: string; detail: string }> {
  const res = await fetch(INNERTUBE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": c.ua },
    body: JSON.stringify({
      videoId,
      context: { client: c.context },
      contentCheckOk: true,
      racyCheckOk: true,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    return { ok: false, stage: "innertube", detail: `HTTP ${res.status}` };
  }

  const data = await res.json();
  const status = data?.playabilityStatus?.status;
  if (status && status !== "OK") {
    return {
      ok: false,
      stage: "playability",
      detail: `YouTube says ${status}${data?.playabilityStatus?.reason ? `: ${data.playabilityStatus.reason}` : ""}`,
    };
  }

  const formats = (data?.streamingData?.adaptiveFormats ?? []).filter((f: { mimeType?: string }) =>
    (f.mimeType ?? "").startsWith("audio"),
  );
  if (formats.length === 0) {
    return { ok: false, stage: "formats", detail: "no audio-only formats returned" };
  }

  // Itag 140 is m4a at ~128kbps: plays everywhere and is small enough to proxy.
  // The webm/opus alternatives are cheaper to serve but Safari and the iOS
  // player bar behave poorly with opus, and this app is used on phones.
  const chosen = formats.find((f: { itag?: number }) => f.itag === 140) ?? formats[0];

  // `url` is expected for these device clients. If it is absent the metadata is
  // real and the URL is being withheld -- bot detection, not a cipher failure.
  const streamUrl = chosen.url ?? urlFromCipher(chosen.signatureCipher);

  if (!streamUrl) {
    const withUrl = formats.filter((f: { url?: string; signatureCipher?: string }) => f.url ?? f.signatureCipher)
      .length;
    return {
      ok: false,
      stage: "stream-url",
      detail:
        `YouTube described ${formats.length} audio format(s) but withheld the URL from ` +
        `${withUrl} of them -- bot detection, not a cipher failure`,
    };
  }

  return {
    ok: true,
    stream: {
      url: streamUrl,
      contentType: chosen.mimeType ?? "audio/mp4",
      at: Date.now(),
    },
  };
}

/** Only needed for clients that do cipher their URLs; the device clients do not. */
function urlFromCipher(cipher?: string): string | undefined {
  if (!cipher) return undefined;
  const match = /(?:^|&)url=([^&]+)/.exec(cipher);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) {
    return NextResponse.json({ ok: false, stage: "input", error: "bad video id" }, { status: 400 });
  }

  const cached = resolvedCache.get(id);
  if (cached && Date.now() - cached.at < RESOLVE_TTL_MS) {
    return proxy(req, cached);
  }

  const attempts: Attempt[] = [];
  for (const c of CLIENTS) {
    try {
      const r = await resolveWith(id, c);
      if (r.ok) {
        attempts.push({ client: c.name, stage: "ok", detail: "resolved", ok: true });
        if (resolvedCache.size >= MAX_CACHED) {
          const oldest = resolvedCache.keys().next().value as string | undefined;
          if (oldest) resolvedCache.delete(oldest);
        }
        resolvedCache.set(id, r.stream);
        return proxy(req, r.stream);
      }
      attempts.push({ client: c.name, stage: r.stage, detail: r.detail, ok: false });
    } catch (e) {
      attempts.push({
        client: c.name,
        stage: "resolve",
        detail: e instanceof Error ? e.message : String(e),
        ok: false,
      });
    }
  }

  // 501 not 502: nothing is broken here, this deployment could not reach the
  // streams on this request. The client falls back to the IFrame player rather
  // than surfacing an error, so a transient refusal is invisible to the listener.
  return NextResponse.json(
    {
      ok: false,
      stage: attempts[attempts.length - 1]?.stage ?? "unknown",
      error: attempts.map((a) => `${a.client}: ${a.stage} - ${a.detail}`).join(" | "),
      videoId: id,
      attempts,
    },
    { status: 501 },
  );
}

/** Re-serves the stream, forwarding Range. */
async function proxy(req: Request, stream: Resolved): Promise<Response> {
  const range = req.headers.get("range");
  const headers: Record<string, string> = {
    "User-Agent": CLIENTS[0].ua,
  };
  if (range) headers.Range = range;

  let upstream: Response;
  try {
    upstream = await fetch(stream.url, { headers, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    // An expired signature lands here. Drop the entry so the next request
    // re-resolves rather than retrying a dead URL for hours.
    resolvedCache.clear();
    return NextResponse.json(
      { ok: false, stage: "fetch", error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  if (upstream.status === 403) {
    // Signature expired early. Same reasoning: re-resolve next time.
    resolvedCache.clear();
  }

  const out = new Headers();
  out.set("Content-Type", upstream.headers.get("content-type") ?? stream.contentType);
  out.set("Accept-Ranges", "bytes");
  const cr = upstream.headers.get("content-range");
  if (cr) out.set("Content-Range", cr);
  const len = upstream.headers.get("content-length");
  if (len) out.set("Content-Length", len);
  // Never cached past its signature's life, and never shared.
  out.set("Cache-Control", "private, max-age=600");

  return new Response(upstream.body, { status: upstream.status, headers: out });
}
