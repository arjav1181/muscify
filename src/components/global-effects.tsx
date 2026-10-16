"use client";

import { useEffect } from "react";
import { seekTo } from "@/lib/engines/control";
import { useLibrary } from "@/store/library-store";
import { usePlayer } from "@/store/player-store";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

/**
 * Global client behaviours that belong above any individual view: the keyboard
 * layer, OS media-session metadata, pause-on-blur, and the crossfade ramp.
 *
 * Rendered once at the app root, never inside a route.
 */
export function GlobalEffects() {
  useKeyboardShortcuts();
  usePauseOnBlur();
  useCrossfade();
  useMediaSession();
  return null;
}

/**
 * Pause when the tab is hidden, if the user opted in. Spotify does this when
 * other audio starts; without that API the visibility change is the closest
 * honest equivalent.
 */
function usePauseOnBlur() {
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && useLibrary.getState().settings.pauseOnBlur) {
        usePlayer.getState().setPlaying(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
}

/**
 * Crossfade.
 *
 * A true crossfade needs two audio timelines running simultaneously, and the
 * YouTube / Deezer / SoundCloud embeds expose no such control — so overlapping
 * playback is not something this player can honestly claim to do.
 *
 * What this does instead is real and audible: ramp the master volume down over
 * the last few seconds of a track, cut over at the boundary, and ramp back up on
 * the next one. It removes the hard silence between tracks, which is most of
 * what people are buying when they turn this on.
 */
function useCrossfade() {
  useEffect(() => {
    const id = setInterval(() => {
      const player = usePlayer.getState();
      const { fadeOutSeconds } = useLibrary.getState().settings;

      if (!fadeOutSeconds || player.duration <= 0 || !player.isPlaying) return;
      if (player.repeat === "one") return; // never ramp out a repeating track
      if (player.index < 0 || player.index >= player.queue.length - 1) return;
      if (player.fade) return; // a ramp is already in flight

      const remaining = player.duration - player.position;
      if (remaining > fadeOutSeconds || remaining <= 0) return;

      const target = player.volume;
      if (target <= 2) return;

      player.runFade(target, 0, remaining * 1000, () => {
        usePlayer.getState().next(true);
        // Restore once the engine has swapped, or the next track inherits silence.
        setTimeout(() => {
          const s = usePlayer.getState();
          s.runFade(0, s.preDuckVolume || 80, 700);
        }, 300);
      });
    }, 500);

    return () => clearInterval(id);
  }, []);
}

/**
 * Publishes now-playing metadata to the OS (lock screen, media keys, watch,
 * Bluetooth). Transport actions are bound so hardware media buttons work.
 */
function useMediaSession() {
  const currentKey = usePlayer((s) => (s.index >= 0 ? `${s.queue[s.index]?.id}:${s.index}` : "none"));
  const isPlaying = usePlayer((s) => s.isPlaying);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const player = usePlayer.getState();
    const track = player.queue[player.index] ?? null;

    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album ?? "muscify",
        artwork: track.cover ? [{ src: track.cover, sizes: "512x512", type: "image/jpeg" }] : [],
      });
    } catch {
      return; // MediaMetadata unconstructable here; transport still binds below.
    }

    const bind = (action: MediaSessionAction, run: () => void) => {
      try {
        navigator.mediaSession.setActionHandler(action, run);
      } catch {
        /* action unsupported on this platform */
      }
    };

    bind("play", () => usePlayer.getState().setPlaying(true));
    bind("pause", () => usePlayer.getState().setPlaying(false));
    bind("previoustrack", () => usePlayer.getState().previous());
    bind("nexttrack", () => usePlayer.getState().next(false));
    bind("stop", () => usePlayer.getState().setPlaying(false));
    bind("seekbackward", () => nudge(-10));
    bind("seekforward", () => nudge(10));
  }, [currentKey]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch {
      /* ignore */
    }
  }, [isPlaying]);
}

function nudge(delta: number) {
  const s = usePlayer.getState();
  if (s.duration <= 0) return;
  const target = Math.max(0, Math.min(s.duration, s.position + delta));
  s.setTimeline(target, s.duration);
  seekTo(target / s.duration);
}