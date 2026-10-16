"use client";

import type { Track } from "@/lib/types";
import type { EngineHandlers, PlaybackEngine } from "./types";

/** How long to wait for the silent widget before assuming it never started. */
const WATCHDOG_MS = 5000;

function widgetUrl(track: Track): string {
  return (
    "https://www.deezer.com/plugins/player?autoplay=1&size=small&type=tracks&track=" +
    encodeURIComponent(track.id)
  );
}

/**
 * Deezer's official widget exposes no parent-facing control API — there is no
 * pause, no seek, no volume. This engine is therefore genuinely "faithful":
 * load sets an autoplaying iframe, and pause is implemented as unloading the
 * iframe (a resume restarts the track from zero).
 */
export function createDeezerEngine(handlers: EngineHandlers): PlaybackEngine {
  let frame: HTMLIFrameElement | null = null;
  let container: HTMLElement | null = null;
  let volume = 80;
  let current: Track | null = null;
  let unloaded = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const clearWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };

  const clear = () => {
    clearWatchdog();
    if (frame) {
      frame.src = "about:blank";
      frame.remove();
      frame = null;
    }
  };

  const build = () => {
    if (!container || !current) return;
    unloaded = false;
    clear();
    frame = document.createElement("iframe");
    frame.title = "Deezer player";
    frame.allow = "autoplay";
    frame.width = "320";
    frame.height = "80";
    frame.style.border = "0";
    frame.src = widgetUrl(current);
    // The widget never signals state back, so treat load as "started" and let
    // the store's own timeline be the only source of truth for this source.
    container.appendChild(frame);
    handlers.onState(true);
    handlers.onLoading(false);
    handlers.onNeedsGesture(false);
    handlers.onPosition(0, 0);

    /**
     * The widget exposes no state events whatsoever, so there is no way to
     * confirm it started. If nothing is audibly playing shortly after load,
     * surface that rather than leaving the bar showing a track that is silent.
     *
     * Worth noting: Deezer's player URL currently 302s to a placeholder and
     * returns `X-Frame-Options: SAMEORIGIN`, so the official embed is not
     * framable from a third-party origin at all. This may be region-specific,
     * hence the watchdog rather than a hard disable.
     */
    clearWatchdog();
    watchdog = setTimeout(() => {
      watchdog = null;
      if (unloaded || !current) return;
      handlers.onUnavailable(
        "Deezer's embedded player didn't start — it may be unavailable in your region.",
      );
    }, WATCHDOG_MS);
    // Volume is not controllable — record the intent so switching sources keeps
    // a consistent level.
    void volume;
  };

  return {
    source: "deezer",
    mount(el) {
      container = el;
    },
    load(track) {
      current = track;
      build();
    },
    play() {
      if (unloaded) build();
      else handlers.onState(true);
    },
    pause() {
      clear();
      unloaded = true;
      handlers.onState(false);
      handlers.onPosition(0, 0);
    },
    resume() {
      build();
    },
    stop() {
      handlers.onNeedsGesture(false);
      clear();
      unloaded = true;
      handlers.onState(false);
      handlers.onLoading(false);
    },
    seekFraction() {
      // Not supported by the widget.
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(100, v));
    },
    position() {
      return 0;
    },
    duration() {
      return 0;
    },
    destroy() {
      clearWatchdog();
      clear();
      container = null;
      current = null;
    },
  };
}