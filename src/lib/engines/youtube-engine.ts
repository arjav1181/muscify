"use client";

import type { Track } from "@/lib/types";
import { SKIPPABLE_YT_ERRORS, YT_STATE, type EngineHandlers, type PlaybackEngine } from "./types";

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  loadVideoById(id: string): void;
  loadPlaylistById(id: string): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(v: number): void;
  getVolume(): number;
  getDuration(): number;
  getCurrentTime(): number;
  getPlayerState(): number;
}

interface YTNamespace {
  Player: new (target: HTMLElement | string, opts: unknown) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads the IFrame API once per document; concurrent callers share the promise. */
function loadYoutubeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube IFrame API loaded without a Player"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("YouTube IFrame API failed to load"));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export function createYoutubeEngine(handlers: EngineHandlers): PlaybackEngine {
  let player: YTPlayer | null = null;
  let container: HTMLElement | null = null;
  let ready = false;
  let volume = 80;
  let current: Track | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let gestureTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const volumeNow = () => {
    try {
      player?.setVolume(volume);
    } catch {
      /* player torn down mid-call */
    }
  };

  const stopPolling = () => {
    if (poll) clearInterval(poll);
    poll = null;
  };

  const startPolling = () => {
    stopPolling();
    poll = setInterval(() => {
      if (!player) return;
      let duration = 0;
      let position = 0;
      try {
        duration = player.getDuration() || 0;
        position = player.getCurrentTime() || 0;
      } catch {
        return;
      }
      if (Number.isFinite(duration) && duration > 0) {
        handlers.onPosition(position, duration);
      }
    }, 500);
  };

  const clearGestureTimer = () => {
    if (gestureTimer) clearTimeout(gestureTimer);
    gestureTimer = null;
  };

  /**
   * Autoplay without a user gesture can leave the player sitting in UNSTARTED
   * or CUED forever. If it hasn't actually started shortly after loadVideo, we
   * surface a tap-to-play affordance instead of silently doing nothing.
   */
  const armGestureWatchdog = () => {
    clearGestureTimer();
    gestureTimer = setTimeout(() => {
      if (destroyed || !player || !current) return;
      try {
        const state = player.getPlayerState();
        if (state === YT_STATE.UNSTARTED || state === YT_STATE.CUED) {
          handlers.onNeedsGesture(true);
        }
      } catch {
        /* ignore */
      }
    }, 2000);
  };

  const build = (YT: YTNamespace) => {
    if (!container) return;
    player = new YT.Player(container, {
      width: "320",
      height: "180",
      playerVars: {
        autoplay: 1,
        controls: 0,
        playsinline: 1,
        disablekb: 1,
        modestbranding: 1,
        rel: 0,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          ready = true;
          volumeNow();
          if (current) start();
        },
        onStateChange: (e: { data: number }) => {
          clearGestureTimer();
          switch (e.data) {
            case YT_STATE.PLAYING:
              handlers.onState(true);
              handlers.onNeedsGesture(false);
              handlers.onLoading(false);
              startPolling();
              break;
            case YT_STATE.PAUSED:
              handlers.onState(false);
              break;
            case YT_STATE.ENDED:
              stopPolling();
              handlers.onState(false);
              handlers.onEnded();
              break;
            case YT_STATE.BUFFERING:
              handlers.onLoading(true);
              break;
            default:
              handlers.onLoading(false);
          }
        },
        onError: (e: { data: number }) => {
          stopPolling();
          if (SKIPPABLE_YT_ERRORS.has(e.data)) {
            handlers.onError(`Track unavailable (YouTube error ${e.data})`);
            handlers.onEnded();
          }
        },
      },
    });
  };

  const start = () => {
    if (!player || !current) return;
    try {
      handlers.onLoading(true);
      if (current.list) player.loadPlaylistById(current.list);
      else player.loadVideoById(current.id);
      volumeNow();
      player.playVideo();
      handlers.onState(true);
      armGestureWatchdog();
    } catch {
      handlers.onLoading(false);
      handlers.onError("YouTube player rejected the track");
      handlers.onEnded();
    }
  };

  return {
    source: "youtube",
    mount(el) {
      container = el;
      loadYoutubeApi().then((YT) => {
        if (!destroyed) build(YT);
      }).catch((e: unknown) => {
        handlers.onError(e instanceof Error ? e.message : "YouTube player unavailable");
        handlers.onEnded();
      });
    },
    load(track) {
      current = track;
      if (ready) start();
    },
    play() {
      if (ready) {
        try {
          player?.playVideo();
          handlers.onState(true);
        } catch {
          /* ignore */
        }
      }
    },
    pause() {
      try {
        player?.pauseVideo();
        handlers.onState(false);
      } catch {
        /* ignore */
      }
    },
    resume() {
      this.play();
    },
    stop() {
      clearGestureTimer();
      stopPolling();
      try {
        player?.stopVideo();
      } catch {
        /* ignore */
      }
      handlers.onState(false);
      handlers.onLoading(false);
    },
    seekFraction(fraction) {
      if (!player || !current) return;
      try {
        const duration = player.getDuration() || 0;
        if (duration > 0) player.seekTo(Math.max(0, Math.min(1, fraction)) * duration, true);
      } catch {
        /* ignore */
      }
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(100, v));
      volumeNow();
    },
    position() {
      try {
        return player?.getCurrentTime() || 0;
      } catch {
        return 0;
      }
    },
    duration() {
      try {
        const d = player?.getDuration() || 0;
        return Number.isFinite(d) ? d : 0;
      } catch {
        return 0;
      }
    },
    destroy() {
      destroyed = true;
      clearGestureTimer();
      stopPolling();
      try {
        player?.stopVideo();
      } catch {
        /* ignore */
      }
      player = null;
      current = null;
    },
  };
}