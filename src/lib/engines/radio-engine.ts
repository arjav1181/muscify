"use client";

import { corsAllowsTapping, getAnalyser } from "@/lib/audio/analyser";
import type { Track } from "@/lib/types";
import type { EngineHandlers, PlaybackEngine } from "./types";

/**
 * SomaFM streams are plain MP3 over HTTPS, so this one is a native
 * <audio> element rather than an embed. It's the only source that gets a real
 * pause, volume and progress ticker; the streams are infinite, so duration is
 * reported as 0 and the UI renders it as LIVE.
 *
 * It is also the only source the analyser can measure, because it is the only
 * one playing through an element we own rather than a third-party frame.
 */

/**
 * Whether a stream's origin permits being read by a Web Audio graph.
 *
 * Module-level on purpose: the verdict is a property of the upstream server,
 * not of an engine instance, and it does not change while the page is open.
 *
 * This has to be known *before* `src` is assigned. Web Audio taints — and so
 * silences — a media element whose stream was loaded without CORS approval,
 * because the MediaElementAudioSourceNode reads the bytes. Setting
 * `crossOrigin` afterwards is too late; the load has already begun untainted.
 *
 * The cost is one HEAD per stream, once. There are a few dozen stations, so
 * the second play of any station is synchronous and adds no latency at all.
 */
const tappingVerdicts = new Map<string, boolean>();
const tappingInflight = new Map<string, Promise<boolean>>();

async function allowsTapping(url: string): Promise<boolean> {
  const known = tappingVerdicts.get(url);
  if (known !== undefined) return known;

  let probe = tappingInflight.get(url);
  if (!probe) {
    probe = corsAllowsTapping(url).then((ok) => {
      tappingVerdicts.set(url, ok);
      tappingInflight.delete(url);
      return ok;
    });
    tappingInflight.set(url, probe);
  }
  return probe;
}
export function createRadioEngine(handlers: EngineHandlers): PlaybackEngine {
  let audio: HTMLAudioElement | null = null;
  let volume = 80;
  let current: Track | null = null;
  let destroyed = false;
  /**
   * Incremented on every load and stop, so a verdict that arrives after the
   * listener moved on does not resurrect a stream they already skipped past.
   */
  let generation = 0;

  const applyVolume = () => {
    if (audio) audio.volume = Math.min(1, Math.max(0, volume / 100));
  };

  const teardown = () => {
    // Leaving the analyser attached to a stopped element would keep the graph
    // alive and mute nothing; detaching is what stops the measurement loop.
    if (audio) getAnalyser().detach();
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  };

  return {
    source: "radio",
    mount(el) {
      audio = new Audio();
      audio.preload = "none";
      // crossOrigin is deliberately not set here. It has to be in place before
      // src is assigned and only when the origin allows it, so it is decided in
      // load() once the stream URL is known.
      //
      // The Referer header is suppressed document-wide via the `referrer`
      // metadata in the root layout — SomaFM 403s any media request that
      // carries one, and a per-element attribute is not honoured here.
      applyVolume();

      audio.addEventListener("timeupdate", () => {
        if (!audio) return;
        const position = audio.currentTime || 0;
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        handlers.onPosition(position, duration);
      });
      audio.addEventListener("playing", () => {
        handlers.onState(true);
        handlers.onLoading(false);
        handlers.onNeedsGesture(false);
      });
      audio.addEventListener("pause", () => {
        // teardown() clears the src and fires this too; it must not fight with
        // an explicit stop().
        if (audio?.src) handlers.onState(false);
      });
      audio.addEventListener("waiting", () => handlers.onLoading(true));
      audio.addEventListener("canplay", () => handlers.onLoading(false));
      audio.addEventListener("error", () => {
        // Clearing the src and calling load() leaves the element in
        // NETWORK_EMPTY, which Chromium reports as an error. Without this guard
        // every teardown looks like a failed stream.
        if (!current || destroyed || !audio?.currentSrc) return;
        handlers.onLoading(false);
        handlers.onError(`Stream unavailable: ${current.title}`);
        handlers.onEnded();
      });

      el.appendChild(audio);
    },
    load(track) {
      current = track;
      const mine = ++generation;
      teardown();
      if (!audio || !track.stream) return;

      const stream = track.stream;
      const known = tappingVerdicts.get(stream);

      const begin = (tappable: boolean) => {
        // Stale: the listener skipped on while this probe was in flight.
        if (destroyed || mine !== generation || !audio) return;

        if (tappable) {
          // Anonymous is required. With it set, the element's output is
          // untainted and the analyser can read it; without it the source node
          // outputs silence and the equalizer would take the music with it.
          audio.crossOrigin = "anonymous";
          getAnalyser().attach(audio);
        } else {
          audio.removeAttribute("crossorigin");
        }

        handlers.onLoading(true);
        // Assigning src already kicks off the load. Calling load() here would
        // abort that request, and the play() that follows would reject with
        // AbortError rather than actually playing.
        audio.src = stream;
        audio.preload = "auto";
      };

      // A known verdict, or a probe already answered, plays immediately.
      if (known !== undefined) {
        begin(known);
        return;
      }

      // Unknown. Play straight away and attach the analyser if the answer
      // arrives in time — a station should never wait on a HEAD request, and
      // whether this ends up measurable is not worth a visible stall.
      begin(false);
      void allowsTapping(stream).then((ok) => {
        if (!ok || destroyed || mine !== generation || !audio) return;
        begin(true);
      });
    },
    play() {
      if (!audio || !current?.stream) return;
      audio.play().then(
        () => handlers.onState(true),
        (e: unknown) => {
          // Only a blocked autoplay needs a user gesture. AbortError just means
          // the source changed under us (a skip or a new track), and NotSupported
          // means the stream is genuinely dead — neither should prompt a tap.
          const name = e instanceof DOMException ? e.name : "";
          if (name === "NotAllowedError") {
            handlers.onNeedsGesture(true);
          } else if (name === "NotSupportedError") {
            handlers.onError(`Stream unavailable: ${current?.title ?? "radio"}`);
            handlers.onEnded();
          }
        },
      );
    },
    pause() {
      audio?.pause();
      handlers.onState(false);
    },
    resume() {
      this.play();
    },
    stop() {
      handlers.onNeedsGesture(false);
      // Bump before tearing down, so a CORS verdict still in flight for the
      // outgoing station cannot re-assign src behind an explicit stop().
      generation++;
      teardown();
      handlers.onState(false);
      handlers.onLoading(false);
    },
    seekFraction() {
      // Live streams have no meaningful timeline.
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(100, v));
      applyVolume();
    },
    position() {
      return audio?.currentTime ?? 0;
    },
    duration() {
      const d = audio?.duration;
      return d && Number.isFinite(d) ? d : 0;
    },
    destroy() {
      destroyed = true;
      generation++;
      teardown();
      audio = null;
      current = null;
    },
  };
}