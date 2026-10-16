"use client";

import type { Track } from "@/lib/types";
import type { EngineHandlers, PlaybackEngine } from "./types";

/**
 * SomaFM streams are plain MP3 over HTTPS, so this one is a native
 * <audio> element rather than an embed. It's the only source that gets a real
 * pause, volume and progress ticker; the streams are infinite, so duration is
 * reported as 0 and the UI renders it as LIVE.
 */
export function createRadioEngine(handlers: EngineHandlers): PlaybackEngine {
  let audio: HTMLAudioElement | null = null;
  let volume = 80;
  let current: Track | null = null;
  let destroyed = false;

  const applyVolume = () => {
    if (audio) audio.volume = Math.min(1, Math.max(0, volume / 100));
  };

  const teardown = () => {
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
      // No crossOrigin: these are plain MP3 streams served without CORS headers,
      // and requesting them anonymously would fail the origin check.
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
      teardown();
      if (!audio || !track.stream) return;
      handlers.onLoading(true);
      // Assigning src already kicks off the load. Calling load() here would
      // abort that request, and the play() that follows would reject with
      // AbortError rather than actually playing.
      audio.src = track.stream;
      audio.preload = "auto";
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
      teardown();
      audio = null;
      current = null;
    },
  };
}