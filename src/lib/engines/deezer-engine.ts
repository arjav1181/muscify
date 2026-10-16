"use client";

import type { Track } from "@/lib/types";
import type { EngineHandlers, PlaybackEngine } from "./types";

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

  const clear = () => {
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
      clear();
      container = null;
      current = null;
    },
  };
}