"use client";

import type { Track } from "@/lib/types";
import type { EngineHandlers, PlaybackEngine } from "./types";

function widgetUrl(track: Track, volume: number): string {
  return (
    "https://w.soundcloud.com/player/?url=" +
    encodeURIComponent(track.url ?? track.id) +
    `&auto_play=true&hide_related=true&show_comments=false&show_user=false&visual=false&volume=${Math.round(volume)}`
  );
}

/**
 * SoundCloud's widget is controlled over postMessage. Unlike Deezer it does
 * report back: the widget emits `{ method: "info", data: { duration,
 * currentTime, isPlaying } }` messages, which is what drives the progress bar
 * and track-end detection here.
 */
export function createSoundcloudEngine(handlers: EngineHandlers): PlaybackEngine {
  let frame: HTMLIFrameElement | null = null;
  let container: HTMLElement | null = null;
  let volume = 80;
  let current: Track | null = null;
  let destroyed = false;

  // The widget's origin isn't guaranteed ahead of time and older builds ignore
  // a mismatched targetOrigin, so messages are sent to '*'. Payloads are
  // volume numbers and control verbs only — no user data crosses this channel.
  const post = (payload: Record<string, unknown>) => {
    try {
      frame?.contentWindow?.postMessage(JSON.stringify(payload), "*");
    } catch {
      /* frame torn down */
    }
  };

  const onMessage = (event: MessageEvent) => {
    if (destroyed || !frame || event.source !== frame.contentWindow) return;
    let payload: { method?: string; data?: Record<string, unknown> };
    try {
      payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    if (!payload || typeof payload.method !== "string") return;

    if (payload.method === "ready") {
      post({ method: "setVolume", value: volume });
      post({ method: "play" });
      handlers.onNeedsGesture(false);
    }
    if (payload.method === "play") handlers.onState(true);
    if (payload.method === "pause") handlers.onState(false);
    if (payload.method === "finish") {
      handlers.onState(false);
      handlers.onEnded();
    }
    if (payload.method === "error") {
      handlers.onState(false);
      handlers.onError(`SoundCloud track unavailable`);
      handlers.onEnded();
    }
    if (payload.method === "info" && payload.data) {
      const { duration, currentTime } = payload.data as { duration?: number; currentTime?: number };
      if (typeof duration === "number" && typeof currentTime === "number") {
        handlers.onPosition(currentTime, duration);
      }
    }
  };

  const build = () => {
    if (!container || !current) return;
    clear();
    frame = document.createElement("iframe");
    frame.title = "SoundCloud player";
    frame.allow = "autoplay";
    frame.width = "100%";
    frame.height = "166";
    frame.scrolling = "no";
    frame.style.border = "0";
    frame.src = widgetUrl(current, volume);
    container.appendChild(frame);
    handlers.onLoading(true);
  };

  const clear = () => {
    if (frame) {
      frame.src = "about:blank";
      frame.remove();
      frame = null;
    }
  };

  return {
    source: "soundcloud",
    mount(el) {
      container = el;
      window.addEventListener("message", onMessage);
    },
    load(track) {
      current = track;
      build();
    },
    play() {
      post({ method: "play" });
      handlers.onState(true);
    },
    pause() {
      post({ method: "pause" });
      handlers.onState(false);
    },
    resume() {
      post({ method: "play" });
      handlers.onState(true);
    },
    stop() {
      handlers.onNeedsGesture(false);
      post({ method: "pause" });
      clear();
      handlers.onState(false);
      handlers.onLoading(false);
    },
    seekFraction(fraction) {
      const ms = Math.max(0, Math.min(1, fraction)) * 100000;
      post({ method: "seekTo", value: ms });
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(100, v));
      post({ method: "setVolume", value: volume });
    },
    position() {
      return 0;
    },
    duration() {
      return 0;
    },
    destroy() {
      destroyed = true;
      window.removeEventListener("message", onMessage);
      clear();
      container = null;
      current = null;
    },
  };
}