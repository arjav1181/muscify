# EQ and DSP on YouTube — the research, and what is actually possible

The requirement: the equaliser, loudness normalisation and the rest of the DSP
chain must work on YouTube, not just radio.

## Why it currently does not

`src/lib/audio/analyser.ts:156` calls `ctx.createMediaElementSource(el)`. That
requires a real `<audio>` or `<video>` element **in this page's document**.

| Source | How it plays | Reachable by Web Audio |
|---|---|---|
| `radio` (SomaFM) | `new Audio(...)` — a real element | **Yes** |
| `youtube` | `new YT.Player` in a cross-origin iframe | No |
| `deezer` | widget iframe | No |
| `soundcloud` | widget iframe | No |

Audio inside a cross-origin iframe cannot be routed into the page's `AudioContext`
by any web standard. There is no API that lifts this. It is not a bug in this
codebase and cannot be fixed by moving a call.

Measured on the live site with a YouTube track playing: 2 iframes (one
`youtube.com/embed/`), 1 `<audio>` element whose `src` is empty, and no EQ
control reachable in the bar.

## The architecture that does work

Fetch the audio stream server-side, proxy it, and play it through an `<audio>`
element this page owns. Then `createMediaElementSource` applies and the entire
existing DSP chain works unchanged — it is already written and already correct.

```
youtube videoId
  → server: InnerTube /player  → adaptiveFormats → audio-only URL (googlevideo)
  → server proxies that stream (solves CORS; googlevideo sends none for browsers)
  → <audio src="/api/audio/{id}">
  → createMediaElementSource → EQ → loudness gain → analyser
```

This is how self-hosted YouTube front-ends do it (`peer`, and others built on
`youtubei.js`). It is a real, production-proven approach.

### Why a proxy is required, not optional

`*.googlevideo.com` does not send `Access-Control-Allow-Origin` for browser
requests. A browser cannot `fetch()` that URL directly. The server must fetch and
re-serve it. That also solves the range-request problem, since `<audio>` seeking
depends on `Range` and the proxy must forward it.

## What was tested here, and what it showed

InnerTube `/youtubei/v1/player` was called directly, six client configurations:

| Client | Result |
|---|---|
| `WEB` (no key) | `playabilityStatus: UNPLAYABLE`, 0 formats |
| `WEB` + `thirdParty.embedUrl` | `UNPLAYABLE`, 0 formats |
| `ANDROID` | HTTP 400 |
| `IOS` | HTTP 400 |
| `TVHTML5_SIMPLY_EMBEDDED_PLAYER` | `ERROR`, 0 formats |
| `TVHTML5_SIMPLY_EMBEDDED_PLAYER` + `thirdParty.embedUrl` | `ERROR`, 0 formats |

Zero audio formats from every configuration. The page fetch itself works —
`youtube.com` returns 200 in 1.4 s from this machine, and `/results` was parsed
successfully for the scrape fallback (18 `videoRenderer` entries extracted).

So: **the network path is open and the stream endpoint is closed.** That is the
signature of YouTube's bot detection blocking a datacenter IP, not a malformed
request. It is the same class of block as SomaFM refusing this machine's IP for
radio streams — both are "this IP is not a residential consumer".

## What this means for the plan

**The approach is sound; it is unverified from this sandbox.** Building it here
and seeing it fail would prove nothing, because the failure would be the IP
rather than the code.

The honest sequence:

1. Build the server route and the engine change.
2. Deploy, so the request originates from a Vercel IP rather than this sandbox.
3. Verify there.

If Vercel is also blocked — which is possible, being a datacenter — then the
decision is about cost rather than code: a residential egress proxy, or accepting
that EQ/DSP apply to radio only.

## The thing that should not ship without this being solved

The equaliser is currently **visible and inert** on three of the four sources. A
slider that appears to work and does nothing is worse than no slider: it tells
the listener their setting was applied. Whatever else happens, the control should
either work or say plainly that it cannot affect the current source.

## Also fixed as a consequence of this investigation

`videos?chart=mostPopular` returns nothing from this deployment. Quota reads
1/9000, so it is not the budget. The remaining cause is not observable from here
because the key lives in Vercel's environment. `trendingYoutube` falls back to a
search rather than erroring.