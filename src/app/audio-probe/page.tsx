"use client";

import { useState } from "react";

/**
 * Client-side audio probe.
 *
 * ## The question this answers
 *
 * Whether the whole server-side proxy is unnecessary.
 *
 * The proxy exists because of two separate assumptions:
 *
 *   1. YouTube will not hand out stream URLs to us.
 *   2. The stream cannot be fetched by a browser without CORS headers.
 *
 * Assumption 1 is about the *requester's IP*, and it is false from a residential
 * connection. This sandbox and Vercel are both datacentres, which is why every
 * server-side attempt was refused. A phone on cellular is not.
 *
 * Assumption 2 was tested wrong. CORS headers are only returned when the request
 * carries an `Origin`, and the earlier check did not send one -- so "googlevideo
 * sends no CORS headers" was an artefact of how it was asked, not a fact. If
 * googlevideo answers `Access-Control-Allow-Origin: *`, then an
 * `<audio crossorigin="anonymous">` is CORS-enabled, `createMediaElementSource`
 * is allowed to output sound, and the entire proxy is unnecessary.
 *
 * Both questions can only be answered from a real browser on a real network,
 * which is why this page exists rather than another server-side test.
 *
 * Every result is shown on screen. There is no server involvement at any point:
 * if this works, the fix is deleting the proxy.
 */

const KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const VR_UA =
  "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; GB) gzip";
const VR_CONTEXT = {
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
} as const;

type Line = { label: string; value: string; tone?: "good" | "bad" | "mid" };

export default function AudioProbe() {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [videoId, setVideoId] = useState("dQw4w9WgXcQ");

  const push = (l: Line) => setLines((p) => [...p, l]);

  async function run() {
    setLines([]);
    setBusy(true);

    // Autoplay needs a user gesture, and the whole point is to hear the result.
    const ctx = new AudioContext();
    const el = document.createElement("audio");
    el.crossOrigin = "anonymous";

    try {
      // --- Step 1: can this browser reach InnerTube at all? ---
      push({ label: "Resolving", value: videoId });
      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId,
            context: { client: VR_CONTEXT },
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        },
      );

      push({
        label: "1. InnerTube reachable",
        value: `HTTP ${res.status}`,
        tone: res.ok ? "good" : "bad",
      });

      const acaoInner = res.headers.get("access-control-allow-origin");
      push({
        label: "   InnerTube CORS header",
        value: acaoInner ?? "(none)",
        tone: acaoInner ? "good" : "bad",
      });

      if (!res.ok) {
        push({
          label: "Result",
          value:
            "Browser could not read InnerTube. A same-origin server proxy is " +
            "required for the resolve step.",
          tone: "bad",
        });
        return;
      }

      const data = await res.json();
      const playability = data?.playabilityStatus?.status ?? "?";
      push({
        label: "   Playability",
        value: String(playability),
        tone: playability === "OK" ? "good" : "bad",
      });
      if (playability !== "OK") {
        push({
          label: "   Reason",
          value: data?.playabilityStatus?.reason ?? "(none given)",
          tone: "bad",
        });
      }

      // --- Step 2: did we get a usable stream URL? ---
      const formats = (data?.streamingData?.adaptiveFormats ?? []).filter(
        (f: { mimeType?: string }) => (f.mimeType ?? "").startsWith("audio"),
      );
      const usable = formats.filter(
        (f: { url?: string; signatureCipher?: string }) => f.url ?? f.signatureCipher,
      );
      push({
        label: "2. Audio formats",
        value: `${formats.length} found, ${usable.length} with a stream URL`,
        tone: usable.length ? "good" : "bad",
      });

      if (usable.length === 0) {
        push({
          label: "Result",
          value:
            "Formats were described but no URL was handed over. This is YouTube " +
            "declining to serve a stream to this network.",
          tone: "bad",
        });
        return;
      }

      const chosen =
        usable.find((f: { itag?: number }) => f.itag === 140) ?? usable[0];
      push({
        label: "   Chosen",
        value: `itag ${chosen.itag} — ${String(chosen.mimeType).slice(0, 40)}`,
      });

      // --- Step 3: the decisive question, asked correctly this time ---
      const streamRes = await fetch(chosen.url, {
        headers: { Range: "bytes=0-65535" },
      });
      const acao = streamRes.headers.get("access-control-allow-origin");
      push({
        label: "3. Stream CORS header",
        value: acao ?? "(none)",
        tone: acao ? "good" : "bad",
      });
      push({
        label: "   Stream bytes",
        value: `${streamRes.headers.get("content-range") ?? streamRes.status}`,
      });

      // --- Step 4: does Web Audio actually output sound through it? ---
      // This is the real test. A CORS-tainted media element produces silence
      // through createMediaElementSource, so reading the analyser is the only
      // honest way to know whether the DSP chain can work.
      const src = ctx.createMediaElementSource(el);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyser.connect(ctx.destination);

      el.src = chosen.url;
      el.volume = 1;
      await ctx.resume();
      await el.play();

      const buf = new Uint8Array(analyser.frequencyBinCount);
      let peak = 0;
      const started = performance.now();
      while (performance.now() - started < 2500) {
        await new Promise((r) => setTimeout(r, 120));
        analyser.getByteFrequencyData(buf);
        for (const v of buf) if (v > peak) peak = v;
      }

      const audible = peak > 8;
      push({
        label: "4. Analyser peak (0-255)",
        value: String(peak),
        tone: audible ? "good" : "bad",
      });
      push({
        label: "RESULT",
        value: audible
          ? "AUDIO IS ROUTED. No proxy needed — DSP works client-side from this network."
          : "Silence through Web Audio. The media element is CORS-tainted, so DSP cannot use it.",
        tone: audible ? "good" : "bad",
      });
    } catch (e) {
      push({
        label: "Error",
        value: e instanceof Error ? e.message : String(e),
        tone: "bad",
      });
    } finally {
      el.pause();
      el.src = "";
      void ctx.close();
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: 20,
        paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
        maxWidth: 720,
        margin: "0 auto",
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Client-side audio probe</h1>
      <p style={{ marginTop: 0, opacity: 0.7, fontSize: 14 }}>
        Tests whether the EQ can reach YouTube directly from this device, with no
        server proxy. Tap play with the volume up and headphones on.
      </p>

      <label style={{ display: "block", margin: "16px 0 8px", fontSize: 13 }}>
        YouTube video ID
        <input
          value={videoId}
          onChange={(e) => setVideoId(e.target.value.trim())}
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          style={{
            width: "100%",
            marginTop: 6,
            padding: 12,
            font: "inherit",
            background: "#111",
            color: "#eee",
            border: "1px solid #333",
            borderRadius: 8,
          }}
        />
      </label>

      <button
        onClick={run}
        disabled={busy}
        style={{
          width: "100%",
          minHeight: 48,
          font: "inherit",
          fontWeight: 600,
          background: busy ? "#333" : "#1a7f37",
          color: "#fff",
          border: 0,
          borderRadius: 10,
          marginBottom: 20,
        }}
      >
        {busy ? "Testing…" : "Run probe"}
      </button>

      <div style={{ fontSize: 13 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <span style={{ opacity: 0.65 }}>{l.label}: </span>
            <span
              style={{
                fontWeight: l.label === "RESULT" ? 700 : 400,
                color:
                  l.tone === "good"
                    ? "#3fb950"
                    : l.tone === "bad"
                      ? "#f85149"
                      : "inherit",
              }}
            >
              {l.value}
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
